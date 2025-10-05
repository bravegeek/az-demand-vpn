# Research: On-Demand VPN Provisioning System

**Feature**: 001-use-existing-documents
**Date**: 2025-10-05
**Status**: Complete

## Technical Decisions

### 1. Azure Functions Runtime and Language

**Decision**: Node.js 18+ with JavaScript (not TypeScript)

**Rationale**:
- Azure Functions has excellent Node.js support with mature SDKs
- JavaScript simplifies development for serverless functions (no build step)
- Azure SDK for JavaScript provides comprehensive APIs for Container Instances, Key Vault, Storage
- Faster development iteration without TypeScript compilation
- Sufficient for MVP scale (3 concurrent users)

**Alternatives Considered**:
- **TypeScript**: Provides type safety but adds build complexity; deferred for MVP
- **Python**: Good Azure support but team has stronger JavaScript experience
- **C#/.NET**: Most performant but higher complexity for serverless orchestration

### 2. VPN Protocol and Container Base

**Decision**: WireGuard on Alpine Linux

**Rationale**:
- WireGuard is modern, lightweight, high-performance VPN protocol
- Alpine Linux provides minimal attack surface (<10MB base image)
- Existing Dockerfile already implemented in `/infra/container`
- Faster startup times compared to OpenVPN (critical for <2min provisioning)
- Certificate-based authentication natively supported

**Alternatives Considered**:
- **OpenVPN**: More mature but slower, larger footprint, complex configuration
- **IPSec/IKEv2**: Enterprise-grade but heavyweight for container deployment
- **Ubuntu base**: More familiar but 10x larger image size

### 3. State Management and Storage

**Decision**: Azure Blob Storage for configs/logs, Table Storage for operational state

**Rationale**:
- Blob Storage ideal for unstructured data (VPN configs, client certificates, logs)
- Table Storage provides fast key-value access for session state with low cost
- Aligns with Constitution Principle V (Cost Optimization)
- 5-day retention easily implemented with Blob lifecycle policies
- No need for relational database (entities are simple, no complex queries)

**Alternatives Considered**:
- **Cosmos DB**: Overkill for MVP scale, 10x higher cost
- **Redis Cache**: Fast but adds infrastructure complexity
- **SQL Database**: Unnecessary for simple key-value and blob storage

### 4. Testing Strategy

**Decision**: Jest for Azure Functions (unit/contract), Pester for Bicep, Container integration tests

**Rationale**:
- Jest is standard for Node.js testing with excellent async support
- Pester is PowerShell standard for infrastructure testing
- Container integration tests validate end-to-end VPN functionality
- Aligns with Constitution Principle IV (TDD)
- Contract tests for all HTTP-triggered functions (StartVPN, StopVPN, StatusVPN)

**Alternatives Considered**:
- **Mocha/Chai**: Viable but Jest has better built-in mocking
- **Manual testing only**: Violates TDD principle, unacceptable

### 5. Authentication and Authorization

**Decision**: Azure Managed Identities for service-to-service, API Keys for function invocation (MVP), Certificate-based for VPN

**Rationale**:
- Managed Identities eliminate credential management (Constitution Principle II)
- API Keys sufficient for MVP function auth (upgrade to Azure AD in future)
- WireGuard certificate-based auth meets FR-012 requirement
- Key Vault stores all secrets with RBAC (Constitution Principle II)

**Alternatives Considered**:
- **Azure AD B2C**: Future enhancement, too complex for MVP
- **Username/Password VPN**: Explicitly rejected by FR-012 (certificate required)

### 6. Container Orchestration

**Decision**: Azure Container Instances (ACI) with on-demand provisioning

**Rationale**:
- ACI provides serverless containers without K8s complexity
- Perfect for on-demand use case (create/destroy on request)
- Meets <2min startup requirement (FR-001)
- Cost-optimized: only pay when container runs (Constitution Principle V)
- Infrastructure already defined in Bicep

**Alternatives Considered**:
- **Azure Kubernetes Service (AKS)**: Overkill for single container, always-on cost
- **Azure Container Apps**: Good but adds abstraction layer unnecessarily
- **VM-based**: Slower startup, higher cost, more management overhead

### 7. Monitoring and Observability

**Decision**: Application Insights + Azure Monitor

**Rationale**:
- Native integration with Azure Functions
- Automatic distributed tracing across functions
- Custom metrics for VPN provisioning times (FR-020, FR-024)
- Alerting for failures (FR-021)
- Log retention with 5-day policy (FR-031)

**Alternatives Considered**:
- **Custom logging to Blob**: Insufficient for real-time monitoring
- **Third-party APM**: Adds cost and external dependency

### 8. Retry and Resilience Patterns

**Decision**: Exponential backoff with 3 retries for provisioning (FR-004), Circuit breaker for Azure service calls

**Rationale**:
- Exponential backoff handles transient quota issues (clarified requirement)
- Circuit breaker prevents cascading failures
- Azure SDK supports retry policies out-of-box
- Meets FR-026 (retry logic for transient failures)

**Alternatives Considered**:
- **Immediate failure**: Poor user experience, doesn't handle transient issues
- **Infinite retries**: Could cause resource exhaustion

### 9. Configuration Management

**Decision**: Environment variables for Azure Functions, Blob Storage for VPN configs, Key Vault for secrets

**Rationale**:
- Environment variables standard for serverless configuration
- Dynamic VPN configuration stored in Blob (versioned, retrievable)
- Secrets rotation supported by Key Vault
- Meets FR-032 (configuration versioning)

**Alternatives Considered**:
- **Hardcoded configs**: Violates security principles
- **App Configuration service**: Overkill for MVP

### 10. Client Configuration Delivery

**Decision**: HTTPS download endpoint + QR code generation (FR-010)

**Rationale**:
- Secure download via Azure Functions with temporary SAS tokens
- QR code simplifies mobile client setup
- Standard WireGuard client compatibility (FR-009)
- No custom client app needed

**Alternatives Considered**:
- **Email delivery**: Security risk, secrets in email
- **Custom mobile app**: Out of scope for MVP

## Dependencies and Integrations

### NPM Packages (Azure Functions)
- `@azure/arm-containerinstance` - ACI management
- `@azure/identity` - Managed identity authentication
- `@azure/keyvault-secrets` - Secret management
- `@azure/storage-blob` - Configuration/log storage
- `@azure/data-tables` - State management
- `qrcode` - QR code generation
- `wireguard-tools` (if needed for key generation in functions)

### PowerShell Modules (Infrastructure)
- `Az.ContainerInstance`
- `Az.KeyVault`
- `Az.Storage`

### Container Dependencies
- WireGuard kernel module
- iptables
- openssl (certificate operations)

## Performance Considerations

### Provisioning Time Budget (<2min FR-001)
- Container image pull: ~30sec (cached after first pull)
- ACI startup: ~45sec
- WireGuard configuration: ~10sec
- Network setup: ~15sec
- **Buffer**: ~20sec
- **Total**: ~120sec (within 2min limit)

### Concurrent User Handling (Max 3)
- Each user gets independent ACI instance
- Table Storage tracks active sessions
- New request checks active count before provisioning
- Fourth+ requests queued or rejected (edge case from clarifications)

## Security Considerations

### Certificate Management
- Generate WireGuard key pairs in Key Vault
- Client certificates delivered via time-limited SAS tokens
- Certificate expiration monitoring (edge case noted in spec)
- Rotation procedure for server certificates

### Network Security
- NSG rules: UDP 51820 only
- Private endpoints for Storage/Key Vault
- No public Storage account access
- Managed identity eliminates credential exposure

## Open Questions Resolved

All technical unknowns from Technical Context have been resolved:
- ✅ Language: JavaScript/Node.js 18+
- ✅ Dependencies: Azure SDKs identified
- ✅ Storage: Blob + Table Storage
- ✅ Testing: Jest, Pester, container tests
- ✅ Platform: ACI + Azure Functions
- ✅ Performance: <2min budget defined
- ✅ Scale: 3 concurrent users

**Phase 0 Complete** - No NEEDS CLARIFICATION items remain
