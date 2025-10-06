const QRCode = require('qrcode');

/**
 * QR Code Generator Utility
 * Generates base64-encoded PNG QR codes from WireGuard configuration content
 */

const DEFAULT_QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  type: 'image/png',
  quality: 0.95,
  margin: 1,
  width: 300,
  color: {
    dark: '#000000',
    light: '#FFFFFF'
  }
};

/**
 * Generate QR code from WireGuard configuration
 * @param {string} configContent - WireGuard configuration file content
 * @param {Object} options - QR code options
 * @returns {Promise<string>} Base64-encoded PNG QR code
 */
async function generateQRCode(configContent, options = {}) {
  try {
    const qrOptions = {
      ...DEFAULT_QR_OPTIONS,
      ...options
    };

    // Generate QR code as data URL (base64)
    const dataURL = await QRCode.toDataURL(configContent, qrOptions);

    // Extract base64 part (remove "data:image/png;base64," prefix)
    const base64Data = dataURL.split(',')[1];

    return base64Data;
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
}

/**
 * Generate QR code as buffer (for file saving)
 * @param {string} configContent - WireGuard configuration file content
 * @param {Object} options - QR code options
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateQRCodeBuffer(configContent, options = {}) {
  try {
    const qrOptions = {
      ...DEFAULT_QR_OPTIONS,
      ...options
    };

    return await QRCode.toBuffer(configContent, qrOptions);
  } catch (error) {
    throw new Error(`Failed to generate QR code buffer: ${error.message}`);
  }
}

/**
 * Generate QR code optimized for mobile scanning
 * @param {string} configContent - WireGuard configuration file content
 * @returns {Promise<string>} Base64-encoded PNG QR code
 */
async function generateMobileOptimizedQRCode(configContent) {
  const mobileOptions = {
    errorCorrectionLevel: 'H', // Higher error correction for mobile
    width: 400, // Larger size for better scanning
    margin: 2
  };

  return await generateQRCode(configContent, mobileOptions);
}

/**
 * Validate QR code content size
 * @param {string} content - Content to encode
 * @returns {Object} { valid: boolean, error?: string, size: number }
 */
function validateQRCodeContent(content) {
  const maxSize = 2953; // Max bytes for QR code with error correction level M

  const contentSize = Buffer.byteLength(content, 'utf8');

  if (contentSize > maxSize) {
    return {
      valid: false,
      error: `Content too large for QR code: ${contentSize} bytes (max: ${maxSize})`,
      size: contentSize
    };
  }

  return {
    valid: true,
    size: contentSize
  };
}

/**
 * Generate QR code with validation
 * @param {string} configContent - WireGuard configuration file content
 * @param {Object} options - QR code options
 * @returns {Promise<Object>} { success: boolean, qrCode?: string, error?: string }
 */
async function generateQRCodeSafe(configContent, options = {}) {
  // Validate content size
  const validation = validateQRCodeContent(configContent);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error
    };
  }

  try {
    const qrCode = await generateQRCode(configContent, options);

    return {
      success: true,
      qrCode,
      size: validation.size
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  generateQRCode,
  generateQRCodeBuffer,
  generateMobileOptimizedQRCode,
  validateQRCodeContent,
  generateQRCodeSafe,
  DEFAULT_QR_OPTIONS
};
