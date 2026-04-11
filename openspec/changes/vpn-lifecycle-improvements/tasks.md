## 1. Bicep — UserAssigned container identity

- [x] 1.1 Add `Microsoft.ManagedIdentity/userAssignedIdentities` resource (`vpn-container-identity`) to `infra/main.bicep`
- [x] 1.2 Add `Storage Table Data Contributor` role assignment for `vpn-container-identity` → Storage Account in `infra/main.bicep`
- [x] 1.3 Add `VPN_CONTAINER_IDENTITY_ID` app setting to `infra/modules/function-app.bicep` (identity resource ID output)
- [x] 1.4 Run `az bicep build infra/main.bicep` — zero errors

## 2. Bicep — new Function App env vars

- [x] 2.1 Add `STORAGE_TABLE_ENDPOINT`, `VPN_TUNNEL_SUBNET`, `VPN_DNS_SERVER` app settings to `infra/modules/function-app.bicep`; add `tunnelSubnet`, `dnsServer`, `containerIdentityId` params
- [x] 2.2 Add `tunnelSubnet: '10.8.0.0/24'` and `dnsServer: '1.1.1.1'` to `vpnConfig` default in `infra/main.bicep`; pass to `functionApp` module

## 3. Shared infrastructure — Table client

- [x] 3.1 Add `@azure/data-tables` to `src/functions/package.json` dependencies
- [x] 3.2 Add `getTableClient()` to `src/functions/shared/azureClient.js` — returns a `TableClient` for `vpn-sessions` using `STORAGE_TABLE_ENDPOINT` + managed identity

## 4. StartVPN — peer address allocation

- [x] 4.1 Derive `serverAddress`, `poolBase`, `cidr` from `VPN_TUNNEL_SUBNET` in `StartVPN/index.js`
- [x] 4.2 Implement `allocatePeerAddress(tableClient, poolBase, sessionId)` — scan `addresses` partition, claim first free address with `If-None-Match: *`, retry on 409
- [x] 4.3 Implement `writeSessionRow(tableClient, sessionId, peerAddress)` — creates `sessions` row with `status: 'Provisioning'`
- [x] 4.4 Update handler: allocate address → generate keys → store KV server key → write session row → begin ACI (no `pollUntilDone`) → return 202
- [x] 4.5 Update error cleanup to delete sessions row and addresses row on ACI failure
- [x] 4.6 Update `buildContainerGroupSpec`: switch to UserAssigned identity; add `SESSION_ID`, `WG_SERVER_ADDRESS` (with CIDR), `STORAGE_TABLE_ENDPOINT` env vars; remove hardcoded peer address

## 5. CheckVPNStatus — lazy finalization

- [x] 5.1 Add `tableClient` from `getTableClient()` to `CheckVPNStatus`
- [x] 5.2 Read `sessions` row first; branch on `status` column (`Provisioning` vs `Running`)
- [x] 5.3 On first `Running` read (status=Provisioning + ACI Succeeded): read KV server private key, derive public key with `createPublicKey`, build client config, write KV peer config secret, update sessions row `status` to `'Running'` with ETag conditional update
- [x] 5.4 Handle 412 on ETag conflict (concurrent finalization): read and return already-written KV secret
- [x] 5.5 Include `clientConfig` in all `Running` responses

## 6. StopVPN — table cleanup

- [x] 6.1 Add `tableClient` from `getTableClient()` to `StopVPN`
- [x] 6.2 Read `peerAddress` from `sessions` row before deleting
- [x] 6.3 Delete `sessions` row and `addresses` row on teardown (best-effort, non-failing)

## 7. AutoShutdown — heartbeat-based idle detection

- [x] 7.1 Change `isIdle` to `async isIdle(group, tableClient)` — read `lastHandshakeAt` from `sessions` row; fall back to container start time on 404 (legacy sessions)
- [x] 7.2 Update `AutoShutdown` handler to pass `tableClient` to `isIdle` and `await` it
- [x] 7.3 Add `tableClient` from `getTableClient()` to `AutoShutdown`

## 8. Container — heartbeat script

- [x] 8.1 Create `infra/container/scripts/heartbeat.sh` — reads `wg show wg0 latest-handshakes`, writes most recent epoch to `vpn-sessions` table via Storage REST API + IMDS token; caches token with 1-hour refresh; handles 401 by clearing token cache
- [x] 8.2 Update `infra/container/scripts/entrypoint.sh` — use `WG_SERVER_ADDRESS` as-is (with CIDR, no appended `/24`); start heartbeat in background; kill heartbeat PID in SIGTERM/SIGINT trap
- [x] 8.3 Run `docker build -t az-demand-vpn-wg infra/container/` — verify build succeeds with heartbeat.sh included

## 9. Tests

- [x] 9.1 `StartVPN`: 202 on new session; address allocation with retry on 409; 503 on pool exhausted; cleans up KV + sessions row + addresses row on ACI failure; sets UserAssigned identity in container spec
- [x] 9.2 `CheckVPNStatus`: returns Provisioning when ACI not ready; finalizes config on first Running read (derives pubkey from KV private key, not from table); handles concurrent finalization via 412; returns cached config on subsequent reads
- [x] 9.3 `StopVPN`: deletes sessions row and addresses row on teardown
- [x] 9.4 `AutoShutdown`: idle when `lastHandshakeAt` past timeout; active when recent; falls back to start-time on 404 (no sessions row)
- [x] 9.5 Run `npm test` — all tests pass

## 10. Build verification

- [x] 10.1 Run `az bicep build infra/main.bicep` — zero errors
- [x] 10.2 Run `docker build -t az-demand-vpn-wg infra/container/` — zero errors
