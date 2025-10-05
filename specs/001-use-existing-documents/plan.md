
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
On-demand VPN provisioning system that creates and destroys WireGuard VPN containers on Azure Container Instances based on user requests. Implements cost-optimized serverless VPN infrastructure with automatic idle timeout (10 minutes default), certificate-based authentication, and support for up to 3 concurrent users. System uses Azure Functions for orchestration, Azure Container Registry for WireGuard images, Key Vault for secrets, and Storage for configurations with 5-day log retention.

## Technical Context
**Language/Version**: JavaScript/Node.js 18+ (Azure Functions), PowerShell 7+ (Infrastructure automation), Alpine Linux (Container base)
**Primary Dependencies**: Azure SDK for JavaScript (@azure/arm-containerinstance, @azure/identity, @azure/keyvault-secrets, @azure/storage-blob), WireGuard tools, iptables
**Storage**: Azure Blob Storage (VPN configs, logs, client files), Azure Table Storage (operational events, session state)
**Testing**: Jest (Azure Functions unit tests), Pester (PowerShell/Bicep validation), Container integration tests
**Target Platform**: Azure Container Instances (Linux containers), Azure Functions (Consumption/Premium plan), East US 2 region
**Project Type**: Serverless cloud functions + infrastructure (Azure Functions orchestrating containerized VPN services)
**Performance Goals**: <2min VPN provisioning, <1min deprovisioning, <30sec VPN connection establishment, <5sec status queries
**Constraints**: Max 3 concurrent users, 10min idle timeout default, 5-day log retention, 99.5% availability during business hours, certificate-based auth required
**Scale/Scope**: MVP scale (3 users), ~10-15 Azure Functions, 1 containerized VPN service, 5 key entities, Bicep IaC already complete

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Infrastructure as Code (IaC)
✅ **PASS** - Bicep templates already complete in `/infra`, all Azure resources defined as code, deployment automated via PowerShell scripts

### II. Security-First Architecture
✅ **PASS** - Managed identities for service auth, Key Vault for secrets, certificate-based VPN auth (FR-012), NSGs for network security, private endpoints planned

### III. Container-Based Design
✅ **PASS** - Alpine Linux Dockerfile exists, WireGuard container in ACR, startup time <2min (FR-001), health checks required, dynamic config via env vars

### IV. Test-Driven Development (TDD)
✅ **PASS** - Contract tests required for all Azure Functions, integration tests for infrastructure, Jest/Pester test frameworks identified, TDD workflow enforced

### V. Cost Optimization Through On-Demand Architecture
✅ **PASS** - On-demand provisioning (FR-001), automatic shutdown after 10min idle (FR-003), lifecycle policies for storage cleanup, container destruction when unused

### Azure Best Practices
✅ **PASS** - Retry logic for transient failures (FR-026), health checks (FR-019), asynchronous operations, monitoring/alerting (FR-021), resource tagging required

**Initial Gate Result**: ✅ ALL CHECKS PASS - No constitutional violations, proceed to Phase 0

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
functions/                    # Azure Functions (orchestration)
├── StartVPN/
│   ├── index.js
│   ├── function.json
│   └── __tests__/
├── StopVPN/
│   ├── index.js
│   ├── function.json
│   └── __tests__/
├── StatusVPN/
│   ├── index.js
│   ├── function.json
│   └── __tests__/
├── AutoShutdown/             # Timer-triggered
│   ├── index.js
│   ├── function.json
│   └── __tests__/
├── shared/
│   ├── models/               # Data models (VPN Session, Client Config, etc.)
│   ├── services/             # Business logic (provisioning, config generation)
│   └── utils/                # Helpers (retry, validation, crypto)
├── host.json
├── local.settings.json
└── package.json

infra/                        # Infrastructure as Code (existing)
├── main.bicep
├── modules/
├── container/
│   ├── Dockerfile
│   └── scripts/
└── deploy.ps1

tests/
├── contract/                 # API contract tests (Azure Functions)
├── integration/              # End-to-end VPN provisioning tests
└── unit/                     # Shared services unit tests
```

**Structure Decision**: Serverless cloud functions architecture. Azure Functions in `/functions` directory for VPN orchestration (StartVPN, StopVPN, StatusVPN, AutoShutdown timer). Container definition in `/infra/container` with WireGuard Dockerfile. Infrastructure as Code in `/infra` with Bicep templates (already complete). Shared models and services in `functions/shared` for reusability across functions. Tests organized by type (contract, integration, unit) following TDD principle.

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
- Generate tasks from Phase 1 design docs:
  - **3 API contracts** (startvpn, stopvpn, statusvpn) → 3 contract test tasks [P]
  - **5 entities** (VPNSession, ClientConfiguration, UserTenant, OperationalEvent, InfrastructureState) → 5 model tasks [P]
  - **4 Azure Functions** (StartVPN, StopVPN, StatusVPN, AutoShutdown) → 4 implementation tasks
  - **6 quickstart scenarios** → 6 integration test tasks [P]
  - **Shared services** (provisioning, config generation, retry logic) → service layer tasks

**Ordering Strategy**:
- **TDD order**: Contract tests first, then models, then services, then functions, then integration tests
- **Dependency order**:
  - Models have no dependencies → all [P]
  - Services depend on models
  - Functions depend on services
  - Integration tests depend on all implementations
- **Parallel execution**: Mark [P] for independent files (different test files, different models)

**Estimated Task Breakdown**:
1. **Setup** (2-3 tasks): Project init, dependencies, linting
2. **Contract Tests** (3 tasks [P]): StartVPN, StopVPN, StatusVPN contract tests
3. **Models** (5 tasks [P]): VPNSession, ClientConfiguration, UserTenant, OperationalEvent, InfrastructureState
4. **Services** (6 tasks): Provisioning service, config generation, retry logic, state management, cleanup, monitoring
5. **Functions** (4 tasks): StartVPN, StopVPN, StatusVPN, AutoShutdown implementations
6. **Integration** (6 tasks [P]): Quickstart scenarios 1-6
7. **Polish** (3-4 tasks): Unit tests, error handling, logging, documentation

**Estimated Output**: ~30 numbered, ordered tasks in tasks.md

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
- [x] Phase 0: Research complete (/plan command) → [research.md](research.md)
- [x] Phase 1: Design complete (/plan command) → [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md), [/CLAUDE.md](../../CLAUDE.md)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command) → tasks.md
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS (all 5 principles satisfied)
- [x] Post-Design Constitution Check: PASS (no new violations)
- [x] All NEEDS CLARIFICATION resolved (Technical Context complete)
- [x] Complexity deviations documented (none - clean design)

**Artifacts Generated**:
- ✅ `/specs/001-use-existing-documents/research.md` - Technical decisions documented
- ✅ `/specs/001-use-existing-documents/data-model.md` - 5 entities with validation rules
- ✅ `/specs/001-use-existing-documents/contracts/startvpn-api.yaml` - StartVPN OpenAPI spec
- ✅ `/specs/001-use-existing-documents/contracts/stopvpn-api.yaml` - StopVPN OpenAPI spec
- ✅ `/specs/001-use-existing-documents/contracts/statusvpn-api.yaml` - StatusVPN OpenAPI spec
- ✅ `/specs/001-use-existing-documents/quickstart.md` - 6 test scenarios
- ✅ `/CLAUDE.md` - Agent context updated

---
*Based on Constitution v1.0.0 - See `.specify/memory/constitution.md`*
