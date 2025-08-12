# Azure Demand VPN - Project Planning Hub

## Project Overview
This document serves as the central hub for the Azure Demand VPN project, providing links to all relevant documentation and resources. The project implements an on-demand VPN solution using Azure Container Instances (ACI) with containerized VPN software, orchestrated by Azure Functions.

## Documentation Map

### Architecture & Design
- [Architecture Design](./docs/architecture-design.md) - Detailed system architecture and component design
- [WireGuard Implementation](./docs/wireguard-implementation.md) - Specific implementation details for WireGuard VPN
- [MVP WireGuard Container Spec](./docs/specs/mvp-wireguard-container-spec.md) - Detailed specifications for the MVP container implementation

### Development Guidelines
- [Global Development Guide](./docs/global-development-guide.md) - Project-wide development standards and practices
- [JavaScript Implementation Guide](./docs/javascript-implementation-guide.md) - Standards for Azure Functions implementation in JavaScript

### Infrastructure & Operations
- [Infrastructure Tasks](./docs/infrastructure-tasks.md) - Infrastructure setup and deployment tasks
- [Project Roadmap](./docs/project-roadmap.md) - Detailed development phases, timelines, and milestones

### AI Assistant Personas
- [Azure Architect Persona](./docs/personas/azure-architect-persona.md) - AI behavior for Azure architecture and design decisions
- [Technical Project Manager Persona](./docs/personas/technical-project-manager-persona.md) - AI behavior for project management and delivery guidance

## Project Management

### Roadmap
The detailed project roadmap is maintained in a [separate document](./docs/project-roadmap.md), which includes:
- Development phases and timelines
- Deliverables for each phase
- Key milestones
- Dependencies and risk management

### Current Focus
We are currently in **Phase 1: Core Infrastructure**, focusing on:
- Creating base Docker images
- Setting up Azure Container Registry
- Implementing core Azure Functions

## Development Resources

### Azure Resources
- Resource Group: `az-demand-vpn-rg`
- Region: East US 2
- Subscription: [Configure in deployment]

### Repository Structure
```
az-demand-vpn/
├── docs/                   # Documentation files
│   ├── architecture-design.md
│   ├── global-development-guide.md
│   ├── javascript-implementation-guide.md
│   ├── infrastructure-tasks.md
│   ├── wireguard-implementation.md
│   ├── project-roadmap.md
│   ├── personas/           # AI assistant behavior definitions
│   └── specs/             # Detailed specifications
├── src/                    # Source code
│   ├── functions/          # Azure Functions code
│   ├── container/          # Docker container configurations
│   └── ui/                 # User interface (if applicable)
├── infrastructure/         # IaC templates (ARM/Bicep)
├── tests/                  # Test scripts and configurations
└── PLANNING.md             # This file
```

### Key Technologies
- Azure Container Instances
- Azure Functions (JavaScript/Node.js)
- WireGuard VPN
- Azure Key Vault
- Azure Storage
- Azure Container Registry

## Getting Started
1. Review the [Architecture Design](./docs/architecture-design.md) document for system overview
2. Check the [Project Roadmap](./docs/project-roadmap.md) for current phase and priorities
3. Set up your development environment according to the [JavaScript Implementation Guide](./docs/javascript-implementation-guide.md)
4. Follow the [Global Development Guide](./docs/global-development-guide.md) for project standards
5. Review [Infrastructure Tasks](./docs/infrastructure-tasks.md) for deployment requirements

## Team Coordination
- Weekly status updates on Mondays
- Architecture review sessions bi-weekly
- Security reviews before each phase completion

## AI Assistant Usage
This project uses AI assistance with two specialized personas:
- **Azure Architect**: For architecture decisions, technical design, and Azure service recommendations
- **Technical Project Manager**: For project planning, risk management, and delivery guidance

Reference the [persona documentation](./docs/personas/) for detailed behavior specifications.

## Next Steps
1. Complete Docker image for WireGuard (see [MVP Container Spec](./docs/specs/mvp-wireguard-container-spec.md))
2. Implement StartVPN and StopVPN Azure Functions (follow [JavaScript Implementation Guide](./docs/javascript-implementation-guide.md))
3. Set up CI/CD pipeline for container builds
4. Test end-to-end provisioning process

## Documentation Maintenance
- Update this file when adding new documentation
- Ensure all links remain valid
- Cross-reference related documents where appropriate
- Keep persona definitions aligned with project needs

---

*Last updated: June 17, 2025*
