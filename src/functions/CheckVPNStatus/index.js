'use strict';

const { createPublicKey } = require('crypto');
const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient, RESOURCE_GROUP } = require('../shared/azureClient');

const WIREGUARD_PORT = parseInt(process.env.VPN_WIREGUARD_PORT || '51820', 10);
const VPN_DNS_SERVER = process.env.VPN_DNS_SERVER || '1.1.1.1';

/**
 * Derives a base64 WireGuard public key from a base64 private key.
 * @param {string} privateKeyBase64
 * @returns {string}
 */
const derivePublicKey = (privateKeyBase64) => {
  // Reconstruct PKCS8 DER from raw 32-byte private key
  const rawPriv = Buffer.from(privateKeyBase64, 'base64');
  const pkcs8Header = Buffer.from('302e020100300506032b656e04220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, rawPriv]);
  const privKeyObj = require('crypto').createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const pubKeyObj = createPublicKey(privKeyObj);
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  return pubDer.slice(-32).toString('base64');
};

/**
 * CheckVPNStatus — returns current state of the ACI container group for a session.
 * On first 'Running' read, finalizes the client config from the stored server key.
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
    const secretClient = getSecretClient();
    const tableClient = getTableClient();
    const containerGroupName = `vpn-${sessionId}`;

    try {
      // Read ACI state
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

      // Read sessions table row for canonical status
      let sessionRow = null;
      try {
        sessionRow = await tableClient.getEntity('sessions', sessionId);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
        // No table row — legacy session or race; fall through to ACI state only
      }

      // If sessions row exists and already marked Running, return cached config
      if (sessionRow?.status === 'Running') {
        const secret = await secretClient.getSecret(`wg-peer-config-${sessionId}`).catch(() => null);
        return {
          status: 200,
          jsonBody: { status: 'Running', ip, port: WIREGUARD_PORT, clientConfig: secret?.value || null, sessionId },
        };
      }

      // Not yet running
      if (provisioningState !== 'Succeeded') {
        return { status: 200, jsonBody: { status: 'Provisioning', ip: null, port: null, sessionId } };
      }

      // ACI is Succeeded — finalize: derive public key, build config, cache in KV
      const peerAddress = sessionRow?.peerAddress || '10.8.0.2'; // fallback for legacy sessions

      const serverKeySecret = await secretClient.getSecret(`wg-server-key-${sessionId}`);
      const serverPublicKey = derivePublicKey(serverKeySecret.value);

      const clientConfig = [
        '[Interface]',
        `Address = ${peerAddress}/32`,
        `DNS = ${VPN_DNS_SERVER}`,
        '',
        '[Peer]',
        `PublicKey = ${serverPublicKey}`,
        `Endpoint = ${ip}:${WIREGUARD_PORT}`,
        'AllowedIPs = 0.0.0.0/0, ::/0',
        'PersistentKeepalive = 25',
      ].join('\n');

      await secretClient.setSecret(`wg-peer-config-${sessionId}`, clientConfig, {
        contentType: 'text/plain',
      });

      // Update sessions row status to 'Running' with ETag conditional update
      // If a concurrent CheckVPNStatus already did this, the 412 is non-fatal
      if (sessionRow) {
        try {
          await tableClient.updateEntity(
            { partitionKey: 'sessions', rowKey: sessionId, status: 'Running' },
            'Merge',
            { etag: sessionRow.etag }
          );
        } catch (err) {
          if (err.statusCode !== 412) throw err;
          // 412 = concurrent finalization already completed; safe to continue
        }
      }

      return {
        status: 200,
        jsonBody: { status: 'Running', ip, port: WIREGUARD_PORT, clientConfig, sessionId },
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
