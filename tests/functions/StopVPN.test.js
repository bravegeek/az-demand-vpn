'use strict';

jest.mock('../../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

jest.mock('@azure/functions', () => ({
  app: { http: jest.fn() },
}));

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient } = require('../../src/functions/shared/azureClient');
require('../../src/functions/StopVPN/index');

const handler = app.http.mock.calls[0][1].handler;

const makeRequest = (body) => ({
  json: () => Promise.resolve(body),
  query: { get: () => null },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

describe('StopVPN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the container group and cleans up Key Vault secrets', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const containerGroups = {
      get: jest.fn().mockResolvedValue({}),
      beginDelete: jest.fn().mockResolvedValue(deletePoller),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretDeletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const secretClient = {
      beginDeleteSecret: jest.fn().mockResolvedValue(secretDeletePoller),
    };
    getSecretClient.mockReturnValue(secretClient);

    const response = await handler(makeRequest({ sessionId: 'stop-session' }), context);

    expect(response.status).toBe(200);
    expect(containerGroups.beginDelete).toHaveBeenCalledWith('test-rg', 'vpn-stop-session');
    expect(secretClient.beginDeleteSecret).toHaveBeenCalledWith('wg-peer-config-stop-session');
    expect(secretClient.beginDeleteSecret).toHaveBeenCalledWith('wg-server-key-stop-session');
  });

  it('returns 404 when no container group exists for the session', async () => {
    const containerGroups = {
      get: jest.fn().mockRejectedValue({ statusCode: 404 }),
      beginDelete: jest.fn(),
    };
    getContainerClient.mockReturnValue({ containerGroups });
    getSecretClient.mockReturnValue({});

    const response = await handler(makeRequest({ sessionId: 'ghost-session' }), context);

    expect(response.status).toBe(404);
    expect(containerGroups.beginDelete).not.toHaveBeenCalled();
  });
});
