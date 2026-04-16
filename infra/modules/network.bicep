@description('Network infrastructure for VPN solution')
@minLength(1)
@maxLength(80)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Virtual Network address prefix')
param addressPrefix string = '10.0.0.0/16'

@description('VPN subnet address prefix')
param vpnSubnetPrefix string = '10.0.1.0/24'

@description('Functions subnet address prefix')
param functionsSubnetPrefix string = '10.0.2.0/24'

@description('Private endpoints subnet address prefix')
param endpointsSubnetPrefix string = '10.0.3.0/24'

@description('WireGuard VPN port')
param wireguardPort int = 51820

// Virtual Network
resource virtualNetwork 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-vpn'
        properties: {
          addressPrefix: vpnSubnetPrefix
          networkSecurityGroup: {
            id: vpnNsg.id
          }
          serviceEndpoints: [
            { service: 'Microsoft.Storage' }
            { service: 'Microsoft.KeyVault' }
          ]
          delegations: [
            {
              name: 'Microsoft.ContainerInstance.containerGroups'
              properties: {
                serviceName: 'Microsoft.ContainerInstance/containerGroups'
              }
            }
          ]
        }
      }
      {
        name: 'snet-functions'
        properties: {
          addressPrefix: functionsSubnetPrefix
          networkSecurityGroup: {
            id: functionsNsg.id
          }
          serviceEndpoints: [
            { service: 'Microsoft.Storage' }
            { service: 'Microsoft.KeyVault' }
          ]
          delegations: [
            {
              // Flex Consumption Functions require Microsoft.App/environments delegation
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-endpoints'
        properties: {
          addressPrefix: endpointsSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
    enableDdosProtection: false
    enableVmProtection: false
  }
}

// VPN Subnet NSG
resource vpnNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: '${name}-vpn-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowWireGuard'
        properties: {
          priority: 100
          protocol: 'Udp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: string(wireguardPort)
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          protocol: '*'
          access: 'Deny'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// Functions Subnet NSG
resource functionsNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: '${name}-functions-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        // # Reason: Flex Consumption uses this subnet for outbound VNet integration only.
        // Inbound HTTPS is not triggered via the subnet, but the Azure scale controller
        // and health probes require this rule to be present for platform management traffic.
        name: 'AllowHTTPS'
        properties: {
          priority: 100
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          protocol: '*'
          access: 'Deny'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

output vnetId string = virtualNetwork.id
output vnetName string = virtualNetwork.name
// # Reason: resourceId keyed on subnet name is stable regardless of subnet order in the array
output vpnSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', virtualNetwork.name, 'snet-vpn')
output functionsSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', virtualNetwork.name, 'snet-functions')
output endpointsSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', virtualNetwork.name, 'snet-endpoints')
output vpnNsgId string = vpnNsg.id
output functionsNsgId string = functionsNsg.id
