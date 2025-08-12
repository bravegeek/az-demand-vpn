#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Test and validate Bicep templates

.DESCRIPTION
    This script validates all Bicep templates in the infrastructure directory
    and performs syntax checks and What-If analysis.

.PARAMETER ResourceGroupName
    Name of the resource group for testing (will be created if it doesn't exist)

.PARAMETER Location
    Azure region for testing (default: East US 2)

.EXAMPLE
    .\test-templates.ps1 -ResourceGroupName "rg-demand-vpn-test"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory = $false)]
    [string]$Location = "East US 2"
)

# Set error action preference
$ErrorActionPreference = "Stop"

Write-Host "Testing Bicep templates..." -ForegroundColor Green
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow

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

# Test main.bicep template
Write-Host "`nTesting main.bicep template..." -ForegroundColor Yellow

try {
    # Build the template
    Write-Host "Building main.bicep..." -ForegroundColor Cyan
    az bicep build --file main.bicep
    Write-Host "✓ main.bicep built successfully" -ForegroundColor Green
    
    # Validate the template
    Write-Host "Validating main.bicep..." -ForegroundColor Cyan
    az bicep lint --file main.bicep
    Write-Host "✓ main.bicep validation passed" -ForegroundColor Green
    
} catch {
    Write-Error "Failed to build or validate main.bicep"
    exit 1
}

# Test individual modules
Write-Host "`nTesting individual modules..." -ForegroundColor Yellow

$modules = @(
    "log-analytics.bicep",
    "application-insights.bicep", 
    "network.bicep",
    "container-registry.bicep",
    "storage.bicep",
    "key-vault.bicep",
    "function-app.bicep",
    "vpn-container.bicep",
    "monitoring.bicep"
)

foreach ($module in $modules) {
    $modulePath = "modules/$module"
    if (Test-Path $modulePath) {
        try {
            Write-Host "Testing $module..." -ForegroundColor Cyan
            az bicep build --file $modulePath
            az bicep lint --file $modulePath
            Write-Host "✓ $module passed validation" -ForegroundColor Green
        } catch {
            Write-Warning "$module has validation issues"
        }
    } else {
        Write-Warning "Module $module not found"
    }
}

# Test parameter files
Write-Host "`nTesting parameter files..." -ForegroundColor Yellow

$paramFiles = @("parameters.dev.json", "parameters.prod.json")

foreach ($paramFile in $paramFiles) {
    if (Test-Path $paramFile) {
        try {
            Write-Host "Validating $paramFile..." -ForegroundColor Cyan
            $content = Get-Content $paramFile | ConvertFrom-Json
            Write-Host "✓ $paramFile is valid JSON" -ForegroundColor Green
        } catch {
            Write-Warning "$paramFile has JSON validation issues"
        }
    } else {
        Write-Warning "Parameter file $paramFile not found"
    }
}

# Create test resource group
Write-Host "`nCreating test resource group..." -ForegroundColor Yellow
try {
    az group create --name $ResourceGroupName --location $Location --output none
    Write-Host "✓ Test resource group created: $ResourceGroupName" -ForegroundColor Green
} catch {
    Write-Host "Test resource group already exists or creation failed" -ForegroundColor Yellow
}

# Test What-If deployment
Write-Host "`nRunning What-If analysis..." -ForegroundColor Yellow
try {
    Write-Host "This will show what resources would be created without actually deploying them" -ForegroundColor Cyan
    
    az deployment group what-if \
        --resource-group $ResourceGroupName \
        --template-file main.bicep \
        --parameters parameters.dev.json \
        --name "test-deployment-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        
    Write-Host "✓ What-If analysis completed successfully" -ForegroundColor Green
    
} catch {
    Write-Warning "What-If analysis failed - this may indicate template issues"
}

# Cleanup test resource group
Write-Host "`nCleaning up test resources..." -ForegroundColor Yellow
$cleanup = Read-Host "Do you want to delete the test resource group '$ResourceGroupName'? (y/N)"
if ($cleanup -eq 'y' -or $cleanup -eq 'Y') {
    try {
        az group delete --name $ResourceGroupName --yes --no-wait
        Write-Host "✓ Test resource group marked for deletion" -ForegroundColor Green
    } catch {
        Write-Warning "Failed to delete test resource group"
    }
} else {
    Write-Host "Test resource group '$ResourceGroupName' will remain for manual cleanup" -ForegroundColor Yellow
}

Write-Host "`nTemplate testing completed!" -ForegroundColor Green
Write-Host "Review any warnings or errors above before proceeding with deployment" -ForegroundColor Yellow
