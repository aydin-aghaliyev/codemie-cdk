/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { withTimeout } from './timeoutUtils';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('successful operations', () => {
    it('should resolve with value when promise completes within timeout', async () => {
      const promise = Promise.resolve('success');
      const result = withTimeout(promise, 1000, 'test operation');

      await expect(result).resolves.toBe('success');
    });

    it('should resolve with complex object when promise completes within timeout', async () => {
      const data = { id: '123', name: 'test', nested: { value: 42 } };
      const promise = Promise.resolve(data);
      const result = withTimeout(promise, 5000, 'fetch data');

      await expect(result).resolves.toEqual(data);
    });

    it('should handle promise that resolves quickly', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('fast'), 10);
      });

      const resultPromise = withTimeout(promise, 1000, 'fast operation');
      jest.advanceTimersByTime(10);

      await expect(resultPromise).resolves.toBe('fast');
    });
  });

  describe('timeout scenarios', () => {
    it('should reject with timeout error when promise takes too long', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000);
      });

      const resultPromise = withTimeout(promise, 1000, 'slow operation');

      // Advance time past the timeout
      jest.advanceTimersByTime(1000);

      await expect(resultPromise).rejects.toThrow('Operation timeout: slow operation (1000ms)');
    });

    it('should reject with correct timeout message', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('data'), 5000);
      });

      const resultPromise = withTimeout(promise, 3000, 'fetch assistant');

      jest.advanceTimersByTime(3000);

      await expect(resultPromise).rejects.toThrow('Operation timeout: fetch assistant (3000ms)');
    });

    it('should reject when promise never resolves', async () => {
      const promise = new Promise(() => {
        // Never resolves
      });

      const resultPromise = withTimeout(promise, 500, 'hanging operation');

      jest.advanceTimersByTime(500);

      await expect(resultPromise).rejects.toThrow('Operation timeout: hanging operation (500ms)');
    });
  });

  describe('rejection handling', () => {
    it('should propagate promise rejection before timeout', async () => {
      const error = new Error('Network error');
      const promise = Promise.reject(error);

      const resultPromise = withTimeout(promise, 1000, 'network call');

      await expect(resultPromise).rejects.toThrow('Network error');
    });

    it('should propagate custom error from promise', async () => {
      const customError = new Error('Custom validation failed');
      customError.name = 'ValidationError';
      const promise = Promise.reject(customError);

      const resultPromise = withTimeout(promise, 2000, 'validation');

      await expect(resultPromise).rejects.toThrow('Custom validation failed');
    });

    it('should handle promise that rejects quickly', async () => {
      const promise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Quick failure')), 50);
      });

      const resultPromise = withTimeout(promise, 1000, 'quick fail operation');
      jest.advanceTimersByTime(50);

      await expect(resultPromise).rejects.toThrow('Quick failure');
    });
  });

  describe('race conditions', () => {
    it('should resolve with first winner when promise completes just before timeout', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('just in time'), 999);
      });

      const resultPromise = withTimeout(promise, 1000, 'close call');
      jest.advanceTimersByTime(999);

      await expect(resultPromise).resolves.toBe('just in time');
    });

    it('should timeout when promise completes just after timeout', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 1001);
      });

      const resultPromise = withTimeout(promise, 1000, 'missed deadline');
      jest.advanceTimersByTime(1000);

      await expect(resultPromise).rejects.toThrow('Operation timeout: missed deadline (1000ms)');
    });
  });

  describe('different timeout durations', () => {
    it('should handle very short timeout', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('data'), 100);
      });

      const resultPromise = withTimeout(promise, 50, 'very short timeout');
      jest.advanceTimersByTime(50);

      await expect(resultPromise).rejects.toThrow('Operation timeout: very short timeout (50ms)');
    });

    it('should handle very long timeout', async () => {
      const promise = Promise.resolve('immediate');
      const result = withTimeout(promise, 60_000, 'long timeout operation');

      await expect(result).resolves.toBe('immediate');
    });

    it('should handle zero timeout', async () => {
      const promise = new Promise((resolve) => {
        setTimeout(() => resolve('data'), 10);
      });

      const resultPromise = withTimeout(promise, 0, 'zero timeout');
      jest.advanceTimersByTime(0);

      await expect(resultPromise).rejects.toThrow('Operation timeout: zero timeout (0ms)');
    });
  });

  describe('type safety', () => {
    it('should preserve string type', async () => {
      const promise = Promise.resolve('string result');
      const result = await withTimeout(promise, 1000, 'string op');

      expect(typeof result).toBe('string');
      expect(result).toBe('string result');
    });

    it('should preserve number type', async () => {
      const promise = Promise.resolve(42);
      const result = await withTimeout(promise, 1000, 'number op');

      expect(typeof result).toBe('number');
      expect(result).toBe(42);
    });

    it('should preserve object type', async () => {
      const obj = { id: '1', data: [1, 2, 3] };
      const promise = Promise.resolve(obj);
      const result = await withTimeout(promise, 1000, 'object op');

      expect(result).toEqual(obj);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('should handle null and undefined', async () => {
      const nullPromise = Promise.resolve(null);
      const nullResult = await withTimeout(nullPromise, 1000, 'null op');
      expect(nullResult).toBeNull();

      const undefinedPromise = Promise.resolve(undefined);
      const undefinedResult = await withTimeout(undefinedPromise, 1000, 'undefined op');
      expect(undefinedResult).toBeUndefined();
    });
  });
});
