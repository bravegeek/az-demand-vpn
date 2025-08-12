#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Deploy Azure Demand VPN infrastructure using Bicep templates

.DESCRIPTION
    This script deploys the complete Azure Demand VPN infrastructure including:
    - Virtual Network with subnets
    - Azure Container Registry
    - Storage Account with private endpoints
    - Key Vault with private endpoints
    - Function App with VNet integration
    - VPN Container template
    - Monitoring and alerting

.PARAMETER ResourceGroupName
    Name of the resource group to deploy to

.PARAMETER Location
    Azure region for deployment (default: East US 2)

.PARAMETER Environment
    Environment name: dev, test, or prod (default: dev)

.PARAMETER ProjectName
    Project name for resource naming (default: demandvpn)

.PARAMETER WhatIf
    Run in What-If mode to preview changes

.EXAMPLE
    .\deploy.ps1 -ResourceGroupName "rg-demand-vpn-dev" -Environment "dev"

.EXAMPLE
    .\deploy.ps1 -ResourceGroupName "rg-demand-vpn-prod" -Environment "prod" -WhatIf
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory = $false)]
    [string]$Location = "East US 2",
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("dev", "test", "prod")]
    [string]$Environment = "dev",
    
    [Parameter(Mandatory = $false)]
    [string]$ProjectName = "demandvpn",
    
    [Parameter(Mandatory = $false)]
    [switch]$WhatIf
)

# Set error action preference
$ErrorActionPreference = "Stop"

Write-Host "Starting Azure Demand VPN infrastructure deployment..." -ForegroundColor Green
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "Project Name: $ProjectName" -ForegroundColor Yellow

# Check if Azure CLI is installed and logged in
try {
    $azVersion = az version --output json | ConvertFrom-Json
    Write-Host "Azure CLI version: $($azVersion.'azure-cli')" -ForegroundColor Green
} catch {
    Write-Error "Azure CLI is not installed or not accessible. Please install Azure CLI and run 'az login'"
    exit 1
}

# Check if user is logged in to Azure
try {
    $account = az account show --output json | ConvertFrom-Json
    Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green
    Write-Host "Subscription: $($account.name) ($($account.id))" -ForegroundColor Green
} catch {
    Write-Error "Not logged in to Azure. Please run 'az login'"
    exit 1
}

# Check if Bicep is installed
try {
    $bicepVersion = az bicep version --output json | ConvertFrom-Json
    Write-Host "Bicep version: $($bicepVersion.version)" -ForegroundColor Green
} catch {
    Write-Error "Bicep is not installed. Please install Bicep CLI"
    exit 1
}

# Create resource group if it doesn't exist
Write-Host "Creating resource group '$ResourceGroupName' in '$Location'..." -ForegroundColor Yellow
try {
    az group create --name $ResourceGroupName --location $Location --output none
    Write-Host "Resource group created successfully" -ForegroundColor Green
} catch {
    Write-Host "Resource group already exists or creation failed" -ForegroundColor Yellow
}

# Set the default resource group
az config set defaults.group=$ResourceGroupName

# Determine parameter file
$paramFile = "parameters.$Environment.json"
if (-not (Test-Path $paramFile)) {
    Write-Error "Parameter file '$paramFile' not found"
    exit 1
}

Write-Host "Using parameter file: $paramFile" -ForegroundColor Green

# Build Bicep template
Write-Host "Building Bicep template..." -ForegroundColor Yellow
try {
    az bicep build --file main.bicep
    Write-Host "Bicep template built successfully" -ForegroundColor Green
} catch {
    Write-Error "Failed to build Bicep template"
    exit 1
}

# Deploy infrastructure
Write-Host "Deploying infrastructure..." -ForegroundColor Yellow

$deploymentName = "vpn-deployment-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$deploymentParams = @(
    "--resource-group", $ResourceGroupName,
    "--template-file", "main.bicep",
    "--parameters", $paramFile,
    "--name", $deploymentName,
    "--verbose"
)

if ($WhatIf) {
    Write-Host "Running in What-If mode..." -ForegroundColor Cyan
    $deploymentParams += "--what-if"
}

try {
    if ($WhatIf) {
        az deployment group what-if @deploymentParams
    } else {
        az deployment group create @deploymentParams
    }
    Write-Host "Deployment completed successfully!" -ForegroundColor Green
} catch {
    Write-Error "Deployment failed"
    exit 1
}

# Get deployment outputs
if (-not $WhatIf) {
    Write-Host "Getting deployment outputs..." -ForegroundColor Yellow
    try {
        $outputs = az deployment group show --resource-group $ResourceGroupName --name $deploymentName --query properties.outputs --output json | ConvertFrom-Json
        
        Write-Host "`nDeployment Outputs:" -ForegroundColor Green
        Write-Host "==================" -ForegroundColor Green
        Write-Host "Resource Group: $($outputs.resourceGroupName.value)" -ForegroundColor White
        Write-Host "Location: $($outputs.location.value)" -ForegroundColor White
        Write-Host "Container Registry: $($outputs.containerRegistryName.value)" -ForegroundColor White
        Write-Host "Storage Account: $($outputs.storageAccountName.value)" -ForegroundColor White
        Write-Host "Key Vault: $($outputs.keyVaultName.value)" -ForegroundColor White
        Write-Host "Function App: $($outputs.functionAppName.value)" -ForegroundColor White
        Write-Host "Virtual Network: $($outputs.virtualNetworkName.value)" -ForegroundColor White
        Write-Host "VPN Container Group: $($outputs.vpnContainerGroupName.value)" -ForegroundColor White
        
        Write-Host "`nNext Steps:" -ForegroundColor Green
        Write-Host "===========" -ForegroundColor Green
        Write-Host "1. Push VPN container images to ACR: $($outputs.containerRegistryLoginServer.value)" -ForegroundColor White
        Write-Host "2. Configure Function App with your VPN logic" -ForegroundColor White
        Write-Host "3. Set up monitoring alerts and dashboards" -ForegroundColor White
        Write-Host "4. Test VPN connectivity" -ForegroundColor White
        
    } catch {
        Write-Warning "Could not retrieve deployment outputs"
    }
}

Write-Host "`nDeployment script completed!" -ForegroundColor Green
