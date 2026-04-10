'use strict';

const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, RESOURCE_GROUP } = require('../shared/azureClient');

const WIREGUARD_PORT = parseInt(process.env.VPN_WIREGUARD_PORT || '51820', 10);
const CONTAINER_IMAGE = process.env.VPN_CONTAINER_IMAGE || 'ghcr.io/<your-github-org>/az-demand-vpn-wg:latest';
const STORAGE_ACCOUNT_NAME = process.env.StorageAccountName;
const VPN_SUBNET_ID = process.env.VPN_SUBNET_ID;
const IDLE_TIMEOUT_MINUTES = parseInt(process.env.VPN_IDLE_TIMEOUT_MINUTES || '30', 10);

/**
 * Builds the ACI container group spec for a WireGuard VPN session.
 * @param {string} sessionId
 * @param {string} location
 * @param {string} serverPrivateKey
 * @returns {object} ACI ContainerGroup spec
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
          ports: [
            { port: WIREGUARD_PORT, protocol: 'UDP' },
            { port: 443, protocol: 'TCP' },
          ],
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
      ports: [
        { protocol: 'UDP', port: WIREGUARD_PORT },
        { protocol: 'TCP', port: 443 },
      ],
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

    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: 'sessionId is required' }) };
    }

    const containerClient = getContainerClient();
    const secretClient = getSecretClient();
    const containerGroupName = `vpn-${sessionId}`;

    try {
      // Check if a container group already exists for this session
      let existing = null;
      try {
        existing = await containerClient.containerGroups.get(RESOURCE_GROUP, containerGroupName);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }

      if (existing) {
        const ip = existing.properties?.ipAddress?.ip;
        const secretName = `wg-peer-config-${sessionId}`;
        const secret = await secretClient.getSecret(secretName).catch(() => null);
        return {
          status: 200,
          body: JSON.stringify({
            status: 'Running',
            ip,
            port: WIREGUARD_PORT,
            clientConfig: secret?.value || null,
          }),
        };
      }

      // Retrieve server private key from Key Vault (pre-generated and stored during provisioning)
      const serverKeySecret = await secretClient.getSecret(`wg-server-key-${sessionId}`).catch(() => null);
      const serverPrivateKey = serverKeySecret?.value || generateWireGuardKey();

      // Store key if newly generated
      if (!serverKeySecret) {
        await secretClient.setSecret(`wg-server-key-${sessionId}`, serverPrivateKey, {
          contentType: 'text/plain',
        });
      }

      // Create the ACI container group
      const spec = buildContainerGroupSpec(sessionId, location, serverPrivateKey);
      const poller = await containerClient.containerGroups.beginCreateOrUpdate(
        RESOURCE_GROUP,
        containerGroupName,
        spec
      );
      const result = await poller.pollUntilDone();

      const ip = result.properties?.ipAddress?.ip;

      // Generate and store peer config
      const serverPublicKey = derivePublicKey(serverPrivateKey); // # Reason: placeholder — real impl uses wg pubkey via child_process or pre-computed
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

      return {
        status: 200,
        jsonBody: { status: 'Running', ip, port: WIREGUARD_PORT, clientConfig },
      };
    } catch (err) {
      context.error('StartVPN failed:', err);
      return {
        status: 503,
        body: JSON.stringify({ error: 'Failed to start VPN', details: err.message }),
      };
    }
  },
});

// Placeholder — production implementation should derive the public key using
// the wg CLI (child_process.execSync) or accept it as a pre-computed input.
const derivePublicKey = (privateKey) => `pubkey-for-${privateKey.slice(0, 8)}`;

// Placeholder — production implementation should call `wg genkey` via child_process.
const generateWireGuardKey = () => Buffer.from(crypto.randomBytes(32)).toString('base64');

// eslint-disable-next-line no-undef
const crypto = require('crypto');
