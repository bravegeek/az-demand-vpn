'use strict';

const { generateKeyPairSync, createPublicKey } = require('crypto');
const { app } = require('@azure/functions');
const { getContainerClient, getSecretClient, getTableClient, RESOURCE_GROUP } = require('../shared/azureClient');

const WIREGUARD_PORT = parseInt(process.env.VPN_WIREGUARD_PORT || '51820', 10);
const IDLE_TIMEOUT_MINUTES = parseInt(process.env.VPN_IDLE_TIMEOUT_MINUTES || '30', 10);

// Fail fast — these are required and set by Bicep; no sensible fallback exists
const REQUIRED = ['VPN_CONTAINER_IMAGE', 'StorageAccountName', 'VPN_SUBNET_ID', 'VPN_TUNNEL_SUBNET', 'VPN_CONTAINER_IDENTITY_ID'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

const CONTAINER_IMAGE = process.env.VPN_CONTAINER_IMAGE;
const STORAGE_ACCOUNT_NAME = process.env.StorageAccountName;
const VPN_SUBNET_ID = process.env.VPN_SUBNET_ID;
const CONTAINER_IDENTITY_ID = process.env.VPN_CONTAINER_IDENTITY_ID;
const VPN_DNS_SERVER = process.env.VPN_DNS_SERVER || '1.1.1.1';

// Derive tunnel addressing from VPN_TUNNEL_SUBNET (e.g. '10.8.0.0/24')
const VPN_TUNNEL_SUBNET = process.env.VPN_TUNNEL_SUBNET;
const [subnetBase, cidr] = VPN_TUNNEL_SUBNET.split('/');
const subnetOctets = subnetBase.split('.');
const SERVER_ADDRESS = `${subnetOctets.slice(0, 3).join('.')}.1/${cidr}`;
const POOL_BASE = subnetOctets.slice(0, 3).join('.');

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
 * Allocates the next free peer address from the tunnel pool using the 'addresses'
 * partition as an atomic lock. Retries on 409 (lost race to concurrent caller).
 * @param {import('@azure/data-tables').TableClient} tableClient
 * @param {string} poolBase - e.g. '10.8.0'
 * @param {string} sessionId
 * @returns {Promise<string|null>} allocated address (without CIDR), or null if pool exhausted
 */
const allocatePeerAddress = async (tableClient, poolBase, sessionId) => {
  const entities = tableClient.listEntities({
    queryOptions: { filter: "PartitionKey eq 'addresses'" },
  });
  const used = new Set();
  for await (const entity of entities) {
    used.add(entity.rowKey);
  }

  for (let i = 2; i <= 254; i++) {
    const addr = `${poolBase}.${i}`;
    if (used.has(addr)) continue;
    try {
      await tableClient.createEntity({ partitionKey: 'addresses', rowKey: addr, sessionId });
      return addr;
    } catch (err) {
      if (err.statusCode === 409) continue; // lost race — try next address
      throw err;
    }
  }
  return null; // pool exhausted
};

/**
 * Writes the sessions table row with status 'Provisioning'.
 * @param {import('@azure/data-tables').TableClient} tableClient
 * @param {string} sessionId
 * @param {string} peerAddress
 */
const writeSessionRow = async (tableClient, sessionId, peerAddress) => {
  await tableClient.createEntity({
    partitionKey: 'sessions',
    rowKey: sessionId,
    peerAddress,
    status: 'Provisioning',
    createdAt: new Date().toISOString(),
  });
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
  identity: {
    type: 'UserAssigned',
    userAssignedIdentities: { [CONTAINER_IDENTITY_ID]: {} },
  },
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
            { name: 'WG_SERVER_ADDRESS', value: SERVER_ADDRESS },
            { name: 'WG_SERVER_PORT', value: String(WIREGUARD_PORT) },
            { name: 'SESSION_ID', value: sessionId },
            { name: 'STORAGE_ACCOUNT', value: STORAGE_ACCOUNT_NAME },
            { name: 'STORAGE_TABLE_ENDPOINT', value: process.env.STORAGE_TABLE_ENDPOINT },
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
 * StartVPN — provisions an on-demand ACI WireGuard container asynchronously.
 * Returns 202 Accepted immediately; caller polls CheckVPNStatus for readiness.
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
    const tableClient = getTableClient();
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

      // Allocate a unique peer address from the tunnel pool
      const peerAddress = await allocatePeerAddress(tableClient, POOL_BASE, sessionId);
      if (!peerAddress) {
        return { status: 503, body: JSON.stringify({ error: 'VPN address pool exhausted' }) };
      }

      // Generate a fresh Curve25519 key pair for this session's server
      const { privateKey: serverPrivateKey } = generateWireGuardKeyPair();

      await secretClient.setSecret(`wg-server-key-${sessionId}`, serverPrivateKey, {
        contentType: 'text/plain',
      });

      // Write sessions row before launching ACI so CheckVPNStatus can find it
      await writeSessionRow(tableClient, sessionId, peerAddress);

      try {
        // Fire-and-forget: do NOT await pollUntilDone — return 202 immediately
        await containerClient.containerGroups.beginCreateOrUpdate(
          RESOURCE_GROUP,
          containerGroupName,
          buildContainerGroupSpec(sessionId, location, serverPrivateKey)
        );
      } catch (err) {
        // Clean up all three artifacts on ACI launch failure
        await Promise.allSettled([
          secretClient.beginDeleteSecret(`wg-server-key-${sessionId}`),
          tableClient.deleteEntity('sessions', sessionId),
          tableClient.deleteEntity('addresses', peerAddress),
        ]);
        throw err;
      }

      return { status: 202, jsonBody: { status: 'Provisioning', sessionId } };
    } catch (err) {
      context.error('StartVPN failed:', err);
      return { status: 503, body: JSON.stringify({ error: 'Failed to start VPN', details: err.message }) };
    }
  },
});
