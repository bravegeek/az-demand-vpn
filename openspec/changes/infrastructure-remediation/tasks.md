## 1. Bicep — Remove ACR and standing VPN container

- [ ] 1.1 Remove `vpnContainer` module block and its outputs from `infra/main.bicep`
- [ ] 1.2 Remove `acr` module block and its outputs from `infra/main.bicep`
- [ ] 1.3 Remove `acrConfig` parameter from `infra/main.bicep`
- [ ] 1.4 Add `// TODO: Add ACR as optional private registry — see design.md Decision 1` comment where ACR module was
- [ ] 1.5 Delete `infra/modules/container-registry.bicep`
- [ ] 1.6 Add `// runtime-only: used by StartVPN function via @azure/arm-containerinstance` comment to `infra/modules/vpn-container.bicep`

## 2. Bicep — Fix vpn-container.bicep

- [ ] 2.1 Replace fake storage key (`last(split(storageAccountId, '/'))`) with `listKeys(storageAccountId, '2023-01-01').keys[0].value`
- [ ] 2.2 Remove `imageRegistryCredentials` block entirely (public GHCR image, no auth needed)
- [ ] 2.3 Replace `httpGet` liveness probe with `exec: { command: ['wg', 'show'] }`
- [ ] 2.4 Remove readiness probe
- [ ] 2.5 Remove `openvpnPort` parameter and all references to port 1194
- [ ] 2.6 Update image reference to `ghcr.io/<org>/az-demand-vpn-wg:latest`

## 3. Bicep — Fix function-app.bicep

- [ ] 3.1 Replace `AzureWebJobsStorage: storageAccountId` with `AzureWebJobsStorage__accountName` + `AzureWebJobsStorage__credential: 'managedidentity'`
- [ ] 3.2 Fix `APPLICATIONINSIGHTS_CONNECTION_STRING` — replace resource ID with `reference(appInsightsId, '2020-02-02').ConnectionString`
- [ ] 3.3 Fix VNet name extraction — replace `last(split(subnetId, '/'))` with `split(subnetId, '/')[8]`
- [ ] 3.4 Change default runtime to `node` and version to `20` in `infra/main.bicep` `functionConfig` parameter
- [ ] 3.5 Set `FUNCTIONS_WORKER_RUNTIME: 'node'` and `WEBSITE_NODE_DEFAULT_VERSION: '~20'` in app settings
- [ ] 3.6 Switch App Service plan from Premium P1V2 to Flex Consumption; remove `alwaysOn` setting
- [ ] 3.7 Add RBAC role assignments for Function App managed identity: `Storage Blob Data Owner`, `Storage Queue Data Contributor`, `Storage Table Data Contributor`

## 4. Bicep — Network and parameter cleanup

- [ ] 4.1 Remove `openvpnPort` parameter from `infra/modules/network.bicep` and all NSG rules referencing UDP 1194
- [ ] 4.2 Remove `openvpnPort` from `vpnConfig` in `infra/main.bicep`
- [ ] 4.3 Disable private endpoints in `infra/parameters.dev.json`
- [ ] 4.4 Add `substring()` length guards for ACR and storage account resource names in `infra/main.bicep`
- [ ] 4.5 Run `az bicep build infra/main.bicep` — verify zero errors

## 5. Container image — scripts

- [ ] 5.1 Create `infra/container/scripts/entrypoint.sh` — init WireGuard interface, enable IP forwarding, configure iptables NAT, block until stopped
- [ ] 5.2 Create `infra/container/scripts/generate-config.sh` — generate `wg-quick`-compatible peer config from server pubkey, endpoint, and peer pubkey args
- [ ] 5.3 Create `infra/container/scripts/health-check.sh` — run `wg show`, exit 0 if interface up, non-zero otherwise
- [ ] 5.4 Run `docker build -t az-demand-vpn-wg infra/container/` — verify build succeeds
- [ ] 5.5 Run container locally and verify `docker exec <id> wg show` exits 0

## 6. Container image — GHCR publish

- [ ] 6.1 Confirm GitHub org/repo name and update image reference in `vpn-container.bicep` and tasks above
- [ ] 6.2 Create `.github/workflows/build-push-image.yml` — triggers on push to `main`, builds and pushes `ghcr.io/<org>/az-demand-vpn-wg:latest`
- [ ] 6.3 Set GHCR package visibility to public
- [ ] 6.4 Verify ACI can pull the image without credentials (create a test container group manually)

## 7. Azure Functions — setup

- [ ] 7.1 Create `src/functions/` directory and `package.json` with `@azure/arm-containerinstance`, `@azure/identity`, `@azure/keyvault-secrets` dependencies
- [ ] 7.2 Create `src/functions/host.json` configured for Azure Functions v4, Node.js
- [ ] 7.3 Add Jest dev dependencies and `jest.config.js`
- [ ] 7.4 Create `src/functions/shared/azureClient.js` — exports `DefaultAzureCredential` instance and ARM container client

## 8. Azure Functions — implementation

- [ ] 8.1 Implement `src/functions/StartVPN/index.js` — create ACI container group via SDK, generate and store WireGuard peer config in Key Vault, return IP + client config
- [ ] 8.2 Implement `src/functions/StopVPN/index.js` — delete ACI container group, remove peer config from Key Vault
- [ ] 8.3 Implement `src/functions/CheckVPNStatus/index.js` — query ACI container group state, return status and IP
- [ ] 8.4 Implement `src/functions/AutoShutdown/index.js` — timer trigger (5 min), list container groups, delete idle ones past `idleTimeoutMinutes`

## 9. Azure Functions — tests

- [ ] 9.1 Write Jest tests for `StartVPN`: expected start, already-running idempotency, ACI failure → 503
- [ ] 9.2 Write Jest tests for `StopVPN`: successful delete, not-found → 404
- [ ] 9.3 Write Jest tests for `CheckVPNStatus`: running, provisioning, not-found states
- [ ] 9.4 Write Jest tests for `AutoShutdown`: idle container reaped, active container spared, partial failure continues batch
- [ ] 9.5 Run `npm test` — all tests pass

## 10. End-to-end validation

- [ ] 10.1 Deploy infra with `az deployment group create --what-if` — verify no unexpected changes
- [ ] 10.2 Deploy infra — verify Function App starts and Application Insights receives telemetry
- [ ] 10.3 Call `StartVPN` — verify ACI container group created, WireGuard interface comes up, client config returned
- [ ] 10.4 Call `CheckVPNStatus` — verify running state and IP returned
- [ ] 10.5 Connect a WireGuard client using the returned config — verify tunnel works
- [ ] 10.6 Call `StopVPN` — verify container group deleted, Key Vault secret removed
- [ ] 10.7 Wait for `AutoShutdown` timer — verify idle containers are reaped
