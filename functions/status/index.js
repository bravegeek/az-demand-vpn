const { app } = require('@azure/functions');
const { VPNSession } = require('../shared/models/vpn-session');
const { ACIService } = require('../shared/services/aci-service');
const { KeyVaultService } = require('../shared/services/keyvault-service');
const { StorageService } = require('../shared/services/storage-service');
const { LoggingService } = require('../shared/services/logging-service');
const { AuthMiddleware, createErrorResponse, createSuccessResponse } = require('../shared/utils/auth');
const { validateUUID } = require('../shared/utils/validation');

/**
 * GET /api/vpn/status/{sessionId}
 * Retrieve current status of VPN session (responds within 5 seconds per FR-024)
 */

app.http('status', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vpn/status/{sessionId}',
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

      const { userId } = authResult;

      // Get sessionId from route parameter
      const sessionId = request.params.sessionId;

      // Validate sessionId
      if (!sessionId || !validateUUID(sessionId)) {
        return createErrorResponse(400, 'Invalid session ID format');
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

      // Build base response
      const response = {
        sessionId: session.sessionId,
        userId: session.userId,
        status: session.status,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        idleTimeoutAt: session.getIdleTimeoutAt(),
        terminatedAt: session.terminatedAt,
        errorMessage: session.errorMessage
      };

      // Add endpoint info if available
      if (session.publicIpAddress) {
        response.endpoint = {
          ipAddress: session.publicIpAddress,
          port: session.vpnPort
        };
      }

      // Get container health and metrics if active
      if (session.status === 'active' && session.containerInstanceId) {
        try {
          // Set timeout for container status query (must complete within 5 seconds)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Container status timeout')), 4000);
          });

          const containerStatusPromise = aciService.getContainerStatus(session.containerInstanceId);

          const containerStatus = await Promise.race([containerStatusPromise, timeoutPromise]);

          // Determine health based on container state
          let health = 'unknown';
          if (containerStatus.state === 'Running') {
            health = 'healthy';
          } else if (containerStatus.state === 'NotFound' || containerStatus.state === 'Terminated') {
            health = 'unhealthy';
          } else {
            health = 'degraded';
          }

          response.health = health;

          // Get container metrics (simplified - in production would query WireGuard stats)
          response.metrics = {
            connectedClients: health === 'healthy' ? 1 : 0,
            bytesReceived: 0, // Would be parsed from container logs
            bytesSent: 0,
            lastActivity: session.lastActivityAt,
            uptimeMinutes: Math.round((Date.now() - new Date(session.createdAt)) / 60000)
          };

          // Update activity timestamp (debounced via activity-tracker utility)
          session.updateActivity();
          await storageService.updateEntity('vpnsessions', session.toTableEntity());

        } catch (error) {
          context.log.warn('Could not retrieve container status:', error.message);
          response.health = 'unknown';
        }
      }

      // Return response
      return createSuccessResponse(response);

    } catch (error) {
      context.log.error('Status query error:', error);

      return createErrorResponse(500, 'Internal server error', {
        code: 'INTERNAL_ERROR'
      });
    }
  }
});
