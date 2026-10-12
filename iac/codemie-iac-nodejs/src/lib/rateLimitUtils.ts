/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import pLimit from 'p-limit';

import { RATE_LIMITING } from './constants';
import { logger } from './logger';

/**
 * Create a concurrent request limiter using p-limit
 * Limits number of concurrent async operations
 */
export function createConcurrentLimiter(maxConcurrent: number = RATE_LIMITING.MAX_CONCURRENT_REQUESTS) {
  return pLimit(maxConcurrent);
}

/**
 * Retry failed API calls with exponential backoff
 * Handles 429 (rate limit) and 5xx (server errors)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  maxAttempts: number = RATE_LIMITING.RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable (rate limit, 5xx server errors, or network issues)
      const errorMsg = lastError.message.toLowerCase();
      const isRetryable =
        lastError.message.includes('429') ||
        errorMsg.includes('too many requests') ||
        /\b5\d{2}\b/.test(lastError.message) || // 5xx HTTP status codes only
        errorMsg.includes('timeout') ||
        errorMsg.includes('econnreset') ||
        errorMsg.includes('econnrefused');

      if (!isRetryable || attempt === maxAttempts) {
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s, ...
      const delayMs = RATE_LIMITING.RETRY_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(`   ⚠️  Retry ${attempt}/${maxAttempts} for ${operation} after ${delayMs}ms...`);
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  throw lastError || new Error(`Failed after ${maxAttempts} attempts: ${operation}`);
}
