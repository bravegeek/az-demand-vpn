'use strict';

jest.mock('../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

const { getContainerClient, getSecretClient } = require('../src/functions/shared/azureClient');

// Import triggers handler registration — we test the handler directly via mocks
// rather than invoking via the Functions host.
let handler;
beforeAll(() => {
  const mockApp = { http: jest.fn((name, opts) => { handler = opts.handler; }) };
  jest.mock('@azure/functions', () => ({ app: mockApp }));
  require('../src/functions/StartVPN/index');
});

const makeRequest = (body) => ({
  json: () => Promise.resolve(body),
  query: { get: () => null },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

describe('StartVPN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a container group and returns IP + client config on first call', async () => {
    const mockPoller = { pollUntilDone: jest.fn().mockResolvedValue({
      properties: { ipAddress: { ip: '1.2.3.4' }, provisioningState: 'Succeeded' },
    })};
    const containerGroups = {
      get: jest.fn().mockRejectedValue({ statusCode: 404 }),
      beginCreateOrUpdate: jest.fn().mockResolvedValue(mockPoller),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretPoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const secretClient = {
      getSecret: jest.fn().mockRejectedValue({ statusCode: 404 }),
      setSecret: jest.fn().mockResolvedValue({}),
    };
    getSecretClient.mockReturnValue(secretClient);

    const response = await handler(makeRequest({ sessionId: 'test-session', location: 'eastus2' }), context);

    expect(response.status).toBe(200);
    const body = typeof response.jsonBody === 'string' ? JSON.parse(response.jsonBody) : response.jsonBody;
    expect(body.status).toBe('Running');
    expect(body.ip).toBe('1.2.3.4');
    expect(containerGroups.beginCreateOrUpdate).toHaveBeenCalledWith(
      'test-rg',
      'vpn-test-session',
      expect.objectContaining({ location: 'eastus2' })
    );
  });

  it('returns existing container info without creating a new group (idempotent)', async () => {
    const containerGroups = {
      get: jest.fn().mockResolvedValue({
        properties: { ipAddress: { ip: '5.6.7.8' }, provisioningState: 'Succeeded' },
      }),
      beginCreateOrUpdate: jest.fn(),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretClient = {
      getSecret: jest.fn().mockResolvedValue({ value: '[Interface]\nAddress=10.8.0.2/32' }),
    };
    getSecretClient.mockReturnValue(secretClient);

    const response = await handler(makeRequest({ sessionId: 'existing-session' }), context);

    expect(response.status).toBe(200);
    expect(containerGroups.beginCreateOrUpdate).not.toHaveBeenCalled();
    const body = typeof response.jsonBody === 'string' ? JSON.parse(response.jsonBody) : response.jsonBody;
    expect(body.ip).toBe('5.6.7.8');
  });

  it('returns 503 when ACI creation throws', async () => {
    const containerGroups = {
      get: jest.fn().mockRejectedValue({ statusCode: 404 }),
      beginCreateOrUpdate: jest.fn().mockRejectedValue(new Error('Quota exceeded')),
    };
    getContainerClient.mockReturnValue({ containerGroups });
    getSecretClient.mockReturnValue({
      getSecret: jest.fn().mockRejectedValue({ statusCode: 404 }),
      setSecret: jest.fn().mockResolvedValue({}),
    });

    const response = await handler(makeRequest({ sessionId: 'fail-session' }), context);

    expect(response.status).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.error).toMatch(/Failed to start VPN/);
  });
});
