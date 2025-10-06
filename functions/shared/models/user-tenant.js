const crypto = require('crypto');

/**
 * UserTenant Model
 * Represents an authorized entity that can request VPN access
 * Storage: Azure Table Storage (userId as both PartitionKey and RowKey)
 */

const AUTH_METHOD = {
  API_KEY: 'apikey',
  AZURE_AD: 'azuread'
};

const SYSTEM_MAX_CONCURRENT_SESSIONS = 3;
const DEFAULT_MAX_CONCURRENT = 1;

class UserTenant {
  constructor(data = {}) {
    this.userId = data.userId || '';
    this.email = data.email || null;
    this.displayName = data.displayName || null;
    this.authMethod = data.authMethod || AUTH_METHOD.API_KEY;
    this.apiKey = data.apiKey || null; // SHA-256 hash
    this.azureAdObjectId = data.azureAdObjectId || null;
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.allowedSourceIPs = data.allowedSourceIPs || null; // Array of CIDR ranges
    this.quotaMaxConcurrentSessions = data.quotaMaxConcurrentSessions || DEFAULT_MAX_CONCURRENT;
    this.quotaMaxSessionsPerDay = data.quotaMaxSessionsPerDay || null;
    this.totalSessionsCreated = data.totalSessionsCreated || 0;
    this.lastSessionAt = data.lastSessionAt || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  /**
   * Validate user tenant data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required fields
    if (!this.userId) errors.push('userId is required');
    if (!this.authMethod) errors.push('authMethod is required');

    // Auth method validation
    if (!Object.values(AUTH_METHOD).includes(this.authMethod)) {
      errors.push(`authMethod must be one of: ${Object.values(AUTH_METHOD).join(', ')}`);
    }

    // Auth method specific validation
    if (this.authMethod === AUTH_METHOD.API_KEY && !this.apiKey) {
      errors.push('apiKey is required when authMethod is apikey');
    }

    if (this.authMethod === AUTH_METHOD.AZURE_AD && !this.azureAdObjectId) {
      errors.push('azureAdObjectId is required when authMethod is azuread');
    }

    // Email validation (if provided)
    if (this.email && !this.isValidEmail(this.email)) {
      errors.push('email must be valid email format');
    }

    // Display name validation
    if (this.displayName && this.displayName.length > 100) {
      errors.push('displayName must be less than 100 characters');
    }

    // Quota validation
    if (this.quotaMaxConcurrentSessions < 1 || this.quotaMaxConcurrentSessions > SYSTEM_MAX_CONCURRENT_SESSIONS) {
      errors.push(`quotaMaxConcurrentSessions must be between 1 and ${SYSTEM_MAX_CONCURRENT_SESSIONS}`);
    }

    if (this.quotaMaxSessionsPerDay !== null && this.quotaMaxSessionsPerDay < 1) {
      errors.push('quotaMaxSessionsPerDay must be positive integer if set');
    }

    // Session count validation
    if (this.totalSessionsCreated < 0) {
      errors.push('totalSessionsCreated must be >= 0');
    }

    // IP restrictions validation (if provided)
    if (this.allowedSourceIPs && Array.isArray(this.allowedSourceIPs)) {
      for (const cidr of this.allowedSourceIPs) {
        if (!this.isValidCIDR(cidr)) {
          errors.push(`Invalid CIDR format in allowedSourceIPs: ${cidr}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate email format
   * @param {string} email
   * @returns {boolean}
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate CIDR format
   * @param {string} cidr
   * @returns {boolean}
   */
  isValidCIDR(cidr) {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrRegex.test(cidr)) return false;

    const [ip, prefix] = cidr.split('/');
    const parts = ip.split('.');

    // Validate each octet
    if (!parts.every(part => {
      const num = parseInt(part, 10);
      return !isNaN(num) && num >= 0 && num <= 255;
    })) return false;

    // Validate prefix
    const prefixNum = parseInt(prefix, 10);
    return !isNaN(prefixNum) && prefixNum >= 0 && prefixNum <= 32;
  }

  /**
   * Hash API key for storage
   * @param {string} plainKey - Plain text API key
   * @returns {string} SHA-256 hash
   */
  static hashApiKey(plainKey) {
    return crypto.createHash('sha256').update(plainKey).digest('hex');
  }

  /**
   * Verify API key
   * @param {string} plainKey - Plain text API key to verify
   * @returns {boolean}
   */
  verifyApiKey(plainKey) {
    if (!this.apiKey) return false;
    const hashedInput = UserTenant.hashApiKey(plainKey);
    return crypto.timingSafeEqual(
      Buffer.from(this.apiKey),
      Buffer.from(hashedInput)
    );
  }

  /**
   * Check if user can create new session based on quota
   * @param {number} currentActiveSessions - Current active session count
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  canCreateSession(currentActiveSessions) {
    if (!this.isActive) {
      return { allowed: false, reason: 'User account is not active' };
    }

    if (currentActiveSessions >= this.quotaMaxConcurrentSessions) {
      return {
        allowed: false,
        reason: `Maximum concurrent sessions reached (${this.quotaMaxConcurrentSessions})`
      };
    }

    // Daily quota check would require querying sessions created today
    // This is handled externally by querying session history

    return { allowed: true };
  }

  /**
   * Check if source IP is allowed
   * @param {string} sourceIP - Client IP address
   * @returns {boolean}
   */
  isIPAllowed(sourceIP) {
    // If no IP restrictions, allow all
    if (!this.allowedSourceIPs || this.allowedSourceIPs.length === 0) {
      return true;
    }

    // Check if sourceIP matches any allowed CIDR range
    for (const cidr of this.allowedSourceIPs) {
      if (this.ipMatchesCIDR(sourceIP, cidr)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP matches CIDR range
   * @param {string} ip - IP address to check
   * @param {string} cidr - CIDR range
   * @returns {boolean}
   */
  ipMatchesCIDR(ip, cidr) {
    const [range, prefix] = cidr.split('/');
    const prefixNum = parseInt(prefix, 10);

    const ipInt = this.ipToInt(ip);
    const rangeInt = this.ipToInt(range);
    const mask = (-1 << (32 - prefixNum)) >>> 0;

    return (ipInt & mask) === (rangeInt & mask);
  }

  /**
   * Convert IP address to integer
   * @param {string} ip - IP address
   * @returns {number}
   */
  ipToInt(ip) {
    return ip.split('.').reduce((int, octet) => {
      return (int << 8) + parseInt(octet, 10);
    }, 0) >>> 0;
  }

  /**
   * Increment session counter
   */
  incrementSessionCount() {
    this.totalSessionsCreated += 1;
    this.lastSessionAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Update user information
   */
  touch() {
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Convert to Azure Table Storage entity
   * @returns {Object}
   */
  toTableEntity() {
    return {
      partitionKey: this.userId,
      rowKey: this.userId,
      userId: this.userId,
      email: this.email,
      displayName: this.displayName,
      authMethod: this.authMethod,
      apiKey: this.apiKey,
      azureAdObjectId: this.azureAdObjectId,
      isActive: this.isActive,
      allowedSourceIPs: this.allowedSourceIPs ? JSON.stringify(this.allowedSourceIPs) : null,
      quotaMaxConcurrentSessions: this.quotaMaxConcurrentSessions,
      quotaMaxSessionsPerDay: this.quotaMaxSessionsPerDay,
      totalSessionsCreated: this.totalSessionsCreated,
      lastSessionAt: this.lastSessionAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Create UserTenant from Azure Table Storage entity
   * @param {Object} entity
   * @returns {UserTenant}
   */
  static fromTableEntity(entity) {
    return new UserTenant({
      userId: entity.userId,
      email: entity.email,
      displayName: entity.displayName,
      authMethod: entity.authMethod,
      apiKey: entity.apiKey,
      azureAdObjectId: entity.azureAdObjectId,
      isActive: entity.isActive,
      allowedSourceIPs: entity.allowedSourceIPs ? JSON.parse(entity.allowedSourceIPs) : null,
      quotaMaxConcurrentSessions: entity.quotaMaxConcurrentSessions,
      quotaMaxSessionsPerDay: entity.quotaMaxSessionsPerDay,
      totalSessionsCreated: entity.totalSessionsCreated,
      lastSessionAt: entity.lastSessionAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt
    });
  }

  /**
   * Convert to JSON for API responses (excludes sensitive data)
   * @returns {Object}
   */
  toJSON() {
    return {
      userId: this.userId,
      email: this.email,
      displayName: this.displayName,
      quotaMaxConcurrentSessions: this.quotaMaxConcurrentSessions,
      quotaMaxSessionsPerDay: this.quotaMaxSessionsPerDay,
      totalSessionsCreated: this.totalSessionsCreated,
      lastSessionAt: this.lastSessionAt
    };
  }
}

module.exports = {
  UserTenant,
  AUTH_METHOD,
  SYSTEM_MAX_CONCURRENT_SESSIONS,
  DEFAULT_MAX_CONCURRENT
};
