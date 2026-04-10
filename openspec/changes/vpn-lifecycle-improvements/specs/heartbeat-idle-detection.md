# Spec: Heartbeat-Based Idle Detection

## Overview

Replace the start-time heuristic in `AutoShutdown.isIdle()` with actual WireGuard peer
activity data. The WireGuard container writes a heartbeat (last handshake timestamp) to the
`vpn-sessions` Storage Table every 60 seconds. `AutoShutdown` reads this value to determine
true idle state.

## Container heartbeat script

### New file: `infra/container/scripts/heartbeat.sh`

```bash
#!/bin/bash
# Reads WireGuard latest-handshakes and writes the most recent one to Azure Table Storage.
# Runs in a background loop from entrypoint.sh.
#
# Required environment variables:
#   SESSION_ID             — VPN session ID (set by ACI environment variable)
#   STORAGE_ACCOUNT        — Storage account name
#   STORAGE_TABLE_ENDPOINT — Full table endpoint URL

set -euo pipefail

STORAGE_TABLE_ENDPOINT="${STORAGE_TABLE_ENDPOINT:-}"
SESSION_ID="${SESSION_ID:-}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-}"

if [ -z "$STORAGE_TABLE_ENDPOINT" ] || [ -z "$SESSION_ID" ] || [ -z "$STORAGE_ACCOUNT" ]; then
  echo "[heartbeat] Missing required env vars — heartbeat disabled" >&2
  exit 0
fi

fetch_token() {
  curl -s -H "Metadata: true" \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

# Cache token; IMDS tokens are valid for ~24 hours. Refresh on 401.
TOKEN=""
TOKEN_FETCHED_AT=0

get_token() {
  local now
  now=$(date +%s)
  # Refresh if not yet fetched or older than 1 hour (well within the 24h validity window)
  if [ -z "$TOKEN" ] || [ $(( now - TOKEN_FETCHED_AT )) -gt 3600 ]; then
    TOKEN=$(fetch_token)
    TOKEN_FETCHED_AT=$now
  fi
  echo "$TOKEN"
}

while true; do
  sleep 60

  # Get most recent handshake epoch from wg show output
  # Output format: <peer-pubkey>\t<epoch-seconds>
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
      # Force token refresh on next iteration
      TOKEN=""
      echo "[heartbeat] Got 401 — will refresh token on next iteration" >&2
    elif [ "$http_status" != "204" ]; then
      echo "[heartbeat] Unexpected HTTP ${http_status} — non-fatal" >&2
    fi
  fi
done
```

### entrypoint.sh changes

- Remove the hardcoded `WG_SERVER_ADDRESS` default (`10.8.0.1`) — `WG_SERVER_ADDRESS` is now
  passed with CIDR from `StartVPN` (e.g. `10.8.0.1/24`). `entrypoint.sh` uses it as-is in
  the WireGuard config; the `/24` suffix must not be appended unconditionally.
- Start heartbeat in background; kill it in the SIGTERM/SIGINT trap.
- Cache the IMDS token across heartbeat iterations rather than fetching once per loop — see
  heartbeat.sh note below.

```bash
# Start heartbeat in background (writes last-handshake to Storage Table)
/scripts/heartbeat.sh &
HEARTBEAT_PID=$!

# Block until stopped; handle shutdown signals
trap 'kill $HEARTBEAT_PID 2>/dev/null; wg-quick down wg0; exit 0' SIGTERM SIGINT
while true; do
  sleep 30
done
```

## StartVPN changes

Add `SESSION_ID`, `STORAGE_TABLE_ENDPOINT`, and `WG_SERVER_ADDRESS` to the container's
`environmentVariables` in `buildContainerGroupSpec`. `WG_SERVER_ADDRESS` is derived from
`VPN_TUNNEL_SUBNET` (see async-startvpn spec), removing the hardcoded default in
`entrypoint.sh`:

```js
{ name: 'SESSION_ID', value: sessionId },
{ name: 'STORAGE_TABLE_ENDPOINT', value: process.env.STORAGE_TABLE_ENDPOINT },
{ name: 'WG_SERVER_ADDRESS', value: serverAddress },  // derived from VPN_TUNNEL_SUBNET
```

## ACI managed identity → Storage RBAC

The ACI container uses a **UserAssigned** managed identity (`vpn-container-identity`) that is
created in Bicep and pre-granted `Storage Table Data Contributor` on the Storage Account at
deploy time (see Design Decision 4). No runtime role assignment is needed.

`StartVPN` passes the identity resource ID via `VPN_CONTAINER_IDENTITY_ID` env var.
`buildContainerGroupSpec` sets:

```js
identity: {
  type: 'UserAssigned',
  userAssignedIdentities: { [process.env.VPN_CONTAINER_IDENTITY_ID]: {} },
},
```

New Bicep resources required in `infra/main.bicep`:

1. `Microsoft.ManagedIdentity/userAssignedIdentities` — `vpn-container-identity`
2. `Microsoft.Authorization/roleAssignments` — Storage Table Data Contributor for
   `vpn-container-identity.principalId` scoped to the Storage Account

`VPN_CONTAINER_IDENTITY_ID` app setting in `function-app.bicep` = the identity resource ID
output from the new identity resource.

## AutoShutdown changes

### Updated isIdle logic

```js
const isIdle = async (group, tableClient) => {
  if (group.properties?.provisioningState !== 'Succeeded') return false;

  const sessionId = group.name.replace(/^vpn-/, '');

  try {
    const entity = await tableClient.getEntity('sessions', sessionId);

    // Use lastHandshakeAt if available (heartbeat-based)
    const lastActivity = entity.lastHandshakeAt || entity.createdAt;
    if (!lastActivity) return false;

    const idleMinutes = (Date.now() - new Date(lastActivity).getTime()) / 1000 / 60;
    return idleMinutes >= IDLE_TIMEOUT_MINUTES;
  } catch (err) {
    if (err.statusCode === 404) {
      // No table row — fall back to container start time (legacy sessions)
      const startTime = group.properties?.containers?.[0]?.properties?.instanceView?.currentState?.startTime;
      if (!startTime) return false;
      const runningMinutes = (Date.now() - new Date(startTime).getTime()) / 1000 / 60;
      return runningMinutes >= IDLE_TIMEOUT_MINUTES;
    }
    throw err;
  }
};
```

`isIdle` becomes async. The `for await` loop in the handler calls `await isIdle(group, tableClient)`.

### StopVPN change

Delete the `vpn-sessions` table row on teardown:

```js
await tableClient.deleteEntity('sessions', sessionId).catch(() => {});
```

## Environment variables added

| Name | Added to | Notes |
|---|---|---|
| `STORAGE_TABLE_ENDPOINT` | function-app.bicep + ACI env | Already in async-startvpn spec |
| `SESSION_ID` | ACI env only | Set per-session by StartVPN |

## Tests

- `AutoShutdown`: idle when `lastHandshakeAt` is past timeout; active when `lastHandshakeAt`
  is recent; falls back to start-time for sessions with no table row (404)
- `StartVPN`: includes `SESSION_ID` and `STORAGE_TABLE_ENDPOINT` in ACI env vars;
  creates Storage Table role assignment after ACI creation
- `StopVPN`: deletes `vpn-sessions` table row on teardown
