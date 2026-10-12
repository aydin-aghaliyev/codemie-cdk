/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

/**
 * Resource resolution utilities for converting names to IDs during deployment
 *
 * Handles:
 * - Sub-assistant name resolution → assistant_ids
 * - Datasource name resolution → context entries
 * - Workflow assistant name resolution → assistant_id
 */

import type { CodemieConfig, ImportedResource, SkillResource, SkillState } from '../types/codemieConfig';

import { logger } from './logger';
import { namesEqual } from './nameUtils';
import type { StateManager } from './stateManager';

function findSkillStateByName(stateManager: StateManager, skillName: string): SkillState | undefined {
  const exactMatch = stateManager.getSkillState(skillName);
  if (exactMatch) {
    return exactMatch;
  }

  for (const name of stateManager.getAllManagedResources().skills) {
    if (namesEqual(name, skillName)) {
      return stateManager.getSkillState(name);
    }
  }

  return undefined;
}

function findConfiguredSkill(config: CodemieConfig, skillName: string): SkillResource | undefined {
  return config.resources.skills?.find((skill) => namesEqual(skill.name, skillName));
}

function findImportedSkill(config: CodemieConfig, skillName: string): ImportedResource | undefined {
  return config.imported?.skills?.find((skill) => namesEqual(skill.name, skillName));
}

/**
 * Resolve sub-assistant names to UUIDs from state
 *
 * @throws Error if assistant not found in state
 */
export function resolveSubAssistantIds(names: string[], stateManager: StateManager): string[] {
  const resolvedIds: string[] = [];

  for (const name of names) {
    const subAssistantState = stateManager.getAssistantState(name);
    if (!subAssistantState) {
      throw new Error(`Sub-assistant "${name}" not found in state. Ensure the assistant is deployed first.`);
    }
    resolvedIds.push(subAssistantState.id);
    logger.info(`    ✓ Resolved "${name}" → ${subAssistantState.id}`);
  }

  return resolvedIds;
}

/**
 * Look up a skill ID by name without logging.
 * Returns undefined when the skill is not configured as resources.skills or imported.skills.
 */
export function lookupSkillId(
  skillName: string,
  stateManager: StateManager,
  config: CodemieConfig
): string | undefined {
  const configuredSkill = findConfiguredSkill(config, skillName);
  const importedSkill = findImportedSkill(config, skillName);

  if (configuredSkill && importedSkill) {
    return undefined;
  }

  if (importedSkill) {
    return importedSkill.id;
  }

  if (!configuredSkill) {
    return undefined;
  }

  return findSkillStateByName(stateManager, configuredSkill.name)?.id;
}

/**
 * Resolve a skill name to a platform UUID.
 *
 * Checks imported.skills for platform-managed skills and state.json only for skills
 * explicitly listed in resources.skills.
 *
 * @throws Error if skill not found in either source
 */
export function resolveSkillId(skillName: string, stateManager: StateManager, config: CodemieConfig): string {
  const configuredSkill = findConfiguredSkill(config, skillName);
  const importedSkill = findImportedSkill(config, skillName);

  if (configuredSkill && importedSkill) {
    throw new Error(
      `Skill "${skillName}" is defined in both resources.skills and imported.skills. ` +
        `Keep project-owned skills in resources.skills or external skills in imported.skills, not both.`
    );
  }

  const skillId = lookupSkillId(skillName, stateManager, config);
  if (skillId) {
    const source = importedSkill ? 'imported' : 'state';
    logger.info(`    ✓ Resolved${source === 'imported' ? ' (imported)' : ''} "${skillName}" → ${skillId}`);
    return skillId;
  }

  throw new Error(
    `Skill "${skillName}" cannot be resolved. ` +
      `For project-owned skills, define it in resources.skills and deploy it so state.json contains its ID. ` +
      `For external skills, add name and id to imported.skills.`
  );
}

/**
 * Resolve skill names to platform UUIDs.
 */
export function resolveSkillIds(skillNames: string[], stateManager: StateManager, config: CodemieConfig): string[] {
  return skillNames.map((name) => resolveSkillId(name, stateManager, config));
}

/**
 * Resolve datasource names to context entries
 *
 * @throws Error if datasource not found in config
 */
export function resolveDatasourceContext(
  datasourceNames: string[],
  allDatasources: Array<{ name: string; type?: string }>
): Array<{ context_type: 'code' | 'knowledge_base'; name: string }> {
  const datasourceContextEntries: Array<{ context_type: 'code' | 'knowledge_base'; name: string }> = [];

  for (const dsName of datasourceNames) {
    const datasource = allDatasources.find((ds) => ds.name === dsName);
    if (!datasource) {
      throw new Error(`Datasource with name "${dsName}" not found in config (resources or imported)`);
    }

    // Determine context_type based on datasource type
    const contextType = datasource.type === 'code' ? 'code' : 'knowledge_base';
    datasourceContextEntries.push({
      context_type: contextType,
      name: datasource.name,
    });
    logger.info(`    ✓ Resolved "${dsName}" → ${datasource.name} (${contextType})`);
  }

  return datasourceContextEntries;
}

/**
 * Resolve workflow assistant names to UUIDs
 *
 * Checks state.json first, falls back to imported.assistants
 *
 * @throws Error if assistant not found in either source
 */
export function resolveWorkflowAssistant(
  assistantName: string,
  stateManager: StateManager,
  config: CodemieConfig
): string {
  // Try state.json first (IaC-managed assistants)
  const assistantState = stateManager.getAssistantState(assistantName);
  if (assistantState) {
    logger.info(`  Resolved (name): ${assistantName} → ${assistantState.id}`);
    return assistantState.id;
  }

  // Fallback: check imported.assistants (platform-managed)
  const importedAssistant = config.imported?.assistants?.find((a) => a.name === assistantName);
  if (importedAssistant?.id) {
    logger.info(`  Resolved (imported): ${assistantName} → ${importedAssistant.id}`);
    return importedAssistant.id;
  }

  // Not found anywhere
  throw new Error(
    `Assistant "${assistantName}" not found in state or imported. ` +
      `Ensure the assistant is deployed first or added to imported.assistants.`
  );
}
