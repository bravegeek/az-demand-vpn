'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient, RESOURCE_GROUP } = require('../shared/azureClient');

/**
 * StopVPN — deletes the ACI container group and removes session state.
 * DELETE /api/StopVPN
 * Body: { sessionId: string }
 */
app.http('StopVPN', {
  methods: ['DELETE'],
  authLevel: 'function',
  handler: async (request, context) => {
    const body = await request.json().catch(() => ({}));
    const { sessionId } = body;

    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: 'sessionId is required' }) };
    }

    const containerClient = getContainerClient();
    const secretClient = getSecretClient();
    const tableClient = getTableClient();
    const containerGroupName = `vpn-${sessionId}`;

    try {
      // Read sessions row to get peerAddress before deletion
      let peerAddress = null;
      try {
        const sessionRow = await tableClient.getEntity('sessions', sessionId);
        peerAddress = sessionRow.peerAddress;
      } catch (err) {
        if (err.statusCode !== 404) throw err;
        // No table row — legacy session; continue without address cleanup
      }

      // Verify the container group exists
      try {
        await containerClient.containerGroups.get(RESOURCE_GROUP, containerGroupName);
      } catch (err) {
        if (err.statusCode === 404) {
          return { status: 404, body: JSON.stringify({ error: 'VPN session not found' }) };
        }
        throw err;
      }

      // Delete the container group
      const poller = await containerClient.containerGroups.beginDelete(RESOURCE_GROUP, containerGroupName);
      await poller.pollUntilDone();

      // Clean up Key Vault secrets and table rows (best-effort — don't fail stop if cleanup fails)
      const cleanupTasks = [
        secretClient.beginDeleteSecret(`wg-peer-config-${sessionId}`).catch((err) => {
          context.warn(`Could not delete secret wg-peer-config-${sessionId}:`, err.message);
        }),
        secretClient.beginDeleteSecret(`wg-server-key-${sessionId}`).catch((err) => {
          context.warn(`Could not delete secret wg-server-key-${sessionId}:`, err.message);
        }),
        tableClient.deleteEntity('sessions', sessionId).catch((err) => {
          context.warn(`Could not delete sessions row ${sessionId}:`, err.message);
        }),
      ];

      if (peerAddress) {
        cleanupTasks.push(
          tableClient.deleteEntity('addresses', peerAddress).catch((err) => {
            context.warn(`Could not delete addresses row ${peerAddress}:`, err.message);
          })
        );
      }

      await Promise.allSettled(cleanupTasks);

      return { status: 200, jsonBody: { status: 'Stopped', sessionId } };
    } catch (err) {
      context.error('StopVPN failed:', err);
      return {
        status: 503,
        body: JSON.stringify({ error: 'Failed to stop VPN', details: err.message }),
      };
    }
  },
});
