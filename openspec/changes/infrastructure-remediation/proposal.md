## Why

The current infrastructure scaffolding contains critical bugs that prevent deployment from functioning: fake credentials wired as resource IDs, broken health probes on a non-existent HTTP port, and a Function App that cannot start. Additionally, the core on-demand architecture is inverted — the VPN container is deployed as a standing resource in the Bicep stack rather than being created at runtime by Azure Functions, which defeats the cost model and the design intent.

## What Changes

- **BREAKING** Remove `vpn-container` module from `main.bicep` — the VPN container must not be provisioned as standing infrastructure
- Fix storage account credential in `vpn-container.bicep` — replace fake key extraction with `listKeys()` or managed identity
- Fix ACR credential in `vpn-container.bicep` — remove `imageRegistryCredentials` block; use managed identity pull (`AcrPull` role)
- Fix WireGuard health probe — replace HTTP/8080 probe with `exec: wg show`
- Fix `AzureWebJobsStorage` in `function-app.bicep` — replace resource ID with managed identity connection pattern
- Fix `APPLICATIONINSIGHTS_CONNECTION_STRING` in `function-app.bicep` — replace resource ID with actual connection string reference
- Fix VNet name extraction in `function-app.bicep` — `last(split(subnetId, '/'))` returns subnet name, not VNet name
- Fix Function App runtime — change default from `dotnet` to `node` (v20)
- Create missing container scripts (`entrypoint.sh`, `generate-config.sh`, `health-check.sh`) so the image can be built
- Implement the four Azure Functions (`StartVPN`, `StopVPN`, `CheckVPNStatus`, `AutoShutdown`) — no application code currently exists
- Downgrade Function App plan from Premium P1V2 (~$140/month) to Flex Consumption with VNet integration
- Remove private endpoints from dev environment parameters
- Remove all OpenVPN (port 1194) references — project is WireGuard-only
- Add resource name length guards to prevent exceeding Azure service limits

## Capabilities

### New Capabilities

- `vpn-lifecycle`: On-demand ACI container lifecycle management — `StartVPN` creates a container group at runtime using the Azure SDK, `StopVPN` destroys it, `CheckVPNStatus` queries state, `AutoShutdown` reaps idle containers
- `wireguard-container`: Buildable WireGuard container image — entrypoint, config generation, and health check scripts for the Alpine-based ACI image

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **`infra/main.bicep`**: Remove `vpnContainer` module block and related outputs; fix `functionConfig` runtime default
- **`infra/modules/vpn-container.bicep`**: Fix storage key, ACR credentials, health probe; retain as runtime template for Functions to deploy
- **`infra/modules/function-app.bicep`**: Fix storage connection string, App Insights connection string, VNet name extraction, runtime setting; switch plan to Flex Consumption
- **`infra/parameters.dev.json`**: Remove private endpoint configuration
- **`infra/modules/network.bicep`**: Remove UDP 1194 NSG rules; remove `openvpnPort` parameter
- **`infra/container/scripts/`**: New files — `entrypoint.sh`, `generate-config.sh`, `health-check.sh`
- **`src/functions/`**: New directory — four Azure Functions in JavaScript/Node.js with Jest tests
- **Dependencies added**: `@azure/arm-containerinstance`, `@azure/identity` (for managed identity SDK auth)
