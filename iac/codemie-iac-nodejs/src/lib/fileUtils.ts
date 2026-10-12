/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const BYTES_IN_GB = 1024 ** 3;

const SKILL_MD_FILENAME = 'SKILL.md';

/**
 * Sanitize a name for use as a filename
 * Converts to lowercase, replaces non-alphanumeric with hyphens, trims hyphens
 * Prevents path traversal attacks by converting path separators to hyphens
 *
 * @throws Error if result is empty (would create hidden/invalid file)
 * @example
 * sanitizeFileName("My Assistant Name!") // "my-assistant-name"
 * sanitizeFileName("Git-Server") // "git-server"
 * sanitizeFileName("../../../etc/passwd") // "etc-passwd"
 */
export function sanitizeFileName(name: string, maxLength: number = 255): string {
  // Replace path separators with hyphens (before sanitization)
  const nameWithHyphens = name.replaceAll(/[/\\]/g, '-');

  const sanitized = nameWithHyphens
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') // trim leading/trailing dashes
    .slice(0, maxLength); // limit length

  if (!sanitized) {
    throw new Error(`Sanitized filename is empty for input: "${name}"`);
  }

  return sanitized;
}

/**
 * The one on-disk base name every skill path is derived from — the backup writer, the resource
 * YAML the backup generates, and the import writer all go through these three helpers, so the
 * path in the YAML is always the path that was actually written. Deriving it twice is what made
 * `C++ Helper` land in `skills/c-helper/` while its YAML pointed at `skills/c++-helper/`.
 */
export function skillFileBaseName(name: string): string {
  return sanitizeFileName(name);
}

/** `skills/<base>` — the directory of a skill that ships companion files. */
export function skillDirRelativePath(name: string): string {
  return `skills/${skillFileBaseName(name)}`;
}

/** `skills/<base>.skill.md` — the flat single-file layout of a skill with no companion files. */
export function skillFlatFileRelativePath(name: string): string {
  return `skills/${skillFileBaseName(name)}.skill.md`;
}

/** `skills/<base>/SKILL.md` — the markdown of a skill that ships companion files. */
export function skillMarkdownRelativePath(name: string): string {
  return `${skillDirRelativePath(name)}/${SKILL_MD_FILENAME}`;
}

/**
 * Resolve a platform-provided relative path against a directory we own and refuse anything that
 * does not land strictly inside it. Companion file paths arrive from the platform, and
 * `path.join` happily honours a `../../x` that would write outside the skill directory (and
 * `ensureDirectoryExists` would create the parents for it). Absolute paths are refused too
 * rather than silently nested, so the caller never writes to a path it did not derive itself.
 *
 * @throws Error naming the offending path when it resolves outside `baseDir`
 */
export function resolvePathWithinDirectory(baseDir: string, candidatePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, candidatePath);

  if (!resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Refusing to write "${candidatePath}": it resolves to "${resolved}", outside "${resolvedBase}"`);
  }

  return resolved;
}

/**
 * Generate MCP configuration filename
 *
 * @example
 * generateMcpFileName("My Assistant", "Playwright") // "my-assistant_playwright.json"
 */
export function generateMcpFileName(assistantName: string, mcpName: string): string {
  return `${sanitizeFileName(assistantName)}_${sanitizeFileName(mcpName)}.json`;
}

/**
 * Generate unique filename to avoid collisions
 * Adds numeric suffix if file already exists
 *
 * @example
 * // If "spec.yaml" exists:
 * generateUniqueFileName("/backup", "spec", ".yaml") // "spec-1.yaml"
 */
export function generateUniqueFileName(baseDir: string, baseName: string, extension: string): string {
  let counter = 0;
  let fileName = `${baseName}${extension}`;

  while (fs.existsSync(path.join(baseDir, fileName))) {
    counter++;
    fileName = `${baseName}-${counter}${extension}`;
  }

  return fileName;
}

/**
 * Validate backup directory is writable and has sufficient disk space
 *
 * @throws Error if directory not writable or insufficient disk space
 */
export function validateBackupDirectory(backupDir: string, minSpaceGB: number = 1): void {
  try {
    // Check parent directory is writable
    const parentDir = path.dirname(backupDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Test write access
    const testFile = path.join(parentDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    // Check available disk space (requires node 20+)
    try {
      const stats = fs.statfsSync(parentDir);
      const availableGB = (stats.bavail * stats.bsize) / BYTES_IN_GB;
      if (availableGB < minSpaceGB) {
        throw new Error(`Insufficient disk space: ${availableGB.toFixed(2)}GB available, need ${minSpaceGB}GB`);
      }
    } catch (error) {
      // statfsSync not available in older Node versions - skip check
      if ((error as NodeJS.ErrnoException).code !== 'ERR_METHOD_NOT_SUPPORTED') {
        throw error;
      }
    }
  } catch (error) {
    throw new Error(`Cannot write to backup directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Atomically move directory from temp to final location
 * Ensures all-or-nothing semantics
 * Uses fs.renameSync directly to avoid TOCTOU race condition
 */
export function moveAtomically(tempPath: string, finalPath: string): void {
  try {
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      throw new Error(`Destination already exists: ${finalPath}`);
    }
    throw error;
  }
}

/**
 * Clean up directory if it exists
 */
export function cleanupDirectory(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Ensure directory exists for a file path, create if needed (including parent directories)
 * Useful before writing files to ensure parent directories exist
 *
 * @example
 * ensureDirectoryExists('/path/to/file.txt') // Creates /path/to/ if missing
 */
export function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
