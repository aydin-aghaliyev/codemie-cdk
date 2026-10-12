/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SkillResource, SkillState } from '../types/codemieConfig';

import { logger } from './logger';

const SKILL_MD_FILENAME = 'SKILL.md';
const EXCLUDE_FILE_NAME = '.codemie-exclude';

/** Directory names that are never descended into, regardless of any .codemie-exclude pattern. */
const ALWAYS_SKIPPED_DIRS = new Set(['node_modules', '.git', 'evals']);

/** Well-known lockfile basenames that are never treated as companion files. */
const ALWAYS_SKIPPED_LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
]);

/** In-repo MIME lookup by lower-cased file extension. Unknown extensions fall back to this. */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/plain',
  '.py': 'text/x-python',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.sh': 'text/x-sh',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export interface CompanionFile {
  path: string; // skill-relative POSIX path
  content: string; // text as-is, binary base64-encoded
  mime_type: string;
  encoding: 'text' | 'base64';
  size_bytes: number;
}

/**
 * True when `skill.file` points at a `SKILL.md` — the layout that ships companion files
 * alongside the skill's own markdown, whether the skill came from an expanded source_dir,
 * was hand-written to point at a SKILL.md, or was restored from a backup. Safe for a
 * `content`-only skill with no `file` at all.
 */
export function hasCompanionFileLayout(skill: SkillResource): boolean {
  if (!skill.file) {
    return false;
  }
  return path.basename(skill.file) === SKILL_MD_FILENAME;
}

/**
 * Index every `{` and `}` in a pattern that has a partner, so alternation is only honoured for a
 * genuinely balanced pair. A brace left over — `a{b`, `a}b`, a lone `{` — is a typo in a
 * hand-written `.codemie-exclude`, and translating it into `(?:` or `)` anyway produced an
 * invalid regex that threw `Unterminated group` for every path tested.
 */
function findBalancedBraceIndices(pattern: string): Set<number> {
  const openIndices: number[] = [];
  const balanced = new Set<number>();

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '{') {
      openIndices.push(i);
      continue;
    }
    if (pattern[i] === '}') {
      const openIndex = openIndices.pop();
      if (openIndex !== undefined) {
        balanced.add(openIndex);
        balanced.add(i);
      }
    }
  }

  return balanced;
}

/** True when the pattern carries a `{` or `}` with no partner — reported to the user as a warning. */
export function hasUnbalancedBraces(pattern: string): boolean {
  const balanced = findBalancedBraceIndices(pattern);

  for (let i = 0; i < pattern.length; i++) {
    if ((pattern[i] === '{' || pattern[i] === '}') && !balanced.has(i)) {
      return true;
    }
  }

  return false;
}

/**
 * Translate one `.codemie-exclude` glob pattern into a regular expression source fragment.
 * Supported syntax: `**` crosses `/`, `*` does not, `?` matches exactly one character, and
 * `{a,b}` is alternation. Every other regex metacharacter is escaped so it matches literally,
 * including an unbalanced brace — a malformed pattern matches that brace as a literal character
 * rather than producing an invalid regex.
 */
function translatePatternToRegexSource(pattern: string): string {
  const balancedBraces = findBalancedBraceIndices(pattern);
  let source = '';
  let braceDepth = 0;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i++;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '{') {
      if (!balancedBraces.has(i)) {
        source += '\\{';
        continue;
      }
      braceDepth++;
      source += '(?:';
      continue;
    }
    if (char === '}') {
      if (!balancedBraces.has(i)) {
        source += '\\}';
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      source += ')';
      continue;
    }
    if (char === ',' && braceDepth > 0) {
      source += '|';
      continue;
    }
    if (/[.+^$()|[\]\\]/.test(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }

  return source;
}

/**
 * Match a skill-relative POSIX path against one `.codemie-exclude` pattern. A pattern
 * containing `/` matches that exact path or anything beneath it as a directory prefix.
 * A pattern with no `/` matches the path's basename at any depth.
 */
export function matchesExcludePattern(relPath: string, pattern: string): boolean {
  // A trailing slash explicitly marks a directory prefix: everything beneath it matches,
  // even when the part before the slash contains no other '/' of its own.
  const isDirectoryPrefix = pattern.endsWith('/');
  const normalizedPattern = isDirectoryPrefix ? pattern.slice(0, -1) : pattern;
  const source = translatePatternToRegexSource(normalizedPattern);

  if (isDirectoryPrefix) {
    const regex = new RegExp(`^${source}/.*$`);
    return regex.test(relPath);
  }

  if (normalizedPattern.includes('/')) {
    const regex = new RegExp(`^${source}(?:/.*)?$`);
    return regex.test(relPath);
  }

  const regex = new RegExp(`^${source}$`);
  const segments = relPath.split('/');
  const basename = segments[segments.length - 1];
  return regex.test(basename);
}

function readExcludePatterns(skillDir: string): string[] {
  const excludePath = path.join(skillDir, EXCLUDE_FILE_NAME);
  if (!fs.existsSync(excludePath)) {
    return [];
  }

  const raw = fs.readFileSync(excludePath, 'utf8');
  const patterns = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  // Name the file and the pattern rather than letting a regex internal surface later: the brace
  // still matches literally, so the walk carries on with the pattern as written.
  for (const pattern of patterns) {
    if (hasUnbalancedBraces(pattern)) {
      logger.warn(
        `     ⚠️  Unbalanced brace in exclude pattern "${pattern}" (${excludePath}) — ` +
          `the brace is matched as a literal character. Use {a,b} for alternation.`
      );
    }
  }

  return patterns;
}

/**
 * Decide whether content must travel base64 rather than as text.
 *
 * Content counts as text only when it survives a full UTF-8 round trip unchanged: decoding to a
 * string and re-encoding reproduces the original bytes exactly. Anything else — a legacy
 * single-byte encoding such as Windows-1252, a truncated multi-byte sequence, a compiled binary —
 * would otherwise have its invalid sequences silently replaced with U+FFFD by `toString('utf8')`
 * and reach the platform corrupted. The round trip covers the whole buffer, not a sampled prefix.
 *
 * A NUL byte is a valid UTF-8 code point, so the round trip alone would call such content text;
 * the explicit whole-buffer NUL scan keeps the classic binary signal decisive and doubles as a
 * cheap early exit.
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }
  return !Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

function toPosixPath(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

function buildCompanionFile(absPath: string, relPath: string): CompanionFile {
  const buffer = fs.readFileSync(absPath);
  const binary = isBinaryBuffer(buffer);
  const ext = path.extname(relPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;

  return {
    path: relPath,
    content: binary ? buffer.toString('base64') : buffer.toString('utf8'),
    mime_type: mimeType,
    encoding: binary ? 'base64' : 'text',
    size_bytes: buffer.length,
  };
}

function walk(currentDir: string, skillDir: string, excludePatterns: string[], results: CompanionFile[]): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);
    const relPath = toPosixPath(path.relative(skillDir, absPath));

    // Never follow a symlink: a directory symlink cycle could otherwise hang the walk.
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (ALWAYS_SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
      // Test the directory both bare and with a trailing slash so a `vendor/` or `vendor/**`
      // pattern prunes the whole subtree instead of re-excluding each file inside it.
      const directoryCandidates = [relPath, `${relPath}/`];
      if (excludePatterns.some((pattern) => directoryCandidates.some((cand) => matchesExcludePattern(cand, pattern)))) {
        continue;
      }
      walk(absPath, skillDir, excludePatterns, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === SKILL_MD_FILENAME || entry.name === EXCLUDE_FILE_NAME) {
      continue;
    }
    if (ALWAYS_SKIPPED_LOCKFILES.has(entry.name)) {
      continue;
    }
    if (excludePatterns.some((pattern) => matchesExcludePattern(relPath, pattern))) {
      continue;
    }

    results.push(buildCompanionFile(absPath, relPath));
  }
}

/**
 * Recursively collect every companion file beneath a skill's directory (an absolute path),
 * skipping SKILL.md, .codemie-exclude, node_modules, .git, evals and well-known lockfiles
 * before applying any .codemie-exclude patterns found in that same directory. The result is
 * sorted by path so it is deterministic regardless of directory walk order. Lazy: nothing
 * here is cached or stashed on a config object — callers invoke it only when they need it.
 */
export function collectCompanionFiles(skillDir: string): CompanionFile[] {
  const excludePatterns = readExcludePatterns(skillDir);
  const results: CompanionFile[] = [];

  walk(skillDir, skillDir, excludePatterns, results);

  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return results;
}

/**
 * True when a state entry's companion file hashes record at least one file. Exported so
 * `previewSkills` (src/lib/previewUtils.ts) can mirror the exact same three-way companion-file
 * change detection deploy uses, rather than keeping a second copy of this predicate.
 */
export function stateHasCompanionFiles(existingState: SkillState | undefined): boolean {
  return Object.keys(existingState?.companionFileHashes ?? {}).length > 0;
}
