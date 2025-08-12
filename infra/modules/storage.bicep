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

@description('Virtual Network ID')
param vnetId string

@description('Private endpoints subnet ID')
param endpointsSubnetId string

@description('Enable private endpoints')
param enablePrivateEndpoints bool = true

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
      virtualNetworkRules: [
        {
          virtualNetworkResourceId: vnetId
          action: 'Allow'
        }
      ]
      ipRules: []
    }
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// Blob containers for VPN configuration
resource vpnConfigsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: storageAccount
  name: 'vpn-configs'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'VPN Configuration Files'
      type: 'WireGuard-OpenVPN'
    }
  }
}

resource vpnKeysContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: storageAccount
  name: 'vpn-keys'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'VPN Key Pairs'
      type: 'Public-Private Keys'
    }
  }
}

resource vpnLogsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: storageAccount
  name: 'vpn-logs'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'VPN Connection Logs'
      type: 'Audit Trail'
    }
  }
}

// Private endpoint for storage account
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

// DNS A record for private endpoint
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

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output primaryBlobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output primaryQueueEndpoint string = storageAccount.properties.primaryEndpoints.queue
output primaryTableEndpoint string = storageAccount.properties.primaryEndpoints.table
output primaryFileEndpoint string = storageAccount.properties.primaryEndpoints.file
output primaryAccessKey string = storageAccount.listKeys().keys[0].value
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
