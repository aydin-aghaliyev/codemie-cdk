/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
/*
 * Selection logic for `deploy --replace-skill-group` / `preview --replace-skill-group`.
 *
 * Group membership comes ONLY from the `group` field — either the label persisted in state or the
 * label on the config entry. Skill names are never pattern-matched against the group name: a skill
 * called "<group>-something" is not part of the group unless it carries the label.
 */
import type { AssistantResource, CodemieConfig, ImportedResource, SkillResource } from '../types/codemieConfig';

import { namesEqual } from './nameUtils';
import type { StateManager } from './stateManager';

/** Names of the config skills labelled with `group`. */
export function getSkillNamesInGroup(skills: SkillResource[] | undefined, group: string): Set<string> {
  return new Set((skills || []).filter((skill) => skill.group === group).map((skill) => skill.name));
}

/** Config skills labelled with `group`, in config order. */
export function getSkillsInGroup(skills: SkillResource[] | undefined, group: string): SkillResource[] {
  return (skills || []).filter((skill) => skill.group === group);
}

/**
 * State-managed skill names to delete when replacing `group`: a skill is selected when its state
 * entry carries the group label, or when its config entry does. Config skills that are not in state
 * yet have nothing to delete and are therefore absent from the result.
 */
export function collectSkillNamesForReplacement(
  skills: SkillResource[] | undefined,
  stateManager: StateManager,
  group: string
): string[] {
  const groupSkillNames = getSkillNamesInGroup(skills, group);
  const namesToDelete = new Set<string>();

  for (const name of stateManager.getAllManagedResources().skills) {
    const state = stateManager.getSkillState(name);

    if (state?.group === group || groupSkillNames.has(name)) {
      namesToDelete.add(name);
    }
  }

  return [...namesToDelete].sort((left, right) => left.localeCompare(right));
}

/**
 * Config assistants that reference at least one skill of `group`. Skill references are matched
 * case-insensitively, the same way `DependencyValidator.validateAssistantSkillReferences` accepts
 * them, so an assistant that passes validation can never be left out of the narrowed redeploy.
 */
export function filterAssistantsReferencingSkillGroup(
  assistants: AssistantResource[] | undefined,
  skills: SkillResource[] | undefined,
  group: string
): AssistantResource[] {
  const skillNames = getSkillNamesInGroup(skills, group);

  if (skillNames.size === 0) {
    return [];
  }

  const groupNames = [...skillNames];

  return (assistants || []).filter((assistant) =>
    assistant.skills?.some((skillName) => groupNames.some((groupName) => namesEqual(groupName, skillName)))
  );
}

/**
 * Add the transitively referenced `sub_assistants` of the selected assistants, so a narrowed deploy
 * list still satisfies the dependency sort. Sub-assistants missing from `allAssistants` are left out
 * here and reported by the regular dependency validation.
 */
export function expandAssistantsWithDependencies(
  selected: AssistantResource[],
  allAssistants: AssistantResource[] | undefined
): AssistantResource[] {
  const byName = new Map((allAssistants || []).map((assistant) => [assistant.name, assistant]));
  const result: AssistantResource[] = [];
  const seen = new Set<string>();

  const visit = (assistant: AssistantResource): void => {
    if (seen.has(assistant.name)) {
      return;
    }
    seen.add(assistant.name);
    result.push(assistant);

    for (const subName of assistant.sub_assistants || []) {
      const subAssistant = byName.get(subName);
      if (subAssistant) {
        visit(subAssistant);
      }
    }
  };

  for (const assistant of selected) {
    visit(assistant);
  }

  return result;
}

/**
 * Every assistant id the replaced skills may be attached to: all state-managed assistants plus every
 * entry of `imported.assistants`. Order is state first, then imported; duplicates are dropped.
 */
export function collectAssistantIdsForDetach(stateManager: StateManager, config: CodemieConfig): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const add = (id: string | undefined): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  for (const name of stateManager.getAllManagedResources().assistants) {
    add(stateManager.getIdByName('assistant', name));
  }

  for (const imported of config.imported?.assistants || []) {
    add(imported.id);
  }

  return ids;
}

/**
 * The single selection point shared by `deploy` and `preview`, so both report the same set of skills:
 * the state-managed names to delete and the config entries to recreate.
 */
export function selectSkillGroupForReplacement(
  config: CodemieConfig,
  stateManager: StateManager,
  group: string
): { namesToDelete: string[]; groupSkills: SkillResource[] } {
  assertSkillGroupNotImported(config.imported?.skills, group);

  const namesToDelete = collectSkillNamesForReplacement(config.resources.skills, stateManager, group);
  const groupSkills = getSkillsInGroup(config.resources.skills, group);

  if (namesToDelete.length === 0 && groupSkills.length === 0) {
    throw new Error(
      `Skill group "${group}" matched no skills in state or in resources.skills. ` +
        `Group membership comes from the "group" field of a skill entry, never from its name.`
    );
  }

  return { namesToDelete, groupSkills };
}

/**
 * Imported skills are platform-managed: IaC must never delete and recreate them, so a group name
 * that collides with an `imported.skills` entry is refused before anything is touched.
 */
export function assertSkillGroupNotImported(importedSkills: ImportedResource[] | undefined, group: string): void {
  const conflict = (importedSkills || []).find((skill) => namesEqual(skill.name, group));

  if (conflict) {
    throw new Error(
      `Skill group "${group}" matches an entry in imported.skills ("${conflict.name}"). ` +
        `Imported skills are platform-managed and are never deleted or recreated by IaC. ` +
        `Rename the group or remove the imported.skills entry.`
    );
  }
}
