# Implementation Plan: On-Demand VPN Provisioning System

**Branch**: `001-use-existing-documents` | **Date**: 2025-10-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/home/greg/dev/az-demand-vpn/specs/001-use-existing-documents/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
The On-Demand VPN Provisioning System enables secure, cost-effective remote access by dynamically provisioning WireGuard VPN infrastructure on Azure Container Instances. The system automatically creates VPN endpoints when users request access and tears them down after configurable idle periods (default 10 minutes), supporting up to 3 concurrent users. Built on Azure Functions for orchestration, containerized WireGuard for VPN services, and Azure managed services (Key Vault, Storage, Container Registry) for secrets and configuration management, the solution emphasizes infrastructure-as-code, security-first design, and test-driven development.

## Technical Context
**Language/Version**: JavaScript/Node.js 18+ (Azure Functions), PowerShell 7+ (Infrastructure automation), Alpine Linux 3.19 (Container base)
**Primary Dependencies**: Azure SDK for JavaScript (@azure/arm-containerinstance, @azure/identity, @azure/keyvault-secrets, @azure/storage-blob), WireGuard tools, iptables
**Storage**: Azure Blob Storage (VPN configs, keys, logs), Azure Key Vault (certificates, secrets)
**Testing**: Jest (contract/integration tests for Functions), shell script tests (container validation), Bicep what-if (infrastructure validation)
**Target Platform**: Azure Container Instances (Linux containers), Azure Functions Premium Plan (Node.js)
**Project Type**: Serverless backend with containerized services
**Performance Goals**: VPN provisioning <2 minutes, VPN deprovisioning <1 minute, status queries <5 seconds, VPN connection establishment <30 seconds
**Constraints**: Max 3 concurrent VPN users, 10-minute idle timeout default, 5-day log retention, 99.5% availability during business hours
**Scale/Scope**: Small-scale deployment (3-5 concurrent sessions), infrastructure automation focus, security-critical requirements

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I: Infrastructure as Code
✅ **PASS** - Existing Bicep templates in `/infra` define all Azure resources (VNet, ACR, Storage, Key Vault, Function App, ACI, monitoring). Parameter files for dev/prod environments. PowerShell deployment scripts with what-if validation.

### Principle II: Security-First Architecture
✅ **PASS** - Managed identities planned for service authentication. Key Vault for secrets/certificates. Private endpoints for Storage/Key Vault. NSGs restrict traffic. Certificate-based VPN authentication. Container image security scanning required.

### Principle III: Container-Based Design
✅ **PASS** - WireGuard VPN runs in Alpine Linux containers (existing Dockerfile). Images stored in ACR. Health check endpoints implemented. Container logs to stdout/stderr. Startup time <2 minutes meets requirement.

### Principle IV: Test-Driven Development
✅ **PASS (POST-DESIGN)** - Contract tests defined in quickstart.md with 6 comprehensive scenarios. OpenAPI schemas created for all endpoints (StartVPN, StopVPN, StatusVPN) in contracts/ directory. Test structure planned in functions/tests/ with contract, integration, and unit test directories. Tests follow TDD approach (write tests first, then implementation).

### Principle V: Cost Optimization
✅ **PASS** - On-demand ACI provisioning/deprovisioning. 10-minute idle timeout. Max 3 concurrent users enforced. Storage lifecycle policies for log cleanup. Cost alerts configured in monitoring module.

**Initial Gate Status**: CONDITIONAL PASS - Proceed to Phase 0 with requirement to create comprehensive tests in Phase 1.

**Post-Design Gate Status**: ✅ PASS - All constitutional principles satisfied. Contract tests designed, data model supports TDD workflow, infrastructure aligns with all principles.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
infra/
├── main.bicep                     # Main infrastructure template
├── parameters.dev.json            # Development parameters
├── parameters.prod.json           # Production parameters
├── deploy.ps1                     # Deployment automation
├── modules/
│   ├── network.bicep              # Virtual network & NSGs
│   ├── container-registry.bicep   # Azure Container Registry
│   ├── storage.bicep              # Blob storage with private endpoints
│   ├── key-vault.bicep            # Key Vault with RBAC
│   ├── function-app.bicep         # Azure Functions orchestration
│   ├── vpn-container.bicep        # ACI VPN template
│   ├── log-analytics.bicep        # Log Analytics workspace
│   ├── application-insights.bicep # Application Insights
│   └── monitoring.bicep           # Alerts and monitoring
└── container/
    ├── Dockerfile                 # Alpine + WireGuard image
    ├── build.ps1                  # Container build script
    └── scripts/
        ├── entrypoint.sh          # Container startup
        ├── generate-config.sh     # WireGuard config generation
        └── health-check.sh        # Health monitoring

functions/                         # To be created
├── provision/                     # VPN provisioning endpoint
├── deprovision/                   # VPN deprovisioning endpoint
├── status/                        # Status query endpoint
├── config/                        # Client config generation
├── shared/                        # Shared utilities
│   ├── models/                    # Data models
│   ├── services/                  # Azure SDK wrappers
│   └── utils/                     # Helper functions
├── package.json                   # Node.js dependencies
├── host.json                      # Function App configuration
└── local.settings.json.template   # Local development settings

tests/
├── contract/                      # API contract tests (Jest)
│   ├── provision.test.js
│   ├── deprovision.test.js
│   ├── status.test.js
│   └── config.test.js
├── integration/                   # End-to-end tests
│   ├── vpn-lifecycle.test.js
│   └── container-deployment.test.js
└── unit/                          # Unit tests for services
    ├── aci-service.test.js
    ├── keyvault-service.test.js
    └── storage-service.test.js
```

**Structure Decision**: Serverless backend architecture with separate infrastructure and application code. Infrastructure defined in Bicep (existing), Azure Functions for API orchestration (to be created), containerized VPN service (existing Dockerfile), and comprehensive test suite (to be created). This aligns with Azure best practices for serverless applications and infrastructure-as-code principles.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
  - research.md created with all technology decisions
  - All NEEDS CLARIFICATION items resolved
  - Best practices documented for Azure Functions, WireGuard, ACI, Key Vault, Storage
- [x] Phase 1: Design complete (/plan command)
  - data-model.md created with 5 entities (VPNSession, ClientConfiguration, UserTenant, OperationalEvent, InfrastructureState)
  - contracts/ directory created with OpenAPI schemas for StartVPN, StopVPN, StatusVPN endpoints
  - quickstart.md created with 6 integration test scenarios
  - CLAUDE.md updated with technology stack and project structure
- [x] Phase 2: Task planning approach described (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command) - **NEXT STEP**
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: CONDITIONAL PASS
  - Infrastructure as Code: PASS (existing Bicep templates)
  - Security-First: PASS (managed identities, Key Vault, private endpoints)
  - Container-Based: PASS (Alpine + WireGuard, ACR)
  - TDD: NEEDS ATTENTION (deferred to Phase 1)
  - Cost Optimization: PASS (on-demand architecture)
- [x] Post-Design Constitution Check: PASS
  - TDD: PASS (contract tests designed in quickstart.md, OpenAPI schemas created)
  - All principles satisfied
- [x] All NEEDS CLARIFICATION resolved
  - Technical Context fully specified (no unknowns)
  - Research decisions documented
- [x] Complexity deviations documented
  - No violations requiring justification
  - Architecture aligns with constitutional principles

**Artifacts Generated**:
- ✅ `/specs/001-use-existing-documents/research.md` - Technology research and decisions
- ✅ `/specs/001-use-existing-documents/data-model.md` - Entity definitions and relationships
- ✅ `/specs/001-use-existing-documents/quickstart.md` - Integration test scenarios
- ✅ `/specs/001-use-existing-documents/contracts/startvpn-api.yaml` - StartVPN OpenAPI schema
- ✅ `/specs/001-use-existing-documents/contracts/stopvpn-api.yaml` - StopVPN OpenAPI schema
- ✅ `/specs/001-use-existing-documents/contracts/statusvpn-api.yaml` - StatusVPN OpenAPI schema
- ✅ `/CLAUDE.md` - Agent context updated with current feature technologies

---
*Based on Constitution v1.0.0 - See `.specify/memory/constitution.md`*
