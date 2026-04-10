// runtime-only: used by StartVPN function via @azure/arm-containerinstance
// This template is NOT deployed by main.bicep. It documents the container group
// spec that StartVPN creates at runtime. See src/functions/StartVPN/index.js.

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

@description('Storage Account ID')
param storageAccountId string

@description('Key Vault ID')
param keyVaultId string

@description('WireGuard VPN port')
param wireguardPort int = 51820

@description('Maximum connections')
param maxConnections int = 100

@description('Container image — public GHCR image, no credentials required')
param containerImage string = 'ghcr.io/<your-github-org>/az-demand-vpn-wg:latest'

@description('Container CPU cores')
param cpuCores int = 1

@description('Container memory in GB')
param memoryInGB int = 2

@description('Restart policy')
@allowed(['Always', 'Never', 'OnFailure'])
param restartPolicy string = 'Always'

@description('Enable VNet integration')
param enableVNetIntegration bool = true

@description('Enable public IP')
param enablePublicIP bool = true

var storageAccountName = last(split(storageAccountId, '/'))

// Container Group
// NOTE: storageAccountKey uses listKeys() because ACI Azure Files mounts do not
// yet support managed identity auth. The key is used only for the volume mount
// resource property and is not stored in app settings or Key Vault.
resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
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
              value: storageAccountName
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
            exec: {
              command: [
                'wg'
                'show'
              ]
            }
            initialDelaySeconds: 10
            periodSeconds: 30
          }
        }
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
          storageAccountName: storageAccountName
          storageAccountKey: listKeys(storageAccountId, '2023-01-01').keys[0].value
        }
      }
      {
        name: 'vpn-keys'
        azureFile: {
          shareName: 'vpn-keys'
          storageAccountName: storageAccountName
          storageAccountKey: listKeys(storageAccountId, '2023-01-01').keys[0].value
        }
      }
      {
        name: 'vpn-logs'
        azureFile: {
          shareName: 'vpn-logs'
          storageAccountName: storageAccountName
          storageAccountKey: listKeys(storageAccountId, '2023-01-01').keys[0].value
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
