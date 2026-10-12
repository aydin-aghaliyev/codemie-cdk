/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { CodeMieClient } from 'codemie-sdk';

import type { CodemieConfig, SkillResource } from '../types/codemieConfig';

import {
  checkApiSlugConflicts,
  isAssistant,
  isAssistantWithSlug,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MIN_SKILL_DESCRIPTION_LENGTH,
  validateSkillContentLengths,
  validateSkillDescriptions,
  validateSlugUniqueness,
} from './validationUtils';

function skill(overrides: Partial<SkillResource> = {}): SkillResource {
  return { name: 'skill', description: 'a'.repeat(MIN_SKILL_DESCRIPTION_LENGTH), file: 'skill.skill.md', ...overrides };
}

describe('validationUtils', () => {
  describe('isAssistantWithSlug', () => {
    it('should return true for valid assistant with slug', () => {
      expect(isAssistantWithSlug({ slug: 'slug', name: 'name' })).toBe(true);
    });

    it('should return false for missing slug', () => {
      expect(isAssistantWithSlug({ name: 'name' })).toBe(false);
    });

    it('should return false for missing name', () => {
      expect(isAssistantWithSlug({ slug: 'slug' })).toBe(false);
    });

    it('should return false when slug is not a string', () => {
      expect(isAssistantWithSlug({ slug: 123, name: 'Assistant' })).toBe(false);
    });

    it('should return false when name is not a string', () => {
      expect(isAssistantWithSlug({ slug: 'slug', name: 123 })).toBe(false);
    });

    it('should return false for null or undefined input', () => {
      expect(isAssistantWithSlug(null)).toBe(false);
      expect(isAssistantWithSlug(undefined)).toBe(false);
    });

    it('should return false for primitive values', () => {
      expect(isAssistantWithSlug('string')).toBe(false);
      expect(isAssistantWithSlug(123)).toBe(false);
      expect(isAssistantWithSlug(true)).toBe(false);
    });
  });

  describe('isAssistant', () => {
    it('should return true for valid Assistant object', () => {
      expect(isAssistant({ id: '123', slug: 'slug' })).toBe(true);
    });

    it('should return false if id is missing', () => {
      expect(isAssistant({ slug: 'slug' })).toBe(false);
    });

    it('should return false if slug is missing', () => {
      expect(isAssistant({ id: '123' })).toBe(false);
    });

    it('should return false for null or undefined input', () => {
      expect(isAssistant(null)).toBe(false);
      expect(isAssistant(undefined)).toBe(false);
    });

    it('should return false for primitive values', () => {
      expect(isAssistant('string')).toBe(false);
      expect(isAssistant(123)).toBe(false);
    });
  });

  describe('validateSlugUniqueness', () => {
    it('should return empty array if no duplicate slugs', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as never,
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'A1', description: 'd', prompt: 'p', model: 'm', slug: 'slug1' },
            { name: 'A2', description: 'd', prompt: 'p', model: 'm', slug: 'slug2' },
          ],
        },
      };
      expect(validateSlugUniqueness(config)).toEqual([]);
    });

    it('should return errors for duplicate slugs', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'A1', description: 'd', prompt: 'p', model: 'm', slug: 'slug1' },
            { name: 'A2', description: 'd', prompt: 'p', model: 'm', slug: 'slug1' },
          ],
        },
      };
      const errors = validateSlugUniqueness(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Duplicate slug "slug1"');
    });

    it('should ignore assistants without slugs', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as never,
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'A1', description: 'd', prompt: 'p', model: 'm' }, // No slug
            { name: 'A2', description: 'd', prompt: 'p', model: 'm', slug: 'slug1' },
          ],
        },
      };
      expect(validateSlugUniqueness(config)).toEqual([]);
    });

    it('should detect multiple duplicate groups independently', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as never,
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'A1', description: 'd', prompt: 'p', model: 'm', slug: 'slug-a' },
            { name: 'A2', description: 'd', prompt: 'p', model: 'm', slug: 'slug-a' },
            { name: 'A3', description: 'd', prompt: 'p', model: 'm', slug: 'slug-b' },
            { name: 'A4', description: 'd', prompt: 'p', model: 'm', slug: 'slug-b' },
          ],
        },
      };

      const errors = validateSlugUniqueness(config);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('slug-a');
      expect(errors[1]).toContain('slug-b');
    });

    it('should flag slug reused more than twice', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as never,
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'A1', description: 'd', prompt: 'p', model: 'm', slug: 'shared' },
            { name: 'A2', description: 'd', prompt: 'p', model: 'm', slug: 'shared' },
            { name: 'A3', description: 'd', prompt: 'p', model: 'm', slug: 'shared' },
          ],
        },
      };

      const errors = validateSlugUniqueness(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('A1');
      expect(errors[0]).toContain('A2');
      expect(errors[0]).toContain('A3');
    });

    it('should return empty array when assistant list is empty', () => {
      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as never,
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: { assistants: [] },
      };

      expect(validateSlugUniqueness(config)).toEqual([]);
    });
  });

  describe('checkApiSlugConflicts', () => {
    it('should return empty array if no conflicts found', async () => {
      const existingAssistants = [{ id: '1', name: 'Existing', slug: 'other-slug' }];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [{ name: 'New', description: 'd', prompt: 'p', model: 'm', slug: 'new-slug' }],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: {},
      });
      const listMock = mockClient.assistants.list as jest.Mock;
      expect(listMock).toHaveBeenCalledWith({ minimal_response: false, per_page: 100 });
      expect(errors).toEqual([]);
    });

    it('should return error if slug conflicts with existing assistant', async () => {
      const existingAssistants = [{ id: '1', name: 'Existing', slug: 'conflict-slug' }];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [{ name: 'New', description: 'd', prompt: 'p', model: 'm', slug: 'conflict-slug' }],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: {},
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('already exists in Codemie');
      expect(errors[0]).toContain('Existing');
    });

    it('should ignore conflicts if assistant has no slug in config', async () => {
      const existingAssistants = [{ id: '1', name: 'Existing', slug: 'some-slug' }];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'New', description: 'd', prompt: 'p', model: 'm' }, // No slug
          ],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: {},
      });
      expect(errors).toEqual([]);
    });

    it('should handle multiple conflicts returned from API', async () => {
      const existingAssistants = [
        { id: 'ast-a', name: 'Existing A', slug: 'slug-a' },
        { id: 'ast-b', name: 'Existing B', slug: 'slug-b' },
      ];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [
            { name: 'Config A', description: 'd', prompt: 'p', model: 'm', slug: 'slug-a' },
            { name: 'Config B', description: 'd', prompt: 'p', model: 'm', slug: 'slug-b' },
          ],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: {},
      });
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('slug-a');
      expect(errors[1]).toContain('slug-b');
    });

    it('should ignore platform assistants without slugs', async () => {
      const existingAssistants = [
        { id: 'ast-1', name: 'No Slug Assistant' },
        { id: 'ast-2', name: 'Existing', slug: 'other-slug' },
      ];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [{ name: 'New', description: 'd', prompt: 'p', model: 'm', slug: 'unique-slug' }],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: {},
      });
      expect(errors).toEqual([]);
    });

    it('should skip conflict check if assistant is already being deployed', async () => {
      const existingAssistants = [{ id: '1', name: 'Existing', slug: 'conflict-slug' }];
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue(existingAssistants),
        },
      } as unknown as CodeMieClient;

      const config: CodemieConfig = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {} as CodemieConfig['environment'],
        imported: { assistants: [], datasources: [], integrations: [] },
        resources: {
          assistants: [{ name: 'New', description: 'd', prompt: 'p', model: 'm', slug: 'conflict-slug' }],
        },
      };

      const errors = await checkApiSlugConflicts({
        config,
        client: mockClient,
        assistantState: { New: { id: '2', lastDeployed: '2025-01-01', promptChecksum: 'abc', configChecksum: 'def' } },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('validateSkillDescriptions', () => {
    it('should return empty array for description exactly at minimum length', () => {
      const skills = [skill({ description: 'a'.repeat(MIN_SKILL_DESCRIPTION_LENGTH) })];
      expect(validateSkillDescriptions(skills)).toEqual([]);
    });

    it('should return empty array for description exactly at maximum length', () => {
      const skills = [skill({ description: 'a'.repeat(MAX_SKILL_DESCRIPTION_LENGTH) })];
      expect(validateSkillDescriptions(skills)).toEqual([]);
    });

    it('should return an error for description one character under the minimum', () => {
      const skills = [skill({ name: 'too-short', description: 'a'.repeat(MIN_SKILL_DESCRIPTION_LENGTH - 1) })];
      const errors = validateSkillDescriptions(skills);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('too-short');
      expect(errors[0]).toContain(String(MIN_SKILL_DESCRIPTION_LENGTH - 1));
      expect(errors[0]).toContain(String(MIN_SKILL_DESCRIPTION_LENGTH));
      expect(errors[0]).toContain(String(MAX_SKILL_DESCRIPTION_LENGTH));
    });

    it('should return an error for description one character over the maximum', () => {
      const skills = [skill({ name: 'too-long', description: 'a'.repeat(MAX_SKILL_DESCRIPTION_LENGTH + 1) })];
      const errors = validateSkillDescriptions(skills);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('too-long');
      expect(errors[0]).toContain(String(MAX_SKILL_DESCRIPTION_LENGTH + 1));
      expect(errors[0]).toContain(String(MIN_SKILL_DESCRIPTION_LENGTH));
      expect(errors[0]).toContain(String(MAX_SKILL_DESCRIPTION_LENGTH));
    });

    it('should return an error for a missing description', () => {
      const skills = [skill({ name: 'no-description', description: undefined as unknown as string })];
      const errors = validateSkillDescriptions(skills);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('no-description');
    });

    it('should return an error for an empty description', () => {
      const skills = [skill({ name: 'empty-description', description: '' })];
      const errors = validateSkillDescriptions(skills);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('empty-description');
    });

    it('should return one error per invalid skill when several skills are out of range', () => {
      const skills = [
        skill({ name: 'ok-skill', description: 'a'.repeat(MIN_SKILL_DESCRIPTION_LENGTH) }),
        skill({ name: 'short-skill', description: 'a'.repeat(MIN_SKILL_DESCRIPTION_LENGTH - 1) }),
        skill({ name: 'long-skill', description: 'a'.repeat(MAX_SKILL_DESCRIPTION_LENGTH + 1) }),
      ];
      const errors = validateSkillDescriptions(skills);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('short-skill');
      expect(errors[1]).toContain('long-skill');
    });

    it('should return empty array when no skills are provided', () => {
      expect(validateSkillDescriptions([])).toEqual([]);
    });
  });

  describe('validateSkillContentLengths', () => {
    const limits = { min_content_length: 50, max_content_length: 200 };

    it('should return empty array for content within the injected limits', () => {
      const entries = [{ name: 'skill-a', content: 'x'.repeat(100) }];
      expect(validateSkillContentLengths(entries, limits)).toEqual([]);
    });

    it('should return an error for content under the injected minimum', () => {
      const entries = [{ name: 'skill-a', content: 'x'.repeat(limits.min_content_length - 1) }];
      const errors = validateSkillContentLengths(entries, limits);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('skill-a');
      expect(errors[0]).toContain(String(limits.min_content_length - 1));
      expect(errors[0]).toContain(String(limits.min_content_length));
      expect(errors[0]).toContain(String(limits.max_content_length));
    });

    it('should return an error for content over the injected maximum', () => {
      const entries = [{ name: 'skill-b', content: 'x'.repeat(limits.max_content_length + 1) }];
      const errors = validateSkillContentLengths(entries, limits);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('skill-b');
      expect(errors[0]).toContain(String(limits.max_content_length + 1));
      expect(errors[0]).toContain(String(limits.min_content_length));
      expect(errors[0]).toContain(String(limits.max_content_length));
    });

    it('should return empty array when no entries are provided', () => {
      expect(validateSkillContentLengths([], limits)).toEqual([]);
    });
  });
});
