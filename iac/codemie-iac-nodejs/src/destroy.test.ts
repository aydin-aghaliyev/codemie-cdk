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

import { main } from './destroy';
import { CleanupManager } from './lib/cleanupManager';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { logger } from './lib/logger';
import { StateManager as StateManagerClass } from './lib/stateManager';
import type { CodemieConfig } from './types/codemieConfig';

// Mock external dependencies
jest.mock('./lib/clientFactory');
jest.mock('./lib/codemieConfigLoader');
jest.mock('./lib/stateManager');
jest.mock('./lib/cleanupManager');
jest.mock('./lib/logger');

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const MockedConfigLoader = CodemieConfigLoader as jest.MockedClass<typeof CodemieConfigLoader>;
const MockedStateManager = StateManagerClass as jest.MockedClass<typeof StateManagerClass>;
const MockedCleanupManager = CleanupManager as jest.MockedClass<typeof CleanupManager>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('destroy.ts', () => {
  describe('main', () => {
    let tempDir: string;
    let originalExit: typeof process.exit;
    let mockAppConfig: { rootDir: string; codemieConfig: string; codemieState: string; backupsDirectory: string };
    let destroyOptions: { appConfig: typeof mockAppConfig; force?: boolean };

    beforeEach(() => {
      jest.clearAllMocks();
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-test-'));

      // Mock process.exit
      originalExit = process.exit;
      process.exit = jest.fn() as unknown as typeof process.exit;

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

      MockedStateManager.mockImplementation(
        () =>
          ({
            getAllManagedResources: jest.fn().mockReturnValue({
              assistants: [],
              datasources: [],
              workflows: [],
              skills: [],
            }),
            loadState: jest.fn(),
            saveState: jest.fn(),
          }) as unknown as StateManagerClass
      );

      const mockClient = {
        assistants: { delete: jest.fn() },
        datasources: { delete: jest.fn() },
        workflows: { delete: jest.fn() },
      };
      mockCreateClient.mockResolvedValue(mockClient as unknown as CodeMieClient);

      MockedCleanupManager.mockImplementation(
        () =>
          ({
            deleteOrphanedResources: jest.fn().mockResolvedValue({
              deleted: { assistants: [], datasources: [], workflows: [], skills: [] },
              errors: [],
            }),
          }) as unknown as CleanupManager
      );

      mockAppConfig = {
        rootDir: process.cwd(),
        codemieConfig: 'codemie.yaml',
        codemieState: 'state.json',
        backupsDirectory: 'backups',
      };

      destroyOptions = {
        appConfig: mockAppConfig,
        force: true,
      };
    });

    afterEach(() => {
      process.exit = originalExit;
      jest.restoreAllMocks();
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should exit with 0 when no managed resources exist', async () => {
      await main(destroyOptions);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockedLogger.info).toHaveBeenCalledWith(expect.stringContaining('No managed resources found in state'));
    });

    it('should successfully destroy resources with --force flag', async () => {
      MockedStateManager.mockImplementation(
        () =>
          ({
            getAllManagedResources: jest.fn().mockReturnValue({
              assistants: ['A1', 'A2'],
              datasources: ['D1'],
              workflows: [],
              skills: [],
            }),
            loadState: jest.fn(),
            saveState: jest.fn(),
          }) as unknown as StateManagerClass
      );

      MockedCleanupManager.mockImplementation(
        () =>
          ({
            deleteOrphanedResources: jest.fn().mockResolvedValue({
              deleted: {
                assistants: ['A1', 'A2'],
                datasources: ['D1'],
                workflows: [],
                skills: [],
              },
              errors: [],
            }),
          }) as unknown as CleanupManager
      );

      await main(destroyOptions);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockedLogger.info).toHaveBeenCalledWith(expect.stringContaining('--force flag detected'));
      expect(mockedLogger.info).toHaveBeenCalledWith('✅ All managed resources destroyed');
    });

    it('should exit with 1 when deletion has errors', async () => {
      MockedStateManager.mockImplementation(
        () =>
          ({
            getAllManagedResources: jest.fn().mockReturnValue({
              assistants: ['A1'],
              datasources: [],
              workflows: [],
              skills: [],
            }),
            loadState: jest.fn(),
            saveState: jest.fn(),
          }) as unknown as StateManagerClass
      );

      MockedCleanupManager.mockImplementation(
        () =>
          ({
            deleteOrphanedResources: jest.fn().mockResolvedValue({
              deleted: {
                assistants: [],
                datasources: [],
                workflows: [],
                skills: [],
              },
              errors: [{ type: 'assistant', name: 'A1', id: 'ast-1', error: 'Deletion failed' }],
            }),
          }) as unknown as CleanupManager
      );

      await main(destroyOptions);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining('Destruction completed with errors'));
    });

    it('should handle errors gracefully', async () => {
      MockedConfigLoader.mockImplementation(() => {
        throw new Error('Config load failed');
      });

      await main(destroyOptions);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining('Destruction failed'));
      expect(mockedLogger.error).toHaveBeenCalledWith('Config load failed');
    });
  });
});
