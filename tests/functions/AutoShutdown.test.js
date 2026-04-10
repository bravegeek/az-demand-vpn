'use strict';

jest.mock('../../src/functions/shared/azureClient', () => ({
  getContainerClient: jest.fn(),
  getSecretClient: jest.fn(),
  RESOURCE_GROUP: 'test-rg',
}));

jest.mock('@azure/functions', () => ({
  app: { timer: jest.fn() },
}));

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient } = require('../../src/functions/shared/azureClient');
require('../../src/functions/AutoShutdown/index');

const handler = app.timer.mock.calls[0][1].handler;

const context = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

const makeGroup = (name, startTime, provisioningState = 'Succeeded') => ({
  name,
  properties: {
    provisioningState,
    containers: [{
      properties: {
        instanceView: {
          currentState: { startTime },
        },
      },
    }],
  },
});

const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

async function* mockGroupList(groups) {
  for (const g of groups) yield g;
}

describe('AutoShutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VPN_IDLE_TIMEOUT_MINUTES = '30';
  });

  it('deletes idle container groups past the timeout', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const containerGroups = {
      listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([
        makeGroup('vpn-old-session', oldTime),
      ])),
      beginDelete: jest.fn().mockResolvedValue(deletePoller),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretDeletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue(secretDeletePoller),
    });

    await handler({}, context);

    expect(containerGroups.beginDelete).toHaveBeenCalledWith('test-rg', 'vpn-old-session');
  });

  it('does not delete container groups that are still within the idle timeout', async () => {
    const containerGroups = {
      listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([
        makeGroup('vpn-new-session', recentTime),
      ])),
      beginDelete: jest.fn(),
    };
    getContainerClient.mockReturnValue({ containerGroups });
    getSecretClient.mockReturnValue({});

    await handler({}, context);

    expect(containerGroups.beginDelete).not.toHaveBeenCalled();
  });

  it('continues processing remaining groups when one delete fails', async () => {
    const deletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    const containerGroups = {
      listByResourceGroup: jest.fn().mockReturnValue(mockGroupList([
        makeGroup('vpn-fail-session', oldTime),
        makeGroup('vpn-ok-session', oldTime),
      ])),
      beginDelete: jest.fn()
        .mockRejectedValueOnce(new Error('Delete failed'))
        .mockResolvedValueOnce(deletePoller),
    };
    getContainerClient.mockReturnValue({ containerGroups });

    const secretDeletePoller = { pollUntilDone: jest.fn().mockResolvedValue({}) };
    getSecretClient.mockReturnValue({
      beginDeleteSecret: jest.fn().mockResolvedValue(secretDeletePoller),
    });

    await handler({}, context);

    // Both containers attempted; first failed, second succeeded
    expect(containerGroups.beginDelete).toHaveBeenCalledTimes(2);
    expect(context.error).toHaveBeenCalledWith(
      expect.stringContaining('vpn-fail-session'),
      expect.any(String)
    );
  });
});
