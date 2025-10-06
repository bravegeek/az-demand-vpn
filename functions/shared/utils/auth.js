const { UserTenant } = require('../models/user-tenant');

/**
 * Authentication Middleware
 * Implements API key validation, user extraction, IP restriction enforcement
 */

class AuthMiddleware {
  constructor(config = {}) {
    this.keyVaultService = config.keyVaultService;
    this.storageService = config.storageService;
    this.loggingService = config.loggingService;
    this.userTableName = config.userTableName || 'usertenants';
  }

  /**
   * Authenticate request and extract user information
   * @param {Object} request - HTTP request object
   * @param {Object} context - Azure Functions context
   * @returns {Promise<Object>} { authenticated: boolean, user?: UserTenant, error?: string, statusCode?: number }
   */
  async authenticate(request, context = null) {
    try {
      // Extract API key from header
      const apiKey = this.extractApiKey(request);

      if (!apiKey) {
        await this.logAuthFailure('Missing API key', null, request, context);
        return {
          authenticated: false,
          error: 'Missing authentication header',
          statusCode: 401
        };
      }

      // Find user by API key
      const user = await this.findUserByApiKey(apiKey);

      if (!user) {
        await this.logAuthFailure('Invalid API key', null, request, context);
        return {
          authenticated: false,
          error: 'Invalid API key',
          statusCode: 401
        };
      }

      // Check if user is active
      if (!user.isActive) {
        await this.logAuthFailure('User account inactive', user.userId, request, context);
        return {
          authenticated: false,
          error: 'User account is not active',
          statusCode: 401
        };
      }

      // Check source IP restriction (FR-014)
      const sourceIP = this.extractSourceIP(request);
      if (!user.isIPAllowed(sourceIP)) {
        await this.logAuthFailure(`IP not allowed: ${sourceIP}`, user.userId, request, context);
        return {
          authenticated: false,
          error: 'Access denied from this IP address',
          statusCode: 403 // Forbidden (valid auth but IP restriction)
        };
      }

      // Authentication successful
      await this.logAuthSuccess(user.userId, sourceIP, context);

      return {
        authenticated: true,
        user,
        userId: user.userId,
        sourceIP
      };
    } catch (error) {
      if (context) {
        context.log.error('Authentication error:', error);
      }

      return {
        authenticated: false,
        error: 'Authentication service error',
        statusCode: 500
      };
    }
  }

  /**
   * Extract API key from request headers
   * @param {Object} request - HTTP request
   * @returns {string|null} API key
   */
  extractApiKey(request) {
    // Check X-API-Key header (case-insensitive)
    const headers = request.headers || {};

    return headers['x-api-key'] ||
           headers['X-API-Key'] ||
           headers['X-Api-Key'] ||
           null;
  }

  /**
   * Extract source IP address from request
   * @param {Object} request - HTTP request
   * @returns {string} Source IP address
   */
  extractSourceIP(request) {
    const headers = request.headers || {};

    // Check common headers for client IP (behind proxy/load balancer)
    return headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           headers['x-real-ip'] ||
           headers['x-client-ip'] ||
           request.connection?.remoteAddress ||
           request.socket?.remoteAddress ||
           '0.0.0.0';
  }

  /**
   * Find user by API key
   * @param {string} apiKey - Plain text API key
   * @returns {Promise<UserTenant|null>}
   */
  async findUserByApiKey(apiKey) {
    if (!this.storageService) {
      throw new Error('StorageService required for user lookup');
    }

    // Hash the provided API key
    const apiKeyHash = UserTenant.hashApiKey(apiKey);

    // Query all users (in production, consider caching or indexing)
    const users = await this.storageService.queryEntities(
      this.userTableName,
      `authMethod eq 'apikey' and isActive eq true`
    );

    // Find matching user
    for (const userEntity of users) {
      const user = UserTenant.fromTableEntity(userEntity);

      if (user.verifyApiKey(apiKey)) {
        return user;
      }
    }

    return null;
  }

  /**
   * Log authentication success
   * @param {string} userId - User ID
   * @param {string} ipAddress - Source IP
   * @param {Object} context - Azure Functions context
   */
  async logAuthSuccess(userId, ipAddress, context) {
    if (this.loggingService) {
      await this.loggingService.logAuthEvent(
        true,
        {
          userId,
          ipAddress,
          authMethod: 'apikey'
        },
        context
      );
    }
  }

  /**
   * Log authentication failure
   * @param {string} reason - Failure reason
   * @param {string} userId - User ID (if known)
   * @param {Object} request - HTTP request
   * @param {Object} context - Azure Functions context
   */
  async logAuthFailure(reason, userId, request, context) {
    if (this.loggingService) {
      await this.loggingService.logAuthEvent(
        false,
        {
          userId,
          ipAddress: this.extractSourceIP(request),
          authMethod: 'apikey',
          reason
        },
        context
      );
    }
  }

  /**
   * Middleware wrapper for Azure Functions
   * @param {Function} handler - Function handler
   * @returns {Function} Wrapped handler
   */
  middleware(handler) {
    return async (context, req) => {
      // Authenticate request
      const authResult = await this.authenticate(req, context);

      if (!authResult.authenticated) {
        context.res = {
          status: authResult.statusCode || 401,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            error: authResult.error || 'Unauthorized'
          }
        };
        return;
      }

      // Attach user to context
      context.user = authResult.user;
      context.userId = authResult.userId;
      context.sourceIP = authResult.sourceIP;

      // Call handler
      return await handler(context, req);
    };
  }
}

/**
 * Create HTTP error response
 * @param {number} statusCode - HTTP status code
 * @param {string} error - Error message
 * @param {Object} details - Additional error details
 * @returns {Object} HTTP response
 */
function createErrorResponse(statusCode, error, details = {}) {
  return {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      error,
      code: details.code,
      details: details.details
    }
  };
}

/**
 * Create HTTP success response
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} HTTP response
 */
function createSuccessResponse(data, statusCode = 200) {
  return {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: data
  };
}

module.exports = {
  AuthMiddleware,
  createErrorResponse,
  createSuccessResponse
};
