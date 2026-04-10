'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, RESOURCE_GROUP } = require('../shared/azureClient');

const WIREGUARD_PORT = parseInt(process.env.VPN_WIREGUARD_PORT || '51820', 10);

/**
 * CheckVPNStatus — returns current state of the ACI container group for a session.
 * GET /api/CheckVPNStatus?sessionId=<id>
 */
app.http('CheckVPNStatus', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async (request, context) => {
    const sessionId = request.query.get('sessionId');

    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: 'sessionId query parameter is required' }) };
    }

    const containerClient = getContainerClient();
    const containerGroupName = `vpn-${sessionId}`;

    try {
      let group;
      try {
        group = await containerClient.containerGroups.get(RESOURCE_GROUP, containerGroupName);
      } catch (err) {
        if (err.statusCode === 404) {
          return { status: 404, jsonBody: { status: 'NotFound', sessionId } };
        }
        throw err;
      }

      const provisioningState = group.properties?.provisioningState;
      const ip = group.properties?.ipAddress?.ip || null;

      // ACI provisioning states: Creating, Updating, Scaling, Failed, Succeeded, Canceled
      const status = provisioningState === 'Succeeded' ? 'Running' : 'Provisioning';

      return {
        status: 200,
        jsonBody: { status, ip, port: status === 'Running' ? WIREGUARD_PORT : null, sessionId },
      };
    } catch (err) {
      context.error('CheckVPNStatus failed:', err);
      return {
        status: 503,
        body: JSON.stringify({ error: 'Failed to check VPN status', details: err.message }),
      };
    }
  },
});
