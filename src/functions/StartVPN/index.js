'use strict';

const { generateKeyPairSync, createPublicKey } = require('crypto');
const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, RESOURCE_GROUP } = require('../shared/azureClient');

const WIREGUARD_PORT = parseInt(process.env.VPN_WIREGUARD_PORT || '51820', 10);
const CONTAINER_IMAGE = process.env.VPN_CONTAINER_IMAGE || 'ghcr.io/<your-github-org>/az-demand-vpn-wg:latest';
const STORAGE_ACCOUNT_NAME = process.env.StorageAccountName;
const VPN_SUBNET_ID = process.env.VPN_SUBNET_ID;
const IDLE_TIMEOUT_MINUTES = parseInt(process.env.VPN_IDLE_TIMEOUT_MINUTES || '30', 10);

// ACI container group name rules: lowercase alphanumeric + hyphens, start with letter, 1-63 chars
const SESSION_ID_RE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$/;

/**
 * Generates a valid WireGuard key pair using Node.js built-in X25519 (Curve25519).
 * Returns base64-encoded raw 32-byte keys compatible with wg(8).
 * @returns {{ privateKey: string, publicKey: string }}
 */
const generateWireGuardKeyPair = () => {
  const { privateKey: privKeyObj } = generateKeyPairSync('x25519');
  const pubKeyObj = createPublicKey(privKeyObj);
  // PKCS8 DER: 16-byte header + 32-byte raw key; SPKI DER: 12-byte header + 32-byte raw key
  const privDer = privKeyObj.export({ type: 'pkcs8', format: 'der' });
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  return {
    privateKey: privDer.slice(-32).toString('base64'),
    publicKey: pubDer.slice(-32).toString('base64'),
  };
};

/**
 * Builds the ACI container group spec for a WireGuard VPN session.
 * @param {string} sessionId
 * @param {string} location
 * @param {string} serverPrivateKey
 * @returns {object}
 */
const buildContainerGroupSpec = (sessionId, location, serverPrivateKey) => ({
  location,
  identity: { type: 'SystemAssigned' },
  properties: {
    containers: [
      {
        name: 'vpn-server',
        properties: {
          image: CONTAINER_IMAGE,
          resources: { requests: { cpu: 1, memoryInGB: 2 } },
          ports: [{ port: WIREGUARD_PORT, protocol: 'UDP' }],
          environmentVariables: [
            { name: 'WG_SERVER_PRIVATE_KEY', secureValue: serverPrivateKey },
            { name: 'WG_SERVER_PORT', value: String(WIREGUARD_PORT) },
            { name: 'STORAGE_ACCOUNT', value: STORAGE_ACCOUNT_NAME },
            { name: 'IDLE_TIMEOUT_MINUTES', value: String(IDLE_TIMEOUT_MINUTES) },
          ],
        },
      },
    ],
    osType: 'Linux',
    restartPolicy: 'Never',
    ipAddress: {
      type: 'Public',
      ports: [{ protocol: 'UDP', port: WIREGUARD_PORT }],
      dnsNameLabel: `vpn-${sessionId}`,
    },
    subnetIds: VPN_SUBNET_ID ? [{ id: VPN_SUBNET_ID }] : [],
  },
});

/**
 * StartVPN — creates an on-demand ACI WireGuard container and returns client config.
 * POST /api/StartVPN
 * Body: { sessionId: string, location?: string }
 */
app.http('StartVPN', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const body = await request.json().catch(() => ({}));
    const { sessionId, location = 'eastus2' } = body;

    if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
      return {
        status: 400,
        body: JSON.stringify({
          error: 'sessionId must be 1-63 lowercase alphanumeric characters and hyphens, starting with a letter',
        }),
      };
    }

    const containerClient = getContainerClient();
    const secretClient = getSecretClient();
    const containerGroupName = `vpn-${sessionId}`;

    try {
      // Return existing session without creating a new container (idempotent)
      let existing = null;
      try {
        existing = await containerClient.containerGroups.get(RESOURCE_GROUP, containerGroupName);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }

      if (existing) {
        const ip = existing.properties?.ipAddress?.ip;
        const secret = await secretClient.getSecret(`wg-peer-config-${sessionId}`).catch(() => null);
        return {
          status: 200,
          jsonBody: { status: 'Running', ip, port: WIREGUARD_PORT, clientConfig: secret?.value || null },
        };
      }

      // Generate a fresh Curve25519 key pair for this session's server
      const { privateKey: serverPrivateKey, publicKey: serverPublicKey } = generateWireGuardKeyPair();

      await secretClient.setSecret(`wg-server-key-${sessionId}`, serverPrivateKey, {
        contentType: 'text/plain',
      });

      let result;
      try {
        const poller = await containerClient.containerGroups.beginCreateOrUpdate(
          RESOURCE_GROUP,
          containerGroupName,
          buildContainerGroupSpec(sessionId, location, serverPrivateKey)
        );
        result = await poller.pollUntilDone();
      } catch (err) {
        // Clean up orphan server key if ACI creation fails
        await secretClient.beginDeleteSecret(`wg-server-key-${sessionId}`).catch(() => {});
        throw err;
      }

      const ip = result.properties?.ipAddress?.ip;

      // TODO (peer-address-allocation): peerAddress is hardcoded — breaks multi-user.
      // Needs a per-session allocation scheme tracked in Storage Table.
      const peerAddress = '10.8.0.2/32';
      const clientConfig = [
        '[Interface]',
        `Address = ${peerAddress}`,
        'DNS = 1.1.1.1',
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

      return { status: 200, jsonBody: { status: 'Running', ip, port: WIREGUARD_PORT, clientConfig } };
    } catch (err) {
      context.error('StartVPN failed:', err);
      return { status: 503, body: JSON.stringify({ error: 'Failed to start VPN', details: err.message }) };
    }
  },
});
