/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as yaml from 'yaml';

import type { CodeMieClient, MCPServerDetails, ToolKitDetails } from 'codemie-sdk';

import * as backupModule from './backup';

import { transformMcpServer, transformToolkits } from './lib/backupTransformers';
import { calculateAssistantConfigChecksum } from './lib/checksumUtils';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { assistantResponseToResource } from './lib/converters';
import { logger } from './lib/logger';
import { collectCompanionFiles, hasCompanionFileLayout } from './lib/skillCompanionFiles';
import type { AssistantResource, CodemieConfig, SkillResource } from './types/codemieConfig';

const { streamResources, main } = backupModule;

// Mock external dependencies
jest.mock('./lib/clientFactory');
jest.mock('./lib/codemieConfigLoader');

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const MockedConfigLoader = CodemieConfigLoader as jest.MockedClass<typeof CodemieConfigLoader>;

describe('backup.ts', () => {
  let tempDir: string;
  let originalExit: typeof process.exit;
  let originalCwd: string;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let mockAppConfig: { rootDir: string; codemieConfig: string; codemieState: string; backupsDirectory: string };
  let backupOptions: { appConfig: typeof mockAppConfig };

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    originalCwd = process.cwd();

    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn() as unknown as typeof process.exit;

    // Mock console to reduce noise
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Change to temp directory
    process.chdir(tempDir);

    // Setup default mocks
    const mockConfig: CodemieConfig = {
      version: '1',
      project: { name: 'test-project', description: 'Test' },
      environment: {
        codemie_api_url: 'https://api.example.com',
        auth_server_url: 'https://auth.example.com',
        auth_realm_name: 'test',
        client_id: 'test-client',
        client_secret: 'secret',
      },
      imported: { assistants: [], datasources: [], integrations: [] },
      resources: { assistants: [], datasources: [], workflows: [], skills: [] },
    };

    MockedConfigLoader.mockImplementation(
      () =>
        ({
          loadConfig: jest.fn().mockReturnValue(mockConfig),
          loadPrompt: jest.fn(),
          loadAssistantConfig: jest.fn(),
        }) as unknown as CodemieConfigLoader
    );

    const mockClient = {
      assistants: {
        list: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockImplementation((id: string) =>
          Promise.resolve({
            id,
            name: 'Mock Assistant',
            slug: 'mock-assistant',
            system_prompt: 'Test prompt',
            llm_model_type: 'gpt-4',
            created_date: new Date().toISOString(),
          })
        ),
        getTools: jest.fn().mockResolvedValue([]),
      },
      datasources: {
        list: jest.fn().mockResolvedValue([]),
      },
      workflows: {
        list: jest.fn().mockResolvedValue([]),
      },
      skills: {
        list: jest.fn().mockResolvedValue([]),
        get: jest.fn(),
      },
      integrations: {
        list: jest.fn().mockResolvedValue([]),
      },
    };
    mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

    mockAppConfig = {
      rootDir: process.cwd(),
      codemieConfig: 'codemie.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    };

    backupOptions = {
      appConfig: mockAppConfig,
    };
  });

  afterEach(() => {
    process.exit = originalExit;

    // Safe chdir: only if directory still exists
    try {
      if (fs.existsSync(originalCwd)) {
        process.chdir(originalCwd);
      }
    } catch {
      // If chdir fails, ignore - we're cleaning up anyway
    }

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('streamResources', () => {
    it('should yield resources from paginated API', async () => {
      // Create 100 items for first page (triggers next page), then 50 for second page (stops)
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `${i + 1}` }));
      const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `${i + 101}` }));

      const mockFetch = jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const results: Array<{ id: string }> = [];
      for await (const resource of streamResources(mockFetch, 'test-resource')) {
        results.push(resource);
      }

      expect(results).toHaveLength(150);
      expect(results[0].id).toBe('1');
      expect(results[99].id).toBe('100');
      expect(results[149].id).toBe('150');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle empty result', async () => {
      const mockFetch = jest.fn().mockResolvedValue([]);

      const results: Array<{ id: string }> = [];
      for await (const resource of streamResources(mockFetch, 'test-resource')) {
        results.push(resource);
      }

      expect(results).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('main', () => {
    it('should successfully create backup', async () => {
      // Process.exit is already mocked in beforeEach, just await main
      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Verify backup directory was created
      const backupsDir = path.join(tempDir, 'backups');
      expect(fs.existsSync(backupsDir)).toBe(true);
    });

    it('should exit with code 1 on error', async () => {
      // Mock config loader to throw error
      MockedConfigLoader.mockImplementation(() => {
        throw new Error('Config load failed');
      });

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle API connection errors', async () => {
      mockCreateClient.mockRejectedValue(new Error('Connection failed'));

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should create backup with resources', async () => {
      const mockAssistant = {
        id: 'ast-1',
        name: 'Test Assistant',
        slug: 'test-assistant',
        system_prompt: 'Test',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Verify backup files were created
      const backupsDir = path.join(tempDir, 'backups');
      expect(fs.existsSync(backupsDir)).toBe(true);

      const backupDirs = fs.readdirSync(backupsDir);
      expect(backupDirs.length).toBeGreaterThan(0);
    });

    it('should preserve raw workflow YAML in backup.json but convert to assistant_name in workflow files', async () => {
      const mockAssistant = {
        id: 'ast-123',
        name: 'Code Reviewer',
        slug: 'code-reviewer',
        system_prompt: 'Review code',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
      };

      const mockWorkflow = {
        id: 'wf-1',
        name: 'Test Workflow',
        description: 'Test workflow',
        mode: 'Sequential',
        yaml_config: `assistants:
  - id: reviewer
    assistant_id: ast-123
states:
  - id: review
    assistant_id: reviewer
    task: Review code
    is_final: true`,
        created_date: new Date().toISOString(),
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValueOnce([mockWorkflow]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockWorkflow),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify backup.json has raw YAML with assistant_id
      const backupJson = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup.json'), 'utf8')) as {
        resources: { workflows: Array<{ yaml_config: string }> };
      };
      expect(backupJson.resources.workflows).toHaveLength(1);
      expect(backupJson.resources.workflows[0].yaml_config).toContain('assistant_id: ast-123');
      expect(backupJson.resources.workflows[0].yaml_config).not.toContain('assistant_name:');

      // Verify workflow file has converted YAML with assistant_name
      const workflowFile = path.join(backupDir, 'workflows', 'test-workflow.yaml');
      const workflowYaml = fs.readFileSync(workflowFile, 'utf8');
      expect(workflowYaml).toContain('assistant_name: Code Reviewer');
      expect(workflowYaml).not.toContain('assistant_id: ast-123');
    });

    it('should extract OpenAPI specs from toolkit settings and replace with file references in codemie.yaml', async () => {
      const largeOpenApiSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Coda API', version: '1.0.0' },
        paths: {
          '/docs': { get: { summary: 'Get docs', responses: { 200: { description: 'Success' } } } },
          '/tables': { get: { summary: 'Get tables', responses: { 200: { description: 'Success' } } } },
          '/rows': { post: { summary: 'Add row', responses: { 201: { description: 'Created' } } } },
        },
      });

      const mockIntegration = {
        id: 'int-coda-123',
        project_name: 'test-project',
        alias: 'Coda Integration',
        credential_type: 'OpenAPI',
        credential_values: [
          { key: 'url', value: 'https://coda.io/api' },
          { key: 'openapi_spec', value: largeOpenApiSpec },
        ],
        setting_type: 'project',
      };

      const mockAssistant = {
        id: 'ast-456',
        name: 'Coda Assistant',
        slug: 'coda-assistant',
        system_prompt: 'Help with Coda',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        toolkits: [
          {
            toolkit: 'OpenAPI',
            label: 'Coda API',
            settings_config: false,
            is_external: false,
            tools: [
              {
                name: 'coda_get_docs',
                label: 'Get Docs',
                settings_config: false,
                settings: mockIntegration,
              },
            ],
          },
        ],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValueOnce([mockIntegration]).mockResolvedValueOnce([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify OpenAPI spec was saved to file
      const openapiSpecsDir = path.join(backupDir, 'openapi_specs');
      expect(fs.existsSync(openapiSpecsDir)).toBe(true);
      const specFiles = fs.readdirSync(openapiSpecsDir);
      expect(specFiles.length).toBeGreaterThan(0);

      // Verify codemie.yaml uses file reference instead of full spec
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');

      // Should NOT contain the full OpenAPI spec
      expect(codemieYaml).not.toContain('"openapi":"3.0.0"');
      expect(codemieYaml).not.toContain('Get docs');
      expect(codemieYaml).not.toContain('Get tables');

      // Should contain file reference
      expect(codemieYaml).toContain('openapi_specs/');
      expect(codemieYaml.includes('.yaml') || codemieYaml.includes('.json')).toBe(true);
    });
  });

  describe('MCP servers backup', () => {
    it('should preserve all MCP server fields from SDK response', async () => {
      // SDK returns MCP servers with all these fields
      const mockAssistant = {
        id: 'ast-mcp-1',
        name: 'MCP Assistant',
        slug: 'mcp-assistant',
        system_prompt: 'Test prompt',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        mcp_servers: [
          {
            name: 'Playwright MCP Server',
            description: 'Playwright MCP Server',
            enabled: true,
            mcp_config_id: null,
            config: null,
            mcp_connect_url: '',
            tools_tokens_size_limit: null,
            command: null,
            arguments: null,
            settings: {
              id: 'integration-id-123',
              name: 'Playwright MCP',
              credential_type: 'MCP',
              alias: 'playwright_mcp',
            },
            mcp_connect_auth_token: null,
          },
        ],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify codemie.yaml preserves all MCP server fields from SDK
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('name: Playwright MCP Server');
      expect(codemieYaml).toContain('description: Playwright MCP Server');
      expect(codemieYaml).toContain('enabled: true');
      expect(codemieYaml).toContain('settings:');
      // Keys carrying no information are not written to the backup YAML
      expect(codemieYaml).not.toContain('config: null');
      expect(codemieYaml).not.toContain('mcp_connect_url: ""');
      expect(codemieYaml).not.toContain('tools_tokens_size_limit: null');
      expect(codemieYaml).not.toContain('command: null');
      expect(codemieYaml).not.toContain('arguments: null');
      expect(codemieYaml).not.toContain('mcp_connect_auth_token: null');
    });

    it('should preserve all MCP server fields including command/arguments', async () => {
      const mockAssistant = {
        id: 'ast-mcp-2',
        name: 'Figma Assistant',
        slug: 'figma-assistant',
        system_prompt: 'Test prompt',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        mcp_servers: [
          {
            name: 'Figma MCP',
            description: 'Figma integration',
            enabled: true,
            mcp_config_id: null,
            config: null,
            mcp_connect_url: '',
            tools_tokens_size_limit: null,
            command: 'npx',
            arguments: '-y figma-developer-mcp --stdio',
            settings: {
              id: 'integration-id-456',
              name: 'Figma_Codemie',
              credential_type: 'MCP',
              alias: 'mock_mcp',
            },
            mcp_connect_auth_token: null,
          },
        ],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify codemie.yaml preserves all MCP server fields from SDK
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('name: Figma MCP');
      expect(codemieYaml).toContain('description: Figma integration');
      expect(codemieYaml).toContain('enabled: true');
      expect(codemieYaml).toContain('command: npx');
      expect(codemieYaml).toContain('arguments: -y figma-developer-mcp --stdio');
      expect(codemieYaml).toContain('settings:');
      // Keys carrying no information are not written to the backup YAML
      expect(codemieYaml).not.toContain('config: null');
      expect(codemieYaml).not.toContain('mcp_connect_url: ""');
      expect(codemieYaml).not.toContain('tools_tokens_size_limit: null');
      expect(codemieYaml).not.toContain('mcp_config_id: null');
      expect(codemieYaml).not.toContain('mcp_connect_auth_token: null');
    });

    it('should replace mcp_connect_auth_token integration with $ref', async () => {
      // SDK returns mcp_connect_auth_token as integration object
      const mockIntegration = {
        id: 'integration-auth-123',
        name: 'MCP Auth Integration',
        credential_type: 'Bearer',
        alias: 'mcp_auth_bearer',
        setting_type: 'project',
        credential_values: [],
      };

      const mockAssistant = {
        id: 'ast-mcp-auth-1',
        name: 'MCP Assistant with Auth',
        slug: 'mcp-assistant-auth',
        system_prompt: 'Test prompt',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        mcp_servers: [
          {
            name: 'Authenticated MCP Server',
            description: 'MCP server with auth',
            enabled: true,
            mcp_config_id: null,
            config: null,
            mcp_connect_url: 'https://example.com/mcp',
            tools_tokens_size_limit: null,
            command: null,
            arguments: null,
            settings: null,
            mcp_connect_auth_token: {
              id: 'integration-auth-123',
              name: 'MCP Auth Integration',
              credential_type: 'Bearer',
              alias: 'mcp_auth_bearer',
            },
          },
        ],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValueOnce([mockIntegration]).mockResolvedValueOnce([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify codemie.yaml replaces mcp_connect_auth_token with $ref
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('name: Authenticated MCP Server');
      expect(codemieYaml).toContain('mcp_connect_auth_token:');
      expect(codemieYaml).toContain('$ref: imported.integrations.mcp_auth_bearer');

      // Verify that mcp_connect_auth_token contains only $ref, not the full integration object
      const mcpServerSection = codemieYaml.match(/mcp_servers:[\s\S]*?(?=\n\s{0,6}\w)/)?.[0] || '';
      expect(mcpServerSection).toContain('mcp_connect_auth_token:');
      expect(mcpServerSection).toContain('$ref: imported.integrations.mcp_auth_bearer');
      // Should NOT contain integration details in mcp_servers section
      const authTokenSection = mcpServerSection.match(/mcp_connect_auth_token:[\s\S]*?(?=\n\s{0,14}\w)/)?.[0] || '';
      expect(authTokenSection).not.toContain('id: integration-auth-123');
      expect(authTokenSection).not.toContain('name: MCP Auth Integration');
    });
  });

  describe('categories field backup', () => {
    it('should extract only category IDs from SDK response objects', async () => {
      // SDK returns categories as objects with id, name, description
      const mockAssistant = {
        id: 'ast-cat-1',
        name: 'Test Assistant with Categories',
        slug: 'test-assistant-categories',
        system_prompt: 'Test prompt',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        categories: [
          {
            id: 'development',
            name: 'Development',
            description: 'Development tools and workflows',
          },
          {
            id: 'testing',
            name: 'Testing',
            description: 'Testing and QA automation',
          },
          {
            id: 'code-review',
            name: 'Code Review',
            description: 'Code review assistance',
          },
        ],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify codemie.yaml contains only category IDs, not full objects
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('categories:');
      expect(codemieYaml).toContain('- development');
      expect(codemieYaml).toContain('- testing');
      expect(codemieYaml).toContain('- code-review');
      // Should NOT contain the full objects with name/description
      expect(codemieYaml).not.toContain('name: Development');
      expect(codemieYaml).not.toContain('name: Testing');
      expect(codemieYaml).not.toContain('name: Code Review');
    });

    it('should handle empty categories array', async () => {
      const mockAssistant = {
        id: 'ast-cat-2',
        name: 'Test Assistant Empty Categories',
        slug: 'test-assistant-empty-categories',
        system_prompt: 'Test prompt',
        llm_model_type: 'gpt-4',
        created_date: new Date().toISOString(),
        categories: [],
      };

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce([mockAssistant]).mockResolvedValueOnce([]),
          get: jest.fn().mockResolvedValue(mockAssistant),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      // Find backup directory
      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      expect(backupDirs.length).toBeGreaterThan(0);
      const backupDir = path.join(backupsDir, backupDirs[0]);

      // Verify codemie.yaml has empty categories array
      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('categories: []');
    });

    it('should skip fetching unreferenced external skills during backup', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValueOnce([
            { id: 'owned-skill-id', name: 'Owned Skill', project: 'test-project' },
            { id: 'external-skill-id', name: 'External Skill', project: 'other-project' },
          ]),
          get: jest.fn().mockResolvedValue({
            id: 'owned-skill-id',
            name: 'Owned Skill',
            description: 'Owned skill',
            content: '# Owned skill',
            project: 'test-project',
            categories: [],
          }),
          listCompanionFiles: jest.fn().mockResolvedValue([]),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockClient.skills.get).toHaveBeenCalledTimes(1);
      expect(mockClient.skills.get).toHaveBeenCalledWith('owned-skill-id');
    });

    it('should skip unreferenced external skills without project in list after fetching details', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: {
          list: jest.fn().mockResolvedValue([]),
        },
        workflows: {
          list: jest.fn().mockResolvedValue([]),
        },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'external-skill-id', name: 'External Skill' }]),
          get: jest.fn().mockResolvedValue({
            id: 'external-skill-id',
            name: 'External Skill',
            description: 'External skill',
            content: '# External skill',
            project: 'other-project',
            categories: [],
          }),
        },
        integrations: {
          list: jest.fn().mockResolvedValue([]),
        },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockClient.skills.get).toHaveBeenCalledWith('external-skill-id');

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);
      const backupJson = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup.json'), 'utf8')) as {
        resources: { skills: unknown[] };
      };

      expect(backupJson.resources.skills).toEqual([]);
    });
  });

  describe('skill companion files backup', () => {
    it('backs up a skill with companion files under skills/<name>/SKILL.md', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'sk-1', name: 'Doc Skill', project: 'test-project' }]),
          get: jest.fn().mockResolvedValue({
            id: 'sk-1',
            name: 'Doc Skill',
            description: 'Has companions',
            content: '# Doc Skill\nBody',
            project: 'test-project',
            categories: [],
          }),
          listCompanionFiles: jest
            .fn()
            .mockResolvedValue([
              { path: 'reference.md', mime_type: 'text/markdown', encoding: 'text', size_bytes: 16 },
            ]),
          getCompanionFile: jest.fn().mockResolvedValue({
            path: 'reference.md',
            mime_type: 'text/markdown',
            encoding: 'text',
            size_bytes: 16,
            content: '# Reference doc',
          }),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const skillMdPath = path.join(backupDir, 'skills', 'doc-skill', 'SKILL.md');
      expect(fs.readFileSync(skillMdPath, 'utf8')).toBe('# Doc Skill\nBody');

      const companionPath = path.join(backupDir, 'skills', 'doc-skill', 'reference.md');
      expect(fs.readFileSync(companionPath, 'utf8')).toBe('# Reference doc');

      expect(mockClient.skills.listCompanionFiles).toHaveBeenCalledWith('sk-1');
      expect(mockClient.skills.getCompanionFile).toHaveBeenCalledWith('sk-1', 'reference.md');

      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('file: skills/doc-skill/SKILL.md');
    });

    it('keeps skills/<name>.skill.md unchanged for a skill with no companion files', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'sk-2', name: 'Plain Skill', project: 'test-project' }]),
          get: jest.fn().mockResolvedValue({
            id: 'sk-2',
            name: 'Plain Skill',
            description: 'No companions',
            content: '# Plain Skill\nBody',
            project: 'test-project',
            categories: [],
          }),
          listCompanionFiles: jest.fn().mockResolvedValue([]),
          getCompanionFile: jest.fn(),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const flatSkillPath = path.join(backupDir, 'skills', 'plain-skill.skill.md');
      expect(fs.readFileSync(flatSkillPath, 'utf8')).toBe('# Plain Skill\nBody');
      expect(fs.existsSync(path.join(backupDir, 'skills', 'plain-skill'))).toBe(false);
      expect(mockClient.skills.getCompanionFile).not.toHaveBeenCalled();

      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('file: skills/plain-skill.skill.md');
    });

    it('writes a punctuated skill name to the very path its generated YAML references', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([
            { id: 'sk-p1', name: 'C++ Helper', project: 'test-project' },
            { id: 'sk-p2', name: 'Code_Review', project: 'test-project' },
          ]),
          get: jest.fn().mockImplementation((id: string) =>
            Promise.resolve(
              id === 'sk-p1'
                ? {
                    id: 'sk-p1',
                    name: 'C++ Helper',
                    description: 'Punctuated with companions',
                    content: '# C++ Helper',
                    project: 'test-project',
                    categories: [],
                  }
                : {
                    id: 'sk-p2',
                    name: 'Code_Review',
                    description: 'Punctuated flat',
                    content: '# Code Review',
                    project: 'test-project',
                    categories: [],
                  }
            )
          ),
          listCompanionFiles: jest
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === 'sk-p1'
                  ? [{ path: 'reference.md', mime_type: 'text/markdown', encoding: 'text', size_bytes: 9 }]
                  : []
              )
            ),
          getCompanionFile: jest.fn().mockResolvedValue({
            path: 'reference.md',
            mime_type: 'text/markdown',
            encoding: 'text',
            size_bytes: 9,
            content: 'reference',
          }),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const codemieYaml = fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8');
      const referencedFiles = [...codemieYaml.matchAll(/file:\s*(skills\/\S+)/g)].map((match) => match[1]);

      expect(referencedFiles).toEqual(
        expect.arrayContaining(['skills/c-helper/SKILL.md', 'skills/code-review.skill.md'])
      );

      // Every path the generated YAML points at must be a file the backup actually wrote.
      for (const relPath of referencedFiles) {
        expect(fs.existsSync(path.join(backupDir, relPath))).toBe(true);
      }

      expect(fs.readFileSync(path.join(backupDir, 'skills', 'c-helper', 'reference.md'), 'utf8')).toBe('reference');
    });

    it('refuses a companion path escaping the skill directory and writes nothing outside it', async () => {
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'sk-esc', name: 'Escape Skill', project: 'test-project' }]),
          get: jest.fn().mockResolvedValue({
            id: 'sk-esc',
            name: 'Escape Skill',
            description: 'Hostile companion path',
            content: '# Escape Skill',
            project: 'test-project',
            categories: [],
          }),
          listCompanionFiles: jest
            .fn()
            .mockResolvedValue([{ path: '../escape.txt', mime_type: 'text/plain', encoding: 'text', size_bytes: 5 }]),
          getCompanionFile: jest.fn().mockResolvedValue({
            path: '../escape.txt',
            mime_type: 'text/plain',
            encoding: 'text',
            size_bytes: 5,
            content: 'pwned',
          }),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      // A hostile path for a single named resource fails the backup loudly rather than being
      // skipped with a warning.
      expect(process.exit).toHaveBeenCalledWith(1);

      const escapedFiles: string[] = [];
      const collect = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collect(full);
            continue;
          }
          if (entry.name === 'escape.txt') {
            escapedFiles.push(full);
          }
        }
      };
      collect(tempDir);

      expect(escapedFiles).toEqual([]);

      const errors = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(errors).toContain('../escape.txt');
    });

    it('lists a skill once in the generated YAML when a retried companion lookup finally succeeds', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'sk-retry', name: 'Retry Skill', project: 'test-project' }]),
          get: jest.fn().mockResolvedValue({
            id: 'sk-retry',
            name: 'Retry Skill',
            description: 'Retried once',
            content: '# Retry Skill',
            project: 'test-project',
            categories: [],
          }),
          // The retryable failure lands after the resource would once have been pushed, so a
          // second attempt used to append a duplicate entry to the backup YAML.
          listCompanionFiles: jest.fn().mockRejectedValueOnce(new Error('429 Too Many Requests')).mockResolvedValue([]),
          getCompanionFile: jest.fn(),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockClient.skills.listCompanionFiles).toHaveBeenCalledTimes(2);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const codemieYaml = yaml.parse(fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8'));
      const retryEntries = (codemieYaml.resources.skills ?? []).filter(
        (entry: { name?: string }) => entry.name === 'Retry Skill'
      );
      expect(retryEntries).toHaveLength(1);
    });

    it('keeps a permanently failing skill out of the generated YAML', async () => {
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      const goodSkills = ['Good One', 'Good Two', 'Good Three', 'Good Four'].map((name, index) => ({
        id: `sk-good-${index}`,
        name,
        project: 'test-project',
      }));

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          // Four healthy skills keep the failure rate at the tolerated 20%, so the backup still
          // finishes and the YAML it generates can be inspected.
          list: jest
            .fn()
            .mockResolvedValueOnce([...goodSkills, { id: 'sk-esc2', name: 'Escape Skill', project: 'test-project' }]),
          get: jest.fn().mockImplementation((id: string) =>
            Promise.resolve({
              id,
              name: id === 'sk-esc2' ? 'Escape Skill' : goodSkills.find((skill) => skill.id === id)?.name,
              description: 'desc',
              content: '# Body',
              project: 'test-project',
              categories: [],
            })
          ),
          listCompanionFiles: jest
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === 'sk-esc2'
                  ? [{ path: '../escape.txt', mime_type: 'text/plain', encoding: 'text', size_bytes: 5 }]
                  : []
              )
            ),
          getCompanionFile: jest.fn().mockResolvedValue({
            path: '../escape.txt',
            mime_type: 'text/plain',
            encoding: 'text',
            size_bytes: 5,
            content: 'pwned',
          }),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const codemieYaml = yaml.parse(fs.readFileSync(path.join(backupDir, 'codemie.yaml'), 'utf8'));
      const names = (codemieYaml.resources.skills ?? []).map((entry: { name?: string }) => entry.name);
      expect(names).not.toContain('Escape Skill');
      expect(names).toEqual(expect.arrayContaining(['Good One', 'Good Two', 'Good Three', 'Good Four']));
    });

    it('writes a base64-encoded companion file back to its exact original bytes', async () => {
      const binaryBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
      const base64Content = binaryBytes.toString('base64');

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          getTools: jest.fn().mockResolvedValue([]),
        },
        datasources: { list: jest.fn().mockResolvedValue([]) },
        workflows: { list: jest.fn().mockResolvedValue([]) },
        skills: {
          list: jest.fn().mockResolvedValueOnce([{ id: 'sk-3', name: 'Image Skill', project: 'test-project' }]),
          get: jest.fn().mockResolvedValue({
            id: 'sk-3',
            name: 'Image Skill',
            description: 'Has a binary companion',
            content: '# Image Skill',
            project: 'test-project',
            categories: [],
          }),
          listCompanionFiles: jest
            .fn()
            .mockResolvedValue([
              { path: 'logo.png', mime_type: 'image/png', encoding: 'base64', size_bytes: binaryBytes.length },
            ]),
          getCompanionFile: jest.fn().mockResolvedValue({
            path: 'logo.png',
            mime_type: 'image/png',
            encoding: 'base64',
            size_bytes: binaryBytes.length,
            content: base64Content,
          }),
        },
        integrations: { list: jest.fn().mockResolvedValue([]) },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      await main(backupOptions);

      expect(process.exit).toHaveBeenCalledWith(0);

      const backupsDir = path.join(tempDir, 'backups');
      const backupDirs = fs.readdirSync(backupsDir).filter((dir) => !dir.startsWith('.temp'));
      const backupDir = path.join(backupsDir, backupDirs[0]);

      const companionPath = path.join(backupDir, 'skills', 'image-skill', 'logo.png');
      const writtenBytes = fs.readFileSync(companionPath);
      expect(Buffer.compare(writtenBytes, binaryBytes)).toBe(0);
    });
  });

  describe('backup round trip / redeploy compatibility', () => {
    it('a backup-shaped skills/<name>/SKILL.md layout is redeploy-ready with no source_dir', () => {
      const skillDir = path.join(tempDir, 'skills', 'doc-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Doc Skill');
      fs.writeFileSync(path.join(skillDir, 'reference.md'), '# Reference doc');

      // A plain hand-written skill entry pointing at the restored SKILL.md — no source_dir anywhere.
      const skillResource: SkillResource = {
        name: 'Doc Skill',
        description: 'desc',
        file: 'skills/doc-skill/SKILL.md',
      };

      expect(hasCompanionFileLayout(skillResource)).toBe(true);
      expect('source_dir' in skillResource).toBe(false);

      const companions = collectCompanionFiles(skillDir);
      expect(companions).toEqual([
        expect.objectContaining({ path: 'reference.md', content: '# Reference doc', encoding: 'text' }),
      ]);
    });
  });

  describe('checksum consistency', () => {
    it('should produce same checksum for identical assistant configs', () => {
      const config1 = { name: 'test', description: 'Test', model: 'gpt-4', toolkits: [] };
      const config2 = { name: 'test', description: 'Test', model: 'gpt-4', toolkits: [] };

      const checksum1 = calculateAssistantConfigChecksum(config1 as unknown as AssistantResource);
      const checksum2 = calculateAssistantConfigChecksum(config2 as unknown as AssistantResource);

      expect(checksum1).toBe(checksum2);
    });

    it('should produce same checksum regardless of undefined vs missing fields', () => {
      const configWithUndefined = {
        name: 'test',
        description: 'Test',
        model: 'gpt-4',
        toolkits: [],
        temperature: undefined,
        shared: undefined,
      };
      const configWithoutFields = { name: 'test', description: 'Test', model: 'gpt-4', toolkits: [] };

      const checksum1 = calculateAssistantConfigChecksum(configWithUndefined as unknown as AssistantResource);
      const checksum2 = calculateAssistantConfigChecksum(configWithoutFields as unknown as AssistantResource);

      expect(checksum1).toBe(checksum2);
    });

    it('should produce same checksum for SDK response converted to resource', () => {
      const sdkResponse = {
        id: 'ast-123',
        name: 'test-assistant',
        slug: 'test-assistant',
        description: 'Test',
        llm_model_type: 'gpt-4',
        system_prompt: 'Test',
        created_date: '2025-01-01T00:00:00Z',
        shared: false,
        is_react: false,
        is_global: false,
        toolkits: [],
      };

      const resource = assistantResponseToResource(sdkResponse as never);
      const yamlConfig = {
        name: 'test-assistant',
        description: 'Test',
        model: 'gpt-4',
        toolkits: [],
        shared: false,
        is_react: false,
        is_global: false,
      };

      expect(calculateAssistantConfigChecksum(resource)).toBe(
        calculateAssistantConfigChecksum(yamlConfig as unknown as AssistantResource)
      );
    });

    it('checksum from a transformed mcp server should not depend on API key order', () => {
      const integrationMap = new Map<string, string>([['int-gitlab-1', 'GitLab Connection']]);
      const apiOrder = {
        name: 'gitlab-mcp',
        enabled: true,
        command: 'npx',
        config: { command: 'npx', env: { TOKEN: 'x', REGION: 'eu' } },
        settings: { id: 'int-gitlab-1', alias: 'GitLab Connection' },
      } as unknown as MCPServerDetails;

      // Same server, fields served in a different order after a platform release
      const shuffledApiOrder = {
        settings: { alias: 'GitLab Connection', id: 'int-gitlab-1' },
        config: { env: { REGION: 'eu', TOKEN: 'x' }, command: 'npx' },
        command: 'npx',
        enabled: true,
        name: 'gitlab-mcp',
      } as unknown as MCPServerDetails;

      const base = { name: 'test', description: 'Test', model: 'gpt-4' };
      const fromApiOrder = {
        ...base,
        mcp_servers: [transformMcpServer(apiOrder, integrationMap)],
      } as unknown as AssistantResource;
      const fromShuffled = {
        ...base,
        mcp_servers: [transformMcpServer(shuffledApiOrder, integrationMap)],
      } as unknown as AssistantResource;

      // And the same server as a hand-written YAML block, in yet another order
      const fromYaml = {
        ...base,
        mcp_servers: [
          {
            command: 'npx',
            config: { env: { TOKEN: 'x', REGION: 'eu' }, command: 'npx' },
            settings: { $ref: 'imported.integrations.GitLab Connection' },
            name: 'gitlab-mcp',
            enabled: true,
          },
        ],
      } as unknown as AssistantResource;

      const expected = calculateAssistantConfigChecksum(fromApiOrder);

      expect(calculateAssistantConfigChecksum(fromShuffled)).toBe(expected);
      expect(calculateAssistantConfigChecksum(fromYaml)).toBe(expected);
    });

    it('checksum from transformed toolkits should match backup flow', () => {
      const integrationMap = new Map<string, string>([['int-jira-123', 'Jira Server']]);
      const sdkToolkits = [
        {
          toolkit: 'jira',
          label: 'Jira',
          settings_config: false,
          is_external: false,
          tools: [
            {
              name: 'jira_get_issue',
              label: 'Get Issue',
              settings_config: false,
              settings: {
                id: 'int-jira-123',
                alias: 'Jira Server',
                credential_type: 'Jira',
                credential_values: [],
                setting_type: 'project',
              },
            },
          ],
        },
      ] as unknown as ToolKitDetails[];

      const transformedToolkits = transformToolkits(sdkToolkits, integrationMap, new Map());
      const finalConfig = { name: 'test', description: 'Test', model: 'gpt-4', toolkits: transformedToolkits };
      const checksumFromBackup = calculateAssistantConfigChecksum(finalConfig as AssistantResource);

      // Config from YAML must match exact structure that transformToolkits produces
      // Order of fields must match transformToolkits output: toolkit, tools, label, settings_config, is_external
      const configFromYaml = {
        name: 'test',
        description: 'Test',
        model: 'gpt-4',
        toolkits: [
          {
            toolkit: 'jira',
            tools: [
              {
                name: 'jira_get_issue',
                settings_config: false,
                label: 'Get Issue',
                settings: { $ref: 'imported.integrations.Jira Server' },
              },
            ],
            label: 'Jira',
            settings_config: false,
            is_external: false,
          },
        ],
      };

      expect(checksumFromBackup).toBe(calculateAssistantConfigChecksum(configFromYaml as AssistantResource));
    });
  });
});
