/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadAppConfig } from './configLoader';
import { defaultConfig } from './defaultConfig';
import { logger } from '../lib/logger';

jest.mock('node:fs');
jest.mock('node:path');

describe('loadAppConfig', () => {
  let cwdSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (path.resolve as jest.Mock).mockImplementation((...args: unknown[]) => (args.length >= 2 ? args[1] : args[0]));
    (path.join as jest.Mock).mockImplementation((...parts: string[]) => parts.join('/').replace(/\/+/g, '/'));
    (path.dirname as jest.Mock).mockImplementation((p: string) => {
      if (p === '/') {
        return '/';
      }
      const idx = p.lastIndexOf('/');
      return idx <= 0 ? '/' : p.slice(0, idx);
    });
    (path.parse as jest.Mock).mockImplementation(() => ({ root: '/' }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/default/cwd');
    jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  it('should return default config unchanged when no codemie.yaml is found walking up to the filesystem root', () => {
    cwdSpy.mockReturnValue('/project/cwd');
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = loadAppConfig();

    expect(result).toEqual(defaultConfig);
    expect(fs.existsSync).toHaveBeenCalledTimes(3);
    expect(fs.existsSync).toHaveBeenNthCalledWith(1, '/project/cwd/codemie.yaml');
    expect(fs.existsSync).toHaveBeenNthCalledWith(2, '/project/codemie.yaml');
    expect(fs.existsSync).toHaveBeenNthCalledWith(3, '/codemie.yaml');
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should return default config with detected rootDir when codemie.yaml is found in the working directory', () => {
    cwdSpy.mockReturnValue('/project/cwd');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/project/cwd/codemie.yaml');

    const result = loadAppConfig();

    expect(result).toEqual({ ...defaultConfig, rootDir: '/project/cwd' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Using detected project root: /project/cwd');
  });

  it('should return default config with detected rootDir when codemie.yaml is found in an ancestor directory', () => {
    cwdSpy.mockReturnValue('/project/cwd/sub');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/project/codemie.yaml');

    const result = loadAppConfig();

    expect(result).toEqual({ ...defaultConfig, rootDir: '/project' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Using detected project root: /project');
  });

  it('should use an explicit rootDir and skip detection', () => {
    const result = loadAppConfig(undefined, 'relative/root');

    expect(result).toEqual({ ...defaultConfig, rootDir: 'relative/root' });
    expect(path.resolve).toHaveBeenCalledWith('relative/root');
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(cwdSpy).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should prefer the user config file over an explicit rootDir', () => {
    const userConfig = { rootDir: '/from/config' };
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig('custom-config.json', '/explicit/root');

    expect(result.rootDir).toBe('/from/config');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should fall back to an explicit rootDir when the user config file omits one', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ codemieConfig: 'custom.yaml' }));

    const result = loadAppConfig('custom-config.json', '/explicit/root');

    expect(result.rootDir).toBe('/explicit/root');
    expect(result.codemieConfig).toBe('custom.yaml');
    expect(path.resolve).toHaveBeenCalledWith('/explicit/root');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should not log when using the user config file', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}));

    loadAppConfig('config.json');

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should load and merge user config with default config', () => {
    const userConfig = { rootDir: '/custom/root' };
    const configPath = 'custom-config.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig(configPath);

    expect(result.rootDir).toBe('/custom/root');
    expect(result.codemieConfig).toBe(defaultConfig.codemieConfig);
    expect(result.codemieState).toBe(defaultConfig.codemieState);
    expect(result.backupsDirectory).toBe(defaultConfig.backupsDirectory);
  });

  it('should override all default config values with user config', () => {
    const userConfig = {
      rootDir: '/custom',
      codemieConfig: 'custom.yaml',
      codemieState: 'custom-state.json',
      backupsDirectory: 'custom-backups',
    };
    const configPath = 'custom-config.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig(configPath);

    expect(result).toEqual(userConfig);
  });

  it('should merge partial user config with defaults', () => {
    const userConfig = {
      rootDir: '/my/root',
      codemieConfig: 'my-config.yaml',
    };
    const configPath = 'partial-config.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig(configPath);

    expect(result.rootDir).toBe('/my/root');
    expect(result.codemieConfig).toBe('my-config.yaml');
    expect(result.codemieState).toBe(defaultConfig.codemieState);
    expect(result.backupsDirectory).toBe(defaultConfig.backupsDirectory);
  });

  it('should throw error when user config file does not exist', () => {
    const configPath = 'nonexistent.json';

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    expect(() => loadAppConfig(configPath)).toThrow(`Config file not found: ${configPath}`);
  });

  it('should throw error when user config JSON is malformed', () => {
    const configPath = 'config.json';
    const malformedJson = '{ broken }';

    (fs.readFileSync as jest.Mock).mockReturnValue(malformedJson);

    expect(() => loadAppConfig(configPath)).toThrow(`Malformed JSON in config file: ${configPath}`);
  });

  it('should throw error when merged config fails validation', () => {
    const userConfig = { rootDir: 123 };
    const configPath = 'invalid.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    expect(() => loadAppConfig(configPath)).toThrow();
  });

  it('should handle empty user config by using all defaults', () => {
    const configPath = 'empty.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}));

    const result = loadAppConfig(configPath);

    expect(result).toEqual(defaultConfig);
  });

  it('should validate merged config against appConfigSchema', () => {
    const userConfig = {
      rootDir: '/path',
      codemieConfig: 'config.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    };
    const configPath = 'config.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig(configPath);

    expect(result.rootDir).toBeDefined();
    expect(result.codemieConfig).toBeDefined();
    expect(result.codemieState).toBeDefined();
    expect(result.backupsDirectory).toBeDefined();
  });

  it('should properly merge and fallback to default when user config has empty values', () => {
    const userConfig = { rootDir: '', codemieConfig: '   ', backupsDirectory: undefined };
    const configPath = 'config.json';

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));

    const result = loadAppConfig(configPath);

    expect(result).toStrictEqual(defaultConfig);
  });
});
