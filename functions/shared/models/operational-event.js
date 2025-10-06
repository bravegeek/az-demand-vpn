const { v4: uuidv4 } = require('uuid');

/**
 * OperationalEvent Model
 * Represents system events and audit trail
 * Storage: Azure Table Storage (partitioned by date for efficient querying/retention)
 */

const EVENT_TYPE = {
  // Provisioning events
  VPN_PROVISION_START: 'vpn.provision.start',
  VPN_PROVISION_SUCCESS: 'vpn.provision.success',
  VPN_PROVISION_FAILURE: 'vpn.provision.failure',

  // Stop events
  VPN_STOP_START: 'vpn.stop.start',
  VPN_STOP_SUCCESS: 'vpn.stop.success',
  VPN_STOP_FAILURE: 'vpn.stop.failure',

  // Connection events
  VPN_CONNECT_ATTEMPT: 'vpn.connect.attempt',
  VPN_CONNECT_SUCCESS: 'vpn.connect.success',
  VPN_CONNECT_FAILURE: 'vpn.connect.failure',
  VPN_DISCONNECT: 'vpn.disconnect',

  // Idle/shutdown events
  VPN_IDLE_DETECTED: 'vpn.idle.detected',
  VPN_AUTO_SHUTDOWN: 'vpn.auto.shutdown',

  // Auth events
  AUTH_SUCCESS: 'auth.success',
  AUTH_FAILURE: 'auth.failure',

  // Config events
  CONFIG_GENERATED: 'config.generated',
  CONFIG_DOWNLOADED: 'config.downloaded'
};

const EVENT_OUTCOME = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  WARNING: 'warning'
};

const MAX_MESSAGE_LENGTH = 2000;
const RETENTION_DAYS = 5;

class OperationalEvent {
  constructor(data = {}) {
    this.eventId = data.eventId || uuidv4();
    this.eventDate = data.eventDate || this.getDateString();
    this.timestamp = data.timestamp || new Date().toISOString();
    this.eventType = data.eventType || '';
    this.userId = data.userId || null;
    this.sessionId = data.sessionId || null;
    this.outcome = data.outcome || EVENT_OUTCOME.SUCCESS;
    this.message = data.message || '';
    this.metadata = data.metadata || null;
    this.ipAddress = data.ipAddress || null;
    this.durationMs = data.durationMs || null;
  }

  /**
   * Get date string in YYYY-MM-DD format for partitioning
   * @param {Date} date - Optional date (defaults to now)
   * @returns {string}
   */
  getDateString(date = new Date()) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Validate operational event data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required fields
    if (!this.eventId) errors.push('eventId is required');
    if (!this.eventDate) errors.push('eventDate is required');
    if (!this.timestamp) errors.push('timestamp is required');
    if (!this.eventType) errors.push('eventType is required');
    if (!this.outcome) errors.push('outcome is required');
    if (!this.message) errors.push('message is required');

    // Event type validation
    if (!Object.values(EVENT_TYPE).includes(this.eventType)) {
      errors.push(`eventType must be one of: ${Object.values(EVENT_TYPE).join(', ')}`);
    }

    // Outcome validation
    if (!Object.values(EVENT_OUTCOME).includes(this.outcome)) {
      errors.push(`outcome must be one of: ${Object.values(EVENT_OUTCOME).join(', ')}`);
    }

    // Date format validation (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(this.eventDate)) {
      errors.push('eventDate must be in YYYY-MM-DD format');
    }

    // Date consistency validation
    if (this.timestamp) {
      const timestampDate = this.getDateString(new Date(this.timestamp));
      if (this.eventDate !== timestampDate) {
        errors.push('eventDate must match date part of timestamp');
      }
    }

    // Message length validation
    if (this.message && this.message.length > MAX_MESSAGE_LENGTH) {
      errors.push(`message must be less than ${MAX_MESSAGE_LENGTH} characters`);
    }

    // Event type specific validation
    if (this.eventType.startsWith('vpn.') && !this.sessionId) {
      errors.push('sessionId should be present for VPN events');
    }

    if (this.eventType.startsWith('auth.') && !this.userId) {
      errors.push('userId should be present for auth events');
    }

    // Duration validation
    if (this.durationMs !== null && this.durationMs < 0) {
      errors.push('durationMs must be >= 0');
    }

    // Metadata validation (must be valid JSON if present)
    if (this.metadata && typeof this.metadata !== 'object') {
      errors.push('metadata must be a valid object');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if event is expired (older than retention period)
   * @returns {boolean}
   */
  isExpired() {
    const eventDate = new Date(this.eventDate);
    const now = new Date();
    const daysDiff = (now - eventDate) / (1000 * 60 * 60 * 24);

    return daysDiff > RETENTION_DAYS;
  }

  /**
   * Create event with standard fields
   * @param {string} eventType - Event type
   * @param {Object} options - Event options
   * @returns {OperationalEvent}
   */
  static create(eventType, options = {}) {
    return new OperationalEvent({
      eventType,
      userId: options.userId,
      sessionId: options.sessionId,
      outcome: options.outcome || EVENT_OUTCOME.SUCCESS,
      message: options.message || '',
      metadata: options.metadata,
      ipAddress: options.ipAddress,
      durationMs: options.durationMs
    });
  }

  /**
   * Create success event
   * @param {string} eventType - Event type
   * @param {string} message - Event message
   * @param {Object} options - Additional options
   * @returns {OperationalEvent}
   */
  static success(eventType, message, options = {}) {
    return OperationalEvent.create(eventType, {
      ...options,
      outcome: EVENT_OUTCOME.SUCCESS,
      message
    });
  }

  /**
   * Create failure event
   * @param {string} eventType - Event type
   * @param {string} message - Event message
   * @param {Object} options - Additional options
   * @returns {OperationalEvent}
   */
  static failure(eventType, message, options = {}) {
    return OperationalEvent.create(eventType, {
      ...options,
      outcome: EVENT_OUTCOME.FAILURE,
      message
    });
  }

  /**
   * Create warning event
   * @param {string} eventType - Event type
   * @param {string} message - Event message
   * @param {Object} options - Additional options
   * @returns {OperationalEvent}
   */
  static warning(eventType, message, options = {}) {
    return OperationalEvent.create(eventType, {
      ...options,
      outcome: EVENT_OUTCOME.WARNING,
      message
    });
  }

  /**
   * Convert to Azure Table Storage entity
   * @returns {Object}
   */
  toTableEntity() {
    return {
      partitionKey: this.eventDate,
      rowKey: this.timestamp + '_' + this.eventId, // Ensures uniqueness and sortability
      eventId: this.eventId,
      eventDate: this.eventDate,
      timestamp: this.timestamp,
      eventType: this.eventType,
      userId: this.userId,
      sessionId: this.sessionId,
      outcome: this.outcome,
      message: this.message,
      metadata: this.metadata ? JSON.stringify(this.metadata) : null,
      ipAddress: this.ipAddress,
      durationMs: this.durationMs
    };
  }

  /**
   * Create OperationalEvent from Azure Table Storage entity
   * @param {Object} entity
   * @returns {OperationalEvent}
   */
  static fromTableEntity(entity) {
    return new OperationalEvent({
      eventId: entity.eventId,
      eventDate: entity.eventDate,
      timestamp: entity.timestamp,
      eventType: entity.eventType,
      userId: entity.userId,
      sessionId: entity.sessionId,
      outcome: entity.outcome,
      message: entity.message,
      metadata: entity.metadata ? JSON.parse(entity.metadata) : null,
      ipAddress: entity.ipAddress,
      durationMs: entity.durationMs
    });
  }

  /**
   * Convert to JSON for API responses
   * @returns {Object}
   */
  toJSON() {
    return {
      eventId: this.eventId,
      timestamp: this.timestamp,
      eventType: this.eventType,
      outcome: this.outcome,
      message: this.message,
      metadata: this.metadata,
      durationMs: this.durationMs
    };
  }
}

/**
 * Query helper for filtering events by date range
 * @param {number} days - Number of days to query (default: 5)
 * @returns {string[]} Array of date strings
 */
function getDateRange(days = RETENTION_DAYS) {
  const dates = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }

  return dates;
}

/**
 * Build filter query for events
 * @param {Object} filters - Filter options
 * @returns {string} OData filter query
 */
function buildEventFilter(filters = {}) {
  const conditions = [];

  if (filters.userId) {
    conditions.push(`userId eq '${filters.userId}'`);
  }

  if (filters.sessionId) {
    conditions.push(`sessionId eq '${filters.sessionId}'`);
  }

  if (filters.eventType) {
    conditions.push(`eventType eq '${filters.eventType}'`);
  }

  if (filters.outcome) {
    conditions.push(`outcome eq '${filters.outcome}'`);
  }

  if (filters.startDate) {
    conditions.push(`eventDate ge '${filters.startDate}'`);
  }

  if (filters.endDate) {
    conditions.push(`eventDate le '${filters.endDate}'`);
  }

  return conditions.join(' and ');
}

module.exports = {
  OperationalEvent,
  EVENT_TYPE,
  EVENT_OUTCOME,
  MAX_MESSAGE_LENGTH,
  RETENTION_DAYS,
  getDateRange,
  buildEventFilter
};
