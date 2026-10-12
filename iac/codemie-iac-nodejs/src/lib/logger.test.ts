/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { Logger, LogLevel, logger } from './logger';

describe('Logger', () => {
  let consoleDebugSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Mock console methods
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Reset logger to INFO level
    logger.setLevel(LogLevel.INFO);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should export logger as singleton instance', () => {
      expect(logger).toBe(Logger.getInstance());
    });
  });

  describe('Log level filtering', () => {
    it('should log all messages at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleLogSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('should not log debug messages at INFO level', () => {
      logger.setLevel(LogLevel.INFO);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('should only log warn and error messages at WARN level', () => {
      logger.setLevel(LogLevel.WARN);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('should only log error messages at ERROR level', () => {
      logger.setLevel(LogLevel.ERROR);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('should not log any messages at SILENT level', () => {
      logger.setLevel(LogLevel.SILENT);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Message formatting', () => {
    it('should support multiple arguments in debug', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('test', 123, { key: 'value' });

      expect(consoleDebugSpy).toHaveBeenCalledWith('test', 123, { key: 'value' });
    });

    it('should support multiple arguments in info', () => {
      logger.info('test', 123, { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledWith('test', 123, { key: 'value' });
    });

    it('should support multiple arguments in warn', () => {
      logger.warn('test', 123, { key: 'value' });

      expect(consoleWarnSpy).toHaveBeenCalledWith('test', 123, { key: 'value' });
    });

    it('should support multiple arguments in error', () => {
      logger.error('test', 123, { key: 'value' });

      expect(consoleErrorSpy).toHaveBeenCalledWith('test', 123, { key: 'value' });
    });
  });

  describe('Level transitions', () => {
    it('should change log level dynamically', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.info('should not appear');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      logger.setLevel(LogLevel.INFO);
      logger.info('should appear');
      expect(consoleLogSpy).toHaveBeenCalledWith('should appear');
    });

    it('should maintain level across multiple calls', () => {
      logger.setLevel(LogLevel.WARN);

      logger.info('info 1');
      logger.info('info 2');
      logger.warn('warn 1');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn 1');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty messages', () => {
      logger.info('');
      expect(consoleLogSpy).toHaveBeenCalledWith('');
    });

    it('should handle undefined and null arguments', () => {
      logger.info('test', undefined, null);
      expect(consoleLogSpy).toHaveBeenCalledWith('test', undefined, null);
    });

    it('should handle Error objects', () => {
      const error = new Error('test error');
      logger.error('Error occurred:', error);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error occurred:', error);
    });

    it('should handle array arguments', () => {
      const arr = [1, 2, 3];
      logger.info('Array:', arr);
      expect(consoleLogSpy).toHaveBeenCalledWith('Array:', arr);
    });
  });
});
