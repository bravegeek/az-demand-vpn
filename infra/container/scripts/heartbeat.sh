#!/bin/bash
# Reads WireGuard latest-handshakes and writes the most recent timestamp to Azure Table Storage.
# Runs in a background loop launched by entrypoint.sh.
#
# Required environment variables:
#   SESSION_ID             — VPN session ID
#   STORAGE_TABLE_ENDPOINT — Full table service endpoint URL

set -euo pipefail

SESSION_ID="${SESSION_ID:-}"
STORAGE_TABLE_ENDPOINT="${STORAGE_TABLE_ENDPOINT:-}"

if [ -z "$SESSION_ID" ] || [ -z "$STORAGE_TABLE_ENDPOINT" ]; then
  echo "[heartbeat] Missing SESSION_ID or STORAGE_TABLE_ENDPOINT — heartbeat disabled" >&2
  exit 0
fi

# Fetch an IMDS-issued managed identity token for the Storage resource.
# Token is cached for 1 hour (well within the 24-hour validity window).
TOKEN=""
TOKEN_FETCHED_AT=0

fetch_token() {
  curl -s -H "Metadata: true" \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

get_token() {
  local now
  now=$(date +%s)
  if [ -z "$TOKEN" ] || [ $(( now - TOKEN_FETCHED_AT )) -gt 3600 ]; then
    TOKEN=$(fetch_token)
    TOKEN_FETCHED_AT=$now
  fi
  echo "$TOKEN"
}

while true; do
  sleep 60

  # Parse wg show output: <peer-pubkey>\t<epoch-seconds>
  latest=0
  while IFS=$'\t' read -r _ epoch; do
    if [ "$epoch" -gt "$latest" ] 2>/dev/null; then latest="$epoch"; fi
  done < <(wg show wg0 latest-handshakes 2>/dev/null || true)

  if [ "$latest" -gt 0 ]; then
    ts=$(date -u -d "@${latest}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
      || date -u -r "$latest" +"%Y-%m-%dT%H:%M:%SZ")

    token=$(get_token)
    body="{\"lastHandshakeAt\":{\"type\":\"Edm.String\",\"value\":\"${ts}\"}}"

    http_status=$(curl -s -o /dev/null -w "%{http_code}" -X MERGE \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json;odata=nometadata" \
      "${STORAGE_TABLE_ENDPOINT}/vpn-sessions(PartitionKey='sessions',RowKey='${SESSION_ID}')" \
      -d "$body")

    if [ "$http_status" = "401" ]; then
      TOKEN=""  # Force refresh on next iteration
      echo "[heartbeat] Got 401 — will refresh token next iteration" >&2
    elif [ "$http_status" != "204" ]; then
      echo "[heartbeat] Unexpected HTTP ${http_status} — non-fatal" >&2
    fi
  fi
done
