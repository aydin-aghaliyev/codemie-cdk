/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AssistantResource, CodemieConfig, SkillResource } from '../types/codemieConfig';

import {
  assertSkillGroupNotImported,
  collectAssistantIdsForDetach,
  collectSkillNamesForReplacement,
  expandAssistantsWithDependencies,
  filterAssistantsReferencingSkillGroup,
  getSkillNamesInGroup,
  selectSkillGroupForReplacement,
} from './skillReplacement';
import { StateManager } from './stateManager';

function skill(name: string, group?: string): SkillResource {
  return { name, description: `${name} description`, file: `${name}.skill.md`, ...(group ? { group } : {}) };
}

function assistant(name: string, skills?: string[], subAssistants?: string[]): AssistantResource {
  return {
    name,
    description: `${name} description`,
    prompt: `${name}.md`,
    model: 'gpt-4',
    ...(skills ? { skills } : {}),
    ...(subAssistants ? { sub_assistants: subAssistants } : {}),
  } as AssistantResource;
}

function baseConfig(overrides: Partial<CodemieConfig> = {}): CodemieConfig {
  return {
    version: '1',
    project: { name: 'proj', description: '' },
    environment: {
      codemie_api_url: 'https://api.example',
      auth_server_url: 'https://auth.example',
      auth_realm_name: 'realm',
    },
    imported: { assistants: [], datasources: [], skills: [], integrations: [] },
    resources: {},
    ...overrides,
  };
}

function createStateManager(): { stateManager: StateManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-replacement-'));
  return {
    dir,
    stateManager: new StateManager({
      rootDir: dir,
      codemieConfig: 'codemie.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    }),
  };
}

describe('skillReplacement', () => {
  let dir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    const created = createStateManager();
    dir = created.dir;
    stateManager = created.stateManager;
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('getSkillNamesInGroup', () => {
    it('returns only the config skills labelled with the group', () => {
      const skills = [skill('alpha', 'bundle'), skill('beta', 'other'), skill('gamma')];

      expect([...getSkillNamesInGroup(skills, 'bundle')]).toEqual(['alpha']);
    });

    it('returns an empty set for missing skills', () => {
      expect(getSkillNamesInGroup(undefined, 'bundle').size).toBe(0);
    });
  });

  describe('collectSkillNamesForReplacement', () => {
    it('selects state-managed skills whose state group matches', () => {
      stateManager.updateSkillState('alpha', 'alpha-id', 'content', skill('alpha', 'bundle'));
      stateManager.updateSkillState('beta', 'beta-id', 'content', skill('beta', 'other'));

      expect(collectSkillNamesForReplacement([], stateManager, 'bundle')).toEqual(['alpha']);
    });

    it('selects state-managed skills whose config entry carries the group', () => {
      stateManager.updateSkillState('alpha', 'alpha-id', 'content', skill('alpha'));

      expect(collectSkillNamesForReplacement([skill('alpha', 'bundle')], stateManager, 'bundle')).toEqual(['alpha']);
    });

    it('ignores config skills that have no state entry', () => {
      expect(collectSkillNamesForReplacement([skill('fresh', 'bundle')], stateManager, 'bundle')).toEqual([]);
    });

    it('never selects by name pattern, only by the group field', () => {
      stateManager.updateSkillState('github-copilot--body-1', 'split-id', 'content', skill('github-copilot--body-1'));
      stateManager.updateSkillState('bundle-looking-name', 'look-id', 'content', skill('bundle-looking-name'));

      expect(collectSkillNamesForReplacement([], stateManager, 'github-copilot')).toEqual([]);
      expect(collectSkillNamesForReplacement([], stateManager, 'bundle')).toEqual([]);
    });

    it('returns a sorted, de-duplicated list', () => {
      stateManager.updateSkillState('zulu', 'zulu-id', 'content', skill('zulu', 'bundle'));
      stateManager.updateSkillState('alpha', 'alpha-id', 'content', skill('alpha', 'bundle'));

      expect(
        collectSkillNamesForReplacement([skill('alpha', 'bundle'), skill('zulu', 'bundle')], stateManager, 'bundle')
      ).toEqual(['alpha', 'zulu']);
    });
  });

  describe('filterAssistantsReferencingSkillGroup', () => {
    it('keeps only assistants referencing a skill in the group', () => {
      const skills = [skill('alpha', 'bundle'), skill('beta', 'other')];
      const assistants = [assistant('A', ['alpha']), assistant('B', ['beta']), assistant('C')];

      expect(filterAssistantsReferencingSkillGroup(assistants, skills, 'bundle').map((a) => a.name)).toEqual(['A']);
    });

    it('selects an assistant whose skill reference differs only in letter case', () => {
      const skills = [skill('foo-skill', 'bundle')];
      const assistants = [assistant('A', ['Foo-Skill'])];

      expect(filterAssistantsReferencingSkillGroup(assistants, skills, 'bundle').map((a) => a.name)).toEqual(['A']);
    });

    it('returns an empty list when the group has no config skills', () => {
      expect(filterAssistantsReferencingSkillGroup([assistant('A', ['alpha'])], [skill('alpha')], 'bundle')).toEqual(
        []
      );
    });
  });

  describe('expandAssistantsWithDependencies', () => {
    it('adds transitively referenced sub-assistants so the topological sort stays solvable', () => {
      const all = [assistant('Top', ['alpha'], ['Mid']), assistant('Mid', undefined, ['Leaf']), assistant('Leaf')];

      const expanded = expandAssistantsWithDependencies([all[0]], all);

      expect(expanded.map((a) => a.name).sort()).toEqual(['Leaf', 'Mid', 'Top']);
    });

    it('does not add unrelated assistants and keeps the selection unique', () => {
      const all = [assistant('Top', ['alpha']), assistant('Unrelated')];

      expect(expandAssistantsWithDependencies([all[0], all[0]], all).map((a) => a.name)).toEqual(['Top']);
    });
  });

  describe('collectAssistantIdsForDetach', () => {
    it('collects every state-managed assistant id plus every imported assistant id', () => {
      stateManager.updateAssistantState('Managed', 'ast-managed', 'prompt', assistant('Managed'));
      const config = baseConfig({
        imported: {
          assistants: [
            { name: 'Imported', id: 'ast-imported' },
            { name: 'Duplicate', id: 'ast-managed' },
          ],
          datasources: [],
          skills: [],
          integrations: [],
        },
      });

      expect(collectAssistantIdsForDetach(stateManager, config)).toEqual(['ast-managed', 'ast-imported']);
    });

    it('skips imported assistants without an id', () => {
      const config = baseConfig({
        imported: {
          assistants: [{ name: 'NoId' } as { name: string; id: string }],
          datasources: [],
          skills: [],
          integrations: [],
        },
      });

      expect(collectAssistantIdsForDetach(stateManager, config)).toEqual([]);
    });
  });

  describe('selectSkillGroupForReplacement', () => {
    it('returns the names to delete and the config entries to recreate', () => {
      stateManager.updateSkillState('legacy', 'legacy-id', 'content', skill('legacy', 'bundle'));
      const config = baseConfig({ resources: { skills: [skill('alpha', 'bundle'), skill('gamma')] } });

      const selection = selectSkillGroupForReplacement(config, stateManager, 'bundle');

      expect(selection.namesToDelete).toEqual(['legacy']);
      expect(selection.groupSkills.map((entry) => entry.name)).toEqual(['alpha']);
    });

    it('throws when the group matches nothing in state or config', () => {
      const config = baseConfig({ resources: { skills: [skill('gamma')] } });

      expect(() => selectSkillGroupForReplacement(config, stateManager, 'bundle')).toThrow(
        'Skill group "bundle" matched no skills'
      );
    });

    it('throws when the group collides with an imported skill before selecting anything', () => {
      const config = baseConfig({
        imported: {
          assistants: [],
          datasources: [],
          skills: [{ name: 'bundle', id: 'skill-imported' }],
          integrations: [],
        },
        resources: { skills: [skill('alpha', 'bundle')] },
      });

      expect(() => selectSkillGroupForReplacement(config, stateManager, 'bundle')).toThrow(
        'matches an entry in imported.skills'
      );
    });
  });

  describe('assertSkillGroupNotImported', () => {
    it('throws when the group name matches an imported skill', () => {
      expect(() => assertSkillGroupNotImported([{ name: 'Bundle', id: 'skill-imported' }], 'bundle')).toThrow(
        'Skill group "bundle" matches an entry in imported.skills'
      );
    });

    it('passes when no imported skill matches', () => {
      expect(() => assertSkillGroupNotImported([{ name: 'other', id: 'skill-imported' }], 'bundle')).not.toThrow();
      expect(() => assertSkillGroupNotImported(undefined, 'bundle')).not.toThrow();
    });
  });
});
