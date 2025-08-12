@description('Azure Container Registry for VPN container images')
@minLength(5)
@maxLength(50)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('ACR SKU')
@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Basic'

@description('Enable admin user access')
param adminUserEnabled bool = false

@description('Enable geo-replication')
param geoReplication bool = false

@description('Enable data endpoint')
param dataEndpointEnabled bool = false

@description('Enable zone redundancy')
param zoneRedundancy bool = false

@description('Enable public network access')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'

@description('Enable quarantine')
param quarantinePolicyEnabled bool = false

@description('Enable trust policy')
param trustPolicyEnabled bool = false

@description('Enable retention policy')
param retentionPolicyEnabled bool = false

@description('Retention policy days')
param retentionPolicyDays int = 7

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: adminUserEnabled
    dataEndpointEnabled: dataEndpointEnabled
    zoneRedundancy: zoneRedundancy
    publicNetworkAccess: publicNetworkAccess
    quarantinePolicy: {
      status: quarantinePolicyEnabled ? 'enabled' : 'disabled'
    }
    trustPolicy: {
      status: trustPolicyEnabled ? 'enabled' : 'disabled'
    }
    retentionPolicy: {
      days: retentionPolicyDays
      status: retentionPolicyEnabled ? 'enabled' : 'disabled'
    }
  }
}

// Geo-replication if enabled and Premium SKU
resource geoReplicationResource 'Microsoft.ContainerRegistry/registries/replications@2023-07-01' = if (geoReplication && sku == 'Premium') {
  parent: containerRegistry
  name: location == 'East US' ? 'westus2' : 'eastus'
  location: location == 'East US' ? 'West US 2' : 'East US'
  properties: {}
}

output containerRegistryId string = containerRegistry.id
output containerRegistryName string = containerRegistry.name
output loginServer string = containerRegistry.properties.loginServer
output adminUsername string = containerRegistry.listCredentials().username
output adminPassword string = containerRegistry.listCredentials().passwords[0].value
