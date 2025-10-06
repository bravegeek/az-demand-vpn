/**
 * Integration Test: Auto-Shutdown on Idle
 * Scenario 3 from quickstart.md
 *
 * Tests FR-003: VPN automatically shuts down after configured idle timeout
 *
 * Test flow:
 * 1. Provision VPN with 10-minute idle timeout
 * 2. Connect (simulate activity)
 * 3. Go idle (no traffic)
 * 4. Verify active at 5 minutes
 * 5. Verify terminated at 11 minutes
 */

const axios = require('axios');

describe('Integration: Auto-Shutdown on Idle', () => {
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
        // Ignore if already terminated
      }
    }
  });

  test('VPN terminates after 10 minutes of idle time', async () => {
    // Step 1: Provision VPN with 10-minute timeout
    const provisionResponse = await axios.post(
      `${apiEndpoint}/vpn/start`,
      { idleTimeoutMinutes: 10 },
      { headers }
    );

    expect(provisionResponse.status).toBe(200);
    expect(provisionResponse.data.status).toBe('active');
    sessionId = provisionResponse.data.sessionId;

    // Step 2: Verify session is active immediately
    const initialStatus = await axios.get(
      `${apiEndpoint}/vpn/status/${sessionId}`,
      { headers }
    );
    expect(initialStatus.data.status).toBe('active');

    // Step 3: Wait 5 minutes and check still active
    console.log('Waiting 5 minutes to verify session remains active...');
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes

    const midpointStatus = await axios.get(
      `${apiEndpoint}/vpn/status/${sessionId}`,
      { headers }
    );
    expect(midpointStatus.data.status).toBe('active');

    // Step 4: Wait another 6 minutes (total 11 minutes) and verify terminated
    console.log('Waiting 6 more minutes to verify auto-shutdown...');
    await new Promise(resolve => setTimeout(resolve, 6 * 60 * 1000)); // 6 minutes

    // Session should be terminated or return 404
    try {
      const finalStatus = await axios.get(
        `${apiEndpoint}/vpn/status/${sessionId}`,
        { headers }
      );

      // If response succeeds, status should be 'terminated'
      expect(finalStatus.data.status).toBe('terminated');
    } catch (error) {
      // 404 is also acceptable (session cleaned up)
      expect(error.response.status).toBe(404);
    }

    sessionId = null; // Prevent cleanup attempt
  }, 15 * 60 * 1000); // 15 minute timeout for full test
});
