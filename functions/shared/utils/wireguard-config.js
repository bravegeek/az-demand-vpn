/**
 * WireGuard Configuration Generator
 * Generates WireGuard .conf file content for server and client
 */

const DEFAULT_DNS_SERVERS = ['8.8.8.8', '8.8.4.4'];
const DEFAULT_ALLOWED_IPS = '0.0.0.0/0';
const DEFAULT_PORT = 51820;
const DEFAULT_KEEPALIVE = 25;

/**
 * Generate WireGuard server configuration
 * @param {Object} serverKeys - { privateKey, publicKey }
 * @param {string} serverAddress - Server IP address in VPN subnet (e.g., 10.8.0.1/24)
 * @param {number} port - WireGuard port (default: 51820)
 * @returns {string} Server configuration content
 */
function generateServerConfig(serverKeys, serverAddress, port = DEFAULT_PORT) {
  return `[Interface]
Address = ${serverAddress}
PrivateKey = ${serverKeys.privateKey}
ListenPort = ${port}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
`;
}

/**
 * Generate WireGuard client configuration
 * @param {Object} clientKeys - { privateKey, publicKey }
 * @param {string} clientIP - Client IP address (e.g., 10.8.0.2/32)
 * @param {string} serverEndpoint - Server endpoint (IP:port)
 * @param {string} serverPublicKey - Server's public key
 * @param {Object} options - Additional options
 * @returns {string} Client configuration content
 */
function generateClientConfig(clientKeys, clientIP, serverEndpoint, serverPublicKey, options = {}) {
  const allowedIPs = options.allowedIPs || DEFAULT_ALLOWED_IPS;
  const dnsServers = options.dnsServers || DEFAULT_DNS_SERVERS;
  const persistentKeepalive = options.persistentKeepalive || DEFAULT_KEEPALIVE;

  const dnsLine = dnsServers && dnsServers.length > 0
    ? `DNS = ${dnsServers.join(', ')}\n`
    : '';

  return `[Interface]
PrivateKey = ${clientKeys.privateKey}
Address = ${clientIP}
${dnsLine}
[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverEndpoint}
AllowedIPs = ${allowedIPs}
PersistentKeepalive = ${persistentKeepalive}
`;
}

/**
 * Add peer to server configuration
 * @param {string} serverConfig - Existing server configuration
 * @param {string} clientPublicKey - Client's public key
 * @param {string} clientIP - Client IP address (e.g., 10.8.0.2/32)
 * @returns {string} Updated server configuration
 */
function addPeerToServerConfig(serverConfig, clientPublicKey, clientIP) {
  const peerSection = `
[Peer]
PublicKey = ${clientPublicKey}
AllowedIPs = ${clientIP}
`;

  return serverConfig + peerSection;
}

/**
 * Validate WireGuard key format
 * @param {string} key - Key to validate
 * @returns {boolean}
 */
function isValidWireGuardKey(key) {
  // WireGuard keys are 44-character base64 strings
  const base64Regex = /^[A-Za-z0-9+/]{43}=$/;
  return base64Regex.test(key);
}

/**
 * Validate endpoint format (IP:port)
 * @param {string} endpoint - Endpoint to validate
 * @returns {boolean}
 */
function isValidEndpoint(endpoint) {
  const parts = endpoint.split(':');
  if (parts.length !== 2) return false;

  const [ip, port] = parts;

  // Basic IPv4 validation
  const ipParts = ip.split('.');
  if (ipParts.length !== 4) return false;

  if (!ipParts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  })) return false;

  // Port validation
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Parse WireGuard configuration file
 * @param {string} configContent - Configuration file content
 * @returns {Object} Parsed configuration
 */
function parseWireGuardConfig(configContent) {
  const lines = configContent.split('\n');
  const config = {
    interface: {},
    peers: []
  };

  let currentSection = null;
  let currentPeer = null;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // Check for section headers
    if (trimmedLine === '[Interface]') {
      currentSection = 'interface';
      continue;
    }

    if (trimmedLine === '[Peer]') {
      currentSection = 'peer';
      currentPeer = {};
      config.peers.push(currentPeer);
      continue;
    }

    // Parse key-value pairs
    const [key, ...valueParts] = trimmedLine.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      const keyTrimmed = key.trim();

      if (currentSection === 'interface') {
        config.interface[keyTrimmed] = value;
      } else if (currentSection === 'peer' && currentPeer) {
        currentPeer[keyTrimmed] = value;
      }
    }
  }

  return config;
}

module.exports = {
  generateServerConfig,
  generateClientConfig,
  addPeerToServerConfig,
  isValidWireGuardKey,
  isValidEndpoint,
  parseWireGuardConfig,
  DEFAULT_DNS_SERVERS,
  DEFAULT_ALLOWED_IPS,
  DEFAULT_PORT,
  DEFAULT_KEEPALIVE
};
