const { app } = require('@azure/functions');
const { VPNSession } = require('../shared/models/vpn-session');
const { KeyVaultService } = require('../shared/services/keyvault-service');
const { StorageService } = require('../shared/services/storage-service');
const { LoggingService } = require('../shared/services/logging-service');
const { AuthMiddleware, createErrorResponse, createSuccessResponse } = require('../shared/utils/auth');

/**
 * GET /api/vpn/status
 * Get all VPN sessions for authenticated user (responds within 5 seconds per FR-024)
 */

app.http('statusList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vpn/status',
  handler: async (request, context) => {
    const startTime = Date.now();

    // Initialize services
    const storageService = new StorageService();
    const keyVaultService = new KeyVaultService();
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

      // Parse query parameters
      const statusFilter = request.query.get('status');

      // Build filter query
      let filterQuery = `userId eq '${userId}'`;

      if (statusFilter) {
        const validStatuses = ['provisioning', 'active', 'idle', 'terminating', 'terminated'];
        if (!validStatuses.includes(statusFilter)) {
          return createErrorResponse(400, `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`);
        }
        filterQuery += ` and status eq '${statusFilter}'`;
      }

      // Query sessions
      const sessionEntities = await storageService.queryEntities('vpnsessions', filterQuery);

      // Convert to response format
      const sessions = sessionEntities.map(entity => {
        const session = VPNSession.fromTableEntity(entity);
        return {
          sessionId: session.sessionId,
          status: session.status,
          createdAt: session.createdAt,
          endpoint: session.publicIpAddress ? {
            ipAddress: session.publicIpAddress,
            port: session.vpnPort
          } : null,
          terminatedAt: session.terminatedAt
        };
      });

      // Calculate counts
      const totalCount = sessions.length;
      const activeCount = sessions.filter(s => s.status === 'active' || s.status === 'provisioning').length;

      // Return response
      return createSuccessResponse({
        sessions,
        totalCount,
        activeCount
      });

    } catch (error) {
      context.log.error('Status list query error:', error);

      return createErrorResponse(500, 'Internal server error', {
        code: 'INTERNAL_ERROR'
      });
    }
  }
});
