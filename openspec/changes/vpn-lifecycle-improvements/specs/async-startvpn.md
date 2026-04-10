# Spec: Async StartVPN (202 + poll)

## Overview

Change `StartVPN` from a blocking synchronous operation to an async fire-and-forget. The
function returns `202 Accepted` immediately after launching ACI provisioning, without waiting
for the container to become ready. Callers poll `CheckVPNStatus` for readiness.

## Storage Table: vpn-sessions

Table name: `vpn-sessions`  
Two partitions — `sessions` (one row per active session) and `addresses` (one row per
allocated peer address, used as a concurrency lock).

### `sessions` partition

Partition key: `'sessions'` | Row key: `sessionId`

| Column | Type | Notes |
|---|---|---|
| `peerAddress` | string | e.g. `10.8.0.2` (without /32) |
| `status` | string | `'Provisioning'` or `'Running'` |
| `createdAt` | string | ISO 8601 |
| `lastHandshakeAt` | string | ISO 8601, optional — written by heartbeat |

`serverPublicKey` is **not** stored here. It is derived from the Key Vault secret
`wg-server-key-<sessionId>` at finalization time using `createPublicKey`.

### `addresses` partition

Partition key: `'addresses'` | Row key: peer address (e.g. `10.8.0.2`)

| Column | Type | Notes |
|---|---|---|
| `sessionId` | string | Back-reference to owning session |

Rows in this partition act as atomic address locks (written with `If-None-Match: *`).
`StopVPN` deletes the row to return the address to the pool.

## `getTableClient()` in shared/azureClient.js

Returns a `TableClient` for `vpn-sessions` using `STORAGE_TABLE_ENDPOINT` + managed identity
(`@azure/data-tables` SDK). Add `STORAGE_TABLE_ENDPOINT` env var to `function-app.bicep`:
`https://<StorageAccountName>.table.core.windows.net`.

## Tunnel subnet and DNS configuration

`VPN_TUNNEL_SUBNET` (default `10.8.0.0/24`) is the single source of truth for the WireGuard
tunnel network. `VPN_DNS_SERVER` (default `1.1.1.1`) controls the DNS line in the client
config. Both are set in `function-app.bicep` from `vpnConfig.tunnelSubnet` /
`vpnConfig.dnsServer` in `main.bicep`.

```js
const VPN_TUNNEL_SUBNET = process.env.VPN_TUNNEL_SUBNET || '10.8.0.0/24';
const VPN_DNS_SERVER = process.env.VPN_DNS_SERVER || '1.1.1.1';

// e.g. '10.8.0.0/24' → serverAddress='10.8.0.1', poolBase='10.8.0', cidr='/24'
const [subnetBase, cidr] = VPN_TUNNEL_SUBNET.split('/');
const octets = subnetBase.split('.');
const serverAddress = `${octets.slice(0, 3).join('.')}.1`;
const poolBase = octets.slice(0, 3).join('.');
```

`WG_SERVER_ADDRESS` is passed to the container as `${serverAddress}/${cidr}` (with CIDR),
so `entrypoint.sh` uses it as-is without appending a hardcoded `/24`.

## StartVPN changes

### New: allocatePeerAddress(tableClient, poolBase)

Uses the `addresses` partition as an atomic lock to prevent concurrent sessions from
receiving the same address.

```js
const allocatePeerAddress = async (tableClient, poolBase) => {
  // Scan addresses partition to find used addresses
  const entities = tableClient.listEntities({
    queryOptions: { filter: "PartitionKey eq 'addresses'" },
  });
  const used = new Set();
  for await (const entity of entities) {
    used.add(entity.rowKey);
  }

  // Find first free address and claim it atomically
  for (let i = 2; i <= 254; i++) {
    const addr = `${poolBase}.${i}`;
    if (used.has(addr)) continue;
    try {
      await tableClient.createEntity({
        partitionKey: 'addresses',
        rowKey: addr,
        sessionId,  // back-reference
      });
      return addr;  // lock acquired
    } catch (err) {
      if (err.statusCode === 409) continue;  // lost the race — try next address
      throw err;
    }
  }
  return null;  // pool exhausted
};
```

This eliminates the TOCTOU race: each address can only be claimed by one concurrent caller.

### New: writeSessionRow(tableClient, sessionId, peerAddress)

```js
const writeSessionRow = async (tableClient, sessionId, peerAddress) => {
  await tableClient.createEntity({
    partitionKey: 'sessions',
    rowKey: sessionId,
    peerAddress,
    status: 'Provisioning',
    createdAt: new Date().toISOString(),
  });
};
```

### Handler flow (updated)

1. Validate `sessionId` — unchanged
2. Check for existing ACI group → return existing session (idempotent) — unchanged
3. Allocate peer address: `allocatePeerAddress(tableClient, poolBase)`
   - If `null`: return `503 { error: 'VPN address pool exhausted' }`
4. Generate key pair — unchanged
5. Store server private key in Key Vault — unchanged
6. Write `sessions` row (`status: 'Provisioning'`)
7. Begin ACI creation: `beginCreateOrUpdate(...)` — **do NOT call `pollUntilDone()`**
8. Return `202 Accepted`:
   ```json
   { "status": "Provisioning", "sessionId": "<sessionId>" }
   ```

No Key Vault peer config is written here — `CheckVPNStatus` builds and stores it at
finalization time, once the ACI public IP is known.

### Error cleanup

If step 7 (ACI creation) fails:
- Delete Key Vault server key (`beginDeleteSecret`)
- Delete `sessions` row (`tableClient.deleteEntity('sessions', sessionId)`)
- Delete `addresses` row (`tableClient.deleteEntity('addresses', peerAddress)`)

### buildContainerGroupSpec additions

Pass identity, session ID, tunnel config, and storage endpoint to the container:

```js
identity: {
  type: 'UserAssigned',
  userAssignedIdentities: { [process.env.VPN_CONTAINER_IDENTITY_ID]: {} },
},
// ...
environmentVariables: [
  { name: 'WG_SERVER_PRIVATE_KEY', secureValue: serverPrivateKey },
  { name: 'WG_SERVER_ADDRESS', value: `${serverAddress}/${cidr}` },
  { name: 'WG_SERVER_PORT', value: String(WIREGUARD_PORT) },
  { name: 'SESSION_ID', value: sessionId },
  { name: 'STORAGE_ACCOUNT', value: STORAGE_ACCOUNT_NAME },
  { name: 'STORAGE_TABLE_ENDPOINT', value: process.env.STORAGE_TABLE_ENDPOINT },
  { name: 'IDLE_TIMEOUT_MINUTES', value: String(IDLE_TIMEOUT_MINUTES) },
],
```

## CheckVPNStatus changes

### Finalization flow

`CheckVPNStatus` reads the `sessions` table row first to determine state:

1. Try to read `sessions` row for `sessionId`
   - If 404: session unknown — proceed to ACI check only (no table row = legacy or race)
2. If `status == 'Running'`: read and return Key Vault secret directly
3. If `status == 'Provisioning'` and ACI `provisioningState != 'Succeeded'`: return
   `{ status: 'Provisioning', ip: null, port: null }`
4. If `status == 'Provisioning'` and ACI `provisioningState == 'Succeeded'`: finalize:
   a. Read `wg-server-key-<sessionId>` from Key Vault
   b. Derive server public key using `createPublicKey` (same logic as `StartVPN`)
   c. Read `peerAddress` from the sessions row
   d. Build full client config with real endpoint (`${ip}:${port}`)
   e. Store config in Key Vault as `wg-peer-config-<sessionId>`
   f. Update `sessions` row `status` to `'Running'` using **ETag conditional update** — if
      another concurrent `CheckVPNStatus` already finalized, the 412 is caught and the
      already-written Key Vault secret is returned instead
5. Return `{ status: 'Running', ip, port, clientConfig }`

This replaces the brittle `Endpoint = <PENDING>` content-parsing approach. The ETag
conditional update ensures at-most-one finalization write path.

## Response contract changes

| Endpoint | Before | After |
|---|---|---|
| POST /StartVPN (new session) | 200 Running + clientConfig | 202 Provisioning, no config |
| POST /StartVPN (existing session) | 200 Running + clientConfig | 200 Running + clientConfig |
| GET /CheckVPNStatus (provisioning) | 200 Provisioning, null ip | 200 Provisioning, null ip |
| GET /CheckVPNStatus (first running read) | 200 Running, no config | 200 Running + clientConfig |
| GET /CheckVPNStatus (subsequent reads) | 200 Running, no config | 200 Running + clientConfig |

## Environment variables added

| Name | Default | Set in |
|---|---|---|
| `STORAGE_TABLE_ENDPOINT` | `https://<account>.table.core.windows.net` | function-app.bicep |
| `VPN_TUNNEL_SUBNET` | `10.8.0.0/24` | function-app.bicep (from `vpnConfig.tunnelSubnet`) |
| `VPN_DNS_SERVER` | `1.1.1.1` | function-app.bicep (from `vpnConfig.dnsServer`) |
| `VPN_CONTAINER_IDENTITY_ID` | (output of identity module) | function-app.bicep |

## Dependencies added

| Package | Version | Notes |
|---|---|---|
| `@azure/data-tables` | `^13.0.0` | Azure Table Storage SDK |

## Tests

- `StartVPN`: returns 202 on new session; allocates next free peer address atomically;
  retries on 409 address lock conflict; returns 503 when pool exhausted; cleans up all three
  artifacts (KV secret, sessions row, addresses row) on ACI failure
- `CheckVPNStatus`: returns Provisioning when ACI not yet ready; finalizes config on first
  Running read (derives pubkey from KV private key); handles concurrent finalization via ETag
  (412 → returns existing secret); returns cached config on subsequent reads
