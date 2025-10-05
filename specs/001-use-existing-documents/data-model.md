# Data Model: On-Demand VPN Provisioning System

**Feature**: 001-use-existing-documents
**Date**: 2025-10-05

## Entities

### 1. VPNSession

Represents an active VPN provisioning instance.

**Storage**: Azure Table Storage (for fast lookup) + Blob Storage (for full config)

**Fields**:
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| sessionId | string (GUID) | Yes | UUID v4 | Unique session identifier (partition key) |
| userId | string | Yes | Non-empty | User/tenant identifier (row key) |
| status | enum | Yes | 'provisioning', 'active', 'idle', 'terminating', 'terminated' | Current session state |
| containerInstanceId | string | No | Azure resource ID | ACI resource identifier when provisioned |
| publicIpAddress | string | No | IPv4 format | VPN endpoint IP address |
| vpnPort | number | Yes | 51820 (default) | WireGuard port |
| createdAt | timestamp | Yes | ISO 8601 | Session creation time |
| lastActivityAt | timestamp | Yes | ISO 8601 | Last client activity timestamp |
| terminatedAt | timestamp | No | ISO 8601 | Session termination time |
| idleTimeoutMinutes | number | Yes | 1-1440 | Idle timeout (default: 10) |
| provisionAttempts | number | Yes | 0-3 | Number of provision retries |
| errorMessage | string | No | Max 1000 chars | Last error if failed |

**Relationships**:
- Has many: ClientConfiguration
- Has many: OperationalEvent

**State Transitions**:
```
provisioning → active (on successful ACI creation)
provisioning → terminated (on failure after 3 retries)
active → idle (on timeout detection)
active → terminating (on user stop request)
idle → terminating (on auto-shutdown trigger)
terminating → terminated (on successful cleanup)
```

**Validation Rules**:
- sessionId must be unique globally
- userId + status='active' combination must be unique (one active session per user)
- lastActivityAt must be >= createdAt
- If status='terminated', terminatedAt must be set
- provisionAttempts <= 3

### 2. ClientConfiguration

Represents VPN client setup information.

**Storage**: Azure Blob Storage (`client-configs` container)

**Fields**:
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| configId | string (GUID) | Yes | UUID v4 | Unique config identifier |
| sessionId | string (GUID) | Yes | Foreign key to VPNSession | Associated session |
| userId | string | Yes | Non-empty | Owner user/tenant |
| clientPublicKey | string | Yes | WireGuard key format | Client's WireGuard public key |
| clientPrivateKey | string | Yes | WireGuard key format | Client's WireGuard private key |
| clientIpAddress | string | Yes | IPv4 CIDR (e.g., 10.8.0.2/32) | Assigned IP within VPN subnet |
| serverPublicKey | string | Yes | WireGuard key format | Server's WireGuard public key |
| serverEndpoint | string | Yes | IP:port format | VPN server endpoint |
| allowedIPs | string | Yes | CIDR list | Routes through VPN (e.g., 0.0.0.0/0) |
| dnsServers | string[] | No | IPv4 list | DNS servers for VPN |
| configFileContent | string | Yes | WireGuard format | Full .conf file content |
| qrCodeData | string | No | Base64 PNG | QR code for mobile setup |
| createdAt | timestamp | Yes | ISO 8601 | Configuration creation time |
| expiresAt | timestamp | Yes | ISO 8601 | Expiration time (session termination + grace period) |
| downloadToken | string | No | SAS token | Temporary download token |

**Relationships**:
- Belongs to: VPNSession

**Validation Rules**:
- configId must be unique
- sessionId must reference existing VPNSession
- clientIpAddress must be within 10.8.0.0/24 subnet
- clientIpAddress must be unique per active session
- expiresAt must be > createdAt
- downloadToken expires in 1 hour if present

### 3. UserTenant

Represents an authorized entity that can request VPN access.

**Storage**: Azure Table Storage

**Fields**:
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| userId | string | Yes | Non-empty | Unique user/tenant identifier (partition+row key) |
| email | string | No | Email format | Contact email |
| displayName | string | No | Max 100 chars | Friendly name |
| authMethod | enum | Yes | 'apikey', 'azuread' | Authentication method |
| apiKey | string | No | SHA-256 hash | Hashed API key (if authMethod='apikey') |
| azureAdObjectId | string | No | GUID | Azure AD object ID (if authMethod='azuread') |
| isActive | boolean | Yes | true/false | Account active status |
| quotaMaxConcurrentSessions | number | Yes | 1-3 | Max concurrent VPN sessions |
| quotaMaxSessionsPerDay | number | No | Positive integer | Daily session limit |
| totalSessionsCreated | number | Yes | >= 0 | Lifetime session count |
| lastSessionAt | timestamp | No | ISO 8601 | Last session creation time |
| createdAt | timestamp | Yes | ISO 8601 | Account creation time |
| updatedAt | timestamp | Yes | ISO 8601 | Last update time |

**Relationships**:
- Has many: VPNSession
- Has many: OperationalEvent

**Validation Rules**:
- userId must be unique
- If authMethod='apikey', apiKey must be set
- If authMethod='azuread', azureAdObjectId must be set
- quotaMaxConcurrentSessions <= 3 (system limit)
- Active VPNSessions count <= quotaMaxConcurrentSessions

### 4. OperationalEvent

Represents system events and audit trail.

**Storage**: Azure Table Storage (partitioned by date for efficient querying/retention)

**Fields**:
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| eventId | string (GUID) | Yes | UUID v4 | Unique event identifier |
| eventDate | string | Yes | YYYY-MM-DD | Event date (partition key) |
| timestamp | timestamp | Yes | ISO 8601 | Event occurrence time (row key) |
| eventType | enum | Yes | See below | Event category |
| userId | string | No | Non-empty | Associated user (if applicable) |
| sessionId | string (GUID) | No | UUID v4 | Associated session (if applicable) |
| outcome | enum | Yes | 'success', 'failure', 'warning' | Event result |
| message | string | Yes | Max 2000 chars | Event description |
| metadata | JSON | No | Valid JSON | Additional context |
| ipAddress | string | No | IPv4/IPv6 | Source IP |
| durationMs | number | No | >= 0 | Operation duration (if applicable) |

**Event Types**:
- `vpn.provision.start`
- `vpn.provision.success`
- `vpn.provision.failure`
- `vpn.stop.start`
- `vpn.stop.success`
- `vpn.stop.failure`
- `vpn.connect.attempt`
- `vpn.connect.success`
- `vpn.connect.failure`
- `vpn.disconnect`
- `vpn.idle.detected`
- `vpn.auto.shutdown`
- `auth.success`
- `auth.failure`
- `config.generated`
- `config.downloaded`

**Relationships**:
- References: VPNSession (optional)
- References: UserTenant (optional)

**Validation Rules**:
- eventId must be unique
- eventDate must match date part of timestamp
- If eventType starts with 'vpn.', sessionId should be present
- If eventType starts with 'auth.', userId should be present
- Events older than 5 days auto-deleted (lifecycle policy)

### 5. InfrastructureState

Represents current cloud resource allocation.

**Storage**: Azure Table Storage (single row, frequently updated)

**Fields**:
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| stateId | string | Yes | Fixed: 'current' | Singleton identifier |
| activeContainerInstances | number | Yes | 0-3 | Count of running ACIs |
| activeSessions | number | Yes | 0-3 | Count of active VPN sessions |
| totalProvisioningAttempts | number | Yes | >= 0 | Lifetime provision attempts |
| totalProvisioningFailures | number | Yes | >= 0 | Lifetime provision failures |
| totalBytesTransferred | number | No | >= 0 | Cumulative VPN traffic |
| currentCostEstimate | number | No | >= 0 | Estimated cost this month (USD) |
| lastUpdated | timestamp | Yes | ISO 8601 | Last state update |
| quotaLimitReached | boolean | Yes | true/false | At max capacity flag |

**Validation Rules**:
- stateId must always be 'current' (singleton pattern)
- activeContainerInstances <= 3
- activeSessions <= 3
- activeSessions <= activeContainerInstances (can't have more sessions than containers)

**Usage**:
- Updated on every provision/deprovision operation
- Read before provisioning to check capacity
- Used for monitoring dashboards and cost tracking

## Data Flow Diagrams

### Provisioning Flow
```
1. StartVPN function receives request
2. Query UserTenant for auth/quota check
3. Query InfrastructureState for capacity check
4. Create VPNSession (status='provisioning')
5. Create OperationalEvent (vpn.provision.start)
6. Provision ACI (with retry logic)
7. Generate ClientConfiguration (keys, config file, QR code)
8. Update VPNSession (status='active', IP address)
9. Update InfrastructureState (increment counters)
10. Create OperationalEvent (vpn.provision.success)
11. Return ClientConfiguration to user
```

### Termination Flow
```
1. StopVPN/AutoShutdown triggers
2. Load VPNSession by sessionId
3. Update VPNSession (status='terminating')
4. Create OperationalEvent (vpn.stop.start)
5. Delete ACI instance
6. Update VPNSession (status='terminated', set terminatedAt)
7. Mark ClientConfiguration as expired
8. Update InfrastructureState (decrement counters)
9. Create OperationalEvent (vpn.stop.success)
```

## Indexing Strategy

### Azure Table Storage Indexes
- **VPNSession**:
  - Primary: PartitionKey=sessionId, RowKey=userId
  - Query patterns: by sessionId, by userId+status

- **UserTenant**:
  - Primary: PartitionKey=userId, RowKey=userId
  - Query patterns: by userId

- **OperationalEvent**:
  - Primary: PartitionKey=eventDate, RowKey=timestamp
  - Query patterns: by date range, by userId, by sessionId

- **InfrastructureState**:
  - Primary: PartitionKey='singleton', RowKey='current'
  - Query patterns: get current state only

### Azure Blob Storage Naming
- ClientConfiguration: `client-configs/{sessionId}/{configId}.conf`
- VPN logs: `vpn-logs/{date}/{sessionId}.log`
- Server configs: `wireguard-configs/{sessionId}/wg0.conf`

## Data Retention and Lifecycle

| Data Type | Retention | Cleanup Method |
|-----------|-----------|----------------|
| VPNSession (active) | Until terminated | Manual via StopVPN |
| VPNSession (terminated) | 30 days | Table Storage lifecycle policy |
| ClientConfiguration | Session lifetime + 1 hour | Blob lifecycle policy |
| OperationalEvent | 5 days | Table Storage partition cleanup |
| InfrastructureState | Indefinite | Singleton, continuously updated |
| UserTenant | Indefinite | Manual deletion only |

## Security and Encryption

- **At Rest**: All Azure Storage encrypted with Microsoft-managed keys
- **In Transit**: TLS 1.2+ for all Azure SDK operations
- **Secrets**: Private keys stored in Key Vault, never in tables/blobs
- **PII**: Email, IP addresses considered PII, access logged
- **Access Control**: Managed Identity with least-privilege RBAC
