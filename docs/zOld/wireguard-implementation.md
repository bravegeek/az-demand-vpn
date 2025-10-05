# WireGuard Implementation for Container-Based VPN Solution

## Overview
This document details the specific implementation approach for using WireGuard as the VPN protocol in our container-based Azure solution. WireGuard was selected for its superior performance, modern cryptography, and simpler codebase compared to alternatives like OpenVPN or IPsec.

## WireGuard Advantages

- **Performance**: Significantly faster than OpenVPN with lower latency
- **Security**: Modern cryptographic primitives (ChaCha20, Poly1305, BLAKE2, Curve25519)
- **Simplicity**: ~4,000 lines of code vs. 100,000+ for OpenVPN
- **Kernel Integration**: Part of the Linux kernel since version 5.6
- **Low Overhead**: Minimal CPU and memory footprint
- **Quick Connections**: Fast handshakes and reconnections
- **NAT Traversal**: Works well across NATs and firewalls

## Container Configuration

### Base Image
```dockerfile
FROM alpine:latest

# Install WireGuard and dependencies
RUN apk add --no-cache wireguard-tools iptables ip6tables bash

# Add configuration scripts
COPY ./scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY ./scripts/generate-config.sh /usr/local/bin/generate-config.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/generate-config.sh

# Expose WireGuard port
EXPOSE 51820/udp

# Set environment variables
ENV SERVER_PORT=51820
ENV SERVER_INTERFACE=wg0
ENV SERVER_NETWORK=10.8.0.0/24

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

### Entrypoint Script
```bash
#!/bin/bash
set -e

# Generate private key if not exists
if [ ! -f /etc/wireguard/privatekey ]; then
    mkdir -p /etc/wireguard
    wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
    chmod 600 /etc/wireguard/privatekey
fi

# Generate WireGuard configuration
/usr/local/bin/generate-config.sh

# Enable IP forwarding
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.conf
sysctl -p

# Configure NAT
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -A FORWARD -i $SERVER_INTERFACE -j ACCEPT
iptables -A FORWARD -o $SERVER_INTERFACE -j ACCEPT

# Start WireGuard
wg-quick up $SERVER_INTERFACE

# Keep container running
exec tail -f /dev/null
```

### Configuration Generator Script
```bash
#!/bin/bash
set -e

# Load environment variables from Azure Storage if available
if [ -n "$AZURE_STORAGE_CONNECTION_STRING" ]; then
    echo "Loading configuration from Azure Storage..."
    # Code to download configuration from Azure Blob Storage
fi

# Generate server configuration
cat > /etc/wireguard/$SERVER_INTERFACE.conf << EOF
[Interface]
Address = ${SERVER_NETWORK%.*}.1/24
ListenPort = $SERVER_PORT
PrivateKey = $(cat /etc/wireguard/privatekey)
SaveConfig = true

# Client configurations will be added dynamically
EOF

# Apply configuration
echo "WireGuard configuration generated."
```

## Azure Integration

### Azure Container Instance Configuration
```json
{
  "name": "wireguard-vpn",
  "properties": {
    "containers": [
      {
        "name": "wireguard",
        "properties": {
          "image": "your-acr.azurecr.io/wireguard:latest",
          "resources": {
            "requests": {
              "cpu": 1.0,
              "memoryInGB": 1.5
            }
          },
          "ports": [
            {
              "protocol": "UDP",
              "port": 51820
            }
          ],
          "environmentVariables": [
            {
              "name": "AZURE_STORAGE_CONNECTION_STRING",
              "secureValue": "storage-connection-string"
            }
          ],
          "volumeMounts": [
            {
              "name": "wireguard-config",
              "mountPath": "/etc/wireguard"
            }
          ]
        }
      }
    ],
    "osType": "Linux",
    "restartPolicy": "Always",
    "ipAddress": {
      "type": "Public",
      "ports": [
        {
          "protocol": "UDP",
          "port": 51820
        }
      ]
    },
    "volumes": [
      {
        "name": "wireguard-config",
        "azureFile": {
          "shareName": "wireguard-config",
          "storageAccountName": "your-storage-account",
          "storageAccountKey": "storage-account-key"
        }
      }
    ]
  }
}
```

## Client Configuration

### Client Configuration Template
```
[Interface]
PrivateKey = <CLIENT_PRIVATE_KEY>
Address = 10.8.0.X/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = <SERVER_PUBLIC_KEY>
Endpoint = <SERVER_PUBLIC_IP>:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```

### Client Configuration Generation
The Azure Function that provisions the VPN will generate client configurations dynamically:

1. Generate client private/public key pair
2. Assign an available IP from the VPN subnet
3. Create client configuration using the template
4. Add client public key to server configuration
5. Restart WireGuard service to apply changes
6. Return client configuration to user

## Azure Function Implementation

### StartVPN Function
```javascript
module.exports = async function (context, req) {
    const { DefaultAzureCredential } = require("@azure/identity");
    const { ContainerInstanceManagementClient } = require("@azure/arm-containerinstance");
    const { BlobServiceClient } = require("@azure/storage-blob");
    
    // Authentication
    const credential = new DefaultAzureCredential();
    
    // Create Container Instance client
    const client = new ContainerInstanceManagementClient(credential, process.env.SUBSCRIPTION_ID);
    
    try {
        // Check if container group exists
        const exists = await containerExists(client);
        
        if (!exists) {
            // Generate WireGuard configuration
            const { serverConfig, clientConfig } = await generateWireGuardConfig();
            
            // Upload configuration to Azure Storage
            await uploadConfiguration(serverConfig);
            
            // Create container instance
            const containerGroup = await client.containerGroups.beginCreateOrUpdate(
                process.env.RESOURCE_GROUP,
                "wireguard-vpn",
                containerGroupDefinition
            );
            
            // Get public IP address
            const publicIp = containerGroup.ipAddress.ip;
            
            // Update client configuration with public IP
            const finalClientConfig = clientConfig.replace("<SERVER_PUBLIC_IP>", publicIp);
            
            context.res = {
                status: 200,
                body: {
                    status: "VPN started",
                    clientConfig: finalClientConfig
                }
            };
        } else {
            context.res = {
                status: 200,
                body: {
                    status: "VPN already running"
                }
            };
        }
    } catch (error) {
        context.log.error(error);
        context.res = {
            status: 500,
            body: {
                status: "Error starting VPN",
                error: error.message
            }
        };
    }
};
```

### StopVPN Function
```javascript
module.exports = async function (context, req) {
    const { DefaultAzureCredential } = require("@azure/identity");
    const { ContainerInstanceManagementClient } = require("@azure/arm-containerinstance");
    
    // Authentication
    const credential = new DefaultAzureCredential();
    
    // Create Container Instance client
    const client = new ContainerInstanceManagementClient(credential, process.env.SUBSCRIPTION_ID);
    
    try {
        // Delete container group
        await client.containerGroups.beginDelete(
            process.env.RESOURCE_GROUP,
            "wireguard-vpn"
        );
        
        context.res = {
            status: 200,
            body: {
                status: "VPN stopped"
            }
        };
    } catch (error) {
        context.log.error(error);
        context.res = {
            status: 500,
            body: {
                status: "Error stopping VPN",
                error: error.message
            }
        };
    }
};
```

## Security Considerations

### Key Management
- Private keys are generated on first container startup
- Keys are stored in Azure Storage with encryption at rest
- Server private key never leaves the container
- Client private keys are generated on-demand and delivered securely

### Network Security
- Container NSG restricts traffic to WireGuard UDP port only
- WireGuard's cryptographic authentication prevents unauthorized access
- No ports exposed except the WireGuard port (51820/UDP)

### Authentication
- WireGuard uses cryptographic authentication (public/private key pairs)
- Azure Functions use Azure AD authentication to restrict access
- Optional: Integrate with Azure AD for user-based access control

## Monitoring and Logging

### Container Logs
- WireGuard connection logs
- Authentication attempts
- Error messages

### Azure Monitor Integration
- Container health metrics
- Network traffic metrics
- Connection counts

### Custom Metrics
- Active VPN sessions
- Bandwidth utilization
- Connection durations

## Performance Optimization

### Container Sizing
- Start with 1 vCPU, 1.5 GB RAM
- Monitor CPU and memory usage
- Scale up if needed for higher throughput

### Network Optimization
- Enable TCP BBR congestion control if available
- Optimize MTU settings for better performance
- Consider premium networking for higher bandwidth

## Client Support

WireGuard clients are available for all major platforms:

- **Windows**: Official WireGuard client
- **macOS**: Official WireGuard client
- **Linux**: Native kernel support or wireguard-tools
- **iOS**: Official WireGuard app
- **Android**: Official WireGuard app

## Implementation Steps

1. Create Docker image with WireGuard configuration
2. Push image to Azure Container Registry
3. Set up Azure Storage for configuration persistence
4. Implement Azure Functions for orchestration
5. Create client configuration generator
6. Set up monitoring and logging
7. Test VPN connectivity and performance
8. Document user onboarding process

## Next Steps

1. Create the Docker image and test locally
2. Set up CI/CD pipeline for container builds
3. Implement the Azure Functions code
4. Test the end-to-end provisioning process
5. Create user documentation for client setup
