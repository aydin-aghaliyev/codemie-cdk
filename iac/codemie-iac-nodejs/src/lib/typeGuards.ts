/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

/**
 * Centralized type guards for runtime type checking
 * Used across backup, converters, and other modules
 */

/**
 * Check if object has name field
 */
export function hasName(obj: unknown): obj is { name: string } {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
}

/**
 * Check if object has setting_id field
 */
export function hasSettingId(obj: unknown): obj is { setting_id: string | number } {
  return typeof obj === 'object' && obj !== null && 'setting_id' in obj;
}

/**
 * Check if object is a resolved integration (has id field)
 */
export function isResolvedIntegration(obj: unknown): obj is { id: string; alias?: string } {
  return typeof obj === 'object' && obj !== null && 'id' in obj && typeof obj.id === 'string';
}
