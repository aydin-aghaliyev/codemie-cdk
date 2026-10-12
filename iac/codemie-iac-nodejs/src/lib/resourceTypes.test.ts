/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { pluralTypeOf, VALID_RESOURCE_TYPES } from './resourceTypes';

describe('resourceTypes', () => {
  describe('pluralTypeOf', () => {
    it('returns "assistants" for "assistant"', () => {
      expect(pluralTypeOf('assistant')).toBe('assistants');
    });

    it('returns "datasources" for "datasource"', () => {
      expect(pluralTypeOf('datasource')).toBe('datasources');
    });

    it('returns "workflows" for "workflow"', () => {
      expect(pluralTypeOf('workflow')).toBe('workflows');
    });

    it('returns "skills" for "skill"', () => {
      expect(pluralTypeOf('skill')).toBe('skills');
    });
  });

  describe('VALID_RESOURCE_TYPES', () => {
    it('lists exactly the four supported resource types', () => {
      expect(VALID_RESOURCE_TYPES).toEqual(['assistant', 'datasource', 'workflow', 'skill']);
    });
  });
});
