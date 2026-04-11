@description('Main Bicep template for Azure Demand VPN solution')
@minLength(1)
@maxLength(24)
param projectName string

@description('Environment name (dev, test, prod)')
@allowed(['dev', 'test', 'prod'])
param environment string = 'dev'

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to all resources')
param tags object = {
  'Project': 'Azure-Demand-VPN'
  'Environment': environment
  'Owner': 'DevOps'
  'CostCenter': 'IT-Infrastructure'
}

@description('VPN configuration parameters')
param vpnConfig object = {
  wireguardPort: 51820
  maxConnections: 100
  idleTimeoutMinutes: 30
}

@description('Storage account configuration')
param storageConfig object = {
  sku: 'Standard_LRS'
  accessTier: 'Hot'
  allowBlobPublicAccess: false
  allowSharedKeyAccess: false
}

@description('Key Vault configuration')
param keyVaultConfig object = {
  sku: 'standard'
  enableSoftDelete: true
  softDeleteRetentionInDays: 90
  enablePurgeProtection: true
  enableRbacAuthorization: true
}

@description('Function App configuration')
param functionConfig object = {
  runtime: 'node'
  version: '20'
}

@description('GitHub organization or username that owns the GHCR container image')
param githubOrg string

@description('Container image reference for WireGuard VPN containers — defaults to GHCR image for githubOrg')
param vpnContainerImage string = 'ghcr.io/${githubOrg}/az-demand-vpn-wg:latest'

@description('Network configuration')
param networkConfig object = {
  vnetAddressPrefix: '10.0.0.0/16'
  vpnSubnetPrefix: '10.0.1.0/24'
  functionsSubnetPrefix: '10.0.2.0/24'
  endpointsSubnetPrefix: '10.0.3.0/24'
}

// Generate unique names for resources (capped to service limits)
var uniqueSuffix = uniqueString(resourceGroup().id, projectName, environment)
var resourceNames = {
  resourceGroup: resourceGroup().name
  storage: substring('st${projectName}${uniqueSuffix}', 0, 24)
  keyVault: substring('kv${projectName}${uniqueSuffix}', 0, 24)
  functionApp: 'func${projectName}${uniqueSuffix}'
  vnet: 'vnet-${projectName}'
  logAnalytics: 'law${projectName}${uniqueSuffix}'
  appInsights: 'appi${projectName}${uniqueSuffix}'
}

// Deploy Log Analytics Workspace first (required for other resources)
module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'logAnalytics'
  params: {
    name: resourceNames.logAnalytics
    location: location
    tags: tags
  }
}

// Deploy Application Insights
module appInsights 'modules/application-insights.bicep' = {
  name: 'appInsights'
  params: {
    name: resourceNames.appInsights
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    tags: tags
  }
}

// Deploy Virtual Network and Network Security Groups
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    name: resourceNames.vnet
    location: location
    addressPrefix: networkConfig.vnetAddressPrefix
    vpnSubnetPrefix: networkConfig.vpnSubnetPrefix
    functionsSubnetPrefix: networkConfig.functionsSubnetPrefix
    endpointsSubnetPrefix: networkConfig.endpointsSubnetPrefix
    wireguardPort: vpnConfig.wireguardPort
    tags: tags
  }
}

// TODO: Add ACR as optional private registry for private image hosting — see design.md Decision 1

// Deploy Storage Account
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: resourceNames.storage
    location: location
    sku: storageConfig.sku
    accessTier: storageConfig.accessTier
    allowBlobPublicAccess: storageConfig.allowBlobPublicAccess
    allowSharedKeyAccess: storageConfig.allowSharedKeyAccess
    vnetId: network.outputs.vnetId
    endpointsSubnetId: network.outputs.endpointsSubnetId
    tags: tags
  }
}

// Deploy Key Vault
module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault'
  params: {
    name: resourceNames.keyVault
    location: location
    sku: keyVaultConfig.sku
    enableSoftDelete: keyVaultConfig.enableSoftDelete
    softDeleteRetentionInDays: keyVaultConfig.softDeleteRetentionInDays
    enablePurgeProtection: keyVaultConfig.enablePurgeProtection
    enableRbacAuthorization: keyVaultConfig.enableRbacAuthorization
    vnetId: network.outputs.vnetId
    endpointsSubnetId: network.outputs.endpointsSubnetId
    tags: tags
  }
}

// Deploy Function App
module functionApp 'modules/function-app.bicep' = {
  name: 'functionApp'
  params: {
    name: resourceNames.functionApp
    location: location
    runtime: functionConfig.runtime
    version: functionConfig.version
    subnetId: network.outputs.functionsSubnetId
    storageAccountId: storage.outputs.storageAccountId
    keyVaultId: keyVault.outputs.keyVaultId
    appInsightsId: appInsights.outputs.appInsightsId
    vpnSubnetId: network.outputs.vpnSubnetId
    vpnContainerImage: vpnContainerImage
    idleTimeoutMinutes: vpnConfig.idleTimeoutMinutes
    tags: tags
  }
}

// RBAC role assignments: Function App managed identity → Storage Account
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource funcStorageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // # Reason: guid() name uses resourceNames vars (pre-computable); principalId from output is fine for properties
  name: guid(resourceNames.storage, resourceNames.functionApp, storageBlobDataOwnerRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: functionApp.outputs.managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource funcStorageQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceNames.storage, resourceNames.functionApp, storageQueueDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: functionApp.outputs.managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource funcStorageTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceNames.storage, resourceNames.functionApp, storageTableDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionApp.outputs.managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Deploy Monitoring and Alerting
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    functionAppId: functionApp.outputs.functionAppId
    tags: tags
  }
}

// Outputs
output resourceGroupName string = resourceGroup().name
output location string = location
output storageAccountName string = resourceNames.storage
output keyVaultName string = resourceNames.keyVault
output functionAppName string = resourceNames.functionApp
output virtualNetworkName string = resourceNames.vnet
output logAnalyticsWorkspaceName string = resourceNames.logAnalytics
output applicationInsightsName string = resourceNames.appInsights
