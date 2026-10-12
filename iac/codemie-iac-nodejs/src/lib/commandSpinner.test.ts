/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { Ora } from 'ora';

import {
  pauseSpinner,
  resetSpinnerFactory,
  resetSpinnerState,
  runCommandWithSpinner,
  setSpinnerFactory,
  startSpinner,
} from './commandSpinner';

describe('commandSpinner', () => {
  let originalIsTTY: boolean | undefined;
  let mockSpinner: jest.Mocked<Ora>;

  beforeEach(() => {
    originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    mockSpinner = {
      text: '',
      isSpinning: false,
      start: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.isSpinning = true;
        return this;
      }),
      stop: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.isSpinning = false;
        return this;
      }),
      succeed: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.isSpinning = false;
        return this;
      }),
      fail: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.isSpinning = false;
        return this;
      }),
    } as unknown as jest.Mocked<Ora>;

    setSpinnerFactory((text) => {
      mockSpinner.text = text;
      return mockSpinner;
    });
  });

  afterEach(() => {
    resetSpinnerState();
    resetSpinnerFactory();
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('pauses and resumes spinner around synchronous console writes', () => {
    startSpinner('Running command...');

    pauseSpinner(() => {
      expect(mockSpinner.stop).toHaveBeenCalledTimes(1);
      expect(mockSpinner.isSpinning).toBe(false);
    });

    expect(mockSpinner.start).toHaveBeenCalledTimes(2);
    expect(mockSpinner.isSpinning).toBe(true);
  });

  it('intercepts process.exit and marks spinner as succeeded for successful commands', async () => {
    // biome-ignore lint/suspicious/useAwait: callback must be async to match Promise<void> signature
    await runCommandWithSpinner('Generating preview', async () => {
      process.exit(0);
    });

    expect(mockSpinner.succeed).toHaveBeenCalledWith(expect.stringContaining('Generating preview completed in'));
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('marks spinner as failed when command sets non-zero exit code', async () => {
    // biome-ignore lint/suspicious/useAwait: callback must be async to match Promise<void> signature
    await runCommandWithSpinner('Importing datasource', async () => {
      process.exitCode = 1;
    });

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining('Importing datasource failed in'));
    expect(process.exitCode).toBe(1);
  });
});
