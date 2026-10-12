/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { createConcurrentLimiter, withRetry } from './rateLimitUtils';

const failingTask = () => Promise.reject(new Error('Task 1 failed'));
const successTask = () => Promise.resolve('success');

describe('rateLimitUtils', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('createConcurrentLimiter', () => {
    it('should limit concurrent operations', async () => {
      const limit = createConcurrentLimiter(2);
      let activeCount = 0;
      let maxActive = 0;

      const task = async () => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await Promise.resolve();
        activeCount--;
      };

      // Start 5 tasks
      const promises = Array.from({ length: 5 }, () => limit(task));
      await Promise.all(promises);

      // Max 2 concurrent tasks
      expect(maxActive).toBe(2);
    });

    it('should handle errors and continue processing queue', async () => {
      const limit = createConcurrentLimiter(1);

      await expect(limit(failingTask)).rejects.toThrow('Task 1 failed');
      const result = await limit(successTask);
      expect(result).toBe('success');
    });
  });

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await withRetry(fn, 'test operation');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('429 Too Many Requests')).mockResolvedValueOnce('success');

      const promise = withRetry(fn, 'test operation', 3);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should fail after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('429 Too Many Requests'));

      const promise = withRetry(fn, 'test operation', 3);

      // Run timers and handle rejection
      const runTimers = jest.runAllTimersAsync();
      await Promise.all([promise.catch(() => {}), runTimers]);

      await expect(promise).rejects.toThrow('429 Too Many Requests');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Bad Request'));

      await expect(withRetry(fn, 'test operation', 3)).rejects.toThrow('Bad Request');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, 'test operation', 3);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
