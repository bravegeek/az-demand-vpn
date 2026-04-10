'use strict';

const { DefaultAzureCredential } = require('@azure/identity');
const { ContainerInstanceManagementClient } = require('@azure/arm-containerinstance');
const { SecretClient } = require('@azure/keyvault-secrets');

const credential = new DefaultAzureCredential();

const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP;
const KEY_VAULT_URI = process.env.KeyVaultUri;

/**
 * Returns a ContainerInstanceManagementClient authenticated via managed identity.
 * @returns {ContainerInstanceManagementClient}
 */
const getContainerClient = () => new ContainerInstanceManagementClient(credential, SUBSCRIPTION_ID);

/**
 * Returns a Key Vault SecretClient authenticated via managed identity.
 * @returns {SecretClient}
 */
const getSecretClient = () => new SecretClient(KEY_VAULT_URI, credential);

module.exports = {
  credential,
  getContainerClient,
  getSecretClient,
  RESOURCE_GROUP,
};
