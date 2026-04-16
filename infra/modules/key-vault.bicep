@description('Azure Key Vault for secure storage of certificates and secrets')
@minLength(3)
@maxLength(24)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Key Vault SKU')
@allowed(['standard', 'premium'])
param sku string = 'standard'

@description('Enable soft delete')
param enableSoftDelete bool = true

@description('Soft delete retention in days')
param softDeleteRetentionInDays int = 90

@description('Enable purge protection')
param enablePurgeProtection bool = true

@description('Enable RBAC authorization')
param enableRbacAuthorization bool = true

@description('Virtual Network ID — used for private DNS zone link when enablePrivateEndpoints is true')
param vnetId string

@description('Functions subnet ID — granted service endpoint access to Key Vault')
param functionsSubnetId string

@description('VPN subnet ID — granted service endpoint access to Key Vault (not strictly needed today, but forward-compatible)')
param vpnSubnetId string

@description('Private endpoints subnet ID')
param endpointsSubnetId string

@description('Enable private endpoints (use false for service endpoints, true for production)')
param enablePrivateEndpoints bool = false

// Service endpoints use the public hostname routed over the Azure backbone.
// publicNetworkAccess must be Enabled for service endpoints to work; private endpoints can lock it down fully.
var effectivePublicNetworkAccess = enablePrivateEndpoints ? 'Disabled' : 'Enabled'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: sku
    }
    tenantId: subscription().tenantId
    enableSoftDelete: enableSoftDelete
    softDeleteRetentionInDays: softDeleteRetentionInDays
    enablePurgeProtection: enablePurgeProtection
    enableRbacAuthorization: enableRbacAuthorization
    publicNetworkAccess: effectivePublicNetworkAccess
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      ipRules: []
      virtualNetworkRules: [
        { id: functionsSubnetId, ignoreMissingVnetServiceEndpoint: false }
        { id: vpnSubnetId, ignoreMissingVnetServiceEndpoint: false }
      ]
    }
  }
}

// Private endpoint for Key Vault
resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (enablePrivateEndpoints) {
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
          privateLinkServiceId: keyVault.id
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

// Private DNS zone for Key Vault
resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

// Link private DNS zone to VNet
resource keyVaultPrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: keyVaultPrivateDnsZone
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
resource keyVaultPrivateDnsRecord 'Microsoft.Network/privateDnsZones/A@2020-06-01' = if (enablePrivateEndpoints) {
  parent: keyVaultPrivateDnsZone
  name: name
  properties: {
    ttl: 300
    aRecords: [
      {
        ipv4Address: keyVaultPrivateEndpoint.properties.customDnsConfigs[0].ipAddresses[0]
      }
    ]
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
