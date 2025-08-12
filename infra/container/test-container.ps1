# WireGuard Container Test Script
# Tests the container build and basic functionality

param(
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "test",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild,
    
    [Parameter(Mandatory=$false)]
    [switch]$Cleanup,
    
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# Show help if requested
if ($Help) {
    Write-Host @"
WireGuard Container Test Script

Usage:
    .\test-container.ps1 [options]

Options:
    -ImageTag <tag>     Docker image tag for testing (default: test)
    -SkipBuild          Skip building the image (use existing)
    -Cleanup            Clean up test containers and images
    -Help               Show this help message

Examples:
    .\test-container.ps1                    # Build and test
    .\test-container.ps1 -SkipBuild         # Test existing image
    .\test-container.ps1 -Cleanup           # Clean up test artifacts

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

# Function to check Docker
function Test-Docker {
    if (-not (Test-Command "docker")) {
        Write-ColorOutput "✗ Docker is not installed or not in PATH" "Red"
        return $false
    }
    
    try {
        docker version | Out-Null
        Write-ColorOutput "✓ Docker is running" "Green"
        return $true
    }
    catch {
        Write-ColorOutput "✗ Docker is not running" "Red"
        return $false
    }
}

# Function to build test image
function Build-TestImage {
    $imageName = "wireguard-vpn:$ImageTag"
    
    Write-ColorOutput "Building test image: $imageName" "Yellow"
    
    try {
        docker build --tag $imageName --file Dockerfile .
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput "✓ Test image built successfully" "Green"
            return $imageName
        }
        else {
            Write-ColorOutput "✗ Test image build failed" "Red"
            return $null
        }
    }
    catch {
        Write-ColorOutput "✗ Test image build failed with error: $_" "Red"
        return $null
    }
}

# Function to test container startup
function Test-ContainerStartup {
    param([string]$ImageName)
    
    $containerName = "wireguard-test-$(Get-Random)"
    $imageName = $ImageName
    
    Write-ColorOutput "Testing container startup..." "Yellow"
    
    try {
        # Start container in background
        $containerId = docker run -d --name $containerName `
            --cap-add=NET_ADMIN `
            --cap-add=SYS_MODULE `
            -e WG_SERVER_ADDRESS=10.8.0.1 `
            -e WG_SERVER_PORT=51820 `
            $imageName
        
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput "✓ Container started successfully: $containerId" "Green"
            
            # Wait for startup
            Write-ColorOutput "Waiting for container startup..." "Yellow"
            Start-Sleep -Seconds 10
            
            # Check container status
            $status = docker inspect --format='{{.State.Status}}' $containerName
            if ($status -eq "running") {
                Write-ColorOutput "✓ Container is running" "Green"
                
                # Check health status
                $health = docker inspect --format='{{.State.Health.Status}}' $containerName
                Write-ColorOutput "Container health: $health" "Cyan"
                
                # Show logs
                Write-ColorOutput "Container logs:" "Cyan"
                docker logs $containerName | Select-Object -Last 10
                
                return $true
            }
            else {
                Write-ColorOutput "✗ Container is not running. Status: $status" "Red"
                return $false
            }
        }
        else {
            Write-ColorOutput "✗ Failed to start container" "Red"
            return $false
        }
    }
    catch {
        Write-ColorOutput "✗ Container startup test failed: $_" "Red"
        return $false
    }
    finally {
        # Cleanup test container
        if (docker ps -a --filter "name=$containerName" --format "{{.Names}}" | Select-String $containerName) {
            Write-ColorOutput "Cleaning up test container..." "Yellow"
            docker stop $containerName 2>$null
            docker rm $containerName 2>$null
        }
    }
}

# Function to test configuration generation
function Test-ConfigurationGeneration {
    param([string]$ImageName)
    
    $containerName = "wireguard-config-test-$(Get-Random)"
    
    Write-ColorOutput "Testing configuration generation..." "Yellow"
    
    try {
        # Start container for config test
        $containerId = docker run -d --name $containerName `
            --cap-add=NET_ADMIN `
            --cap-add=SYS_MODULE `
            -e WG_SERVER_ADDRESS=10.8.0.1 `
            -e WG_SERVER_PORT=51820 `
            $imageName
        
        if ($LASTEXITCODE -eq 0) {
            # Wait for startup
            Start-Sleep -Seconds 15
            
            # Test configuration generation
            $result = docker exec $containerName /scripts/generate-config.sh
            if ($LASTEXITCODE -eq 0) {
                Write-ColorOutput "✓ Configuration generation successful" "Green"
                
                # Check if config files exist
                $serverConfig = docker exec $containerName test -f /etc/wireguard/wg0.conf
                $clientTemplate = docker exec $containerName test -f /etc/wireguard/client-template.conf
                
                if ($serverConfig -eq 0 -and $clientTemplate -eq 0) {
                    Write-ColorOutput "✓ Configuration files created successfully" "Green"
                    
                    # Show server config (without private key)
                    Write-ColorOutput "Server configuration preview:" "Cyan"
                    docker exec $containerName cat /etc/wireguard/wg0.conf | 
                        ForEach-Object { if ($_ -notmatch "PrivateKey") { $_ } }
                    
                    return $true
                }
                else {
                    Write-ColorOutput "✗ Configuration files not found" "Red"
                    return $false
                }
            }
            else {
                Write-ColorOutput "✗ Configuration generation failed" "Red"
                return $false
            }
        }
        else {
            Write-ColorOutput "✗ Failed to start container for config test" "Red"
            return $false
        }
    }
    catch {
        Write-ColorOutput "✗ Configuration generation test failed: $_" "Red"
        return $false
    }
    finally {
        # Cleanup test container
        if (docker ps -a --filter "name=$containerName" --format "{{.Names}}" | Select-String $containerName) {
            docker stop $containerName 2>$null
            docker rm $containerName 2>$null
        }
    }
}

# Function to test health check
function Test-HealthCheck {
    param([string]$ImageName)
    
    $containerName = "wireguard-health-test-$(Get-Random)"
    
    Write-ColorOutput "Testing health check functionality..." "Yellow"
    
    try {
        # Start container for health test
        $containerId = docker run -d --name $containerName `
            --cap-add=NET_ADMIN `
            --cap-add=SYS_MODULE `
            -e WG_SERVER_ADDRESS=10.8.0.1 `
            -e WG_SERVER_PORT=51820 `
            $imageName
        
        if ($LASTEXITCODE -eq 0) {
            # Wait for startup
            Start-Sleep -Seconds 15
            
            # Run health check
            $healthResult = docker exec $containerName /scripts/health-check.sh
            if ($LASTEXITCODE -eq 0) {
                Write-ColorOutput "✓ Health check successful" "Green"
                
                # Check if health report was generated
                $healthReport = docker exec $containerName test -f /var/log/wireguard/health-report.json
                if ($healthReport -eq 0) {
                    Write-ColorOutput "✓ Health report generated" "Green"
                    
                    # Show health report
                    Write-ColorOutput "Health report:" "Cyan"
                    docker exec $containerName cat /var/log/wireguard/health-report.json | 
                        ConvertFrom-Json | ConvertTo-Json -Depth 3
                    
                    return $true
                }
                else {
                    Write-ColorOutput "✗ Health report not generated" "Red"
                    return $false
                }
            }
            else {
                Write-ColorOutput "✗ Health check failed" "Red"
                return $false
            }
        }
        else {
            Write-ColorOutput "✗ Failed to start container for health test" "Red"
            return $false
        }
    }
    catch {
        Write-ColorOutput "✗ Health check test failed: $_" "Red"
        return $false
    }
    finally {
        # Cleanup test container
        if (docker ps -a --filter "name=$containerName" --format "{{.Names}}" | Select-String $containerName) {
            docker stop $containerName 2>$null
            docker rm $containerName 2>$null
        }
    }
}

# Function to cleanup test artifacts
function Cleanup-TestArtifacts {
    Write-ColorOutput "Cleaning up test artifacts..." "Yellow"
    
    # Stop and remove test containers
    $testContainers = docker ps -a --filter "name=wireguard-test-" --format "{{.Names}}"
    if ($testContainers) {
        foreach ($container in $testContainers) {
            Write-ColorOutput "Removing test container: $container" "Gray"
            docker stop $container 2>$null
            docker rm $container 2>$null
        }
    }
    
    # Remove test images
    $testImages = docker images --filter "reference=wireguard-vpn:test" --format "{{.Repository}}:{{.Tag}}"
    if ($testImages) {
        foreach ($image in $testImages) {
            Write-ColorOutput "Removing test image: $image" "Gray"
            docker rmi $image 2>$null
        }
    }
    
    Write-ColorOutput "✓ Cleanup completed" "Green"
}

# Main execution
function Main {
    Write-ColorOutput "=== WireGuard Container Test Script ===" "Cyan"
    Write-ColorOutput "Test started at: $(Get-Date)" "Gray"
    Write-ColorOutput ""
    
    # Check prerequisites
    if (-not (Test-Docker)) {
        Write-ColorOutput "Please install and start Docker, then try again." "Red"
        exit 1
    }
    
    # Cleanup if requested
    if ($Cleanup) {
        Cleanup-TestArtifacts
        exit 0
    }
    
    # Build test image
    $imageName = $null
    if (-not $SkipBuild) {
        $imageName = Build-TestImage
        if (-not $imageName) {
            Write-ColorOutput "Build failed. Exiting." "Red"
            exit 1
        }
    }
    else {
        $imageName = "wireguard-vpn:$ImageTag"
        Write-ColorOutput "Using existing image: $imageName" "Yellow"
    }
    
    # Run tests
    $testResults = @()
    
    Write-ColorOutput "`nRunning container tests..." "Cyan"
    
    # Test 1: Container startup
    Write-ColorOutput "`n1. Testing container startup..." "Yellow"
    $startupResult = Test-ContainerStartup -ImageName $imageName
    $testResults += @{ Test = "Container Startup"; Result = $startupResult }
    
    # Test 2: Configuration generation
    Write-ColorOutput "`n2. Testing configuration generation..." "Yellow"
    $configResult = Test-ConfigurationGeneration -ImageName $imageName
    $testResults += @{ Test = "Configuration Generation"; Result = $configResult }
    
    # Test 3: Health check
    Write-ColorOutput "`n3. Testing health check..." "Yellow"
    $healthResult = Test-HealthCheck -ImageName $imageName
    $testResults += @{ Test = "Health Check"; Result = $healthResult }
    
    # Show test results
    Write-ColorOutput "`n=== Test Results ===" "Cyan"
    $passedTests = 0
    $totalTests = $testResults.Count
    
    foreach ($result in $testResults) {
        $status = if ($result.Result) { "✓ PASS" } else { "✗ FAIL" }
        $color = if ($result.Result) { "Green" } else { "Red" }
        Write-ColorOutput "$status - $($result.Test)" $color
        if ($result.Result) { $passedTests++ }
    }
    
    Write-ColorOutput "`nTest Summary: $passedTests/$totalTests tests passed" "Cyan"
    
    if ($passedTests -eq $totalTests) {
        Write-ColorOutput "`n🎉 All tests passed! Container is ready for deployment." "Green"
    }
    else {
        Write-ColorOutput "`n⚠️  Some tests failed. Please review the errors above." "Yellow"
    }
    
    # Cleanup test artifacts
    Write-ColorOutput "`nCleaning up test artifacts..." "Yellow"
    Cleanup-TestArtifacts
}

# Run main function
try {
    Main
}
catch {
    Write-ColorOutput "`n✗ Test script failed with error: $_" "Red"
    exit 1
}
