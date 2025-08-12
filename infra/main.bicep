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
  openvpnPort: 1194
  maxConnections: 100
  idleTimeoutMinutes: 30
}

@description('Container registry configuration')
param acrConfig object = {
  sku: 'Basic'
  adminUserEnabled: false
  geoReplication: false
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
  runtime: 'dotnet'
  version: '6'
  planSku: 'P1v2'
  alwaysOn: true
}

@description('Network configuration')
param networkConfig object = {
  vnetAddressPrefix: '10.0.0.0/16'
  vpnSubnetPrefix: '10.0.1.0/24'
  functionsSubnetPrefix: '10.0.2.0/24'
  endpointsSubnetPrefix: '10.0.3.0/24'
}

// Generate unique names for resources
var uniqueSuffix = uniqueString(resourceGroup().id, projectName, environment)
var resourceNames = {
  resourceGroup: resourceGroup().name
  acr: 'acr${projectName}${uniqueSuffix}'
  storage: 'st${projectName}${uniqueSuffix}'
  keyVault: 'kv${projectName}${uniqueSuffix}'
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
    openvpnPort: vpnConfig.openvpnPort
    tags: tags
  }
}

// Deploy Azure Container Registry
module acr 'modules/container-registry.bicep' = {
  name: 'acr'
  params: {
    name: resourceNames.acr
    location: location
    sku: acrConfig.sku
    adminUserEnabled: acrConfig.adminUserEnabled
    geoReplication: acrConfig.geoReplication
    tags: tags
  }
}

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
    planSku: functionConfig.planSku
    alwaysOn: functionConfig.alwaysOn
    subnetId: network.outputs.functionsSubnetId
    storageAccountId: storage.outputs.storageAccountId
    keyVaultId: keyVault.outputs.keyVaultId
    appInsightsId: appInsights.outputs.appInsightsId
    tags: tags
  }
}

// Deploy VPN Container Template (for ACI deployments)
module vpnContainer 'modules/vpn-container.bicep' = {
  name: 'vpnContainer'
  params: {
    name: 'vpn-${projectName}-${environment}'
    location: location
    subnetId: network.outputs.vpnSubnetId
    containerRegistryId: acr.outputs.containerRegistryId
    storageAccountId: storage.outputs.storageAccountId
    keyVaultId: keyVault.outputs.keyVaultId
    wireguardPort: vpnConfig.wireguardPort
    openvpnPort: vpnConfig.openvpnPort
    maxConnections: vpnConfig.maxConnections
    tags: tags
  }
}

// Deploy Monitoring and Alerting
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    functionAppId: functionApp.outputs.functionAppId
    vpnContainerId: vpnContainer.outputs.containerGroupId
    tags: tags
  }
}

// Outputs
output resourceGroupName string = resourceGroup().name
output location string = location
output containerRegistryName string = resourceNames.acr
output containerRegistryLoginServer string = acr.outputs.loginServer
output storageAccountName string = resourceNames.storage
output keyVaultName string = resourceNames.keyVault
output functionAppName string = resourceNames.functionApp
output virtualNetworkName string = resourceNames.vnet
output logAnalyticsWorkspaceName string = resourceNames.logAnalytics
output applicationInsightsName string = resourceNames.appInsights
output vpnContainerGroupName string = vpnContainer.outputs.containerGroupName
output vpnContainerGroupId string = vpnContainer.outputs.containerGroupId
