# Azure Demand VPN - Project Planning Hub

## Project Overview
This document serves as the central hub for the Azure Demand VPN project, providing links to all relevant documentation and resources. The project implements an on-demand VPN solution using Azure Container Instances (ACI) with containerized VPN software, orchestrated by Azure Functions.

## Documentation Map

### Architecture & Design
- [Architecture Design](./docs/architecture-design.md) - Detailed system architecture and component design
- [WireGuard Implementation](./docs/wireguard-implementation.md) - Specific implementation details for WireGuard VPN

### Development Guidelines
- [Global Development Guide](./docs/global-development-guide.md) - Project-wide development standards and practices
- [JavaScript Implementation Guide](./docs/javascript-implementation-guide.md) - Standards for Azure Functions implementation in JavaScript

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
1. Review the [Architecture Design](./docs/architecture-design.md) document
2. Set up your development environment according to the [JavaScript Implementation Guide](./docs/javascript-implementation-guide.md)
3. Follow the [Global Development Guide](./docs/global-development-guide.md)

## Team Coordination
- Weekly status updates on Mondays
- Architecture review sessions bi-weekly
- Security reviews before each phase completion

## Next Steps
1. Complete Docker image for WireGuard
2. Implement StartVPN and StopVPN Azure Functions
3. Set up CI/CD pipeline for container builds
4. Test end-to-end provisioning process

---

*Last updated: June 17, 2025*
