/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { AssistantResource, ImportedResource, WorkflowResource } from '../types/codemieConfig';

import { DependencyValidator } from './dependencyValidator';

describe('DependencyValidator', () => {
  describe('validateAssistantDependencies', () => {
    test('should pass validation for assistants without sub-assistants', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Assistant 1',
          prompt: './prompt1.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Assistant 2',
          prompt: './prompt2.md',
          model: 'gpt-4o',
          description: 'Test',
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should pass validation for valid sub-assistant hierarchy', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Helper',
          prompt: './helper.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Main',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Helper'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should detect cyclic dependencies', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'A',
          prompt: './a.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['B'],
        },
        {
          name: 'B',
          prompt: './b.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['A'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/Cyclic dependency detected/);
    });

    test('should detect nested sub-assistants', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Helper',
          prompt: './helper.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Middle',
          prompt: './middle.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Helper'],
        },
        {
          name: 'Main',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Middle'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/has sub-assistants but is itself used as a sub-assistant/);
    });

    test('should detect complex cycles (A → B → C → A)', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'A',
          prompt: './a.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['B'],
        },
        {
          name: 'B',
          prompt: './b.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['C'],
        },
        {
          name: 'C',
          prompt: './c.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['A'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/Cyclic dependency detected.*A.*B.*C.*A/);
    });

    test('should detect self-reference cycles', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Self-Referencing',
          prompt: './self.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Self-Referencing'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/Cyclic dependency detected/);
    });

    test('should handle multiple sub-assistants correctly', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Helper1',
          prompt: './helper1.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Helper2',
          prompt: './helper2.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Main',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Helper1', 'Helper2'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should allow same sub-assistant used by multiple parents', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Shared Helper',
          prompt: './helper.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Parent 1',
          prompt: './parent1.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Shared Helper'],
        },
        {
          name: 'Parent 2',
          prompt: './parent2.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Shared Helper'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should handle assistants with no sub_assistants field', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Assistant 1',
          prompt: './a1.md',
          model: 'gpt-4o',
          description: 'Test',
          // No sub_assistants field
        },
        {
          name: 'Assistant 2',
          prompt: './a2.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: [], // Empty array
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should handle missing sub-assistant gracefully', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Main',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Non-Existent Helper'], // References non-existent assistant
        },
      ];

      // Should not crash, validation passes (missing reference handled elsewhere)
      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors).toEqual([]);
    });

    test('should provide detailed error messages with parent names', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Helper',
          prompt: './helper.md',
          model: 'gpt-4o',
          description: 'Test',
        },
        {
          name: 'Middle',
          prompt: './middle.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Helper'],
        },
        {
          name: 'Parent1',
          prompt: './parent1.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Middle'],
        },
        {
          name: 'Parent2',
          prompt: './parent2.md',
          model: 'gpt-4o',
          description: 'Test',
          sub_assistants: ['Middle'],
        },
      ];

      const errors = DependencyValidator.validateAssistantDependencies(assistants);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/Middle/);
      expect(errors[0]).toMatch(/Parent1/);
      expect(errors[0]).toMatch(/Parent2/);
    });
  });

  describe('validateWorkflowAssistantReferences', () => {
    test('should pass validation when all assistant references exist', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Test Workflow',
          description: 'Test workflow',
          definition: `
assistants:
  - id: assistant1
    assistant_name: Main Assistant
  - id: assistant2
    assistant_name: Helper Assistant
          `,
        },
      ];

      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
        },
      ];

      const importedAssistants: ImportedResource[] = [
        {
          name: 'Helper Assistant',
          id: 'helper-1',
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, assistants, importedAssistants);
      expect(errors).toEqual([]);
    });

    test('should detect missing assistant reference', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Test Workflow',
          description: 'Test workflow',
          definition: `
assistants:
  - id: assistant1
    assistant_name: Non Existent Assistant
          `,
        },
      ];

      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, assistants, []);
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/Test Workflow/);
      expect(errors[0]).toMatch(/Non Existent Assistant/);
      expect(errors[0]).toMatch(/not found in resources.assistants or imported.assistants/);
    });

    test('should skip inline assistants (with model and system_prompt)', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Test Workflow',
          description: 'Test workflow',
          definition: `
assistants:
  - id: inline_assistant
    model: gpt-4o
    system_prompt: You are a helpful assistant
          `,
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, [], []);
      expect(errors).toEqual([]);
    });

    test('should validate multiple workflows', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Workflow 1',
          description: 'Test workflow 1',
          definition: `
assistants:
  - id: a1
    assistant_name: Valid Assistant
          `,
        },
        {
          name: 'Workflow 2',
          description: 'Test workflow 2',
          definition: `
assistants:
  - id: a2
    assistant_name: Invalid Assistant
          `,
        },
      ];

      const assistants: AssistantResource[] = [
        {
          name: 'Valid Assistant',
          prompt: './valid.md',
          model: 'gpt-4o',
          description: 'Test',
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, assistants, []);
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/Workflow 2/);
      expect(errors[0]).toMatch(/Invalid Assistant/);
    });

    test('should handle workflows without assistants section', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Simple Workflow',
          description: 'Simple workflow',
          definition: `
name: Simple Workflow
steps:
  - action: do_something
          `,
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, [], []);
      expect(errors).toEqual([]);
    });

    test('should accept a workflow definition with only inline states and no assistants key', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Inline States Workflow',
          description: 'Only states, no assistants',
          definition: `
states:
  - id: start
    task: Only inline states
          `,
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, [], []);
      expect(errors).toEqual([]);
    });

    test('should handle invalid YAML gracefully', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Broken Workflow',
          description: 'Broken workflow',
          definition: `
assistants: [invalid yaml here
          `,
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, [], []);
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/Broken Workflow/);
      expect(errors[0]).toMatch(/Failed to parse workflow YAML/);
    });

    test('should validate assistant from imported resources', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Test Workflow',
          description: 'Test workflow',
          definition: `
assistants:
  - id: assistant1
    assistant_name: Imported Assistant
          `,
        },
      ];

      const importedAssistants: ImportedResource[] = [
        {
          name: 'Imported Assistant',
          id: 'imported-1',
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, [], importedAssistants);
      expect(errors).toEqual([]);
    });

    test('should check both resource and imported assistants', () => {
      const workflows: WorkflowResource[] = [
        {
          name: 'Test Workflow',
          description: 'Test workflow',
          definition: `
assistants:
  - id: a1
    assistant_name: Resource Assistant
  - id: a2
    assistant_name: Imported Assistant
  - id: a3
    assistant_name: Missing Assistant
          `,
        },
      ];

      const assistants: AssistantResource[] = [
        {
          name: 'Resource Assistant',
          prompt: './resource.md',
          model: 'gpt-4o',
          description: 'Test',
        },
      ];

      const importedAssistants: ImportedResource[] = [
        {
          name: 'Imported Assistant',
          id: 'imported-1',
        },
      ];

      const errors = DependencyValidator.validateWorkflowAssistantReferences(workflows, assistants, importedAssistants);
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/Missing Assistant/);
    });
  });

  describe('validateAssistantSkillReferences', () => {
    test('should pass when skills exist in resources or imported.skills', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          skills: ['managed-skill', 'marketplace-skill'],
        },
      ];

      const errors = DependencyValidator.validateAssistantSkillReferences(
        assistants,
        [{ name: 'managed-skill', description: 'Managed', file: 'skills/managed-skill.skill.md' }],
        [{ name: 'marketplace-skill', id: 'skill-123' }]
      );

      expect(errors).toEqual([]);
    });

    test('should match skill references case-insensitively', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          skills: ['Marketplace-Skill'],
        },
      ];

      const errors = DependencyValidator.validateAssistantSkillReferences(
        assistants,
        [],
        [{ name: 'marketplace-skill', id: 'skill-123' }]
      );

      expect(errors).toEqual([]);
    });

    test('should fail when skill reference is missing', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          skills: ['missing-skill'],
        },
      ];

      const errors = DependencyValidator.validateAssistantSkillReferences(assistants, [], []);
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/missing-skill/);
      expect(errors[0]).toMatch(/resources.skills or imported.skills/);
    });

    test('should fail when skill exists in resources.skills and imported.skills', () => {
      const assistants: AssistantResource[] = [
        {
          name: 'Main Assistant',
          prompt: './main.md',
          model: 'gpt-4o',
          description: 'Test',
          skills: ['duplicate-skill'],
        },
      ];

      const errors = DependencyValidator.validateAssistantSkillReferences(
        assistants,
        [{ name: 'duplicate-skill', description: 'Managed', file: 'skills/duplicate-skill.skill.md' }],
        [{ name: 'Duplicate-Skill', id: 'skill-imported-id' }]
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/defined in both resources\.skills and imported\.skills/);
    });
  });
});
