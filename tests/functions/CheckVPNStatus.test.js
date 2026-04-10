'use strict';

jest.mock('../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

const { getContainerClient } = require('../src/functions/shared/azureClient');

let handler;
beforeAll(() => {
  const mockApp = { http: jest.fn((name, opts) => { handler = opts.handler; }) };
  jest.mock('@azure/functions', () => ({ app: mockApp }));
  require('../src/functions/CheckVPNStatus/index');
});

const makeRequest = (sessionId) => ({
  json: () => Promise.resolve({}),
  query: { get: (key) => (key === 'sessionId' ? sessionId : null) },
});
const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

describe('CheckVPNStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns Running status with IP when container group is succeeded', async () => {
    const containerGroups = {
      get: jest.fn().mockResolvedValue({
        properties: {
          provisioningState: 'Succeeded',
          ipAddress: { ip: '10.0.1.5' },
        },
      }),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const response = await handler(makeRequest('running-session'), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody.status).toBe('Running');
    expect(response.jsonBody.ip).toBe('10.0.1.5');
    expect(response.jsonBody.port).toBe(51820);
  });

  it('returns Provisioning status with null IP while container group is creating', async () => {
    const containerGroups = {
      get: jest.fn().mockResolvedValue({
        properties: { provisioningState: 'Creating', ipAddress: null },
      }),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const response = await handler(makeRequest('creating-session'), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody.status).toBe('Provisioning');
    expect(response.jsonBody.ip).toBeNull();
    expect(response.jsonBody.port).toBeNull();
  });

  it('returns 404 when no container group exists for the session', async () => {
    const containerGroups = {
      get: jest.fn().mockRejectedValue({ statusCode: 404 }),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const response = await handler(makeRequest('missing-session'), context);

    expect(response.status).toBe(404);
    expect(response.jsonBody.status).toBe('NotFound');
  });
});
