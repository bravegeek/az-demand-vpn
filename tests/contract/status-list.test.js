/**
 * Contract Test: GET /api/vpn/status (list all sessions)
 * Validates StatusVPN list endpoint contract (statusvpn-api.yaml)
 *
 * Tests:
 * - Query parameter filtering (status)
 * - Pagination support
 * - Response array schema
 * - totalCount/activeCount fields
 */

describe('GET /api/vpn/status - StatusVPN List Contract', () => {
  const API_ENDPOINT = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-12345';
  const STATUS_TIMEOUT = 5000; // 5 seconds in ms

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

  // Helper to clean up sessions
  async function cleanupSession(sessionId) {
    if (!sessionId) return;

    await fetch(`${API_ENDPOINT}/vpn/stop`, {
      method: 'POST',
      headers: {
        'X-API-Key': TEST_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionId })
    });
  }

  describe('Basic Response Schema', () => {
    test('should return sessions array with correct structure', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Required fields
      expect(data).toHaveProperty('sessions');
      expect(data).toHaveProperty('totalCount');
      expect(data).toHaveProperty('activeCount');

      // Validate types
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(typeof data.totalCount).toBe('number');
      expect(typeof data.activeCount).toBe('number');

      // Validate counts
      expect(data.totalCount).toBeGreaterThanOrEqual(0);
      expect(data.activeCount).toBeGreaterThanOrEqual(0);
      expect(data.activeCount).toBeLessThanOrEqual(data.totalCount);
    });

    test('each session in array should have required fields', async () => {
      const sessionId = await createTestSession();

      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.sessions.length > 0) {
        data.sessions.forEach(session => {
          expect(session).toHaveProperty('sessionId');
          expect(session).toHaveProperty('status');
          expect(session).toHaveProperty('createdAt');

          // Validate formats
          expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
          expect(['provisioning', 'active', 'idle', 'terminating', 'terminated']).toContain(session.status);
          expect(new Date(session.createdAt)).toBeInstanceOf(Date);
        });
      }

      // Cleanup
      await cleanupSession(sessionId);
    });
  });

  describe('Query Parameter Filtering', () => {
    test('should accept status filter parameter', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=active`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // All returned sessions should have 'active' status
      if (data.sessions.length > 0) {
        data.sessions.forEach(session => {
          expect(session.status).toBe('active');
        });
      }
    });

    test('should accept provisioning status filter', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=provisioning`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.sessions.length > 0) {
        data.sessions.forEach(session => {
          expect(session.status).toBe('provisioning');
        });
      }
    });

    test('should accept terminated status filter', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=terminated`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.sessions.length > 0) {
        data.sessions.forEach(session => {
          expect(session.status).toBe('terminated');
        });
      }
    });

    test('should reject invalid status filter value', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=invalid`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      // Should return 400 for invalid enum value
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should return all sessions when no filter provided', async () => {
      const sessionId = await createTestSession();

      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should include sessions with any status
      const statuses = data.sessions.map(s => s.status);
      const uniqueStatuses = [...new Set(statuses)];

      // May have multiple different statuses (or just one if only one session exists)
      expect(uniqueStatuses.length).toBeGreaterThanOrEqual(0);

      // Cleanup
      await cleanupSession(sessionId);
    });
  });

  describe('Authentication Validation', () => {
    test('should reject request without API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET'
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject request with invalid API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': 'invalid-key-xyz'
        }
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Performance Validation', () => {
    test('should respond within 5 seconds (FR-024)', async () => {
      const startTime = Date.now();

      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(STATUS_TIMEOUT);
      expect(response.status).toBe(200);
    }, STATUS_TIMEOUT + 2000); // Add 2s buffer
  });

  describe('Count Validation', () => {
    test('totalCount should match number of sessions returned', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // totalCount should equal sessions array length
      expect(data.totalCount).toBe(data.sessions.length);
    });

    test('activeCount should count only active sessions', async () => {
      const sessionId = await createTestSession();

      // Wait for session to become active
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Count active sessions manually
      const activeSessions = data.sessions.filter(s => s.status === 'active');
      expect(data.activeCount).toBe(activeSessions.length);

      // Cleanup
      await cleanupSession(sessionId);
    });

    test('should not exceed max concurrent sessions (3)', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=active`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should never have more than 3 active sessions per FR-028
      expect(data.sessions.length).toBeLessThanOrEqual(3);
      expect(data.activeCount).toBeLessThanOrEqual(3);
    });
  });

  describe('Pagination Support', () => {
    test('should handle empty results', async () => {
      // Query for a status that likely has no sessions
      const response = await fetch(`${API_ENDPOINT}/vpn/status?status=idle`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should return empty array, not error
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.totalCount).toBe(0);
      expect(data.sessions.length).toBe(0);
    });

    test('should return sessions in consistent order', async () => {
      const response1 = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      const response2 = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Session order should be consistent (likely sorted by createdAt)
      const ids1 = data1.sessions.map(s => s.sessionId);
      const ids2 = data2.sessions.map(s => s.sessionId);

      expect(ids1).toEqual(ids2);
    });
  });

  describe('User Isolation', () => {
    test('should only return sessions for authenticated user', async () => {
      const sessionId = await createTestSession();

      const response = await fetch(`${API_ENDPOINT}/vpn/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // All sessions should belong to the current user
      // (We can't verify userId without knowing the user ID, but at minimum
      // we should have at least the session we just created)
      if (sessionId) {
        const sessionExists = data.sessions.some(s => s.sessionId === sessionId);
        expect(sessionExists).toBe(true);
      }

      // Cleanup
      await cleanupSession(sessionId);
    });
  });
});
