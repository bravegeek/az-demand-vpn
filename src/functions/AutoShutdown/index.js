'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, RESOURCE_GROUP } = require('../shared/azureClient');

const IDLE_TIMEOUT_MINUTES = parseInt(process.env.VPN_IDLE_TIMEOUT_MINUTES || '30', 10);

/**
 * Returns true if the container group has been running past the idle timeout
 * and has no active WireGuard peer connections.
 *
 * ACI does not expose WireGuard peer state directly — we approximate idleness
 * by elapsed time since provisioning. A future improvement would query the
 * container's logs or a sidecar metrics endpoint for actual peer activity.
 *
 * @param {object} group - ACI container group resource
 * @returns {boolean}
 */
const isIdle = (group) => {
  if (group.properties?.provisioningState !== 'Succeeded') return false;

  const startTime = group.properties?.containers?.[0]?.properties?.instanceView?.currentState?.startTime;
  if (!startTime) return false;

  const runningMinutes = (Date.now() - new Date(startTime).getTime()) / 1000 / 60;
  return runningMinutes >= IDLE_TIMEOUT_MINUTES;
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

    context.log(`AutoShutdown running. Idle timeout: ${IDLE_TIMEOUT_MINUTES} minutes.`);

    let reaped = 0;
    let errors = 0;

    try {
      const groups = containerClient.containerGroups.listByResourceGroup(RESOURCE_GROUP);

      for await (const group of groups) {
        // Only process VPN container groups created by StartVPN
        if (!group.name?.startsWith('vpn-')) continue;

        if (!isIdle(group)) continue;

        const sessionId = group.name.replace(/^vpn-/, '');
        context.log(`Reaping idle container group: ${group.name}`);

        try {
          const poller = await containerClient.containerGroups.beginDelete(RESOURCE_GROUP, group.name);
          await poller.pollUntilDone();

          // Clean up Key Vault secrets
          for (const secretName of [`wg-peer-config-${sessionId}`, `wg-server-key-${sessionId}`]) {
            try {
              const delPoller = await secretClient.beginDeleteSecret(secretName);
              await delPoller.pollUntilDone();
            } catch (err) {
              context.warn(`Could not delete secret ${secretName}:`, err.message);
            }
          }

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
