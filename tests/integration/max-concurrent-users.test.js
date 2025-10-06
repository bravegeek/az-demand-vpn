/**
 * Integration Test: Maximum Concurrent Users
 * Scenario 5 from quickstart.md
 *
 * Tests FR-028: System supports maximum of 3 concurrent VPN users
 *
 * Test flow:
 * 1. Provision VPNs for 3 users
 * 2. Verify infrastructure state (activeContainerInstances=3, quotaLimitReached=true)
 * 3. Attempt 4th user provision
 * 4. Verify 429 rejection (Too Many Requests)
 */

const axios = require('axios');

describe('Integration: Maximum Concurrent Users', () => {
  const apiEndpoint = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const apiKey = process.env.TEST_API_KEY || 'test-api-key';

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  const testUsers = [
    { id: 'max-user-1', key: process.env.TEST_API_KEY_USER1 || apiKey },
    { id: 'max-user-2', key: process.env.TEST_API_KEY_USER2 || apiKey },
    { id: 'max-user-3', key: process.env.TEST_API_KEY_USER3 || apiKey },
    { id: 'max-user-4', key: process.env.TEST_API_KEY_USER4 || apiKey }
  ];

  let sessions = [];

  afterEach(async () => {
    // Cleanup all sessions
    for (const session of sessions) {
      try {
        await axios.post(
          `${apiEndpoint}/vpn/stop`,
          { sessionId: session.sessionId },
          { headers: { ...headers, 'X-API-Key': session.apiKey } }
        );
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    sessions = [];
  });

  test('System enforces 3 concurrent user limit', async () => {
    // Step 1: Provision VPNs for 3 users
    console.log('Provisioning VPNs for 3 users...');

    for (let i = 0; i < 3; i++) {
      const userHeaders = {
        ...headers,
        'X-API-Key': testUsers[i].key
      };

      const response = await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        { headers: userHeaders }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('active');

      sessions.push({
        sessionId: response.data.sessionId,
        userId: testUsers[i].id,
        apiKey: testUsers[i].key
      });
    }

    // Step 2: Verify infrastructure state
    // Query status endpoint to check active sessions
    const statusResponse = await axios.get(
      `${apiEndpoint}/vpn/status`,
      { headers }
    );

    const activeSessions = statusResponse.data.sessions.filter(
      s => s.status === 'active'
    );

    expect(activeSessions.length).toBeGreaterThanOrEqual(3);

    // Step 3: Attempt 4th user provision (should fail)
    console.log('Attempting 4th user provision (should be rejected)...');

    const fourthUserHeaders = {
      ...headers,
      'X-API-Key': testUsers[3].key
    };

    let rejectionError;

    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        { headers: fourthUserHeaders }
      );

      // If this succeeds, test should fail
      fail('4th user provision should have been rejected');
    } catch (error) {
      rejectionError = error;
    }

    // Step 4: Verify rejection response
    expect(rejectionError).toBeDefined();
    expect([429, 503]).toContain(rejectionError.response.status);
    expect(rejectionError.response.data).toHaveProperty('error');
    expect(rejectionError.response.data.error).toMatch(/maximum|concurrent|limit|quota/i);

    // Should include retry-after or retryAfter field
    const hasRetryAfter =
      rejectionError.response.data.retryAfter !== undefined ||
      rejectionError.response.data.retryAfterSeconds !== undefined ||
      rejectionError.response.headers['retry-after'] !== undefined;

    expect(hasRetryAfter).toBe(true);
  }, 300000); // 5 minute timeout
});
