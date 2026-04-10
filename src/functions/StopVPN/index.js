'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, RESOURCE_GROUP } = require('../shared/azureClient');

/**
 * StopVPN — deletes the ACI container group and removes peer config from Key Vault.
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
    const containerGroupName = `vpn-${sessionId}`;

    try {
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

      // Clean up Key Vault secrets (best-effort — don't fail stop if secret removal fails)
      for (const secretName of [`wg-peer-config-${sessionId}`, `wg-server-key-${sessionId}`]) {
        try {
          const poller = await secretClient.beginDeleteSecret(secretName);
          await poller.pollUntilDone();
        } catch (err) {
          context.warn(`Could not delete secret ${secretName}:`, err.message);
        }
      }

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
