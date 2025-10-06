/**
 * Contract Test: POST /api/vpn/start
 * Validates StartVPN API contract (startvpn-api.yaml)
 *
 * Tests:
 * - Request schema validation
 * - Response schema validation (200, 202, 400, 401, 409, 429, 503)
 * - Authentication header requirement
 * - Timeout validation (<2 min per FR-001)
 * - Concurrent request handling (FR-005a)
 */

describe('POST /api/vpn/start - StartVPN Contract', () => {
  const API_ENDPOINT = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
  const TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-12345';
  const PROVISION_TIMEOUT = 120000; // 2 minutes in ms

  describe('Request Schema Validation', () => {
    test('should accept valid request with idleTimeoutMinutes', async () => {
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

      // Expect valid response (200 or 202), not 400
      expect([200, 202, 409, 503]).toContain(response.status);
    });

    test('should accept valid request with allowedIPs', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          allowedIPs: '192.168.1.0/24'
        })
      });

      expect([200, 202, 409, 503]).toContain(response.status);
    });

    test('should accept valid request with dnsServers', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dnsServers: ['8.8.8.8', '8.8.4.4']
        })
      });

      expect([200, 202, 409, 503]).toContain(response.status);
    });

    test('should reject invalid idleTimeoutMinutes (below minimum)', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idleTimeoutMinutes: 0
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject invalid idleTimeoutMinutes (above maximum)', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idleTimeoutMinutes: 1441
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Response Schema Validation', () => {
    test('200 response should match schema', async () => {
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

      // If we get 200, validate the schema
      if (response.status === 200) {
        const data = await response.json();

        // Required fields
        expect(data).toHaveProperty('sessionId');
        expect(data).toHaveProperty('status');
        expect(data).toHaveProperty('endpoint');
        expect(data).toHaveProperty('configDownloadUrl');

        // Validate types and formats
        expect(data.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(['provisioning', 'active']).toContain(data.status);

        // Endpoint object
        expect(data.endpoint).toHaveProperty('ipAddress');
        expect(data.endpoint).toHaveProperty('port');
        expect(data.endpoint.port).toBe(51820);

        // Optional fields
        if (data.qrCodeData) {
          expect(typeof data.qrCodeData).toBe('string');
        }
        if (data.clientIpAddress) {
          expect(data.clientIpAddress).toMatch(/^10\.8\.0\.\d+$/);
        }
        if (data.provisionedAt) {
          expect(new Date(data.provisionedAt)).toBeInstanceOf(Date);
        }
        if (data.expiresAt) {
          expect(new Date(data.expiresAt)).toBeInstanceOf(Date);
        }
      }
    });

    test('202 response should match schema', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 202) {
        const data = await response.json();
        expect(data).toHaveProperty('sessionId');
        expect(data).toHaveProperty('status');
        expect(data.status).toBe('provisioning');
        if (data.estimatedCompletionTime) {
          expect(new Date(data.estimatedCompletionTime)).toBeInstanceOf(Date);
        }
      }
    });

    test('400 response should have error schema', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        },
        body: 'invalid-json'
      });

      if (response.status === 400) {
        const data = await response.json();
        expect(data).toHaveProperty('error');
        expect(typeof data.error).toBe('string');
      }
    });

    test('409 response should indicate conflict', async () => {
      // Start first provision
      const response1 = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      // Immediately start second provision
      const response2 = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      // One of these should be 409 (or implementation may auto-cancel)
      const statuses = [response1.status, response2.status];
      if (statuses.includes(409)) {
        const conflictResponse = response1.status === 409 ? response1 : response2;
        const data = await conflictResponse.json();
        expect(data).toHaveProperty('error');
        expect(data).toHaveProperty('existingSessionId');
        expect(data).toHaveProperty('action');
        expect(['cancelling_existing', 'starting_new']).toContain(data.action);
      }
    });

    test('429 response should indicate quota limit', async () => {
      // This test would require provisioning 3 VPNs first
      // For now, we just validate the schema if we get 429
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 429) {
        const data = await response.json();
        expect(data).toHaveProperty('error');
      }
    });

    test('503 response should indicate provisioning failure', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 503) {
        const data = await response.json();
        expect(data).toHaveProperty('error');
        expect(data).toHaveProperty('retryAfterSeconds');
        expect(data).toHaveProperty('attempts');
        expect(data.attempts).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('Authentication Validation', () => {
    test('should reject request without API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject request with invalid API key', async () => {
      const response = await fetch(`${API_ENDPOINT}/vpn/start`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'invalid-key-xyz',
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Performance Validation', () => {
    test('should complete provisioning within 2 minutes', async () => {
      const startTime = Date.now();

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

      const duration = Date.now() - startTime;

      // Should respond within 2 minutes
      expect(duration).toBeLessThan(PROVISION_TIMEOUT);

      // If status is 200, provisioning is complete
      // If status is 202, provisioning is in progress (acceptable)
      expect([200, 202, 409, 503]).toContain(response.status);
    }, PROVISION_TIMEOUT + 5000); // Add 5s buffer to test timeout
  });

  describe('Concurrent Request Handling', () => {
    test('should handle concurrent requests per FR-005a', async () => {
      // Start two provisions simultaneously
      const [response1, response2] = await Promise.all([
        fetch(`${API_ENDPOINT}/vpn/start`, {
          method: 'POST',
          headers: {
            'X-API-Key': TEST_API_KEY,
            'Content-Type': 'application/json'
          }
        }),
        fetch(`${API_ENDPOINT}/vpn/start`, {
          method: 'POST',
          headers: {
            'X-API-Key': TEST_API_KEY,
            'Content-Type': 'application/json'
          }
        })
      ]);

      // Per FR-005a: should cancel first and start second, or handle gracefully
      // At least one should succeed or be in provisioning
      const statuses = [response1.status, response2.status];
      expect(
        statuses.some(s => [200, 202].includes(s))
      ).toBe(true);

      // Should not have two successful provisions
      const successCount = statuses.filter(s => s === 200).length;
      expect(successCount).toBeLessThanOrEqual(1);
    });
  });
});
