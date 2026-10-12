/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { pauseSpinner } from './commandSpinner';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel = LogLevel.INFO;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.DEBUG) {
      pauseSpinner(() => {
        // biome-ignore lint/suspicious/noConsole: Logging purpose
        console.debug(message, ...args);
      });
    }
  }

  info(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.INFO) {
      pauseSpinner(() => {
        // biome-ignore lint/suspicious/noConsole: Logging purpose
        console.log(message, ...args);
      });
    }
  }

  warn(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.WARN) {
      pauseSpinner(() => {
        // biome-ignore lint/suspicious/noConsole: Logging purpose
        console.warn(message, ...args);
      });
    }
  }

  error(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.ERROR) {
      pauseSpinner(() => {
        // biome-ignore lint/suspicious/noConsole: Logging purpose
        console.error(message, ...args);
      });
    }
  }
}

export const logger = Logger.getInstance();
