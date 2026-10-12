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

import { checkAssistantExists, checkDatasourceExists, checkWorkflowExists } from './resourceExistenceChecker';
import { StateManager } from './stateManager';

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

describe('resourceExistenceChecker', () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'existence-checker-test-'));
    const appConfig = {
      rootDir: tempDir,
      codemieConfig: 'codemie.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    };
    stateManager = new StateManager(appConfig);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('checkAssistantExists', () => {
    it('should return false when no state exists', async () => {
      const client = createMockClient();
      const exists = await checkAssistantExists(client, 'NonExistent', stateManager);
      expect(exists).toBe(false);
    });

    it('should return false when assistant not found on platform', async () => {
      const client = createMockClient([]);
      const assistant = { name: 'Test', prompt: 'test.md', model: 'gpt-4', description: 'Test' };
      stateManager.updateAssistantState('Test', 'ast-123', 'prompt', assistant);

      const exists = await checkAssistantExists(client, 'Test', stateManager);
      expect(exists).toBe(false);
    });

    it('should return true when assistant exists on platform', async () => {
      const client = createMockClient(['ast-123']);
      const assistant = { name: 'Test', prompt: 'test.md', model: 'gpt-4', description: 'Test' };
      stateManager.updateAssistantState('Test', 'ast-123', 'prompt', assistant);

      const exists = await checkAssistantExists(client, 'Test', stateManager);
      expect(exists).toBe(true);
    });
  });

  describe('checkDatasourceExists', () => {
    it('should return false when no state exists', async () => {
      const client = createMockClient();
      const exists = await checkDatasourceExists(client, 'NonExistent', stateManager);
      expect(exists).toBe(false);
    });

    it('should return false when datasource not found on platform', async () => {
      const client = createMockClient([]);
      stateManager.updateDatasourceState('Test', 'ds-123', {
        name: 'Test',
        type: 'code' as const,
        description: 'Test',
      });

      const exists = await checkDatasourceExists(client, 'Test', stateManager);
      expect(exists).toBe(false);
    });

    it('should return true when datasource exists on platform', async () => {
      const client = createMockClient(['ds-123']);
      stateManager.updateDatasourceState('Test', 'ds-123', {
        name: 'Test',
        type: 'code' as const,
        description: 'Test',
      });

      const exists = await checkDatasourceExists(client, 'Test', stateManager);
      expect(exists).toBe(true);
    });
  });

  describe('checkWorkflowExists', () => {
    it('should return false when no state exists', async () => {
      const client = createMockClient();
      const exists = await checkWorkflowExists(client, 'NonExistent', stateManager);
      expect(exists).toBe(false);
    });

    it('should return false when workflow not found on platform', async () => {
      const client = createMockClient([]);
      stateManager.updateWorkflowState('Test', 'wf-123', 'yaml', 'config');

      const exists = await checkWorkflowExists(client, 'Test', stateManager);
      expect(exists).toBe(false);
    });

    it('should return true when workflow exists on platform', async () => {
      const client = createMockClient(['wf-123']);
      stateManager.updateWorkflowState('Test', 'wf-123', 'yaml', 'config');

      const exists = await checkWorkflowExists(client, 'Test', stateManager);
      expect(exists).toBe(true);
    });
  });
});
