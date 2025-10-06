/**
 * Jest Setup File
 * Configures global test environment
 */

// Set default environment variables for tests
process.env.VPN_API_ENDPOINT = process.env.VPN_API_ENDPOINT || 'http://localhost:7071/api';
process.env.TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-12345';

// Add fetch API for Node.js 18+ (native fetch)
// If running on older Node.js, you might need node-fetch
if (typeof global.fetch === 'undefined') {
  console.warn('Fetch API not available. Please ensure Node.js 18+ is installed.');
}

// Suppress console.warn in tests unless explicitly enabled
if (!process.env.SHOW_WARNINGS) {
  global.console.warn = jest.fn();
}

// Set longer timeout for integration tests
jest.setTimeout(30000);
