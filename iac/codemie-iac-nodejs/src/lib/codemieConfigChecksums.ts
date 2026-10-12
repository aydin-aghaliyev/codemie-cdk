/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
/*
 * Helper functions for computing configuration checksums for non-assistant resources.
 * Centralizes logic previously duplicated across apply/preview/backup.
 */
import type { DatasourceResource, WorkflowResource, SkillResource } from '../types/codemieConfig';

import { calculateChecksum } from './checksumUtils';
import type { CompanionFile } from './skillCompanionFiles';

/**
 * Calculate checksum of datasource configuration (excluding deploy-time only flags like force_reindex).
 * Stable ordering achieved by building a plain object literal.
 */
// Build a stable JSON string of the datasource excluding deployment-only or transient fields.
// We intentionally exclude force_reindex ($ref is considered part of config inheritance, so keep or drop based on needs).

// Typed exclude sets to prevent accidental addition of non-existent fields
function createExcludeSet<T extends object, K extends keyof T = keyof T>(keys: readonly K[]): ReadonlySet<K> {
  return new Set<K>(keys);
}

// Only fields that exist on the respective resource interfaces can be listed here
const DATASOURCE_EXCLUDED_FIELDS = createExcludeSet<DatasourceResource>(['force_reindex']);
const WORKFLOW_EXCLUDED_FIELDS = createExcludeSet<WorkflowResource>(['definition']);
const SKILL_EXCLUDED_FIELDS = createExcludeSet<SkillResource>([
  'file',
  'source_dir',
  'ignore_file',
  'content',
  'group',
]);

function buildChecksumObject(src: object, excluded: ReadonlySet<PropertyKey>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(src).sort(); // deterministic ordering
  for (const key of keys) {
    if (excluded.has(key)) {
      continue;
    }
    const value = (src as unknown as { [k: string]: unknown })[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function calculateDatasourceConfigChecksum(datasource: DatasourceResource): string {
  const filtered = buildChecksumObject(datasource, DATASOURCE_EXCLUDED_FIELDS);
  return calculateChecksum(JSON.stringify(filtered));
}

/**
 * Calculate checksum of workflow metadata (not including YAML content itself).
 * YAML content checksum remains separate (workflowYamlChecksum).
 */
export function calculateWorkflowConfigChecksum(workflow: WorkflowResource): string {
  const filtered = buildChecksumObject(workflow, WORKFLOW_EXCLUDED_FIELDS);
  return calculateChecksum(JSON.stringify(filtered));
}

/**
 * Calculate checksum of skill configuration (excluding the file path itself).
 * The content checksum is tracked separately (contentChecksum).
 */
export function calculateSkillConfigChecksum(skill: SkillResource): string {
  const filtered = buildChecksumObject(skill, SKILL_EXCLUDED_FIELDS);
  return calculateChecksum(JSON.stringify(filtered));
}

/**
 * Calculate a change-detection checksum for a skill's companion files.
 *
 * Per-file content is hashed first (`companionFileHashes`), never stored raw. The aggregate
 * `companionFilesChecksum` then hashes each file's (path, mime_type, encoding, size_bytes,
 * contentHash) — metadata plus content HASH, never the raw content itself — sorted by path so
 * the result does not depend on input order.
 */
export function calculateCompanionFilesChecksum(files: CompanionFile[]): {
  companionFilesChecksum: string;
  companionFileHashes: Record<string, string>;
} {
  const sortedFiles = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const companionFileHashes: Record<string, string> = {};
  for (const file of sortedFiles) {
    companionFileHashes[file.path] = calculateChecksum(file.content);
  }

  const aggregateEntries = sortedFiles.map((file) => ({
    path: file.path,
    mime_type: file.mime_type,
    encoding: file.encoding,
    size_bytes: file.size_bytes,
    contentHash: companionFileHashes[file.path],
  }));

  const companionFilesChecksum = calculateChecksum(JSON.stringify(aggregateEntries));

  return { companionFilesChecksum, companionFileHashes };
}
