/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { CodemieConfig } from '../types/codemieConfig';

import {
  resolveSubAssistantIds,
  resolveDatasourceContext,
  resolveWorkflowAssistant,
  resolveSkillId,
  lookupSkillId,
  resolveSkillIds,
} from './resourceResolver';
import { StateManager } from './stateManager';

describe('resourceResolver', () => {
  const appConfig = {
    rootDir: '/tmp/test-state.json',
    codemieConfig: 'codemie.yaml',
    codemieState: 'state.json',
    backupsDirectory: 'backups',
  };

  describe('resolveSubAssistantIds', () => {
    let stateManager: StateManager;

    beforeEach(() => {
      stateManager = new StateManager(appConfig);
      // Mock getAssistantState
      jest.spyOn(stateManager, 'getAssistantState');
    });

    it('should resolve single sub-assistant name to ID', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue({
        id: 'ast-123-uuid',
        slug: 'test-assistant',
        lastDeployed: '2025-01-01T00:00:00Z',
        promptChecksum: 'abc123',
        configChecksum: 'def456',
      });

      const result = resolveSubAssistantIds(['TestAssistant'], stateManager);

      expect(result).toEqual(['ast-123-uuid']);
      expect(stateManager.getAssistantState).toHaveBeenCalledWith('TestAssistant');
    });

    it('should resolve multiple sub-assistant names to IDs', () => {
      (stateManager.getAssistantState as jest.Mock)
        .mockReturnValueOnce({
          id: 'ast-111',
          slug: 'assistant-1',
          lastDeployed: '2025-01-01T00:00:00Z',
          promptChecksum: 'abc',
          configChecksum: 'def',
        })
        .mockReturnValueOnce({
          id: 'ast-222',
          slug: 'assistant-2',
          lastDeployed: '2025-01-01T00:00:00Z',
          promptChecksum: 'ghi',
          configChecksum: 'jkl',
        })
        .mockReturnValueOnce({
          id: 'ast-333',
          slug: 'assistant-3',
          lastDeployed: '2025-01-01T00:00:00Z',
          promptChecksum: 'mno',
          configChecksum: 'pqr',
        });

      const result = resolveSubAssistantIds(['Assistant1', 'Assistant2', 'Assistant3'], stateManager);

      expect(result).toEqual(['ast-111', 'ast-222', 'ast-333']);
      expect(stateManager.getAssistantState).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for empty input', () => {
      const result = resolveSubAssistantIds([], stateManager);

      expect(result).toEqual([]);
      expect(stateManager.getAssistantState).not.toHaveBeenCalled();
    });

    it('should throw error when sub-assistant not found in state', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);

      expect(() => resolveSubAssistantIds(['NonExistentAssistant'], stateManager)).toThrow(
        'Sub-assistant "NonExistentAssistant" not found in state'
      );
    });

    it('should throw error on first missing assistant in list', () => {
      (stateManager.getAssistantState as jest.Mock)
        .mockReturnValueOnce({
          id: 'ast-111',
          slug: 'assistant-1',
          lastDeployed: '2025-01-01T00:00:00Z',
          promptChecksum: 'abc',
          configChecksum: 'def',
        })
        .mockReturnValueOnce(null);

      expect(() => resolveSubAssistantIds(['Assistant1', 'MissingAssistant'], stateManager)).toThrow(
        'Sub-assistant "MissingAssistant" not found in state'
      );
    });

    it('should include helpful error message about deployment', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);

      expect(() => resolveSubAssistantIds(['UndeployedAssistant'], stateManager)).toThrow(
        'Ensure the assistant is deployed first'
      );
    });
  });

  describe('resolveDatasourceContext', () => {
    it('should resolve code datasource correctly', () => {
      const datasources = [{ name: 'MyCodebase', type: 'code' }];
      const result = resolveDatasourceContext(['MyCodebase'], datasources);

      expect(result).toEqual([
        {
          context_type: 'code',
          name: 'MyCodebase',
        },
      ]);
    });

    it('should resolve knowledge_base datasource correctly', () => {
      const datasources = [{ name: 'Documentation', type: 'knowledge_base' }];
      const result = resolveDatasourceContext(['Documentation'], datasources);

      expect(result).toEqual([
        {
          context_type: 'knowledge_base',
          name: 'Documentation',
        },
      ]);
    });

    it('should default to knowledge_base for datasource without type', () => {
      const datasources = [{ name: 'GenericDatasource' }];
      const result = resolveDatasourceContext(['GenericDatasource'], datasources);

      expect(result).toEqual([
        {
          context_type: 'knowledge_base',
          name: 'GenericDatasource',
        },
      ]);
    });

    it('should resolve multiple datasources', () => {
      const datasources = [
        { name: 'Codebase', type: 'code' },
        { name: 'Docs', type: 'knowledge_base' },
        { name: 'Legacy' },
      ];
      const result = resolveDatasourceContext(['Codebase', 'Docs', 'Legacy'], datasources);

      expect(result).toEqual([
        { context_type: 'code', name: 'Codebase' },
        { context_type: 'knowledge_base', name: 'Docs' },
        { context_type: 'knowledge_base', name: 'Legacy' },
      ]);
    });

    it('should return empty array for empty input', () => {
      const datasources = [{ name: 'Datasource1', type: 'code' }];
      const result = resolveDatasourceContext([], datasources);

      expect(result).toEqual([]);
    });

    it('should throw error when datasource not found', () => {
      const datasources = [{ name: 'ExistingDatasource', type: 'code' }];

      expect(() => resolveDatasourceContext(['NonExistentDatasource'], datasources)).toThrow(
        'Datasource with name "NonExistentDatasource" not found in config'
      );
    });

    it('should throw error on first missing datasource in list', () => {
      const datasources = [{ name: 'DS1', type: 'code' }];

      expect(() => resolveDatasourceContext(['DS1', 'MissingDS'], datasources)).toThrow(
        'Datasource with name "MissingDS" not found in config'
      );
    });

    it('should handle case-sensitive datasource names', () => {
      const datasources = [{ name: 'MyDataSource', type: 'code' }];

      expect(() => resolveDatasourceContext(['mydatasource'], datasources)).toThrow(
        'Datasource with name "mydatasource" not found in config'
      );
    });
  });

  describe('resolveWorkflowAssistant', () => {
    let stateManager: StateManager;
    let config: CodemieConfig;

    beforeEach(() => {
      stateManager = new StateManager(appConfig);
      config = {
        version: '1.0.0',
        project: {
          name: 'test-project',
          description: 'Test project',
        },
        environment: {
          codemie_api_url: 'https://api.test.com',
          auth_server_url: 'https://auth.test.com',
          auth_realm_name: 'test-realm',
          client_id: 'test-client',
          client_secret: 'test-secret',
        },
        imported: {
          integrations: [],
          assistants: [],
          datasources: [],
        },
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
        },
      };
      jest.spyOn(stateManager, 'getAssistantState');
    });

    it('should resolve assistant from state (IaC-managed)', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue({
        id: 'ast-state-123',
        slug: 'state-assistant',
        lastDeployed: '2025-01-01T00:00:00Z',
        promptChecksum: 'abc',
        configChecksum: 'def',
      });

      const result = resolveWorkflowAssistant('StateAssistant', stateManager, config);

      expect(result).toBe('ast-state-123');
      expect(stateManager.getAssistantState).toHaveBeenCalledWith('StateAssistant');
    });

    it('should resolve assistant from imported config (platform-managed)', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);
      config.imported = {
        assistants: [
          { id: 'ast-imported-456', name: 'ImportedAssistant' },
          { id: 'ast-imported-789', name: 'AnotherAssistant' },
        ],
        datasources: [],
        integrations: [],
      };

      const result = resolveWorkflowAssistant('ImportedAssistant', stateManager, config);

      expect(result).toBe('ast-imported-456');
    });

    it('should prioritize state over imported config', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue({
        id: 'ast-from-state',
        slug: 'priority-test',
        lastDeployed: '2025-01-01T00:00:00Z',
        promptChecksum: 'abc',
        configChecksum: 'def',
      });
      config.imported = {
        assistants: [{ id: 'ast-from-imported', name: 'PriorityAssistant' }],
        datasources: [],
        integrations: [],
      };

      const result = resolveWorkflowAssistant('PriorityAssistant', stateManager, config);

      expect(result).toBe('ast-from-state');
    });

    it('should throw error when assistant not found anywhere', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);
      config.imported = {
        assistants: [{ id: 'ast-other', name: 'OtherAssistant' }],
        datasources: [],
        integrations: [],
      };

      expect(() => resolveWorkflowAssistant('NonExistentAssistant', stateManager, config)).toThrow(
        'Assistant "NonExistentAssistant" not found in state or imported'
      );
    });

    it('should throw error when assistant found but has no ID', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);
      config.imported = {
        assistants: [{ name: 'NoIdAssistant' } as { id: string; name: string }],
        datasources: [],
        integrations: [],
      };

      expect(() => resolveWorkflowAssistant('NoIdAssistant', stateManager, config)).toThrow(
        'Assistant "NoIdAssistant" not found in state or imported'
      );
    });

    it('should include helpful error message about deployment', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);

      expect(() => resolveWorkflowAssistant('UndeployedAssistant', stateManager, config)).toThrow(
        'Ensure the assistant is deployed first or added to imported.assistants'
      );
    });

    it('should handle config without imported section', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);
      // config.imported is undefined

      expect(() => resolveWorkflowAssistant('Assistant', stateManager, config)).toThrow(
        'Assistant "Assistant" not found in state or imported'
      );
    });

    it('should handle empty imported.assistants array', () => {
      (stateManager.getAssistantState as jest.Mock).mockReturnValue(null);
      config.imported = { assistants: [], datasources: [], skills: [], integrations: [] };

      expect(() => resolveWorkflowAssistant('Assistant', stateManager, config)).toThrow(
        'Assistant "Assistant" not found in state or imported'
      );
    });
  });

  describe('resolveSkillId', () => {
    let stateManager: StateManager;
    let config: CodemieConfig;

    beforeEach(() => {
      stateManager = new StateManager(appConfig);
      jest.spyOn(stateManager, 'getSkillState');
      config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          codemie_api_url: 'https://api.example.com',
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test',
        },
        imported: {
          assistants: [],
          datasources: [],
          skills: [{ name: 'marketplace-skill', id: 'skill-imported-id' }],
          integrations: [],
        },
        resources: {},
      };
    });

    it('should resolve managed skill from state when listed in resources.skills', () => {
      config.resources.skills = [
        { name: 'managed-skill', description: 'Managed', file: 'skills/managed-skill.skill.md' },
      ];
      (stateManager.getSkillState as jest.Mock).mockReturnValue({
        id: 'skill-state-id',
        lastDeployed: '2025-01-01T00:00:00Z',
        contentChecksum: 'abc',
        configChecksum: 'def',
      });

      expect(resolveSkillId('managed-skill', stateManager, config)).toBe('skill-state-id');
    });

    it('should resolve imported skill before stale state when not listed in resources.skills', () => {
      (stateManager.getSkillState as jest.Mock).mockReturnValue({
        id: 'stale-state-id',
        lastDeployed: '2025-01-01T00:00:00Z',
        contentChecksum: 'abc',
        configChecksum: 'def',
      });

      expect(resolveSkillId('marketplace-skill', stateManager, config)).toBe('skill-imported-id');
      expect(lookupSkillId('marketplace-skill', stateManager, config)).toBe('skill-imported-id');
    });

    it('should resolve skill from imported.skills when not in state', () => {
      (stateManager.getSkillState as jest.Mock).mockReturnValue(undefined);

      expect(resolveSkillId('marketplace-skill', stateManager, config)).toBe('skill-imported-id');
      expect(lookupSkillId('marketplace-skill', stateManager, config)).toBe('skill-imported-id');
    });

    it('should resolve skill names case-insensitively', () => {
      (stateManager.getSkillState as jest.Mock).mockReturnValue(undefined);

      expect(resolveSkillId('Marketplace-Skill', stateManager, config)).toBe('skill-imported-id');
      expect(lookupSkillId('MARKETPLACE-SKILL', stateManager, config)).toBe('skill-imported-id');
    });

    it('should throw when skill is missing from state and imported.skills', () => {
      (stateManager.getSkillState as jest.Mock).mockReturnValue(undefined);

      expect(() => resolveSkillId('missing-skill', stateManager, config)).toThrow(
        'Skill "missing-skill" cannot be resolved'
      );
    });

    it('should throw when skill exists in both resources.skills and imported.skills', () => {
      config.resources.skills = [
        { name: 'marketplace-skill', description: 'Managed duplicate', file: 'skills/marketplace-skill.skill.md' },
      ];
      (stateManager.getSkillState as jest.Mock).mockReturnValue({ id: 'skill-state-id' });

      expect(() => resolveSkillId('marketplace-skill', stateManager, config)).toThrow(
        'defined in both resources.skills and imported.skills'
      );
      expect(lookupSkillId('marketplace-skill', stateManager, config)).toBeUndefined();
    });

    it('should resolve multiple skill names preserving order', () => {
      config.resources.skills = [
        { name: 'managed-skill', description: 'Managed', file: 'skills/managed-skill.skill.md' },
      ];
      (stateManager.getSkillState as jest.Mock).mockImplementation((name: string) => {
        if (name === 'managed-skill') {
          return { id: 'skill-state-id' };
        }
        return undefined;
      });

      const ids = resolveSkillIds(['managed-skill', 'marketplace-skill'], stateManager, config);

      expect(ids).toEqual(['skill-state-id', 'skill-imported-id']);
    });
  });
});
