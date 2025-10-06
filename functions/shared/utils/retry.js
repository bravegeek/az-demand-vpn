/**
 * Retry Logic Utility
 * Implements exponential backoff retry pattern (FR-004, FR-026)
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Retry async function with exponential backoff
 * @param {Function} asyncFunction - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param {Object} options - Additional options
 * @returns {Promise<any>} Function result
 */
async function retryWithBackoff(
  asyncFunction,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  options = {}
) {
  const {
    onRetry,
    shouldRetry,
    maxDelayMs = 30000,
    loggingService,
    context
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Attempt the operation
      const result = await asyncFunction();

      // Success - log if on retry
      if (attempt > 1 && loggingService) {
        loggingService.logMetric(
          'retry.success',
          attempt,
          { operation: asyncFunction.name },
          context
        );
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );

      // Log retry attempt
      if (loggingService) {
        loggingService.logMetric(
          'retry.attempt',
          attempt,
          {
            operation: asyncFunction.name,
            error: error.message,
            nextDelayMs: delay
          },
          context
        );
      }

      if (context) {
        context.log.warn(
          `Retry attempt ${attempt}/${maxAttempts} for ${asyncFunction.name} after ${delay}ms delay`,
          { error: error.message }
        );
      }

      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(error, attempt, delay);
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // All attempts failed
  if (loggingService) {
    loggingService.logMetric(
      'retry.exhausted',
      maxAttempts,
      {
        operation: asyncFunction.name,
        error: lastError.message
      },
      context
    );
  }

  const exhaustedError = new Error(
    `Operation failed after ${maxAttempts} attempts: ${lastError.message}`
  );
  exhaustedError.code = 'MAX_RETRIES_EXCEEDED';
  exhaustedError.attempts = maxAttempts;
  exhaustedError.originalError = lastError;

  throw exhaustedError;
}

/**
 * Retry with fixed delay
 * @param {Function} asyncFunction - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} delayMs - Fixed delay in milliseconds
 * @param {Object} options - Additional options
 * @returns {Promise<any>} Function result
 */
async function retryWithFixedDelay(
  asyncFunction,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  delayMs = DEFAULT_BASE_DELAY_MS,
  options = {}
) {
  const {
    onRetry,
    shouldRetry,
    loggingService,
    context
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await asyncFunction();
    } catch (error) {
      lastError = error;

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      if (loggingService) {
        loggingService.logMetric(
          'retry.attempt',
          attempt,
          { operation: asyncFunction.name, error: error.message },
          context
        );
      }

      if (onRetry) {
        await onRetry(error, attempt, delayMs);
      }

      await sleep(delayMs);
    }
  }

  const exhaustedError = new Error(
    `Operation failed after ${maxAttempts} attempts: ${lastError.message}`
  );
  exhaustedError.code = 'MAX_RETRIES_EXCEEDED';
  exhaustedError.attempts = maxAttempts;
  exhaustedError.originalError = lastError;

  throw exhaustedError;
}

/**
 * Check if error is transient (should retry)
 * @param {Error} error - Error object
 * @returns {boolean}
 */
function isTransientError(error) {
  const transientCodes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'QUOTA_EXCEEDED',
    'ServiceUnavailable',
    'InternalServerError',
    'TooManyRequests'
  ];

  const transientStatusCodes = [408, 429, 500, 502, 503, 504];

  return (
    transientCodes.some(code =>
      error.code === code ||
      error.message?.includes(code)
    ) ||
    transientStatusCodes.includes(error.statusCode)
  );
}

/**
 * Check if error is a quota error
 * @param {Error} error - Error object
 * @returns {boolean}
 */
function isQuotaError(error) {
  const quotaCodes = [
    'QUOTA_EXCEEDED',
    'QuotaExceeded',
    'InsufficientCapacity',
    'OperationNotAllowed'
  ];

  return quotaCodes.some(code =>
    error.code === code ||
    error.message?.toLowerCase().includes('quota') ||
    error.message?.includes(code)
  );
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper for a function
 * @param {Function} fn - Function to wrap
 * @param {Object} retryOptions - Retry options
 * @returns {Function} Wrapped function
 */
function withRetry(fn, retryOptions = {}) {
  return async function (...args) {
    return await retryWithBackoff(
      () => fn(...args),
      retryOptions.maxAttempts || DEFAULT_MAX_ATTEMPTS,
      retryOptions.baseDelayMs || DEFAULT_BASE_DELAY_MS,
      retryOptions
    );
  };
}

/**
 * Batch retry - retry multiple operations with backoff
 * @param {Array<Function>} operations - Array of async functions
 * @param {Object} options - Retry options
 * @returns {Promise<Array>} Array of results
 */
async function retryBatch(operations, options = {}) {
  const results = [];

  for (const operation of operations) {
    try {
      const result = await retryWithBackoff(
        operation,
        options.maxAttempts,
        options.baseDelayMs,
        options
      );
      results.push({ success: true, result });
    } catch (error) {
      results.push({ success: false, error });
    }
  }

  return results;
}

/**
 * Calculate jitter for retry delay (helps avoid thundering herd)
 * @param {number} delayMs - Base delay
 * @param {number} jitterPercent - Jitter percentage (default: 10)
 * @returns {number} Delay with jitter
 */
function addJitter(delayMs, jitterPercent = 10) {
  const jitter = delayMs * (jitterPercent / 100);
  const randomJitter = Math.random() * jitter * 2 - jitter;
  return Math.max(0, Math.round(delayMs + randomJitter));
}

module.exports = {
  retryWithBackoff,
  retryWithFixedDelay,
  isTransientError,
  isQuotaError,
  sleep,
  withRetry,
  retryBatch,
  addJitter,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS
};
