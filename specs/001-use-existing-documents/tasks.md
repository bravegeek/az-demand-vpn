# Tasks: On-Demand VPN Provisioning System

**Input**: Design documents from `/home/greg/dev/az-demand-vpn/specs/001-use-existing-documents/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/, existing infra code

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → Tech stack: Node.js 18+, PowerShell 7+, Alpine Linux, Azure Functions
   → Extract: Azure SDK dependencies, WireGuard, iptables
2. Load design documents:
   → data-model.md: 5 entities (VPNSession, ClientConfiguration, UserTenant, OperationalEvent, InfrastructureState)
   → contracts/: 3 API contracts (StartVPN, StopVPN, StatusVPN)
   → quickstart.md: 6 integration test scenarios
   → research.md: Technology decisions validated
3. Existing infrastructure reviewed:
   → infra/: Bicep templates for all Azure resources (complete)
   → infra/container/: Dockerfile + 3 shell scripts (complete)
   → functions/: Does NOT exist (to be created)
   → tests/: Does NOT exist (to be created)
4. Generate tasks by category:
   → Setup: Node.js project, Azure Functions structure, dependencies
   → Tests: 3 contract tests, 6 integration tests (TDD approach)
   → Core: 5 data models, 4 Azure service wrappers, 3 Function endpoints
   → Integration: Authentication, logging, retry logic, idle timeout
   → Polish: Unit tests, performance validation, documentation
5. Apply task rules:
   → Different files = mark [P] for parallel execution
   → Tests before implementation (TDD principle)
   → Models before services before endpoints
6. Tasks numbered sequentially (T001-T052)
7. Dependencies mapped for execution order
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Exact file paths included in descriptions
- Infrastructure (infra/) already exists - focus on functions/ and tests/

---

## Phase 3.1: Setup & Project Structure

- [X] **T001** Create `functions/` directory structure with subdirectories: `provision/`, `deprovision/`, `status/`, `config/`, `shared/models/`, `shared/services/`, `shared/utils/`
- [X] **T002** Initialize Node.js project with `package.json` in `functions/` directory with name "az-demand-vpn-functions", version "1.0.0", Node.js 18+ engine requirement
- [X] **T003** Install Azure Functions dependencies: `@azure/functions@^4.0.0`, `@azure/arm-containerinstance@^9.0.0`, `@azure/identity@^4.0.0`, `@azure/keyvault-secrets@^4.7.0`, `@azure/storage-blob@^12.17.0`, `@azure/data-tables@^13.2.0` in `functions/package.json`
- [X] **T004 [P]** Install utility dependencies: `qrcode@^1.5.3`, `uuid@^9.0.0` in `functions/package.json`
- [X] **T005 [P]** Install development dependencies: `jest@^29.7.0`, `@types/jest@^29.5.0`, `eslint@^8.54.0` in `functions/package.json`
- [X] **T006** Create Azure Functions configuration file `functions/host.json` with version 4.0, Node.js 18 runtime, Application Insights integration, and HTTP routing configuration
- [X] **T007** Create local settings template `functions/local.settings.json.template` with placeholders for: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `STORAGE_ACCOUNT_NAME`, `KEY_VAULT_URL`, `CONTAINER_REGISTRY_NAME`, `APPINSIGHTS_INSTRUMENTATIONKEY`
- [X] **T008 [P]** Configure ESLint in `functions/.eslintrc.json` with JavaScript standard style, Node.js environment, async/await support
- [X] **T009 [P]** Configure Jest in `functions/jest.config.js` with coverage thresholds (80% minimum), test environment "node", timeout 30000ms for integration tests

---

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### 🚨 TDD ENFORCEMENT CHECKPOINT (Constitutional Principle IV)

**BEFORE proceeding to Phase 3.3 (implementation), execute this validation:**

```bash
cd functions
npm test 2>&1 | tee test-output.log

# Expected output:
# - Contract tests (T010-T013): 4 tests, 4 failed ❌
# - Integration tests (T014-T019): 6 tests, 6 failed ❌
# - Total: 10 tests, 10 failed ❌
#
# If ANY test passes or tests don't execute:
#   STOP - Fix test setup before proceeding
#
# If all tests fail as expected:
#   PROCEED to Phase 3.3 (Models)
```

**Rationale**: Constitution Principle IV requires tests fail (Red phase) before implementation (Green phase). This checkpoint ensures constitutional compliance and prevents accidental implementation-before-tests.

### Contract Tests (API Endpoint Validation)

- [X] **T010 [P]** Contract test POST `/api/vpn/start` in `tests/contract/provision.test.js` - validates StartVPN API contract (startvpn-api.yaml): request schema, response schema (200, 202, 400, 401, 409, 429, 503), authentication header, timeout validation (<2 min), concurrent request handling
- [X] **T011 [P]** Contract test POST `/api/vpn/stop` in `tests/contract/deprovision.test.js` - validates StopVPN API contract (stopvpn-api.yaml): request schema with sessionId, response schema (200, 202, 400, 401, 404, 409), timeout validation (<1 min), state transition validation
- [X] **T012 [P]** Contract test GET `/api/vpn/status/{sessionId}` in `tests/contract/status.test.js` - validates StatusVPN API contract (statusvpn-api.yaml): path parameter validation, response schema (200, 400, 401, 404), query timeout (<5 sec), health status enum validation, metrics format
- [X] **T013 [P]** Contract test GET `/api/vpn/status` (list all sessions) in `tests/contract/status-list.test.js` - validates session list endpoint: query parameter filtering, pagination, response array schema, totalCount/activeCount fields

### Integration Tests (End-to-End Scenarios from quickstart.md)

- [X] **T014 [P]** Integration test "Happy Path VPN Lifecycle" in `tests/integration/vpn-lifecycle.test.js` - implements Scenario 1 from quickstart.md: provision VPN → download config → connect → verify traffic → status check → stop VPN, validates all performance requirements (provision <2min, connect <30sec, stop <1min, status <5sec)
- [X] **T015 [P]** Integration test "Concurrent Request Handling" in `tests/integration/concurrent-requests.test.js` - implements Scenario 2 from quickstart.md: start provision → immediately start second provision → verify first cancelled → verify second succeeds, validates FR-005a behavior
- [X] **T016 [P]** Integration test "Auto-Shutdown on Idle" in `tests/integration/idle-timeout.test.js` - implements Scenario 3 from quickstart.md: provision VPN with 10min timeout → connect → go idle → verify active at 5min → verify terminated at 11min, validates FR-003 behavior
- [X] **T017 [P]** Integration test "Quota and Retry Handling" in `tests/integration/quota-retry.test.js` - implements Scenario 4 from quickstart.md: provision 3 VPNs → attempt 4th → verify retry logic (3 attempts with exponential backoff: 1s, 2s, 4s) → verify 503 response, validates FR-004 behavior
- [X] **T018 [P]** Integration test "Maximum Concurrent Users" in `tests/integration/max-concurrent-users.test.js` - implements Scenario 5 from quickstart.md: provision 3 users → verify infrastructure state (activeContainerInstances=3, quotaLimitReached=true) → attempt 4th user → verify 429 rejection, validates FR-028 constraint
- [X] **T019 [P]** Integration test "Security and Authentication" in `tests/integration/auth-security.test.js` - implements Scenario 6 from quickstart.md: attempt provision without API key (expect 401) → invalid API key (expect 401) → verify private keys NOT in response → verify config download has 1-hour SAS token → verify audit events logged, validates FR-011, FR-015 requirements

---

## Phase 3.3: Core Implementation - Data Models

**ONLY after tests T010-T019 are failing**

- [X] **T020 [P]** VPNSession model in `functions/shared/models/vpn-session.js` - implements VPNSession entity from data-model.md with fields: sessionId (UUID), userId, status (enum: provisioning/active/idle/terminating/terminated), containerInstanceId, publicIpAddress, vpnPort (default 51820, validation: 1024-65535 range), createdAt, lastActivityAt, terminatedAt, idleTimeoutMinutes (default 10), provisionAttempts (max 3), errorMessage; includes validation rules and state transition logic
- [X] **T021 [P]** ClientConfiguration model in `functions/shared/models/client-config.js` - implements ClientConfiguration entity with fields: configId (UUID), sessionId, userId, clientPublicKey, clientPrivateKey, clientIpAddress (10.8.0.0/24 subnet), serverPublicKey, serverEndpoint, allowedIPs, dnsServers, configFileContent (WireGuard format), qrCodeData (base64 PNG), createdAt, expiresAt, downloadToken (SAS); includes IP allocation service with conflict detection (queries Table Storage for existing active sessions with same clientIpAddress before assignment, implements IP pool management for 10.8.0.2-10.8.0.254 range)
- [X] **T022 [P]** UserTenant model in `functions/shared/models/user-tenant.js` - implements UserTenant entity with fields: userId, email, displayName, authMethod (enum: apikey/azuread), apiKey (SHA-256 hash), azureAdObjectId, isActive, allowedSourceIPs (optional array of CIDR ranges for FR-014 IP restriction), quotaMaxConcurrentSessions (1-3), quotaMaxSessionsPerDay, totalSessionsCreated, lastSessionAt, createdAt, updatedAt; includes quota enforcement logic
- [X] **T023 [P]** OperationalEvent model in `functions/shared/models/operational-event.js` - implements OperationalEvent entity with fields: eventId (UUID), eventDate (YYYY-MM-DD for partitioning), timestamp, eventType (enum: vpn.provision.*, vpn.stop.*, vpn.connect.*, vpn.idle.*, auth.*, config.*), userId, sessionId, outcome (enum: success/failure/warning), message (max 2000 chars), metadata (JSON), ipAddress, durationMs; includes 5-day retention logic
- [X] **T024 [P]** InfrastructureState model in `functions/shared/models/infrastructure-state.js` - implements InfrastructureState singleton entity with fields: stateId (fixed: 'current'), activeContainerInstances (0-3), activeSessions (0-3), totalProvisioningAttempts, totalProvisioningFailures, totalBytesTransferred, currentCostEstimate, lastUpdated, quotaLimitReached; includes validation that activeSessions <= activeContainerInstances <= 3

---

## Phase 3.4: Core Implementation - Azure Service Wrappers

**Dependencies: T020-T024 (models) must be complete**

- [X] **T025** Azure Container Instances service in `functions/shared/services/aci-service.js` - wraps `@azure/arm-containerinstance` SDK, implements methods: `provisionVPNContainer(sessionId, wireguardConfig)` with retry logic (3 attempts, exponential backoff per FR-004/FR-026), `deprovisionContainer(containerInstanceId)` with <1min timeout (FR-002), `getContainerStatus(containerInstanceId)`, `getContainerLogs(containerInstanceId)`; uses Managed Identity authentication, references existing Bicep template `infra/modules/vpn-container.bicep` for container spec
- [X] **T026** Key Vault service in `functions/shared/services/keyvault-service.js` - wraps `@azure/keyvault-secrets` SDK, implements methods: `getSecret(secretName)`, `setSecret(secretName, secretValue)`, `deleteSecret(secretName)`, `generateWireGuardKeyPair()` (creates private/public key pair, stores private key, returns both); uses Managed Identity authentication, implements certificate-based auth for VPN (FR-012)
- [X] **T027** Azure Storage service in `functions/shared/services/storage-service.js` - wraps `@azure/storage-blob` and `@azure/data-tables` SDKs, implements Blob methods: `uploadClientConfig(sessionId, configContent)` to `client-configs` container, `generateSASToken(blobPath, expiryHours=1)` for secure config download (FR-010), `deleteClientConfig(sessionId)`; implements Table methods: `createEntity(tableName, entity)`, `updateEntity(tableName, entity)`, `queryEntities(tableName, filter)`, `deleteEntity(tableName, partitionKey, rowKey)`; uses Managed Identity, references existing `infra/modules/storage.bicep`
- [X] **T028** Application Insights logging service in `functions/shared/services/logging-service.js` - wraps Application Insights SDK, implements methods: `logEvent(eventType, properties, metrics)`, `logError(error, context)`, `logMetric(metricName, value)`, `trackDependency(dependencyName, duration, success)`; integrates with OperationalEvent model (T023) to create audit trail entries, enforces 5-day retention (FR-031), logs all auth events (FR-015)

---

## Phase 3.5: Core Implementation - Shared Utilities

**Can run in parallel with T025-T028**

- [X] **T029 [P]** Authentication middleware in `functions/shared/utils/auth.js` - implements API key validation (reads from Key Vault), extracts userId from API key, enforces authentication on all endpoints (FR-011), validates source IP against UserTenant.allowedSourceIPs if configured (FR-014), logs auth success/failure events, returns 401 for invalid/missing keys or unauthorized IP, returns 403 for valid key but IP restriction violation; supports future Azure AD integration per research.md decision 5
- [X] **T030 [P]** WireGuard configuration generator in `functions/shared/utils/wireguard-config.js` - generates WireGuard `.conf` file content using template format from `infra/container/scripts/generate-config.sh`, implements methods: `generateServerConfig(serverKeys, serverAddress, port)`, `generateClientConfig(clientKeys, clientIP, serverEndpoint, allowedIPs, dnsServers)`, validates WireGuard key format; integrates with existing container script logic
- [X] **T031 [P]** QR code generator utility in `functions/shared/utils/qr-code.js` - uses `qrcode` package to generate base64-encoded PNG QR codes from WireGuard config content (FR-010), implements method: `generateQRCode(configContent)` returning base64 string, optimizes size for mobile scanning
- [X] **T032 [P]** Validation utilities in `functions/shared/utils/validation.js` - implements input validation functions: `validateUUID(value)`, `validateIPv4(value)`, `validateIdleTimeout(minutes, min=1, max=1440)`, `validateSessionStatus(status, allowedStatuses)`, `validateQuota(current, max)`; returns detailed error messages for contract test validation (T010-T013)
- [X] **T033 [P]** Retry logic utility in `functions/shared/utils/retry.js` - implements exponential backoff retry pattern (FR-004, FR-026) with configurable max attempts (default 3), delays (1s, 2s, 4s), and error filtering; method: `retryWithBackoff(asyncFunction, maxAttempts=3, baseDelayMs=1000)`; logs each retry attempt to Application Insights

---

## Phase 3.6: Core Implementation - Azure Functions Endpoints

**Dependencies: T025-T028 (services), T029-T033 (utilities) must be complete**

- [X] **T034** POST `/api/vpn/start` Function in `functions/provision/index.js` - implements StartVPN endpoint per `contracts/startvpn-api.yaml`, flow: authenticate user (T029) → validate request (T032) → check UserTenant quota (T022) → check InfrastructureState capacity (T024) → handle concurrent request conflict per FR-005a (cancel existing provisioning session) → create VPNSession (T020) with status='provisioning' → log operational event (T023) → provision ACI using aci-service (T025) with retry (T033) → generate WireGuard keys via keyvault-service (T026) → create ClientConfiguration (T021) → generate config file (T030) → generate QR code (T031) → upload config to Storage (T027) → generate SAS token (T027) → update VPNSession status='active' → update InfrastructureState counters (T024) → return 200 response with all required fields; handles errors: 400 (invalid input), 401 (auth), 409 (conflict), 429 (quota), 503 (provision failure after retries); enforces <2min total time (FR-001)
- [X] **T035** POST `/api/vpn/stop` Function in `functions/deprovision/index.js` - implements StopVPN endpoint per `contracts/stopvpn-api.yaml`, flow: authenticate user (T029) → validate sessionId (T032) → load VPNSession (T020) → verify user owns session → validate session in stoppable state (active/idle) → update VPNSession status='terminating' → log operational event (T023) → deprovision ACI via aci-service (T025) → update VPNSession status='terminated', set terminatedAt → mark ClientConfiguration as expired (T021) → update InfrastructureState decrement counters (T024) → log success event (T023) with duration/bytes metrics → return 200 response; handles errors: 400 (invalid sessionId), 401 (auth), 404 (session not found), 409 (invalid state); enforces <1min completion (FR-002)
- [X] **T036** GET `/api/vpn/status/{sessionId}` Function in `functions/status/index.js` - implements StatusVPN single-session endpoint per `contracts/statusvpn-api.yaml`, flow: authenticate user (T029) → validate sessionId (T032) → load VPNSession (T020) → verify user owns session → get container status/health from aci-service (T025) if status='active' → query metrics (connected clients, bytes transferred, uptime) → calculate idleTimeoutAt based on lastActivityAt + idleTimeoutMinutes → return 200 response with complete session status including health, metrics, timestamps; handles errors: 400 (invalid UUID), 401 (auth), 404 (not found); enforces <5sec response time (FR-024)
- [X] **T037** GET `/api/vpn/status` Function in `functions/status/list.js` - implements StatusVPN list endpoint per `contracts/statusvpn-api.yaml`, flow: authenticate user (T029) → parse query parameter `status` filter (T032) → query VPNSession table via storage-service (T027) filtered by userId and optional status → return array of sessions with totalCount and activeCount; enforces <5sec response time (FR-024)

---

## Phase 3.7: Integration - Background Jobs & Automation

**Dependencies: T034-T037 (endpoints) must be complete**

- [ ] **T038** Idle timeout monitor timer function in `functions/idle-monitor/index.js` - Azure Function timer trigger (runs every 1 minute per FR-003), queries VPNSession table for status='active' with `lastActivityAt + idleTimeoutMinutes < now`, updates each session status='idle', then triggers auto-shutdown (calls T039), logs operational events (type: `vpn.idle.detected`), updates metrics in Application Insights
- [ ] **T039** Auto-shutdown function in `functions/auto-shutdown/index.js` - called by idle-monitor (T038), flow: load idle VPNSession → update status='terminating' → deprovision ACI via aci-service (T025) with retry logic (if deprovision fails, retry up to 2 times with 5-second delay, then log to dead-letter queue for manual intervention) → update status='terminated' → decrement InfrastructureState counters (T024) → log operational event (type: `vpn.auto.shutdown`) → cleanup ClientConfiguration; enforces <1min termination (FR-002), handles edge case of shutdown failures
- [ ] **T040** Activity heartbeat updater in `functions/shared/utils/activity-tracker.js` - utility called by status endpoint (T036) when querying active session, updates VPNSession.lastActivityAt to current timestamp to prevent premature idle timeout, implements debouncing using in-memory Map cache with timestamp check (max 1 update per 30 seconds per sessionId) to reduce Table Storage writes

---

## Phase 3.8: Integration - Error Handling & Monitoring

**Can run in parallel with Phase 3.7**

- [ ] **T041 [P]** Global error handler middleware in `functions/shared/middleware/error-handler.js` - wraps all Function endpoints, catches unhandled exceptions, logs to Application Insights via logging-service (T028), returns standardized error responses matching contract schemas (Error component from OpenAPI specs), includes correlation IDs for tracking, prevents sensitive data (keys, secrets) from appearing in error messages
- [ ] **T042 [P]** Request/response logging middleware in `functions/shared/middleware/request-logger.js` - logs all incoming requests (method, path, userId, timestamp, IP address) and responses (status code, duration) to Application Insights, creates OperationalEvent entries for audit trail (FR-015), sanitizes sensitive headers (X-API-Key) from logs
- [ ] **T043 [P]** Performance monitoring utility in `functions/shared/utils/performance.js` - tracks and logs performance metrics to Application Insights: provision time (must be <2min per FR-001), deprovision time (<1min per FR-002), status query time (<5sec per FR-024), VPN connection establishment time (<30sec per FR-025); logs threshold violations as custom events, alerts configured in existing `infra/modules/monitoring.bicep` (no new task needed - infrastructure already defines metric alerts for FR-021)

---

## Phase 3.9: Integration - Configuration & Deployment

**Dependencies: All Phase 3.3-3.8 tasks must be complete**

- [ ] **T044** Environment configuration loader in `functions/shared/config/environment.js` - loads configuration from environment variables and Key Vault, implements methods: `getConfig()` returning object with all settings (storage account name, Key Vault URL, ACR name, subscription ID, resource group, VNet/subnet IDs from Bicep outputs), `validateConfig()` ensuring all required vars present, caches config for function instance lifetime; references existing `infra/main.bicep` outputs
- [ ] **T045** Update existing `infra/modules/function-app.bicep` to add app settings - add environment variables required by T044: `STORAGE_ACCOUNT_NAME`, `KEY_VAULT_URL`, `CONTAINER_REGISTRY_NAME`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP_NAME`, `VPN_SUBNET_ID`, `ACR_LOGIN_SERVER` (from ACR module output), configure Managed Identity with RBAC roles: Key Vault Secrets User, Storage Blob Data Contributor, Storage Table Data Contributor, Contributor on resource group (for ACI provisioning); set Function timeout to 180 seconds (3 minutes) to accommodate FR-001 2-minute provision requirement with buffer, configure Application Insights alert when provision operations exceed 120 seconds
- [ ] **T046** Container build integration script in `infra/container/push-to-acr.ps1` - PowerShell script to build WireGuard container using existing `infra/container/Dockerfile` and push to ACR, references existing `infra/container/build.ps1`, adds ACR login and push commands, tags image as `vpn-wireguard:latest` and `vpn-wireguard:{version}`, verifies image uploaded successfully; integrates with existing ACR from `infra/modules/container-registry.bicep`
- [ ] **T047** Function deployment script in `functions/deploy.ps1` - PowerShell script to deploy Azure Functions code: install Node.js dependencies (`npm ci`), run tests (`npm test`), bundle functions, deploy to Function App using `func azure functionapp publish {functionAppName}`, verify deployment success; references function app created by `infra/modules/function-app.bicep`

---

## Phase 3.10: Polish - Unit Tests

**Can run in parallel with Phase 3.9**

- [ ] **T048 [P]** Unit tests for ACI service in `tests/unit/aci-service.test.js` - tests `aci-service.js` (T025) methods in isolation using mocked Azure SDK, validates retry logic (3 attempts, exponential backoff), timeout enforcement, error handling, Managed Identity authentication; achieves >80% code coverage
- [ ] **T049 [P]** Unit tests for Storage service in `tests/unit/storage-service.test.js` - tests `storage-service.js` (T027) methods with mocked SDK, validates SAS token generation (1-hour expiry), blob upload/delete, table CRUD operations, partition key logic (eventDate for OperationalEvent), Managed Identity auth; >80% coverage
- [ ] **T050 [P]** Unit tests for validation utilities in `tests/unit/validation.test.js` - tests `validation.js` (T032) functions with valid/invalid inputs, validates UUID format, IPv4 format, idle timeout bounds (1-1440), session status enum values, quota enforcement logic; 100% coverage of validation rules
- [ ] **T051 [P]** Unit tests for retry utility in `tests/unit/retry.test.js` - tests `retry.js` (T033) exponential backoff implementation, validates delay progression (1s, 2s, 4s), max attempts enforcement (3), error filtering, logging on each attempt; >90% coverage

---

## Phase 3.11: Polish - Documentation & Validation

**Dependencies: All implementation and tests complete**

- [ ] **T052** Create Functions API documentation in `functions/README.md` - documents all endpoints (StartVPN, StopVPN, StatusVPN), request/response examples from contract tests (T010-T013), authentication setup, local development instructions (`local.settings.json` configuration), deployment instructions (reference T047), troubleshooting guide; includes quickstart.md scenarios as usage examples

---

## Dependencies

### Critical Path (must execute sequentially):
1. **Setup** (T001-T009) → **Tests** (T010-T019) → **Models** (T020-T024) → **Services** (T025-T028) → **Endpoints** (T034-T037) → **Background Jobs** (T038-T040) → **Deployment** (T044-T047)

### Parallel Execution Groups:

**Group 1 - Setup** (after T002):
- T003, T004, T005 (dependencies)
- T006, T007 (configuration)
- T008, T009 (tooling)

**Group 2 - Contract Tests** (after T009):
- T010, T011, T012, T013 (all independent files)

**Group 3 - Integration Tests** (after T009):
- T014, T015, T016, T017, T018, T019 (all independent scenarios)

**Group 4 - Data Models** (after T010-T019 failing):
- T020, T021, T022, T023, T024 (all independent model files)

**Group 5 - Utilities** (after T020-T024):
- T029, T030, T031, T032, T033 (all independent utility files)

**Group 6 - Error Handling** (after T034-T037):
- T041, T042, T043 (all independent middleware files)

**Group 7 - Unit Tests** (after T025-T033):
- T048, T049, T050, T051 (all independent test files)

### Blocking Dependencies:
- T025 blocks T034, T035, T036 (endpoints need ACI service)
- T026 blocks T034 (StartVPN needs Key Vault for key generation)
- T027 blocks T034, T035, T036 (endpoints need Storage service)
- T028 blocks all endpoints (logging required)
- T034-T037 block T038, T039 (background jobs use endpoint logic)
- T044 blocks T045, T047 (config needed for deployment)

---

## Parallel Execution Examples

### Example 1: Launch all contract tests together (after T009)
```bash
# T010-T013 in parallel
Task: "Write contract test POST /api/vpn/start in tests/contract/provision.test.js"
Task: "Write contract test POST /api/vpn/stop in tests/contract/deprovision.test.js"
Task: "Write contract test GET /api/vpn/status/{sessionId} in tests/contract/status.test.js"
Task: "Write contract test GET /api/vpn/status in tests/contract/status-list.test.js"
```

### Example 2: Launch all integration tests together (after T009)
```bash
# T014-T019 in parallel
Task: "Write integration test Happy Path VPN Lifecycle in tests/integration/vpn-lifecycle.test.js"
Task: "Write integration test Concurrent Request Handling in tests/integration/concurrent-requests.test.js"
Task: "Write integration test Auto-Shutdown on Idle in tests/integration/idle-timeout.test.js"
Task: "Write integration test Quota and Retry Handling in tests/integration/quota-retry.test.js"
Task: "Write integration test Maximum Concurrent Users in tests/integration/max-concurrent-users.test.js"
Task: "Write integration test Security and Authentication in tests/integration/auth-security.test.js"
```

### Example 3: Launch all data models together (after tests failing)
```bash
# T020-T024 in parallel
Task: "Implement VPNSession model in functions/shared/models/vpn-session.js"
Task: "Implement ClientConfiguration model in functions/shared/models/client-config.js"
Task: "Implement UserTenant model in functions/shared/models/user-tenant.js"
Task: "Implement OperationalEvent model in functions/shared/models/operational-event.js"
Task: "Implement InfrastructureState model in functions/shared/models/infrastructure-state.js"
```

### Example 4: Launch all unit tests together (after services complete)
```bash
# T048-T051 in parallel
Task: "Write unit tests for ACI service in tests/unit/aci-service.test.js"
Task: "Write unit tests for Storage service in tests/unit/storage-service.test.js"
Task: "Write unit tests for validation utilities in tests/unit/validation.test.js"
Task: "Write unit tests for retry utility in tests/unit/retry.test.js"
```

---

## Notes

### TDD Approach (Constitutional Principle IV)
- **Phase 3.2 (T010-T019)** must complete BEFORE **Phase 3.3-3.6** implementation
- All tests MUST fail initially (no implementation exists)
- Implementation tasks make tests pass one by one
- Run `npm test` after each implementation task to verify progress

### Existing Infrastructure (from infra/)
- **DO NOT** modify Bicep templates except T045 (Function App settings)
- **REUSE** container scripts: `entrypoint.sh`, `generate-config.sh`, `health-check.sh`
- **REFERENCE** existing modules: `vpn-container.bicep`, `storage.bicep`, `key-vault.bicep`, `function-app.bicep`
- Container build (T046) uses existing `Dockerfile` and `build.ps1`

### Performance Requirements (enforce in tests)
- FR-001: Provisioning <2 minutes (validate in T010, T014)
- FR-002: Deprovisioning <1 minute (validate in T011, T014)
- FR-024: Status queries <5 seconds (validate in T012, T036, T037)
- FR-025: VPN connection <30 seconds (validate in T014)

### Security Requirements (Constitutional Principle II)
- Managed Identity for all Azure service authentication (T025-T027)
- API keys stored in Key Vault (T026, T029)
- Private keys never in HTTP responses (validate in T019)
- SAS tokens with 1-hour expiry (T027, T034)
- Audit trail for all operations (T023, T028, T042)

### Cost Optimization (Constitutional Principle V)
- On-demand ACI provisioning/deprovisioning (T034, T035)
- Idle timeout enforcement (T038, T039)
- Max 3 concurrent users (T018, T024, T034)
- 5-day log retention (T023, T028)

### Avoid Common Mistakes
- **DO NOT** create multiple tasks that modify the same file (breaks [P] parallel execution)
- **DO NOT** skip contract/integration tests (violates TDD principle)
- **DO NOT** implement before tests fail (constitutional violation)
- **DO NOT** hardcode secrets/credentials (use Key Vault via T026)
- **DO NOT** create new infrastructure Bicep files (already complete in infra/)

---

## Validation Checklist

*GATE: Verify before execution*

- [x] All contracts have corresponding tests (T010-T013 cover 3 API contracts)
- [x] All entities have model tasks (T020-T024 cover 5 entities from data-model.md)
- [x] All tests come before implementation (Phase 3.2 before 3.3-3.6)
- [x] Parallel tasks truly independent (each [P] task uses different file)
- [x] Each task specifies exact file path (all tasks include full paths)
- [x] No task modifies same file as another [P] task (validated)
- [x] Integration tests cover all 6 quickstart.md scenarios (T014-T019)
- [x] Existing infrastructure properly referenced (infra/ modules reused)
- [x] Performance requirements testable (timings in T010-T012, T014)
- [x] Security requirements enforced (auth T029, audit T023, no secrets in responses T019)

**STATUS**: ✅ READY FOR EXECUTION - All validation checks passed, 52 tasks generated
