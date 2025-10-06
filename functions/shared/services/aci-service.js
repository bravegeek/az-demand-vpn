const { ContainerInstanceManagementClient } = require('@azure/arm-containerinstance');
const { DefaultAzureCredential } = require('@azure/identity');

/**
 * Azure Container Instances Service
 * Wraps @azure/arm-containerinstance SDK for VPN container management
 */

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const DEPROVISION_TIMEOUT_MS = 60000; // 1 minute (FR-002)
const VPN_PORT = 51820;
const CONTAINER_IMAGE_NAME = 'vpn-wireguard';

class ACIService {
  constructor(config = {}) {
    this.subscriptionId = config.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
    this.resourceGroupName = config.resourceGroupName || process.env.RESOURCE_GROUP_NAME;
    this.acrLoginServer = config.acrLoginServer || process.env.ACR_LOGIN_SERVER;
    this.vnetSubnetId = config.vnetSubnetId || process.env.VPN_SUBNET_ID;

    this.credential = new DefaultAzureCredential();
    this.client = new ContainerInstanceManagementClient(
      this.credential,
      this.subscriptionId
    );

    this.retryUtil = config.retryUtil; // Inject retry utility
  }

  /**
   * Provision VPN container instance
   * @param {string} sessionId - VPN session ID
   * @param {Object} wireguardConfig - WireGuard configuration
   * @returns {Promise<Object>} Container instance details
   */
  async provisionVPNContainer(sessionId, wireguardConfig) {
    const containerGroupName = `vpn-${sessionId}`;

    const containerGroupConfig = {
      location: 'eastus', // TODO: Make configurable
      containers: [
        {
          name: 'wireguard',
          image: `${this.acrLoginServer}/${CONTAINER_IMAGE_NAME}:latest`,
          resources: {
            requests: {
              cpu: 1,
              memoryInGB: 1
            }
          },
          ports: [
            {
              port: VPN_PORT,
              protocol: 'UDP'
            }
          ],
          environmentVariables: [
            {
              name: 'SERVER_PUBLIC_KEY',
              value: wireguardConfig.serverPublicKey
            },
            {
              name: 'SERVER_PRIVATE_KEY',
              secureValue: wireguardConfig.serverPrivateKey
            },
            {
              name: 'CLIENT_PUBLIC_KEY',
              value: wireguardConfig.clientPublicKey
            },
            {
              name: 'CLIENT_IP',
              value: wireguardConfig.clientIpAddress
            },
            {
              name: 'VPN_PORT',
              value: VPN_PORT.toString()
            }
          ]
        }
      ],
      osType: 'Linux',
      ipAddress: {
        type: 'Public',
        ports: [
          {
            port: VPN_PORT,
            protocol: 'UDP'
          }
        ],
        dnsNameLabel: `vpn-${sessionId}`
      },
      restartPolicy: 'Never',
      subnetIds: this.vnetSubnetId ? [
        {
          id: this.vnetSubnetId
        }
      ] : undefined
    };

    // Use retry utility if provided
    if (this.retryUtil) {
      return await this.retryUtil.retryWithBackoff(
        async () => await this.createContainerGroup(containerGroupName, containerGroupConfig),
        MAX_RETRIES,
        RETRY_BASE_DELAY_MS
      );
    } else {
      // Fallback: manual retry logic
      return await this.createWithRetry(containerGroupName, containerGroupConfig);
    }
  }

  /**
   * Create container group with error handling
   * @param {string} name - Container group name
   * @param {Object} config - Container group configuration
   * @returns {Promise<Object>}
   */
  async createContainerGroup(name, config) {
    try {
      const poller = await this.client.containerGroups.beginCreateOrUpdate(
        this.resourceGroupName,
        name,
        config
      );

      const result = await poller.pollUntilDone();

      return {
        containerInstanceId: result.id,
        publicIpAddress: result.ipAddress?.ip,
        port: VPN_PORT,
        state: result.instanceView?.state,
        fqdn: result.ipAddress?.fqdn
      };
    } catch (error) {
      // Check if it's a quota error (specific Azure error codes)
      if (this.isQuotaError(error)) {
        const quotaError = new Error('Azure quota exceeded for container instances');
        quotaError.code = 'QUOTA_EXCEEDED';
        quotaError.originalError = error;
        throw quotaError;
      }

      throw error;
    }
  }

  /**
   * Create container with manual retry logic
   * @param {string} name - Container group name
   * @param {Object} config - Container group configuration
   * @returns {Promise<Object>}
   */
  async createWithRetry(name, config) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.createContainerGroup(name, config);
      } catch (error) {
        lastError = error;

        // Don't retry on non-transient errors
        if (!this.isTransientError(error)) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    const error = new Error(`Provisioning failed after ${MAX_RETRIES} attempts`);
    error.code = 'MAX_RETRIES_EXCEEDED';
    error.attempts = MAX_RETRIES;
    error.originalError = lastError;
    throw error;
  }

  /**
   * Deprovision container instance
   * @param {string} containerInstanceId - Container instance resource ID
   * @returns {Promise<void>}
   */
  async deprovisionContainer(containerInstanceId) {
    const containerGroupName = this.extractContainerGroupName(containerInstanceId);

    try {
      // Set timeout for deprovision operation (FR-002: <1 minute)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Deprovision timeout exceeded')), DEPROVISION_TIMEOUT_MS);
      });

      const deletePromise = this.client.containerGroups.beginDelete(
        this.resourceGroupName,
        containerGroupName
      ).then(poller => poller.pollUntilDone());

      await Promise.race([deletePromise, timeoutPromise]);
    } catch (error) {
      // If container doesn't exist, consider it success
      if (error.statusCode === 404) {
        return;
      }

      throw error;
    }
  }

  /**
   * Get container status
   * @param {string} containerInstanceId - Container instance resource ID
   * @returns {Promise<Object>} Container status
   */
  async getContainerStatus(containerInstanceId) {
    const containerGroupName = this.extractContainerGroupName(containerInstanceId);

    try {
      const containerGroup = await this.client.containerGroups.get(
        this.resourceGroupName,
        containerGroupName
      );

      return {
        state: containerGroup.instanceView?.state || 'Unknown',
        events: containerGroup.instanceView?.events || [],
        containers: containerGroup.containers?.map(c => ({
          name: c.name,
          state: c.instanceView?.currentState?.state,
          restartCount: c.instanceView?.restartCount
        }))
      };
    } catch (error) {
      if (error.statusCode === 404) {
        return { state: 'NotFound' };
      }
      throw error;
    }
  }

  /**
   * Get container logs
   * @param {string} containerInstanceId - Container instance resource ID
   * @param {string} containerName - Container name (default: 'wireguard')
   * @returns {Promise<string>} Container logs
   */
  async getContainerLogs(containerInstanceId, containerName = 'wireguard') {
    const containerGroupName = this.extractContainerGroupName(containerInstanceId);

    try {
      const logs = await this.client.containers.listLogs(
        this.resourceGroupName,
        containerGroupName,
        containerName
      );

      return logs.content || '';
    } catch (error) {
      if (error.statusCode === 404) {
        return '';
      }
      throw error;
    }
  }

  /**
   * Extract container group name from resource ID
   * @param {string} resourceId - Azure resource ID
   * @returns {string} Container group name
   */
  extractContainerGroupName(resourceId) {
    // Resource ID format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ContainerInstance/containerGroups/{name}
    const parts = resourceId.split('/');
    return parts[parts.length - 1];
  }

  /**
   * Check if error is a quota/capacity error
   * @param {Error} error - Error object
   * @returns {boolean}
   */
  isQuotaError(error) {
    const quotaErrorCodes = [
      'QuotaExceeded',
      'OperationNotAllowed',
      'InsufficientCapacity'
    ];

    return quotaErrorCodes.some(code =>
      error.code === code ||
      error.message?.includes(code) ||
      error.message?.includes('quota')
    );
  }

  /**
   * Check if error is transient (should retry)
   * @param {Error} error - Error object
   * @returns {boolean}
   */
  isTransientError(error) {
    const transientCodes = [
      'ServiceUnavailable',
      'InternalServerError',
      'TooManyRequests',
      'QuotaExceeded' // Quota might be temporary if others release
    ];

    const transientStatusCodes = [500, 502, 503, 504, 429];

    return (
      transientCodes.some(code => error.code === code || error.message?.includes(code)) ||
      transientStatusCodes.includes(error.statusCode)
    );
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  ACIService,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  DEPROVISION_TIMEOUT_MS,
  VPN_PORT
};
