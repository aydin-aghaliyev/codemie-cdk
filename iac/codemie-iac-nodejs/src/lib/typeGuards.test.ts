/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import { hasName, hasSettingId } from './typeGuards';

describe('typeGuards', () => {
  // Common edge cases apply to all type guards
  const invalidInputs = [null, undefined, 'string', 123, true, [1, 2, 3]];

  describe('hasName', () => {
    it('should return true for valid objects with name', () => {
      expect(hasName({ name: 'Assistant' })).toBe(true);
      expect(hasName({ name: 'test', id: '123', value: 42 })).toBe(true);
    });

    it('should return false for invalid inputs', () => {
      expect(hasName({ id: '123' })).toBe(false);
      for (const input of invalidInputs) {
        expect(hasName(input)).toBe(false);
      }
    });
  });

  describe('hasSettingId', () => {
    it('should return true for valid objects with setting_id', () => {
      expect(hasSettingId({ setting_id: 'setting-123' })).toBe(true);
      expect(hasSettingId({ setting_id: 456 })).toBe(true);
      expect(hasSettingId({ setting_id: '789', name: 'config' })).toBe(true);
    });

    it('should return false for invalid inputs', () => {
      expect(hasSettingId({ id: '123' })).toBe(false);
      for (const input of invalidInputs) {
        expect(hasSettingId(input)).toBe(false);
      }
    });
  });
});
