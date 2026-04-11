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

// Set required env vars before module load (fail-fast check runs at require time)
process.env.VPN_CONTAINER_IMAGE = 'ghcr.io/test/az-demand-vpn-wg:latest';
process.env.StorageAccountName = 'teststorage';
process.env.VPN_SUBNET_ID = '/subscriptions/test/resourceGroups/test-rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/vpn';
process.env.VPN_TUNNEL_SUBNET = '10.8.0.0/24';
process.env.VPN_CONTAINER_IDENTITY_ID = '/subscriptions/test/resourceGroups/test-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/vpn-id';
process.env.STORAGE_TABLE_ENDPOINT = 'https://teststorage.table.core.windows.net';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient } = require('../../src/functions/shared/azureClient');
require('../../src/functions/StartVPN/index');

const handler = app.http.mock.calls[0][1].handler;

const makeRequest = (body) => ({
  json: () => Promise.resolve(body),
  query: { get: () => null },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

// Reusable table client mock factory
const makeTableClient = (overrides = {}) => ({
  listEntities: jest.fn().mockReturnValue((async function* () {})()),
  createEntity: jest.fn().mockResolvedValue({}),
  deleteEntity: jest.fn().mockResolvedValue({}),
  getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
  updateEntity: jest.fn().mockResolvedValue({}),
  ...overrides,
});

describe('StartVPN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 202 Provisioning on new session and allocates peer address', async () => {
    const tableClient = makeTableClient();
    getTableClient.mockReturnValue(tableClient);

    const containerGroups = {
      get: jest.fn().mockRejectedValue({ statusCode: 404 }),
      beginCreateOrUpdate: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn() }),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretClient = {
      setSecret: jest.fn().mockResolvedValue({}),
      beginDeleteSecret: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn().mockResolvedValue({}) }),
    };
    getSecretClient.mockReturnValue(secretClient);

    const response = await handler(makeRequest({ sessionId: 'test-session', location: 'eastus2' }), context);

    expect(response.status).toBe(202);
    expect(response.jsonBody.status).toBe('Provisioning');
    expect(response.jsonBody.sessionId).toBe('test-session');
    // Address lock written to 'addresses' partition
    expect(tableClient.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'addresses', rowKey: '10.8.0.2', sessionId: 'test-session' })
    );
    // Session row written with Provisioning status
    expect(tableClient.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'sessions', rowKey: 'test-session', status: 'Provisioning' })
    );
    // beginCreateOrUpdate called but NOT pollUntilDone
    expect(containerGroups.beginCreateOrUpdate).toHaveBeenCalledWith(
      'test-rg', 'vpn-test-session', expect.objectContaining({ location: 'eastus2' })
    );
  });

  it('retries address allocation on 409 conflict and claims next free address', async () => {
    async function* usedAddresses() {
      yield { partitionKey: 'addresses', rowKey: '10.8.0.2' };
    }
    const tableClient = makeTableClient({
      listEntities: jest.fn().mockReturnValue(usedAddresses()),
    });
    getTableClient.mockReturnValue(tableClient);

    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockRejectedValue({ statusCode: 404 }),
        beginCreateOrUpdate: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn() }),
      },
    });
    getSecretClient.mockReturnValue({ setSecret: jest.fn().mockResolvedValue({}) });

    const response = await handler(makeRequest({ sessionId: 'new-session' }), context);

    expect(response.status).toBe(202);
    // .2 was used, so .3 should be claimed
    expect(tableClient.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: 'addresses', rowKey: '10.8.0.3' })
    );
  });

  it('returns 503 when address pool is exhausted', async () => {
    async function* allUsed() {
      for (let i = 2; i <= 254; i++) {
        yield { partitionKey: 'addresses', rowKey: `10.8.0.${i}` };
      }
    }
    getTableClient.mockReturnValue(makeTableClient({ listEntities: jest.fn().mockReturnValue(allUsed()) }));
    getContainerClient.mockReturnValue({
      containerGroups: { get: jest.fn().mockRejectedValue({ statusCode: 404 }) },
    });
    getSecretClient.mockReturnValue({});

    const response = await handler(makeRequest({ sessionId: 'no-addr-session' }), context);

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).error).toMatch(/pool exhausted/);
  });

  it('cleans up KV secret, sessions row, and addresses row on ACI failure', async () => {
    const tableClient = makeTableClient();
    getTableClient.mockReturnValue(tableClient);

    const secretPoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const secretClient = {
      setSecret: jest.fn().mockResolvedValue({}),
      beginDeleteSecret: jest.fn().mockResolvedValue(secretPoller),
    };
    getSecretClient.mockReturnValue(secretClient);

    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockRejectedValue({ statusCode: 404 }),
        beginCreateOrUpdate: jest.fn().mockRejectedValue(new Error('ACI quota exceeded')),
      },
    });

    const response = await handler(makeRequest({ sessionId: 'fail-session' }), context);

    expect(response.status).toBe(503);
    expect(secretClient.beginDeleteSecret).toHaveBeenCalledWith('wg-server-key-fail-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('sessions', 'fail-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('addresses', '10.8.0.2');
  });

  it('uses UserAssigned identity in container spec', async () => {
    getTableClient.mockReturnValue(makeTableClient());
    const beginCreateOrUpdate = jest.fn().mockResolvedValue({ pollUntilDone: jest.fn() });
    getContainerClient.mockReturnValue({
      containerGroups: {
        get: jest.fn().mockRejectedValue({ statusCode: 404 }),
        beginCreateOrUpdate,
      },
    });
    getSecretClient.mockReturnValue({ setSecret: jest.fn().mockResolvedValue({}) });

    await handler(makeRequest({ sessionId: 'identity-session' }), context);

    const spec = beginCreateOrUpdate.mock.calls[0][2];
    expect(spec.identity.type).toBe('UserAssigned');
    // toHaveProperty interprets '/' as path separator — use toMatchObject instead
    expect(spec.identity.userAssignedIdentities).toMatchObject({ [process.env.VPN_CONTAINER_IDENTITY_ID]: {} });
  });

  it('returns existing session without creating a new container (idempotent)', async () => {
    getTableClient.mockReturnValue(makeTableClient());
    const containerGroups = {
      get: jest.fn().mockResolvedValue({
        properties: { ipAddress: { ip: '5.6.7.8' }, provisioningState: 'Succeeded' },
      }),
      beginCreateOrUpdate: jest.fn(),
    };
    getContainerClient.mockReturnValue({ containerGroups });
    getSecretClient.mockReturnValue({
      getSecret: jest.fn().mockResolvedValue({ value: '[Interface]\nAddress=10.8.0.2/32' }),
    });

    const response = await handler(makeRequest({ sessionId: 'existing-session' }), context);

    expect(response.status).toBe(200);
    expect(containerGroups.beginCreateOrUpdate).not.toHaveBeenCalled();
    expect(response.jsonBody.ip).toBe('5.6.7.8');
  });
});
