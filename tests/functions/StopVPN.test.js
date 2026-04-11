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
require('../../src/functions/StopVPN/index');

const handler = app.http.mock.calls[0][1].handler;

const makeRequest = (body) => ({
  json: () => Promise.resolve(body),
  query: { get: () => null },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

describe('StopVPN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes container group, KV secrets, sessions row, and addresses row', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockResolvedValue({}),
        beginDelete: jest.fn().mockResolvedValue(deletePoller),
      },
    });

    const secretPoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const secretClient = {
      beginDeleteSecret: jest.fn().mockResolvedValue(secretPoller),
    };
    getSecretClient.mockReturnValue(secretClient);

    const tableClient = {
      getEntity: jest.fn().mockResolvedValue({ peerAddress: '10.8.0.3' }),
      deleteEntity: jest.fn().mockResolvedValue({}),
    };
    getTableClient.mockReturnValue(tableClient);

    const response = await handler(makeRequest({ sessionId: 'stop-session' }), context);

    expect(response.status).toBe(200);
    expect(secretClient.beginDeleteSecret).toHaveBeenCalledWith('wg-peer-config-stop-session');
    expect(secretClient.beginDeleteSecret).toHaveBeenCalledWith('wg-server-key-stop-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('sessions', 'stop-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('addresses', '10.8.0.3');
  });

  it('returns 404 when no container group exists', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockRejectedValue({ statusCode: 404 }),
        beginDelete: jest.fn(),
      },
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
      deleteEntity: jest.fn(),
    });
    getSecretClient.mockReturnValue({});

    const response = await handler(makeRequest({ sessionId: 'ghost-session' }), context);

    expect(response.status).toBe(404);
  });

  it('skips addresses row cleanup when no sessions row exists (legacy session)', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockResolvedValue({}),
        beginDelete: jest.fn().mockResolvedValue(deletePoller),
      },
    });
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn().mockResolvedValue({}) }),
    });

    const tableClient = {
      getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
      deleteEntity: jest.fn().mockResolvedValue({}),
    };
    getTableClient.mockReturnValue(tableClient);

    const response = await handler(makeRequest({ sessionId: 'legacy-session' }), context);

    expect(response.status).toBe(200);
    // sessions row delete attempted, but no addresses row delete (peerAddress unknown)
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('sessions', 'legacy-session');
    expect(tableClient.deleteEntity).not.toHaveBeenCalledWith('addresses', expect.anything());
  });
});
