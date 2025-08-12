@description('Azure Function App for VPN orchestration')
@minLength(1)
@maxLength(60)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Runtime stack')
@allowed(['dotnet', 'node', 'python', 'java', 'powershell', 'custom'])
param runtime string = 'dotnet'

@description('Runtime version')
param version string = '6'

@description('App Service Plan SKU')
@allowed(['F1', 'D1', 'B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'P1V2', 'P2V2', 'P3V2', 'P1V3', 'P2V3', 'P3V3'])
param planSku string = 'P1V2'

@description('Always on setting')
param alwaysOn bool = true

@description('Subnet ID for VNet integration')
param subnetId string

@description('Storage Account ID')
param storageAccountId string

@description('Key Vault ID')
param keyVaultId string

@description('Application Insights ID')
param appInsightsId string

@description('Enable managed identity')
param enableManagedIdentity bool = true

@description('Enable VNet integration')
param enableVNetIntegration bool = true

@description('Enable private endpoints')
param enablePrivateEndpoints bool = false

@description('Private endpoints subnet ID')
param privateEndpointsSubnetId string = ''

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: planSku
    tier: contains(planSku, 'F') ? 'Free' : contains(planSku, 'B') ? 'Basic' : contains(planSku, 'S') ? 'Standard' : 'PremiumV2'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
    perSiteScaling: false
    elasticScaleEnabled: false
    maximumElasticWorkerCount: 1
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp'
  identity: enableManagedIdentity ? {
    type: 'SystemAssigned'
  } : null
  properties: {
    serverFarmId: appServicePlan.id
    reserved: true
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${last(split(storageAccountId, '/'))};AccountKey=${last(split(storageAccountId, '/'))};EndpointSuffix=core.windows.net'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~${version}'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: runtime
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${last(split(storageAccountId, '/'))};AccountKey=${last(split(storageAccountId, '/'))};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: name
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~18'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: last(split(appInsightsId, '/'))
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: last(split(appInsightsId, '/'))
        }
        {
          name: 'KeyVaultUri'
          value: last(split(keyVaultId, '/'))
        }
        {
          name: 'StorageAccountName'
          value: last(split(storageAccountId, '/'))
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
      vnetRouteAllEnabled: enableVNetIntegration
      vnetName: last(split(subnetId, '/'))
      vnetSubnetName: last(split(subnetId, '/'))
    }
    httpsOnly: true
    clientAffinityEnabled: false
    dailyMemoryTimeQuota: 0
  }
}

// VNet Integration
resource vnetIntegration 'Microsoft.Web/sites/networkConfig@2023-01-01' = if (enableVNetIntegration) {
  parent: functionApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: subnetId
    swiftSupported: true
  }
}

// Private endpoint for Function App (if enabled)
resource functionPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (enablePrivateEndpoints) {
  name: '${name}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointsSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-pls'
        properties: {
          privateLinkServiceId: functionApp.id
          groupIds: [
            'sites'
          ]
        }
      }
    ]
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output functionAppUrl string = functionApp.properties.defaultHostName
output appServicePlanId string = appServicePlan.id
output managedIdentityPrincipalId string = functionApp.identity.principalId
