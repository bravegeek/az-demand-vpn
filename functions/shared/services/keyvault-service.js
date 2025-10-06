const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Azure Key Vault Service
 * Wraps @azure/keyvault-secrets SDK for secrets and key management
 */

class KeyVaultService {
  constructor(config = {}) {
    this.keyVaultUrl = config.keyVaultUrl || process.env.KEY_VAULT_URL;

    if (!this.keyVaultUrl) {
      throw new Error('KEY_VAULT_URL is required');
    }

    this.credential = new DefaultAzureCredential();
    this.client = new SecretClient(this.keyVaultUrl, this.credential);
  }

  /**
   * Get secret from Key Vault
   * @param {string} secretName - Name of the secret
   * @returns {Promise<string>} Secret value
   */
  async getSecret(secretName) {
    try {
      const secret = await this.client.getSecret(secretName);
      return secret.value;
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Secret '${secretName}' not found in Key Vault`);
      }
      throw error;
    }
  }

  /**
   * Set secret in Key Vault
   * @param {string} secretName - Name of the secret
   * @param {string} secretValue - Secret value
   * @param {Object} options - Additional options (tags, contentType, etc.)
   * @returns {Promise<Object>} Secret properties
   */
  async setSecret(secretName, secretValue, options = {}) {
    try {
      const secret = await this.client.setSecret(secretName, secretValue, options);
      return {
        name: secret.name,
        version: secret.properties.version,
        createdOn: secret.properties.createdOn
      };
    } catch (error) {
      throw new Error(`Failed to set secret '${secretName}': ${error.message}`);
    }
  }

  /**
   * Delete secret from Key Vault
   * @param {string} secretName - Name of the secret
   * @returns {Promise<void>}
   */
  async deleteSecret(secretName) {
    try {
      const poller = await this.client.beginDeleteSecret(secretName);
      await poller.pollUntilDone();
    } catch (error) {
      if (error.statusCode === 404) {
        // Secret doesn't exist, consider it success
        return;
      }
      throw error;
    }
  }

  /**
   * Generate WireGuard key pair
   * Generates private/public key pair, stores private key in Key Vault, returns both
   * @param {string} sessionId - Session ID for key naming
   * @returns {Promise<Object>} { privateKey, publicKey }
   */
  async generateWireGuardKeyPair(sessionId) {
    try {
      // Generate private key using wg command
      const { stdout: privateKey } = await execAsync('wg genkey');
      const trimmedPrivateKey = privateKey.trim();

      // Generate public key from private key
      const { stdout: publicKey } = await execAsync(
        `echo "${trimmedPrivateKey}" | wg pubkey`
      );
      const trimmedPublicKey = publicKey.trim();

      // Store private key in Key Vault with session ID
      const secretName = `vpn-${sessionId}-private-key`;
      await this.setSecret(secretName, trimmedPrivateKey, {
        contentType: 'application/x-wireguard-private-key',
        tags: {
          sessionId,
          type: 'wireguard-private-key',
          createdAt: new Date().toISOString()
        }
      });

      return {
        privateKey: trimmedPrivateKey,
        publicKey: trimmedPublicKey,
        secretName
      };
    } catch (error) {
      // If wg command not available, use fallback method
      if (error.code === 'ENOENT' || error.message?.includes('wg: command not found')) {
        return await this.generateWireGuardKeyPairFallback(sessionId);
      }
      throw new Error(`Failed to generate WireGuard keys: ${error.message}`);
    }
  }

  /**
   * Fallback: Generate WireGuard key pair using Node.js crypto
   * WireGuard keys are 32-byte Curve25519 keys encoded in base64
   * @param {string} sessionId - Session ID for key naming
   * @returns {Promise<Object>} { privateKey, publicKey }
   */
  async generateWireGuardKeyPairFallback(sessionId) {
    const crypto = require('crypto');

    // Generate 32 random bytes for private key
    const privateKeyBytes = crypto.randomBytes(32);

    // Clamp the private key (WireGuard requirement)
    privateKeyBytes[0] &= 248;
    privateKeyBytes[31] &= 127;
    privateKeyBytes[31] |= 64;

    const privateKey = privateKeyBytes.toString('base64');

    // For the fallback, we'll store the private key and note that public key
    // derivation requires the actual WireGuard tools or sodium library
    // In production, WireGuard tools should be available in the container
    const secretName = `vpn-${sessionId}-private-key`;
    await this.setSecret(secretName, privateKey, {
      contentType: 'application/x-wireguard-private-key',
      tags: {
        sessionId,
        type: 'wireguard-private-key',
        createdAt: new Date().toISOString(),
        method: 'fallback'
      }
    });

    // Note: In fallback mode, public key generation requires sodium library
    // For now, return placeholder that indicates external generation needed
    return {
      privateKey,
      publicKey: null, // Will need to be generated externally
      secretName,
      requiresExternalPubKey: true
    };
  }

  /**
   * Get API key for user authentication
   * @param {string} userId - User ID
   * @returns {Promise<string>} API key hash
   */
  async getUserApiKey(userId) {
    const secretName = `user-${userId}-api-key`;
    return await this.getSecret(secretName);
  }

  /**
   * Store API key for user
   * @param {string} userId - User ID
   * @param {string} apiKeyHash - SHA-256 hash of API key
   * @returns {Promise<void>}
   */
  async storeUserApiKey(userId, apiKeyHash) {
    const secretName = `user-${userId}-api-key`;
    await this.setSecret(secretName, apiKeyHash, {
      contentType: 'application/x-api-key-hash',
      tags: {
        userId,
        type: 'api-key-hash'
      }
    });
  }

  /**
   * List all secrets (for admin/debugging)
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} List of secret names
   */
  async listSecrets(options = {}) {
    const secrets = [];

    for await (const secretProperties of this.client.listPropertiesOfSecrets()) {
      // Filter by tags if provided
      if (options.tags) {
        const matchesTags = Object.entries(options.tags).every(
          ([key, value]) => secretProperties.tags?.[key] === value
        );
        if (!matchesTags) continue;
      }

      secrets.push({
        name: secretProperties.name,
        enabled: secretProperties.enabled,
        createdOn: secretProperties.createdOn,
        updatedOn: secretProperties.updatedOn,
        tags: secretProperties.tags
      });
    }

    return secrets;
  }

  /**
   * Clean up expired secrets for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<number>} Number of secrets deleted
   */
  async cleanupSessionSecrets(sessionId) {
    const secrets = await this.listSecrets({
      tags: { sessionId }
    });

    let deletedCount = 0;

    for (const secret of secrets) {
      try {
        await this.deleteSecret(secret.name);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete secret ${secret.name}:`, error.message);
      }
    }

    return deletedCount;
  }

  /**
   * Rotate server keys (for periodic key rotation)
   * @param {string} identifier - Server identifier
   * @returns {Promise<Object>} New key pair
   */
  async rotateServerKeys(identifier = 'server') {
    const oldSecretName = `vpn-${identifier}-private-key`;

    // Generate new key pair
    const newKeys = await this.generateWireGuardKeyPair(`${identifier}-${Date.now()}`);

    // Mark old key as disabled (keep for grace period)
    try {
      const oldSecret = await this.client.getSecret(oldSecretName);
      await this.client.updateSecretProperties(oldSecretName, oldSecret.properties.version, {
        enabled: false
      });
    } catch (error) {
      // Old key might not exist, that's okay
    }

    return newKeys;
  }
}

module.exports = {
  KeyVaultService
};
