#!/bin/bash
set -euo pipefail

# Entrypoint for WireGuard VPN container.
#
# Required environment variables:
#   WG_SERVER_PRIVATE_KEY  — WireGuard server private key (base64)
#
# Optional environment variables:
#   WG_SERVER_PORT         — UDP listen port (default: 51820)
#   WG_SERVER_ADDRESS      — Server tunnel IP in CIDR notation (default: 10.8.0.1/24)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/wireguard/startup.log
}

mkdir -p /var/log/wireguard

# Validate required environment variables
for required in WG_SERVER_PRIVATE_KEY; do
  if [ -z "${!required:-}" ]; then
    log "ERROR: Required environment variable '$required' is not set"
    exit 1
  fi
done
export WG_SERVER_PRIVATE_KEY

# Export so generate-config.sh inherits these values
export WG_SERVER_PORT="${WG_SERVER_PORT:-51820}"
export WG_SERVER_ADDRESS="${WG_SERVER_ADDRESS:-10.8.0.1}"  # without CIDR — generate-config.sh appends /24

log "Generating WireGuard server configuration..."
/scripts/generate-config.sh

log "Bringing up wg0 (wg-quick handles IP forwarding and NAT via PostUp/PreDown)..."
wg-quick up wg0

log "WireGuard is up. Listening on port ${WG_SERVER_PORT}."
log "Server tunnel address: ${WG_SERVER_ADDRESS}"

# Block until stopped; handle shutdown signals
trap 'log "Received shutdown signal — bringing down wg0..."; wg-quick down wg0; exit 0' SIGTERM SIGINT
while true; do
  sleep 30
done
