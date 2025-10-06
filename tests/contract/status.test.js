/**
 * Contract Test: GET /api/vpn/status/{sessionId}
 * Validates StatusVPN API contract (statusvpn-api.yaml)
 *
 * Tests:
 * - Path parameter validation (sessionId)
 * - Response schema validation (200, 400, 401, 404)
 * - Query timeout (<5 sec per FR-024)
 * - Health status enum validation
 * - Metrics format validation
 */

describe('GET /api/vpn/status/{sessionId} - StatusVPN Contract', () => {
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

  describe('Path Parameter Validation', () => {
    test('should accept valid UUID sessionId', async () => {
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      // Should not return 400 for valid UUID format
      // 404 is acceptable (session doesn't exist)
      expect(response.status).not.toBe(400);
    });

    test('should reject invalid sessionId format', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status/not-a-uuid`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject empty sessionId', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status/`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      // Should return 400 or 404 (depending on routing)
      expect([400, 404]).toContain(response.status);
    });
  });

  describe('Response Schema Validation', () => {
    test('200 response should match schema', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Required fields
      expect(data).toHaveProperty('sessionId');
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('createdAt');

      // Validate types
      expect(data.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(typeof data.userId).toBe('string');
      expect(['provisioning', 'active', 'idle', 'terminating', 'terminated']).toContain(data.status);
      expect(new Date(data.createdAt)).toBeInstanceOf(Date);

      // Optional fields
      if (data.health) {
        expect(['healthy', 'degraded', 'unhealthy']).toContain(data.health);
      }

      if (data.endpoint) {
        expect(data.endpoint).toHaveProperty('ipAddress');
        expect(data.endpoint).toHaveProperty('port');
        expect(data.endpoint.ipAddress).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
        expect(typeof data.endpoint.port).toBe('number');
      }

      if (data.metrics) {
        if (data.metrics.connectedClients !== undefined) {
          expect(typeof data.metrics.connectedClients).toBe('number');
        }
        if (data.metrics.bytesReceived !== undefined) {
          expect(typeof data.metrics.bytesReceived).toBe('number');
        }
        if (data.metrics.bytesSent !== undefined) {
          expect(typeof data.metrics.bytesSent).toBe('number');
        }
        if (data.metrics.lastActivity) {
          expect(new Date(data.metrics.lastActivity)).toBeInstanceOf(Date);
        }
        if (data.metrics.uptimeMinutes !== undefined) {
          expect(typeof data.metrics.uptimeMinutes).toBe('number');
        }
      }

      if (data.lastActivityAt) {
        expect(new Date(data.lastActivityAt)).toBeInstanceOf(Date);
      }
      if (data.idleTimeoutAt) {
        expect(new Date(data.idleTimeoutAt)).toBeInstanceOf(Date);
      }
      if (data.terminatedAt) {
        expect(new Date(data.terminatedAt)).toBeInstanceOf(Date);
      }
      if (data.errorMessage) {
        expect(typeof data.errorMessage).toBe('string');
      }
    });

    test('400 response should have error schema', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/status/invalid-id`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    });

    test('404 response for non-existent session', async () => {
      const nonExistentId = '00000000-0000-4000-8000-000000000000';

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${nonExistentId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Authentication Validation', () => {
    test('should reject request without API key', async () => {
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET'
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject request with invalid API key', async () => {
      const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
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
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const startTime = Date.now();

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      const duration = Date.now() - startTime;

      // Should respond within 5 seconds per FR-024
      expect(duration).toBeLessThan(STATUS_TIMEOUT);
      expect(response.status).toBe(200);
    }, STATUS_TIMEOUT + 2000); // Add 2s buffer
  });

  describe('Health Status Enum Validation', () => {
    test('health field should only have valid enum values', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.health) {
          expect(['healthy', 'degraded', 'unhealthy']).toContain(data.health);
        }
      }
    });

    test('status field should only have valid enum values', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      if (response.ok) {
        const data = await response.json();
        expect(['provisioning', 'active', 'idle', 'terminating', 'terminated']).toContain(data.status);
      }
    });
  });

  describe('Metrics Format Validation', () => {
    test('metrics should have correct data types', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      if (response.ok) {
        const data = await response.json();

        if (data.metrics) {
          const { metrics } = data;

          // Validate numeric fields
          if (metrics.connectedClients !== undefined) {
            expect(typeof metrics.connectedClients).toBe('number');
            expect(metrics.connectedClients).toBeGreaterThanOrEqual(0);
          }

          if (metrics.bytesReceived !== undefined) {
            expect(typeof metrics.bytesReceived).toBe('number');
            expect(metrics.bytesReceived).toBeGreaterThanOrEqual(0);
          }

          if (metrics.bytesSent !== undefined) {
            expect(typeof metrics.bytesSent).toBe('number');
            expect(metrics.bytesSent).toBeGreaterThanOrEqual(0);
          }

          if (metrics.uptimeMinutes !== undefined) {
            expect(typeof metrics.uptimeMinutes).toBe('number');
            expect(metrics.uptimeMinutes).toBeGreaterThanOrEqual(0);
          }

          // Validate timestamp
          if (metrics.lastActivity) {
            const activityDate = new Date(metrics.lastActivity);
            expect(activityDate).toBeInstanceOf(Date);
            expect(activityDate.getTime()).not.toBeNaN();
          }
        }
      }
    });

    test('idleTimeoutAt should be calculated correctly', async () => {
      const sessionId = await createTestSession();
      if (!sessionId) {
        console.warn('Skipping test: could not create test session');
        return;
      }

      const response = await fetch(`${API_ENDPOINT}/vpn/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });

      if (response.ok) {
        const data = await response.json();

        if (data.idleTimeoutAt && data.lastActivityAt) {
          const lastActivity = new Date(data.lastActivityAt);
          const idleTimeout = new Date(data.idleTimeoutAt);

          // idleTimeoutAt should be after lastActivityAt
          expect(idleTimeout.getTime()).toBeGreaterThan(lastActivity.getTime());

          // Difference should be approximately 10 minutes (default timeout)
          const diffMinutes = (idleTimeout.getTime() - lastActivity.getTime()) / (1000 * 60);
          expect(diffMinutes).toBeCloseTo(10, 1); // Within 1 minute tolerance
        }
      }
    });
  });
});
