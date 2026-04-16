@description('Azure Function App for VPN orchestration')
@minLength(1)
@maxLength(60)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Runtime stack')
@allowed(['node', 'python', 'java', 'powershell', 'custom'])
param runtime string = 'node'

@description('Runtime version')
param version string = '20'

@description('Subnet ID for VNet integration')
param subnetId string

@description('Key Vault URI (e.g. https://kv-name.vault.azure.net/)')
param keyVaultUri string

@description('Application Insights ID')
param appInsightsId string

@description('VPN subnet resource ID — passed to VPN containers for VNet integration')
param vpnSubnetId string

@description('Container image reference for WireGuard VPN containers')
param vpnContainerImage string

@description('Minutes of inactivity before AutoShutdown reaps a VPN container')
param idleTimeoutMinutes int = 30

@description('WireGuard tunnel subnet in CIDR notation (e.g. 10.8.0.0/24)')
param tunnelSubnet string = '10.8.0.0/24'

@description('DNS server for VPN clients')
param dnsServer string = '1.1.1.1'

@description('Resource ID of the UserAssigned managed identity for VPN containers')
param containerIdentityId string

@description('Storage account name (passed explicitly to avoid runtime split on resource ID)')
param storageAccountName string

var storageTableEndpoint = 'https://${storageAccountName}.table.core.windows.net'

// Flex Consumption App Service Plan — supports VNet integration at Consumption pricing
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: reference(appInsightsId, '2020-02-02').ConnectionString
        }
        {
          name: 'KeyVaultUri'
          value: keyVaultUri
        }
        {
          name: 'StorageAccountName'
          value: storageAccountName
        }
        {
          name: 'AZURE_SUBSCRIPTION_ID'
          value: subscription().subscriptionId
        }
        {
          name: 'AZURE_RESOURCE_GROUP'
          value: resourceGroup().name
        }
        {
          name: 'VPN_SUBNET_ID'
          value: vpnSubnetId
        }
        {
          name: 'VPN_CONTAINER_IMAGE'
          value: vpnContainerImage
        }
        {
          name: 'VPN_IDLE_TIMEOUT_MINUTES'
          value: string(idleTimeoutMinutes)
        }
        {
          name: 'VPN_TUNNEL_SUBNET'
          value: tunnelSubnet
        }
        {
          name: 'VPN_DNS_SERVER'
          value: dnsServer
        }
        {
          name: 'STORAGE_TABLE_ENDPOINT'
          value: storageTableEndpoint
        }
        {
          name: 'VPN_CONTAINER_IDENTITY_ID'
          value: containerIdentityId
        }
      ]
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      cors: {
        allowedOrigins: [
          'https://portal.azure.com'
        ]
        supportCredentials: true
      }
    }
    // Flex Consumption: runtime and deployment storage configured here, not in appSettings
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: 'https://${storageAccountName}.blob.core.windows.net/azure-webjobs-hosts'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 100
        instanceMemoryMB: 2048
      }
      runtime: {
        name: runtime
        version: version
      }
    }
    // Flex Consumption VNet integration: set subnet directly on site properties
    // NOTE: subnet delegation must be Microsoft.App/environments (not Microsoft.Web/serverFarms)
    virtualNetworkSubnetId: subnetId
    httpsOnly: true
    clientAffinityEnabled: false
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output functionAppUrl string = functionApp.properties.defaultHostName
output appServicePlanId string = appServicePlan.id
output managedIdentityPrincipalId string = functionApp.identity.principalId
