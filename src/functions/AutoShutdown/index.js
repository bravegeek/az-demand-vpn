'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient, RESOURCE_GROUP } = require('../shared/azureClient');

const IDLE_TIMEOUT_MINUTES = parseInt(process.env.VPN_IDLE_TIMEOUT_MINUTES || '30', 10);

/**
 * Returns true if the container group should be reaped.
 * Uses lastHandshakeAt from the sessions table row when available (heartbeat-based).
 * Falls back to container start time for legacy sessions with no table row.
 * @param {object} group - ACI container group resource
 * @param {import('@azure/data-tables').TableClient} tableClient
 * @returns {Promise<boolean>}
 */
const isIdle = async (group, tableClient) => {
  if (group.properties?.provisioningState !== 'Succeeded') return false;

  const sessionId = group.name.replace(/^vpn-/, '');

  try {
    const entity = await tableClient.getEntity('sessions', sessionId);

    // Prefer lastHandshakeAt (actual peer activity); fall back to createdAt
    const lastActivity = entity.lastHandshakeAt || entity.createdAt;
    if (!lastActivity) return false;

    const idleMinutes = (Date.now() - new Date(lastActivity).getTime()) / 1000 / 60;
    return idleMinutes >= IDLE_TIMEOUT_MINUTES;
  } catch (err) {
    if (err.statusCode === 404) {
      // # Reason: no table row = legacy session created before this change; use start time
      const startTime = group.properties?.containers?.[0]?.properties?.instanceView?.currentState?.startTime;
      if (!startTime) return false;
      const runningMinutes = (Date.now() - new Date(startTime).getTime()) / 1000 / 60;
      return runningMinutes >= IDLE_TIMEOUT_MINUTES;
    }
    throw err;
  }
};

/**
 * AutoShutdown — timer-triggered function that reaps idle VPN container groups.
 * Runs every 5 minutes.
 */
app.timer('AutoShutdown', {
  schedule: '0 */5 * * * *',
  handler: async (_timer, context) => {
    const containerClient = getContainerClient();
    const secretClient = getSecretClient();
    const tableClient = getTableClient();

    context.log(`AutoShutdown running. Idle timeout: ${IDLE_TIMEOUT_MINUTES} minutes.`);

    let reaped = 0;
    let errors = 0;

    try {
      const groups = containerClient.containerGroups.listByResourceGroup(RESOURCE_GROUP);

      for await (const group of groups) {
        if (!group.name?.startsWith('vpn-')) continue;

        if (!await isIdle(group, tableClient)) continue;

        const sessionId = group.name.replace(/^vpn-/, '');
        context.log(`Reaping idle container group: ${group.name}`);

        try {
          const poller = await containerClient.containerGroups.beginDelete(RESOURCE_GROUP, group.name);
          await poller.pollUntilDone();

          // Read peerAddress before cleaning up table rows
          let peerAddress = null;
          try {
            const sessionRow = await tableClient.getEntity('sessions', sessionId);
            peerAddress = sessionRow.peerAddress;
          } catch (_) { /* no row — skip address cleanup */ }

          // Clean up secrets and table rows
          const cleanupTasks = [
            secretClient.beginDeleteSecret(`wg-peer-config-${sessionId}`).catch(() => {}),
            secretClient.beginDeleteSecret(`wg-server-key-${sessionId}`).catch(() => {}),
            tableClient.deleteEntity('sessions', sessionId).catch(() => {}),
          ];
          if (peerAddress) {
            cleanupTasks.push(tableClient.deleteEntity('addresses', peerAddress).catch(() => {}));
          }
          await Promise.allSettled(cleanupTasks);

          reaped++;
        } catch (err) {
          // # Reason: one failure must not halt the batch — other containers should still be reaped
          context.error(`Failed to delete ${group.name}:`, err.message);
          errors++;
        }
      }
    } catch (err) {
      context.error('AutoShutdown listing failed:', err);
      return;
    }

    context.log(`AutoShutdown complete. Reaped: ${reaped}, Errors: ${errors}.`);
  },
});
