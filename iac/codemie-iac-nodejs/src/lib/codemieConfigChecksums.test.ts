/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { DatasourceResource, WorkflowResource, SkillResource } from '../types/codemieConfig';

import type { CompanionFile } from './skillCompanionFiles';

import {
  calculateDatasourceConfigChecksum,
  calculateWorkflowConfigChecksum,
  calculateSkillConfigChecksum,
  calculateCompanionFilesChecksum,
} from './codemieConfigChecksums';

function buildDatasource(): DatasourceResource {
  return {
    name: 'Repo DS',
    type: 'code',
    description: 'My repo',
    link: 'https://github.com/example/repo',
    branch: 'main',
    setting_id: 'setting-123',
  } as DatasourceResource;
}

function buildSkill(): SkillResource {
  return {
    name: 'My Skill',
    description: 'A perfectly fine description here',
    categories: ['dev'],
    visibility: 'public',
  };
}

function buildCompanionFiles(): CompanionFile[] {
  return [
    {
      path: 'reference.md',
      content: '# Reference',
      mime_type: 'text/markdown',
      encoding: 'text',
      size_bytes: 12,
    },
    {
      path: 'scripts/run.sh',
      content: '#!/bin/sh\necho hi',
      mime_type: 'text/x-sh',
      encoding: 'text',
      size_bytes: 18,
    },
  ];
}

function buildWorkflow(): WorkflowResource {
  return {
    name: 'WF',
    description: 'Test workflow',
    definition: 'workflows/wf.yaml',
    mode: 'Sequential',
    shared: true,
    icon_url: 'https://example.com/icon.png',
  } as WorkflowResource;
}

describe('codemieConfigChecksums', () => {
  describe('calculateDatasourceConfigChecksum', () => {
    it('should produce stable checksum for identical resources', () => {
      const ds1 = buildDatasource();
      const ds2 = buildDatasource();
      expect(calculateDatasourceConfigChecksum(ds1)).toBe(calculateDatasourceConfigChecksum(ds2));
    });

    it('should change checksum when a relevant field changes', () => {
      const ds1 = buildDatasource();
      const ds2 = { ...buildDatasource(), branch: 'develop' } as DatasourceResource;
      expect(calculateDatasourceConfigChecksum(ds1)).not.toBe(calculateDatasourceConfigChecksum(ds2));
    });

    it('should ignore force_reindex flag', () => {
      const ds1 = buildDatasource();
      const ds2 = { ...buildDatasource(), force_reindex: true } as DatasourceResource;
      expect(calculateDatasourceConfigChecksum(ds1)).toBe(calculateDatasourceConfigChecksum(ds2));
    });
  });

  describe('calculateSkillConfigChecksum', () => {
    it('should produce an identical checksum with and without source_dir, ignore_file, content and group', () => {
      const bare = buildSkill();
      const withExpansionFields: SkillResource = {
        ...bare,
        source_dir: 'skills-src',
        ignore_file: 'ignore.yaml',
        content: 'The expanded SKILL.md body',
        group: 'core',
      };

      expect(calculateSkillConfigChecksum(bare)).toBe(calculateSkillConfigChecksum(withExpansionFields));
    });

    it('should change checksum when a relevant field changes', () => {
      const s1 = buildSkill();
      const s2 = { ...buildSkill(), visibility: 'project' } as SkillResource;
      expect(calculateSkillConfigChecksum(s1)).not.toBe(calculateSkillConfigChecksum(s2));
    });
  });

  describe('calculateCompanionFilesChecksum', () => {
    it('should produce a stable aggregate checksum across two runs', () => {
      const result1 = calculateCompanionFilesChecksum(buildCompanionFiles());
      const result2 = calculateCompanionFilesChecksum(buildCompanionFiles());
      expect(result1.companionFilesChecksum).toBe(result2.companionFilesChecksum);
    });

    it('should be independent of input order', () => {
      const files = buildCompanionFiles();
      const reversed = [...files].reverse();
      const forward = calculateCompanionFilesChecksum(files);
      const backward = calculateCompanionFilesChecksum(reversed);
      expect(forward.companionFilesChecksum).toBe(backward.companionFilesChecksum);
    });

    it('should change the aggregate checksum when a file content changes', () => {
      const files = buildCompanionFiles();
      const changed = files.map((f) => (f.path === 'reference.md' ? { ...f, content: '# Reference v2' } : f));
      const before = calculateCompanionFilesChecksum(files);
      const after = calculateCompanionFilesChecksum(changed);
      expect(before.companionFilesChecksum).not.toBe(after.companionFilesChecksum);
    });

    it('should change the aggregate checksum when a file path changes', () => {
      const files = buildCompanionFiles();
      const changed = files.map((f) => (f.path === 'reference.md' ? { ...f, path: 'reference-renamed.md' } : f));
      const before = calculateCompanionFilesChecksum(files);
      const after = calculateCompanionFilesChecksum(changed);
      expect(before.companionFilesChecksum).not.toBe(after.companionFilesChecksum);
    });

    it('should change the aggregate checksum when a file metadata field changes', () => {
      const files = buildCompanionFiles();
      const changed = files.map((f) => (f.path === 'reference.md' ? { ...f, mime_type: 'text/plain' } : f));
      const before = calculateCompanionFilesChecksum(files);
      const after = calculateCompanionFilesChecksum(changed);
      expect(before.companionFilesChecksum).not.toBe(after.companionFilesChecksum);
    });

    it('should map every path to a content hash and never contain file bodies', () => {
      const files = buildCompanionFiles();
      const { companionFileHashes } = calculateCompanionFilesChecksum(files);

      expect(Object.keys(companionFileHashes).sort()).toEqual(['reference.md', 'scripts/run.sh']);
      for (const file of files) {
        const hash = companionFileHashes[file.path];
        expect(hash).toBeDefined();
        expect(hash).not.toBe(file.content);
        expect(hash).not.toContain(file.content);
      }

      const serialized = JSON.stringify(companionFileHashes);
      for (const file of files) {
        expect(serialized).not.toContain(file.content);
      }
    });
  });

  describe('calculateWorkflowConfigChecksum', () => {
    it('should produce stable checksum for identical resources', () => {
      const w1 = buildWorkflow();
      const w2 = buildWorkflow();
      expect(calculateWorkflowConfigChecksum(w1)).toBe(calculateWorkflowConfigChecksum(w2));
    });

    it('should change checksum when a field changes', () => {
      const w1 = buildWorkflow();
      const w2 = { ...buildWorkflow(), mode: 'Autonomous' } as WorkflowResource;
      expect(calculateWorkflowConfigChecksum(w1)).not.toBe(calculateWorkflowConfigChecksum(w2));
    });

    it('should handle missing optional fields gracefully', () => {
      const w1 = { ...buildWorkflow(), icon_url: undefined } as WorkflowResource;
      const w2 = { ...buildWorkflow(), icon_url: undefined } as WorkflowResource;
      expect(calculateWorkflowConfigChecksum(w1)).toBe(calculateWorkflowConfigChecksum(w2));
    });
  });
});
