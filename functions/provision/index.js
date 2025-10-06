const { app } = require('@azure/functions');
const { VPNSession, STATUS } = require('../shared/models/vpn-session');
const { ClientConfiguration } = require('../shared/models/client-config');
const { InfrastructureState } = require('../shared/models/infrastructure-state');
const { EVENT_TYPE } = require('../shared/models/operational-event');
const { ACIService } = require('../shared/services/aci-service');
const { KeyVaultService } = require('../shared/services/keyvault-service');
const { StorageService } = require('../shared/services/storage-service');
const { LoggingService } = require('../shared/services/logging-service');
const { AuthMiddleware, createErrorResponse, createSuccessResponse } = require('../shared/utils/auth');
const { generateClientConfig } = require('../shared/utils/wireguard-config');
const { generateMobileOptimizedQRCode } = require('../shared/utils/qr-code');
const { validateIdleTimeout } = require('../shared/utils/validation');
const { retryWithBackoff } = require('../shared/utils/retry');

/**
 * POST /api/vpn/start
 * Provision on-demand VPN container instance
 */

app.http('provision', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'vpn/start',
  handler: async (request, context) => {
    const startTime = Date.now();

    // Initialize services
    const storageService = new StorageService();
    const keyVaultService = new KeyVaultService();
    const aciService = new ACIService();
    const loggingService = new LoggingService({ storageService });
    const authMiddleware = new AuthMiddleware({
      keyVaultService,
      storageService,
      loggingService
    });

    try {
      // Authenticate user
      const authResult = await authMiddleware.authenticate(request, context);

      if (!authResult.authenticated) {
        return createErrorResponse(authResult.statusCode, authResult.error);
      }

      const { user, userId, sourceIP } = authResult;

      // Parse request body
      const body = await request.json().catch(() => ({}));
      const idleTimeoutMinutes = body.idleTimeoutMinutes || 10;
      const allowedIPs = body.allowedIPs || '0.0.0.0/0';
      const dnsServers = body.dnsServers || ['8.8.8.8', '8.8.4.4'];

      // Validate idle timeout
      const timeoutValidation = validateIdleTimeout(idleTimeoutMinutes);
      if (!timeoutValidation.valid) {
        return createErrorResponse(400, timeoutValidation.error);
      }

      // Check user quota
      const activeSessions = await storageService.queryEntities(
        'vpnsessions',
        `userId eq '${userId}' and (status eq 'active' or status eq 'provisioning')`
      );

      const quotaCheck = user.canCreateSession(activeSessions.length);
      if (!quotaCheck.allowed) {
        return createErrorResponse(429, quotaCheck.reason);
      }

      // Check infrastructure capacity
      let infraState = await storageService.getEntity('infrastructurestate', 'singleton', 'current');
      if (!infraState) {
        infraState = InfrastructureState.createInitial().toTableEntity();
        await storageService.createEntity('infrastructurestate', infraState);
      }

      const state = InfrastructureState.fromTableEntity(infraState);
      const capacityCheck = state.canProvisionSession();
      if (!capacityCheck.allowed) {
        return createErrorResponse(503, capacityCheck.reason, {
          code: 'CAPACITY_EXCEEDED'
        });
      }

      // Handle concurrent request conflict (FR-005a)
      const provisioningSessions = activeSessions.filter(s => s.status === 'provisioning');
      if (provisioningSessions.length > 0) {
        // Cancel existing provisioning session
        for (const existing of provisioningSessions) {
          existing.status = 'terminated';
          existing.terminatedAt = new Date().toISOString();
          existing.errorMessage = 'Cancelled due to new provision request';
          await storageService.updateEntity('vpnsessions', existing);
        }

        context.log.info(`Cancelled ${provisioningSessions.length} existing provisioning sessions for user ${userId}`);
      }

      // Create VPN session
      const session = new VPNSession({
        userId,
        status: STATUS.PROVISIONING,
        idleTimeoutMinutes
      });

      await storageService.createEntity('vpnsessions', session.toTableEntity());

      // Log provision start
      await loggingService.logEvent(
        EVENT_TYPE.VPN_PROVISION_START,
        {
          userId,
          sessionId: session.sessionId,
          message: 'VPN provisioning started',
          ipAddress: sourceIP
        },
        {},
        context
      );

      // Generate WireGuard keys
      const serverKeys = await keyVaultService.generateWireGuardKeyPair(`server-${session.sessionId}`);
      const clientKeys = await keyVaultService.generateWireGuardKeyPair(session.sessionId);

      // Allocate client IP
      const { IPAllocationService } = require('../shared/models/client-config');
      const ipAllocator = new IPAllocationService(storageService);
      const clientIpAddress = await ipAllocator.allocateIP(session.sessionId);

      // Provision ACI with retry
      let containerInfo;
      try {
        containerInfo = await retryWithBackoff(
          async () => await aciService.provisionVPNContainer(session.sessionId, {
            serverPublicKey: serverKeys.publicKey,
            serverPrivateKey: serverKeys.privateKey,
            clientPublicKey: clientKeys.publicKey,
            clientIpAddress
          }),
          3,
          1000,
          {
            shouldRetry: (error) => aciService.isTransientError(error),
            loggingService,
            context
          }
        );
      } catch (error) {
        // Provisioning failed
        session.status = STATUS.TERMINATED;
        session.errorMessage = error.message;
        session.provisionAttempts = 3;
        await storageService.updateEntity('vpnsessions', session.toTableEntity());

        state.recordProvisioningFailure();
        await storageService.updateEntity('infrastructurestate', state.toTableEntity());

        await loggingService.logEvent(
          EVENT_TYPE.VPN_PROVISION_FAILURE,
          {
            userId,
            sessionId: session.sessionId,
            message: `Provisioning failed: ${error.message}`,
            ipAddress: sourceIP
          },
          { durationMs: Date.now() - startTime },
          context
        );

        if (error.code === 'QUOTA_EXCEEDED') {
          return createErrorResponse(503, 'Service temporarily unavailable', {
            code: 'QUOTA_EXCEEDED',
            details: { retryAfterSeconds: 60, attempts: 3 }
          });
        }

        return createErrorResponse(503, 'Provisioning failed after retries', {
          code: 'PROVISION_FAILED',
          details: { attempts: 3 }
        });
      }

      // Update session with container info
      session.containerInstanceId = containerInfo.containerInstanceId;
      session.publicIpAddress = containerInfo.publicIpAddress;
      session.status = STATUS.ACTIVE;
      session.updateActivity();
      await storageService.updateEntity('vpnsessions', session.toTableEntity());

      // Generate client configuration
      const serverEndpoint = `${containerInfo.publicIpAddress}:${containerInfo.port}`;
      const configContent = generateClientConfig(
        clientKeys,
        clientIpAddress,
        serverEndpoint,
        serverKeys.publicKey,
        { allowedIPs, dnsServers }
      );

      // Generate QR code
      const qrCodeData = await generateMobileOptimizedQRCode(configContent);

      // Create client configuration
      const clientConfig = new ClientConfiguration({
        sessionId: session.sessionId,
        userId,
        clientPublicKey: clientKeys.publicKey,
        clientPrivateKey: clientKeys.privateKey,
        clientIpAddress,
        serverPublicKey: serverKeys.publicKey,
        serverEndpoint,
        allowedIPs,
        dnsServers,
        configFileContent: configContent,
        qrCodeData,
        expiresAt: session.getIdleTimeoutAt()
      });

      // Upload config to storage
      const configBlobPath = `${session.sessionId}/client.conf`;
      await storageService.uploadClientConfig(session.sessionId, configContent);

      // Generate SAS token
      const configDownloadUrl = await storageService.generateSASToken(configBlobPath, 1);
      clientConfig.downloadToken = configDownloadUrl;

      // Store client config metadata
      await storageService.createEntity('clientconfigs', {
        partitionKey: session.sessionId,
        rowKey: clientConfig.configId,
        ...clientConfig.toFullJSON()
      });

      // Update infrastructure state
      state.incrementSession();
      await storageService.updateEntity('infrastructurestate', state.toTableEntity());

      // Update user session count
      user.incrementSessionCount();
      await storageService.updateEntity('usertenants', user.toTableEntity());

      // Log success
      await loggingService.logEvent(
        EVENT_TYPE.VPN_PROVISION_SUCCESS,
        {
          userId,
          sessionId: session.sessionId,
          message: 'VPN provisioned successfully',
          ipAddress: sourceIP
        },
        { durationMs: Date.now() - startTime },
        context
      );

      // Return response
      return createSuccessResponse({
        sessionId: session.sessionId,
        status: session.status,
        endpoint: {
          ipAddress: session.publicIpAddress,
          port: containerInfo.port
        },
        configDownloadUrl,
        qrCodeData,
        clientIpAddress,
        provisionedAt: session.createdAt,
        expiresAt: session.getIdleTimeoutAt()
      }, 200);

    } catch (error) {
      context.log.error('Provision error:', error);

      await loggingService.logError(error, {
        operation: 'provision',
        ipAddress: request.headers['x-forwarded-for']
      }, context);

      return createErrorResponse(500, 'Internal server error', {
        code: 'INTERNAL_ERROR'
      });
    }
  }
});
