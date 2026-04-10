'use strict';

const { DefaultAzureCredential } = require('@azure/identity');
const { ContainerInstanceManagementClient } = require('@azure/arm-containerinstance');
const { SecretClient } = require('@azure/keyvault-secrets');

// Validate required env vars at module load — fail fast rather than at first API call
const REQUIRED = ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'KeyVaultUri'];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP;
const KEY_VAULT_URI = process.env.KeyVaultUri;

const credential = new DefaultAzureCredential();

// Singleton clients — created once per cold start, reused across invocations
const containerClient = new ContainerInstanceManagementClient(credential, SUBSCRIPTION_ID);
const secretClient = new SecretClient(KEY_VAULT_URI, credential);

module.exports = {
  credential,
  getContainerClient: () => containerClient,
  getSecretClient: () => secretClient,
  RESOURCE_GROUP,
};
