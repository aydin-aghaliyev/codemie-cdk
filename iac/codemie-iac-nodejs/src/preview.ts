/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import 'dotenv/config';

import type { CodeMieClient } from 'codemie-sdk';

import type { AppConfig } from './appConfig';
import { CleanupManager } from './lib/cleanupManager';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { logger } from './lib/logger';
import {
  previewAssistants,
  previewDatasources,
  previewSkills,
  previewSkillGroupReplacement,
  previewWorkflows,
  previewOrphanedResources,
} from './lib/previewUtils';
import { expandAssistantsWithDependencies, filterAssistantsReferencingSkillGroup } from './lib/skillReplacement';
import { StateManager } from './lib/stateManager';
import { validateSkillDescriptions } from './lib/validationUtils';
import type { Change } from './types/codemieConfig';

export async function previewChanges(
  appConfig: AppConfig,
  existingClient?: CodeMieClient,
  options?: { skipDatasources?: boolean; replaceSkillGroup?: string }
): Promise<{
  changes: Change[];
  summary: { deleted: number; created: number; updated: number; unchanged: number; total: number };
}> {
  const loader = new CodemieConfigLoader(appConfig);
  const stateManager = new StateManager(appConfig);

  const config = loader.loadConfig();

  const skillDescriptionErrors = validateSkillDescriptions(config.resources.skills ?? []);
  if (skillDescriptionErrors.length > 0) {
    throw new Error(skillDescriptionErrors.join('\n'));
  }

  const client = existingClient || (await createClient(config));

  const changes: Change[] = [];

  if (options?.replaceSkillGroup) {
    const group = options.replaceSkillGroup;
    changes.push(...previewSkillGroupReplacement(config, stateManager, group));

    const referencingAssistants = expandAssistantsWithDependencies(
      filterAssistantsReferencingSkillGroup(config.resources.assistants, config.resources.skills, group),
      config.resources.assistants
    );
    if (referencingAssistants.length > 0) {
      changes.push(...(await previewAssistants(referencingAssistants, loader, stateManager, client, config)));
    }

    return summarizeChanges(changes);
  }

  const cleanupManager = new CleanupManager(client, stateManager);
  const skipDatasources = options?.skipDatasources === true;
  const foundOrphaned = cleanupManager.findOrphanedResources(config);
  const orphaned = skipDatasources ? { ...foundOrphaned, datasources: [] } : foundOrphaned;
  changes.push(...previewOrphanedResources(orphaned, stateManager));

  if (config.resources.skills) {
    const skillChanges = await previewSkills(config.resources.skills, loader, stateManager, client, appConfig.rootDir);
    changes.push(...skillChanges);
  }

  if (config.resources.assistants) {
    const assistantChanges = await previewAssistants(config.resources.assistants, loader, stateManager, client, config);
    changes.push(...assistantChanges);
  }

  if (config.resources.datasources && !skipDatasources) {
    const datasourceChanges = await previewDatasources(config.resources.datasources, stateManager, client);
    changes.push(...datasourceChanges);
  }

  if (config.resources.workflows) {
    const workflowChanges = await previewWorkflows(
      config.resources.workflows,
      stateManager,
      client,
      appConfig.rootDir,
      config.project.name
    );
    changes.push(...workflowChanges);
  }

  return summarizeChanges(changes);
}

function summarizeChanges(changes: Change[]): {
  changes: Change[];
  summary: { deleted: number; created: number; updated: number; unchanged: number; total: number };
} {
  return {
    changes,
    summary: {
      deleted: changes.filter((c) => c.type === 'delete').length,
      created: changes.filter((c) => c.type === 'create').length,
      updated: changes.filter((c) => c.type === 'update').length,
      unchanged: changes.filter((c) => c.type === 'no-change').length,
      total: changes.length,
    },
  };
}

export async function main(options: {
  appConfig: AppConfig;
  skipDatasources?: boolean;
  replaceSkillGroup?: string;
}): Promise<void> {
  logger.info('📋 Generating deployment preview...\n');

  try {
    const { appConfig } = options;
    const loader = new CodemieConfigLoader(appConfig);

    const config = loader.loadConfig();

    logger.info('🔗 Connection details:');
    logger.info(`  API URL: ${config.environment.codemie_api_url}`);
    logger.info(`  Auth URL: ${config.environment.auth_server_url}`);
    logger.info(`  Realm: ${config.environment.auth_realm_name}`);

    if (config.environment.client_id && config.environment.client_secret) {
      logger.info(`  Auth Method: Client Credentials`);
      logger.info(`  Client ID: ${config.environment.client_id}`);
    } else if (config.environment.username && config.environment.password) {
      logger.info(`  Auth Method: Username/Password`);
      logger.info(`  Username: ${config.environment.username}`);
    } else {
      logger.info(`  Auth Method: ✗ Not configured`);
    }
    logger.info('');

    const client = await createClient(config);
    if (options.skipDatasources) {
      logger.info('⏭️  Datasources excluded from preview (--skip-datasources)\n');
    }
    if (options.replaceSkillGroup) {
      logger.info(
        `♻️  Previewing replacement of skill group "${options.replaceSkillGroup}" ` +
          `(skills get new ids; datasources and workflows are skipped)\n`
      );
    }
    const { changes, summary } = await previewChanges(appConfig, client, {
      skipDatasources: options.skipDatasources,
      replaceSkillGroup: options.replaceSkillGroup,
    }); // Pass client directly

    logPreviewSummary(changes, summary);

    process.exit(0);
  } catch (error) {
    logger.error('\n❌ Preview generation failed:');
    logger.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      logger.error('\nStack trace:');
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

// eslint-disable-next-line max-lines-per-function
function logPreviewSummary(
  changes: Change[],
  summary: { deleted: number; created: number; updated: number; unchanged: number; total: number }
): void {
  logger.info('📊 Deployment Preview:\n');

  if (summary.deleted > 0) {
    logger.info('🗑️  DELETE (orphaned resources):');
    for (const change of changes.filter((c) => c.type === 'delete')) {
      logger.info(`  - ${change.resourceType}:${change.name}`);
      if (change.details) {
        logger.info(`    ${change.details}`);
      }
    }
    logger.info('');
  }

  if (summary.created > 0) {
    logger.info('✅ CREATE:');
    for (const change of changes.filter((c) => c.type === 'create')) {
      logger.info(`  - ${change.resourceType}:${change.name}`);
      if (change.details) {
        logger.info(`    ${change.details}`);
      }
    }
    logger.info('');
  }

  if (summary.updated > 0) {
    logger.info('⚠️  UPDATE:');
    for (const change of changes.filter((c) => c.type === 'update')) {
      logger.info(`  - ${change.resourceType}:${change.name}`);
      if (change.details) {
        logger.info(`    ${change.details}`);
      }
    }
    logger.info('');
  }

  if (summary.unchanged > 0) {
    logger.info('📊 UNCHANGED:');
    for (const change of changes.filter((c) => c.type === 'no-change')) {
      logger.info(`  - ${change.resourceType}:${change.name}`);
    }
    logger.info('');
  }

  logger.info('Summary:');
  logger.info(`  Delete: ${summary.deleted}`);
  logger.info(`  Create: ${summary.created}`);
  logger.info(`  Update: ${summary.updated}`);
  logger.info(`  Unchanged: ${summary.unchanged}`);
  logger.info(`  Total: ${summary.total}`);

  if (summary.total === summary.unchanged) {
    logger.info('\n✨ No changes to apply');
  } else {
    logger.info('\n👉 Run "npm run deploy" to apply these changes');
  }
}
