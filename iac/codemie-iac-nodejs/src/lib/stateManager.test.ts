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
import type { AssistantResource, SkillResource } from '../types/codemieConfig';

import { calculateChecksum, calculateAssistantConfigChecksum } from './checksumUtils';
import type { CompanionFile } from './skillCompanionFiles';
import type { ResourceType } from './stateManager';
import { StateManager } from './stateManager';

// Helper to create minimal test assistant
function createTestAssistant(overrides: Partial<AssistantResource> = {}): AssistantResource {
  return {
    name: 'Test Assistant',
    description: 'Test',
    prompt: 'test.md',
    model: 'gpt-4',
    ...overrides,
  };
}

// Helper to create minimal test skill
function createTestSkill(overrides: Partial<SkillResource> = {}): SkillResource {
  return {
    name: 'Test Skill',
    description: 'A perfectly fine description here',
    categories: ['dev'],
    visibility: 'public',
    ...overrides,
  };
}

function createTestCompanionFiles(): CompanionFile[] {
  return [
    {
      path: 'reference.md',
      content: '# Reference',
      mime_type: 'text/markdown',
      encoding: 'text',
      size_bytes: 12,
    },
  ];
}

// Helper to create test AppConfig
function createTestAppConfig(rootDir: string): AppConfig {
  return {
    rootDir,
    codemieConfig: 'codemie.yaml',
    codemieState: '.codemie/state.json',
    backupsDirectory: '.codemie/backups',
  };
}

describe('StateManager', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemie-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory after each test
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('basic functionality', () => {
    test('should create StateManager instance', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      expect(stateManager).toBeInstanceOf(StateManager);
    });

    test('should return state with required structure', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      const state = stateManager.loadState();

      expect(state.version).toBe('1.0');
      expect(state.resources.assistants).toBeDefined();
      expect(state.resources.datasources).toBeDefined();
      expect(state.resources.workflows).toBeDefined();
    });

    test('should update and retrieve assistant state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const promptContent = 'Test prompt content';
      const assistant = createTestAssistant({ model: 'gpt-4o' });

      stateManager.updateAssistantState('Test Assistant', 'test-id-123', promptContent, assistant);

      const assistantState = stateManager.getAssistantState('Test Assistant');
      expect(assistantState).toBeDefined();
      expect(assistantState?.id).toBe('test-id-123');
      expect(assistantState?.promptChecksum).toBeDefined();
      expect(assistantState?.configChecksum).toBeDefined();
    });

    test('should delete assistant from state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const promptContent = 'Test prompt';
      const assistant = createTestAssistant({ model: 'gpt-4o' });

      stateManager.updateAssistantState('Test Assistant', 'test-id-123', promptContent, assistant);
      expect(stateManager.getAssistantState('Test Assistant')).toBeDefined();

      stateManager.deleteAssistantState('Test Assistant');
      expect(stateManager.getAssistantState('Test Assistant')).toBeUndefined();
    });

    test('should update and retrieve datasource state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const datasource = {
        name: 'Test Datasource',
        type: 'code' as const,
        link: 'https://example.com',
        description: 'Test datasource',
      };

      stateManager.updateDatasourceState('Test Datasource', 'ds-id-123', datasource);

      const datasourceState = stateManager.getDatasourceState('Test Datasource');
      expect(datasourceState).toBeDefined();
      expect(datasourceState?.id).toBe('ds-id-123');
      expect(datasourceState?.configChecksum).toBeDefined();
    });

    test('should update and retrieve workflow state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateWorkflowState('Test Workflow', 'wf-id-123', 'yaml-checksum', 'config-checksum');

      const workflowState = stateManager.getWorkflowState('Test Workflow');
      expect(workflowState).toBeDefined();
      expect(workflowState?.id).toBe('wf-id-123');
      expect(workflowState?.workflowYamlChecksum).toBe('yaml-checksum');
      expect(workflowState?.configChecksum).toBe('config-checksum');
    });

    test('should delete workflow from state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateWorkflowState('Test Workflow', 'wf-id-123', 'yaml-checksum', 'config-checksum');
      expect(stateManager.getWorkflowState('Test Workflow')).toBeDefined();

      stateManager.deleteWorkflowState('Test Workflow');
      expect(stateManager.getWorkflowState('Test Workflow')).toBeUndefined();
    });
  });

  describe('skill state with companion files', () => {
    test('should write both companion fields when companionFiles is passed', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const skill = createTestSkill();
      stateManager.updateSkillState(
        'Test Skill',
        'skill-id-123',
        'SKILL.md content',
        skill,
        createTestCompanionFiles()
      );

      const skillState = stateManager.getSkillState('Test Skill');
      expect(skillState?.companionFilesChecksum).toBeDefined();
      expect(skillState?.companionFileHashes).toEqual({
        'reference.md': expect.any(String),
      });
    });

    test('should write neither companion field when companionFiles is omitted', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const skill = createTestSkill();
      stateManager.updateSkillState('Test Skill', 'skill-id-123', 'SKILL.md content', skill);

      const skillState = stateManager.getSkillState('Test Skill');
      expect(skillState).toBeDefined();
      expect(Object.hasOwn(skillState as object, 'companionFilesChecksum')).toBe(false);
      expect(Object.hasOwn(skillState as object, 'companionFileHashes')).toBe(false);

      // The state is persisted to JSON and read back; the absence must survive that round trip too.
      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, '.codemie', 'state.json'), 'utf8'));
      const rawSkillState = raw.resources.skills['Test Skill'];
      expect(Object.hasOwn(rawSkillState, 'companionFilesChecksum')).toBe(false);
      expect(Object.hasOwn(rawSkillState, 'companionFileHashes')).toBe(false);
    });
  });

  describe('skill state group', () => {
    test('should persist the group label of the skill resource', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));

      stateManager.updateSkillState(
        'Test Skill',
        'skill-id-123',
        'SKILL.md content',
        createTestSkill({ group: 'copilot-bundle' })
      );

      expect(stateManager.getSkillState('Test Skill')?.group).toBe('copilot-bundle');
      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, '.codemie', 'state.json'), 'utf8'));
      expect(raw.resources.skills['Test Skill'].group).toBe('copilot-bundle');
    });

    test('should omit the group key entirely for an ungrouped skill', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));

      stateManager.updateSkillState('Test Skill', 'skill-id-123', 'SKILL.md content', createTestSkill());

      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, '.codemie', 'state.json'), 'utf8'));
      expect(Object.hasOwn(raw.resources.skills['Test Skill'], 'group')).toBe(false);
    });

    test('should not let the group label change the config checksum', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));

      stateManager.updateSkillState('Test Skill', 'skill-id-123', 'content', createTestSkill());
      const withoutGroup = stateManager.getSkillState('Test Skill')?.configChecksum;

      stateManager.updateSkillState('Test Skill', 'skill-id-123', 'content', createTestSkill({ group: 'bundle' }));

      expect(stateManager.getSkillState('Test Skill')?.configChecksum).toBe(withoutGroup);
    });
  });

  describe('checksum calculation', () => {
    test('should generate consistent checksums for same content', () => {
      const content = 'Test content for checksum';

      const checksum1 = calculateChecksum(content);
      const checksum2 = calculateChecksum(content);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA256 hex length
    });

    test('should generate different checksums for different content', () => {
      const checksum1 = calculateChecksum('Content 1');
      const checksum2 = calculateChecksum('Content 2');

      expect(checksum1).not.toBe(checksum2);
    });

    test('should detect prompt changes via checksum', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const promptV1 = 'You are a helpful assistant.';
      const promptV2 = 'You are a very helpful assistant.'; // Changed!
      const assistant = createTestAssistant({ name: 'Assistant', model: 'gpt-4o' });

      stateManager.updateAssistantState('Assistant', 'id-123', promptV1, assistant);
      const state1 = stateManager.getAssistantState('Assistant');

      const checksumV1 = calculateChecksum(promptV1);
      const checksumV2 = calculateChecksum(promptV2);

      expect(state1?.promptChecksum).toBe(checksumV1);
      expect(checksumV2).not.toBe(checksumV1); // Changed!
    });

    test('should detect config changes via checksum', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const prompt = 'Test prompt';
      const assistantV1 = createTestAssistant({ name: 'Assistant', model: 'gpt-4o', temperature: 0.7 });
      const assistantV2 = createTestAssistant({ name: 'Assistant', model: 'gpt-4o', temperature: 0.9 }); // Changed!

      stateManager.updateAssistantState('Assistant', 'id-123', prompt, assistantV1);

      const checksumV1 = calculateAssistantConfigChecksum(assistantV1);
      const checksumV2 = calculateAssistantConfigChecksum(assistantV2);

      expect(checksumV2).not.toBe(checksumV1); // Changed!
    });
  });

  describe('managed resources tracking', () => {
    test('should track all managed resources', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateAssistantState('Assistant 1', 'id-1', 'prompt', createTestAssistant({ name: 'Assistant 1' }));
      stateManager.updateAssistantState('Assistant 2', 'id-2', 'prompt', createTestAssistant({ name: 'Assistant 2' }));
      stateManager.updateDatasourceState('Datasource 1', 'ds-1', {
        name: 'Datasource 1',
        type: 'code' as const,
        description: 'Test',
      });
      stateManager.updateWorkflowState('Workflow 1', 'wf-1', 'yaml', 'config');

      const managed = stateManager.getAllManagedResources();

      expect(managed.assistants).toEqual(['Assistant 1', 'Assistant 2']);
      expect(managed.datasources).toEqual(['Datasource 1']);
      expect(managed.workflows).toEqual(['Workflow 1']);
    });

    test('should correctly identify managed vs unmanaged resources', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateAssistantState(
        'Managed Assistant',
        'id-1',
        'prompt',
        createTestAssistant({ name: 'Managed Assistant' })
      );

      expect(stateManager.isManagedResource('assistant', 'Managed Assistant')).toBe(true);
      expect(stateManager.isManagedResource('assistant', 'Unmanaged Assistant')).toBe(false);
    });

    test('should retrieve ID by name for managed resources', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateAssistantState(
        'My Assistant',
        'test-id-123',
        'prompt',
        createTestAssistant({ name: 'My Assistant' })
      );
      stateManager.updateDatasourceState('My Datasource', 'ds-id-456', {
        name: 'My Datasource',
        type: 'code' as const,
        description: 'Test',
      });
      stateManager.updateWorkflowState('My Workflow', 'wf-id-789', 'yaml', 'config');

      expect(stateManager.getIdByName('assistant', 'My Assistant')).toBe('test-id-123');
      expect(stateManager.getIdByName('datasource', 'My Datasource')).toBe('ds-id-456');
      expect(stateManager.getIdByName('workflow', 'My Workflow')).toBe('wf-id-789');
    });

    test('should return undefined for non-existent resources', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      expect(stateManager.getIdByName('assistant', 'Non Existent')).toBeUndefined();
    });
  });

  describe('state initialization edge cases', () => {
    test('should initialize missing resources structure', () => {
      // Create state file without resources structure
      const stateFilePath = path.join(tempDir, '.codemie', 'state.json');
      fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
      fs.writeFileSync(stateFilePath, JSON.stringify({ version: '1.0' }));

      const stateManager = new StateManager(createTestAppConfig(tempDir));
      const state = stateManager.loadState();

      expect(state.resources).toBeDefined();
      expect(state.resources.assistants).toBeDefined();
      expect(state.resources.datasources).toBeDefined();
      expect(state.resources.workflows).toBeDefined();
    });

    test('should initialize missing assistants in resources', () => {
      const stateFilePath = path.join(tempDir, '.codemie', 'state.json');
      fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
      fs.writeFileSync(
        stateFilePath,
        JSON.stringify({
          version: '1.0',
          resources: {
            datasources: {},
            workflows: {},
          },
        })
      );

      const stateManager = new StateManager(createTestAppConfig(tempDir));
      const state = stateManager.loadState();

      expect(state.resources.assistants).toBeDefined();
      expect(state.resources.assistants).toEqual({});
    });

    test('should initialize missing datasources in resources', () => {
      const stateFilePath = path.join(tempDir, '.codemie', 'state.json');
      fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
      fs.writeFileSync(
        stateFilePath,
        JSON.stringify({
          version: '1.0',
          resources: {
            assistants: {},
            workflows: {},
          },
        })
      );

      const stateManager = new StateManager(createTestAppConfig(tempDir));
      const state = stateManager.loadState();

      expect(state.resources.datasources).toBeDefined();
      expect(state.resources.datasources).toEqual({});
    });

    test('should initialize missing workflows in resources', () => {
      const stateFilePath = path.join(tempDir, '.codemie', 'state.json');
      fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
      fs.writeFileSync(
        stateFilePath,
        JSON.stringify({
          version: '1.0',
          resources: {
            assistants: {},
            datasources: {},
          },
        })
      );

      const stateManager = new StateManager(createTestAppConfig(tempDir));
      const state = stateManager.loadState();

      expect(state.resources.workflows).toBeDefined();
      expect(state.resources.workflows).toEqual({});
    });
  });

  describe('datasource operations', () => {
    test('should delete datasource from state', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      const datasource = {
        name: 'Test Datasource',
        type: 'code' as const,
        link: 'https://example.com',
        description: 'Test',
      };

      stateManager.updateDatasourceState('Test Datasource', 'ds-id-123', datasource);
      expect(stateManager.getDatasourceState('Test Datasource')).toBeDefined();

      stateManager.deleteDatasourceState('Test Datasource');
      expect(stateManager.getDatasourceState('Test Datasource')).toBeUndefined();
    });
  });

  describe('isManagedResource with different types', () => {
    test('should check datasource as managed resource', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateDatasourceState('My Datasource', 'ds-id-123', {
        name: 'My Datasource',
        type: 'code' as const,
        description: 'Test',
      });

      expect(stateManager.isManagedResource('datasource', 'My Datasource')).toBe(true);
      expect(stateManager.isManagedResource('datasource', 'Non Existent')).toBe(false);
    });

    test('should check workflow as managed resource', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateWorkflowState('My Workflow', 'wf-id-123', 'yaml', 'config');

      expect(stateManager.isManagedResource('workflow', 'My Workflow')).toBe(true);
      expect(stateManager.isManagedResource('workflow', 'Non Existent')).toBe(false);
    });

    test('should return false for invalid resource type', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      expect(stateManager.isManagedResource('invalid-type' as ResourceType, 'Some Name')).toBe(false);
    });
  });

  describe('getIdByName with different types', () => {
    test('should return undefined for invalid resource type', () => {
      const stateManager = new StateManager(createTestAppConfig(tempDir));
      stateManager.loadState();

      stateManager.updateAssistantState(
        'My Assistant',
        'id-123',
        'prompt',
        createTestAssistant({ name: 'My Assistant' })
      );

      expect(stateManager.getIdByName('invalid-type' as ResourceType, 'My Assistant')).toBeUndefined();
    });
  });
});
