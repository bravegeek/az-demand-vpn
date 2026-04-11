'use strict';

jest.mock('../../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  getTableClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

jest.mock('@azure/functions', () => ({
  app: { http: jest.fn() },
}));

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient } = require('../../src/functions/shared/azureClient');
require('../../src/functions/CheckVPNStatus/index');

const handler = app.http.mock.calls[0][1].handler;

const makeRequest = (sessionId) => ({
  json: () => Promise.resolve({}),
  query: { get: (key) => (key === 'sessionId' ? sessionId : null) },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

const succeededGroup = {
  properties: { provisioningState: 'Succeeded', ipAddress: { ip: '1.2.3.4' } },
};
const provisioningGroup = {
  properties: { provisioningState: 'Creating', ipAddress: null },
};

describe('CheckVPNStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns Provisioning when ACI is not yet ready', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockResolvedValue(provisioningGroup) },
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ status: 'Provisioning', peerAddress: '10.8.0.2', etag: 'abc' }),
    });
    getSecretClient.mockReturnValue({});

    const response = await handler(makeRequest('creating-session'), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody.status).toBe('Provisioning');
    expect(response.jsonBody.ip).toBeNull();
  });

  it('finalizes config on first Running read: derives pubkey from KV private key', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockResolvedValue(succeededGroup) },
    });

    // Generate a real x25519 private key for the test
    const { generateKeyPairSync } = require('crypto');
    const { privateKey: privKeyObj } = generateKeyPairSync('x25519');
    const privDer = privKeyObj.export({ type: 'pkcs8', format: 'der' });
    const privateKeyBase64 = privDer.slice(-32).toString('base64');

    const setSecret = jest.fn().mockResolvedValue({});
    const updateEntity = jest.fn().mockResolvedValue({});
    getSecretClient.mockReturnValue({
      getSecret: jest.fn().mockResolvedValue({ value: privateKeyBase64 }),
      setSecret,
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({
        status: 'Provisioning', peerAddress: '10.8.0.2', etag: 'abc',
      }),
      updateEntity,
    });

    const response = await handler(makeRequest('new-running-session'), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody.status).toBe('Running');
    expect(response.jsonBody.clientConfig).toContain('[Interface]');
    expect(response.jsonBody.clientConfig).toContain('Endpoint = 1.2.3.4:51820');
    // Config written to KV
    expect(setSecret).toHaveBeenCalledWith('wg-peer-config-new-running-session', expect.any(String), expect.any(Object));
    // Sessions row updated to Running
    expect(updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Running' }),
      'Merge',
      { etag: 'abc' }
    );
  });

  it('handles concurrent finalization: 412 on ETag conflict is non-fatal', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockResolvedValue(succeededGroup) },
    });

    const { generateKeyPairSync } = require('crypto');
    const { privateKey: privKeyObj } = generateKeyPairSync('x25519');
    const privDer = privKeyObj.export({ type: 'pkcs8', format: 'der' });

    getSecretClient.mockReturnValue({
      getSecret: jest.fn().mockResolvedValue({ value: privDer.slice(-32).toString('base64') }),
      setSecret: jest.fn().mockResolvedValue({}),
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ status: 'Provisioning', peerAddress: '10.8.0.2', etag: 'stale' }),
      updateEntity: jest.fn().mockRejectedValue({ statusCode: 412 }),
    });

    const response = await handler(makeRequest('race-session'), context);

    // Should still return Running despite 412
    expect(response.status).toBe(200);
    expect(response.jsonBody.status).toBe('Running');
  });

  it('returns cached config directly when sessions row status is Running', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockResolvedValue(succeededGroup) },
    });
    const getSecret = jest.fn().mockResolvedValue({ value: '[Interface]\nAddress=10.8.0.2/32' });
    getSecretClient.mockReturnValue({ getSecret });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ status: 'Running', peerAddress: '10.8.0.2', etag: 'xyz' }),
    });

    const response = await handler(makeRequest('cached-session'), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody.clientConfig).toContain('[Interface]');
    // KV read, but no setSecret called
    expect(getSecret).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when no container group exists', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockRejectedValue({ statusCode: 404 }) },
    });
    getTableClient.mockReturnValue({});
    getSecretClient.mockReturnValue({});

    const response = await handler(makeRequest('missing-session'), context);

    expect(response.status).toBe(404);
    expect(response.jsonBody.status).toBe('NotFound');
  });
});
