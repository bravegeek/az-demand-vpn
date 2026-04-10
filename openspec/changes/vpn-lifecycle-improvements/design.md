# Design: VPN Lifecycle Improvements

## Decision 1: Storage Table schema for session state

**Options considered:**
- A. Blob JSON per session (simple, no querying)
- B. Azure Table Storage (structured, supports atomic ops, already provisioned)
- C. Cosmos DB (overkill, not provisioned)

**Decision: B — Azure Table Storage**

The `vpn-sessions` table uses `partitionKey: 'sessions'`, `rowKey: sessionId`. Columns:
`peerAddress` (string), `serverPublicKey` (string), `createdAt` (ISO 8601),
`lastHandshakeAt` (ISO 8601, optional). Table Storage supports conditional writes via
ETags for safe concurrent allocation. No new Azure resources required — Storage Account is
already provisioned.

## Decision 2: Peer address allocation strategy

**Options considered:**
- A. Scan all rows, find first unused address (simple, O(n) scan)
- B. Maintain a free-list in a separate table entity (complex, requires distributed lock)
- C. Use sessionId hash to derive address (deterministic, possible collisions)

**Decision: A — scan + first-free, with per-address lock entity**

A plain scan + first-free without a lock has a TOCTOU race: two concurrent `StartVPN` calls
can both scan, both pick the same address, and both write session rows with different rowKeys
— both succeed, two containers share one peer address, traffic leaks between clients.

Fix: use the address itself as the concurrency lock. The `vpn-sessions` table has two
partitions:

- `sessions` — one row per session (rowKey: sessionId), holds `peerAddress`, `createdAt`,
  `lastHandshakeAt`, `status`
- `addresses` — one row per allocated address (rowKey: e.g. `10.8.0.2`), holds `sessionId`

Allocation sequence:

1. Scan `addresses` partition to build the set of used addresses (O(n), n ≤ 253)
2. Pick the lowest free address from the pool
3. Write to `addresses` partition with `If-None-Match: *` (rowKey = address) — only one
   concurrent caller wins; the other gets a 409 and must retry from step 1
4. Write `sessions` row (rowKey = sessionId)
5. If no address is free after retry, return `503 { error: 'VPN pool exhausted' }`

`StopVPN` deletes the `addresses` row to return the address to the pool.

**Known risk — pool exhaustion DoS:** a caller with the function key can create 253 sessions
and deny the pool to others. Mitigation (future work): per-caller session cap enforced by
counting `sessions` rows filtered by a `callerId` column.

## Decision 3: Heartbeat mechanism

**Options considered:**
- A. Sidecar container in the same ACI group writes heartbeat
- B. Main container entrypoint runs a background loop writing heartbeat
- C. ACI diagnostics / log scraping from Functions (read-only, no writes needed in container)
- D. Network traffic monitoring via NSG flow logs (complex, delayed)

**Decision: B — background loop in entrypoint**

The entrypoint already has a `while true; do sleep 30; done` blocking loop. Replace it with a
loop that also runs `wg show wg0 latest-handshakes`, parses the output, and writes to Table
Storage. The container's managed identity (ACI `SystemAssigned`) gets `Storage Table Data
Contributor` RBAC on the Storage Account via a new role assignment in `main.bicep`.

Heartbeat write uses `az` CLI or `curl` with the managed identity token. Since the container
is Alpine-based, `curl` is available. The heartbeat script writes a single row to the
`vpn-sessions` table using the Storage REST API with a bearer token from IMDS.

## Decision 4: ACI managed identity → Storage RBAC

**Options considered:**
- A. SystemAssigned identity per container + runtime role assignment via ARM Authorization API
  (requires Function App to have `User Access Administrator` on the Storage Account — allows
  assigning any role to any principal, significant privilege escalation risk if compromised)
- B. UserAssigned managed identity shared across all ACI containers, assigned in Bicep at
  deploy time

**Decision: B — UserAssigned identity, Bicep-assigned RBAC**

A `UserAssigned` managed identity (`vpn-container-identity`) is created in `infra/main.bicep`
and granted `Storage Table Data Contributor` on the Storage Account at deploy time. `StartVPN`
passes its resource ID as an env var (`VPN_CONTAINER_IDENTITY_ID`); `buildContainerGroupSpec`
uses:

```js
identity: {
  type: 'UserAssigned',
  userAssignedIdentities: { [containerIdentityId]: {} },
}
```

No runtime role assignment. No `@azure/arm-authorization` dependency. The Function App's
managed identity needs no IAM write permissions.

`VPN_CONTAINER_IDENTITY_ID` is added as an app setting in `function-app.bicep`, sourced from
the new identity module output.

## Decision 5: CheckVPNStatus — where to get client config on 202→Running transition

When `StartVPN` returns 202, the client config is not yet available (peer keys not yet
generated — ACI must be running before we know the public IP for the `Endpoint` field).

`StartVPN` will generate and store the key pair and peer config in Key Vault **before**
launching ACI (same as today), using a placeholder endpoint that is updated once provisioning
completes. Actually, the IP is available from `pollUntilDone` result — but we want to avoid
blocking.

**Revised approach:** `StartVPN` generates keys, stores the server private key in Key Vault,
launches ACI without waiting, and stores `status: 'Provisioning'` in the table with
`serverPublicKey` but no `clientConfig` yet. A background step is needed to write the full
client config once the IP is known.

**Two options:**
- A. `CheckVPNStatus` detects `Succeeded` provisioning state, generates config on first read
- B. A separate `FinalizeVPN` function triggered by an Event Grid event on ACI state change

**Decision: A — lazy config generation in CheckVPNStatus**

`CheckVPNStatus` checks if `provisioningState == 'Succeeded'` and Key Vault secret is absent.
If so, it reads the server public key from the table, reads the public IP from ACI, builds and
stores the client config in Key Vault, and returns it. Subsequent calls return the cached
secret. This avoids a new function and Event Grid dependency.

## Decision 6: CheckVPNStatus finalization state tracking

**Problem:** The original proposal detected the "needs finalization" state by parsing the
Key Vault secret body for `Endpoint = <PENDING>`. This is brittle (content parsing), and two
concurrent `CheckVPNStatus` calls on a newly-provisioned container both attempt to write Key
Vault — racy and wasteful.

**Decision: use a `status` column in the `sessions` table row as the canonical state.**

Values: `'Provisioning'` | `'Running'`. `StartVPN` writes `status: 'Provisioning'`.
`CheckVPNStatus` reads the sessions row first:
- If `status == 'Provisioning'` and ACI `provisioningState == 'Succeeded'`: finalize (build
  config, write Key Vault, update row `status` to `'Running'` with ETag conditional update)
- If `status == 'Running'`: read and return Key Vault secret directly

The ETag conditional update on `status` ensures only one concurrent `CheckVPNStatus` call
performs finalization — the other gets a 412 Precondition Failed and retries as a normal
`Running` read. No Key Vault content parsing.

`serverPublicKey` is **not** stored in the table. During finalization, `CheckVPNStatus` reads
`wg-server-key-<sessionId>` from Key Vault (already stored by `StartVPN`), derives the
public key using `createPublicKey`, and builds the client config. Removes redundant data from
the table.

## Decision 7: Backward compatibility

Existing sessions created before this change have no table row. `AutoShutdown` must handle
missing table rows gracefully: if no row exists for a `vpn-*` container group, fall back to
the start-time heuristic (existing behavior) for one release, then remove the fallback in a
follow-up change.
