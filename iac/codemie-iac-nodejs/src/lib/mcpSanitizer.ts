/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

/** True for a non-null, non-array object — the only shape the sanitizer recurses into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeObject(obj: Record<string, unknown>, isTopLevel: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }
    // YAML/configuration hygiene: an empty connect URL carries no information.
    if (isTopLevel && key === 'mcp_connect_url' && value === '') {
      continue;
    }
    // Arrays pass through by reference: contents are never inspected or rewritten.
    result[key] = isPlainObject(value) ? sanitizeObject(value, false) : value;
  }

  return result;
}

/**
 * Return a sanitized copy of one MCP server: null/undefined keys removed at every
 * object depth, array contents untouched, falsy values (false, 0, '') preserved,
 * and an empty top-level mcp_connect_url dropped. Never mutates its input.
 *
 * A non-plain-object input (null, a primitive, an array) is returned unchanged:
 * hand-authored YAML can carry `mcp_servers: [null]` or a bare scalar entry, and the
 * checksum path reaches this function with no shape validation in between.
 *
 * @param server - One MCP server in any of its representations (IaC, SDK or raw API)
 * @returns A new object of the same type, with the rules above applied
 */
export function sanitizeMcpServer<T>(server: T): T {
  if (!isPlainObject(server)) {
    return server;
  }

  return sanitizeObject(server, true) as T;
}
