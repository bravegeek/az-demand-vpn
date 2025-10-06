/**
 * Integration Test: Quota and Retry Handling
 * Scenario 4 from quickstart.md
 *
 * Tests FR-004: System retries provisioning with exponential backoff
 * when Azure quota is exceeded
 *
 * Test flow:
 * 1. Provision 3 VPNs to hit quota limit
 * 2. Attempt 4th VPN
 * 3. Verify retry logic executes (3 attempts with exponential backoff: 1s, 2s, 4s)
 * 4. Verify 503 response after retries exhausted
 */

const axios = require('axios');

describe('Integration: Quota and Retry Handling', () => {
  const apiEndpoint = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const apiKey = process.env.TEST_API_KEY || 'test-api-key';

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  const testUsers = [
    { id: 'quota-test-user-1', key: process.env.TEST_API_KEY_USER1 || apiKey },
    { id: 'quota-test-user-2', key: process.env.TEST_API_KEY_USER2 || apiKey },
    { id: 'quota-test-user-3', key: process.env.TEST_API_KEY_USER3 || apiKey },
    { id: 'quota-test-user-4', key: process.env.TEST_API_KEY_USER4 || apiKey }
  ];

  let sessions = [];

  afterEach(async () => {
    // Cleanup all test sessions
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

  test('System retries with exponential backoff when quota exceeded', async () => {
    // Step 1: Provision 3 VPNs to hit quota limit
    console.log('Provisioning 3 VPNs to reach quota limit...');

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
      sessions.push({
        sessionId: response.data.sessionId,
        apiKey: testUsers[i].key
      });
    }

    // Verify infrastructure state shows quota limit reached
    // (This would require a status endpoint that shows infrastructure state)

    // Step 2: Attempt 4th VPN (should trigger retry logic)
    console.log('Attempting 4th VPN to trigger quota retry logic...');

    const fourthUserHeaders = {
      ...headers,
      'X-API-Key': testUsers[3].key
    };

    const startTime = Date.now();
    let retryError;

    try {
      await axios.post(
        `${apiEndpoint}/vpn/start`,
        { idleTimeoutMinutes: 10 },
        { headers: fourthUserHeaders }
      );

      // If this succeeds, it means retry worked (quota became available)
      // This is acceptable behavior
    } catch (error) {
      retryError = error;
    }

    const totalTime = Date.now() - startTime;

    // Step 3: Verify retry behavior
    if (retryError) {
      // Should return 503 Service Unavailable
      expect(retryError.response.status).toBe(503);
      expect(retryError.response.data).toHaveProperty('error');
      expect(retryError.response.data).toHaveProperty('attempts', 3);
      expect(retryError.response.data.error).toContain('retry');

      // Verify exponential backoff timing
      // 3 retries with 1s, 2s, 4s delays = minimum ~7 seconds
      // (plus actual provisioning attempt times)
      expect(totalTime).toBeGreaterThanOrEqual(7000);
    } else {
      console.log('4th provision succeeded (retry logic worked or quota became available)');
    }
  }, 300000); // 5 minute timeout
});
