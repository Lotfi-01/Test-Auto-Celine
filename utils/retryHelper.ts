/**
 * Retry helper utilities for handling flaky operations
 * Implements exponential backoff and custom retry logic
 */

import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  exponentialBackoff?: boolean;
  onRetry?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Retry an async action with configurable backoff strategy
 * @param action - The async function to retry
 * @param options - Retry configuration
 * @returns Promise with the result of the action
 */
export async function retryAction<T>(action: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delay = 1000, exponentialBackoff = true, onRetry, shouldRetry = () => true } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry this specific error
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxAttempts) {
        throw lastError;
      }

      // Calculate delay with optional exponential backoff
      const waitTime = exponentialBackoff ? delay * Math.pow(2, attempt - 1) : delay;

      // Call retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt);
      } else {
        logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${waitTime}ms due to: ${lastError.message}`);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  // TypeScript requires this, but we should never reach here
  throw lastError!;
}

/**
 * Retry with timeout - combines retry logic with a global timeout
 * @param action - The async function to retry
 * @param timeoutMs - Maximum time in milliseconds before giving up
 * @param retryOptions - Retry configuration
 * @returns Promise with the result of the action
 */
export async function retryWithTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  retryOptions: RetryOptions = {}
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([retryAction(action, retryOptions), timeoutPromise]);
}

/**
 * Predicate functions for common retry scenarios
 */
export const RetryPredicates = {
  /**
   * Retry on network errors
   */
  isNetworkError: (error: Error): boolean => {
    const networkErrorMessages = [
      'net::ERR_',
      'Network request failed',
      'Failed to fetch',
      'ECONNREFUSED',
      'ETIMEDOUT',
    ];
    return networkErrorMessages.some((msg) => error.message.includes(msg));
  },

  /**
   * Retry on timeout errors
   */
  isTimeoutError: (error: Error): boolean => {
    return error.message.includes('Timeout') || error.message.includes('timeout');
  },

  /**
   * Retry on element not found errors
   */
  isElementNotFound: (error: Error): boolean => {
    return (
      error.message.includes('not found') ||
      error.message.includes('not visible') ||
      error.message.includes('not attached')
    );
  },

  /**
   * Don't retry on assertion errors (test should fail immediately)
   */
  isNotAssertionError: (error: Error): boolean => {
    return !error.message.includes('expect') && !error.message.includes('Assertion');
  },

  /**
   * Combine multiple predicates with AND logic
   */
  all: (...predicates: ((error: Error) => boolean)[]): ((error: Error) => boolean) => {
    return (error: Error) => predicates.every((predicate) => predicate(error));
  },

  /**
   * Combine multiple predicates with OR logic
   */
  any: (...predicates: ((error: Error) => boolean)[]): ((error: Error) => boolean) => {
    return (error: Error) => predicates.some((predicate) => predicate(error));
  },
};

/**
 * Convenience function for retrying common operations
 */
export const retry = {
  /**
   * Retry network operations (API calls, page loads)
   */
  network: <T>(action: () => Promise<T>, maxAttempts = 3): Promise<T> => {
    return retryAction(action, {
      maxAttempts,
      delay: 2000,
      exponentialBackoff: true,
      shouldRetry: RetryPredicates.any(RetryPredicates.isNetworkError, RetryPredicates.isTimeoutError),
    });
  },

  /**
   * Retry element interactions (clicks, fills)
   */
  interaction: <T>(action: () => Promise<T>, maxAttempts = 3): Promise<T> => {
    return retryAction(action, {
      maxAttempts,
      delay: 500,
      exponentialBackoff: false,
      shouldRetry: RetryPredicates.all(RetryPredicates.isElementNotFound, RetryPredicates.isNotAssertionError),
    });
  },

  /**
   * Retry with custom configuration
   */
  custom: <T>(action: () => Promise<T>, options: RetryOptions): Promise<T> => {
    return retryAction(action, options);
  },
};
