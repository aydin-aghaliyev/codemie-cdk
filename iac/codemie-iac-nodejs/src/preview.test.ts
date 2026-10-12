/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { CodeMieClient } from 'codemie-sdk';

import type { AppConfig } from './appConfig';
import { calculateChecksum, calculateAssistantConfigChecksum } from './lib/checksumUtils';
import { createClient } from './lib/clientFactory';
import { calculateWorkflowConfigChecksum, calculateDatasourceConfigChecksum } from './lib/codemieConfigChecksums';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { logger } from './lib/logger';
import {
  previewOrphanedResources,
  previewDatasources,
  previewWorkflows,
  previewAssistants,
  previewSkills,
} from './lib/previewUtils';
import { collectCompanionFiles } from './lib/skillCompanionFiles';
import { StateManager } from './lib/stateManager';
import { main, previewChanges } from './preview';
import type {
  AssistantResource,
  CodemieConfig,
  DatasourceResource,
  SkillResource,
  WorkflowResource,
} from './types/codemieConfig';

jest.mock('./lib/clientFactory');

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

// Helper to create AppConfig for testing
function createAppConfig(rootDir: string): AppConfig {
  return {
    rootDir,
    codemieConfig: 'codemie.yaml',
    codemieState: '.codemie/state.json',
    backupsDirectory: '.codemie/backups',
  };
}

function createPreviewConfig(overrides: Partial<CodemieConfig> = {}): CodemieConfig {
  return {
    version: '1',
    project: { name: 'test-project', description: 'Test' },
    environment: {
      codemie_api_url: 'https://api.example.com',
      auth_server_url: 'https://auth.example.com',
      auth_realm_name: 'test',
    },
    imported: { assistants: [], datasources: [], skills: [], integrations: [] },
    resources: {},
    ...overrides,
  };
}

// Mock client helper
function createMockClient(existingIds: string[] = []): CodeMieClient {
  return {
    assistants: {
      get: jest.fn((id: string) => {
        if (existingIds.includes(id)) {
          return Promise.resolve({ id, name: 'Mock Assistant' });
        }
        return Promise.reject(new Error('Not found'));
      }),
    },
    datasources: {
      get: jest.fn((id: string) => {
        if (existingIds.includes(id)) {
          return Promise.resolve({ id, name: 'Mock Datasource' });
        }
        return Promise.reject(new Error('Not found'));
      }),
    },
    workflows: {
      get: jest.fn((id: string) => {
        if (existingIds.includes(id)) {
          return Promise.resolve({ id, name: 'Mock Workflow' });
        }
        return Promise.reject(new Error('Not found'));
      }),
    },
  } as unknown as CodeMieClient;
}

describe('preview.ts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('previewOrphanedResources', () => {
    it('should create delete changes for orphaned assistants', () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const orphaned = {
        assistants: ['Orphaned Assistant'],
        datasources: [],
        workflows: [],
      };

      const changes = previewOrphanedResources(orphaned, stateManager);

      expect(changes).toHaveLength(1);
      expect(changes[0]?.type).toBe('delete');
      expect(changes[0]?.resourceType).toBe('assistant');
      expect(changes[0]?.name).toBe('Orphaned Assistant');
    });

    it('should return empty array when no orphans', () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const orphaned = { assistants: [], datasources: [], workflows: [] };

      const changes = previewOrphanedResources(orphaned, stateManager);

      expect(changes).toHaveLength(0);
    });

    it('should handle multiple orphaned resources', () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const orphaned = {
        assistants: ['Assistant 1', 'Assistant 2'],
        datasources: ['Datasource 1'],
        workflows: ['Workflow 1'],
      };

      const changes = previewOrphanedResources(orphaned, stateManager);

      expect(changes).toHaveLength(4);
      expect(changes.filter((c) => c.resourceType === 'assistant')).toHaveLength(2);
      expect(changes.filter((c) => c.resourceType === 'datasource')).toHaveLength(1);
      expect(changes.filter((c) => c.resourceType === 'workflow')).toHaveLength(1);
    });

    it('should include resource IDs in details when available', () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const assistant: AssistantResource = {
        name: 'Test Assistant',
        prompt: 'test.md',
        model: 'gpt-4',
        description: 'Test',
      };
      stateManager.updateAssistantState('Test Assistant', 'ast-uuid-123', 'prompt', assistant);

      const orphaned = {
        assistants: ['Test Assistant'],
        datasources: [],
        workflows: [],
      };

      const changes = previewOrphanedResources(orphaned, stateManager);

      expect(changes[0]?.details).toContain('ast-uuid');
    });
  });

  describe('previewAssistants', () => {
    it('should detect new assistants', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const client = createMockClient();

      // Create test prompt file
      fs.writeFileSync(path.join(tempDir, 'test.md'), 'You are helpful');

      const assistants: AssistantResource[] = [
        {
          name: 'New Assistant',
          prompt: 'test.md', // Use relative path
          model: 'gpt-4',
          description: 'Test',
        },
      ];

      const loader = new CodemieConfigLoader(appConfig);
      const changes = await previewAssistants(assistants, loader, stateManager, client, createPreviewConfig());

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes.some((c) => c.type === 'create' && c.name === 'New Assistant')).toBe(true);
    });

    it('should detect assistant updates when prompt changes', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      // Create test prompt file
      const promptPath = 'test.md'; // Use relative path
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      // Set initial state
      const assistant: AssistantResource = {
        name: 'Test Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      stateManager.updateAssistantState('Test Assistant', 'ast-123', prompt, assistant);

      // Modify prompt
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are now more helpful');

      const assistants: AssistantResource[] = [assistant];
      const client = createMockClient(['ast-123']);
      const changes = await previewAssistants(assistants, loader, stateManager, client, createPreviewConfig());

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes.some((c) => c.type === 'update' && c.name === 'Test Assistant')).toBe(true);
    });

    it('should detect no-change when content is identical', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md'; // Use relative path
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Test Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      stateManager.updateAssistantState('Test Assistant', 'ast-123', prompt, assistant);

      const assistants: AssistantResource[] = [assistant];
      const client = createMockClient(['ast-123']);
      const changes = await previewAssistants(assistants, loader, stateManager, client, createPreviewConfig());

      expect(changes.some((c) => c.type === 'no-change' && c.name === 'Test Assistant')).toBe(true);
    });

    it('should detect config changes', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md'; // Use relative path
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Test Assistant',
        prompt: promptPath,
        model: 'gpt-4o', // Changed from gpt-4
        description: 'Test',
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      const oldAssistant: AssistantResource = {
        name: 'Test Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
      };
      stateManager.updateAssistantState('Test Assistant', 'ast-123', prompt, oldAssistant);

      const assistants: AssistantResource[] = [assistant];
      const client = createMockClient(['ast-123']);
      const changes = await previewAssistants(assistants, loader, stateManager, client, createPreviewConfig());

      expect(changes.some((c) => c.type === 'update' && c.name === 'Test Assistant')).toBe(true);
    });

    it('should use consistent checksum calculation regardless of field order', async () => {
      // BUG REPRODUCTION: Similar to datasource issue
      // deploy.ts uses normalizeAssistantConfig (which orders fields consistently)
      // but may pass unsorted JSON to StateManager
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      // Assistant with fields in specific order
      const assistant1: AssistantResource = {
        name: 'Test Assistant',
        description: 'Test description',
        prompt: promptPath,
        model: 'gpt-4',
        temperature: 0.7,
        shared: true,
      };

      // Same assistant with fields in different order
      const assistant2: AssistantResource = {
        shared: true,
        temperature: 0.7,
        model: 'gpt-4',
        prompt: promptPath,
        description: 'Test description',
        name: 'Test Assistant',
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant1.prompt);

      // Simulate state saved by deploy.ts
      // Currently deploy.ts does: JSON.stringify(normalizeAssistantConfig(assistant, buildConfig))
      // This may not be sorted if normalizeAssistantConfig doesn't guarantee order
      const checksum1 = calculateAssistantConfigChecksum(assistant1, null);
      const checksum2 = calculateAssistantConfigChecksum(assistant2, null);

      // Both should produce same checksum (normalizeAssistantConfig ensures consistent field order)
      expect(checksum2).toBe(checksum1);

      // Save state with assistant1's checksum
      stateManager.updateAssistantState('Test Assistant', 'ast-123', prompt, assistant1);

      // Mock client
      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-123') {
              return Promise.resolve({ id: 'ast-123', name: 'Test Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
      } as unknown as CodeMieClient;

      // Preview assistant2 (same config, different field order)
      const assistants: AssistantResource[] = [assistant2];
      const changes = await previewAssistants(assistants, loader, stateManager, mockClient, createPreviewConfig());

      // Should be 'no-change' because configs are identical
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('no-change');
      expect(changes[0].name).toBe('Test Assistant');
    });

    it('should detect skill attachment drift when config unchanged but platform skills mismatch', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Skill Drift Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
        skills: ['my-skill'],
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      stateManager.updateAssistantState('Skill Drift Assistant', 'ast-drift-1', prompt, assistant);
      stateManager.updateSkillState('my-skill', 'skill-uuid-1', 'content', {
        name: 'my-skill',
        description: 'A skill',
        file: 'skills/my-skill.skill.md',
      });

      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-drift-1') {
              return Promise.resolve({ id, name: 'Skill Drift Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
        skills: {
          getAssistantSkills: jest.fn().mockResolvedValue([]),
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants(
        [assistant],
        loader,
        stateManager,
        mockClient,
        createPreviewConfig({
          resources: {
            skills: [{ name: 'my-skill', description: 'A skill', file: 'skills/my-skill.skill.md' }],
          },
        })
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('update');
      expect(changes[0].details).toBe('Skill attachments out of sync with platform');
    });

    it('should report no-change when skills match platform', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Skill Match Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
        skills: ['my-skill'],
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      stateManager.updateAssistantState('Skill Match Assistant', 'ast-match-1', prompt, assistant);
      stateManager.updateSkillState('my-skill', 'skill-uuid-1', 'content', {
        name: 'my-skill',
        description: 'A skill',
        file: 'skills/my-skill.skill.md',
      });

      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-match-1') {
              return Promise.resolve({ id, name: 'Skill Match Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
        skills: {
          getAssistantSkills: jest.fn().mockResolvedValue([{ id: 'skill-uuid-1', name: 'my-skill' }]),
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants(
        [assistant],
        loader,
        stateManager,
        mockClient,
        createPreviewConfig({
          resources: {
            skills: [{ name: 'my-skill', description: 'A skill', file: 'skills/my-skill.skill.md' }],
          },
        })
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('no-change');
    });

    it('should detect skill attachment drift using imported.skills without state entry', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Imported Skill Drift Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
        skills: ['marketplace-skill'],
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);
      stateManager.updateAssistantState('Imported Skill Drift Assistant', 'ast-imported-drift', prompt, assistant);

      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-imported-drift') {
              return Promise.resolve({ id, name: 'Imported Skill Drift Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
        skills: {
          getAssistantSkills: jest.fn().mockResolvedValue([]),
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants(
        [assistant],
        loader,
        stateManager,
        mockClient,
        createPreviewConfig({
          imported: {
            assistants: [],
            datasources: [],
            skills: [{ name: 'marketplace-skill', id: 'skill-imported-id' }],
            integrations: [],
          },
        })
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('update');
      expect(changes[0].details).toBe('Skill attachments out of sync with platform');
    });

    it('should flag unresolved skill references during preview', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'Unresolved Skill Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
        skills: ['missing-skill'],
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);
      stateManager.updateAssistantState('Unresolved Skill Assistant', 'ast-unresolved-skill', prompt, assistant);

      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-unresolved-skill') {
              return Promise.resolve({ id, name: 'Unresolved Skill Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
        skills: {
          getAssistantSkills: jest.fn().mockResolvedValue([]),
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants([assistant], loader, stateManager, mockClient, createPreviewConfig());

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('update');
      expect(changes[0].details).toBe('Unresolved skill reference(s): missing-skill');
    });

    it('should flag unresolved skill references for new assistants during preview', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'New Unresolved Skill Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
        skills: ['missing-skill'],
      };

      const loader = new CodemieConfigLoader(appConfig);
      const mockClient = {
        assistants: {
          get: jest.fn().mockRejectedValue(new Error('Not found')),
        },
        skills: {
          getAssistantSkills: jest.fn(),
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants([assistant], loader, stateManager, mockClient, createPreviewConfig());

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('create');
      expect(changes[0].details).toBe('Unresolved skill reference(s): missing-skill');
      expect(mockClient.skills.getAssistantSkills).not.toHaveBeenCalled();
    });

    it('should skip skill drift check when skills field is undefined', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const promptPath = 'test.md';
      fs.writeFileSync(path.join(tempDir, promptPath), 'You are helpful');

      const assistant: AssistantResource = {
        name: 'No Skills Field Assistant',
        prompt: promptPath,
        model: 'gpt-4',
        description: 'Test',
      };

      const loader = new CodemieConfigLoader(appConfig);
      const prompt = loader.loadPrompt(assistant.prompt);

      stateManager.updateAssistantState('No Skills Field Assistant', 'ast-noskill-1', prompt, assistant);

      const getAssistantSkillsMock = jest.fn();
      const mockClient = {
        assistants: {
          get: jest.fn((id: string) => {
            if (id === 'ast-noskill-1') {
              return Promise.resolve({ id, name: 'No Skills Field Assistant' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
        skills: {
          getAssistantSkills: getAssistantSkillsMock,
        },
      } as unknown as CodeMieClient;

      const changes = await previewAssistants([assistant], loader, stateManager, mockClient, createPreviewConfig());

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('no-change');
      expect(getAssistantSkillsMock).not.toHaveBeenCalled();
    });
  });

  describe('previewDatasources', () => {
    it('should use consistent checksum calculation regardless of key order', async () => {
      // BUG REPRODUCTION: This test will FAIL before fix
      // preview.ts uses JSON.stringify without sorting, deploy.ts uses calculateDatasourceConfigChecksum with sorting
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      // Datasource with keys in one order
      const datasource1: DatasourceResource = {
        name: 'test-datasource',
        type: 'code',
        link: 'https://example.com/repo',
        description: 'Test datasource',
        branch: 'main',
      };

      // Same datasource with keys in different order (simulates YAML parsing or refactoring)
      const datasource2: DatasourceResource = {
        branch: 'main',
        description: 'Test datasource',
        link: 'https://example.com/repo',
        name: 'test-datasource',
        type: 'code',
      };

      // Simulate state saved by deploy.ts (which now uses DatasourceResource directly)
      stateManager.updateDatasourceState('test-datasource', 'ds-123', datasource1);

      // Verify both datasources should produce same checksum
      const checksum1 = calculateDatasourceConfigChecksum(datasource1);
      const checksum2 = calculateDatasourceConfigChecksum(datasource2);
      expect(checksum2).toBe(checksum1);

      // Mock client - must have both list() and get() methods
      const mockClient = {
        datasources: {
          list: jest.fn().mockResolvedValue({
            data: {
              items: [{ name: 'test-datasource', id: 'ds-123' }],
            },
          }),
          get: jest.fn((id: string) => {
            if (id === 'ds-123') {
              return Promise.resolve({ id: 'ds-123', name: 'test-datasource' });
            }
            return Promise.reject(new Error('Not found'));
          }),
        },
      } as unknown as CodeMieClient;

      // Preview datasource2 (same config, different key order)
      const changes = await previewDatasources([datasource2], stateManager, mockClient);

      // BUG: Currently fails because preview.ts doesn't sort keys before JSON.stringify
      // EXPECTED: Should be 'no-change' because configs are identical
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('no-change');
      expect(changes[0].name).toBe('test-datasource');
    });

    it('should treat datasource as unchanged when state checksum is stale but platform config matches', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const datasource: DatasourceResource = {
        name: 'legacy-checksum-ds',
        type: 'code',
        description: 'Datasource imported from legacy state',
        link: 'https://example.com/repo',
        branch: 'main',
        index_type: 'code',
        embeddings_model: 'amazon.titan-embed-text-v2:0',
        summarization_model: 'claude-3-7',
        files_filter: '',
        setting_id: 'setting-123',
        shared_with_project: true,
      };

      stateManager.updateDatasourceState(datasource.name, 'ds-legacy-123', datasource);

      // Simulate legacy/stale checksum in state
      const statePath = path.join(tempDir, '.codemie', 'state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.resources.datasources[datasource.name].configChecksum = 'stale-checksum-from-older-cdk';
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

      const mockClient = {
        datasources: {
          list: jest.fn().mockResolvedValue({
            data: {
              items: [{ name: datasource.name, id: 'ds-legacy-123' }],
            },
          }),
          get: jest.fn((id: string) => {
            if (id !== 'ds-legacy-123') {
              return Promise.reject(new Error('Not found'));
            }

            return Promise.resolve({
              id,
              name: datasource.name,
              type: 'code',
              description: datasource.description,
              embeddings_model: datasource.embeddings_model,
              setting_id: datasource.setting_id,
              shared_with_project: datasource.shared_with_project,
              code: {
                link: datasource.link,
                branch: datasource.branch,
                indexType: datasource.index_type,
                summarizationModel: datasource.summarization_model,
                filesFilter: datasource.files_filter,
              },
            });
          }),
        },
      } as unknown as CodeMieClient;

      const changes = await previewDatasources([datasource], stateManager, mockClient);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('no-change');
      expect(changes[0].name).toBe(datasource.name);
    });

    it('should detect new datasources', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const datasources: DatasourceResource[] = [
        {
          name: 'New DS',
          type: 'code',
          description: 'Test',
          link: 'https://github.com/test/repo',
          branch: 'main',
          setting_id: 'setting-123',
        } as DatasourceResource,
      ];

      const client = createMockClient(['ds-123']);
      const changes = await previewDatasources(datasources, stateManager, client);

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes.some((c) => c.type === 'create' && c.name === 'New DS')).toBe(true);
    });

    it('should detect datasource updates', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const originalDatasource: DatasourceResource = {
        name: 'Test DS',
        type: 'code',
        description: 'Test',
        link: 'https://github.com/test/repo',
        branch: 'develop', // Original branch
        setting_id: 'setting-123',
      } as DatasourceResource;

      const updatedDatasource: DatasourceResource = {
        name: 'Test DS',
        type: 'code',
        description: 'Test',
        link: 'https://github.com/test/repo',
        branch: 'main', // Changed branch!
        setting_id: 'setting-123',
      } as DatasourceResource;

      stateManager.updateDatasourceState('Test DS', 'ds-123', originalDatasource);

      const datasources: DatasourceResource[] = [updatedDatasource];
      const client = createMockClient(['ds-123']);
      const changes = await previewDatasources(datasources, stateManager, client);

      expect(changes.some((c) => c.type === 'update' && c.name === 'Test DS')).toBe(true);
    });

    it('should detect no-change for identical datasources', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const datasource: DatasourceResource = {
        name: 'Test DS',
        type: 'code',
        description: 'Test',
        link: 'https://github.com/test/repo',
        branch: 'main',
        setting_id: 'setting-123',
      } as DatasourceResource;

      stateManager.updateDatasourceState('Test DS', 'ds-123', datasource);

      const datasources: DatasourceResource[] = [datasource];
      const client = createMockClient(['ds-123']);
      const changes = await previewDatasources(datasources, stateManager, client);

      expect(changes.some((c) => c.type === 'no-change' && c.name === 'Test DS')).toBe(true);
    });

    it('should always trigger reindex when force_reindex is true', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);

      const datasourceWithoutReindex: DatasourceResource = {
        name: 'Test DS',
        type: 'code',
        description: 'Test',
        link: 'https://github.com/test/repo',
        branch: 'main',
        setting_id: 'setting-123',
      } as DatasourceResource;

      const datasourceWithReindex: DatasourceResource = {
        name: 'Test DS',
        type: 'code',
        description: 'Test',
        link: 'https://github.com/test/repo',
        branch: 'main',
        setting_id: 'setting-123',
        force_reindex: true,
      } as DatasourceResource;

      // Save state without force_reindex
      stateManager.updateDatasourceState('Test DS', 'ds-123', datasourceWithoutReindex);

      const datasources: DatasourceResource[] = [datasourceWithReindex];
      const client = createMockClient(['ds-123']);
      const changes = await previewDatasources(datasources, stateManager, client);

      // Should be update, not no-change, due to force_reindex
      expect(changes.some((c) => c.name === 'Test DS' && (c.type === 'update' || c.details?.includes('reindex')))).toBe(
        true
      );
    });
  });

  describe('previewSkills', () => {
    it('diffs a content-only skill without reading any file from disk', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const loader = new CodemieConfigLoader(appConfig);
      const skill: SkillResource = { name: 'Inline', description: 'Inline desc', content: 'new inline body' };

      // Deliberately no file on disk: a loadSkillContent fallback would throw ENOENT.
      stateManager.updateSkillState('Inline', 'inline-id', 'old inline body', skill);

      const client = {
        skills: {
          get: jest.fn((id: string) =>
            id === 'inline-id' ? Promise.resolve({ id, name: 'Inline' }) : Promise.reject(new Error('Not found'))
          ),
        },
      } as unknown as CodeMieClient;

      const changes = await previewSkills([skill], loader, stateManager, client);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ type: 'update', resourceType: 'skill', name: 'Inline' });
    });

    it('names added, removed and modified companion files when only they changed', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const loader = new CodemieConfigLoader(appConfig);

      const skillDir = path.join(tempDir, 'skills', 'with-companions');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'skill body');
      fs.writeFileSync(path.join(skillDir, 'a.txt'), 'a-original');
      fs.writeFileSync(path.join(skillDir, 'b.txt'), 'b-original');

      const skill: SkillResource = {
        name: 'WithCompanions',
        description: 'desc',
        file: 'skills/with-companions/SKILL.md',
      };

      const content = loader.resolveSkillContent(skill);
      const initialCompanionFiles = collectCompanionFiles(skillDir);
      stateManager.updateSkillState('WithCompanions', 'skill-id', content, skill, initialCompanionFiles);

      // Change companion files only: modify a.txt, remove b.txt, add c.txt. Skill content and
      // config are untouched.
      fs.writeFileSync(path.join(skillDir, 'a.txt'), 'a-modified');
      fs.rmSync(path.join(skillDir, 'b.txt'));
      fs.writeFileSync(path.join(skillDir, 'c.txt'), 'c-new');

      const client = {
        skills: {
          get: jest.fn((id: string) =>
            id === 'skill-id' ? Promise.resolve({ id, name: 'WithCompanions' }) : Promise.reject(new Error('Not found'))
          ),
        },
      } as unknown as CodeMieClient;

      const changes = await previewSkills([skill], loader, stateManager, client, tempDir);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ type: 'update', resourceType: 'skill', name: 'WithCompanions' });
      expect(changes[0].details).toContain('added c.txt');
      expect(changes[0].details).toContain('removed b.txt');
      expect(changes[0].details).toContain('modified a.txt');
      expect(changes[0].details).not.toContain('Content or configuration changed');
    });

    it('previews a skill whose .codemie-exclude holds a malformed pattern without crashing', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const loader = new CodemieConfigLoader(appConfig);

      const skillDir = path.join(tempDir, 'skills', 'malformed-exclude');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'skill body');
      fs.writeFileSync(path.join(skillDir, '.codemie-exclude'), 'a{b\n');
      fs.writeFileSync(path.join(skillDir, 'keep.txt'), 'keep');

      const skill: SkillResource = {
        name: 'MalformedExclude',
        description: 'desc',
        file: 'skills/malformed-exclude/SKILL.md',
      };

      const client = {
        skills: {
          get: jest.fn(() => Promise.reject(new Error('Not found'))),
        },
      } as unknown as CodeMieClient;

      // Before the brace fix this raised a raw "Unterminated group" regex error that preview
      // surfaced as a stack trace and exit 1.
      const changes = await previewSkills([skill], loader, stateManager, client, tempDir);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ type: 'create', resourceType: 'skill', name: 'MalformedExclude' });
    });

    it('previews no changes when a skill with companion files is untouched', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const loader = new CodemieConfigLoader(appConfig);

      const skillDir = path.join(tempDir, 'skills', 'untouched');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'skill body');
      fs.writeFileSync(path.join(skillDir, 'a.txt'), 'a-content');

      const skill: SkillResource = {
        name: 'Untouched',
        description: 'desc',
        file: 'skills/untouched/SKILL.md',
      };

      const content = loader.resolveSkillContent(skill);
      const companionFiles = collectCompanionFiles(skillDir);
      stateManager.updateSkillState('Untouched', 'skill-id', content, skill, companionFiles);

      const client = {
        skills: {
          get: jest.fn((id: string) =>
            id === 'skill-id' ? Promise.resolve({ id, name: 'Untouched' }) : Promise.reject(new Error('Not found'))
          ),
        },
      } as unknown as CodeMieClient;

      const changes = await previewSkills([skill], loader, stateManager, client, tempDir);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ type: 'no-change', resourceType: 'skill', name: 'Untouched' });
    });

    it('previews content changes exactly as today for a skill with no companion files', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const loader = new CodemieConfigLoader(appConfig);

      const skillPath = path.join(tempDir, 'skills', 'plain.skill.md');
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, 'old body');

      const skill: SkillResource = {
        name: 'PlainSkill',
        description: 'desc',
        file: 'skills/plain.skill.md',
      };

      stateManager.updateSkillState('PlainSkill', 'skill-id', 'old body', skill);

      // Content changes on disk; no SKILL.md layout, so no companion-file collection ever runs.
      fs.writeFileSync(skillPath, 'new body');

      const client = {
        skills: {
          get: jest.fn((id: string) =>
            id === 'skill-id' ? Promise.resolve({ id, name: 'PlainSkill' }) : Promise.reject(new Error('Not found'))
          ),
        },
      } as unknown as CodeMieClient;

      const changes = await previewSkills([skill], loader, stateManager, client, tempDir);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        type: 'update',
        resourceType: 'skill',
        name: 'PlainSkill',
        details: 'Content or configuration changed',
      });
    });
  });

  describe('previewWorkflows', () => {
    it('should resolve workflow definition relative to provided rootDir', async () => {
      const appConfig = createAppConfig(tempDir);
      const stateManager = new StateManager(appConfig);
      const workflowDir = path.join(tempDir, 'workflows');
      fs.mkdirSync(workflowDir, { recursive: true });
      const yamlPath = path.join(workflowDir, 'root-test.yaml');
      fs.writeFileSync(
        yamlPath,
        `
assistants:
  - id: foo
    name: Foo
    model: gpt-4
    system_prompt: Test
states:
  - id: start
    assistant_id: foo
    task: Test task
`
      );

      const workflows: WorkflowResource[] = [
        {
          name: 'RootDir Preview Workflow',
          description: 'Test root dir support',
          definition: 'workflows/root-test.yaml',
          mode: 'Sequential',
          shared: true,
        },
      ];

      const client = createMockClient(['wf-preview']);
      const changes = await previewWorkflows(workflows, stateManager, client, tempDir);

      expect(changes.some((c) => c.type === 'create' && c.name === 'RootDir Preview Workflow')).toBe(true);
    });

    it('should detect new workflows', async () => {
      // Save current dir
      const originalCwd = process.cwd();

      // Change to temp dir for this test
      process.chdir(tempDir);

      try {
        const appConfig = createAppConfig(tempDir);
        const stateManager = new StateManager(appConfig);

        // Create temporary workflow YAML file
        const workflowYaml = `
assistants:
  - id: test_assistant
    model: gpt-4
    name: Test Assistant
    system_prompt: You are a test assistant
states:
  - id: test_state
    assistant_id: test_assistant
    task: Test task
`;
        const yamlPath = path.join(tempDir, 'test-workflow.yaml');
        fs.writeFileSync(yamlPath, workflowYaml, 'utf8');

        const workflows: WorkflowResource[] = [
          {
            name: 'New WF',
            description: 'Test',
            definition: 'test-workflow.yaml', // Use temp file
            mode: 'Sequential',
            shared: true,
          },
        ];

        const client = createMockClient(['wf-123']);
        const changes = await previewWorkflows(workflows, stateManager, client);

        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(changes.some((c) => c.type === 'create' && c.name === 'New WF')).toBe(true);
      } finally {
        // Restore original dir
        process.chdir(originalCwd);
      }
    });

    it('should detect workflow updates when YAML changes', async () => {
      // Save current dir
      const originalCwd = process.cwd();

      // Change to temp dir for this test
      process.chdir(tempDir);

      try {
        const appConfig = createAppConfig(tempDir);
        const stateManager = new StateManager(appConfig);

        const yamlPath = path.join(tempDir, 'workflow.yaml');
        fs.writeFileSync(yamlPath, 'workflow:\n  name: test');

        const workflow: WorkflowResource = {
          name: 'Test Workflow',
          description: 'Test',
          definition: 'workflow.yaml', // Use relative path
          mode: 'Sequential',
          shared: true,
        };

        // Set initial state
        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        stateManager.updateWorkflowState(
          'Test Workflow',
          'wf-123',
          yamlContent,
          JSON.stringify({ mode: 'Sequential' })
        );

        // Modify YAML
        fs.writeFileSync(yamlPath, 'workflow:\n  name: updated');

        const workflows: WorkflowResource[] = [workflow];
        const client = createMockClient(['wf-123']);
        const changes = await previewWorkflows(workflows, stateManager, client);

        expect(changes.some((c) => c.type === 'update' && c.name === 'Test Workflow')).toBe(true);
      } finally {
        // Restore original dir
        process.chdir(originalCwd);
      }
    });

    it('should detect workflow updates when config changes', async () => {
      // Save current dir
      const originalCwd = process.cwd();

      // Change to temp dir for this test
      process.chdir(tempDir);

      try {
        const appConfig = createAppConfig(tempDir);
        const stateManager = new StateManager(appConfig);

        const yamlPath = path.join(tempDir, 'workflow.yaml');
        fs.writeFileSync(yamlPath, 'workflow:\n  name: test');

        const workflow: WorkflowResource = {
          name: 'Test Workflow',
          description: 'Updated description', // Changed
          definition: 'workflow.yaml', // Use relative path
          mode: 'Sequential',
          shared: true,
        };

        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        stateManager.updateWorkflowState(
          'Test Workflow',
          'wf-123',
          yamlContent,
          JSON.stringify({ description: 'Original' })
        );

        const workflows: WorkflowResource[] = [workflow];
        const client = createMockClient(['wf-123']);
        const changes = await previewWorkflows(workflows, stateManager, client);

        expect(changes.some((c) => c.type === 'update' && c.name === 'Test Workflow')).toBe(true);
      } finally {
        // Restore original dir
        process.chdir(originalCwd);
      }
    });

    it('should detect no-change for identical workflows', async () => {
      // Save current dir
      const originalCwd = process.cwd();

      // Change to temp dir for this test
      process.chdir(tempDir);

      try {
        const appConfig = createAppConfig(tempDir);
        const stateManager = new StateManager(appConfig);

        const yamlPath = path.join(tempDir, 'workflow.yaml');
        const yamlContent = 'workflow:\n  name: test';
        fs.writeFileSync(yamlPath, yamlContent);

        const workflow: WorkflowResource = {
          name: 'Test Workflow',
          description: 'Test',
          definition: 'workflow.yaml', // Use relative path
          mode: 'Sequential',
          shared: true,
        };

        // Store checksums using the same helpers as production code
        const workflowYamlChecksum = calculateChecksum(yamlContent);
        const configChecksum = calculateWorkflowConfigChecksum(workflow);

        stateManager.updateWorkflowState('Test Workflow', 'wf-123', workflowYamlChecksum, configChecksum);

        const workflows: WorkflowResource[] = [workflow];
        const client = createMockClient(['wf-123']);
        const changes = await previewWorkflows(workflows, stateManager, client);

        expect(changes.some((c) => c.type === 'no-change' && c.name === 'Test Workflow')).toBe(true);
      } finally {
        // Restore original dir
        process.chdir(originalCwd);
      }
    });
  });

  describe('previewChanges', () => {
    it('should aggregate changes from all resources', async () => {
      const appConfig = createAppConfig(tempDir);
      const client = createMockClient();

      // Create config file
      const configPath = path.join(tempDir, 'codemie.yaml');
      const promptPath = path.join(tempDir, 'test.md');
      fs.writeFileSync(promptPath, 'You are helpful');

      const configContent = `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  assistants:
    - name: New Assistant
      prompt: test.md
      model: gpt-4
`;
      fs.writeFileSync(configPath, configContent);

      // Create empty state file
      const statePath = path.join(tempDir, '.codemie/state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(
        statePath,
        JSON.stringify({
          version: '1.0',
          project: 'test-project',
          resources: { assistants: {}, datasources: {}, workflows: {} },
        })
      );

      const result = await previewChanges(appConfig, client);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].type).toBe('create');
      expect(result.changes[0].name).toBe('New Assistant');
      expect(result.summary.created).toBe(1);
      expect(result.summary.total).toBe(1);
    });

    it('should describe workflow adoption for a stale workflow id and keep assistant stale wording', async () => {
      const appConfig = createAppConfig(tempDir);
      const client = createMockClient();

      fs.writeFileSync(path.join(tempDir, 'test.md'), 'You are helpful');
      fs.writeFileSync(
        path.join(tempDir, 'workflow.yaml'),
        `
states:
  - id: start
    task: Inline only
`
      );
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  assistants:
    - name: Stale Assistant
      prompt: test.md
      model: gpt-4
  workflows:
    - name: Stale Workflow
      description: Stale
      definition: workflow.yaml
`
      );

      const stateManager = new StateManager(appConfig);
      stateManager.updateAssistantState('Stale Assistant', 'ast-stale', 'old-prompt', {
        name: 'Stale Assistant',
        prompt: 'test.md',
        model: 'gpt-4',
      } as AssistantResource);
      stateManager.updateWorkflowState('Stale Workflow', 'wf-stale', 'old-yaml', 'old-config');

      const result = await previewChanges(appConfig, client);

      const workflowChange = result.changes.find((c) => c.resourceType === 'workflow');
      const assistantChange = result.changes.find((c) => c.resourceType === 'assistant');
      expect(workflowChange).toMatchObject({
        type: 'create',
        name: 'Stale Workflow',
        details:
          'ID from state not found; will adopt a same-name workflow in project test-project if one exists, otherwise create',
      });
      expect(assistantChange).toMatchObject({
        type: 'create',
        name: 'Stale Assistant',
        details: 'ID from state not found on platform, will create new',
      });
    });

    it('should exclude config and orphaned datasources with skipDatasources', async () => {
      const appConfig = createAppConfig(tempDir);
      const client = createMockClient();

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  datasources:
    - name: cfg-ds
      type: knowledge_base_file
      embeddings_model: amazon.titan-embed-text-v2:0
      shared_with_project: true
      description: config datasource
`
      );

      const stateManager = new StateManager(appConfig);
      stateManager.updateDatasourceState('old-ds', 'ds-old-id', {
        name: 'old-ds',
        type: 'knowledge_base_file',
      } as DatasourceResource);

      const unfiltered = await previewChanges(appConfig, client);
      expect(unfiltered.changes.filter((c) => c.resourceType === 'datasource')).toHaveLength(2);

      const result = await previewChanges(appConfig, client, { skipDatasources: true });

      expect(result.changes.filter((c) => c.resourceType === 'datasource')).toEqual([]);
    });

    describe('--replace-skill-group', () => {
      function writeGroupProject(): void {
        fs.writeFileSync(path.join(tempDir, 'bundled.md'), 'You are bundled');
        fs.writeFileSync(path.join(tempDir, 'other.md'), 'You are unrelated');
        fs.writeFileSync(
          path.join(tempDir, 'codemie.yaml'),
          `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  skills:
    - name: alpha
      description: alpha skill description
      file: alpha.skill.md
      group: bundle
    - name: beta
      description: beta skill description
      file: beta.skill.md
      group: bundle
    - name: gamma
      description: gamma skill description
      file: gamma.skill.md
  assistants:
    - name: Bundled
      description: references the group
      prompt: bundled.md
      model: gpt-4
      skills:
        - alpha
    - name: Unrelated
      description: references nothing from the group
      prompt: other.md
      model: gpt-4
      skills:
        - gamma
  datasources:
    - name: cfg-ds
      type: knowledge_base_file
      embeddings_model: amazon.titan-embed-text-v2:0
      shared_with_project: true
      description: config datasource
`
        );
      }

      function seedGroupState(appConfig: AppConfig): StateManager {
        const stateManager = new StateManager(appConfig);
        stateManager.updateSkillState('alpha', 'alpha-old-id', '# alpha', {
          name: 'alpha',
          description: 'alpha skill description',
          group: 'bundle',
        });
        stateManager.updateSkillState('legacy', 'legacy-old-id', '# legacy', {
          name: 'legacy',
          description: 'legacy skill description',
          group: 'bundle',
        });
        stateManager.updateSkillState('bundle-lookalike', 'lookalike-id', '# lookalike', {
          name: 'bundle-lookalike',
          description: 'lookalike skill description',
        });
        stateManager.updateSkillState('gamma', 'gamma-id', '# gamma', {
          name: 'gamma',
          description: 'gamma skill description',
        });
        return stateManager;
      }

      it('lists the deletes and creates of the group and nothing else', async () => {
        const appConfig = createAppConfig(tempDir);
        writeGroupProject();
        seedGroupState(appConfig);

        const result = await previewChanges(appConfig, createMockClient(['ast-bundled']), {
          replaceSkillGroup: 'bundle',
        });

        const skillChanges = result.changes.filter((c) => c.resourceType === 'skill');
        expect(
          skillChanges
            .filter((c) => c.type === 'delete')
            .map((c) => c.name)
            .sort()
        ).toEqual(['alpha', 'legacy']);
        expect(skillChanges.filter((c) => c.type === 'create').map((c) => c.name)).toEqual(['alpha', 'beta']);
        expect(skillChanges.find((c) => c.type === 'delete' && c.name === 'alpha')?.details).toContain('alpha-old-id');
        expect(result.changes.filter((c) => c.resourceType === 'datasource')).toEqual([]);
        expect(result.changes.filter((c) => c.resourceType === 'workflow')).toEqual([]);
      });

      it('previews only the assistants that reference the group', async () => {
        const appConfig = createAppConfig(tempDir);
        writeGroupProject();
        seedGroupState(appConfig);

        const result = await previewChanges(appConfig, createMockClient(), { replaceSkillGroup: 'bundle' });

        expect(result.changes.filter((c) => c.resourceType === 'assistant').map((c) => c.name)).toEqual(['Bundled']);
      });

      it('refuses a group name that collides with an imported skill', async () => {
        const appConfig = createAppConfig(tempDir);
        fs.writeFileSync(
          path.join(tempDir, 'codemie.yaml'),
          `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
imported:
  skills:
    - name: Bundle
      id: skill-imported
resources:
  skills:
    - name: alpha
      description: alpha skill description
      file: alpha.skill.md
      group: bundle
`
        );

        await expect(previewChanges(appConfig, createMockClient(), { replaceSkillGroup: 'bundle' })).rejects.toThrow(
          'matches an entry in imported.skills'
        );
      });

      it('refuses a group that matches no skill at all', async () => {
        const appConfig = createAppConfig(tempDir);
        writeGroupProject();
        seedGroupState(appConfig);

        await expect(previewChanges(appConfig, createMockClient(), { replaceSkillGroup: 'nope' })).rejects.toThrow(
          'Skill group "nope" matched no skills'
        );
      });
    });

    it('should reject an out-of-range skill description before calling the API', async () => {
      const appConfig = createAppConfig(tempDir);

      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  skills:
    - name: bad-skill
      description: too short
      file: skills/bad-skill.skill.md
`
      );

      await expect(previewChanges(appConfig)).rejects.toThrow('Skill "bad-skill" description length is 9 characters');

      expect(mockCreateClient).not.toHaveBeenCalled();
    });
  });

  describe('main', () => {
    let originalExit: typeof process.exit;

    beforeEach(() => {
      originalExit = process.exit;
      process.exit = jest.fn() as unknown as typeof process.exit;
    });

    afterEach(() => {
      process.exit = originalExit;
      jest.restoreAllMocks();
    });

    function writeDatasourceProject(appConfig: AppConfig): void {
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        `
version: '1'
project:
  name: test-project
environment:
  codemie_api_url: https://api.example.com
  auth_server_url: https://auth.example.com
resources:
  datasources:
    - name: cfg-ds
      type: knowledge_base_file
      embeddings_model: amazon.titan-embed-text-v2:0
      shared_with_project: true
      description: config datasource
`
      );
      new StateManager(appConfig).updateDatasourceState('old-ds', 'ds-old-id', {
        name: 'old-ds',
        type: 'knowledge_base_file',
      } as DatasourceResource);
    }

    async function runMain(skipDatasources?: boolean): Promise<string[]> {
      const appConfig = createAppConfig(tempDir);
      writeDatasourceProject(appConfig);
      mockCreateClient.mockResolvedValue(createMockClient());
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

      await main({ appConfig, skipDatasources });

      return infoSpy.mock.calls.map((call) => String(call[0]));
    }

    it('forwards --skip-datasources to the preview and prints the exclusion banner', async () => {
      const lines = await runMain(true);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(lines).toContain('⏭️  Datasources excluded from preview (--skip-datasources)\n');
      expect(lines.filter((line) => line.includes('datasource:'))).toEqual([]);
    });

    it('lists datasource changes and no banner without the flag', async () => {
      const lines = await runMain();

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(lines.some((line) => line.includes('--skip-datasources'))).toBe(false);
      expect(lines).toEqual(expect.arrayContaining(['  - datasource:old-ds', '  - datasource:cfg-ds']));
    });
  });
});
