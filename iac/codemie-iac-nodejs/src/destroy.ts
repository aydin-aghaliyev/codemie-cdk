/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import 'dotenv/config';

import type { AppConfig } from './appConfig';
import { CleanupManager } from './lib/cleanupManager';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { logger } from './lib/logger';
import { StateManager } from './lib/stateManager';
import { promptUser } from './lib/terminalPromptHelpers';

// eslint-disable-next-line max-lines-per-function
export async function destroyResources(options: { appConfig: AppConfig; force?: boolean }): Promise<void> {
  logger.info('🗑️  Destroy all managed resources\n');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const { appConfig, force = false } = options;
    const loader = new CodemieConfigLoader(appConfig);
    const stateManager = new StateManager(appConfig);

    // Load config
    const config = loader.loadConfig();
    logger.info(`Project: ${config.project.name}\n`);

    // Get all managed resources
    const managed = stateManager.getAllManagedResources();
    const total =
      managed.assistants.length + managed.datasources.length + managed.workflows.length + managed.skills.length;

    if (total === 0) {
      logger.info('✓ No managed resources found in state\n');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return;
    }

    logger.info(`Found ${total} managed resource(s):\n`);
    if (managed.assistants.length > 0) {
      logger.info(`  🤖 Assistants: ${managed.assistants.length}`);
      for (const name of managed.assistants) {
        logger.info(`     • ${name}`);
      }
    }
    if (managed.datasources.length > 0) {
      logger.info(`  📊 Datasources: ${managed.datasources.length}`);
      for (const name of managed.datasources) {
        logger.info(`     • ${name}`);
      }
    }
    if (managed.workflows.length > 0) {
      logger.info(`  🔄 Workflows: ${managed.workflows.length}`);
      for (const name of managed.workflows) {
        logger.info(`     • ${name}`);
      }
    }
    if (managed.skills.length > 0) {
      logger.info(`  🎯 Skills: ${managed.skills.length}`);
      for (const name of managed.skills) {
        logger.info(`     • ${name}`);
      }
    }

    logger.warn('\n⚠️  WARNING: This will DELETE all resources listed above!');
    logger.warn('⚠️  These resources were created through IaC (in state.json)\n');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (force) {
      logger.info('🚀 --force flag detected, skipping confirmation\n');
    } else {
      const answer = await promptUser('Type "destroy" to confirm deletion');

      if (answer.trim().toLowerCase() !== 'destroy') {
        logger.info('\n❌ Destruction cancelled\n');
        return;
      }
    }

    logger.info('\n🗑️  Deleting resources...\n');

    // Initialize client
    const client = await createClient(config);

    const cleanupManager = new CleanupManager(client, stateManager);

    // Delete all managed resources (treat them as "orphaned" to reuse deletion logic)
    const result = await cleanupManager.deleteOrphanedResources(managed);

    const totalDeleted =
      result.deleted.assistants.length +
      result.deleted.datasources.length +
      result.deleted.workflows.length +
      result.deleted.skills.length;

    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    logger.info('📊 Destruction Summary:\n');
    logger.info(`  ✅ Deleted: ${totalDeleted}`);
    if (result.errors.length > 0) {
      logger.error(`  ❌ Failed: ${result.errors.length}\n`);
      for (const err of result.errors) {
        logger.error(`     • ${err.type} ${err.name}: ${err.error}`);
      }
    }
    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.errors.length > 0) {
      throw new Error('Destruction completed with errors');
    } else {
      logger.info('✅ All managed resources destroyed');
    }
  } catch (error) {
    logger.error('\n❌ Destruction failed:');
    logger.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Destroy all resources managed by IaC (in state.json)
 * SAFETY: Only deletes resources created through this IaC tool
 */
export async function main(options: { appConfig: AppConfig; force?: boolean }): Promise<void> {
  try {
    await destroyResources(options);
    process.exit(0);
  } catch (error) {
    logger.error('\n❌ Destruction failed:');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
