/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

/**
 * Execute promise with timeout protection
 * Rejects if operation takes longer than specified timeout
 *
 * @example
 * const result = await withTimeout(
 *   client.assistants.get(id),
 *   30000,
 *   'Fetch assistant'
 * );
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Operation timeout: ${operation} (${timeoutMs}ms)`)), timeoutMs);
    // Unref the timer so it doesn't keep the process alive
    timeoutId.unref();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Clean up the timeout timer if the promise resolves/rejects first
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
