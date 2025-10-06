const { app } = require('@azure/functions');
const { VPNSession, STATUS } = require('../shared/models/vpn-session');
const { InfrastructureState } = require('../shared/models/infrastructure-state');
const { EVENT_TYPE } = require('../shared/models/operational-event');
const { ACIService } = require('../shared/services/aci-service');
const { KeyVaultService } = require('../shared/services/keyvault-service');
const { StorageService } = require('../shared/services/storage-service');
const { LoggingService } = require('../shared/services/logging-service');
const { AuthMiddleware, createErrorResponse, createSuccessResponse } = require('../shared/utils/auth');
const { validateUUID } = require('../shared/utils/validation');

/**
 * POST /api/vpn/stop
 * Deprovision VPN container instance (completes within 1 minute per FR-002)
 */

app.http('deprovision', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'vpn/stop',
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

      const { userId, sourceIP } = authResult;

      // Parse request body
      const body = await request.json();
      const { sessionId, force = false } = body;

      // Validate sessionId
      if (!sessionId || !validateUUID(sessionId)) {
        return createErrorResponse(400, 'Invalid or missing sessionId');
      }

      // Load VPN session
      const sessionEntity = await storageService.getEntity('vpnsessions', sessionId, userId);

      if (!sessionEntity) {
        return createErrorResponse(404, 'Session not found');
      }

      const session = VPNSession.fromTableEntity(sessionEntity);

      // Verify user owns session
      if (session.userId !== userId) {
        return createErrorResponse(404, 'Session not found');
      }

      // Validate session is in stoppable state
      const stoppableStates = [STATUS.ACTIVE, STATUS.IDLE];
      if (!stoppableStates.includes(session.status) && !force) {
        return createErrorResponse(409, 'Session not in stoppable state', {
          details: {
            currentStatus: session.status,
            allowedStatuses: stoppableStates
          }
        });
      }

      // Already terminated
      if (session.status === STATUS.TERMINATED) {
        return createSuccessResponse({
          sessionId: session.sessionId,
          status: STATUS.TERMINATED,
          terminatedAt: session.terminatedAt,
          durationMinutes: Math.round(
            (new Date(session.terminatedAt) - new Date(session.createdAt)) / 60000
          )
        });
      }

      // Update session status to terminating
      const transition = session.transitionTo(STATUS.TERMINATING);
      if (!transition.success) {
        return createErrorResponse(409, transition.error);
      }

      await storageService.updateEntity('vpnsessions', session.toTableEntity());

      // Log stop start
      await loggingService.logEvent(
        EVENT_TYPE.VPN_STOP_START,
        {
          userId,
          sessionId: session.sessionId,
          message: 'VPN deprovisioning started',
          ipAddress: sourceIP
        },
        {},
        context
      );

      // Deprovision ACI
      let bytesTransferred = 0;
      try {
        if (session.containerInstanceId) {
          // Get container logs for metrics before deletion
          try {
            const logs = await aciService.getContainerLogs(session.containerInstanceId);
            // Parse bytes from logs if available (simplified)
            const bytesMatch = logs.match(/transferred:\s*(\d+)/);
            if (bytesMatch) {
              bytesTransferred = parseInt(bytesMatch[1], 10);
            }
          } catch (error) {
            context.log.warn('Could not retrieve container metrics:', error.message);
          }

          await aciService.deprovisionContainer(session.containerInstanceId);
        }
      } catch (error) {
        context.log.error('Deprovision error:', error);
        // Continue with cleanup even if deprovision fails
      }

      // Update session to terminated
      session.transitionTo(STATUS.TERMINATED);
      await storageService.updateEntity('vpnsessions', session.toTableEntity());

      // Mark client configuration as expired
      const configs = await storageService.queryEntities(
        'clientconfigs',
        `sessionId eq '${session.sessionId}'`
      );

      for (const config of configs) {
        config.expiresAt = new Date().toISOString();
        await storageService.updateEntity('clientconfigs', config);
      }

      // Delete config blob
      try {
        await storageService.deleteClientConfig(session.sessionId);
      } catch (error) {
        context.log.warn('Could not delete config blob:', error.message);
      }

      // Update infrastructure state
      const infraStateEntity = await storageService.getEntity('infrastructurestate', 'singleton', 'current');
      if (infraStateEntity) {
        const infraState = InfrastructureState.fromTableEntity(infraStateEntity);
        infraState.decrementSession();
        infraState.addBytesTransferred(bytesTransferred);
        await storageService.updateEntity('infrastructurestate', infraState.toTableEntity());
      }

      // Clean up Key Vault secrets
      try {
        await keyVaultService.cleanupSessionSecrets(session.sessionId);
      } catch (error) {
        context.log.warn('Could not cleanup Key Vault secrets:', error.message);
      }

      // Calculate duration
      const durationMs = new Date(session.terminatedAt) - new Date(session.createdAt);
      const durationMinutes = Math.round(durationMs / 60000);

      // Log success
      await loggingService.logEvent(
        EVENT_TYPE.VPN_STOP_SUCCESS,
        {
          userId,
          sessionId: session.sessionId,
          message: 'VPN deprovisioned successfully',
          ipAddress: sourceIP,
          metadata: { bytesTransferred }
        },
        { durationMs: Date.now() - startTime },
        context
      );

      // Return response
      return createSuccessResponse({
        sessionId: session.sessionId,
        status: STATUS.TERMINATED,
        terminatedAt: session.terminatedAt,
        durationMinutes,
        bytesTransferred
      });

    } catch (error) {
      context.log.error('Deprovision error:', error);

      await loggingService.logError(error, {
        operation: 'stop',
        ipAddress: request.headers['x-forwarded-for']
      }, context);

      return createErrorResponse(500, 'Internal server error', {
        code: 'INTERNAL_ERROR'
      });
    }
  }
});
