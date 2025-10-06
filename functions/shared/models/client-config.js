const { v4: uuidv4 } = require('uuid');

/**
 * ClientConfiguration Model
 * Represents VPN client setup information
 * Storage: Azure Blob Storage (client-configs container)
 */

const VPN_SUBNET = '10.8.0.0/24';
const VPN_SUBNET_BASE = '10.8.0';
const IP_POOL_START = 2; // 10.8.0.2
const IP_POOL_END = 254; // 10.8.0.254
const DEFAULT_ALLOWED_IPS = '0.0.0.0/0';
const DEFAULT_DNS_SERVERS = ['8.8.8.8', '8.8.4.4'];
const CONFIG_EXPIRY_HOURS = 1; // SAS token expiry

class ClientConfiguration {
  constructor(data = {}) {
    this.configId = data.configId || uuidv4();
    this.sessionId = data.sessionId || '';
    this.userId = data.userId || '';
    this.clientPublicKey = data.clientPublicKey || '';
    this.clientPrivateKey = data.clientPrivateKey || '';
    this.clientIpAddress = data.clientIpAddress || '';
    this.serverPublicKey = data.serverPublicKey || '';
    this.serverEndpoint = data.serverEndpoint || '';
    this.allowedIPs = data.allowedIPs || DEFAULT_ALLOWED_IPS;
    this.dnsServers = data.dnsServers || DEFAULT_DNS_SERVERS;
    this.configFileContent = data.configFileContent || '';
    this.qrCodeData = data.qrCodeData || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.expiresAt = data.expiresAt || null;
    this.downloadToken = data.downloadToken || null;
  }

  /**
   * Validate client configuration data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required fields
    if (!this.configId) errors.push('configId is required');
    if (!this.sessionId) errors.push('sessionId is required');
    if (!this.userId) errors.push('userId is required');
    if (!this.clientPublicKey) errors.push('clientPublicKey is required');
    if (!this.clientPrivateKey) errors.push('clientPrivateKey is required');
    if (!this.clientIpAddress) errors.push('clientIpAddress is required');
    if (!this.serverPublicKey) errors.push('serverPublicKey is required');
    if (!this.serverEndpoint) errors.push('serverEndpoint is required');

    // IP address validation
    if (this.clientIpAddress && !this.isValidVPNSubnetIP(this.clientIpAddress)) {
      errors.push(`clientIpAddress must be within ${VPN_SUBNET} subnet`);
    }

    // Endpoint format validation
    if (this.serverEndpoint && !this.isValidEndpoint(this.serverEndpoint)) {
      errors.push('serverEndpoint must be in format IP:PORT');
    }

    // Timestamp validation
    if (this.expiresAt && this.createdAt && new Date(this.expiresAt) <= new Date(this.createdAt)) {
      errors.push('expiresAt must be > createdAt');
    }

    // WireGuard key format validation (base64, 44 characters)
    if (this.clientPublicKey && !this.isValidWireGuardKey(this.clientPublicKey)) {
      errors.push('clientPublicKey must be valid WireGuard key format');
    }
    if (this.clientPrivateKey && !this.isValidWireGuardKey(this.clientPrivateKey)) {
      errors.push('clientPrivateKey must be valid WireGuard key format');
    }
    if (this.serverPublicKey && !this.isValidWireGuardKey(this.serverPublicKey)) {
      errors.push('serverPublicKey must be valid WireGuard key format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if IP is within VPN subnet and valid range
   * @param {string} ip - IP address to check
   * @returns {boolean}
   */
  isValidVPNSubnetIP(ip) {
    // Remove CIDR notation if present
    const cleanIp = ip.split('/')[0];
    const parts = cleanIp.split('.');

    if (parts.length !== 4) return false;

    // Check if it's in 10.8.0.x range
    if (parts[0] !== '10' || parts[1] !== '8' || parts[2] !== '0') {
      return false;
    }

    const lastOctet = parseInt(parts[3], 10);

    // Check if it's within allocatable range (2-254)
    return lastOctet >= IP_POOL_START && lastOctet <= IP_POOL_END;
  }

  /**
   * Check if endpoint format is valid (IP:PORT)
   * @param {string} endpoint - Endpoint string
   * @returns {boolean}
   */
  isValidEndpoint(endpoint) {
    const parts = endpoint.split(':');
    if (parts.length !== 2) return false;

    const [ip, port] = parts;

    // Basic IPv4 validation
    const ipParts = ip.split('.');
    if (ipParts.length !== 4) return false;
    if (!ipParts.every(part => {
      const num = parseInt(part, 10);
      return !isNaN(num) && num >= 0 && num <= 255;
    })) return false;

    // Port validation
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
  }

  /**
   * Check if string is valid WireGuard key (base64, 44 chars)
   * @param {string} key - Key to validate
   * @returns {boolean}
   */
  isValidWireGuardKey(key) {
    // WireGuard keys are 44-character base64 strings
    const base64Regex = /^[A-Za-z0-9+/]{43}=$/;
    return base64Regex.test(key);
  }

  /**
   * Generate client IP from pool
   * @param {number} lastOctet - Last octet value (2-254)
   * @returns {string} IP address with CIDR notation
   */
  static generateClientIP(lastOctet) {
    if (lastOctet < IP_POOL_START || lastOctet > IP_POOL_END) {
      throw new Error(`IP last octet must be between ${IP_POOL_START} and ${IP_POOL_END}`);
    }
    return `${VPN_SUBNET_BASE}.${lastOctet}/32`;
  }

  /**
   * Parse client IP to get last octet
   * @param {string} ip - IP address (with or without CIDR)
   * @returns {number} Last octet value
   */
  static parseClientIPOctet(ip) {
    const cleanIp = ip.split('/')[0];
    const parts = cleanIp.split('.');
    return parseInt(parts[3], 10);
  }

  /**
   * Check if configuration has expired
   * @returns {boolean}
   */
  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }

  /**
   * Convert to Blob Storage metadata
   * @returns {Object}
   */
  toBlobMetadata() {
    return {
      configId: this.configId,
      sessionId: this.sessionId,
      userId: this.userId,
      clientIpAddress: this.clientIpAddress,
      serverEndpoint: this.serverEndpoint,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt || ''
    };
  }

  /**
   * Convert to JSON for API responses (excludes private key)
   * @returns {Object}
   */
  toJSON() {
    return {
      configId: this.configId,
      sessionId: this.sessionId,
      clientIpAddress: this.clientIpAddress,
      serverEndpoint: this.serverEndpoint,
      allowedIPs: this.allowedIPs,
      dnsServers: this.dnsServers,
      configDownloadUrl: this.downloadToken ? `${this.downloadToken}` : null,
      qrCodeData: this.qrCodeData,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt
    };
  }

  /**
   * Convert to JSON including sensitive data (for internal use only)
   * @returns {Object}
   */
  toFullJSON() {
    return {
      configId: this.configId,
      sessionId: this.sessionId,
      userId: this.userId,
      clientPublicKey: this.clientPublicKey,
      clientPrivateKey: this.clientPrivateKey,
      clientIpAddress: this.clientIpAddress,
      serverPublicKey: this.serverPublicKey,
      serverEndpoint: this.serverEndpoint,
      allowedIPs: this.allowedIPs,
      dnsServers: this.dnsServers,
      configFileContent: this.configFileContent,
      qrCodeData: this.qrCodeData,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      downloadToken: this.downloadToken
    };
  }
}

/**
 * IP Allocation Service
 * Manages IP pool for VPN clients with conflict detection
 */
class IPAllocationService {
  constructor(storageService) {
    this.storageService = storageService;
  }

  /**
   * Allocate next available IP address
   * @param {string} sessionId - Session requesting IP
   * @returns {Promise<string>} Allocated IP address
   */
  async allocateIP(sessionId) {
    // Query active sessions to find used IPs
    const activeSessions = await this.storageService.queryEntities(
      'vpnsessions',
      `status eq 'active' or status eq 'provisioning'`
    );

    // Extract used IPs from client configurations
    const usedIPs = new Set();

    // Also query client configs to find all allocated IPs
    const configs = await this.storageService.queryEntities(
      'clientconfigs',
      `expiresAt gt '${new Date().toISOString()}'`
    );

    configs.forEach(config => {
      if (config.clientIpAddress) {
        const octet = ClientConfiguration.parseClientIPOctet(config.clientIpAddress);
        usedIPs.add(octet);
      }
    });

    // Find first available IP
    for (let i = IP_POOL_START; i <= IP_POOL_END; i++) {
      if (!usedIPs.has(i)) {
        return ClientConfiguration.generateClientIP(i);
      }
    }

    throw new Error('No available IP addresses in pool');
  }

  /**
   * Check if IP is available
   * @param {string} ip - IP address to check
   * @returns {Promise<boolean>}
   */
  async isIPAvailable(ip) {
    const octet = ClientConfiguration.parseClientIPOctet(ip);

    const configs = await this.storageService.queryEntities(
      'clientconfigs',
      `clientIpAddress eq '${ip}' and expiresAt gt '${new Date().toISOString()}'`
    );

    return configs.length === 0;
  }

  /**
   * Release IP address
   * @param {string} ip - IP address to release
   */
  async releaseIP(ip) {
    // Mark associated configs as expired
    const configs = await this.storageService.queryEntities(
      'clientconfigs',
      `clientIpAddress eq '${ip}'`
    );

    for (const config of configs) {
      config.expiresAt = new Date().toISOString();
      await this.storageService.updateEntity('clientconfigs', config);
    }
  }
}

module.exports = {
  ClientConfiguration,
  IPAllocationService,
  VPN_SUBNET,
  IP_POOL_START,
  IP_POOL_END,
  DEFAULT_ALLOWED_IPS,
  DEFAULT_DNS_SERVERS,
  CONFIG_EXPIRY_HOURS
};
