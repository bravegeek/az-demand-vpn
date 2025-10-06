const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');

/**
 * Azure Storage Service
 * Wraps @azure/storage-blob and @azure/data-tables SDKs
 */

const DEFAULT_SAS_EXPIRY_HOURS = 1;
const CLIENT_CONFIGS_CONTAINER = 'client-configs';
const VPN_LOGS_CONTAINER = 'vpn-logs';

class StorageService {
  constructor(config = {}) {
    this.storageAccountName = config.storageAccountName || process.env.STORAGE_ACCOUNT_NAME;
    this.storageAccountKey = config.storageAccountKey || process.env.STORAGE_ACCOUNT_KEY;

    if (!this.storageAccountName) {
      throw new Error('STORAGE_ACCOUNT_NAME is required');
    }

    this.credential = this.storageAccountKey
      ? new StorageSharedKeyCredential(this.storageAccountName, this.storageAccountKey)
      : new DefaultAzureCredential();

    this.blobServiceUrl = `https://${this.storageAccountName}.blob.core.windows.net`;
    this.tableServiceUrl = `https://${this.storageAccountName}.table.core.windows.net`;

    // Initialize Blob Service Client
    this.blobServiceClient = new BlobServiceClient(
      this.blobServiceUrl,
      this.credential
    );

    // Table clients (will be created on demand)
    this.tableClients = {};
  }

  // ===== BLOB STORAGE METHODS =====

  /**
   * Upload client configuration to blob storage
   * @param {string} sessionId - Session ID
   * @param {string} configContent - Configuration file content
   * @param {string} fileName - File name (default: client.conf)
   * @returns {Promise<string>} Blob URL
   */
  async uploadClientConfig(sessionId, configContent, fileName = 'client.conf') {
    const containerClient = this.blobServiceClient.getContainerClient(CLIENT_CONFIGS_CONTAINER);

    // Ensure container exists
    await containerClient.createIfNotExists({
      access: 'none' // Private container
    });

    const blobName = `${sessionId}/${fileName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(configContent, Buffer.byteLength(configContent), {
      blobHTTPHeaders: {
        blobContentType: 'text/plain'
      }
    });

    return blockBlobClient.url;
  }

  /**
   * Generate SAS token for secure config download
   * @param {string} blobPath - Blob path (e.g., sessionId/client.conf)
   * @param {number} expiryHours - Hours until expiry (default: 1)
   * @returns {Promise<string>} Full URL with SAS token
   */
  async generateSASToken(blobPath, expiryHours = DEFAULT_SAS_EXPIRY_HOURS) {
    const containerClient = this.blobServiceClient.getContainerClient(CLIENT_CONFIGS_CONTAINER);
    const blobClient = containerClient.getBlobClient(blobPath);

    // Calculate expiry time
    const expiresOn = new Date();
    expiresOn.setHours(expiresOn.getHours() + expiryHours);

    // Generate SAS token with read-only permission
    const sasOptions = {
      containerName: CLIENT_CONFIGS_CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'), // Read only
      startsOn: new Date(),
      expiresOn
    };

    // Use shared key credential for SAS generation
    if (!this.storageAccountKey) {
      throw new Error('Storage account key required for SAS token generation');
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(
      this.storageAccountName,
      this.storageAccountKey
    );

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      sharedKeyCredential
    ).toString();

    return `${blobClient.url}?${sasToken}`;
  }

  /**
   * Delete client configuration blob
   * @param {string} sessionId - Session ID
   * @param {string} fileName - File name (default: client.conf)
   * @returns {Promise<void>}
   */
  async deleteClientConfig(sessionId, fileName = 'client.conf') {
    const containerClient = this.blobServiceClient.getContainerClient(CLIENT_CONFIGS_CONTAINER);
    const blobName = `${sessionId}/${fileName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    try {
      await blockBlobClient.delete();
    } catch (error) {
      // If blob doesn't exist, consider it success
      if (error.statusCode === 404) {
        return;
      }
      throw error;
    }
  }

  /**
   * Upload VPN logs
   * @param {string} sessionId - Session ID
   * @param {string} logContent - Log content
   * @returns {Promise<string>} Blob URL
   */
  async uploadVPNLogs(sessionId, logContent) {
    const containerClient = this.blobServiceClient.getContainerClient(VPN_LOGS_CONTAINER);

    await containerClient.createIfNotExists({
      access: 'none'
    });

    const date = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blobName = `${date}/${sessionId}/${timestamp}.log`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(logContent, Buffer.byteLength(logContent), {
      blobHTTPHeaders: {
        blobContentType: 'text/plain'
      }
    });

    return blockBlobClient.url;
  }

  // ===== TABLE STORAGE METHODS =====

  /**
   * Get or create table client
   * @param {string} tableName - Table name
   * @returns {TableClient}
   */
  getTableClient(tableName) {
    if (!this.tableClients[tableName]) {
      this.tableClients[tableName] = new TableClient(
        this.tableServiceUrl,
        tableName,
        this.credential
      );
    }
    return this.tableClients[tableName];
  }

  /**
   * Create table if not exists
   * @param {string} tableName - Table name
   * @returns {Promise<void>}
   */
  async createTable(tableName) {
    const tableClient = this.getTableClient(tableName);
    try {
      await tableClient.createTable();
    } catch (error) {
      // Table might already exist
      if (error.statusCode !== 409) {
        throw error;
      }
    }
  }

  /**
   * Create or update entity in table
   * @param {string} tableName - Table name
   * @param {Object} entity - Entity to create/update (must have partitionKey and rowKey)
   * @returns {Promise<Object>} Created entity
   */
  async createEntity(tableName, entity) {
    if (!entity.partitionKey || !entity.rowKey) {
      throw new Error('Entity must have partitionKey and rowKey');
    }

    const tableClient = this.getTableClient(tableName);

    // Ensure table exists
    await this.createTable(tableName);

    try {
      await tableClient.createEntity(entity);
      return entity;
    } catch (error) {
      // If entity exists, update it
      if (error.statusCode === 409) {
        return await this.updateEntity(tableName, entity);
      }
      throw error;
    }
  }

  /**
   * Update entity in table
   * @param {string} tableName - Table name
   * @param {Object} entity - Entity to update (must have partitionKey and rowKey)
   * @param {string} mode - Update mode ('Replace' or 'Merge', default: 'Merge')
   * @returns {Promise<Object>} Updated entity
   */
  async updateEntity(tableName, entity, mode = 'Merge') {
    if (!entity.partitionKey || !entity.rowKey) {
      throw new Error('Entity must have partitionKey and rowKey');
    }

    const tableClient = this.getTableClient(tableName);

    await tableClient.updateEntity(entity, mode);
    return entity;
  }

  /**
   * Get entity from table
   * @param {string} tableName - Table name
   * @param {string} partitionKey - Partition key
   * @param {string} rowKey - Row key
   * @returns {Promise<Object|null>} Entity or null if not found
   */
  async getEntity(tableName, partitionKey, rowKey) {
    const tableClient = this.getTableClient(tableName);

    try {
      const entity = await tableClient.getEntity(partitionKey, rowKey);
      return entity;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query entities from table
   * @param {string} tableName - Table name
   * @param {string} filter - OData filter query
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of entities
   */
  async queryEntities(tableName, filter = '', options = {}) {
    const tableClient = this.getTableClient(tableName);
    const entities = [];

    const queryOptions = {
      filter,
      ...options
    };

    try {
      const iterator = tableClient.listEntities({ queryOptions });

      for await (const entity of iterator) {
        entities.push(entity);
      }
    } catch (error) {
      // Table might not exist
      if (error.statusCode === 404) {
        return [];
      }
      throw error;
    }

    return entities;
  }

  /**
   * Delete entity from table
   * @param {string} tableName - Table name
   * @param {string} partitionKey - Partition key
   * @param {string} rowKey - Row key
   * @returns {Promise<void>}
   */
  async deleteEntity(tableName, partitionKey, rowKey) {
    const tableClient = this.getTableClient(tableName);

    try {
      await tableClient.deleteEntity(partitionKey, rowKey);
    } catch (error) {
      // Entity might not exist
      if (error.statusCode === 404) {
        return;
      }
      throw error;
    }
  }

  /**
   * Delete entities by partition key
   * @param {string} tableName - Table name
   * @param {string} partitionKey - Partition key
   * @returns {Promise<number>} Number of entities deleted
   */
  async deletePartition(tableName, partitionKey) {
    const entities = await this.queryEntities(
      tableName,
      `PartitionKey eq '${partitionKey}'`
    );

    let deletedCount = 0;

    for (const entity of entities) {
      await this.deleteEntity(tableName, entity.partitionKey, entity.rowKey);
      deletedCount++;
    }

    return deletedCount;
  }

  /**
   * Batch operations on table
   * @param {string} tableName - Table name
   * @param {Array} operations - Array of operations
   * @returns {Promise<Array>} Results
   */
  async batchOperations(tableName, operations) {
    const tableClient = this.getTableClient(tableName);

    // Group operations by partition key (batch requirement)
    const batches = {};

    for (const op of operations) {
      const partitionKey = op.entity.partitionKey;
      if (!batches[partitionKey]) {
        batches[partitionKey] = [];
      }
      batches[partitionKey].push(op);
    }

    const results = [];

    // Execute each batch
    for (const [partitionKey, batchOps] of Object.entries(batches)) {
      const batch = [];

      for (const op of batchOps) {
        switch (op.type) {
          case 'create':
            batch.push(['create', op.entity]);
            break;
          case 'update':
            batch.push(['update', op.entity, op.mode || 'Merge']);
            break;
          case 'delete':
            batch.push(['delete', op.entity.partitionKey, op.entity.rowKey]);
            break;
        }
      }

      const batchResult = await tableClient.submitTransaction(batch);
      results.push(...batchResult);
    }

    return results;
  }
}

module.exports = {
  StorageService,
  DEFAULT_SAS_EXPIRY_HOURS,
  CLIENT_CONFIGS_CONTAINER,
  VPN_LOGS_CONTAINER
};
