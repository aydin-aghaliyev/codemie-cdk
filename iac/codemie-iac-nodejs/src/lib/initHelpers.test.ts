/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { defaultConfig } from '../appConfig';
import type { AppConfig } from '../appConfig';
import {
  fileExists,
  generateEnvTemplate,
  generateMinimalCodemieYaml,
  promptAppConfig,
  compareConfigWithDefaults,
  saveConfigFile,
} from './initHelpers';
import { promptUser, confirmOverwrite } from './terminalPromptHelpers';

jest.mock('./terminalPromptHelpers', () => ({
  promptUser: jest.fn(),
  confirmOverwrite: jest.fn(),
}));

describe('initHelpers', () => {
  describe('fileExists', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-helpers-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return true for existing file', () => {
      const testFile = path.join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'test content');

      expect(fileExists(testFile)).toBe(true);
    });

    it('should return false for non-existing file', () => {
      const testFile = path.join(tempDir, 'nonexistent.txt');

      expect(fileExists(testFile)).toBe(false);
    });

    it('should return true for existing directory', () => {
      const testDir = path.join(tempDir, 'testdir');
      fs.mkdirSync(testDir);

      expect(fileExists(testDir)).toBe(true);
    });
  });

  describe('generateEnvTemplate', () => {
    it('should generate .env template with all required variables', () => {
      const template = generateEnvTemplate();

      expect(template).toContain('CODEMIE_API_URL=');
      expect(template).toContain('CODEMIE_AUTH_URL=');
      expect(template).toContain('CODEMIE_REALM=');
      expect(template).toContain('CODEMIE_CLIENT_ID=');
      expect(template).toContain('CODEMIE_CLIENT_SECRET=');
    });

    it('should include helpful comments', () => {
      const template = generateEnvTemplate();

      expect(template).toContain('# Codemie API Configuration');
      expect(template).toContain('# DO NOT commit this file to Git!');
      expect(template).toContain('# Replace these placeholder values');
    });

    it('should include placeholder URLs', () => {
      const template = generateEnvTemplate();

      expect(template).toContain('https://your-instance.codemie.ai/api');
      expect(template).toContain('https://your-keycloak.auth.com');
    });

    it('should include default realm value', () => {
      const template = generateEnvTemplate();

      expect(template).toContain('CODEMIE_REALM=codemie');
    });

    it('should include placeholder credentials', () => {
      const template = generateEnvTemplate();

      expect(template).toContain('your-client-id');
      expect(template).toContain('your-client-secret');
    });
  });

  describe('generateMinimalCodemieYaml', () => {
    it('should generate valid YAML with project info', () => {
      const yaml = generateMinimalCodemieYaml('test-project', 'Test description');

      expect(yaml).toContain('version: "1"');
      expect(yaml).toContain('name: test-project');
      expect(yaml).toContain('description: Test description');
    });

    it('should include environment section with variable references', () => {
      const yaml = generateMinimalCodemieYaml('test', 'test');

      expect(yaml).toContain('environment:');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing YAML template output
      expect(yaml).toContain('codemie_api_url: ${CODEMIE_API_URL}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing YAML template output
      expect(yaml).toContain('auth_server_url: ${CODEMIE_AUTH_URL}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing YAML template output
      expect(yaml).toContain('auth_realm_name: ${CODEMIE_REALM}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing YAML template output
      expect(yaml).toContain('client_id: ${CODEMIE_CLIENT_ID}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing YAML template output
      expect(yaml).toContain('client_secret: ${CODEMIE_CLIENT_SECRET}');
    });

    it('should include imported section with empty arrays', () => {
      const yaml = generateMinimalCodemieYaml('test', 'test');

      expect(yaml).toContain('imported:');
      expect(yaml).toContain('assistants: []');
      expect(yaml).toContain('datasources: []');
      expect(yaml).toContain('integrations: []');
    });

    it('should include resources section with empty arrays', () => {
      const yaml = generateMinimalCodemieYaml('test', 'test');

      expect(yaml).toContain('resources:');
      expect(yaml).toMatch(/resources:[\s\S]*assistants: \[]/);
      expect(yaml).toMatch(/resources:[\s\S]*datasources: \[]/);
      expect(yaml).toMatch(/resources:[\s\S]*workflows: \[]/);
    });

    it('should include comments pointing to examples', () => {
      const yaml = generateMinimalCodemieYaml('test', 'test');

      expect(yaml).toContain('# For detailed examples and documentation, see:');
      expect(yaml).toContain('examples/assistant-examples.yaml');
      expect(yaml).toContain('examples/datasource-examples.yaml');
      expect(yaml).toContain('examples/workflow-examples.yaml');
      expect(yaml).toContain('examples/toolkit-examples.yaml');
      expect(yaml).toContain('examples/modular-config-example/');
    });

    it('should handle special characters in project name', () => {
      const yaml = generateMinimalCodemieYaml('My Project (2025)', 'Test & Demo');

      expect(yaml).toContain('name: My Project (2025)');
      expect(yaml).toContain('description: Test & Demo');
    });

    it('should handle empty description', () => {
      const yaml = generateMinimalCodemieYaml('test-project', '');

      expect(yaml).toContain('name: test-project');
      expect(yaml).toContain('description: ');
    });
  });

  describe('promptAppConfig', () => {
    it('should prompt for all config values and return AppConfig', async () => {
      jest
        .mocked(promptUser)
        .mockResolvedValueOnce('./my-root')
        .mockResolvedValueOnce('./my-config.yaml')
        .mockResolvedValueOnce('./my-state.json')
        .mockResolvedValueOnce('./my-backups');

      const result = await promptAppConfig();

      expect(result).toEqual({
        rootDir: './my-root',
        codemieConfig: './my-config.yaml',
        codemieState: './my-state.json',
        backupsDirectory: './my-backups',
      });
      expect(promptUser).toHaveBeenCalledTimes(4);
      expect(promptUser).toHaveBeenNthCalledWith(1, 'Root directory', defaultConfig.rootDir);
      expect(promptUser).toHaveBeenNthCalledWith(2, 'Codemie config file path', defaultConfig.codemieConfig);
      expect(promptUser).toHaveBeenNthCalledWith(3, 'Codemie state file path', defaultConfig.codemieState);
      expect(promptUser).toHaveBeenNthCalledWith(4, 'Backups directory', defaultConfig.backupsDirectory);
    });

    it('should use default values when user provides empty input', async () => {
      jest
        .mocked(promptUser)
        .mockResolvedValueOnce(defaultConfig.rootDir)
        .mockResolvedValueOnce(defaultConfig.codemieConfig)
        .mockResolvedValueOnce(defaultConfig.codemieState)
        .mockResolvedValueOnce(defaultConfig.backupsDirectory);

      const result = await promptAppConfig();

      expect(result).toEqual(defaultConfig);
    });
  });

  describe('compareConfigWithDefaults', () => {
    it('should return false when config matches defaults exactly', () => {
      const config: AppConfig = { ...defaultConfig };

      const result = compareConfigWithDefaults(config);

      expect(result).toBe(false);
    });

    it('should return true when there are some difference from default', () => {
      const config: AppConfig = {
        ...defaultConfig,
        rootDir: './custom-root',
      };

      const result = compareConfigWithDefaults(config);

      expect(result).toBe(true);
    });
  });

  describe('saveConfigFile', () => {
    let tempDir: string;
    const mockConfig: AppConfig = {
      rootDir: './test-root',
      codemieConfig: './test-config.yaml',
      codemieState: './test-state.json',
      backupsDirectory: './test-backups',
    };

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-config-test-'));
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      jest.restoreAllMocks();
    });

    it('should save config to default filename when user accepts default', async () => {
      jest.mocked(promptUser).mockResolvedValue('config.json');

      const result = await saveConfigFile(mockConfig);

      expect(result).toBe('config.json');
      expect(promptUser).toHaveBeenCalledWith('Enter config file path', 'config.json');

      const savedPath = path.join(tempDir, 'config.json');
      expect(fs.existsSync(savedPath)).toBe(true);

      const savedContent = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
      expect(savedContent).toEqual(mockConfig);
    });

    it('should save config to custom filename when provided', async () => {
      jest.mocked(promptUser).mockResolvedValue('my-custom.json');

      const result = await saveConfigFile(mockConfig, 'default.json');

      expect(result).toBe('my-custom.json');
      expect(promptUser).toHaveBeenCalledWith('Enter config file path', 'default.json');

      const savedPath = path.join(tempDir, 'my-custom.json');
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    it('should prompt for overwrite when file already exists and proceed if confirmed', async () => {
      const filename = 'existing.json';
      const existingPath = path.join(tempDir, filename);
      fs.writeFileSync(existingPath, 'old content');

      jest.mocked(promptUser).mockResolvedValue(filename);
      jest.mocked(confirmOverwrite).mockResolvedValue(true);

      const result = await saveConfigFile(mockConfig);

      expect(result).toBe(filename);
      expect(confirmOverwrite).toHaveBeenCalledWith(filename);

      const savedContent = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
      expect(savedContent).toEqual(mockConfig);
    });

    it('should throw error when user declines overwrite', async () => {
      const filename = 'existing.json';
      const existingPath = path.join(tempDir, filename);
      fs.writeFileSync(existingPath, 'old content');

      jest.mocked(promptUser).mockResolvedValue(filename);
      jest.mocked(confirmOverwrite).mockResolvedValue(false);

      await expect(saveConfigFile(mockConfig)).rejects.toThrow('Cancelled: Configuration file not saved.');

      const fileContent = fs.readFileSync(existingPath, 'utf-8');
      expect(fileContent).toBe('old content');
    });

    it('should not prompt for overwrite when file does not exist', async () => {
      jest.mocked(promptUser).mockResolvedValue('new-file.json');

      await saveConfigFile(mockConfig);

      expect(confirmOverwrite).not.toHaveBeenCalled();
    });

    it('should resolve path relative to current working directory', async () => {
      jest.mocked(promptUser).mockResolvedValue('subdir/config.json');

      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);

      await saveConfigFile(mockConfig);

      const savedPath = path.join(subdir, 'config.json');
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    it('should save all config properties correctly', async () => {
      const complexConfig: AppConfig = {
        rootDir: './complex/root',
        codemieConfig: './complex/config.yaml',
        codemieState: './complex/state.json',
        backupsDirectory: './complex/backups',
      };

      jest.mocked(promptUser).mockResolvedValue('complex.json');

      await saveConfigFile(complexConfig);

      const savedPath = path.join(tempDir, 'complex.json');
      const savedContent = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));

      expect(savedContent.rootDir).toBe(complexConfig.rootDir);
      expect(savedContent.codemieConfig).toBe(complexConfig.codemieConfig);
      expect(savedContent.codemieState).toBe(complexConfig.codemieState);
      expect(savedContent.backupsDirectory).toBe(complexConfig.backupsDirectory);
    });

    it('should handle paths with special characters', async () => {
      jest.mocked(promptUser).mockResolvedValue('my-config (2025).json');

      const result = await saveConfigFile(mockConfig);

      expect(result).toBe('my-config (2025).json');

      const savedPath = path.join(tempDir, 'my-config (2025).json');
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    it('should use default filename parameter when provided', async () => {
      const customDefault = 'my-default-config.json';
      jest.mocked(promptUser).mockResolvedValue(customDefault);

      await saveConfigFile(mockConfig, customDefault);

      expect(promptUser).toHaveBeenCalledWith('Enter config file path', customDefault);
    });
  });
});
