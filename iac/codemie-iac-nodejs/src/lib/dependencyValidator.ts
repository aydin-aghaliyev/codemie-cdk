/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as yaml from 'yaml';

import type { AssistantResource, WorkflowResource, ImportedResource, SkillResource } from '../types/codemieConfig';

import { namesEqual } from './nameUtils';

export class DependencyValidator {
  /**
   * Validate assistant dependencies for cycles and nested sub-assistants
   */
  static validateAssistantDependencies(assistants: AssistantResource[]): string[] {
    const errors: string[] = [];

    // Build name to assistant map (name-based validation)
    const assistantMap = new Map<string, AssistantResource>();
    for (const assistant of assistants) {
      assistantMap.set(assistant.name, assistant);
    }

    // Check for cyclic dependencies
    const cyclicErrors = this.detectCycles(assistants, assistantMap);
    errors.push(...cyclicErrors);

    // Check for nested sub-assistants (assistant with sub-assistants cannot be a sub-assistant itself)
    const nestedErrors = this.detectNestedSubAssistants(assistants);
    errors.push(...nestedErrors);

    return errors;
  }

  /**
   * Detect cyclic dependencies using DFS (name-based)
   */
  private static detectCycles(assistants: AssistantResource[], assistantMap: Map<string, AssistantResource>): string[] {
    const errors: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (name: string, path: string[]): boolean => {
      if (recursionStack.has(name)) {
        // Found a cycle
        const cycleStart = path.indexOf(name);
        const cycle = [...path.slice(cycleStart), name];
        errors.push(`Cyclic dependency detected: ${cycle.join(' → ')}`);
        return true;
      }

      if (visited.has(name)) {
        return false;
      }

      visited.add(name);
      recursionStack.add(name);
      path.push(name);

      const assistant = assistantMap.get(name);

      // Get sub-assistants list (name-based)
      const subAssistantRefs: string[] = assistant?.sub_assistants || [];

      for (const subRef of subAssistantRefs) {
        if (!assistantMap.has(subRef)) {
          // Sub-assistant not found (will be caught by other validation)
          continue;
        }

        if (dfs(subRef, [...path])) {
          return true;
        }
      }

      recursionStack.delete(name);
      return false;
    };

    // Check all assistants as potential cycle entry points
    for (const assistant of assistants) {
      if (!visited.has(assistant.name)) {
        dfs(assistant.name, []);
      }
    }

    return errors;
  }

  /**
   * Detect nested sub-assistants (assistant with sub-assistants cannot be a sub-assistant)
   * Name-based validation
   */
  private static detectNestedSubAssistants(assistants: AssistantResource[]): string[] {
    const errors: string[] = [];

    // Build set of all names that are used as sub-assistants
    const usedAsSubAssistant = new Set<string>();
    for (const assistant of assistants) {
      if (assistant.sub_assistants && assistant.sub_assistants.length > 0) {
        for (const subName of assistant.sub_assistants) {
          usedAsSubAssistant.add(subName);
        }
      }
    }

    // Check if any assistant with sub-assistants is itself a sub-assistant
    for (const assistant of assistants) {
      const hasSubAssistants = assistant.sub_assistants && assistant.sub_assistants.length > 0;

      if (hasSubAssistants && usedAsSubAssistant.has(assistant.name)) {
        // Find who uses it as sub-assistant
        const parents: string[] = [];
        for (const potentialParent of assistants) {
          if (potentialParent.sub_assistants?.includes(assistant.name)) {
            parents.push(potentialParent.name);
          }
        }

        errors.push(
          `Assistant "${assistant.name}" has sub-assistants but is itself used as a sub-assistant by: ${parents.join(', ')}. ` +
            `Nested sub-assistants are not allowed.`
        );
      }
    }

    return errors;
  }

  /**
   * Validate workflow assistant references
   * Check that all assistant_name references in workflows point to existing assistants
   */
  static validateWorkflowAssistantReferences(
    workflows: WorkflowResource[],
    assistants: AssistantResource[],
    importedAssistants: ImportedResource[]
  ): string[] {
    const errors: string[] = [];

    // Build set of all available assistant names
    const availableAssistants = new Set<string>();
    for (const assistant of assistants) {
      availableAssistants.add(assistant.name);
    }
    for (const imported of importedAssistants) {
      availableAssistants.add(imported.name);
    }

    // Check each workflow
    for (const workflow of workflows) {
      try {
        const workflowYaml = yaml.parse(workflow.definition) as {
          assistants?: Array<{ id: string; assistant_name?: string; model?: string; system_prompt?: string }>;
        };

        if (!workflowYaml.assistants) {
          continue;
        }

        for (const assistant of workflowYaml.assistants) {
          // Skip inline assistants (have model + system_prompt)
          if (assistant.model && assistant.system_prompt && !assistant.assistant_name) {
            continue;
          }

          // Check if assistant_name is defined and references an existing assistant
          if (assistant.assistant_name && !availableAssistants.has(assistant.assistant_name)) {
            errors.push(
              `Workflow "${workflow.name}": Assistant reference "${assistant.assistant_name}" (id: ${assistant.id}) ` +
                `not found in resources.assistants or imported.assistants`
            );
          }
        }
      } catch (error) {
        errors.push(
          `Workflow "${workflow.name}": Failed to parse workflow YAML: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return errors;
  }

  /**
   * Validate assistant skill references.
   * Check that all skill names point to resources.skills or imported.skills entries.
   */
  static validateAssistantSkillReferences(
    assistants: AssistantResource[],
    managedSkills: SkillResource[],
    importedSkills: ImportedResource[]
  ): string[] {
    const errors: string[] = [];

    for (const managedSkill of managedSkills) {
      const importedSkill = importedSkills.find((skill) => namesEqual(skill.name, managedSkill.name));
      if (importedSkill) {
        errors.push(
          `Skill "${managedSkill.name}" is defined in both resources.skills and imported.skills. ` +
            `Keep project-owned skills in resources.skills or external skills in imported.skills, not both.`
        );
      }
    }

    const isSkillAvailable = (skillName: string): boolean =>
      managedSkills.some((skill) => namesEqual(skill.name, skillName)) ||
      importedSkills.some((skill) => namesEqual(skill.name, skillName));

    for (const assistant of assistants) {
      for (const skillName of assistant.skills || []) {
        if (!isSkillAvailable(skillName)) {
          errors.push(
            `Assistant "${assistant.name}": Skill reference "${skillName}" ` +
              `not found in resources.skills or imported.skills`
          );
        }
      }
    }

    return errors;
  }
}
