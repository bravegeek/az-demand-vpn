const { v4: uuidv4 } = require('uuid');

/**
 * VPNSession Model
 * Represents an active VPN provisioning instance
 * Storage: Azure Table Storage (sessionId as PartitionKey, userId as RowKey)
 */

const STATUS = {
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  IDLE: 'idle',
  TERMINATING: 'terminating',
  TERMINATED: 'terminated'
};

const DEFAULT_VPN_PORT = 51820;
const DEFAULT_IDLE_TIMEOUT = 10;
const MAX_PROVISION_ATTEMPTS = 3;

class VPNSession {
  constructor(data = {}) {
    this.sessionId = data.sessionId || uuidv4();
    this.userId = data.userId || '';
    this.status = data.status || STATUS.PROVISIONING;
    this.containerInstanceId = data.containerInstanceId || null;
    this.publicIpAddress = data.publicIpAddress || null;
    this.vpnPort = data.vpnPort || DEFAULT_VPN_PORT;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.lastActivityAt = data.lastActivityAt || new Date().toISOString();
    this.terminatedAt = data.terminatedAt || null;
    this.idleTimeoutMinutes = data.idleTimeoutMinutes || DEFAULT_IDLE_TIMEOUT;
    this.provisionAttempts = data.provisionAttempts || 0;
    this.errorMessage = data.errorMessage || null;
  }

  /**
   * Validate VPN session data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required fields
    if (!this.sessionId) errors.push('sessionId is required');
    if (!this.userId) errors.push('userId is required');
    if (!this.status) errors.push('status is required');

    // Status validation
    if (!Object.values(STATUS).includes(this.status)) {
      errors.push(`status must be one of: ${Object.values(STATUS).join(', ')}`);
    }

    // Port validation
    if (this.vpnPort < 1024 || this.vpnPort > 65535) {
      errors.push('vpnPort must be between 1024 and 65535');
    }

    // Idle timeout validation
    if (this.idleTimeoutMinutes < 1 || this.idleTimeoutMinutes > 1440) {
      errors.push('idleTimeoutMinutes must be between 1 and 1440');
    }

    // Provision attempts validation
    if (this.provisionAttempts < 0 || this.provisionAttempts > MAX_PROVISION_ATTEMPTS) {
      errors.push(`provisionAttempts must be between 0 and ${MAX_PROVISION_ATTEMPTS}`);
    }

    // Timestamp validation
    if (this.lastActivityAt && this.createdAt && new Date(this.lastActivityAt) < new Date(this.createdAt)) {
      errors.push('lastActivityAt must be >= createdAt');
    }

    // Terminated state validation
    if (this.status === STATUS.TERMINATED && !this.terminatedAt) {
      errors.push('terminatedAt must be set when status is terminated');
    }

    // Error message length
    if (this.errorMessage && this.errorMessage.length > 1000) {
      errors.push('errorMessage must be less than 1000 characters');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Transition to a new status
   * @param {string} newStatus - The new status to transition to
   * @returns {Object} { success: boolean, error?: string }
   */
  transitionTo(newStatus) {
    const validTransitions = {
      [STATUS.PROVISIONING]: [STATUS.ACTIVE, STATUS.TERMINATED],
      [STATUS.ACTIVE]: [STATUS.IDLE, STATUS.TERMINATING],
      [STATUS.IDLE]: [STATUS.TERMINATING],
      [STATUS.TERMINATING]: [STATUS.TERMINATED],
      [STATUS.TERMINATED]: [] // No transitions from terminated
    };

    if (!validTransitions[this.status]) {
      return { success: false, error: `Invalid current status: ${this.status}` };
    }

    if (!validTransitions[this.status].includes(newStatus)) {
      return {
        success: false,
        error: `Cannot transition from ${this.status} to ${newStatus}. Valid transitions: ${validTransitions[this.status].join(', ') || 'none'}`
      };
    }

    this.status = newStatus;

    // Set terminatedAt when transitioning to terminated
    if (newStatus === STATUS.TERMINATED && !this.terminatedAt) {
      this.terminatedAt = new Date().toISOString();
    }

    return { success: true };
  }

  /**
   * Update last activity timestamp
   */
  updateActivity() {
    this.lastActivityAt = new Date().toISOString();
  }

  /**
   * Check if session is idle
   * @returns {boolean}
   */
  isIdle() {
    if (this.status !== STATUS.ACTIVE) return false;

    const lastActivity = new Date(this.lastActivityAt);
    const now = new Date();
    const idleMinutes = (now - lastActivity) / (1000 * 60);

    return idleMinutes >= this.idleTimeoutMinutes;
  }

  /**
   * Calculate idle timeout timestamp
   * @returns {string|null} ISO timestamp when idle timeout occurs
   */
  getIdleTimeoutAt() {
    if (!this.lastActivityAt) return null;

    const lastActivity = new Date(this.lastActivityAt);
    const timeoutAt = new Date(lastActivity.getTime() + this.idleTimeoutMinutes * 60 * 1000);

    return timeoutAt.toISOString();
  }

  /**
   * Convert to Azure Table Storage entity
   * @returns {Object} Table Storage entity
   */
  toTableEntity() {
    return {
      partitionKey: this.sessionId,
      rowKey: this.userId,
      sessionId: this.sessionId,
      userId: this.userId,
      status: this.status,
      containerInstanceId: this.containerInstanceId,
      publicIpAddress: this.publicIpAddress,
      vpnPort: this.vpnPort,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      terminatedAt: this.terminatedAt,
      idleTimeoutMinutes: this.idleTimeoutMinutes,
      provisionAttempts: this.provisionAttempts,
      errorMessage: this.errorMessage
    };
  }

  /**
   * Create VPNSession from Azure Table Storage entity
   * @param {Object} entity - Table Storage entity
   * @returns {VPNSession}
   */
  static fromTableEntity(entity) {
    return new VPNSession({
      sessionId: entity.sessionId,
      userId: entity.userId,
      status: entity.status,
      containerInstanceId: entity.containerInstanceId,
      publicIpAddress: entity.publicIpAddress,
      vpnPort: entity.vpnPort,
      createdAt: entity.createdAt,
      lastActivityAt: entity.lastActivityAt,
      terminatedAt: entity.terminatedAt,
      idleTimeoutMinutes: entity.idleTimeoutMinutes,
      provisionAttempts: entity.provisionAttempts,
      errorMessage: entity.errorMessage
    });
  }

  /**
   * Convert to JSON for API responses
   * @returns {Object}
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      status: this.status,
      endpoint: this.publicIpAddress ? {
        ipAddress: this.publicIpAddress,
        port: this.vpnPort
      } : null,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      terminatedAt: this.terminatedAt,
      idleTimeoutAt: this.getIdleTimeoutAt(),
      errorMessage: this.errorMessage
    };
  }
}

module.exports = {
  VPNSession,
  STATUS,
  DEFAULT_VPN_PORT,
  DEFAULT_IDLE_TIMEOUT,
  MAX_PROVISION_ATTEMPTS
};
