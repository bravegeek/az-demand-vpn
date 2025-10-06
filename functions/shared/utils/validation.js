/**
 * Validation Utilities
 * Input validation functions for VPN provisioning system
 */

/**
 * Validate UUID format
 * @param {string} value - Value to validate
 * @returns {boolean}
 */
function validateUUID(value) {
  if (typeof value !== 'string') return false;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validate IPv4 address format
 * @param {string} value - Value to validate
 * @returns {boolean}
 */
function validateIPv4(value) {
  if (typeof value !== 'string') return false;

  const parts = value.split('.');

  if (parts.length !== 4) return false;

  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Validate idle timeout value
 * @param {number} minutes - Minutes value
 * @param {number} min - Minimum allowed (default: 1)
 * @param {number} max - Maximum allowed (default: 1440)
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateIdleTimeout(minutes, min = 1, max = 1440) {
  if (typeof minutes !== 'number' || isNaN(minutes)) {
    return { valid: false, error: 'Idle timeout must be a number' };
  }

  if (minutes < min || minutes > max) {
    return {
      valid: false,
      error: `Idle timeout must be between ${min} and ${max} minutes`
    };
  }

  return { valid: true };
}

/**
 * Validate session status
 * @param {string} status - Status value
 * @param {string[]} allowedStatuses - Array of allowed statuses
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateSessionStatus(status, allowedStatuses) {
  if (typeof status !== 'string') {
    return { valid: false, error: 'Status must be a string' };
  }

  if (!allowedStatuses.includes(status)) {
    return {
      valid: false,
      error: `Status must be one of: ${allowedStatuses.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Validate quota limits
 * @param {number} current - Current value
 * @param {number} max - Maximum allowed
 * @returns {Object} { valid: boolean, error?: string, remaining: number }
 */
function validateQuota(current, max) {
  if (typeof current !== 'number' || typeof max !== 'number') {
    return { valid: false, error: 'Quota values must be numbers', remaining: 0 };
  }

  if (current >= max) {
    return {
      valid: false,
      error: `Quota limit reached (${current}/${max})`,
      remaining: 0
    };
  }

  return {
    valid: true,
    remaining: max - current
  };
}

/**
 * Validate port number
 * @param {number} port - Port number
 * @param {number} min - Minimum port (default: 1024)
 * @param {number} max - Maximum port (default: 65535)
 * @returns {Object} { valid: boolean, error?: string }
 */
function validatePort(port, min = 1024, max = 65535) {
  if (typeof port !== 'number' || isNaN(port)) {
    return { valid: false, error: 'Port must be a number' };
  }

  if (port < min || port > max) {
    return {
      valid: false,
      error: `Port must be between ${min} and ${max}`
    };
  }

  return { valid: true };
}

/**
 * Validate CIDR notation
 * @param {string} cidr - CIDR string (e.g., 10.8.0.0/24)
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateCIDR(cidr) {
  if (typeof cidr !== 'string') {
    return { valid: false, error: 'CIDR must be a string' };
  }

  const parts = cidr.split('/');

  if (parts.length !== 2) {
    return { valid: false, error: 'CIDR must be in format IP/PREFIX' };
  }

  const [ip, prefix] = parts;

  // Validate IP part
  if (!validateIPv4(ip)) {
    return { valid: false, error: 'Invalid IP address in CIDR' };
  }

  // Validate prefix
  const prefixNum = parseInt(prefix, 10);
  if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
    return { valid: false, error: 'CIDR prefix must be between 0 and 32' };
  }

  return { valid: true };
}

/**
 * Validate email format
 * @param {string} email - Email address
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateEmail(email) {
  if (typeof email !== 'string') {
    return { valid: false, error: 'Email must be a string' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validate string length
 * @param {string} value - String value
 * @param {number} min - Minimum length
 * @param {number} max - Maximum length
 * @param {string} fieldName - Field name for error message
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateStringLength(value, min, max, fieldName = 'Value') {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (value.length < min) {
    return {
      valid: false,
      error: `${fieldName} must be at least ${min} characters`
    };
  }

  if (value.length > max) {
    return {
      valid: false,
      error: `${fieldName} must be at most ${max} characters`
    };
  }

  return { valid: true };
}

/**
 * Validate required fields in object
 * @param {Object} obj - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @returns {Object} { valid: boolean, errors?: string[] }
 */
function validateRequiredFields(obj, requiredFields) {
  const errors = [];

  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      errors.push(`${field} is required`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Validate WireGuard key format
 * @param {string} key - WireGuard key
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateWireGuardKey(key) {
  if (typeof key !== 'string') {
    return { valid: false, error: 'WireGuard key must be a string' };
  }

  // WireGuard keys are 44-character base64 strings
  const base64Regex = /^[A-Za-z0-9+/]{43}=$/;

  if (!base64Regex.test(key)) {
    return {
      valid: false,
      error: 'Invalid WireGuard key format (must be 44-character base64)'
    };
  }

  return { valid: true };
}

/**
 * Sanitize input string (remove potentially dangerous characters)
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';

  // Remove potentially dangerous characters
  return input
    .replace(/[<>'"]/g, '')
    .trim();
}

/**
 * Validate and sanitize request body
 * @param {Object} body - Request body
 * @param {Object} schema - Validation schema
 * @returns {Object} { valid: boolean, errors?: string[], sanitized?: Object }
 */
function validateRequestBody(body, schema) {
  const errors = [];
  const sanitized = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    // Skip validation for optional undefined fields
    if (!rules.required && (value === undefined || value === null)) {
      continue;
    }

    // Type validation
    if (rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rules.type) {
        errors.push(`${field} must be of type ${rules.type}`);
        continue;
      }
    }

    // Custom validation
    if (rules.validate && typeof rules.validate === 'function') {
      const result = rules.validate(value);
      if (!result.valid) {
        errors.push(result.error || `${field} is invalid`);
        continue;
      }
    }

    // Sanitize strings
    sanitized[field] = (rules.sanitize && typeof value === 'string')
      ? sanitizeInput(value)
      : value;
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

module.exports = {
  validateUUID,
  validateIPv4,
  validateIdleTimeout,
  validateSessionStatus,
  validateQuota,
  validatePort,
  validateCIDR,
  validateEmail,
  validateStringLength,
  validateRequiredFields,
  validateWireGuardKey,
  sanitizeInput,
  validateRequestBody
};
