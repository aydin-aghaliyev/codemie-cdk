/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'yaml';

import { namesEqual } from './nameUtils';

/**
 * Type guard to check if value is a plain object (not array, not null)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve $import directives recursively
 * Automatically handles:
 * 1. Single resource import (object)
 * 2. Multiple resources import (array)
 * 3. Mixed inline + imports
 * Includes circular import detection to prevent infinite recursion
 */
export function resolveImports(obj: unknown, baseDir: string, visitedFiles: Set<string> = new Set()): void {
  if (!isPlainObject(obj)) {
    return;
  }

  for (const key in obj) {
    const value = obj[key];

    // Case 1: Object with $import field - replace entire object
    // { $import: "path/to/file.yaml" }
    if (isPlainObject(value) && '$import' in value) {
      const importDirective = value as { $import: string };
      const importPath = path.join(baseDir, importDirective.$import);

      // Normalize path for circular detection
      const normalizedPath = path.resolve(importPath);

      // Check for circular import
      if (visitedFiles.has(normalizedPath)) {
        throw new Error(
          `Circular import detected: ${normalizedPath}\nImport chain: ${[...visitedFiles].join(' → ')} → ${normalizedPath}`
        );
      }

      // Mark file as visited
      visitedFiles.add(normalizedPath);

      const imported = loadYamlFile(importPath);
      obj[key] = imported;

      // Recursively resolve imports in loaded content
      resolveImports(obj[key], path.dirname(importPath), visitedFiles);

      // Remove from visited after processing (allows same file in different branches)
      visitedFiles.delete(normalizedPath);
    }
    // Case 2: Array with imports - intelligently flatten
    // [inline, { $import: "..." }, { $import: "..." }]
    else if (Array.isArray(value)) {
      obj[key] = resolveArrayImports(value, baseDir, visitedFiles);
    }
    // Case 3: Nested object - recurse
    else if (isPlainObject(value)) {
      resolveImports(value, baseDir, visitedFiles);
    }
  }
}

/**
 * Resolve imports in arrays
 * Intelligently handles:
 * - Inline objects (keep as-is)
 * - $import with single object (add to array)
 * - $import with array (flatten into parent array)
 * Includes circular import detection
 */
export function resolveArrayImports(arr: unknown[], baseDir: string, visitedFiles: Set<string> = new Set()): unknown[] {
  const result: unknown[] = [];

  for (const item of arr) {
    // Import directive: { $import: "path/to/file.yaml" }
    if (isPlainObject(item) && '$import' in item) {
      const importDirective = item as { $import: string };
      const importPath = path.join(baseDir, importDirective.$import);

      // Normalize path for circular detection
      const normalizedPath = path.resolve(importPath);

      // Check for circular import
      if (visitedFiles.has(normalizedPath)) {
        throw new Error(
          `Circular import detected: ${normalizedPath}\n` +
            `Import chain: ${[...visitedFiles].join(' → ')} → ${normalizedPath}`
        );
      }

      // Mark file as visited
      visitedFiles.add(normalizedPath);

      const imported = loadYamlFile(importPath);

      // Case A: Imported file contains an array → flatten it recursively
      // configs/datasources/all-repos.yaml: [{ name: r1 }, { name: r2 }]
      if (Array.isArray(imported)) {
        // Recursively resolve imports in the imported array
        const resolvedArray = resolveArrayImports(imported, path.dirname(importPath), visitedFiles);
        // Add all resolved items to result
        for (const resolvedItem of resolvedArray) {
          result.push(resolvedItem);
        }
      }
      // Case B: Imported file contains a single object → add it
      // configs/datasources/jira-kb.yaml: { name: jira-kb, type: ... }
      else if (isPlainObject(imported)) {
        result.push(imported);
        resolveImports(imported, path.dirname(importPath), visitedFiles);
      }
      // Case C: Unexpected type (primitive, null, etc.)
      else {
        throw new TypeError(
          `Import file ${importPath} must contain either an object or an array. ` + `Got: ${typeof imported}`
        );
      }

      // Remove from visited after processing (allows same file in different branches)
      visitedFiles.delete(normalizedPath);
    }
    // Regular inline item (not an import)
    else {
      result.push(item);

      // If inline item is an object, resolve nested imports
      if (isPlainObject(item)) {
        resolveImports(item, baseDir, visitedFiles);
      }
    }
  }

  return result;
}

/**
 * Load YAML file with error handling
 */
export function loadYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Import file not found: ${filePath}`);
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = yaml.parse(content);

    // Handle empty files
    if (parsed === null || parsed === undefined) {
      throw new TypeError(`Import file ${filePath} is empty`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`Failed to parse YAML file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Provenance of a named resource: which file defines it, the raw (unresolved) resource
 * object as parsed from YAML, and whether it lives as an item inside a YAML sequence.
 *
 * `file` is an absolute filesystem path to the defining YAML file, or `null` when the
 * resource is defined inline in `codemie.yaml` itself (not reached through any `$import`).
 * `inList: true` means the resource is one item of a YAML sequence (either the top-level
 * `resources.<plural>` array in `codemie.yaml`, or an array inside an imported file);
 * `inList: false` means the resource is the entire top-level document of `file` (a
 * single-resource import file).
 */
export interface ResourceDefinition {
  file: string | null;
  resource: Record<string, unknown>;
  inList: boolean;
}

/**
 * Find which file defines a named resource in `resources.<plural>`, following `$import`
 * directives (including nested ones, and imports that resolve to a list file) to locate it.
 *
 * Walks the raw (unresolved) YAML structure directly via `loadYamlFile` rather than the
 * fully-resolved config, so it can report exactly which file/list holds the definition.
 * Uses the same `visitedFiles` circular-import discipline as `resolveImports`: normalize
 * with `path.resolve`, add immediately before recursing, delete immediately after — so a
 * genuine cycle throws `Circular import detected: ...` instead of recursing forever, while
 * the same file may still be reached from two sibling branches without a false positive.
 */
export function findResourceDefinition(
  rootDir: string,
  codemieConfigPath: string,
  plural: string,
  name: string
): ResourceDefinition | undefined {
  const configPath = path.join(rootDir, codemieConfigPath);
  const config = loadYamlFile(configPath);

  if (!isPlainObject(config) || !isPlainObject(config.resources)) {
    return undefined;
  }

  const list = config.resources[plural];
  if (!Array.isArray(list)) {
    return undefined;
  }

  return findResourceInList(list, rootDir, null, name, new Set<string>());
}

/**
 * Search one YAML sequence (either the top-level `resources.<plural>` array, or the
 * contents of an imported file) for a resource matching `name`, following any `$import`
 * items found along the way.
 *
 * @param items - the sequence to search
 * @param baseDir - directory that relative `$import` paths in `items` resolve against
 * @param currentFile - absolute path to attribute to an inline match found directly in
 *   `items` (`null` when `items` is the top-level `resources.<plural>` array in `codemie.yaml`)
 */
function findResourceInList(
  items: unknown[],
  baseDir: string,
  currentFile: string | null,
  name: string,
  visitedFiles: Set<string>
): ResourceDefinition | undefined {
  for (const item of items) {
    if (!isPlainObject(item)) {
      continue;
    }

    if (typeof item.$import === 'string') {
      const importPath = path.join(baseDir, item.$import);
      const normalizedPath = path.resolve(importPath);

      if (visitedFiles.has(normalizedPath)) {
        throw new Error(
          `Circular import detected: ${normalizedPath}\n` +
            `Import chain: ${[...visitedFiles].join(' → ')} → ${normalizedPath}`
        );
      }

      visitedFiles.add(normalizedPath);
      const loaded = loadYamlFile(importPath);

      let found: ResourceDefinition | undefined;
      if (Array.isArray(loaded)) {
        found = findResourceInList(loaded, path.dirname(importPath), normalizedPath, name, visitedFiles);
      } else if (isPlainObject(loaded) && typeof loaded.name === 'string' && namesEqual(loaded.name, name)) {
        found = { file: normalizedPath, resource: loaded, inList: false };
      }

      visitedFiles.delete(normalizedPath);

      if (found) {
        return found;
      }
      continue;
    }

    if (typeof item.name === 'string' && namesEqual(item.name, name)) {
      return { file: currentFile, resource: item, inList: true };
    }
  }

  return undefined;
}
