/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AppConfig } from './appConfig';
import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { DependencyValidator } from './lib/dependencyValidator';
import { logger } from './lib/logger';
import { StateManager } from './lib/stateManager';
import { checkApiSlugConflicts, validateSkillContentLengths, validateSlugUniqueness } from './lib/validationUtils';

export async function validateConfig(options: {
  appConfig: AppConfig;
  checkApi?: boolean;
}): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  const { checkApi = false, appConfig } = options;

  const loader = new CodemieConfigLoader(appConfig);

  // Load config
  const config = loader.loadConfig();

  // Validate files exist. validateFiles also runs validateSkillDescriptions over
  // config.resources.skills, so skill description errors arrive from here — running the same pure
  // check again would only produce duplicates to filter back out. deploy.ts and preview.ts do not
  // call validateFiles and therefore keep their own calls.
  const fileValidation = loader.validateFiles(config);
  if (!fileValidation.valid) {
    errors.push(...fileValidation.errors);
  }

  // Validate slug uniqueness within config
  const slugErrors = validateSlugUniqueness(config);
  errors.push(...slugErrors);

  // Validate assistant dependencies
  if (config.resources.assistants && config.resources.assistants.length > 0) {
    const dependencyErrors = DependencyValidator.validateAssistantDependencies(config.resources.assistants);
    errors.push(...dependencyErrors);

    const skillReferenceErrors = DependencyValidator.validateAssistantSkillReferences(
      config.resources.assistants,
      config.resources.skills || [],
      config.imported?.skills || []
    );
    errors.push(...skillReferenceErrors);
  }

  // Validate workflow assistant references
  if (config.resources.workflows && config.resources.workflows.length > 0) {
    const workflowsWithContent = config.resources.workflows.map((workflow) => {
      const workflowPath = path.resolve(workflow.definition);
      if (!fs.existsSync(workflowPath)) {
        errors.push(`Workflow definition file not found: ${workflow.definition}`);
        return { ...workflow, definition: '' }; // Return dummy content to avoid further errors
      }
      const definition = fs.readFileSync(workflowPath, 'utf8');
      return { ...workflow, definition };
    });

    const workflowErrors = DependencyValidator.validateWorkflowAssistantReferences(
      workflowsWithContent,
      config.resources.assistants || [],
      config.imported?.assistants || []
    );
    errors.push(...workflowErrors);
  }

  // Optional API check
  if (checkApi && errors.length === 0) {
    // Only run API check if no prior errors
    const client = await createClient(config);
    const stateManager = new StateManager(appConfig);
    const state = stateManager.loadState();
    const conflictErrors = await checkApiSlugConflicts({ config, client, assistantState: state.resources.assistants });
    errors.push(...conflictErrors);

    // Validate skill content lengths against platform-configured limits
    const skills = config.resources.skills ?? [];
    if (skills.length > 0) {
      const limits = await client.skills.getConfig();
      const entries = skills.map((skill) => ({
        name: skill.name,
        content: loader.resolveSkillContent(skill),
      }));
      const contentLengthErrors = validateSkillContentLengths(entries, limits);
      errors.push(...contentLengthErrors);
    }
  }

  return { success: errors.length === 0, errors };
}

export async function main(options: { appConfig: AppConfig; checkApi?: boolean }): Promise<void> {
  const { checkApi = false, appConfig } = options;

  logger.info('🔍 Validating configuration...');
  if (checkApi) {
    logger.info('   (with API connectivity check)\n');
  } else {
    logger.info('   (use --check-api to check for conflicts with existing assistants)\n');
  }

  try {
    const { success, errors } = await validateConfig(options);

    if (!success) {
      logger.error('❌ Validation failed:\n');
      for (const error of errors) {
        logger.error(`  - ${error}`);
      }
      process.exit(1);
    }

    // Summary (only if successful)
    const loader = new CodemieConfigLoader(appConfig); // Reload config to get counts after full resolution
    const config = loader.loadConfig();
    const assistantCount = config.resources.assistants?.length || 0;
    const datasourceCount = config.resources.datasources?.length || 0;
    const workflowCount = config.resources.workflows?.length || 0;

    logger.info('📊 Resources defined:');
    logger.info(`  - Assistants: ${assistantCount}`);
    logger.info(`  - Datasources: ${datasourceCount}`);
    logger.info(`  - Workflows: ${workflowCount}`);

    if (assistantCount > 0) {
      logger.info('\n🤖 Assistants:');
      if (config.resources.assistants) {
        for (const assistant of config.resources.assistants) {
          logger.info(`  - ${assistant.name}`);
        }
      }
    }

    logger.info('\n✅ Validation successful!');
    process.exit(0);
  } catch (error) {
    logger.error('\n❌ Validation failed:');
    logger.error('Validation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
