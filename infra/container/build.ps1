# WireGuard Container Build Script
# Builds and optionally pushes the WireGuard container image

param(
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$RegistryName = "acrazdemandvpn",
    
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "rg-az-demand-vpn-mvp",
    
    [Parameter(Mandatory=$false)]
    [switch]$PushToRegistry,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild,
    
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# Show help if requested
if ($Help) {
    Write-Host @"
WireGuard Container Build Script

Usage:
    .\build.ps1 [options]

Options:
    -ImageTag <tag>           Docker image tag (default: latest)
    -RegistryName <name>       Azure Container Registry name (default: acrazdemandvpn)
    -ResourceGroup <group>     Azure resource group name (default: rg-az-demand-vpn-mvp)
    -PushToRegistry           Push image to Azure Container Registry after build
    -SkipBuild                Skip building the image (useful for pushing existing images)
    -Help                     Show this help message

Examples:
    .\build.ps1                                    # Build with default settings
    .\build.ps1 -ImageTag v1.0.0                   # Build with specific tag
    .\build.ps1 -PushToRegistry                    # Build and push to ACR
    .\build.ps1 -SkipBuild -PushToRegistry         # Push existing image to ACR

"@
    exit 0
}

# Function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# Function to check if command exists
function Test-Command {
    param([string]$Command)
    try {
        Get-Command $Command -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

# Function to check Azure CLI login
function Test-AzureLogin {
    try {
        $context = az account show 2>$null | ConvertFrom-Json
        if ($context) {
            Write-ColorOutput " Azure CLI logged in as: $($context.user.name)" "Green"
            return $true
        }
    }
    catch {
        Write-ColorOutput " Azure CLI not logged in or no subscription selected" "Red"
        return $false
    }
    return $false
}

# Function to check Docker
function Test-Docker {
    if (-not (Test-Command "docker")) {
        Write-ColorOutput " Docker is not installed or not in PATH" "Red"
        return $false
    }
    
    try {
        docker version | Out-Null
        Write-ColorOutput " Docker is running" "Green"
        return $true
    }
    catch {
        Write-ColorOutput " Docker is not running" "Red"
        return $false
    }
}

# Function to get ACR login server
function Get-ACRLoginServer {
    try {
        $acr = az acr show --name $RegistryName --resource-group $ResourceGroup --query "loginServer" --output tsv 2>$null
        if ($acr) {
            return $acr
        }
    }
    catch {
        Write-ColorOutput " Failed to get ACR login server for $RegistryName" "Red"
        return $null
    }
    return $null
}

# Function to login to ACR
function Connect-ACR {
    try {
        Write-ColorOutput "Logging in to Azure Container Registry..." "Yellow"
        az acr login --name $RegistryName
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput " Successfully logged in to ACR" "Green"
            return $true
        }
    }
    catch {
        Write-ColorOutput " Failed to login to ACR" "Red"
        return $false
    }
    return $false
}

# Function to build Docker image
function New-DockerImage {
    $imageName = "$RegistryName.azurecr.io/wireguard-vpn:$ImageTag"
    
    Write-ColorOutput "Building Docker image: $imageName" "Yellow"
    Write-ColorOutput "Build context: $PWD" "Gray"
    
    try {
        docker build --tag $imageName --file Dockerfile .
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput " Docker image built successfully" "Green"
            return $imageName
        }
        else {
            Write-ColorOutput " Docker build failed" "Red"
            return $null
        }
    }
    catch {
        Write-ColorOutput " Docker build failed with error: $_" "Red"
        return $null
    }
}

# Function to push Docker image
function Push-DockerImage {
    param([string]$ImageName)
    
    Write-ColorOutput "Pushing Docker image to ACR..." "Yellow"
    
    try {
        docker push $ImageName
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput " Docker image pushed successfully" "Green"
            return $true
        }
        else {
            Write-ColorOutput " Docker push failed" "Red"
            return $false
        }
    }
    catch {
        Write-ColorOutput " Docker push failed with error: $_" "Red"
        return $false
    }
}

# Function to show image information
function Show-ImageInfo {
    param([string]$ImageName)
    
    Write-ColorOutput "`nImage Information:" "Cyan"
    Write-ColorOutput "  Full Name: $ImageName" "White"
    Write-ColorOutput "  Registry: $RegistryName.azurecr.io" "White"
    Write-ColorOutput "  Repository: wireguard-vpn" "White"
    Write-ColorOutput "  Tag: $ImageTag" "White"
    
    # Show image size
    try {
        $size = docker images --format "table {{.Repository}}:{{.Tag}}`t{{.Size}}" | Select-String "wireguard-vpn:$ImageTag"
        if ($size) {
            Write-ColorOutput "  Size: $($size.ToString().Split("`t")[1])" "White"
        }
    }
    catch {
        Write-ColorOutput "  Size: Unable to determine" "Yellow"
    }
}

# Main execution
function Main {
    Write-ColorOutput "=== WireGuard Container Build Script ===" "Cyan"
    Write-ColorOutput "Build started at: $(Get-Date)" "Gray"
    Write-ColorOutput ""
    
    # Pre-flight checks
    Write-ColorOutput "Performing pre-flight checks..." "Yellow"
    
    if (-not (Test-Docker)) {
        Write-ColorOutput "Please install and start Docker, then try again." "Red"
        exit 1
    }
    
    if ($PushToRegistry) {
        if (-not (Test-AzureLogin)) {
            Write-ColorOutput "Please login to Azure CLI: az login" "Red"
            exit 1
        }
        
        $loginServer = Get-ACRLoginServer
        if (-not $loginServer) {
            Write-ColorOutput "Please check the ACR name and resource group." "Red"
            exit 1
        }
        
        if (-not (Connect-ACR)) {
            Write-ColorOutput "Failed to login to ACR. Please check your permissions." "Red"
            exit 1
        }
    }
    
    Write-ColorOutput " Pre-flight checks passed" "Green"
    Write-ColorOutput ""
    
    # Build image
    $imageName = $null
    if (-not $SkipBuild) {
        $imageName = New-DockerImage
        if (-not $imageName) {
            Write-ColorOutput "Build failed. Exiting." "Red"
            exit 1
        }
    }
    else {
        $imageName = "$RegistryName.azurecr.io/wireguard-vpn:$ImageTag"
        Write-ColorOutput "Skipping build as requested" "Yellow"
    }
    
    # Push image if requested
    if ($PushToRegistry) {
        if (-not (Push-DockerImage -ImageName $imageName)) {
            Write-ColorOutput "Push failed. Exiting." "Red"
            exit 1
        }
    }
    
    # Show results
    Show-ImageInfo -ImageName $imageName
    
    Write-ColorOutput ""
    Write-ColorOutput "=== Build Summary ===" "Cyan"
    if (-not $SkipBuild) {
        Write-ColorOutput " Docker image built successfully" "Green"
    }
    if ($PushToRegistry) {
        Write-ColorOutput " Docker image pushed to ACR" "Green"
    }
    Write-ColorOutput " Build completed successfully" "Green"
    Write-ColorOutput ""
    Write-ColorOutput "Next steps:" "Yellow"
    Write-ColorOutput "  1. Test the container locally: docker run --rm -it $imageName" "White"
    Write-ColorOutput "  2. Deploy to Azure Container Instances" "White"
    Write-ColorOutput "  3. Update your Bicep templates with the new image" "White"
}

# Run main function
try {
    Main
}
catch {
    Write-ColorOutput "`n Build script failed with error: $_" "Red"
    exit 1
}
