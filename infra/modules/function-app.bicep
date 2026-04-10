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

@description('Storage Account ID')
param storageAccountId string

@description('Key Vault ID')
param keyVaultId string

@description('Application Insights ID')
param appInsightsId string

var storageAccountName = last(split(storageAccountId, '/'))

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
          value: 'https://${last(split(keyVaultId, '/'))}.vault.azure.net/'
        }
        {
          name: 'StorageAccountName'
          value: storageAccountName
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
