/**
 * Integration Test: Concurrent Request Handling
 * Scenario 2 from quickstart.md
 *
 * Tests FR-005a: When a user requests a new VPN while one is provisioning,
 * the system cancels the first request and starts the new one.
 *
 * Expected behavior:
 * - First request starts provisioning
 * - Second request (while first is still provisioning) cancels first
 * - Only second request completes successfully
 * - Only one active session results
 */

const axios = require('axios');

describe('Integration: Concurrent Request Handling', () => {
  const apiEndpoint = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const apiKey = process.env.TEST_API_KEY || 'test-api-key';

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  let activeSessions = [];

  afterEach(async () => {
    // Cleanup all sessions
    for (const sessionId of activeSessions) {
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
    activeSessions = [];
  });

  test('Second request cancels first provisioning request', async () => {
    // Start first request
    const firstRequestPromise = axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    // Wait 2 seconds to ensure first request is in provisioning state
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start second request (should cancel first)
    const secondRequestPromise = axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    // Wait for both requests to complete
    const [firstResult, secondResult] = await Promise.allSettled([
      firstRequestPromise,
      secondRequestPromise
    ]);

    // Analyze results
    let firstSessionId = null;
    let secondSessionId = null;

    // First request may succeed or be cancelled
    if (firstResult.status === 'fulfilled') {
      firstSessionId = firstResult.value.data.sessionId;
    }

    // Second request should succeed
    expect(secondResult.status).toBe('fulfilled');
    expect(secondResult.value.status).toBe(200);
    secondSessionId = secondResult.value.data.sessionId;

    // If response indicates cancellation behavior
    if (secondResult.value.data.existingSessionId) {
      expect(secondResult.value.data).toHaveProperty('action', 'cancelling_existing');
      expect(secondResult.value.data).toHaveProperty('existingSessionId', firstSessionId);
      expect(secondResult.value.data).toHaveProperty('newSessionId');
      expect(secondResult.value.data.newSessionId).not.toBe(firstSessionId);
    }

    activeSessions.push(secondSessionId);
    if (firstSessionId && firstSessionId !== secondSessionId) {
      activeSessions.push(firstSessionId);
    }

    // Verify only one session is active
    const statusResponse = await axios.get(
      `${apiEndpoint}/vpn/status`,
      { headers }
    );

    const activeSessions = statusResponse.data.sessions.filter(
      s => s.status === 'active'
    );

    expect(activeSessions.length).toBe(1);
    expect(activeSessions[0].sessionId).toBe(secondSessionId);
  }, 180000); // 3 minute timeout
});
