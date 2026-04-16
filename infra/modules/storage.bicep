@description('Storage Account for VPN configuration and data storage')
@minLength(3)
@maxLength(24)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Storage account SKU')
@allowed(['Standard_LRS', 'Standard_GRS', 'Standard_RAGRS', 'Standard_ZRS', 'Premium_LRS', 'Premium_ZRS'])
param sku string = 'Standard_LRS'

@description('Access tier for blob storage')
@allowed(['Hot', 'Cool', 'Archive'])
param accessTier string = 'Hot'

@description('Allow public access to blobs')
param allowBlobPublicAccess bool = false

@description('Allow shared key access')
param allowSharedKeyAccess bool = false

@description('Enable hierarchical namespace')
param enableHierarchicalNamespace bool = false

@description('Virtual Network ID — used for private DNS zone link when enablePrivateEndpoints is true')
param vnetId string

@description('Functions subnet ID — granted service endpoint access to storage')
param functionsSubnetId string

@description('VPN subnet ID — granted service endpoint access to storage (heartbeat writes)')
param vpnSubnetId string

@description('Private endpoints subnet ID')
param endpointsSubnetId string

@description('Enable private endpoints (use false for service endpoints, true for production)')
param enablePrivateEndpoints bool = false

@description('Enable blob encryption')
param enableBlobEncryption bool = true

@description('Enable file encryption')
param enableFileEncryption bool = true

@description('Enable table encryption')
param enableTableEncryption bool = true

@description('Enable queue encryption')
param enableQueueEncryption bool = true

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'StorageV2'
  properties: {
    accessTier: accessTier
    allowBlobPublicAccess: allowBlobPublicAccess
    allowSharedKeyAccess: allowSharedKeyAccess
    isHnsEnabled: enableHierarchicalNamespace
    encryption: {
      services: {
        blob: {
          enabled: enableBlobEncryption
        }
        file: {
          enabled: enableFileEncryption
        }
        table: {
          enabled: enableTableEncryption
        }
        queue: {
          enabled: enableQueueEncryption
        }
      }
      keySource: 'Microsoft.Storage'
    }
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        { id: functionsSubnetId, action: 'Allow' }
        { id: vpnSubnetId, action: 'Allow' }
      ]
      ipRules: []
    }
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// Blob service (required as intermediate parent for containers)
resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// Private endpoint for blob storage
resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (enablePrivateEndpoints) {
  name: '${name}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: endpointsSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-pls'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

// Private DNS zone for storage
resource storagePrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.blob.core.windows.net'
  location: 'global'
  tags: tags
}

// Link private DNS zone to VNet
resource storagePrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: storagePrivateDnsZone
  name: '${name}-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnetId
    }
    registrationEnabled: false
  }
}

// DNS A record for blob private endpoint
resource storagePrivateDnsRecord 'Microsoft.Network/privateDnsZones/A@2020-06-01' = if (enablePrivateEndpoints) {
  parent: storagePrivateDnsZone
  name: name
  properties: {
    ttl: 300
    aRecords: [
      {
        ipv4Address: storagePrivateEndpoint.properties.customDnsConfigs[0].ipAddresses[0]
      }
    ]
  }
}

// Private endpoint for table storage (session state and heartbeat writes)
resource storageTablePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (enablePrivateEndpoints) {
  name: '${name}-table-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: endpointsSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-table-pls'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [
            'table'
          ]
        }
      }
    ]
  }
}

resource storageTablePrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.table.core.windows.net'
  location: 'global'
  tags: tags
}

resource storageTablePrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: storageTablePrivateDnsZone
  name: '${name}-table-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnetId
    }
    registrationEnabled: false
  }
}

resource storageTablePrivateDnsRecord 'Microsoft.Network/privateDnsZones/A@2020-06-01' = if (enablePrivateEndpoints) {
  parent: storageTablePrivateDnsZone
  name: name
  properties: {
    ttl: 300
    aRecords: [
      {
        ipv4Address: storageTablePrivateEndpoint.properties.customDnsConfigs[0].ipAddresses[0]
      }
    ]
  }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output primaryBlobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output primaryQueueEndpoint string = storageAccount.properties.primaryEndpoints.queue
output primaryTableEndpoint string = storageAccount.properties.primaryEndpoints.table
output primaryFileEndpoint string = storageAccount.properties.primaryEndpoints.file
