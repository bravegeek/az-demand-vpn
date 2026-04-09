## ADDED Requirements

### Requirement: Container image builds successfully from the Dockerfile
The system SHALL include all scripts referenced in the Dockerfile so that `docker build` completes without error. The built image SHALL be publishable to GHCR as a public image.

#### Scenario: Successful local build
- **WHEN** `docker build -t az-demand-vpn-wg .` is run from `infra/container/`
- **THEN** the build completes with exit code 0
- **THEN** the image contains `/scripts/entrypoint.sh`, `/scripts/generate-config.sh`, and `/scripts/health-check.sh`

#### Scenario: Missing script causes build failure
- **WHEN** any script referenced in a COPY instruction does not exist
- **THEN** the build fails with a clear error identifying the missing file

---

### Requirement: entrypoint.sh initialises WireGuard and keeps the container running
The entrypoint script SHALL generate or load a WireGuard server config, bring up the `wg0` interface, enable IP forwarding, configure iptables for NAT, and block until the container is stopped.

#### Scenario: Successful WireGuard startup
- **WHEN** the container starts with required environment variables set
- **THEN** the `wg0` interface is up within 10 seconds
- **THEN** `wg show` returns interface information without error

#### Scenario: Missing required environment variable
- **WHEN** the container starts without a required environment variable (e.g., `SERVER_PRIVATE_KEY`)
- **THEN** the entrypoint exits with a non-zero code and logs a descriptive error message
- **THEN** the container does not enter a restart loop (exit immediately, do not retry)

---

### Requirement: generate-config.sh produces a valid WireGuard peer configuration
The script SHALL generate a WireGuard client config file given a server public key, server endpoint, and peer public key. The output SHALL be a valid `.conf` file consumable by `wg-quick`.

#### Scenario: Valid config generated
- **WHEN** `generate-config.sh` is called with valid server public key, endpoint, and peer public key
- **THEN** a `wg-quick`-compatible config file is written to the specified output path
- **THEN** the config contains `[Interface]` and `[Peer]` sections with correct field names

#### Scenario: Invalid input
- **WHEN** `generate-config.sh` is called with a missing required argument
- **THEN** the script exits non-zero and prints usage information to stderr

---

### Requirement: health-check.sh reports WireGuard interface status
The health check script SHALL exit 0 when the `wg0` interface is up and exit non-zero when it is not. It SHALL NOT require an HTTP server.

#### Scenario: Interface is up
- **WHEN** `/scripts/health-check.sh` is run and `wg0` is active
- **THEN** the script exits with code 0

#### Scenario: Interface is down
- **WHEN** `/scripts/health-check.sh` is run and `wg0` is not active
- **THEN** the script exits with a non-zero code

---

### Requirement: Container image is hosted publicly on GHCR
The WireGuard image SHALL be published to `ghcr.io/<org>/az-demand-vpn-wg` as a public image. The ACI container spec SHALL reference this image with no `imageRegistryCredentials` block.

#### Scenario: ACI pulls image without credentials
- **WHEN** an ACI container group is created referencing the GHCR image
- **THEN** the image pull succeeds without an `imageRegistryCredentials` entry in the container group spec

#### Scenario: Image updated via CI
- **WHEN** a push is made to the `main` branch of the repository
- **THEN** a GitHub Actions workflow builds and pushes a new image to GHCR with the `latest` tag
