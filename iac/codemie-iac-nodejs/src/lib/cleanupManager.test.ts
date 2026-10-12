/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { CodeMieClient } from 'codemie-sdk';

import type { CodemieConfig } from '../types/codemieConfig';

import { CleanupManager } from './cleanupManager';
import type { StateManager } from './stateManager';

describe('CleanupManager', () => {
  let cleanupManager: CleanupManager;
  let mockClient: jest.Mocked<CodeMieClient>;
  let mockStateManager: jest.Mocked<StateManager>;

  beforeEach(() => {
    mockClient = {
      assistants: {
        delete: jest.fn().mockResolvedValue(undefined),
      },
      datasources: {
        delete: jest.fn().mockResolvedValue(undefined),
      },
      workflows: {
        delete: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as jest.Mocked<CodeMieClient>;

    mockStateManager = {
      getAllManagedResources: jest.fn(),
      isManagedResource: jest.fn(),
      getIdByName: jest.fn(),
      deleteAssistantState: jest.fn(),
      deleteDatasourceState: jest.fn(),
      deleteWorkflowState: jest.fn(),
      deleteSkillState: jest.fn(),
    } as unknown as jest.Mocked<StateManager>;

    cleanupManager = new CleanupManager(mockClient, mockStateManager);
  });

  describe('isNotFoundError', () => {
    it('should detect 404 errors', () => {
      const error = new Error('Resource not found: 404');
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(true);
    });

    it('should detect "not found" messages', () => {
      const error = new Error('The resource was not found');
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(true);
    });

    it('should detect "Not Found" with capital letters', () => {
      const error = new Error('Not Found');
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(true);
    });

    it('should NOT detect other KeyErrors', () => {
      const error = new Error("KeyError: 'Something else went wrong'");
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(false);
    });

    it('should NOT detect unrelated errors', () => {
      const error = new Error('Connection timeout');
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(false);
    });

    it('should handle non-Error objects', () => {
      const error = 'Simple string error with 404';
      // @ts-expect-error - testing private method
      expect(cleanupManager.isNotFoundError(error)).toBe(true);
    });
  });

  describe('findOrphanedResources', () => {
    it('should find assistants in state but not in config', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: ['Assistant 1', 'Assistant 2', 'Assistant 3'],
        datasources: [],
        workflows: [],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {
          assistants: [{ name: 'Assistant 1' }],
          datasources: [],
          workflows: [],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.assistants).toEqual(['Assistant 2', 'Assistant 3']);
      expect(orphaned.datasources).toEqual([]);
      expect(orphaned.workflows).toEqual([]);
    });

    it('should find datasources in state but not in config', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: [],
        datasources: ['DS 1', 'DS 2'],
        workflows: [],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {
          assistants: [],
          datasources: [{ name: 'DS 1' }],
          workflows: [],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.datasources).toEqual(['DS 2']);
    });

    it('should find workflows in state but not in config', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: [],
        datasources: [],
        workflows: ['Workflow 1', 'Workflow 2'],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {
          assistants: [],
          datasources: [],
          workflows: [{ name: 'Workflow 1' }],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.workflows).toEqual(['Workflow 2']);
    });

    it('should return empty when no orphaned resources', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: ['Assistant 1'],
        datasources: ['DS 1'],
        workflows: ['Workflow 1'],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {
          assistants: [{ name: 'Assistant 1' }],
          datasources: [{ name: 'DS 1' }],
          workflows: [{ name: 'Workflow 1' }],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.assistants).toEqual([]);
      expect(orphaned.datasources).toEqual([]);
      expect(orphaned.workflows).toEqual([]);
    });

    it('should handle empty state', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: [],
        datasources: [],
        workflows: [],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {
          assistants: [{ name: 'New Assistant' }],
          datasources: [],
          workflows: [],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.assistants).toEqual([]);
    });

    it('should handle undefined resource arrays in config', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: ['Assistant 1'],
        datasources: ['DS 1'],
        workflows: ['Workflow 1'],
        skills: [],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {},
        resources: {},
      } as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.assistants).toEqual(['Assistant 1']);
      expect(orphaned.datasources).toEqual(['DS 1']);
      expect(orphaned.workflows).toEqual(['Workflow 1']);
    });

    it('should treat stale managed skill state as orphaned even if imported.skills has the same name', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: [],
        datasources: [],
        workflows: [],
        skills: ['marketplace-skill'],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {
          skills: [{ name: 'marketplace-skill', id: 'skill-imported-id' }],
        },
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.skills).toEqual(['marketplace-skill']);
    });

    it('should find skills orphaned when absent from resources and imported.skills', () => {
      mockStateManager.getAllManagedResources.mockReturnValue({
        assistants: [],
        datasources: [],
        workflows: [],
        skills: ['removed-skill'],
      });

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {},
        imported: {
          skills: [{ name: 'marketplace-skill', id: 'skill-imported-id' }],
        },
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          skills: [],
        },
      } as unknown as CodemieConfig;

      const orphaned = cleanupManager.findOrphanedResources(config);

      expect(orphaned.skills).toEqual(['removed-skill']);
    });
  });

  describe('deleteOrphanedResources', () => {
    beforeEach(() => {
      mockStateManager.isManagedResource.mockReturnValue(true);
      mockStateManager.getIdByName.mockImplementation((type, name) => `${type}-${name}-id`);
    });

    it('should successfully delete orphaned assistants', async () => {
      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockClient.assistants.delete).toHaveBeenCalledWith('assistant-Assistant 1-id');
      expect(mockStateManager.deleteAssistantState).toHaveBeenCalledWith('Assistant 1');
      expect(result.deleted.assistants).toEqual(['Assistant 1']);
      expect(result.errors).toEqual([]);
    });

    it('should successfully delete orphaned datasources', async () => {
      const orphaned = {
        assistants: [],
        datasources: ['DS 1'],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockClient.datasources.delete).toHaveBeenCalledWith('datasource-DS 1-id');
      expect(mockStateManager.deleteDatasourceState).toHaveBeenCalledWith('DS 1');
      expect(result.deleted.datasources).toEqual(['DS 1']);
    });

    it('should successfully delete orphaned workflows', async () => {
      const orphaned = {
        assistants: [],
        datasources: [],
        workflows: ['Workflow 1'],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockClient.workflows.delete).toHaveBeenCalledWith('workflow-Workflow 1-id');
      expect(mockStateManager.deleteWorkflowState).toHaveBeenCalledWith('Workflow 1');
      expect(result.deleted.workflows).toEqual(['Workflow 1']);
    });

    it('should skip resources not in state', async () => {
      mockStateManager.isManagedResource.mockReturnValue(false);

      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockClient.assistants.delete).not.toHaveBeenCalled();
      expect(result.deleted.assistants).toEqual([]);
    });

    it('should skip resources without ID in state', async () => {
      mockStateManager.getIdByName.mockReturnValue(undefined);

      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockClient.assistants.delete).not.toHaveBeenCalled();
      expect(result.deleted.assistants).toEqual([]);
    });

    it('should handle 404 errors gracefully and remove from state', async () => {
      (mockClient.assistants.delete as jest.Mock).mockRejectedValue(new Error('404 not found'));

      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockStateManager.deleteAssistantState).toHaveBeenCalledWith('Assistant 1');
      expect(result.deleted.assistants).toEqual(['Assistant 1']);
      expect(result.errors).toEqual([]);
    });

    it('should collect non-404 errors', async () => {
      (mockClient.assistants.delete as jest.Mock).mockRejectedValue(new Error('Network error'));

      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(mockStateManager.deleteAssistantState).not.toHaveBeenCalled();
      expect(result.deleted.assistants).toEqual([]);
      expect(result.errors).toEqual([
        {
          type: 'assistant',
          name: 'Assistant 1',
          error: 'Network error',
        },
      ]);
    });

    it('should handle multiple resources of different types', async () => {
      const orphaned = {
        assistants: ['Assistant 1', 'Assistant 2'],
        datasources: ['DS 1'],
        workflows: ['Workflow 1'],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(result.deleted.assistants).toEqual(['Assistant 1', 'Assistant 2']);
      expect(result.deleted.datasources).toEqual(['DS 1']);
      expect(result.deleted.workflows).toEqual(['Workflow 1']);
    });

    it('should continue deleting after one error', async () => {
      (mockClient.assistants.delete as jest.Mock).mockImplementation((id: string) => {
        if (id === 'assistant-Assistant 1-id') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(undefined);
      });

      const orphaned = {
        assistants: ['Assistant 1', 'Assistant 2'],
        datasources: [],
        workflows: [],
      };

      const result = await cleanupManager.deleteOrphanedResources(orphaned);

      expect(result.deleted.assistants).toEqual(['Assistant 2']);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].name).toBe('Assistant 1');
    });
  });

  describe('getOrphanedSummary', () => {
    it('should return message when no orphaned resources', () => {
      const orphaned = {
        assistants: [],
        datasources: [],
        workflows: [],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toBe('No orphaned resources found');
    });

    it('should summarize only assistants', () => {
      const orphaned = {
        assistants: ['Assistant 1', 'Assistant 2'],
        datasources: [],
        workflows: [],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toBe('Found 2 orphaned resource(s): 2 assistant(s)');
    });

    it('should summarize only datasources', () => {
      const orphaned = {
        assistants: [],
        datasources: ['DS 1'],
        workflows: [],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toBe('Found 1 orphaned resource(s): 1 datasource(s)');
    });

    it('should summarize only workflows', () => {
      const orphaned = {
        assistants: [],
        datasources: [],
        workflows: ['Workflow 1', 'Workflow 2', 'Workflow 3'],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toBe('Found 3 orphaned resource(s): 3 workflow(s)');
    });

    it('should summarize multiple resource types', () => {
      const orphaned = {
        assistants: ['Assistant 1'],
        datasources: ['DS 1', 'DS 2'],
        workflows: ['Workflow 1'],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toBe('Found 4 orphaned resource(s): 1 assistant(s), 2 datasource(s), 1 workflow(s)');
    });

    it('should count total correctly', () => {
      const orphaned = {
        assistants: ['A1', 'A2', 'A3'],
        datasources: ['D1', 'D2'],
        workflows: ['W1'],
      };

      const summary = cleanupManager.getOrphanedSummary(orphaned);

      expect(summary).toContain('Found 6 orphaned resource(s)');
    });
  });
});
