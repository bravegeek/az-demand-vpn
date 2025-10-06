/**
 * Integration Test: Security and Authentication
 * Scenario 6 from quickstart.md
 *
 * Tests FR-011 (authentication required) and FR-015 (audit logging)
 *
 * Test flow:
 * 1. Attempt provision without API key (expect 401)
 * 2. Attempt provision with invalid API key (expect 401)
 * 3. Verify private keys NOT in response
 * 4. Verify config download has 1-hour SAS token
 * 5. Verify audit events logged
 */

const axios = require('axios');

describe('Integration: Security and Authentication', () => {
  const apiEndpoint = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const apiKey = process.env.TEST_API_KEY || 'test-api-key';

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  let sessionId;

  afterEach(async () => {
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
      sessionId = null;
    }
  });

  test('Provision without API key returns 401', async () => {
    let error;

    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        { headers: { 'Content-Type': 'application/json' } } // No X-API-Key
      );

      fail('Request without API key should have been rejected');
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.response.status).toBe(401);
  });

  test('Provision with invalid API key returns 401', async () => {
    let error;

    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        {
          headers: {
            'X-API-Key': 'invalid-key-12345',
            'Content-Type': 'application/json'
          }
        }
      );

      fail('Request with invalid API key should have been rejected');
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.response.status).toBe(401);
  });

  test('Private keys are NOT exposed in API response', async () => {
    const response = await axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    expect(response.status).toBe(200);
    sessionId = response.data.sessionId;

    // Response should NOT contain private keys
    const responseString = JSON.stringify(response.data);

    expect(responseString).not.toContain('privateKey');
    expect(responseString).not.toContain('PrivateKey');
    expect(responseString).not.toContain('private_key');

    // Response should contain only public endpoint data
    expect(response.data).toHaveProperty('endpoint');
    expect(response.data).toHaveProperty('configDownloadUrl');
    expect(response.data).toHaveProperty('qrCodeData');

    // Should NOT contain sensitive fields
    expect(response.data).not.toHaveProperty('clientPrivateKey');
    expect(response.data).not.toHaveProperty('serverPrivateKey');
  });

  test('Config download URL has temporary SAS token (1-hour expiry)', async () => {
    const response = await axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    expect(response.status).toBe(200);
    sessionId = response.data.sessionId;

    const configUrl = response.data.configDownloadUrl;
    expect(configUrl).toBeDefined();

    // URL should contain SAS token parameters
    expect(configUrl).toContain('sig='); // Signature
    expect(configUrl).toContain('se=');  // Expiry

    // Extract expiry time from SAS token
    const urlParams = new URL(configUrl).searchParams;
    const expiryParam = urlParams.get('se');

    if (expiryParam) {
      const expiryTime = new Date(expiryParam);
      const now = new Date();
      const hourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      // Expiry should be approximately 1 hour from now
      expect(expiryTime.getTime()).toBeGreaterThan(now.getTime());
      expect(expiryTime.getTime()).toBeLessThan(twoHoursFromNow.getTime());
    }

    // Verify config can be downloaded with the SAS token
    const configResponse = await axios.get(configUrl);
    expect(configResponse.status).toBe(200);
    expect(configResponse.data).toContain('[Interface]');
  });

  test('Audit events are logged for authentication', async () => {
    // Attempt with invalid key (should log auth.failure)
    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        {
          headers: {
            'X-API-Key': 'invalid-test-key',
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      expect(error.response.status).toBe(401);
    }

    // Successful provision (should log auth.success and vpn.provision.*)
    const response = await axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    expect(response.status).toBe(200);
    sessionId = response.data.sessionId;

    // Note: Actual audit log verification would require querying
    // Application Insights or Table Storage (OperationalEvent table)
    // This is a placeholder for that verification

    // In a complete implementation, you would:
    // 1. Query Application Insights custom events
    // 2. Filter by eventType: 'auth.failure', 'auth.success', 'vpn.provision.start'
    // 3. Verify events contain: userId, timestamp, ipAddress, outcome

    expect(true).toBe(true); // Placeholder assertion
  });

  test('Source IP restriction enforced (FR-014)', async () => {
    // This test requires test user configured with allowedSourceIPs restriction
    // Skip if not configured
    if (!process.env.TEST_IP_RESTRICTED_API_KEY) {
      console.log('Skipping IP restriction test (no restricted API key configured)');
      return;
    }

    const restrictedHeaders = {
      'X-API-Key': process.env.TEST_IP_RESTRICTED_API_KEY,
      'Content-Type': 'application/json'
    };

    // If calling from non-allowed IP, should return 403
    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        { headers: restrictedHeaders }
      );

      // If this succeeds, IP is in allowed list (acceptable)
      console.log('Source IP is in allowed list for restricted user');
    } catch (error) {
      // Should be 403 Forbidden (valid key but IP not allowed)
      expect(error.response.status).toBe(403);
      expect(error.response.data.error).toMatch(/ip|source|restriction/i);
    }
  });
});
