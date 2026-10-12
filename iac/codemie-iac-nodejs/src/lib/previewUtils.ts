/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CodeMieClient } from 'codemie-sdk';

import type {
  AssistantResource,
  Change,
  CodemieConfig,
  DatasourceResource,
  SkillResource,
  WorkflowResource,
} from '../types/codemieConfig';

import { calculateChecksum, calculateAssistantConfigChecksum } from './checksumUtils';
import {
  calculateCompanionFilesChecksum,
  calculateDatasourceConfigChecksum,
  calculateSkillConfigChecksum,
  calculateWorkflowConfigChecksum,
} from './codemieConfigChecksums';
import type { CodemieConfigLoader } from './codemieConfigLoader';
import { datasourceResponseToResource } from './converters';
import {
  checkAssistantExists,
  checkDatasourceExists,
  checkSkillExists,
  checkWorkflowExists,
} from './resourceExistenceChecker';
import { lookupSkillId } from './resourceResolver';
import { collectCompanionFiles, hasCompanionFileLayout, stateHasCompanionFiles } from './skillCompanionFiles';
import { selectSkillGroupForReplacement } from './skillReplacement';
import type { StateManager } from './stateManager';

/**
 * Generic preview function for resources
 */
async function previewResource<T extends { name: string }>(
  resource: T,
  resourceType: 'assistant' | 'datasource' | 'workflow' | 'skill',
  getState: (
    name: string
  ) => { configChecksum?: string; promptChecksum?: string; workflowYamlChecksum?: string } | null | undefined,
  checkExists: () => Promise<boolean>,
  calculateChecksums: () =>
    | { hasChanged: boolean; createDetails?: string; updateDetails?: string }
    | Promise<{ hasChanged: boolean; createDetails?: string; updateDetails?: string }>,
  staleDetails?: string
): Promise<Change> {
  const existingState = getState(resource.name);

  if (existingState) {
    const existsOnPlatform = await checkExists();

    if (existsOnPlatform) {
      const { hasChanged, updateDetails } = await calculateChecksums();

      return hasChanged
        ? {
            type: 'update',
            resourceType,
            name: resource.name,
            details: updateDetails,
          }
        : {
            type: 'no-change',
            resourceType,
            name: resource.name,
          };
    } else {
      // State has ID but resource not found on platform - will create new
      return {
        type: 'create',
        resourceType,
        name: resource.name,
        details: staleDetails ?? `ID from state not found on platform, will create new`,
      };
    }
  } else {
    const { createDetails } = await calculateChecksums();
    return {
      type: 'create',
      resourceType,
      name: resource.name,
      details: createDetails,
    };
  }
}

/**
 * Preview changes for orphaned resources (will be deleted)
 */
export function previewOrphanedResources(
  orphaned: { assistants: string[]; datasources: string[]; workflows: string[]; skills?: string[] },
  stateManager: StateManager
): Change[] {
  const changes: Change[] = [];

  for (const name of orphaned.assistants) {
    const assistantState = stateManager.getAssistantState(name);
    changes.push({
      type: 'delete',
      resourceType: 'assistant',
      name: name,
      details: assistantState ? `Removed from config (ID: ${assistantState.id})` : 'Removed from config',
    });
  }

  for (const name of orphaned.datasources) {
    const datasourceState = stateManager.getDatasourceState(name);
    changes.push({
      type: 'delete',
      resourceType: 'datasource',
      name: name,
      details: datasourceState ? `Removed from config (ID: ${datasourceState.id})` : 'Removed from config',
    });
  }

  for (const name of orphaned.workflows) {
    const workflowState = stateManager.getWorkflowState(name);
    changes.push({
      type: 'delete',
      resourceType: 'workflow',
      name: name,
      details: workflowState ? `Removed from config (ID: ${workflowState.id})` : 'Removed from config',
    });
  }

  for (const name of orphaned.skills || []) {
    const skillState = stateManager.getSkillState(name);
    changes.push({
      type: 'delete',
      resourceType: 'skill',
      name: name,
      details: skillState ? `Removed from config (ID: ${skillState.id})` : 'Removed from config',
    });
  }

  return changes;
}

/**
 * Preview `--replace-skill-group`: one delete per selected state-managed skill, one create per config
 * entry of the group. Uses the same selection as deploy, so both report the same set of skills.
 */
export function previewSkillGroupReplacement(
  config: CodemieConfig,
  stateManager: StateManager,
  group: string
): Change[] {
  const { namesToDelete, groupSkills } = selectSkillGroupForReplacement(config, stateManager, group);
  const changes: Change[] = [];

  for (const name of namesToDelete) {
    const skillState = stateManager.getSkillState(name);
    changes.push({
      type: 'delete',
      resourceType: 'skill',
      name,
      details: skillState
        ? `Replacing skill group "${group}" (ID: ${skillState.id})`
        : `Replacing skill group "${group}"`,
    });
  }

  for (const skill of groupSkills) {
    changes.push({
      type: 'create',
      resourceType: 'skill',
      name: skill.name,
      details: `Recreated by --replace-skill-group "${group}" with a new platform id`,
    });
  }

  return changes;
}

/**
 * Describe the companion files that changed between two path -> content-hash maps, sorted
 * within each category so two previews of the same tree produce identical text.
 */
function describeCompanionFileChanges(
  currentHashes: Record<string, string>,
  previousHashes: Record<string, string>
): string {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  const allPaths = new Set([...Object.keys(currentHashes), ...Object.keys(previousHashes)]);
  for (const filePath of allPaths) {
    const inCurrent = Object.hasOwn(currentHashes, filePath);
    const inPrevious = Object.hasOwn(previousHashes, filePath);

    if (inCurrent && !inPrevious) {
      added.push(filePath);
    } else if (!inCurrent && inPrevious) {
      removed.push(filePath);
    } else if (currentHashes[filePath] !== previousHashes[filePath]) {
      modified.push(filePath);
    }
  }

  added.sort();
  removed.sort();
  modified.sort();

  const segments: string[] = [];
  if (added.length > 0) {
    segments.push(`added ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    segments.push(`removed ${removed.join(', ')}`);
  }
  if (modified.length > 0) {
    segments.push(`modified ${modified.join(', ')}`);
  }

  return `Companion files changed: ${segments.join('; ')}`;
}

/**
 * Preview changes for skills
 */
export async function previewSkills(
  skills: SkillResource[],
  loader: CodemieConfigLoader,
  stateManager: StateManager,
  client: CodeMieClient,
  rootDir: string = process.cwd()
): Promise<Change[]> {
  const changes: Change[] = [];

  for (const skill of skills) {
    const content = loader.resolveSkillContent(skill);
    const contentChecksum = calculateChecksum(content);
    const configChecksum = calculateSkillConfigChecksum(skill);

    const companionFiles = hasCompanionFileLayout(skill)
      ? collectCompanionFiles(path.dirname(path.join(rootDir, skill.file as string)))
      : [];
    const { companionFilesChecksum, companionFileHashes } = calculateCompanionFilesChecksum(companionFiles);

    const change = await previewResource(
      skill,
      'skill',
      (name) => stateManager.getSkillState(name),
      () => checkSkillExists(client, skill.name, stateManager),
      () => {
        const existingState = stateManager.getSkillState(skill.name);
        if (!existingState) {
          return { hasChanged: false };
        }

        const contentOrConfigChanged =
          existingState.contentChecksum !== contentChecksum || existingState.configChecksum !== configChecksum;
        const companionFilesChanged =
          companionFiles.length > 0 || stateHasCompanionFiles(existingState)
            ? existingState.companionFilesChecksum !== companionFilesChecksum
            : false;
        const hasChanged = contentOrConfigChanged || companionFilesChanged;

        const detailParts: string[] = [];
        if (contentOrConfigChanged) {
          detailParts.push('Content or configuration changed');
        }
        if (companionFilesChanged) {
          detailParts.push(describeCompanionFileChanges(companionFileHashes, existingState.companionFileHashes ?? {}));
        }

        return {
          hasChanged,
          updateDetails: detailParts.length > 0 ? detailParts.join('; ') : undefined,
        };
      }
    );

    if (!change.details && change.type === 'create') {
      change.details = skill.visibility === 'public' ? 'Visibility: public' : 'Visibility: project';
    }

    changes.push(change);
  }

  return changes;
}
export async function previewAssistants(
  assistants: AssistantResource[],
  loader: CodemieConfigLoader,
  stateManager: StateManager,
  client: CodeMieClient,
  config: CodemieConfig
): Promise<Change[]> {
  const changes: Change[] = [];

  for (const assistant of assistants) {
    const promptContent = loader.loadPrompt(assistant.prompt);

    let buildConfig = null;
    if (assistant.config) {
      buildConfig = loader.loadAssistantConfig(assistant.config);
    }

    const configChecksum = calculateAssistantConfigChecksum(assistant, buildConfig);

    const change = await previewResource(
      assistant,
      'assistant',
      (name) => stateManager.getAssistantState(name),
      () => checkAssistantExists(client, assistant.name, stateManager),
      async () => {
        const existingState = stateManager.getAssistantState(assistant.name);
        const configChanged = existingState
          ? existingState.promptChecksum !== calculateChecksum(promptContent) ||
            existingState.configChecksum !== configChecksum
          : false;

        if (assistant.skills !== undefined) {
          const { ids: desiredSkillIds, unresolved } = resolveDesiredSkillIds(assistant.skills, stateManager, config);
          if (unresolved.length > 0) {
            return {
              hasChanged: true,
              createDetails: `Unresolved skill reference(s): ${unresolved.join(', ')}`,
              updateDetails: `Unresolved skill reference(s): ${unresolved.join(', ')}`,
            };
          }

          if (existingState?.id && (await checkSkillAttachmentDrift(client, existingState.id, desiredSkillIds))) {
            return {
              hasChanged: true,
              createDetails: `Model: ${assistant.model}`,
              updateDetails: 'Skill attachments out of sync with platform',
            };
          }
        }

        if (configChanged) {
          return {
            hasChanged: true,
            createDetails: `Model: ${assistant.model}`,
            updateDetails: 'Prompt or configuration changed',
          };
        }

        return {
          hasChanged: false,
          createDetails: `Model: ${assistant.model}`,
        };
      }
    );

    changes.push(change);
  }

  return changes;
}

function resolveDesiredSkillIds(
  skillNames: string[],
  stateManager: StateManager,
  config: CodemieConfig
): { ids: string[]; unresolved: string[] } {
  const ids: string[] = [];
  const unresolved: string[] = [];

  for (const name of skillNames) {
    const skillId = lookupSkillId(name, stateManager, config);
    if (skillId) {
      ids.push(skillId);
    } else {
      unresolved.push(name);
    }
  }

  return { ids, unresolved };
}

async function checkSkillAttachmentDrift(
  client: CodeMieClient,
  assistantId: string,
  desiredSkillIds: string[]
): Promise<boolean> {
  try {
    const currentSkills = await client.skills.getAssistantSkills(assistantId);
    const currentIds = new Set(currentSkills.map((s) => s.id));
    const desiredIds = new Set(desiredSkillIds);

    if (currentIds.size !== desiredIds.size) {
      return true;
    }
    for (const id of desiredIds) {
      if (!currentIds.has(id)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Preview changes for datasources
 */
export async function previewDatasources(
  datasources: DatasourceResource[],
  stateManager: StateManager,
  client: CodeMieClient
): Promise<Change[]> {
  const changes: Change[] = [];

  for (const datasource of datasources) {
    const change = await previewResource(
      datasource,
      'datasource',
      (name) => stateManager.getDatasourceState(name),
      () => checkDatasourceExists(client, datasource.name, stateManager),
      async () => {
        const configChecksum = calculateDatasourceConfigChecksum(datasource);
        const existingState = stateManager.getDatasourceState(datasource.name);
        let hasChanged = existingState ? existingState.configChecksum !== configChecksum : false;

        // Backward compatibility: state checksum can become stale after checksum algorithm/config-loading changes.
        // In that case, compare against the current platform datasource configuration before reporting an update.
        if (hasChanged && existingState?.id) {
          try {
            const datasourceOnPlatform = await client.datasources.get(existingState.id);
            const normalizedPlatformDatasource = datasourceResponseToResource(datasourceOnPlatform);
            const platformChecksum = calculateDatasourceConfigChecksum(normalizedPlatformDatasource);
            hasChanged = platformChecksum !== configChecksum;
          } catch {
            // If platform fetch fails, keep checksum-based change detection result.
          }
        }

        if (hasChanged || datasource.force_reindex) {
          return {
            hasChanged: true,
            updateDetails: datasource.force_reindex ? 'Force reindex' : 'Configuration changed',
          };
        }

        return { hasChanged: false };
      }
    );

    if (!change.details && change.type === 'create') {
      change.details = `Type: ${datasource.type}`;
    }

    changes.push(change);
  }

  return changes;
}

/**
 * Preview changes for workflows
 */
export async function previewWorkflows(
  workflows: WorkflowResource[],
  stateManager: StateManager,
  client: CodeMieClient,
  rootDir: string = process.cwd(),
  project?: string
): Promise<Change[]> {
  const changes: Change[] = [];
  const projectClause = project ? ` in project ${project}` : '';
  const staleDetails = `ID from state not found; will adopt a same-name workflow${projectClause} if one exists, otherwise create`;

  for (const workflow of workflows) {
    const yamlPath = path.join(rootDir, workflow.definition);
    if (!fs.existsSync(yamlPath)) {
      throw new Error(`Workflow definition file not found: ${workflow.definition}`);
    }
    const yamlConfig = fs.readFileSync(yamlPath, 'utf8');

    const change = await previewResource(
      workflow,
      'workflow',
      (name) => stateManager.getWorkflowState(name),
      () => checkWorkflowExists(client, workflow.name, stateManager),
      () => {
        const workflowYamlChecksum = calculateChecksum(yamlConfig);
        const configChecksum = calculateWorkflowConfigChecksum(workflow);
        const existingState = stateManager.getWorkflowState(workflow.name);

        const hasChanged =
          !!existingState &&
          (existingState.workflowYamlChecksum !== workflowYamlChecksum ||
            existingState.configChecksum !== configChecksum);

        return {
          hasChanged,
          ...(hasChanged ? { updateDetails: 'Workflow YAML or configuration changed' } : {}),
        };
      },
      staleDetails
    );

    if (!change.details && change.type === 'create') {
      change.details = `Mode: ${workflow.mode}`;
    }

    changes.push(change);
  }

  return changes;
}
