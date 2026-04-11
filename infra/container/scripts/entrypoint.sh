#!/bin/bash
set -euo pipefail

# Entrypoint for WireGuard VPN container.
#
# Required environment variables:
#   WG_SERVER_PRIVATE_KEY  — WireGuard server private key (base64)
#   WG_SERVER_ADDRESS      — Server tunnel IP with CIDR (e.g. 10.8.0.1/24)
#
# Optional environment variables:
#   WG_SERVER_PORT         — UDP listen port (default: 51820)
#   SESSION_ID             — VPN session ID (used by heartbeat.sh)
#   STORAGE_TABLE_ENDPOINT — Storage table endpoint (used by heartbeat.sh)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/wireguard/startup.log
}

mkdir -p /var/log/wireguard

for required in WG_SERVER_PRIVATE_KEY WG_SERVER_ADDRESS; do
  if [ -z "${!required:-}" ]; then
    log "ERROR: Required environment variable '$required' is not set"
    exit 1
  fi
done

export WG_SERVER_PRIVATE_KEY
export WG_SERVER_PORT="${WG_SERVER_PORT:-51820}"
# WG_SERVER_ADDRESS is passed with CIDR (e.g. 10.8.0.1/24) — used as-is by generate-config.sh
export WG_SERVER_ADDRESS

log "Generating WireGuard server configuration..."
/scripts/generate-config.sh

log "Bringing up wg0 (wg-quick handles IP forwarding and NAT via PostUp/PreDown)..."
wg-quick up wg0

log "WireGuard is up. Listening on port ${WG_SERVER_PORT}."
log "Server tunnel address: ${WG_SERVER_ADDRESS}"

# Start heartbeat in background (writes last-handshake timestamp to Storage Table)
/scripts/heartbeat.sh &
HEARTBEAT_PID=$!
log "Heartbeat started (PID ${HEARTBEAT_PID})."

# Block until stopped; handle shutdown signals
trap 'log "Received shutdown signal — stopping..."; kill $HEARTBEAT_PID 2>/dev/null; wg-quick down wg0; exit 0' SIGTERM SIGINT
while true; do
  sleep 30
done
