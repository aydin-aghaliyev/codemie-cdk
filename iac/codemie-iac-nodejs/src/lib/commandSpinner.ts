/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import ora, { type Ora } from 'ora';

type SpinnerFactory = (text: string) => Ora;

const defaultSpinnerFactory: SpinnerFactory = (text) =>
  ora({
    text,
    discardStdin: false,
  });

class CommandSpinnerManager {
  private spinner: Ora | null = null;
  private spinnerText = '';
  private factory: SpinnerFactory = defaultSpinnerFactory;

  setFactory(factory: SpinnerFactory): void {
    this.factory = factory;
  }

  resetFactory(): void {
    this.factory = defaultSpinnerFactory;
    this.reset();
  }

  reset(): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
    }

    this.spinner = null;
    this.spinnerText = '';
  }

  private isEnabled(): boolean {
    return Boolean(process.stderr?.isTTY);
  }

  start(text: string): void {
    this.spinnerText = text;

    if (!this.isEnabled()) {
      return;
    }

    if (!this.spinner) {
      this.spinner = this.factory(text);
      this.spinner.start();
      return;
    }

    this.spinner.text = text;
    if (!this.spinner.isSpinning) {
      this.spinner.start();
    }
  }

  stop(): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
    }
  }

  succeed(text?: string): void {
    if (!this.spinner) {
      return;
    }

    this.spinner.succeed(text ?? this.spinnerText);
    this.spinner = null;
    this.spinnerText = '';
  }

  fail(text?: string): void {
    if (!this.spinner) {
      return;
    }

    this.spinner.fail(text ?? this.spinnerText);
    this.spinner = null;
    this.spinnerText = '';
  }

  pause<T>(operation: () => T): T {
    const shouldResume = Boolean(this.spinner?.isSpinning);
    const currentText = this.spinner?.text ?? this.spinnerText;

    if (shouldResume) {
      this.spinner?.stop();
    }

    try {
      return operation();
    } finally {
      if (shouldResume && this.spinner) {
        this.spinner.text = currentText;
        this.spinner.start();
      }
    }
  }

  async pauseWhile<T>(operation: () => Promise<T>): Promise<T> {
    const shouldResume = Boolean(this.spinner?.isSpinning);
    const currentText = this.spinner?.text ?? this.spinnerText;

    if (shouldResume) {
      this.spinner?.stop();
    }

    try {
      return await operation();
    } finally {
      if (shouldResume && this.spinner) {
        this.spinner.text = currentText;
        this.spinner.start();
      }
    }
  }
}

const spinnerManager = new CommandSpinnerManager();

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function normalizeExitCode(code: number | string | null | undefined): number {
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code;
  }

  if (typeof code === 'string') {
    const parsed = Number(code);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function startSpinner(text: string): void {
  spinnerManager.start(text);
}

export function stopSpinner(): void {
  spinnerManager.stop();
}

export function succeedSpinner(text?: string): void {
  spinnerManager.succeed(text);
}

export function failSpinner(text?: string): void {
  spinnerManager.fail(text);
}

export function pauseSpinner<T>(operation: () => T): T {
  return spinnerManager.pause(operation);
}

export function pauseSpinnerWhile<T>(operation: () => Promise<T>): Promise<T> {
  return spinnerManager.pauseWhile(operation);
}

export function setSpinnerFactory(factory: SpinnerFactory): void {
  spinnerManager.setFactory(factory);
}

export function resetSpinnerFactory(): void {
  spinnerManager.resetFactory();
}

export function resetSpinnerState(): void {
  spinnerManager.reset();
}

export async function runCommandWithSpinner(commandLabel: string, action: () => Promise<void>): Promise<void> {
  const originalExit = process.exit;
  const previousExitCode = process.exitCode;
  const startTime = Date.now();
  let interceptedExitCode: number | undefined;

  startSpinner(`${commandLabel}...`);

  process.exit = ((code?: number | string | null) => {
    interceptedExitCode = normalizeExitCode(code);
    process.exitCode = interceptedExitCode;
    return undefined as never;
  }) as typeof process.exit;

  try {
    await action();
  } catch (error) {
    const duration = formatDuration(Date.now() - startTime);
    failSpinner(`${commandLabel} failed in ${duration}`);

    if ((interceptedExitCode ?? process.exitCode ?? 0) === 0) {
      process.exitCode = 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      // biome-ignore lint/suspicious/noConsole: last-resort CLI error reporting
      console.error(errorMessage);
    }
    return;
  } finally {
    process.exit = originalExit;
  }

  const exitCode = interceptedExitCode ?? process.exitCode ?? previousExitCode ?? 0;
  const duration = formatDuration(Date.now() - startTime);

  if (exitCode === 0) {
    succeedSpinner(`${commandLabel} completed in ${duration}`);
  } else {
    failSpinner(`${commandLabel} failed in ${duration}`);
  }
}
