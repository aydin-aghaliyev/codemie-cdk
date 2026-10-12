/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BACKUP } from './constants';
import { ensureDirectoryExists } from './fileUtils';
import { logger } from './logger';

/**
 * Synchronous delay using busy-wait (blocks thread)
 * Use only when async delay is not suitable (e.g., in synchronous context)
 */
function busyWaitDelay(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait
  }
}

/**
 * Backup transaction for atomicity and resume capability
 * Tracks progress during backup to enable recovery from failures
 */

export interface BackupTransactionData {
  id: string;
  status: 'in-progress' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  backupDir: string;
  resources: {
    assistants: {
      total: number;
      completed: string[]; // IDs of completed assistants
      failed: Array<{ id: string; error: string }>;
    };
    datasources: {
      total: number;
      completed: string[];
      failed: Array<{ id: string; error: string }>;
    };
    workflows: {
      total: number;
      completed: string[];
      failed: Array<{ id: string; error: string }>;
    };
    integrations: {
      total: number;
      completed: string[];
      failed: Array<{ id: string; error: string }>;
    };
    skills: {
      total: number;
      completed: string[];
      failed: Array<{ id: string; error: string }>;
    };
  };
}

export class BackupTransaction {
  private data: BackupTransactionData;
  private transactionPath: string;
  private isDirty = false;
  private saveTimer?: NodeJS.Timeout;

  constructor(backupDir: string, transactionId?: string) {
    this.transactionPath = path.join(backupDir, 'transaction.json');

    try {
      // Try to read existing transaction file atomically
      const content = fs.readFileSync(this.transactionPath, 'utf8');
      this.data = JSON.parse(content) as BackupTransactionData;
      logger.info(`📂 Resuming backup transaction ${this.data.id}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ENOENT = Error NO ENTry (file does not exist)
      if (err.code === 'ENOENT') {
        this.data = this.createNewTransaction(backupDir, transactionId);
      } else {
        throw error;
      }
    }
  }

  private createNewTransaction(backupDir: string, transactionId?: string): BackupTransactionData {
    const newData: BackupTransactionData = {
      id: transactionId || this.generateTransactionId(),
      status: 'in-progress',
      startTime: new Date().toISOString(),
      backupDir,
      resources: {
        assistants: { total: 0, completed: [], failed: [] },
        datasources: { total: 0, completed: [], failed: [] },
        workflows: { total: 0, completed: [], failed: [] },
        integrations: { total: 0, completed: [], failed: [] },
        skills: { total: 0, completed: [], failed: [] },
      },
    };

    // Ensure directory exists
    ensureDirectoryExists(this.transactionPath);

    // Try to create file exclusively
    this.writeTransactionExclusively(newData);

    return newData;
  }

  private writeTransactionExclusively(data: BackupTransactionData): void {
    try {
      const fd = fs.openSync(this.transactionPath, 'wx');
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.closeSync(fd);
    } catch (writeError) {
      const writeErr = writeError as NodeJS.ErrnoException;
      if (writeErr.code === 'EEXIST') {
        // File created by concurrent process - retry reading with backoff
        this.readWithRetry();
      } else {
        throw writeError;
      }
    }
  }

  private readWithRetry(): void {
    let retries = 3;
    let lastReadError: Error | undefined;

    while (retries > 0) {
      try {
        // Small delay to allow concurrent write to complete
        const delayMs = 100 * (4 - retries); // 100ms, 200ms, 300ms
        if (delayMs > 0) {
          busyWaitDelay(delayMs);
        }

        const content = fs.readFileSync(this.transactionPath, 'utf8');
        this.data = JSON.parse(content) as BackupTransactionData;
        logger.info(`📂 Resuming backup transaction ${this.data.id} (created by concurrent process)`);
        break;
      } catch (readError) {
        lastReadError = readError instanceof Error ? readError : new Error(String(readError));
        retries--;

        if (retries === 0) {
          throw new Error(
            `Failed to read transaction file after retries: ${lastReadError.message}. ` +
              `File may be corrupted. Delete ${this.transactionPath} and retry.`
          );
        }
      }
    }
  }

  private generateTransactionId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Save transaction state to disk (checkpoint) with timeout protection
   */
  async save(): Promise<void> {
    ensureDirectoryExists(this.transactionPath);

    // Use async write with timeout to prevent hanging on slow/network storage
    const savePromise = fs.promises.writeFile(this.transactionPath, JSON.stringify(this.data, null, 2), 'utf8');

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Transaction save timeout after ${BACKUP.TRANSACTION_SAVE_TIMEOUT_MS}ms`)),
        BACKUP.TRANSACTION_SAVE_TIMEOUT_MS
      );
      // Unref the timer so it doesn't keep the process alive
      timeoutId.unref();
    });

    try {
      await Promise.race([savePromise, timeoutPromise]);
      this.isDirty = false;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to save transaction file: ${err.message}`);
    } finally {
      // Clean up the timeout timer if save completes first
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Internal synchronous save for batching
   */
  private saveSyncInternal(): void {
    ensureDirectoryExists(this.transactionPath);
    fs.writeFileSync(this.transactionPath, JSON.stringify(this.data, null, 2), 'utf8');
    this.isDirty = false;
  }

  /**
   * Schedule batched save (debounced to avoid excessive disk writes)
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      return; // Already scheduled
    }

    this.saveTimer = setTimeout(() => {
      if (this.isDirty) {
        this.saveSyncInternal();
      }
      this.saveTimer = undefined;
    }, 1000); // Batch updates every 1 second

    // Unref the timer so it doesn't keep the process alive
    this.saveTimer.unref();
  }

  /**
   * Internal method to finalize transaction with a specific status
   */
  private end(status: 'completed' | 'failed'): void {
    this.data.status = status;
    this.data.endTime = new Date().toISOString();
    this.flush(); // Force immediate save
  }

  /**
   * Force immediate save (flush pending changes)
   */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.isDirty) {
      this.saveSyncInternal();
    }
  }

  /**
   * Set total count for a resource type
   */
  setTotal(resourceType: keyof BackupTransactionData['resources'], total: number): void {
    this.data.resources[resourceType].total = total;
    this.isDirty = true;
    this.scheduleSave();
  }

  /**
   * Mark resource as completed
   */
  markCompleted(resourceType: keyof BackupTransactionData['resources'], resourceId: string): void {
    if (!this.data.resources[resourceType].completed.includes(resourceId)) {
      this.data.resources[resourceType].completed.push(resourceId);
      this.isDirty = true;
      this.scheduleSave();
    }
  }

  /**
   * Mark resource as failed
   */
  markFailed(resourceType: keyof BackupTransactionData['resources'], resourceId: string, error: string): void {
    const failedEntry = { id: resourceId, error };
    const failedList = this.data.resources[resourceType].failed;

    // Avoid duplicates
    if (!failedList.some((f) => f.id === resourceId)) {
      failedList.push(failedEntry);
      this.isDirty = true;
      this.scheduleSave();
    }
  }

  /**
   * Check if resource was already backed up
   */
  isCompleted(resourceType: keyof BackupTransactionData['resources'], resourceId: string): boolean {
    return this.data.resources[resourceType].completed.includes(resourceId);
  }

  /**
   * Mark transaction as completed
   */
  complete(): void {
    this.end('completed');
  }

  /**
   * Mark transaction as failed
   */
  fail(): void {
    this.end('failed');
  }

  /**
   * Get transaction data (returns deep copy to prevent external modifications)
   */
  getData(): BackupTransactionData {
    return structuredClone(this.data);
  }

  /**
   * Get summary of backup progress
   */
  getSummary(): string {
    const { resources } = this.data;
    const lines: string[] = [];

    for (const [type, data] of Object.entries(resources)) {
      const completed = data.completed.length;
      const failed = data.failed.length;
      const total = data.total;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

      lines.push(`  ${type}: ${completed}/${total} (${percent}%) ${failed > 0 ? `[${failed} failed]` : ''}`);
    }

    return lines.join('\n');
  }

  /**
   * Clean up transaction file after successful completion
   */
  cleanup(): void {
    if (fs.existsSync(this.transactionPath)) {
      fs.unlinkSync(this.transactionPath);
    }
  }
}
