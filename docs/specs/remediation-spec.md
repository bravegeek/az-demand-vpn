# Remediation Spec — Critical Review Findings

**Date**: 2026-04-08  
**Status**: Open  
**Priority**: P0 blockers first, then P1 architectural fixes, then P2 improvements

---

## Background

A full project review identified critical bugs that prevent deployment from functioning, an architectural inversion in the Bicep stack, and missing application code. This spec tracks the required fixes in priority order.

---

## P0 — Blockers (Infrastructure Deploys But Nothing Works)

### P0-1: Remove vpn-container from the Bicep stack

**File**: `infra/main.bicep`  
**Problem**: `vpn-container.bicep` is wired into the main deployment as a static, always-on ACI container group. This directly contradicts the on-demand model — the container should not exist until a user triggers `StartVPN`. A static container defeats cost savings and the core design premise.  
**Fix**: Remove the `vpnContainer` module block and its outputs from `main.bicep`. The vpn-container Bicep template should be retained as a reference template that the `StartVPN` Azure Function deploys at runtime via the Azure SDK (`@azure/arm-containerinstance`), not as part of the standing infrastructure.

---

### P0-2: Fix storage volume mount credential in vpn-container.bicep

**File**: `infra/modules/vpn-container.bicep`  
**Problem**:
```bicep
storageAccountKey: last(split(storageAccountId, '/'))
```
`last(split(storageAccountId, '/'))` extracts the storage account resource name, not an access key. The ACI volume mount will fail at container startup.  
**Fix**: Use managed identity for storage access instead of a key. Grant the container group's managed identity the `Storage Blob Data Contributor` role on the storage account and mount via Azure File Share with identity-based access. If a key is unavoidable for ACI file share mounts (ACI currently requires a key for Azure Files volumes), retrieve the key from Key Vault at deploy time using `listKeys()`:
```bicep
storageAccountKey: listKeys(storageAccountId, '2023-01-01').keys[0].value
```

---

### P0-3: Fix ACR pull credential in vpn-container.bicep

**File**: `infra/modules/vpn-container.bicep`  
**Problem**: ACR password is set to the same fake resource-name pattern as the storage key.  
**Fix**: Disable admin credentials on ACR (already the default in `main.bicep` — `adminUserEnabled: false`). Use managed identity pull: assign the container group's managed identity the `AcrPull` role on the ACR resource. Remove the `imageRegistryCredentials` block entirely when using managed identity pull.

---

### P0-4: Fix Function App storage connection string

**File**: `infra/modules/function-app.bicep`  
**Problem**:
```bicep
AzureWebJobsStorage: storageAccountId
```
A resource ID is not a connection string. The Functions host will fail to start.  
**Fix**: Use the managed identity pattern for Functions storage:
```bicep
AzureWebJobsStorage__accountName: last(split(storageAccountId, '/'))
AzureWebJobsStorage__credential: 'managedidentity'
```
Grant the Function App's managed identity `Storage Blob Data Owner` + `Storage Queue Data Contributor` + `Storage Table Data Contributor` on the storage account.

---

### P0-5: Fix Application Insights connection string

**File**: `infra/modules/function-app.bicep`  
**Problem**:
```bicep
APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsId
```
A resource ID is not a connection string. Application Insights telemetry will not be emitted.  
**Fix**: Pass the actual connection string from the Application Insights module output:
```bicep
APPLICATIONINSIGHTS_CONNECTION_STRING: reference(appInsightsId, '2020-02-02').ConnectionString
```
Or add a `connectionString` output to `modules/application-insights.bicep` and pass it through.

---

### P0-6: Fix VNet name extraction in function-app.bicep

**File**: `infra/modules/function-app.bicep`  
**Problem**:
```bicep
vnetName: last(split(subnetId, '/'))
```
`last(split(subnetId, '/'))` returns the subnet name, not the VNet name. VNet integration will be misconfigured and the Function App will not be able to reach private endpoints.  
**Fix**: The subnet ID format is `.../virtualNetworks/{vnetName}/subnets/{subnetName}`. Extract the VNet name with:
```bicep
vnetName: split(subnetId, '/')[8]
```
Or pass `vnetName` as an explicit parameter from `main.bicep`.

---

### P0-7: Fix WireGuard health probe

**File**: `infra/modules/vpn-container.bicep`  
**Problem**: Liveness and readiness probes use `httpGet` on port 8080. WireGuard is UDP-only — no HTTP server exists in the container on any port.  
**Fix**: Use an `exec` probe that checks WireGuard interface state:
```bicep
livenessProbe: {
  exec: {
    command: ['wg', 'show']
  }
  initialDelaySeconds: 10
  periodSeconds: 30
}
```
Remove the readiness probe entirely — ACI readiness probes don't gate traffic the same way Kubernetes does; they add no value here.

---

### P0-8: Fix Function App runtime

**File**: `infra/main.bicep`  
**Problem**: `functionConfig.runtime` defaults to `'dotnet'`. The project standard (and all planned Functions) is JavaScript/Node.js.  
**Fix**: Change the default:
```bicep
param functionConfig object = {
  runtime: 'node'
  version: '20'
  ...
}
```
Update `modules/function-app.bicep` to set `FUNCTIONS_WORKER_RUNTIME: 'node'` and `WEBSITE_NODE_DEFAULT_VERSION: '~20'`.

---

## P1 — Architecture Fixes

### P1-1: Create the missing container scripts

**Files needed**:
- `infra/container/scripts/entrypoint.sh`
- `infra/container/scripts/generate-config.sh`
- `infra/container/scripts/health-check.sh`

The Dockerfile COPYs these files but none exist. The image cannot be built. See `docs/specs/mvp-wireguard-container-spec.md` for the expected behavior of each script.

---

### P1-2: Write the Azure Functions

No application code exists. The four core Functions must be implemented in JavaScript/Node.js:

| Function | Trigger | Responsibility |
|----------|---------|----------------|
| `StartVPN` | HTTP POST | Create ACI container group via `@azure/arm-containerinstance`, generate WireGuard peer config, store in Key Vault |
| `StopVPN` | HTTP DELETE | Destroy ACI container group |
| `CheckVPNStatus` | HTTP GET | Query ACI container group state, return connection info |
| `AutoShutdown` | Timer (every 5 min) | List ACI groups, destroy any idle past `idleTimeoutMinutes` |

Each Function must have a Jest test covering: expected use, edge case, and failure case.  
Code location: `src/functions/` mirroring the module structure.

---

### P1-3: Update PLANNING.md to reflect current state

Phase 1 is marked as targeting June–July 2025. It is April 2026. The planning doc reads as aspirational rather than current. Update it to accurately reflect:
- What is complete (Bicep scaffolding, container Dockerfile skeleton)
- What is broken (P0 bugs above)
- What is missing (container scripts, all Functions, tests)
- Revised target dates

---

## P2 — Cost and Complexity Reductions

### P2-1: Downgrade Function App to Flex Consumption plan

**File**: `infra/main.bicep` / `infra/modules/function-app.bicep`  
**Problem**: P1V2 Premium plan costs ~$140/month. The sole reason to use Premium is VNet integration, which Flex Consumption also supports.  
**Fix**: Switch to Flex Consumption plan. Re-evaluate `alwaysOn: true` — meaningless on Consumption plans.

---

### P2-2: Remove private endpoints from dev environment

**File**: `infra/parameters.dev.json`  
**Problem**: Private endpoints for Storage and Key Vault add ~$7–14/month per endpoint in dev and require VNet-connected access for local development.  
**Fix**: Disable private endpoints in dev parameters. Use service endpoints or public access with IP restrictions for dev. Reserve private endpoints for prod.

---

### P2-3: Remove all OpenVPN references

**Files**: `infra/modules/network.bicep` (NSG rules), `infra/modules/vpn-container.bicep`, container scripts, docs  
**Problem**: The spec decision is WireGuard-only. OpenVPN (port 1194) NSG rules, config references, and documentation fragments are dead weight.  
**Fix**: Remove UDP 1194 from NSG rules, remove `openvpnPort` parameter from all modules, remove from `vpnConfig` in `main.bicep`.

---

### P2-4: Guard resource name lengths

**File**: `infra/main.bicep`  
**Problem**: `acr${projectName}${uniqueSuffix}` can exceed the 24-character ACR name limit. `st${projectName}${uniqueSuffix}` is similarly unguarded.  
**Fix**: Use `substring()` to cap names:
```bicep
acr: substring('acr${projectName}${uniqueSuffix}', 0, 24)
storage: substring('st${projectName}${uniqueSuffix}', 0, 24)
```

---

### P2-5: Evaluate ACR vs. GitHub Container Registry

**Current**: Azure Container Registry (Basic) — ~$5/month  
**Alternative**: GitHub Container Registry (`ghcr.io`) — free for public images, free private images for personal accounts  
**Consideration**: ACR adds managed identity pull support (valuable) and stays within Azure networking. Keep ACR if the team values air-gapped builds or private registry within the VNet. Drop it if simplicity and cost matter more for an early-stage project.

---

## Acceptance Criteria

| ID | Done when |
|----|-----------|
| P0-1 | `main.bicep` has no `vpnContainer` module; no ACI is created on `az deployment group create` |
| P0-2 | Storage volume mounts succeed; container starts without credential errors |
| P0-3 | ACI pulls image using managed identity; no `imageRegistryCredentials` with fake keys |
| P0-4 | Function App starts; `AzureWebJobsStorage` uses managed identity pattern |
| P0-5 | Application Insights receives telemetry from the Function App |
| P0-6 | Function App can reach Storage and Key Vault private endpoints |
| P0-7 | Container passes health probe using `wg show` |
| P0-8 | Function App runtime is `node`; `FUNCTIONS_WORKER_RUNTIME=node` in app settings |
| P1-1 | `docker build` succeeds; container starts and WireGuard interface comes up |
| P1-2 | All four Functions exist with passing Jest tests |
| P1-3 | PLANNING.md reflects April 2026 actual state |
| P2-1 | Function App plan is Flex Consumption; monthly infra cost projection drops below $30/month |
| P2-2 | Dev parameters have no private endpoints |
| P2-3 | No UDP 1194 in NSG rules; `openvpnPort` parameter removed |
| P2-4 | All resource names ≤ their service limits regardless of `projectName` length |
