/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { isProjectOwnedSkill } from './skillUtils';

describe('skillUtils', () => {
  describe('isProjectOwnedSkill', () => {
    it('should compare project names case-insensitively and ignore surrounding whitespace', () => {
      expect(isProjectOwnedSkill({ project: ' Test Project ' }, 'test project')).toBe(true);
      expect(isProjectOwnedSkill({ project: 'Other Project' }, 'test project')).toBe(false);
    });
  });
});
