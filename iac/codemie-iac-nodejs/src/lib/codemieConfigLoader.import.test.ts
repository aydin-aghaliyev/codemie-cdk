/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AppConfig } from '../appConfig';

import { CodemieConfigLoader } from './codemieConfigLoader';

describe('CodemieConfigLoader - $import functionality', () => {
  let tempDir: string;
  let appConfig: AppConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-loader-import-test-'));
    appConfig = {
      rootDir: tempDir,
      codemieConfig: 'codemie.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Single object import', () => {
    it('should import a single datasource from external file', () => {
      // Create external datasource file
      const datasourcePath = path.join(tempDir, 'configs', 'datasources');
      fs.mkdirSync(datasourcePath, { recursive: true });
      fs.writeFileSync(
        path.join(datasourcePath, 'repo-1.yaml'),
        `name: repo-1
type: code
description: Repository 1
link: https://github.com/org/repo-1
branch: main
`
      );

      // Create main config with import
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/datasources/repo-1.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.datasources).toHaveLength(1);
      expect(config.resources.datasources![0]).toEqual({
        name: 'repo-1',
        type: 'code',
        description: 'Repository 1',
        link: 'https://github.com/org/repo-1',
        branch: 'main',
      });
    });

    it('should import a single assistant from external file', () => {
      const assistantPath = path.join(tempDir, 'configs', 'assistants');
      fs.mkdirSync(assistantPath, { recursive: true });

      // Create prompt file
      const promptPath = path.join(tempDir, 'system_prompts');
      fs.mkdirSync(promptPath, { recursive: true });
      fs.writeFileSync(path.join(promptPath, 'test.prompt.md'), 'Test prompt');

      fs.writeFileSync(
        path.join(assistantPath, 'test-assistant.yaml'),
        `name: Test Assistant
description: Test assistant
prompt: ./system_prompts/test.prompt.md
model: gpt-4o
shared: true
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  assistants:
    - $import: configs/assistants/test-assistant.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.assistants).toHaveLength(1);
      expect(config.resources.assistants![0].name).toBe('Test Assistant');
      expect(config.resources.assistants![0].model).toBe('gpt-4o');
    });
  });

  describe('Array import', () => {
    it('should import and flatten an array of datasources', () => {
      const datasourcePath = path.join(tempDir, 'configs', 'datasources');
      fs.mkdirSync(datasourcePath, { recursive: true });
      fs.writeFileSync(
        path.join(datasourcePath, 'all-repos.yaml'),
        `- name: repo-1
  type: code
  description: Repository 1
  link: https://github.com/org/repo-1
- name: repo-2
  type: code
  description: Repository 2
  link: https://github.com/org/repo-2
- name: repo-3
  type: code
  description: Repository 3
  link: https://github.com/org/repo-3
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/datasources/all-repos.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.datasources).toHaveLength(3);
      expect(config.resources.datasources![0].name).toBe('repo-1');
      expect(config.resources.datasources![1].name).toBe('repo-2');
      expect(config.resources.datasources![2].name).toBe('repo-3');
    });
  });

  describe('Mixed inline and imports', () => {
    it('should handle mix of inline resources and imports', () => {
      const datasourcePath = path.join(tempDir, 'configs', 'datasources');
      fs.mkdirSync(datasourcePath, { recursive: true });
      fs.writeFileSync(
        path.join(datasourcePath, 'repo-1.yaml'),
        `name: repo-1
type: code
description: Repository 1
link: https://github.com/org/repo-1
`
      );

      fs.writeFileSync(
        path.join(datasourcePath, 'all-repos.yaml'),
        `- name: repo-2
  type: code
  description: Repository 2
  link: https://github.com/org/repo-2
- name: repo-3
  type: code
  description: Repository 3
  link: https://github.com/org/repo-3
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - name: inline-repo
      type: code
      description: Inline repository
      link: https://github.com/org/inline
    - $import: configs/datasources/repo-1.yaml
    - $import: configs/datasources/all-repos.yaml
    - name: another-inline
      type: code
      description: Another inline
      link: https://github.com/org/another
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.datasources).toHaveLength(5);
      expect(config.resources.datasources![0].name).toBe('inline-repo');
      expect(config.resources.datasources![1].name).toBe('repo-1');
      expect(config.resources.datasources![2].name).toBe('repo-2');
      expect(config.resources.datasources![3].name).toBe('repo-3');
      expect(config.resources.datasources![4].name).toBe('another-inline');
    });
  });

  describe('Nested imports', () => {
    it('should handle nested $import in imported array files', () => {
      const datasourcePath = path.join(tempDir, 'configs', 'datasources');
      fs.mkdirSync(datasourcePath, { recursive: true });

      // Create base repos
      fs.writeFileSync(
        path.join(datasourcePath, 'base-repos.yaml'),
        `- name: repo-1
  type: code
  description: Repository 1
  link: https://github.com/org/repo-1
- name: repo-2
  type: code
  description: Repository 2
  link: https://github.com/org/repo-2
`
      );

      // Create wrapper that imports base-repos
      fs.writeFileSync(
        path.join(datasourcePath, 'all-repos.yaml'),
        `- $import: base-repos.yaml
- name: repo-3
  type: code
  description: Repository 3 (added in wrapper)
  link: https://github.com/org/repo-3
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/datasources/all-repos.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.datasources).toHaveLength(3);
      expect(config.resources.datasources![0].name).toBe('repo-1');
      expect(config.resources.datasources![1].name).toBe('repo-2');
      expect(config.resources.datasources![2].name).toBe('repo-3');
    });
  });

  describe('Object-level imports', () => {
    it('should import entire sections (tool_definitions)', () => {
      const sharedPath = path.join(tempDir, 'configs', 'shared');
      fs.mkdirSync(sharedPath, { recursive: true });
      fs.writeFileSync(
        path.join(sharedPath, 'tools.yaml'),
        `jira_tool:
  name: generic_jira_tool
  label: Generic Jira
  settings_config: false
confluence_tool:
  name: generic_confluence_tool
  label: Generic Confluence
  settings_config: false
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
tool_definitions:
  $import: configs/shared/tools.yaml
resources:
  datasources: []
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.tool_definitions).toBeDefined();
      expect(config.tool_definitions!.jira_tool).toBeDefined();
      expect(config.tool_definitions!.jira_tool.name).toBe('generic_jira_tool');
      expect(config.tool_definitions!.confluence_tool).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should throw error when import file not found', () => {
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/non-existent.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      expect(() => loader.loadConfig()).toThrow('Import file not found');
    });

    it('should throw error when imported file is empty', () => {
      const configsPath = path.join(tempDir, 'configs');
      fs.mkdirSync(configsPath, { recursive: true });
      fs.writeFileSync(path.join(configsPath, 'empty.yaml'), '');

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/empty.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      expect(() => loader.loadConfig()).toThrow('Import file');
      expect(() => loader.loadConfig()).toThrow('is empty');
    });

    it('should throw error when imported file contains invalid type', () => {
      const configsPath = path.join(tempDir, 'configs');
      fs.mkdirSync(configsPath, { recursive: true });
      fs.writeFileSync(path.join(configsPath, 'invalid.yaml'), 'just a string');

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/invalid.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      expect(() => loader.loadConfig()).toThrow('must contain either an object or an array');
    });
  });

  describe('Backward compatibility', () => {
    it('should work with configs without $import directives', () => {
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - name: inline-repo
      type: code
      description: Inline repository
      link: https://github.com/org/inline
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      expect(config.resources.datasources).toHaveLength(1);
      expect(config.resources.datasources![0].name).toBe('inline-repo');
    });
  });

  describe('Circular import detection', () => {
    it('should detect and prevent circular imports between two files', () => {
      const configsPath = path.join(tempDir, 'configs');
      fs.mkdirSync(configsPath, { recursive: true });

      // file-a.yaml imports file-b.yaml
      fs.writeFileSync(
        path.join(configsPath, 'file-a.yaml'),
        `- name: resource-a
  type: code
  link: https://github.com/org/a
- $import: file-b.yaml
`
      );

      // file-b.yaml imports file-a.yaml (circular!)
      fs.writeFileSync(
        path.join(configsPath, 'file-b.yaml'),
        `- name: resource-b
  type: code
  link: https://github.com/org/b
- $import: file-a.yaml
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/file-a.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      expect(() => loader.loadConfig()).toThrow('Circular import detected');
      expect(() => loader.loadConfig()).toThrow('file-a.yaml');
    });

    it('should allow same file in different import branches (not circular)', () => {
      const configsPath = path.join(tempDir, 'configs');
      fs.mkdirSync(configsPath, { recursive: true });

      // shared.yaml - reusable file
      fs.writeFileSync(
        path.join(configsPath, 'shared.yaml'),
        `name: shared-resource
type: code
link: https://github.com/org/shared
`
      );

      // branch-a.yaml imports shared.yaml
      fs.writeFileSync(
        path.join(configsPath, 'branch-a.yaml'),
        `- $import: shared.yaml
- name: resource-a
  type: code
  link: https://github.com/org/a
`
      );

      // branch-b.yaml also imports shared.yaml (not circular - different branches)
      fs.writeFileSync(
        path.join(configsPath, 'branch-b.yaml'),
        `- $import: shared.yaml
- name: resource-b
  type: code
  link: https://github.com/org/b
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `version: 1
project:
  name: test-project
  description: Test project
environment:
  codemie_api_url: https://api.test.com
  auth_server_url: https://auth.test.com
  auth_realm_name: test
imported:
  assistants: []
  datasources: []
resources:
  datasources:
    - $import: configs/branch-a.yaml
    - $import: configs/branch-b.yaml
`
      );

      const loader = new CodemieConfigLoader(appConfig);
      const config = loader.loadConfig();

      // Should successfully import shared.yaml in both branches
      expect(config.resources.datasources).toHaveLength(4);
      expect(config.resources.datasources![0].name).toBe('shared-resource');
      expect(config.resources.datasources![1].name).toBe('resource-a');
      expect(config.resources.datasources![2].name).toBe('shared-resource');
      expect(config.resources.datasources![3].name).toBe('resource-b');
    });
  });
});
