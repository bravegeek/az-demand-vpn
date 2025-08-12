@description('VPN Container for Azure Container Instances')
@minLength(1)
@maxLength(63)
param name string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Tags to apply to the resource')
param tags object = {}

@description('Subnet ID for VNet integration')
param subnetId string

@description('Container Registry ID')
param containerRegistryId string

@description('Storage Account ID')
param storageAccountId string

@description('Key Vault ID')
param keyVaultId string

@description('WireGuard VPN port')
param wireguardPort int = 51820

@description('OpenVPN port')
param openvpnPort int = 1194

@description('Maximum connections')
param maxConnections int = 100

@description('Container image')
param containerImage string = 'wireguard/wireguard:latest'

@description('Container CPU cores')
param cpuCores int = 1

@description('Container memory in GB')
param memoryInGB int = 2

@description('Restart policy')
@allowed(['Always', 'Never', 'OnFailure'])
param restartPolicy string = 'Always'

@description('Enable managed identity')
param enableManagedIdentity bool = true

@description('Enable VNet integration')
param enableVNetIntegration bool = true

@description('Enable public IP')
param enablePublicIP bool = true

// Container Group
resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: enableManagedIdentity ? {
    type: 'SystemAssigned'
  } : null
  properties: {
    containers: [
      {
        name: 'vpn-server'
        properties: {
          image: containerImage
          resources: {
            requests: {
              cpu: cpuCores
              memoryInGB: memoryInGB
            }
          }
          ports: [
            {
              port: wireguardPort
              protocol: 'UDP'
            }
            {
              port: openvpnPort
              protocol: 'UDP'
            }
            {
              port: 443
              protocol: 'TCP'
            }
          ]
          environmentVariables: [
            {
              name: 'VPN_PORT'
              value: string(wireguardPort)
            }
            {
              name: 'MAX_CONNECTIONS'
              value: string(maxConnections)
            }
            {
              name: 'STORAGE_ACCOUNT'
              value: last(split(storageAccountId, '/'))
            }
            {
              name: 'KEY_VAULT'
              value: last(split(keyVaultId, '/'))
            }
          ]
          volumeMounts: [
            {
              name: 'vpn-config'
              mountPath: '/etc/wireguard'
            }
            {
              name: 'vpn-keys'
              mountPath: '/etc/wireguard/keys'
            }
            {
              name: 'vpn-logs'
              mountPath: '/var/log/vpn'
            }
          ]
          livenessProbe: {
            httpGet: {
              path: '/health'
              port: 8080
            }
            initialDelaySeconds: 30
            periodSeconds: 10
          }
          readinessProbe: {
            httpGet: {
              path: '/ready'
              port: 8080
            }
            initialDelaySeconds: 5
            periodSeconds: 5
          }
        }
      }
    ]
    imageRegistryCredentials: [
      {
        server: last(split(containerRegistryId, '/'))
        username: '${last(split(containerRegistryId, '/'))}'
        password: '${last(split(containerRegistryId, '/'))}'
      }
    ]
    restartPolicy: restartPolicy
    ipAddress: enablePublicIP ? {
      type: 'Public'
      ports: [
        {
          protocol: 'UDP'
          port: wireguardPort
        }
        {
          protocol: 'UDP'
          port: openvpnPort
        }
        {
          protocol: 'TCP'
          port: 443
        }
      ]
      dnsNameLabel: name
    } : null
    subnetIds: enableVNetIntegration ? [
      {
        id: subnetId
      }
    ] : []
    volumes: [
      {
        name: 'vpn-config'
        azureFile: {
          shareName: 'vpn-configs'
          storageAccountName: last(split(storageAccountId, '/'))
          storageAccountKey: last(split(storageAccountId, '/'))
        }
      }
      {
        name: 'vpn-keys'
        azureFile: {
          shareName: 'vpn-keys'
          storageAccountName: last(split(storageAccountId, '/'))
          storageAccountKey: last(split(storageAccountId, '/'))
        }
      }
      {
        name: 'vpn-logs'
        azureFile: {
          shareName: 'vpn-logs'
          storageAccountName: last(split(storageAccountId, '/'))
          storageAccountKey: last(split(storageAccountId, '/'))
        }
      }
    ]
    osType: 'Linux'
  }
}

output containerGroupId string = containerGroup.id
output containerGroupName string = containerGroup.name
output containerGroupFqdn string = containerGroup.properties.ipAddress.fqdn
output containerGroupIP string = containerGroup.properties.ipAddress.ip
output managedIdentityPrincipalId string = containerGroup.identity.principalId
