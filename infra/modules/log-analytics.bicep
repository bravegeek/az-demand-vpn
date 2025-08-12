@description('Log Analytics Workspace for monitoring and logging')
@minLength(1)
@maxLength(63)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Retention period in days')
param retentionInDays int = 30

@description('SKU for Log Analytics Workspace')
@allowed(['Free', 'PerNode', 'Premium', 'Standard', 'Standalone', 'Unlimited', 'CapacityReservation'])
param sku string = 'Standard'

@description('Daily quota for ingestion in GB')
param dailyQuotaGb int = -1

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: sku
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
  }
}

output workspaceId string = logAnalyticsWorkspace.id
output workspaceName string = logAnalyticsWorkspace.name
output customerId string = logAnalyticsWorkspace.properties.customerId
output primarySharedKey string = logAnalyticsWorkspace.listKeys().primarySharedKey
