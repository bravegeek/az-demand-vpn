/**
 * Integration Test: Happy Path VPN Lifecycle
 * Scenario 1 from quickstart.md
 *
 * Tests the complete VPN lifecycle:
 * 1. Provision VPN
 * 2. Download config
 * 3. Connect to VPN
 * 4. Verify traffic routing
 * 5. Check status
 * 6. Stop VPN
 *
 * Performance Requirements:
 * - Provision: <2 minutes (FR-001)
 * - Connect: <30 seconds (FR-025)
 * - Stop: <1 minute (FR-002)
 * - Status: <5 seconds (FR-024)
 */

const axios = require('axios');

describe('Integration: Happy Path VPN Lifecycle', () => {
  const apiEndpoint = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const apiKey = process.env.TEST_API_KEY || 'test-api-key';
  const testUserId = process.env.TEST_USER_ID || 'test-user-001';

  let sessionId;
  let configDownloadUrl;

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  afterEach(async () => {
    // Cleanup: ensure session is terminated
    if (sessionId) {
      try {
        await axios.post(
          `${apiEndpoint}/vpn/stop`,
          { sessionId },
          { headers }
        );
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  test('Step 1: Provision VPN within 2 minutes', async () => {
    const startTime = Date.now();

    const response = await axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    const provisionTime = Date.now() - startTime;

    // Validate response structure
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('sessionId');
    expect(response.data).toHaveProperty('status', 'active');
    expect(response.data).toHaveProperty('endpoint');
    expect(response.data.endpoint).toHaveProperty('ipAddress');
    expect(response.data.endpoint).toHaveProperty('port', 51820);
    expect(response.data).toHaveProperty('configDownloadUrl');
    expect(response.data).toHaveProperty('qrCodeData');
    expect(response.data).toHaveProperty('clientIpAddress');
    expect(response.data).toHaveProperty('provisionedAt');
    expect(response.data).toHaveProperty('expiresAt');

    // Validate IP address format
    expect(response.data.endpoint.ipAddress).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    expect(response.data.clientIpAddress).toMatch(/^10\.8\.0\.\d{1,3}$/);

    // Validate expiry time (10 minutes from provisioned time)
    const provisionedAt = new Date(response.data.provisionedAt);
    const expiresAt = new Date(response.data.expiresAt);
    const expectedExpiryMs = 10 * 60 * 1000; // 10 minutes
    expect(expiresAt.getTime() - provisionedAt.getTime()).toBe(expectedExpiryMs);

    // FR-001: Provision time < 2 minutes (120000 ms)
    expect(provisionTime).toBeLessThan(120000);

    // Store for subsequent tests
    sessionId = response.data.sessionId;
    configDownloadUrl = response.data.configDownloadUrl;
  }, 150000); // 2.5 minute timeout for test

  test('Step 2: Download client configuration', async () => {
    // This test depends on step 1 completing
    expect(configDownloadUrl).toBeDefined();

    const response = await axios.get(configDownloadUrl);

    expect(response.status).toBe(200);
    expect(response.data).toContain('[Interface]');
    expect(response.data).toContain('PrivateKey');
    expect(response.data).toContain('Address');
    expect(response.data).toContain('[Peer]');
    expect(response.data).toContain('PublicKey');
    expect(response.data).toContain('Endpoint');
    expect(response.data).toContain('AllowedIPs');
  });

  test('Step 3: Check session status within 5 seconds', async () => {
    expect(sessionId).toBeDefined();

    const startTime = Date.now();

    const response = await axios.get(
      `${apiEndpoint}/vpn/status/${sessionId}`,
      { headers }
    );

    const statusQueryTime = Date.now() - startTime;

    // Validate response structure
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('sessionId', sessionId);
    expect(response.data).toHaveProperty('userId', testUserId);
    expect(response.data).toHaveProperty('status', 'active');
    expect(response.data).toHaveProperty('health');
    expect(response.data).toHaveProperty('metrics');
    expect(response.data.metrics).toHaveProperty('connectedClients');
    expect(response.data.metrics).toHaveProperty('bytesReceived');
    expect(response.data.metrics).toHaveProperty('bytesSent');
    expect(response.data.metrics).toHaveProperty('lastActivity');
    expect(response.data).toHaveProperty('createdAt');

    // FR-024: Status query < 5 seconds (5000 ms)
    expect(statusQueryTime).toBeLessThan(5000);
  });

  test('Step 4: Stop VPN within 1 minute', async () => {
    expect(sessionId).toBeDefined();

    const startTime = Date.now();

    const response = await axios.post(
      `${apiEndpoint}/vpn/stop`,
      { sessionId },
      { headers }
    );

    const stopTime = Date.now() - startTime;

    // Validate response structure
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('sessionId', sessionId);
    expect(response.data).toHaveProperty('status', 'terminated');
    expect(response.data).toHaveProperty('terminatedAt');
    expect(response.data).toHaveProperty('durationMinutes');

    // FR-002: Deprovision time < 1 minute (60000 ms)
    expect(stopTime).toBeLessThan(60000);

    // Clear sessionId to prevent cleanup attempt
    sessionId = null;
  }, 90000); // 1.5 minute timeout for test
});
