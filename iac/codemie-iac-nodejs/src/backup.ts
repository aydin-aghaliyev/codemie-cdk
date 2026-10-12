/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Assistant, AssistantBase, DataSource, SkillDetail } from 'codemie-sdk';
import { SkillVisibility } from 'codemie-sdk';

import type { AppConfig } from './appConfig';
import { collectReferencedSkillIds } from './lib/backupTransformers';
import { isProjectOwnedSkill } from './lib/skillUtils';
import { BackupTransaction } from './lib/backupTransaction';
import { saveBackupFiles, type BackupData } from './lib/backupYamlGenerator';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { PAGINATION, TIMEOUTS_MS, BACKUP } from './lib/constants';
import {
  sanitizeFileName,
  validateBackupDirectory,
  moveAtomically,
  cleanupDirectory,
  ensureDirectoryExists,
  resolvePathWithinDirectory,
  skillDirRelativePath,
  skillFlatFileRelativePath,
  skillMarkdownRelativePath,
} from './lib/fileUtils';
import { logger } from './lib/logger';
import { createConcurrentLimiter, withRetry } from './lib/rateLimitUtils';
import { withTimeout } from './lib/timeoutUtils';

// Re-export for backwards compatibility with tests
export { transformTool, transformMcpServer, transformToolkits } from './lib/backupTransformers';

/**
 * Stream resources with pagination (generator)
 */
export async function* streamResources<T extends { id: string }>(
  fetchPage: (params: { per_page: number; page: number }) => Promise<T[]>,
  resourceType: string
): AsyncGenerator<T, void, undefined> {
  let page = 0;
  let hasMore = true;
  let totalFetched = 0;

  logger.info(`   Streaming ${resourceType} (with pagination)...`);

  while (hasMore) {
    const resources = await fetchPage({
      per_page: PAGINATION.DEFAULT_PAGE_SIZE,
      page,
    });

    if (resources.length === 0) {
      break;
    }

    for (const resource of resources) {
      totalFetched++;
      yield resource;
    }

    if (resources.length < PAGINATION.DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      logger.info(`   Streamed ${totalFetched} ${resourceType} so far...`);
    }
  }
}

type ListedSkill = { id: string; name: string; project?: string };

function createFallbackImportedSkillDetail(skill: ListedSkill): SkillDetail {
  return {
    id: skill.id,
    name: skill.name,
    description: '',
    project: skill.project || '',
    visibility: SkillVisibility.PUBLIC,
    created_by: null,
    categories: [],
    createdDate: '',
    updatedDate: null,
    is_attached: true,
    assistants_count: 0,
    user_abilities: [],
    unique_likes_count: 0,
    unique_dislikes_count: 0,
    content: '',
    toolkits: [],
    mcp_servers: [],
  };
}

/** Save single assistant to back up. */
export async function saveAssistantToBackup(
  assistant: Assistant | AssistantBase,
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  backupDir: string
): Promise<void> {
  logger.info(`   • ${assistant.name} (${assistant.id})`);
  const full = await withTimeout(
    client.assistants.get(assistant.id),
    TIMEOUTS_MS.ASSISTANT_FETCH,
    `Timeout fetching assistant ${assistant.id}`
  );

  backupData.resources.assistants.push(full);

  if (full.system_prompt) {
    const fileName = `${full.slug || sanitizeFileName(full.name)}.prompt.md`;
    const filePath = path.join(backupDir, 'system_prompts', fileName);
    ensureDirectoryExists(filePath);
    fs.writeFileSync(filePath, full.system_prompt, 'utf8');
  }
}

export async function backupAssistants(
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  backupDir: string,
  transaction: BackupTransaction
): Promise<void> {
  logger.info('🤖 Fetching assistants...');

  const allAssistants: Array<Assistant | AssistantBase> = [];
  for await (const assistant of streamResources((params) => client.assistants.list(params), 'assistants')) {
    allAssistants.push(assistant);
  }

  logger.info(`   Found ${allAssistants.length} assistant(s)`);
  transaction.setTotal('assistants', allAssistants.length);

  const limit = createConcurrentLimiter();

  for (const assistant of allAssistants) {
    if (transaction.isCompleted('assistants', assistant.id)) {
      logger.info(`   ↷ Skipping ${assistant.name} (already backed up)`);
      continue;
    }

    try {
      await limit(() =>
        withRetry(
          async () => saveAssistantToBackup(assistant, client, backupData, backupDir),
          `Backup assistant ${assistant.name}`
        )
      );
      transaction.markCompleted('assistants', assistant.id);
    } catch (error) {
      const errorDetails =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { message: String(error) };

      logger.error(`   ❌ Failed to backup ${assistant.name}:`);
      logger.error(`      ${errorDetails.message}`);
      if (errorDetails.stack) {
        logger.error(`      Stack trace: ${errorDetails.stack.split('\n').slice(1, 3).join('\n      ')}`);
      }

      transaction.markFailed('assistants', assistant.id, errorDetails.message);
    }
  }
  logger.info(`✓ Backed up ${transaction.getData().resources.assistants.completed.length} assistant(s)\n`);
}

/**
 * Process single datasource backup
 */
async function processDatasourceBackup(
  datasource: { id: string; name: string },
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  transaction: BackupTransaction
): Promise<void> {
  logger.info(`   • ${datasource.name} (${datasource.id})`);
  let full;
  try {
    full = await withTimeout(
      client.datasources.get(datasource.id),
      TIMEOUTS_MS.DATASOURCE_FETCH,
      `Timeout fetching datasource ${datasource.id}`
    );
  } catch (error) {
    logger.warn(
      `     \u26A0\uFE0F  Failed to fetch full datasource details for ${datasource.name}. Using list response as fallback: ${error instanceof Error ? error.message : String(error)}`
    );
    full = datasource;
  }

  backupData.resources.datasources.push(full as DataSource);
  transaction.markCompleted('datasources', datasource.id);
}

function normalizeProjectName(projectName: string | undefined): string {
  return String(projectName || '')
    .trim()
    .toLowerCase();
}

function filterResourcesByProject<T>(resources: T[], projectName: string): T[] {
  const normalized = normalizeProjectName(projectName);
  if (!normalized) {
    return resources;
  }
  return resources.filter((r) => normalizeProjectName((r as { project_name?: string })?.project_name) === normalized);
}

async function backupDatasources(
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  transaction: BackupTransaction,
  projectName: string
): Promise<void> {
  logger.info('\uD83D\uDCCA Fetching datasources...');

  const allDatasources: Array<{ id: string; name: string; project_name?: string }> = [];
  for await (const datasource of streamResources((params) => client.datasources.list(params), 'datasources')) {
    allDatasources.push(datasource);
  }
  const datasources = filterResourcesByProject(allDatasources, projectName);

  logger.info(
    `   Found ${datasources.length} datasource(s) for project '${projectName}' (from ${allDatasources.length} total)`
  );
  transaction.setTotal('datasources', datasources.length);

  const limit = createConcurrentLimiter();

  for (const datasource of datasources) {
    if (transaction.isCompleted('datasources', datasource.id)) {
      logger.info(`   ↷ Skipping ${datasource.name} (already backed up)`);
      continue;
    }

    try {
      await limit(() =>
        withRetry(
          async () => processDatasourceBackup(datasource, client, backupData, transaction),
          `Backup datasource ${datasource.name}`
        )
      );
    } catch (error) {
      const errorDetails =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { message: String(error) };

      logger.error(`   ❌ Failed to backup ${datasource.name}:`);
      logger.error(`      ${errorDetails.message}`);
      if (errorDetails.stack) {
        logger.error(`      Stack trace: ${errorDetails.stack.split('\n').slice(1, 3).join('\n      ')}`);
      }

      transaction.markFailed('datasources', datasource.id, errorDetails.message);
    }
  }
  logger.info(`✓ Backed up ${transaction.getData().resources.datasources.completed.length} datasource(s)\n`);
}

async function backupWorkflows(
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  backupDir: string,
  transaction: BackupTransaction
): Promise<void> {
  logger.info('🔄 Fetching workflows...');

  const workflows: Array<{ id: string; name: string }> = [];
  for await (const workflow of streamResources((params) => client.workflows.list(params), 'workflows')) {
    workflows.push(workflow);
  }

  logger.info(`   Found ${workflows.length} workflow(s)`);
  transaction.setTotal('workflows', workflows.length);

  for (const workflow of workflows) {
    if (transaction.isCompleted('workflows', workflow.id)) {
      logger.info(`   ↷ Skipping ${workflow.name} (already backed up)`);
      continue;
    }

    try {
      logger.info(`   • ${workflow.name} (${workflow.id})`);
      const full = await withTimeout(
        client.workflows.get(workflow.id),
        TIMEOUTS_MS.WORKFLOW_FETCH,
        `Timeout fetching workflow ${workflow.id}`
      );

      // Save raw response to backup.json (no transformations)
      backupData.resources.workflows.push(full);

      // Save workflow YAML file as-is (raw from API)
      if (full.yaml_config) {
        const fileName = `${sanitizeFileName(full.name)}.yaml`;
        const filePath = path.join(backupDir, 'workflows', fileName);
        ensureDirectoryExists(filePath);
        fs.writeFileSync(filePath, full.yaml_config, 'utf8');
      }

      transaction.markCompleted('workflows', workflow.id);
    } catch (error) {
      const errorDetails =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { message: String(error) };

      logger.error(`   ❌ Failed to backup ${workflow.name}:`);
      logger.error(`      ${errorDetails.message}`);
      if (errorDetails.stack) {
        logger.error(`      Stack trace: ${errorDetails.stack.split('\n').slice(1, 3).join('\n      ')}`);
      }

      transaction.markFailed('workflows', workflow.id, errorDetails.message);
    }
  }
  logger.info(`✓ Backed up ${transaction.getData().resources.workflows.completed.length} workflow(s)\n`);
}

async function backupIntegrations(
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  projectName: string
): Promise<void> {
  logger.info('\uD83D\uDD0C Fetching integrations...');

  const allProjectIntegrations = await withTimeout(
    client.integrations.list({
      per_page: PAGINATION.DEFAULT_PAGE_SIZE,
      page: 0,
      setting_type: 'project',
    }),
    TIMEOUTS_MS.INTEGRATION_FETCH,
    'Timeout fetching project integrations'
  );
  const projectIntegrations = filterResourcesByProject(allProjectIntegrations, projectName);
  logger.info(
    `   Found ${projectIntegrations.length} project integration(s) for project '${projectName}' (from ${allProjectIntegrations.length} total)`
  );

  for (const integration of projectIntegrations) {
    logger.info(`   • ${integration.alias || integration.credential_type} (${integration.id}) [project]`);
    backupData.resources.integrations.push(integration);
  }

  const userIntegrations = await withTimeout(
    client.integrations.list({
      per_page: PAGINATION.DEFAULT_PAGE_SIZE,
      page: 0,
      setting_type: 'user',
    }),
    TIMEOUTS_MS.INTEGRATION_FETCH,
    'Timeout fetching user integrations'
  );
  logger.info(`   Found ${userIntegrations.length} user integration(s)`);

  for (const integration of userIntegrations) {
    logger.info(`   • ${integration.alias || integration.credential_type} (${integration.id}) [user]`);
    backupData.resources.integrations.push(integration);
  }

  logger.info(`✓ Backed up ${projectIntegrations.length + userIntegrations.length} integration(s)\n`);
}

async function backupSkills(
  client: Awaited<ReturnType<typeof createClient>>,
  backupData: BackupData,
  backupDir: string,
  transaction: BackupTransaction,
  projectName: string
): Promise<void> {
  logger.info('🧠 Fetching skills...');

  const referencedSkillIds = collectReferencedSkillIds(backupData.resources.assistants);
  const allSkills: ListedSkill[] = [];
  for await (const skill of streamResources((params) => client.skills.list(params), 'skills')) {
    allSkills.push(skill);
  }

  const skillsToBackup = allSkills.filter(
    (skill) =>
      referencedSkillIds.has(skill.id) || !skill.project || isProjectOwnedSkill({ project: skill.project }, projectName)
  );
  const skippedExternalSkills = allSkills.length - skillsToBackup.length;

  logger.info(`   Found ${allSkills.length} skill(s), backing up ${skillsToBackup.length}`);
  if (skippedExternalSkills > 0) {
    logger.info(`   ↷ Skipping ${skippedExternalSkills} unreferenced external skill(s)`);
  }
  transaction.setTotal('skills', skillsToBackup.length);

  const limit = createConcurrentLimiter();

  for (const skill of skillsToBackup) {
    if (transaction.isCompleted('skills', skill.id)) {
      logger.info(`   ↷ Skipping ${skill.name} (already backed up)`);
      continue;
    }

    try {
      await limit(() =>
        withRetry(async () => {
          logger.info(`   • ${skill.name} (${skill.id})`);
          const listedAsProjectOwned = skill.project
            ? isProjectOwnedSkill({ project: skill.project }, projectName)
            : false;
          let full: SkillDetail;
          try {
            full = await withTimeout(
              client.skills.get(skill.id),
              TIMEOUTS_MS.SKILL_FETCH,
              `Timeout fetching skill ${skill.id}`
            );
          } catch (error) {
            if (listedAsProjectOwned || !referencedSkillIds.has(skill.id)) {
              throw error;
            }
            logger.warn(
              `     ⚠️  Failed to fetch imported skill details for ${skill.name}. ` +
                `Using list response as fallback: ${error instanceof Error ? error.message : String(error)}`
            );
            full = createFallbackImportedSkillDetail(skill);
          }

          const fullIsProjectOwned = isProjectOwnedSkill(full, projectName);
          if (!fullIsProjectOwned && !referencedSkillIds.has(skill.id)) {
            logger.info(`     ↷ Skipping unreferenced external skill ${skill.name} (owner: ${full.project})`);
            return;
          }

          if (fullIsProjectOwned) {
            const companionFiles = await client.skills.listCompanionFiles(skill.id);
            full.companion_files = companionFiles;

            if (companionFiles.length > 0) {
              // Same helpers the generated resource YAML derives its `file` from, so the backup
              // always writes exactly the path a restore later reads.
              const skillDir = path.join(backupDir, skillDirRelativePath(skill.name));
              const skillMdPath = path.join(backupDir, skillMarkdownRelativePath(skill.name));
              ensureDirectoryExists(skillMdPath);
              fs.writeFileSync(skillMdPath, full.content || '', 'utf8');

              // Companions are fetched one at a time on purpose: this whole skill already runs
              // inside `createConcurrentLimiter`, so inner parallelism would multiply against it.
              for (const companionMeta of companionFiles) {
                // A platform-provided path is never trusted to stay inside the skill directory.
                const companionPath = resolvePathWithinDirectory(skillDir, companionMeta.path);
                const companionFile = await client.skills.getCompanionFile(skill.id, companionMeta.path);
                ensureDirectoryExists(companionPath);
                if (companionFile.encoding === 'base64') {
                  fs.writeFileSync(companionPath, Buffer.from(companionFile.content, 'base64'));
                } else {
                  fs.writeFileSync(companionPath, companionFile.content, 'utf8');
                }
              }
            } else {
              const filePath = path.join(backupDir, skillFlatFileRelativePath(skill.name));
              ensureDirectoryExists(filePath);
              fs.writeFileSync(filePath, full.content || '', 'utf8');
            }
          } else {
            logger.info(`     ↷ Skipping content file for imported skill ${skill.name} (owner: ${full.project})`);
          }

          // Pushed last, once every fetch and write has succeeded: `withRetry` re-runs this whole
          // body on a 429/5xx/timeout, so a push before the companion calls appended the skill to
          // the backup YAML once per attempt — and left a failed skill in it as well.
          backupData.resources.skills.push(full);
        }, `Backup skill ${skill.name}`)
      );
      transaction.markCompleted('skills', skill.id);
    } catch (error) {
      const errorDetails =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { message: String(error) };

      logger.error(`   ❌ Failed to backup ${skill.name}:`);
      logger.error(`      ${errorDetails.message}`);
      if (errorDetails.stack) {
        logger.error(`      Stack trace: ${errorDetails.stack.split('\n').slice(1, 3).join('\n      ')}`);
      }

      transaction.markFailed('skills', skill.id, errorDetails.message);
    }
  }
  logger.info(`✓ Backed up ${backupData.resources.skills.length} skill(s)\n`);
}

/**
 * Get unique backup directory name (add counter suffix if directory exists)
 * @returns Object with final backup dir and temp backup dir paths
 */
function getUniqueBackupDir(baseDir: string, timestamp: string): { finalDir: string; tempDir: string } {
  let counter = 0;
  let finalBackupDir = path.join(baseDir, timestamp);

  // Find available directory name
  while (fs.existsSync(finalBackupDir)) {
    counter++;
    finalBackupDir = path.join(baseDir, `${timestamp}-${counter}`);
  }

  const dirSuffix = counter > 0 ? `${timestamp}-${counter}` : timestamp;
  const tempBackupDir = path.join(baseDir, `${BACKUP.TEMP_DIR_PREFIX}${dirSuffix}`);

  return { finalDir: finalBackupDir, tempDir: tempBackupDir };
}

/**
 * Perform cleanup with proper error handling
 */
function performCleanup(tempBackupDir: string, transaction: BackupTransaction | null): void {
  if (fs.existsSync(tempBackupDir)) {
    try {
      logger.info(`🧹 Rolling back: cleaning up ${tempBackupDir}...`);
      cleanupDirectory(tempBackupDir);
      logger.info('✓ Rollback completed');
    } catch (cleanupError) {
      logger.error(
        '⚠️  Failed to cleanup backup directory:',
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      );
      // Continue with transaction cleanup even if directory cleanup fails
    }
  }

  // Cleanup transaction file
  if (transaction) {
    try {
      transaction.cleanup();
      logger.info('✓ Transaction file cleaned up');
    } catch (cleanupError) {
      logger.error(
        '⚠️  Failed to cleanup transaction file:',
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      );
      // Don't fail if we can't clean it up - at least log it
    }
  }
}

// eslint-disable-next-line max-lines-per-function
export async function backupResources(options: { appConfig: AppConfig }): Promise<void> {
  logger.info('🗄️  Creating backup of all Codemie resources...\n');

  const timestamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replaceAll(':', '-');

  const { appConfig } = options;
  const { rootDir, backupsDirectory } = appConfig;
  const backupBaseDir = path.join(rootDir, backupsDirectory);
  const { finalDir: finalBackupDir, tempDir: tempBackupDir } = getUniqueBackupDir(backupBaseDir, timestamp);

  let transaction: BackupTransaction | null = null;

  try {
    validateBackupDirectory(backupBaseDir);

    const loader = new CodemieConfigLoader(appConfig);
    const config = loader.loadConfig();

    logger.info('🔌 Connecting to Codemie API...');
    const client = await createClient(config);
    logger.info('✓ Connected to Codemie API\n');

    if (!fs.existsSync(tempBackupDir)) {
      fs.mkdirSync(tempBackupDir, { recursive: true });
    }

    logger.info(`📁 Temporary backup directory: ${tempBackupDir}\n`);

    transaction = new BackupTransaction(tempBackupDir);

    const backupData: BackupData = {
      metadata: {
        timestamp: new Date().toISOString(),
        projectName: config.project.name,
        codemieApiUrl: config.environment.codemie_api_url,
      },
      resources: {
        assistants: [],
        datasources: [],
        workflows: [],
        integrations: [],
        skills: [],
      },
      state: {
        version: '1.0',
        project: config.project.name,
        lastSync: new Date().toISOString(),
        resources: {
          assistants: {},
          datasources: {},
          workflows: {},
          skills: {},
        },
      },
    };

    await backupIntegrations(client, backupData, config.project.name);
    await backupDatasources(client, backupData, transaction, config.project.name);
    await backupWorkflows(client, backupData, tempBackupDir, transaction);
    await backupAssistants(client, backupData, tempBackupDir, transaction);
    await backupSkills(client, backupData, tempBackupDir, transaction, config.project.name);

    const stats = transaction.getData();
    const totalFailed =
      stats.resources.assistants.failed.length +
      stats.resources.datasources.failed.length +
      stats.resources.workflows.failed.length +
      stats.resources.skills.failed.length;

    if (totalFailed > 0) {
      logger.warn(`\n⚠️  Backup completed with ${totalFailed} failed resource(s)`);
      logger.warn('Review transaction.json for details\n');

      const totalResources =
        stats.resources.assistants.total +
        stats.resources.datasources.total +
        stats.resources.workflows.total +
        stats.resources.skills.total;
      const failureRate = totalResources > 0 ? (totalFailed / totalResources) * 100 : 0;

      if (failureRate > 20) {
        throw new Error(
          `Too many failures (${totalFailed}/${totalResources} = ${failureRate.toFixed(1)}%), backup aborted`
        );
      }
    }

    saveBackupFiles(backupData, tempBackupDir, config.project.name);

    transaction.complete();

    logger.info(`\n🔄 Finalizing backup...`);
    moveAtomically(tempBackupDir, finalBackupDir);
    logger.info(`✓ Backup finalized at ${finalBackupDir}\n`);

    const separator = '='.repeat(50);
    logger.info(`${separator}`);
    logger.info('📊 Backup Summary:\n');
    logger.info(`  🤖 Assistants: ${backupData.resources.assistants.length}`);
    logger.info(`  📊 Datasources: ${backupData.resources.datasources.length}`);
    logger.info(`  🔄 Workflows: ${backupData.resources.workflows.length}`);
    logger.info(`  🔌 Integrations: ${backupData.resources.integrations.length}`);
    logger.info(`  🧠 Skills: ${backupData.resources.skills.length}`);
    logger.info(`\n  📁 Location: ${finalBackupDir}\n`);

    logger.info('📈 Detailed Progress:\n');
    logger.info(transaction.getSummary());
    logger.info('');

    transaction.cleanup();

    logger.info('✅ Backup completed successfully!');
  } catch (error) {
    logger.error('\n❌ Backup failed:');
    logger.error(error instanceof Error ? error.message : String(error));

    performCleanup(tempBackupDir, transaction);

    throw error;
  }
}

export async function main(options: { appConfig: AppConfig }) {
  try {
    await backupResources(options);
    process.exit(0);
  } catch (error) {
    logger.error('\n❌ Backup failed:');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
