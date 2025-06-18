# JavaScript Implementation Guide for Azure Demand VPN

## Overview
This document provides guidelines and standards for implementing Azure Functions using JavaScript for the Azure Demand VPN project. It ensures consistency, maintainability, and best practices across the codebase.

## Table of Contents

1. [Function Architecture Overview](#1-function-architecture-overview)
2. [Development Setup Guide](#2-development-setup-guide)
3. [Authentication and Security Patterns](#3-authentication-and-security-patterns)
4. [Azure SDK Usage Guidelines](#4-azure-sdk-usage-guidelines)
5. [Function-Specific Implementation Details](#5-function-specific-implementation-details)
6. [Testing Framework](#6-testing-framework)
7. [Deployment Pipeline](#7-deployment-pipeline)
8. [Monitoring and Logging Standards](#8-monitoring-and-logging-standards)
9. [Error Handling and Retry Policies](#9-error-handling-and-retry-policies)
10. [Code Examples](#10-code-examples)

## 1. Function Architecture Overview
- Document the overall structure of your Azure Functions
- Include a diagram showing how functions interact with Azure services
- Define naming conventions and organization patterns

## 2. Development Setup Guide

### Node.js Requirements
- **Node.js version**: 16.x LTS or 18.x LTS (recommended)
- **npm version**: 8.x or higher
- **Verify installation**: Run `node -v` and `npm -v` to confirm versions

### Required npm Packages

#### Core Dependencies
```json
{
  "dependencies": {
    "@azure/functions": "^3.5.0",
    "@azure/identity": "^3.1.0",
    "@azure/keyvault-secrets": "^4.6.0",
    "@azure/storage-blob": "^12.13.0",
    "@azure/storage-queue": "^12.12.0",
    "@azure/storage-table": "^12.8.0",
    "@azure/arm-containerinstance": "^9.1.0",
    "axios": "^1.3.4"
  }
}
```

#### Development Dependencies
```json
{
  "devDependencies": {
    "eslint": "^8.36.0",
    "eslint-config-airbnb-base": "^15.0.0",
    "eslint-plugin-import": "^2.27.5",
    "jest": "^29.5.0",
    "prettier": "^2.8.4",
    "azure-functions-core-tools": "^4.0.5198"
  }
}
```

### Local Development Environment Setup

#### 1. Install Azure Functions Core Tools

Option 1: Using npm (recommended)
```bash
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

Option 2: Using Chocolatey (Windows)
```bash
choco install azure-functions-core-tools
```

#### 2. Install Azure CLI
- Download and install from [https://docs.microsoft.com/en-us/cli/azure/install-azure-cli](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
- Authenticate with: `az login`

#### 3. Clone the Repository
```bash
git clone <repository-url>
cd az-demand-vpn
npm install
```

#### 4. Local Settings Configuration
- Create a `local.settings.json` file in your function app root:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "KeyVaultName": "your-key-vault-name",
    "ContainerRegistryName": "your-acr-name",
    "StorageAccountName": "your-storage-account",
    "VpnImageName": "wireguard:latest"
  }
}
```

#### 5. Azure Storage Emulator
- Install and start Azurite for local storage emulation:
```bash
npm install -g azurite
azurite --silent --location c:\azurite --debug c:\azurite\debug.log
```

### VS Code Configuration

#### Recommended Extensions
- Azure Functions (`ms-azuretools.vscode-azurefunctions`)
- Azure Account (`ms-vscode.azure-account`)
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- JavaScript and TypeScript Nightly (`ms-vscode.vscode-typescript-next`)

#### Workspace Settings
Create a `.vscode/settings.json` file with the following configuration:

```json
{
  "azureFunctions.deploySubpath": ".",
  "azureFunctions.postDeployTask": "npm install",
  "azureFunctions.projectLanguage": "JavaScript",
  "azureFunctions.projectRuntime": "~4",
  "debug.internalConsoleOptions": "neverOpen",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.tabSize": 2,
  "eslint.validate": ["javascript"],
  "files.eol": "\n"
}
```

#### Launch Configuration
Create a `.vscode/launch.json` file:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to Node Functions",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "preLaunchTask": "func: host start"
    }
  ]
}
```

#### Tasks Configuration
Create a `.vscode/tasks.json` file:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "func",
      "command": "host start",
      "problemMatcher": "$func-node-watch",
      "isBackground": true,
      "dependsOn": "npm install"
    }
  ]
}
```

### Running Functions Locally

1. Start the local Functions runtime:
```bash
func start
```

2. Test HTTP-triggered functions using tools like Postman or cURL:
```bash
curl http://localhost:7071/api/StartVPN -H "Content-Type: application/json" -d '{"userId": "user123"}'
```

### Debugging Tips

- Use VS Code's built-in debugger by pressing F5
- Add console.log statements for quick debugging
- Set breakpoints in VS Code
- Check function logs in the terminal
- Use Application Insights for more advanced tracing

## 3. Authentication and Security Patterns

### Azure Identity Integration

#### Using DefaultAzureCredential

The `DefaultAzureCredential` class from the `@azure/identity` package provides a simplified authentication flow that works across different environments:

```javascript
const { DefaultAzureCredential } = require('@azure/identity');

// Create a credential instance once and reuse it
const credential = new DefaultAzureCredential();

// Use the credential with any Azure SDK client
const secretClient = new SecretClient(vaultUrl, credential);
const blobServiceClient = new BlobServiceClient(storageUrl, credential);
```

#### Authentication Flow

The `DefaultAzureCredential` tries multiple authentication methods in this order:

1. Environment variables (service principal credentials)
2. Managed Identity (when deployed to Azure)
3. Visual Studio Code credentials (during development)
4. Azure CLI credentials (during development)
5. Interactive browser authentication (as fallback during development)

#### Environment Configuration

**For Local Development:**
No additional configuration needed if you're logged in with Azure CLI or VS Code Azure extension.

**For CI/CD Pipelines:**
Set these environment variables:

```
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
```

**For Azure Functions Deployment:**
Enable managed identity and assign appropriate roles.

### Key Vault Integration

#### Setting Up Key Vault Client

```javascript
const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

// Helper function to get Key Vault client
function getKeyVaultClient() {
  const credential = new DefaultAzureCredential();
  const vaultName = process.env.KeyVaultName;
  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  
  return new SecretClient(vaultUrl, credential);
}

// Get a secret
async function getSecret(secretName) {
  const client = getKeyVaultClient();
  const secret = await client.getSecret(secretName);
  return secret.value;
}

// Set a secret
async function setSecret(secretName, secretValue) {
  const client = getKeyVaultClient();
  await client.setSecret(secretName, secretValue);
}
```

#### Secret Naming Conventions

Follow these naming patterns for secrets:

- `vpn-cert-{userId}`: VPN certificates
- `vpn-config-{userId}`: VPN configurations
- `shared-keys-{purpose}`: Shared encryption keys
- `api-key-{serviceName}`: External API keys

### Security Best Practices

#### Secure Communication

```javascript
const https = require('https');
const axios = require('axios');

// Configure axios with secure defaults
const secureAxios = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: true, // Verify SSL certificates
    minVersion: 'TLSv1.2',    // Enforce TLS 1.2 minimum
  }),
  timeout: 10000,             // Reasonable timeout
  headers: {
    'User-Agent': 'AzureDemandVPN/1.0',
  }
});
```

#### Certificate Management

```javascript
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

async function storeCertificate(userId, certificateData) {
  const credential = new DefaultAzureCredential();
  const storageAccountName = process.env.StorageAccountName;
  const blobServiceClient = new BlobServiceClient(
    `https://${storageAccountName}.blob.core.windows.net`,
    credential
  );
  
  const containerClient = blobServiceClient.getContainerClient('certificates');
  const blobClient = containerClient.getBlobClient(`${userId}.cert`);
  
  await blobClient.upload(certificateData, certificateData.length);
}
```

#### Input Validation

Implement thorough input validation for all function inputs:

```javascript
function validateUserInput(userId) {
  // Ensure userId follows expected pattern
  if (!userId || typeof userId !== 'string' || !/^[a-zA-Z0-9-_]{3,50}$/.test(userId)) {
    throw new Error('Invalid user ID format');
  }
  
  return userId; // Return validated input
}
```

#### Role-Based Access Control

Implement RBAC checks in your functions:

```javascript
const { DefaultAzureCredential } = require('@azure/identity');
const { AuthorizationManagementClient } = require('@azure/arm-authorization');

async function checkUserPermission(userId, action) {
  // This is a simplified example - actual implementation would use
  // Azure AD roles or app-specific permission checks
  
  const credential = new DefaultAzureCredential();
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const authClient = new AuthorizationManagementClient(credential, subscriptionId);
  
  // Check if user has required role assignments
  // Implementation details would depend on your RBAC structure
  
  return true; // Return whether user is authorized
}
```

### Security Headers and CORS

For HTTP-triggered functions, implement security headers:

```javascript
module.exports = async function (context, req) {
  // Function logic here
  
  // Set security headers
  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'",
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cache-Control': 'no-store'
    },
    body: { message: 'Success' }
  };
};
```

### VPN-Specific Security

#### Container Security

```javascript
const { ContainerInstanceManagementClient } = require('@azure/arm-containerinstance');
const { DefaultAzureCredential } = require('@azure/identity');

async function createSecureVpnContainer(userId) {
  const credential = new DefaultAzureCredential();
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const client = new ContainerInstanceManagementClient(credential, subscriptionId);
  
  // Create container with security best practices
  const containerGroup = {
    location: 'eastus',
    containers: [
      {
        name: `vpn-${userId}`,
        image: `${process.env.ContainerRegistryName}.azurecr.io/${process.env.VpnImageName}`,
        resources: {
          requests: {
            memoryInGB: 1.5,
            cpu: 1.0
          }
        },
        ports: [{ port: 51820 }],
        environmentVariables: [
          {
            name: 'VPN_USER_ID',
            value: userId
          }
        ],
        // Security settings
        securityContext: {
          privileged: false // Don't run as privileged container
        }
      }
    ],
    imageRegistryCredentials: [
      {
        server: `${process.env.ContainerRegistryName}.azurecr.io`,
        username: process.env.ACR_USERNAME, // Use Key Vault in production
        password: process.env.ACR_PASSWORD  // Use Key Vault in production
      }
    ],
    osType: 'Linux',
    ipAddress: {
      type: 'Public',
      ports: [{ port: 51820, protocol: 'UDP' }]
    },
    restartPolicy: 'OnFailure'
  };
  
  const resourceGroupName = process.env.RESOURCE_GROUP_NAME;
  const containerGroupName = `vpn-${userId}`;
  
  return await client.containerGroups.beginCreateOrUpdate(
    resourceGroupName,
    containerGroupName,
    containerGroup
  );
}
```

### Security Monitoring

Implement logging for security events:

```javascript
const { ApplicationInsightsClient } = require('@azure/applicationinsights');

function logSecurityEvent(eventType, userId, details) {
  // Log to Application Insights
  const client = new ApplicationInsightsClient();
  
  client.trackEvent({
    name: `Security.${eventType}`,
    properties: {
      userId,
      timestamp: new Date().toISOString(),
      ...details
    }
  });
  
  // For critical security events, consider additional alerting
  if (eventType === 'UnauthorizedAccess' || eventType === 'ConfigurationChange') {
    // Implement alerting logic here
  }
}
```

## 4. Azure SDK Usage Guidelines
- Standard patterns for using Container Instance Management
- Blob Storage interaction patterns
- Error handling conventions

## 5. Function-Specific Implementation Details
- StartVPN function implementation with detailed comments
- StopVPN function implementation with detailed comments
- Health check function implementation
- Auto-shutdown function implementation

## 6. Testing Framework
- Unit testing approach with Jest or Mocha
- Integration testing strategy
- Local vs. cloud testing procedures

## 7. Deployment Pipeline
- CI/CD configuration for JavaScript functions
- Environment variable management
- Versioning strategy

## 8. Monitoring and Logging Standards
- Structured logging format
- Which metrics to track
- Alert configuration

## 9. Error Handling and Retry Policies
- Standard error response format
- Retry strategies for transient failures
- Circuit breaker patterns if applicable

## 10. Code Examples
- Complete, working examples of each function
- Configuration templates
- Common utility functions