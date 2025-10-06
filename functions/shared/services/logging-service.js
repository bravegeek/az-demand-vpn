const { OperationalEvent, EVENT_TYPE, EVENT_OUTCOME, RETENTION_DAYS } = require('../models/operational-event');

/**
 * Application Insights Logging Service
 * Wraps Application Insights SDK and integrates with OperationalEvent model
 *
 * Note: In Azure Functions, Application Insights is automatically available
 * via the context.log methods. This service provides structured logging
 * and audit trail integration.
 */

class LoggingService {
  constructor(config = {}) {
    this.storageService = config.storageService; // Inject storage service for audit trail
    this.appInsightsClient = config.appInsightsClient; // Optional Application Insights client
    this.tableName = config.tableName || 'operationalevents';
  }

  /**
   * Log event to Application Insights and create audit trail
   * @param {string} eventType - Event type from EVENT_TYPE
   * @param {Object} properties - Event properties
   * @param {Object} metrics - Event metrics
   * @param {Object} context - Azure Functions context (optional)
   * @returns {Promise<void>}
   */
  async logEvent(eventType, properties = {}, metrics = {}, context = null) {
    // Create operational event
    const event = OperationalEvent.create(eventType, {
      userId: properties.userId,
      sessionId: properties.sessionId,
      outcome: properties.outcome || EVENT_OUTCOME.SUCCESS,
      message: properties.message || '',
      metadata: properties.metadata,
      ipAddress: properties.ipAddress,
      durationMs: metrics.durationMs
    });

    // Log to Azure Functions context if available
    if (context) {
      context.log.info(`[${eventType}] ${event.message}`, {
        ...properties,
        ...metrics
      });

      // Track custom event in Application Insights
      if (context.bindings?.appInsights) {
        context.bindings.appInsights.trackEvent({
          name: eventType,
          properties: {
            ...properties,
            eventId: event.eventId,
            timestamp: event.timestamp
          },
          measurements: metrics
        });
      }
    }

    // Log to Application Insights client if available
    if (this.appInsightsClient) {
      this.appInsightsClient.trackEvent({
        name: eventType,
        properties: {
          ...properties,
          eventId: event.eventId,
          timestamp: event.timestamp
        },
        measurements: metrics
      });
    }

    // Store in operational events table for audit trail
    if (this.storageService) {
      try {
        await this.storageService.createEntity(
          this.tableName,
          event.toTableEntity()
        );
      } catch (error) {
        // Log error but don't fail the operation
        if (context) {
          context.log.error('Failed to store operational event:', error.message);
        } else {
          console.error('Failed to store operational event:', error.message);
        }
      }
    }
  }

  /**
   * Log error
   * @param {Error} error - Error object
   * @param {Object} contextInfo - Additional context information
   * @param {Object} functionContext - Azure Functions context (optional)
   * @returns {Promise<void>}
   */
  async logError(error, contextInfo = {}, functionContext = null) {
    const properties = {
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode: error.code,
      ...contextInfo
    };

    // Log to Azure Functions context
    if (functionContext) {
      functionContext.log.error(error.message, properties);

      // Track exception in Application Insights
      if (functionContext.bindings?.appInsights) {
        functionContext.bindings.appInsights.trackException({
          exception: error,
          properties
        });
      }
    }

    // Log to Application Insights client
    if (this.appInsightsClient) {
      this.appInsightsClient.trackException({
        exception: error,
        properties
      });
    }

    // Create failure event in audit trail
    const eventType = this.getErrorEventType(contextInfo.operation);
    await this.logEvent(
      eventType,
      {
        userId: contextInfo.userId,
        sessionId: contextInfo.sessionId,
        outcome: EVENT_OUTCOME.FAILURE,
        message: error.message,
        metadata: { errorCode: error.code, stack: error.stack },
        ipAddress: contextInfo.ipAddress
      },
      {},
      functionContext
    );
  }

  /**
   * Log metric
   * @param {string} metricName - Metric name
   * @param {number} value - Metric value
   * @param {Object} properties - Additional properties
   * @param {Object} context - Azure Functions context (optional)
   */
  logMetric(metricName, value, properties = {}, context = null) {
    if (context) {
      context.log.metric(metricName, value, properties);
    }

    if (this.appInsightsClient) {
      this.appInsightsClient.trackMetric({
        name: metricName,
        value,
        properties
      });
    }
  }

  /**
   * Track dependency call (Azure service calls)
   * @param {string} dependencyName - Name of dependency
   * @param {number} duration - Duration in milliseconds
   * @param {boolean} success - Whether call succeeded
   * @param {Object} properties - Additional properties
   * @param {Object} context - Azure Functions context (optional)
   */
  trackDependency(dependencyName, duration, success, properties = {}, context = null) {
    const dependencyData = {
      name: dependencyName,
      duration,
      success,
      properties: {
        ...properties,
        timestamp: new Date().toISOString()
      }
    };

    if (context) {
      context.log.info(`[Dependency] ${dependencyName}: ${duration}ms (${success ? 'success' : 'failed'})`, dependencyData);
    }

    if (this.appInsightsClient) {
      this.appInsightsClient.trackDependency({
        target: dependencyName,
        name: dependencyName,
        data: JSON.stringify(properties),
        duration,
        success,
        resultCode: success ? 200 : 500
      });
    }
  }

  /**
   * Log authentication event (success or failure)
   * @param {boolean} success - Whether authentication succeeded
   * @param {Object} details - Authentication details
   * @param {Object} context - Azure Functions context (optional)
   * @returns {Promise<void>}
   */
  async logAuthEvent(success, details = {}, context = null) {
    const eventType = success ? EVENT_TYPE.AUTH_SUCCESS : EVENT_TYPE.AUTH_FAILURE;

    await this.logEvent(
      eventType,
      {
        userId: details.userId,
        outcome: success ? EVENT_OUTCOME.SUCCESS : EVENT_OUTCOME.FAILURE,
        message: success ? 'Authentication successful' : `Authentication failed: ${details.reason || 'Unknown'}`,
        metadata: {
          authMethod: details.authMethod,
          reason: details.reason
        },
        ipAddress: details.ipAddress
      },
      {},
      context
    );
  }

  /**
   * Query operational events (for audit trail)
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Array of operational events
   */
  async queryEvents(filters = {}) {
    if (!this.storageService) {
      throw new Error('StorageService required for querying events');
    }

    // Build filter query
    const filterParts = [];

    if (filters.userId) {
      filterParts.push(`userId eq '${filters.userId}'`);
    }

    if (filters.sessionId) {
      filterParts.push(`sessionId eq '${filters.sessionId}'`);
    }

    if (filters.eventType) {
      filterParts.push(`eventType eq '${filters.eventType}'`);
    }

    if (filters.outcome) {
      filterParts.push(`outcome eq '${filters.outcome}'`);
    }

    if (filters.startDate) {
      filterParts.push(`eventDate ge '${filters.startDate}'`);
    }

    if (filters.endDate) {
      filterParts.push(`eventDate le '${filters.endDate}'`);
    }

    const filterQuery = filterParts.join(' and ');

    const entities = await this.storageService.queryEntities(
      this.tableName,
      filterQuery
    );

    return entities.map(entity => OperationalEvent.fromTableEntity(entity));
  }

  /**
   * Clean up expired events (older than retention period)
   * @returns {Promise<number>} Number of events deleted
   */
  async cleanupExpiredEvents() {
    if (!this.storageService) {
      throw new Error('StorageService required for cleanup');
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffDateString = cutoffDate.toISOString().split('T')[0];

    // Get all partitions (dates) to check
    const allEvents = await this.storageService.queryEntities(
      this.tableName,
      `eventDate lt '${cutoffDateString}'`
    );

    let deletedCount = 0;

    for (const event of allEvents) {
      await this.storageService.deleteEntity(
        this.tableName,
        event.partitionKey,
        event.rowKey
      );
      deletedCount++;
    }

    return deletedCount;
  }

  /**
   * Get error event type based on operation
   * @param {string} operation - Operation name
   * @returns {string} Event type
   */
  getErrorEventType(operation) {
    const errorEventMap = {
      'provision': EVENT_TYPE.VPN_PROVISION_FAILURE,
      'stop': EVENT_TYPE.VPN_STOP_FAILURE,
      'connect': EVENT_TYPE.VPN_CONNECT_FAILURE
    };

    return errorEventMap[operation] || EVENT_TYPE.VPN_PROVISION_FAILURE;
  }

  /**
   * Create a timing wrapper for logging operation duration
   * @param {string} operationName - Operation name
   * @param {Function} operation - Async operation to time
   * @param {Object} context - Azure Functions context (optional)
   * @returns {Promise<any>} Operation result
   */
  async timeOperation(operationName, operation, context = null) {
    const startTime = Date.now();

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      this.trackDependency(operationName, duration, true, {}, context);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.trackDependency(operationName, duration, false, {
        error: error.message
      }, context);

      throw error;
    }
  }
}

module.exports = {
  LoggingService
};
