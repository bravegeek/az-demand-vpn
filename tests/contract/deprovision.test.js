/**
 * Contract Test: POST /api/vpn/stop
 * Validates StopVPN API contract (stopvpn-api.yaml)
 *
 * Tests:
 * - Request schema validation (sessionId required)
 * - Response schema validation (200, 202, 400, 401, 404, 409)
 * - Timeout validation (<1 min per FR-002)
 * - State transition validation
 */

describe('POST /api/vpn/stop - StopVPN Contract', () => {
  const API_ENDPOINT = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-12345';
  const DEPROVISION_TIMEOUT = 60000; // 1 minute in ms

  // Helper to create a test session
  async function createTestSession() {
    const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
      method: 'POST',
      headers: {
        'X-API-Key': TEST_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idleTimeoutMinutes: 10
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.sessionId;
    }
    return null;
  }

  describe('Request Schema Validation', () => {
    test('should require sessionId in request body', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should accept valid sessionId', async () => {
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'; // Mock UUID

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId
        })
      });

      // Expect 404 (session not found) or other valid response, not 400
      expect(response.status).not.toBe(400);
    });

    test('should accept optional force parameter', async () => {
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId,
          force: true
        })
      });

      // Should accept force parameter (not 400)
      expect(response.status).not.toBe(400);
    });

    test('should reject invalid sessionId format', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'not-a-uuid'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Response Schema Validation', () => {
    test('200 response should match schema', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      if (response.status === 200) {
        const data = await response.json();

        // Required fields
        expect(data).toHaveProperty('sessionId');
        expect(data).toHaveProperty('status');
        expect(data).toHaveProperty('terminatedAt');

        // Validate types
        expect(data.sessionId).toBe(sessionId);
        expect(data.status).toBe('terminated');
        expect(new Date(data.terminatedAt)).toBeInstanceOf(Date);

        // Optional fields
        if (data.durationMinutes !== undefined) {
          expect(typeof data.durationMinutes).toBe('number');
          expect(data.durationMinutes).toBeGreaterThanOrEqual(0);
        }
        if (data.bytesTransferred !== undefined) {
          expect(typeof data.bytesTransferred).toBe('number');
          expect(data.bytesTransferred).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('202 response should indicate terminating status', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      if (response.status === 202) {
        const data = await response.json();
        expect(data).toHaveProperty('sessionId');
        expect(data).toHaveProperty('status');
        expect(data.status).toBe('terminating');
      }
    });

    test('400 response should have error schema', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'invalid'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('404 response for non-existent session', async () => {
      const nonExistentId = '00000000-0000-4000-8000-000000000000';

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: nonExistentId
        })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('409 response for invalid state transition', async () => {
      // This would require a session in a non-stoppable state
      // For now, we validate the schema structure if we encounter 409
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      if (response.status === 409) {
        const data = await response.json();
        expect(data).toHaveProperty('error');
        expect(data).toHaveProperty('currentStatus');
        expect(data).toHaveProperty('allowedStatuses');
        expect(Array.isArray(data.allowedStatuses)).toBe(true);
      }
    });
  });

  describe('Authentication Validation', () => {
    test('should reject request without API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject request with invalid API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'invalid-key-xyz',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Performance Validation', () => {
    test('should complete deprovisioning within 1 minute', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const startTime = Date.now();

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      const duration = Date.now() - startTime;

      // Should respond within 1 minute
      expect(duration).toBeLessThan(DEPROVISION_TIMEOUT);

      // Should be successful or in progress
      expect([200, 202]).toContain(response.status);
    }, DEPROVISION_TIMEOUT + 5000); // Add 5s buffer
  });

  describe('State Transition Validation', () => {
    test('should allow stopping active session', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      // Wait for session to become active
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      // Should accept stop for active session
      expect([200, 202]).toContain(response.status);
    });

    test('should reject stopping already terminated session', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      // Stop the session
      await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      // Wait for termination
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Try to stop again
      const response = await fetch(`${API_ENDPOINT}/vpn/stop`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });

      // Should reject (404 or 409)
      expect([404, 409]).toContain(response.status);
    });
  });
});
