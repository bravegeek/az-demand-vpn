# Azure Demand VPN — Claude Code Guide

## Project Overview

On-demand VPN solution using Azure Container Instances (ACI) with containerized WireGuard, orchestrated by Azure Functions. Containers are created on-demand and destroyed when not in use.

Key components:
- **WireGuard container** — Alpine-based image in Azure Container Registry
- **Azure Functions** — StartVPN, StopVPN, CheckVPNStatus, AutoShutdown (JavaScript/Node.js)
- **Azure Key Vault** — secrets, certificates, managed identities
- **Bicep IaC** — all infrastructure in `infra/`

See `PLANNING.md` for the documentation map and current focus.

## Domain Expertise Context

This project spans three domains. Apply the relevant framing based on the task:

**Azure Architecture** — For infrastructure design, networking, and service decisions:
- Apply Azure Well-Architected Framework (cost, security, reliability, performance, ops)
- VPN focus: ACI lifecycle, WireGuard config, ACR, Key Vault, networking (NSG, private DNS)
- Prefer Bicep for IaC; use managed identities over keys

**PowerShell / Automation** — For scripts in `infra/`:
- Production-quality, well-commented, idiomatic PowerShell
- Scripts currently handle Docker builds, ACR push, ACI deploy, and template testing

**Project / Delivery** — For planning and task tracking:
- Reference `docs/project-roadmap.md` for phases and milestones
- Current phase: Phase 1 — Core Infrastructure

## Development Standards

**Language**: JavaScript (Node.js) for Azure Functions  
**Style**: Airbnb style guide, 2-space indent, single quotes, semicolons  
**Naming**: `camelCase` functions/vars, `PascalCase` classes, `UPPER_SNAKE_CASE` constants  
**ES6+**: `const`/`let`, arrow functions, template literals, destructuring  
**File size**: Max 500 lines — split into modules if approaching limit  
**Testing**: Jest unit tests for all new logic; tests in `/tests` mirroring source structure  
- Include: 1 expected-use test, 1 edge case, 1 failure case  
**Error handling**: try/catch for expected errors, validate inputs, meaningful messages  
**Comments**: JSDoc for all functions; inline `# Reason:` for non-obvious logic

## Key Constraints

- Never delete or overwrite existing code unless explicitly asked
- Always confirm file paths exist before referencing in code or tests
- Don't use unverified libraries — check package exists before adding
- Security-first: least-privilege RBAC, no secrets in code, use Key Vault references
- Resource group: `az-demand-vpn-rg`, Region: East US 2

## Local RAG Index

All project docs are indexed in the local RAG server. Query it first for any conceptual or architectural questions before reading files directly:

- Architecture, design decisions, component relationships → RAG
- WireGuard config, ACI lifecycle, Azure Functions patterns → RAG
- Phase status, roadmap, task lists → RAG
- Exact code searches (function names, specific strings) → `Grep`
- Finding files by pattern → `Glob`

Indexed documents: `CLAUDE.md`, `docs/architecture-design.md`, `docs/wireguard-implementation.md`, `docs/javascript-implementation-guide.md`, `docs/project-roadmap.md`, `docs/specs/mvp-wireguard-container-spec.md`, `docs/infrastructure-tasks.md`, `infra/README.md`, `infra/container/README.md`, all persona docs, `infra/main.bicep`.

## Repo Structure

```
az-demand-vpn/
├── docs/               # Architecture, guides, specs, personas
│   ├── specs/          # Detailed implementation specs
│   └── personas/       # Domain persona reference docs
├── infra/              # Bicep IaC + PowerShell deployment scripts
│   ├── modules/        # Bicep modules (network, ACI, ACR, functions, etc.)
│   └── container/      # Dockerfile + build/test scripts
├── openspec/           # OpenSpec change management config
└── PLANNING.md         # Project hub — start here for context
```
