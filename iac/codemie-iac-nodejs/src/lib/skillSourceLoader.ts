/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'yaml';

import type { SkillResource } from '../types/codemieConfig';

import { validateSkillDescriptions } from './validationUtils';

const SKILL_MD_FILENAME = 'SKILL.md';

/** kebab-case, 3-64 characters, starting and ending with a letter or digit. */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const BOM = '﻿';

/** Front matter delimited by `---` at the very start of the file (BOM and CRLF tolerant). */
const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === BOM.charCodeAt(0) ? raw.slice(1) : raw;
}

/**
 * Parse a SKILL.md file's optional YAML front matter and return it together with the
 * untouched body. Absent front matter is not an error: it just means an empty front
 * matter object and a body equal to the (BOM-stripped) input.
 */
export function parseSkillFrontMatter(
  raw: string,
  sourcePath: string = SKILL_MD_FILENAME
): {
  frontMatter: Record<string, unknown>;
  body: string;
} {
  const content = stripBom(raw);
  const match = content.match(FRONT_MATTER_PATTERN);

  if (!match) {
    return { frontMatter: {}, body: content };
  }

  const [, yamlBlock, body] = match;

  // A hand-authored front matter block is user input: name the file rather than letting the
  // raw yaml parser exception surface, the same way the missing-source_dir error names its path.
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlBlock);
  } catch (error) {
    throw new Error(
      `Invalid YAML front matter in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const frontMatter = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};

  return { frontMatter, body };
}

function readIgnoreSet(rootDir: string, ignoreFile: string | undefined, sourceDir: string): Set<string> {
  if (!ignoreFile) {
    return new Set();
  }

  const resolvedIgnorePath = path.join(rootDir, ignoreFile);

  if (!fs.existsSync(resolvedIgnorePath)) {
    throw new Error(
      `Skill ignore file not found: ${resolvedIgnorePath} ` +
        `(from ignore_file "${ignoreFile}" in source_dir "${sourceDir}")`
    );
  }

  let parsed: { skills?: string[] } | null;
  try {
    const content = fs.readFileSync(resolvedIgnorePath, 'utf8');
    parsed = yaml.parse(content) as { skills?: string[] } | null;
  } catch (error) {
    throw new Error(
      `Invalid YAML in skill ignore file ${resolvedIgnorePath} (from source_dir "${sourceDir}"): ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }

  return new Set(parsed?.skills ?? []);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Where one expanded or hand-written skill resource came from, for duplicate-name errors. */
interface SkillOrigin {
  resource: SkillResource;
  origin: string;
}

/**
 * Expand a single `source_dir` config entry into one skill resource per immediate
 * subdirectory that directly contains a SKILL.md file. Description lengths are NOT checked
 * here: `expandSkillSourceDirs` validates across every entry so one run reports the bad
 * descriptions of all `source_dir` entries at once, not just the first one's.
 */
function expandOneSourceDir(entry: SkillResource, rootDir: string): SkillOrigin[] {
  const sourceDir = entry.source_dir as string;
  const resolvedSourceDir = path.join(rootDir, sourceDir);

  if (!fs.existsSync(resolvedSourceDir) || !fs.statSync(resolvedSourceDir).isDirectory()) {
    throw new Error(`Skill source directory not found: ${resolvedSourceDir} (from source_dir "${sourceDir}")`);
  }

  const ignoreSet = readIgnoreSet(rootDir, entry.ignore_file, sourceDir);

  const dirNames = fs
    .readdirSync(resolvedSourceDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((dirName) => !ignoreSet.has(dirName))
    .sort();

  const expanded: SkillOrigin[] = [];

  for (const dirName of dirNames) {
    const skillMdPath = path.join(resolvedSourceDir, dirName, SKILL_MD_FILENAME);

    if (!fs.existsSync(skillMdPath)) {
      continue;
    }

    const raw = fs.readFileSync(skillMdPath, 'utf8');
    const { frontMatter, body } = parseSkillFrontMatter(raw, skillMdPath);

    const name = stringOrUndefined(frontMatter.name) ?? dirName;
    const description = stringOrUndefined(frontMatter.description);

    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new Error(
        `❌ Skill "${name}" (from directory "${dirName}" in source_dir "${sourceDir}") has an invalid name\n` +
          `   💡 Names must be kebab-case, 3-64 characters, and start and end with a letter or digit`
      );
    }

    const resource: SkillResource = {
      name,
      description: description ?? '',
      file: path.join(sourceDir, dirName, SKILL_MD_FILENAME),
      content: body,
      ...(entry.categories !== undefined ? { categories: entry.categories } : {}),
      ...(entry.visibility !== undefined ? { visibility: entry.visibility } : {}),
      ...(entry.group !== undefined ? { group: entry.group } : {}),
    };

    expanded.push({ resource, origin: `directory "${dirName}" in source_dir "${sourceDir}"` });
  }

  return expanded;
}

/**
 * Expand every `source_dir` entry in `skills` into its member skill resources. Entries
 * without `source_dir` pass through untouched. Pure with respect to the input array: a
 * new array is always returned and the input is never mutated.
 */
export function expandSkillSourceDirs(skills: SkillResource[], rootDir: string): SkillResource[] {
  const collected: SkillOrigin[] = [];

  const descriptionErrors: string[] = [];

  for (const skill of skills) {
    if (!skill.source_dir) {
      collected.push({ resource: skill, origin: `hand-written entry "${skill.name}"` });
      continue;
    }

    const expanded = expandOneSourceDir(skill, rootDir);
    // Collected rather than thrown per directory: with two bad source_dir entries the user would
    // otherwise only ever see the first one's errors, and loadConfig throws before validateFiles
    // gets a chance to report the rest.
    descriptionErrors.push(...validateSkillDescriptions(expanded.map((item) => item.resource)));
    collected.push(...expanded);
  }

  if (descriptionErrors.length > 0) {
    throw new Error(descriptionErrors.join('\n\n'));
  }

  // Skills are keyed by name throughout deploy and state.json, so two resources sharing one
  // name would silently collapse onto a single platform skill and a single state slot.
  const originByName = new Map<string, string>();
  for (const { resource, origin } of collected) {
    const key = resource.name.toLowerCase();
    const previousOrigin = originByName.get(key);

    if (previousOrigin !== undefined) {
      throw new Error(
        `❌ Duplicate skill name "${resource.name}": defined by ${previousOrigin} and ${origin}\n` +
          `   💡 Skill names must be unique across every source_dir and hand-written entry`
      );
    }

    originByName.set(key, origin);
  }

  return collected.map((item) => item.resource);
}
