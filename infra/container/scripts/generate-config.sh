#!/bin/bash

# WireGuard Configuration Generator Script
# Generates server and client configurations dynamically

set -e

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/wireguard/config.log
}

# Error handling
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Generate server configuration
generate_server_config() {
    log "Generating WireGuard server configuration..."
    
    local server_config="/etc/wireguard/wg0.conf"
    
    # Create server configuration file
    cat > "$server_config" << EOF
# WireGuard Server Configuration
# Generated on $(date)

[Interface]
PrivateKey = $WG_SERVER_PRIVATE_KEY
Address = $WG_SERVER_ADDRESS/24
ListenPort = $WG_SERVER_PORT
SaveConfig = false

# Enable IP forwarding
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# DNS configuration
PostUp = echo "nameserver 8.8.8.8" > /etc/resolv.conf
PostUp = echo "nameserver 1.1.1.1" >> /etc/resolv.conf

# MTU optimization
PostUp = ip link set mtu 1420 dev wg0

EOF

    log "Server configuration generated at $server_config"
}

# Generate client configuration template
generate_client_config() {
    log "Generating client configuration template..."
    
    local client_config="/etc/wireguard/client-template.conf"
    
    # Create client configuration template
    cat > "$client_config" << EOF
# WireGuard Client Configuration Template
# Generated on $(date)

[Interface]
PrivateKey = CLIENT_PRIVATE_KEY_PLACEHOLDER
Address = CLIENT_IP_PLACEHOLDER/32
DNS = 8.8.8.8, 1.1.1.1
MTU = 1420

[Peer]
PublicKey = $WG_SERVER_PUBLIC_KEY
Endpoint = SERVER_ENDPOINT_PLACEHOLDER:$WG_SERVER_PORT
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25

EOF

    log "Client configuration template generated at $client_config"
}

# Generate client configuration with specific parameters
generate_specific_client_config() {
    local client_name="$1"
    local client_ip="$2"
    local client_private_key="$3"
    local server_endpoint="$4"
    
    if [[ -z "$client_name" ]] || [[ -z "$client_ip" ]] || [[ -z "$client_private_key" ]] || [[ -z "$server_endpoint" ]]; then
        error_exit "Missing required parameters for client configuration"
    fi
    
    local client_config="/etc/wireguard/clients/${client_name}.conf"
    
    # Create client configuration
    cat > "$client_config" << EOF
# WireGuard Client Configuration for $client_name
# Generated on $(date)

[Interface]
PrivateKey = $client_private_key
Address = $client_ip/32
DNS = 8.8.8.8, 1.1.1.1
MTU = 1420

[Peer]
PublicKey = $WG_SERVER_PUBLIC_KEY
Endpoint = $server_endpoint:$WG_SERVER_PORT
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25

EOF

    log "Client configuration generated for $client_name at $client_config"
    echo "$client_config"
}

# Generate QR code for mobile clients
generate_qr_code() {
    local config_file="$1"
    
    if ! command -v qrencode &> /dev/null; then
        log "qrencode not available, skipping QR code generation"
        return 0
    fi
    
    local qr_file="${config_file%.conf}.png"
    
    # Generate QR code from configuration
    qrencode -t PNG -o "$qr_file" < "$config_file" || {
        log "Failed to generate QR code for $config_file"
        return 1
    }
    
    log "QR code generated at $qr_file"
    echo "$qr_file"
}

# Validate configuration
validate_config() {
    log "Validating WireGuard configuration..."
    
    local server_config="/etc/wireguard/wg0.conf"
    
    # Check if server config exists
    if [[ ! -f "$server_config" ]]; then
        error_exit "Server configuration file not found"
    fi
    
    # Validate WireGuard configuration syntax
    if ! wg-quick strip "$server_config" > /dev/null 2>&1; then
        error_exit "Invalid WireGuard configuration syntax"
    fi
    
    log "Configuration validation passed"
}

# Main execution
main() {
    log "Starting WireGuard configuration generation..."
    
    # Create necessary directories
    mkdir -p /etc/wireguard/clients
    
    # Generate server configuration
    generate_server_config
    
    # Generate client configuration template
    generate_client_config
    
    # Validate configuration
    validate_config
    
    log "WireGuard configuration generation completed successfully"
}

# Function to generate client config when called with parameters
if [[ $# -eq 4 ]]; then
    generate_specific_client_config "$1" "$2" "$3" "$4"
else
    main "$@"
fi
