/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BackupTransaction } from './backupTransaction';

describe('BackupTransaction', () => {
  let testBackupDir: string;
  let transaction: BackupTransaction;

  beforeAll(() => {
    // Use fake timers for better control over setTimeout in scheduleSave
    jest.useFakeTimers();
  });

  afterAll(() => {
    // Restore real timers
    jest.useRealTimers();
  });

  beforeEach(() => {
    testBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-transaction-test-'));
    transaction = new BackupTransaction(testBackupDir);
  });

  afterEach(() => {
    // Force flush any pending saves to prevent timers from blocking cleanup
    if (transaction) {
      transaction.flush();
    }

    // Clear all timers to prevent them from blocking directory cleanup
    jest.clearAllTimers();

    // Clean up test directory after each test
    if (testBackupDir && fs.existsSync(testBackupDir)) {
      fs.rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create new transaction with empty state', () => {
      const data = transaction.getData();

      expect(data.resources.assistants.total).toBe(0);
      expect(data.resources.assistants.completed).toEqual([]);
      expect(data.resources.assistants.failed).toEqual([]);
      expect(data.resources.datasources.total).toBe(0);
      expect(data.resources.workflows.total).toBe(0);
      expect(data.status).toBe('in-progress');
    });

    it('should resume from existing transaction file', async () => {
      // Create initial transaction
      const initial = new BackupTransaction(testBackupDir);
      initial.setTotal('assistants', 5);
      initial.markCompleted('assistants', 'ast-1');
      initial.markCompleted('assistants', 'ast-2');
      await initial.save();

      // Create new transaction that should resume
      const resumed = new BackupTransaction(testBackupDir);
      const data = resumed.getData();

      expect(data.resources.assistants.total).toBe(5);
      expect(data.resources.assistants.completed).toEqual(['ast-1', 'ast-2']);
      expect(resumed.isCompleted('assistants', 'ast-1')).toBe(true);
      expect(resumed.isCompleted('assistants', 'ast-3')).toBe(false);
    });
  });

  describe('setTotal', () => {
    it('should set total count for resource type', () => {
      transaction.setTotal('assistants', 10);
      transaction.setTotal('datasources', 5);

      const data = transaction.getData();
      expect(data.resources.assistants.total).toBe(10);
      expect(data.resources.datasources.total).toBe(5);
    });
  });

  describe('markCompleted', () => {
    it('should mark resource as completed', () => {
      transaction.markCompleted('assistants', 'ast-123');

      expect(transaction.isCompleted('assistants', 'ast-123')).toBe(true);
      expect(transaction.getData().resources.assistants.completed).toEqual(['ast-123']);
    });

    it('should not add duplicate completed resource', () => {
      transaction.markCompleted('assistants', 'ast-123');
      transaction.markCompleted('assistants', 'ast-123');

      expect(transaction.getData().resources.assistants.completed).toEqual(['ast-123']);
    });

    it('should handle multiple completed resources', () => {
      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('assistants', 'ast-2');
      transaction.markCompleted('datasources', 'ds-1');

      expect(transaction.getData().resources.assistants.completed).toEqual(['ast-1', 'ast-2']);
      expect(transaction.getData().resources.datasources.completed).toEqual(['ds-1']);
    });
  });

  describe('markFailed', () => {
    it('should mark resource as failed with error message', () => {
      transaction.markFailed('assistants', 'ast-failed', 'Connection timeout');

      const data = transaction.getData();
      expect(data.resources.assistants.failed).toHaveLength(1);
      expect(data.resources.assistants.failed[0].id).toBe('ast-failed');
      expect(data.resources.assistants.failed[0].error).toBe('Connection timeout');
    });

    it('should not mark as completed when failed', () => {
      transaction.markFailed('assistants', 'ast-failed', 'Error');

      expect(transaction.isCompleted('assistants', 'ast-failed')).toBe(false);
      expect(transaction.getData().resources.assistants.completed).not.toContain('ast-failed');
    });

    it('should handle multiple failures', () => {
      transaction.markFailed('workflows', 'wf-1', 'Error 1');
      transaction.markFailed('workflows', 'wf-2', 'Error 2');

      const data = transaction.getData();
      expect(data.resources.workflows.failed).toHaveLength(2);
      expect(data.resources.workflows.failed[0].id).toBe('wf-1');
      expect(data.resources.workflows.failed[1].id).toBe('wf-2');
    });
  });

  describe('isCompleted', () => {
    it('should return false for non-completed resource', () => {
      expect(transaction.isCompleted('assistants', 'ast-999')).toBe(false);
    });

    it('should return true for completed resource', () => {
      transaction.markCompleted('datasources', 'ds-123');

      expect(transaction.isCompleted('datasources', 'ds-123')).toBe(true);
    });

    it('should return false for failed resource', () => {
      transaction.markFailed('workflows', 'wf-failed', 'Error');

      expect(transaction.isCompleted('workflows', 'wf-failed')).toBe(false);
    });
  });

  describe('complete', () => {
    it('should mark transaction as completed', () => {
      transaction.complete();

      expect(transaction.getData().status).toBe('completed');
    });

    it('should set completion timestamp', () => {
      const beforeComplete = Date.now();
      transaction.complete();
      const afterComplete = Date.now();

      const data = transaction.getData();
      expect(data.endTime).toBeDefined();
      const endTimeMs = new Date(data.endTime!).getTime();
      expect(endTimeMs).toBeGreaterThanOrEqual(beforeComplete);
      expect(endTimeMs).toBeLessThanOrEqual(afterComplete);
    });
  });

  describe('getSummary', () => {
    it('should return formatted summary for empty transaction', () => {
      const summary = transaction.getSummary();

      expect(summary).toContain('assistants: 0/0 (0%)');
      expect(summary).toContain('datasources: 0/0 (0%)');
      expect(summary).toContain('workflows: 0/0 (0%)');
    });

    it('should return formatted summary with progress', () => {
      transaction.setTotal('assistants', 10);
      transaction.setTotal('datasources', 5);

      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('assistants', 'ast-2');
      transaction.markCompleted('assistants', 'ast-3');

      transaction.markCompleted('datasources', 'ds-1');
      transaction.markFailed('datasources', 'ds-2', 'Error');

      const summary = transaction.getSummary();

      expect(summary).toContain('assistants: 3/10 (30%)');
      expect(summary).toContain('datasources: 1/5 (20%)');
      expect(summary).toContain('[1 failed]');
    });

    it('should include failed resource count in summary', () => {
      transaction.markFailed('workflows', 'wf-1', 'Timeout');
      transaction.markFailed('workflows', 'wf-2', 'Not found');

      const summary = transaction.getSummary();

      expect(summary).toContain('workflows: 0/0 (0%)');
      expect(summary).toContain('[2 failed]');
    });
  });

  describe('save', () => {
    it('should save transaction to file', async () => {
      transaction.setTotal('assistants', 5);
      transaction.markCompleted('assistants', 'ast-1');
      await transaction.save();

      const filePath = path.join(testBackupDir, 'transaction.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.assistants.total).toBe(5);
      expect(saved.resources.assistants.completed).toEqual(['ast-1']);
    });

    it('should update existing transaction file', async () => {
      transaction.markCompleted('assistants', 'ast-1');
      await transaction.save();

      transaction.markCompleted('assistants', 'ast-2');
      await transaction.save();

      const filePath = path.join(testBackupDir, 'transaction.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.assistants.completed).toEqual(['ast-1', 'ast-2']);
    });
  });

  describe('cleanup', () => {
    it('should remove transaction file', async () => {
      await transaction.save();
      const filePath = path.join(testBackupDir, 'transaction.json');

      expect(fs.existsSync(filePath)).toBe(true);

      transaction.cleanup();

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should not throw if transaction file does not exist', () => {
      expect(() => transaction.cleanup()).not.toThrow();
    });
  });

  describe('getData', () => {
    it('should return deep copy of transaction data', () => {
      transaction.markCompleted('assistants', 'ast-1');

      const data1 = transaction.getData();
      const data2 = transaction.getData();

      // Modify first copy
      data1.resources.assistants.completed.push('ast-2');

      // Second copy should not be affected
      expect(data2.resources.assistants.completed).toEqual(['ast-1']);
    });
  });

  describe('fail', () => {
    it('should mark transaction as failed', () => {
      transaction.fail();

      expect(transaction.getData().status).toBe('failed');
    });

    it('should set failure timestamp', () => {
      const beforeFail = Date.now();
      transaction.fail();
      const afterFail = Date.now();

      const data = transaction.getData();
      expect(data.endTime).toBeDefined();
      const endTimeMs = new Date(data.endTime!).getTime();
      expect(endTimeMs).toBeGreaterThanOrEqual(beforeFail);
      expect(endTimeMs).toBeLessThanOrEqual(afterFail);
    });

    it('should flush changes immediately on failure', () => {
      transaction.setTotal('assistants', 5);
      transaction.fail();

      // Verify file was written
      const filePath = path.join(testBackupDir, 'transaction.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.status).toBe('failed');
    });
  });

  describe('flush', () => {
    it('should immediately save pending changes', () => {
      transaction.setTotal('assistants', 10);
      transaction.markCompleted('assistants', 'ast-1');

      // Call flush to save immediately
      transaction.flush();

      const filePath = path.join(testBackupDir, 'transaction.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.assistants.total).toBe(10);
      expect(saved.resources.assistants.completed).toEqual(['ast-1']);
    });

    it('should not write if no changes pending', () => {
      const filePath = path.join(testBackupDir, 'transaction.json');

      // Ensure file doesn't exist
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Flush with no changes
      transaction.flush();

      // File should not be created
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should clear scheduled save timer', () => {
      transaction.setTotal('assistants', 5);
      // scheduleSave is called internally, which sets a timer
      // flush should clear it
      transaction.flush();

      // Change again and flush immediately
      transaction.setTotal('datasources', 3);
      transaction.flush();

      const filePath = path.join(testBackupDir, 'transaction.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.datasources.total).toBe(3);
    });
  });

  describe('batched saves', () => {
    it('should batch multiple changes into one save', () => {
      // Make multiple changes rapidly
      transaction.setTotal('assistants', 10);
      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('assistants', 'ast-2');
      transaction.markCompleted('assistants', 'ast-3');

      // Advance timers to trigger batched save (1 second debounce)
      jest.advanceTimersByTime(1100);

      const filePath = path.join(testBackupDir, 'transaction.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.assistants.completed).toEqual(['ast-1', 'ast-2', 'ast-3']);
    });

    it('should not schedule multiple saves for same batch', () => {
      // Make changes in quick succession
      transaction.setTotal('workflows', 5);
      transaction.markCompleted('workflows', 'wf-1');
      transaction.markCompleted('workflows', 'wf-2');

      // Advance timers to trigger save
      jest.advanceTimersByTime(1100);

      // Verify all changes were saved once
      const filePath = path.join(testBackupDir, 'transaction.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupTransaction['data'];
      expect(saved.resources.workflows.total).toBe(5);
      expect(saved.resources.workflows.completed).toHaveLength(2);
    });
  });

  describe('integrations resource type', () => {
    it('should track integrations separately', () => {
      transaction.setTotal('integrations', 3);
      transaction.markCompleted('integrations', 'int-1');
      transaction.markCompleted('integrations', 'int-2');
      transaction.markFailed('integrations', 'int-3', 'API error');

      const data = transaction.getData();
      expect(data.resources.integrations.total).toBe(3);
      expect(data.resources.integrations.completed).toEqual(['int-1', 'int-2']);
      expect(data.resources.integrations.failed).toHaveLength(1);
      expect(data.resources.integrations.failed[0].id).toBe('int-3');
    });

    it('should include integrations in summary', () => {
      transaction.setTotal('integrations', 10);
      transaction.markCompleted('integrations', 'int-1');
      transaction.markCompleted('integrations', 'int-2');

      const summary = transaction.getSummary();
      expect(summary).toContain('integrations: 2/10 (20%)');
    });
  });

  describe('markFailed edge cases', () => {
    it('should not add duplicate failed entries', () => {
      transaction.markFailed('workflows', 'wf-1', 'Error 1');
      transaction.markFailed('workflows', 'wf-1', 'Error 2');

      const data = transaction.getData();
      expect(data.resources.workflows.failed).toHaveLength(1);
      expect(data.resources.workflows.failed[0].error).toBe('Error 1');
    });
  });

  describe('error handling', () => {
    it('should handle corrupted transaction file', () => {
      const filePath = path.join(testBackupDir, 'transaction.json');
      fs.writeFileSync(filePath, 'invalid json{', 'utf8');

      expect(() => new BackupTransaction(testBackupDir)).toThrow();
    });

    it('should handle save to non-existent directory', async () => {
      const nonExistentDir = path.join(testBackupDir, 'nested', 'deep', 'path');
      const trans = new BackupTransaction(nonExistentDir);

      trans.setTotal('assistants', 1);
      await expect(trans.save()).resolves.not.toThrow();

      // Verify directory and file were created
      expect(fs.existsSync(path.join(nonExistentDir, 'transaction.json'))).toBe(true);
    });

    it('should handle cleanup of non-existent file gracefully', () => {
      const trans = new BackupTransaction(testBackupDir);
      const filePath = path.join(testBackupDir, 'transaction.json');

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      expect(() => trans.cleanup()).not.toThrow();
    });

    it('should throw error if save fails due to write error', async () => {
      const trans = new BackupTransaction(testBackupDir);
      trans.setTotal('assistants', 1);

      // Mock fs.promises.writeFile to simulate write error
      const originalWriteFile = fs.promises.writeFile;
      (fs.promises as Record<string, unknown>).writeFile = jest.fn().mockRejectedValue(new Error('Disk full'));

      await expect(trans.save()).rejects.toThrow('Failed to save transaction file');

      // Restore original implementation
      (fs.promises as Record<string, unknown>).writeFile = originalWriteFile;
    });

    it('should handle EEXIST error when creating new transaction file', () => {
      const filePath = path.join(testBackupDir, 'transaction.json');

      // Create a valid transaction file first
      const existingData = {
        id: 'existing-transaction-id',
        status: 'in-progress' as const,
        startTime: new Date().toISOString(),
        backupDir: testBackupDir,
        resources: {
          assistants: { total: 5, completed: ['ast-1'], failed: [] },
          datasources: { total: 0, completed: [], failed: [] },
          workflows: { total: 0, completed: [], failed: [] },
          integrations: { total: 0, completed: [], failed: [] },
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');

      // Now try to create a new transaction - it should read the existing one
      const trans = new BackupTransaction(testBackupDir, 'new-id');

      // Should have loaded the existing transaction data
      expect(trans.getData().id).toBe('existing-transaction-id');
      expect(trans.getData().resources.assistants.total).toBe(5);
      expect(trans.getData().resources.assistants.completed).toEqual(['ast-1']);
    });
  });

  describe('getSummary edge cases', () => {
    it('should show 100% completion when all resources are done', () => {
      transaction.setTotal('assistants', 2);
      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('assistants', 'ast-2');

      const summary = transaction.getSummary();
      expect(summary).toContain('assistants: 2/2 (100%)');
    });

    it('should handle resources with only failures', () => {
      transaction.setTotal('workflows', 3);
      transaction.markFailed('workflows', 'wf-1', 'Error 1');
      transaction.markFailed('workflows', 'wf-2', 'Error 2');
      transaction.markFailed('workflows', 'wf-3', 'Error 3');

      const summary = transaction.getSummary();
      expect(summary).toContain('workflows: 0/3 (0%)');
      expect(summary).toContain('[3 failed]');
    });

    it('should show all resource types in summary', () => {
      const summary = transaction.getSummary();
      expect(summary).toContain('assistants:');
      expect(summary).toContain('datasources:');
      expect(summary).toContain('workflows:');
      expect(summary).toContain('integrations:');
    });
  });

  describe('custom transaction ID', () => {
    it('should use provided transaction ID', () => {
      // Ensure no existing transaction file
      const transactionPath = path.join(testBackupDir, 'transaction.json');
      if (fs.existsSync(transactionPath)) {
        fs.unlinkSync(transactionPath);
      }

      const customId = 'custom-backup-id-123';
      const trans = new BackupTransaction(testBackupDir, customId);

      expect(trans.getData().id).toBe(customId);
    });

    it('should generate transaction ID if not provided', () => {
      // Ensure no existing transaction file
      const transactionPath = path.join(testBackupDir, 'transaction.json');
      if (fs.existsSync(transactionPath)) {
        fs.unlinkSync(transactionPath);
      }

      const trans = new BackupTransaction(testBackupDir);
      const data = trans.getData();

      expect(data.id).toBeDefined();
      expect(data.id.length).toBeGreaterThan(0);
      expect(typeof data.id).toBe('string');
    });
  });

  describe('integration scenarios', () => {
    it('should handle full backup workflow', async () => {
      // Setup
      transaction.setTotal('assistants', 3);
      transaction.setTotal('datasources', 2);
      transaction.setTotal('workflows', 1);

      // Backup assistants
      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('assistants', 'ast-2');
      transaction.markFailed('assistants', 'ast-3', 'Timeout');
      await transaction.save();

      // Backup datasources
      transaction.markCompleted('datasources', 'ds-1');
      transaction.markCompleted('datasources', 'ds-2');
      await transaction.save();

      // Backup workflows
      transaction.markCompleted('workflows', 'wf-1');
      await transaction.save();

      // Complete
      transaction.complete();

      // Verify
      const data = transaction.getData();
      expect(data.status).toBe('completed');
      expect(data.resources.assistants.completed).toHaveLength(2);
      expect(data.resources.assistants.failed).toHaveLength(1);
      expect(data.resources.datasources.completed).toHaveLength(2);
      expect(data.resources.workflows.completed).toHaveLength(1);
    });

    it('should resume interrupted backup', async () => {
      // Start backup
      const initial = new BackupTransaction(testBackupDir);
      initial.setTotal('assistants', 5);
      initial.setTotal('datasources', 3);

      initial.markCompleted('assistants', 'ast-1');
      initial.markCompleted('assistants', 'ast-2');
      initial.markCompleted('datasources', 'ds-1');
      await initial.save();

      // Simulate interruption (create new transaction instance)
      const resumed = new BackupTransaction(testBackupDir);

      // Continue backup
      expect(resumed.isCompleted('assistants', 'ast-1')).toBe(true);
      expect(resumed.isCompleted('assistants', 'ast-2')).toBe(true);
      expect(resumed.isCompleted('assistants', 'ast-3')).toBe(false);

      resumed.markCompleted('assistants', 'ast-3');
      resumed.markCompleted('assistants', 'ast-4');
      resumed.markCompleted('assistants', 'ast-5');
      resumed.markCompleted('datasources', 'ds-2');
      resumed.markCompleted('datasources', 'ds-3');
      resumed.complete();

      // Verify
      const data = resumed.getData();
      expect(data.resources.assistants.completed).toHaveLength(5);
      expect(data.resources.datasources.completed).toHaveLength(3);
      expect(data.status).toBe('completed');
    });

    it('should handle backup with all resource types', async () => {
      transaction.setTotal('assistants', 2);
      transaction.setTotal('datasources', 2);
      transaction.setTotal('workflows', 2);
      transaction.setTotal('integrations', 2);

      transaction.markCompleted('assistants', 'ast-1');
      transaction.markCompleted('datasources', 'ds-1');
      transaction.markCompleted('workflows', 'wf-1');
      transaction.markCompleted('integrations', 'int-1');

      transaction.markFailed('assistants', 'ast-2', 'Error');
      transaction.markFailed('datasources', 'ds-2', 'Error');
      transaction.markFailed('workflows', 'wf-2', 'Error');
      transaction.markFailed('integrations', 'int-2', 'Error');

      await transaction.save();

      const data = transaction.getData();
      expect(data.resources.assistants.completed).toHaveLength(1);
      expect(data.resources.datasources.completed).toHaveLength(1);
      expect(data.resources.workflows.completed).toHaveLength(1);
      expect(data.resources.integrations.completed).toHaveLength(1);

      expect(data.resources.assistants.failed).toHaveLength(1);
      expect(data.resources.datasources.failed).toHaveLength(1);
      expect(data.resources.workflows.failed).toHaveLength(1);
      expect(data.resources.integrations.failed).toHaveLength(1);
    });

    it('should handle failure during backup', async () => {
      transaction.setTotal('assistants', 3);
      transaction.markCompleted('assistants', 'ast-1');
      await transaction.save();

      // Simulate critical failure
      transaction.fail();

      const data = transaction.getData();
      expect(data.status).toBe('failed');
      expect(data.endTime).toBeDefined();
      expect(data.resources.assistants.completed).toEqual(['ast-1']);
    });
  });
});
