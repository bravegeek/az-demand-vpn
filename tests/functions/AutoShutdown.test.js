'use strict';

jest.mock('../../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  getTableClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

jest.mock('@azure/functions', () => ({
  app: { timer: jest.fn() },
}));

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient } = require('../../src/functions/shared/azureClient');
require('../../src/functions/AutoShutdown/index');

const handler = app.timer.mock.calls[0][1].handler;

const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

const makeGroup = (name, startTime, provisioningState = 'Succeeded') => ({
  name,
  properties: {
    provisioningState,
    containers: [{ properties: { instanceView: { currentState: { startTime } } } }],
  },
});

async function* mockGroupList(groups) {
  for (const g of groups) yield g;
}

describe('AutoShutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VPN_IDLE_TIMEOUT_MINUTES = '30';
  });

  it('reaps container when lastHandshakeAt is past the idle timeout', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getContainerClient.mockReturnValue({
      containerGroups: {
        listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([makeGroup('vpn-old-session', oldTime)])),
        beginDelete: jest.fn().mockResolvedValue(deletePoller),
      },
    });
    const tableClient = {
      getEntity: jest.fn().mockResolvedValue({ lastHandshakeAt: oldTime, peerAddress: '10.8.0.2' }),
      deleteEntity: jest.fn().mockResolvedValue({}),
    };
    getTableClient.mockReturnValue(tableClient);
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn().mockResolvedValue({}) }),
    });

    await handler({}, context);

    expect(getContainerClient().containerGroups.beginDelete).toHaveBeenCalledWith('test-rg', 'vpn-old-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('sessions', 'old-session');
    expect(tableClient.deleteEntity).toHaveBeenCalledWith('addresses', '10.8.0.2');
  });

  it('spares container when lastHandshakeAt is within the idle timeout', async () => {
    getContainerClient.mockReturnValue({
      containerGroups: {
        listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([makeGroup('vpn-active-session', oldTime)])),
        beginDelete: jest.fn(),
      },
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ lastHandshakeAt: recentTime }),
      deleteEntity: jest.fn(),
    });
    getSecretClient.mockReturnValue({});

    await handler({}, context);

    expect(getContainerClient().containerGroups.beginDelete).not.toHaveBeenCalled();
  });

  it('falls back to container start time when no sessions row exists (legacy session)', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getContainerClient.mockReturnValue({
      containerGroups: {
        listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([makeGroup('vpn-legacy-session', oldTime)])),
        beginDelete: jest.fn().mockResolvedValue(deletePoller),
      },
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
      deleteEntity: jest.fn().mockResolvedValue({}),
    });
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn().mockResolvedValue({}) }),
    });

    await handler({}, context);

    // Reaped via start-time fallback
    expect(getContainerClient().containerGroups.beginDelete).toHaveBeenCalledWith('test-rg', 'vpn-legacy-session');
  });

  it('continues processing remaining groups when one delete fails', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getContainerClient.mockReturnValue({
      containerGroups: {
        listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([
          makeGroup('vpn-fail-session', oldTime),
          makeGroup('vpn-ok-session', oldTime),
        ])),
        beginDelete: jest.fn()
          .mockRejectedValueOnce(new Error('Delete failed'))
          .mockResolvedValueOnce(deletePoller),
      },
    });
    getTableClient.mockReturnValue({
      getEntity: jest.fn().mockResolvedValue({ lastHandshakeAt: oldTime, peerAddress: '10.8.0.2' }),
      deleteEntity: jest.fn().mockResolvedValue({}),
    });
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue({ pollUntilDone: jest.fn().mockResolvedValue({}) }),
    });

    await handler({}, context);

    expect(getContainerClient().containerGroups.beginDelete).toHaveBeenCalledTimes(2);
    expect(context.error).toHaveBeenCalledWith(
      expect.stringContaining('vpn-fail-session'),
      expect.any(String)
    );
  });
});
