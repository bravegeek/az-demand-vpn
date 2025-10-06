/**
 * InfrastructureState Model
 * Represents current cloud resource allocation (singleton pattern)
 * Storage: Azure Table Storage (single row, frequently updated)
 */

const SYSTEM_MAX_CONTAINERS = 3;
const SYSTEM_MAX_SESSIONS = 3;
const STATE_ID = 'current'; // Singleton identifier

class InfrastructureState {
  constructor(data = {}) {
    this.stateId = STATE_ID; // Always 'current'
    this.activeContainerInstances = data.activeContainerInstances || 0;
    this.activeSessions = data.activeSessions || 0;
    this.totalProvisioningAttempts = data.totalProvisioningAttempts || 0;
    this.totalProvisioningFailures = data.totalProvisioningFailures || 0;
    this.totalBytesTransferred = data.totalBytesTransferred || 0;
    this.currentCostEstimate = data.currentCostEstimate || 0;
    this.lastUpdated = data.lastUpdated || new Date().toISOString();
    this.quotaLimitReached = data.quotaLimitReached || false;
  }

  /**
   * Validate infrastructure state data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required fields
    if (this.stateId !== STATE_ID) {
      errors.push(`stateId must be '${STATE_ID}' (singleton pattern)`);
    }

    // Container count validation
    if (this.activeContainerInstances < 0 || this.activeContainerInstances > SYSTEM_MAX_CONTAINERS) {
      errors.push(`activeContainerInstances must be between 0 and ${SYSTEM_MAX_CONTAINERS}`);
    }

    // Session count validation
    if (this.activeSessions < 0 || this.activeSessions > SYSTEM_MAX_SESSIONS) {
      errors.push(`activeSessions must be between 0 and ${SYSTEM_MAX_SESSIONS}`);
    }

    // Sessions can't exceed containers
    if (this.activeSessions > this.activeContainerInstances) {
      errors.push('activeSessions cannot exceed activeContainerInstances');
    }

    // Counter validations
    if (this.totalProvisioningAttempts < 0) {
      errors.push('totalProvisioningAttempts must be >= 0');
    }

    if (this.totalProvisioningFailures < 0) {
      errors.push('totalProvisioningFailures must be >= 0');
    }

    if (this.totalBytesTransferred < 0) {
      errors.push('totalBytesTransferred must be >= 0');
    }

    if (this.currentCostEstimate < 0) {
      errors.push('currentCostEstimate must be >= 0');
    }

    // Failures can't exceed attempts
    if (this.totalProvisioningFailures > this.totalProvisioningAttempts) {
      errors.push('totalProvisioningFailures cannot exceed totalProvisioningAttempts');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if system is at capacity
   * @returns {boolean}
   */
  isAtCapacity() {
    return this.activeContainerInstances >= SYSTEM_MAX_CONTAINERS ||
           this.activeSessions >= SYSTEM_MAX_SESSIONS;
  }

  /**
   * Check if new session can be created
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  canProvisionSession() {
    if (this.activeContainerInstances >= SYSTEM_MAX_CONTAINERS) {
      return {
        allowed: false,
        reason: `Maximum container instances reached (${SYSTEM_MAX_CONTAINERS}/${SYSTEM_MAX_CONTAINERS})`
      };
    }

    if (this.activeSessions >= SYSTEM_MAX_SESSIONS) {
      return {
        allowed: false,
        reason: `Maximum concurrent sessions reached (${SYSTEM_MAX_SESSIONS}/${SYSTEM_MAX_SESSIONS})`
      };
    }

    return { allowed: true };
  }

  /**
   * Increment session and container counters
   * @returns {InfrastructureState} Updated state
   */
  incrementSession() {
    this.activeSessions += 1;
    this.activeContainerInstances += 1;
    this.totalProvisioningAttempts += 1;
    this.quotaLimitReached = this.isAtCapacity();
    this.touch();
    return this;
  }

  /**
   * Decrement session and container counters
   * @returns {InfrastructureState} Updated state
   */
  decrementSession() {
    if (this.activeSessions > 0) {
      this.activeSessions -= 1;
    }
    if (this.activeContainerInstances > 0) {
      this.activeContainerInstances -= 1;
    }
    this.quotaLimitReached = this.isAtCapacity();
    this.touch();
    return this;
  }

  /**
   * Record provisioning failure
   * @returns {InfrastructureState} Updated state
   */
  recordProvisioningFailure() {
    this.totalProvisioningFailures += 1;
    this.touch();
    return this;
  }

  /**
   * Add bytes transferred
   * @param {number} bytes - Bytes to add
   * @returns {InfrastructureState} Updated state
   */
  addBytesTransferred(bytes) {
    this.totalBytesTransferred += bytes;
    this.touch();
    return this;
  }

  /**
   * Update cost estimate
   * @param {number} cost - New cost estimate
   * @returns {InfrastructureState} Updated state
   */
  updateCostEstimate(cost) {
    this.currentCostEstimate = cost;
    this.touch();
    return this;
  }

  /**
   * Update last modified timestamp
   */
  touch() {
    this.lastUpdated = new Date().toISOString();
  }

  /**
   * Get success rate for provisioning
   * @returns {number} Success rate as percentage (0-100)
   */
  getSuccessRate() {
    if (this.totalProvisioningAttempts === 0) return 100;

    const successes = this.totalProvisioningAttempts - this.totalProvisioningFailures;
    return (successes / this.totalProvisioningAttempts) * 100;
  }

  /**
   * Get current utilization percentage
   * @returns {number} Utilization as percentage (0-100)
   */
  getUtilization() {
    return (this.activeSessions / SYSTEM_MAX_SESSIONS) * 100;
  }

  /**
   * Convert to Azure Table Storage entity
   * @returns {Object}
   */
  toTableEntity() {
    return {
      partitionKey: 'singleton',
      rowKey: STATE_ID,
      stateId: this.stateId,
      activeContainerInstances: this.activeContainerInstances,
      activeSessions: this.activeSessions,
      totalProvisioningAttempts: this.totalProvisioningAttempts,
      totalProvisioningFailures: this.totalProvisioningFailures,
      totalBytesTransferred: this.totalBytesTransferred,
      currentCostEstimate: this.currentCostEstimate,
      lastUpdated: this.lastUpdated,
      quotaLimitReached: this.quotaLimitReached
    };
  }

  /**
   * Create InfrastructureState from Azure Table Storage entity
   * @param {Object} entity
   * @returns {InfrastructureState}
   */
  static fromTableEntity(entity) {
    return new InfrastructureState({
      activeContainerInstances: entity.activeContainerInstances,
      activeSessions: entity.activeSessions,
      totalProvisioningAttempts: entity.totalProvisioningAttempts,
      totalProvisioningFailures: entity.totalProvisioningFailures,
      totalBytesTransferred: entity.totalBytesTransferred,
      currentCostEstimate: entity.currentCostEstimate,
      lastUpdated: entity.lastUpdated,
      quotaLimitReached: entity.quotaLimitReached
    });
  }

  /**
   * Create initial state (for first-time setup)
   * @returns {InfrastructureState}
   */
  static createInitial() {
    return new InfrastructureState({
      activeContainerInstances: 0,
      activeSessions: 0,
      totalProvisioningAttempts: 0,
      totalProvisioningFailures: 0,
      totalBytesTransferred: 0,
      currentCostEstimate: 0,
      quotaLimitReached: false
    });
  }

  /**
   * Convert to JSON for API responses
   * @returns {Object}
   */
  toJSON() {
    return {
      activeContainerInstances: this.activeContainerInstances,
      activeSessions: this.activeSessions,
      maxCapacity: SYSTEM_MAX_SESSIONS,
      quotaLimitReached: this.quotaLimitReached,
      utilization: this.getUtilization(),
      successRate: this.getSuccessRate(),
      totalProvisioningAttempts: this.totalProvisioningAttempts,
      totalProvisioningFailures: this.totalProvisioningFailures,
      totalBytesTransferred: this.totalBytesTransferred,
      currentCostEstimate: this.currentCostEstimate,
      lastUpdated: this.lastUpdated
    };
  }

  /**
   * Convert to monitoring metrics
   * @returns {Object}
   */
  toMetrics() {
    return {
      'infrastructure.containers.active': this.activeContainerInstances,
      'infrastructure.sessions.active': this.activeSessions,
      'infrastructure.utilization.percent': this.getUtilization(),
      'infrastructure.provisioning.success_rate': this.getSuccessRate(),
      'infrastructure.provisioning.total_attempts': this.totalProvisioningAttempts,
      'infrastructure.provisioning.total_failures': this.totalProvisioningFailures,
      'infrastructure.bytes.transferred': this.totalBytesTransferred,
      'infrastructure.cost.estimate': this.currentCostEstimate
    };
  }
}

module.exports = {
  InfrastructureState,
  SYSTEM_MAX_CONTAINERS,
  SYSTEM_MAX_SESSIONS,
  STATE_ID
};
