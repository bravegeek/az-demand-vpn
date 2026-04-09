## ADDED Requirements

### Requirement: StartVPN creates an on-demand ACI container group
The system SHALL create a new ACI container group using `@azure/arm-containerinstance` when `StartVPN` is invoked. The container group SHALL reference the public GHCR WireGuard image. The Function SHALL NOT create a container group if one already exists for the requesting session.

#### Scenario: Successful VPN start
- **WHEN** a POST request is made to `/api/StartVPN` with a valid session identifier
- **THEN** a new ACI container group is created in the configured resource group
- **THEN** a WireGuard peer config is generated and stored in Key Vault
- **THEN** the response includes the container's public IP and the WireGuard client config

#### Scenario: Container group already exists
- **WHEN** a POST request is made to `/api/StartVPN` and a container group for that session already exists
- **THEN** the existing container group IP and client config are returned without creating a new group
- **THEN** HTTP 200 is returned (not 409)

#### Scenario: ACI creation fails
- **WHEN** the ACI container group creation fails (quota exceeded, region unavailable, etc.)
- **THEN** HTTP 503 is returned with a descriptive error message
- **THEN** no partial resources are left in the resource group

---

### Requirement: StopVPN destroys the ACI container group
The system SHALL delete the ACI container group and its associated WireGuard peer config from Key Vault when `StopVPN` is invoked.

#### Scenario: Successful VPN stop
- **WHEN** a DELETE request is made to `/api/StopVPN` with a valid session identifier
- **THEN** the ACI container group is deleted
- **THEN** the WireGuard peer config is removed from Key Vault
- **THEN** HTTP 200 is returned

#### Scenario: Container group not found
- **WHEN** a DELETE request is made to `/api/StopVPN` and no container group exists for that session
- **THEN** HTTP 404 is returned
- **THEN** no error is thrown and no resources are affected

---

### Requirement: CheckVPNStatus returns current container state
The system SHALL return the current state of the ACI container group when `CheckVPNStatus` is invoked, including provisioning state and public IP if available.

#### Scenario: Container is running
- **WHEN** a GET request is made to `/api/CheckVPNStatus` with a valid session identifier
- **THEN** HTTP 200 is returned with `{ status: "Running", ip: "<public-ip>", port: 51820 }`

#### Scenario: Container is provisioning
- **WHEN** a GET request is made to `/api/CheckVPNStatus` and the container group is still being created
- **THEN** HTTP 200 is returned with `{ status: "Provisioning", ip: null }`

#### Scenario: No container exists
- **WHEN** a GET request is made to `/api/CheckVPNStatus` and no container group exists for that session
- **THEN** HTTP 404 is returned with `{ status: "NotFound" }`

---

### Requirement: AutoShutdown reaps idle container groups
The system SHALL periodically check all VPN container groups and delete any that have been running longer than `idleTimeoutMinutes` without an active WireGuard peer connection.

#### Scenario: Idle container reaped
- **WHEN** the AutoShutdown timer fires (every 5 minutes)
- **THEN** any container group running longer than `idleTimeoutMinutes` with no active peers SHALL be deleted
- **THEN** the corresponding Key Vault peer config SHALL be removed

#### Scenario: Active container not reaped
- **WHEN** the AutoShutdown timer fires
- **THEN** container groups with at least one active WireGuard peer SHALL NOT be deleted

#### Scenario: AutoShutdown encounters a delete error
- **WHEN** deleting a container group fails during AutoShutdown
- **THEN** the error is logged to Application Insights
- **THEN** AutoShutdown continues processing remaining container groups (one failure does not halt the batch)

---

### Requirement: Function App authenticates to Azure using managed identity
The system SHALL use `DefaultAzureCredential` for all Azure SDK calls. No connection strings, keys, or client secrets SHALL be present in application settings or source code.

#### Scenario: Local development authentication
- **WHEN** a Function runs locally
- **THEN** `DefaultAzureCredential` resolves via Azure CLI credentials (`az login`)

#### Scenario: Production authentication
- **WHEN** a Function runs in Azure
- **THEN** `DefaultAzureCredential` resolves via the Function App's system-assigned managed identity
