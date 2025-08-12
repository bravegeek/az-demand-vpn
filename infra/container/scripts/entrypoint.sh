#!/bin/bash

# WireGuard Container Entrypoint Script
# Handles container startup, key generation, and VPN service initialization

set -e

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/wireguard/startup.log
}

# Error handling
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Check required environment variables
check_env_vars() {
    local required_vars=("WG_SERVER_PRIVATE_KEY" "WG_SERVER_PUBLIC_KEY" "WG_SERVER_ADDRESS" "WG_SERVER_PORT")
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            error_exit "Required environment variable $var is not set"
        fi
    done
    
    log "Environment variables validated successfully"
}

# Generate WireGuard keys if not provided
generate_keys() {
    if [[ -z "$WG_SERVER_PRIVATE_KEY" ]] || [[ -z "$WG_SERVER_PUBLIC_KEY" ]]; then
        log "Generating new WireGuard key pair..."
        
        # Generate private key
        WG_SERVER_PRIVATE_KEY=$(wg genkey)
        export WG_SERVER_PRIVATE_KEY
        
        # Generate public key from private key
        WG_SERVER_PUBLIC_KEY=$(echo "$WG_SERVER_PRIVATE_KEY" | wg pubkey)
        export WG_SERVER_PUBLIC_KEY
        
        log "Generated new key pair"
        log "Private Key: ${WG_SERVER_PRIVATE_KEY:0:10}..."
        log "Public Key: ${WG_SERVER_PUBLIC_KEY:0:10}..."
    else
        log "Using provided WireGuard keys"
    fi
}

# Generate WireGuard configuration
generate_config() {
    log "Generating WireGuard configuration..."
    
    # Call the configuration generator script
    /scripts/generate-config.sh || error_exit "Failed to generate WireGuard configuration"
    
    log "WireGuard configuration generated successfully"
}

# Setup network interface
setup_network() {
    log "Setting up network interface..."
    
    # Create WireGuard interface
    ip link add dev wg0 type wireguard || error_exit "Failed to create WireGuard interface"
    
    # Configure WireGuard interface
    wg set wg0 private-key <(echo "$WG_SERVER_PRIVATE_KEY") || error_exit "Failed to set private key"
    wg set wg0 listen-port "$WG_SERVER_PORT" || error_exit "Failed to set listen port"
    
    # Add IP address to interface
    ip addr add "$WG_SERVER_ADDRESS/24" dev wg0 || error_exit "Failed to add IP address"
    
    # Bring interface up
    ip link set wg0 up || error_exit "Failed to bring interface up"
    
    log "Network interface setup completed"
}

# Configure iptables rules
configure_iptables() {
    log "Configuring iptables rules..."
    
    # Enable IP forwarding
    echo 1 > /proc/sys/net/ipv4/ip_forward
    
    # NAT rules for VPN traffic
    iptables -t nat -A POSTROUTING -s "$WG_SERVER_ADDRESS/24" -o eth0 -j MASQUERADE || error_exit "Failed to configure NAT"
    
    # Allow forwarding for VPN traffic
    iptables -A FORWARD -i wg0 -j ACCEPT || error_exit "Failed to configure forwarding rules"
    iptables -A FORWARD -o wg0 -j ACCEPT || error_exit "Failed to configure forwarding rules"
    
    log "Iptables configuration completed"
}

# Start WireGuard service
start_wireguard() {
    log "Starting WireGuard service..."
    
    # Apply configuration
    wg setconf wg0 /etc/wireguard/wg0.conf || error_exit "Failed to apply WireGuard configuration"
    
    log "WireGuard service started successfully"
    log "VPN server is now running on $WG_SERVER_ADDRESS:$WG_SERVER_PORT"
}

# Main execution
main() {
    log "Starting WireGuard VPN container..."
    
    # Create log directory if it doesn't exist
    mkdir -p /var/log/wireguard
    
    # Check environment variables
    check_env_vars
    
    # Generate keys if needed
    generate_keys
    
    # Generate configuration
    generate_config
    
    # Setup network
    setup_network
    
    # Configure iptables
    configure_iptables
    
    # Start WireGuard service
    start_wireguard
    
    log "WireGuard container startup completed successfully"
    
    # Keep container running and monitor health
    while true; do
        sleep 30
        /scripts/health-check.sh || log "Health check failed"
    done
}

# Handle signals for graceful shutdown
trap 'log "Received shutdown signal, stopping WireGuard..."; wg-quick down wg0; exit 0' SIGTERM SIGINT

# Run main function
main "$@"
