# Proposal: VPN Lifecycle Improvements

## Problem

Three architectural issues limit the production readiness of the current VPN lifecycle:

### 1. StartVPN blocks on ACI provisioning (async gap)

`StartVPN` calls `pollUntilDone()` synchronously, blocking until the ACI container group is
fully provisioned. ACI provisioning typically takes 30–90 seconds. Azure Functions on Flex
Consumption have a default HTTP timeout of 230 seconds, but a long-running synchronous start
creates poor UX, wastes function execution time, and is one platform timeout away from leaving
orphaned containers.

The correct pattern for long-running operations is: accept the request immediately (202
Accepted), return a job/session ID, and let the caller poll `CheckVPNStatus` for readiness.

### 2. Peer address allocation is hardcoded

`StartVPN` hardcodes `peerAddress = '10.8.0.2/32'` for every session. A second concurrent
VPN session would receive the same peer address, causing WireGuard routing conflicts and
silent data leakage between clients.

Peer addresses must be allocated per-session from a pool and tracked in durable storage.

### 3. Idle detection uses start time, not actual activity

`AutoShutdown.isIdle()` measures `Date.now() - container.startTime`. A container that has
been running for 35 minutes (past the 30-minute threshold) will be reaped even if a client
actively connected 5 minutes ago.

Accurate idle detection requires the WireGuard container to report actual peer activity (last
handshake time) back to a shared store, which `AutoShutdown` can then read.

## Proposed Solution

### Async StartVPN (202 + poll)

Change `StartVPN` to fire-and-forget ACI creation: call `beginCreateOrUpdate` without
`pollUntilDone`, store a `status: 'Provisioning'` record in Azure Table Storage, and return
`202 Accepted` with the sessionId. The caller polls `CheckVPNStatus` (already exists) until
`status: 'Running'`.

### Peer address allocation via Storage Table

Introduce a `vpn-sessions` Storage Table. Each row stores `sessionId`, `peerAddress`,
`serverPublicKey`, and `createdAt`. `StartVPN` allocates the next free `/32` from
`10.8.0.2–10.8.0.254` by scanning existing rows, writes the allocation atomically, and
stores the peer config in Key Vault as before.

`StopVPN` deletes the table row on teardown, returning the address to the pool.

### Heartbeat-based idle detection

Add a lightweight heartbeat to the WireGuard container: a cron-style loop (every 60 seconds)
that reads `wg show wg0 latest-handshakes`, parses the most recent handshake timestamp, and
writes it to Azure Table Storage (`vpn-sessions` row, `lastHandshakeAt` column).

`AutoShutdown.isIdle()` reads `lastHandshakeAt` from the table instead of using container
start time. A container is idle if `lastHandshakeAt` is absent (never connected) and
`createdAt` is past the timeout, OR if `lastHandshakeAt` is past the timeout.

## Non-goals

- Multi-region peer address allocation (single region only)
- WireGuard peer key rotation
- Per-session bandwidth or time quotas
- High-availability ACI (single container per session)

## Success Criteria

- `StartVPN` returns `202 Accepted` within 2 seconds regardless of ACI provisioning time
- Two concurrent sessions receive distinct peer addresses
- A container with an active WireGuard handshake within the idle window is not reaped by
  `AutoShutdown`
- All existing tests continue to pass; new tests cover the allocation and heartbeat logic
