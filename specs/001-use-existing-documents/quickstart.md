# Quickstart: On-Demand VPN Provisioning System

**Feature**: 001-use-existing-documents
**Purpose**: End-to-end validation scenarios for VPN provisioning system
**Test Type**: Integration / Acceptance Testing

## Prerequisites

- Azure infrastructure deployed (`infra/main.bicep`)
- Azure Functions deployed and running
- Test user account configured with API key
- WireGuard client installed on test machine

## Environment Setup

```bash
# Set environment variables
export VPN_API_ENDPOINT="https://func-az-demand-vpn.azurewebsites.net/api"
export TEST_API_KEY="<test-api-key-from-keyvault>"
export TEST_USER_ID="test-user-001"
```

## Scenario 1: Happy Path - Provision and Connect to VPN

**User Story**: As a remote worker, I want to quickly provision a VPN and connect to access private resources

### Steps

1. **Request VPN Provisioning**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: $TEST_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "idleTimeoutMinutes": 10
     }'
   ```

   **Expected Response (200 OK within 2 minutes)**:
   ```json
   {
     "sessionId": "uuid-here",
     "status": "active",
     "endpoint": {
       "ipAddress": "20.12.34.56",
       "port": 51820
     },
     "configDownloadUrl": "https://...",
     "qrCodeData": "base64-png-data",
     "clientIpAddress": "10.8.0.2",
     "provisionedAt": "2025-10-05T18:30:00Z",
     "expiresAt": "2025-10-05T18:40:00Z"
   }
   ```

   **Validation**:
   - ✅ Response received within 120 seconds (FR-001)
   - ✅ Status is "active"
   - ✅ Valid IPv4 endpoint returned
   - ✅ Config download URL accessible
   - ✅ expiresAt = provisionedAt + 10 minutes

2. **Download Client Configuration**
   ```bash
   curl -o client.conf "$CONFIG_DOWNLOAD_URL"
   ```

   **Expected**: WireGuard configuration file
   ```
   [Interface]
   PrivateKey = <client-private-key>
   Address = 10.8.0.2/32
   DNS = 8.8.8.8

   [Peer]
   PublicKey = <server-public-key>
   Endpoint = 20.12.34.56:51820
   AllowedIPs = 0.0.0.0/0
   ```

   **Validation**:
   - ✅ File downloaded successfully
   - ✅ Contains valid WireGuard syntax
   - ✅ Client IP matches response
   - ✅ Server endpoint matches response

3. **Connect to VPN**
   ```bash
   wg-quick up client.conf
   ```

   **Expected Output**: Connection established

   **Validation**:
   - ✅ Connection succeeds within 30 seconds (FR-025)
   - ✅ VPN interface created (wg0)
   - ✅ Can ping VPN gateway (10.8.0.1)

4. **Verify VPN Traffic**
   ```bash
   # Check public IP (should show VPN endpoint IP)
   curl https://ifconfig.me
   ```

   **Expected**: Returns VPN endpoint IP (20.12.34.56)

   **Validation**:
   - ✅ Traffic routes through VPN
   - ✅ Public IP matches VPN endpoint

5. **Check Session Status**
   ```bash
   curl -X GET $VPN_API_ENDPOINT/vpn/status/$SESSION_ID \
     -H "X-API-Key: $TEST_API_KEY"
   ```

   **Expected Response (200 OK within 5 seconds per FR-024)**:
   ```json
   {
     "sessionId": "uuid-here",
     "userId": "test-user-001",
     "status": "active",
     "health": "healthy",
     "metrics": {
       "connectedClients": 1,
       "bytesReceived": 1234,
       "bytesSent": 5678,
       "lastActivity": "2025-10-05T18:35:00Z"
     },
     "createdAt": "2025-10-05T18:30:00Z"
   }
   ```

   **Validation**:
   - ✅ Response within 5 seconds
   - ✅ Status shows "active"
   - ✅ Health is "healthy"
   - ✅ Metrics show connected client

6. **Stop VPN Session**
   ```bash
   # Disconnect client
   wg-quick down client.conf

   # Request termination
   curl -X POST $VPN_API_ENDPOINT/vpn/stop \
     -H "X-API-Key: $TEST_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "sessionId": "'$SESSION_ID'"
     }'
   ```

   **Expected Response (200 OK within 1 minute per FR-002)**:
   ```json
   {
     "sessionId": "uuid-here",
     "status": "terminated",
     "terminatedAt": "2025-10-05T18:36:00Z",
     "durationMinutes": 6
   }
   ```

   **Validation**:
   - ✅ Termination completes within 60 seconds
   - ✅ Status is "terminated"
   - ✅ Duration calculated correctly

**Scenario 1 Success Criteria**: All steps pass, VPN provision→connect→terminate within performance targets

---

## Scenario 2: Concurrent Request Handling

**User Story**: When I request a new VPN while one is provisioning, the system cancels the first and starts the new one (FR-005a)

### Steps

1. **Start First VPN Request**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: $TEST_API_KEY" &
   PID1=$!
   ```

2. **Immediately Start Second Request (while first is provisioning)**
   ```bash
   sleep 2  # Wait 2 seconds into first provision
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: $TEST_API_KEY"
   ```

   **Expected Response (409 → 200)**:
   ```json
   {
     "existingSessionId": "first-uuid",
     "action": "cancelling_existing",
     "newSessionId": "second-uuid",
     "status": "provisioning"
   }
   ```

   **Validation**:
   - ✅ First request cancelled
   - ✅ Second request proceeds
   - ✅ Only one session becomes active

**Scenario 2 Success Criteria**: Second request supersedes first, single active session results

---

## Scenario 3: Auto-Shutdown on Idle

**User Story**: VPN automatically shuts down after 10 minutes of inactivity to save costs (FR-003)

### Steps

1. **Provision VPN with 10-minute timeout**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: $TEST_API_KEY" \
     -d '{"idleTimeoutMinutes": 10}'
   ```

2. **Connect and then go idle (no traffic)**
   ```bash
   wg-quick up client.conf
   # Don't send any traffic, just wait
   ```

3. **Check status at 5 minutes (should be active)**
   ```bash
   sleep 300
   curl -X GET $VPN_API_ENDPOINT/vpn/status/$SESSION_ID \
     -H "X-API-Key: $TEST_API_KEY"
   ```

   **Expected**: `"status": "active"`

4. **Check status at 11 minutes (should be terminated)**
   ```bash
   sleep 360
   curl -X GET $VPN_API_ENDPOINT/vpn/status/$SESSION_ID \
     -H "X-API-Key: $TEST_API_KEY"
   ```

   **Expected**: `"status": "terminated"` or 404 Not Found

   **Validation**:
   - ✅ Session active at 5 minutes
   - ✅ Session terminated after 10 minutes idle
   - ✅ AutoShutdown function triggered
   - ✅ Container instance deleted

**Scenario 3 Success Criteria**: Idle timeout enforced, resources cleaned up automatically

---

## Scenario 4: Quota and Retry Handling

**User Story**: When Azure quota is exceeded, system retries with backoff (FR-004)

### Steps

1. **Simulate Quota Exhaustion** (requires test setup to force quota error)
   ```bash
   # Provision 3 VPNs to hit limit
   for i in {1..3}; do
     curl -X POST $VPN_API_ENDPOINT/vpn/start \
       -H "X-API-Key: user-$i-key"
   done
   ```

2. **Request 4th VPN (should trigger retry logic)**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: user-4-key" \
     -v  # Verbose to see retry delays
   ```

   **Expected Behavior**:
   - Attempt 1: Fails (quota exceeded)
   - Wait ~1 second (exponential backoff)
   - Attempt 2: Fails (quota exceeded)
   - Wait ~2 seconds
   - Attempt 3: Fails (quota exceeded)
   - Return 503 error

   **Expected Response (503)**:
   ```json
   {
     "error": "Provisioning failed after maximum retries",
     "retryAfterSeconds": 60,
     "attempts": 3
   }
   ```

   **Validation**:
   - ✅ 3 retry attempts made
   - ✅ Exponential backoff observed (1s, 2s, 4s)
   - ✅ 503 returned after final failure
   - ✅ Operational events logged for each attempt

**Scenario 4 Success Criteria**: Retry logic works, quota limits enforced, graceful failure

---

## Scenario 5: Maximum Concurrent Users

**User Story**: System supports maximum of 3 concurrent VPN users (FR-028)

### Steps

1. **Provision VPNs for 3 users**
   ```bash
   for i in {1..3}; do
     curl -X POST $VPN_API_ENDPOINT/vpn/start \
       -H "X-API-Key: user-$i-key"
   done
   ```

2. **Check infrastructure state**
   ```bash
   # Query infrastructure state (admin endpoint)
   curl -X GET $VPN_API_ENDPOINT/admin/infrastructure/state \
     -H "X-API-Key: $ADMIN_KEY"
   ```

   **Expected**:
   ```json
   {
     "activeContainerInstances": 3,
     "activeSessions": 3,
     "quotaLimitReached": true
   }
   ```

3. **Attempt 4th user provision (should fail or queue)**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: user-4-key"
   ```

   **Expected Response (429 or 503)**:
   ```json
   {
     "error": "Maximum concurrent users reached (3/3)",
     "retryAfter": 600
   }
   ```

   **Validation**:
   - ✅ 3 users provisioned successfully
   - ✅ 4th user rejected
   - ✅ Infrastructure state shows limit reached

**Scenario 5 Success Criteria**: 3-user limit enforced, additional requests handled gracefully

---

## Scenario 6: Security and Authentication

**User Story**: Only authenticated users can provision VPNs, secrets are secure (FR-011, FR-015)

### Steps

1. **Attempt provision without API key**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start
   ```

   **Expected**: 401 Unauthorized

2. **Attempt provision with invalid API key**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: invalid-key-12345"
   ```

   **Expected**: 401 Unauthorized

3. **Verify certificates are not in response**
   ```bash
   curl -X POST $VPN_API_ENDPOINT/vpn/start \
     -H "X-API-Key: $TEST_API_KEY" | jq
   ```

   **Validation**:
   - ✅ Private keys NOT in JSON response
   - ✅ Only public endpoint data returned
   - ✅ Config download URL is temporary (SAS token, 1-hour expiry)

4. **Verify audit logging**
   ```bash
   # Query operational events (admin endpoint)
   curl -X GET "$VPN_API_ENDPOINT/admin/events?type=auth.failure&limit=10" \
     -H "X-API-Key: $ADMIN_KEY"
   ```

   **Expected**: Auth failure events logged with IP, timestamp

**Scenario 6 Success Criteria**: Authentication enforced, secrets protected, audit trail maintained

---

## Cleanup

After all scenarios:

```bash
# List all test sessions
curl -X GET $VPN_API_ENDPOINT/vpn/status \
  -H "X-API-Key: $TEST_API_KEY"

# Stop any remaining sessions
for session_id in $(jq -r '.sessions[].sessionId' sessions.json); do
  curl -X POST $VPN_API_ENDPOINT/vpn/stop \
    -H "X-API-Key: $TEST_API_KEY" \
    -d "{\"sessionId\": \"$session_id\"}"
done

# Verify infrastructure state cleared
curl -X GET $VPN_API_ENDPOINT/admin/infrastructure/state \
  -H "X-API-Key: $ADMIN_KEY"
# Expected: activeContainerInstances=0, activeSessions=0
```

## Success Metrics

All scenarios must pass with:
- ✅ Provisioning < 2 minutes (FR-001)
- ✅ Deprovisioning < 1 minute (FR-002)
- ✅ VPN connection < 30 seconds (FR-025)
- ✅ Status queries < 5 seconds (FR-024)
- ✅ Idle timeout enforced (10 min default)
- ✅ Max 3 concurrent users
- ✅ Retry logic with exponential backoff
- ✅ Authentication required
- ✅ Audit trail complete
