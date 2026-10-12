/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { findResourceDefinition, loadYamlFile, resolveArrayImports, resolveImports } from './configImports';

describe('configImports', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-imports-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveImports', () => {
    it('replaces a single-object $import with the loaded file contents', () => {
      fs.writeFileSync(path.join(tempDir, 'repo.yaml'), 'name: repo-1\ntype: code\n');

      const obj: Record<string, unknown> = {
        datasource: { $import: 'repo.yaml' },
      };

      resolveImports(obj, tempDir);

      expect(obj.datasource).toEqual({ name: 'repo-1', type: 'code' });
    });

    it('recursively resolves imports found inside nested objects', () => {
      fs.mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'nested', 'inner.yaml'), 'name: inner-resource\n');

      const obj: Record<string, unknown> = {
        outer: {
          inner: { $import: 'nested/inner.yaml' },
        },
      };

      resolveImports(obj, tempDir);

      expect(obj).toEqual({
        outer: {
          inner: { name: 'inner-resource' },
        },
      });
    });

    it('throws Circular import detected with the import chain when a file re-imports itself', () => {
      // file-a.yaml -> file-b.yaml -> file-a.yaml (circular)
      fs.writeFileSync(path.join(tempDir, 'file-a.yaml'), 'next:\n  $import: file-b.yaml\n');
      fs.writeFileSync(path.join(tempDir, 'file-b.yaml'), 'next:\n  $import: file-a.yaml\n');

      const fileA = path.resolve(path.join(tempDir, 'file-a.yaml'));
      const fileB = path.resolve(path.join(tempDir, 'file-b.yaml'));

      const makeObj = (): Record<string, unknown> => ({ items: { $import: 'file-a.yaml' } });

      expect(() => resolveImports(makeObj(), tempDir)).toThrow('Circular import detected');
      expect(() => resolveImports(makeObj(), tempDir)).toThrow(`Import chain: ${fileA} → ${fileB} → ${fileA}`);
    });

    it('allows the same file to be imported from two sibling branches without throwing', () => {
      fs.writeFileSync(path.join(tempDir, 'shared.yaml'), 'name: shared-resource\n');

      const obj: Record<string, unknown> = {
        branchA: { $import: 'shared.yaml' },
        branchB: { $import: 'shared.yaml' },
      };

      expect(() => resolveImports(obj, tempDir)).not.toThrow();
      expect(obj.branchA).toEqual({ name: 'shared-resource' });
      expect(obj.branchB).toEqual({ name: 'shared-resource' });
    });
  });

  describe('resolveArrayImports', () => {
    it('flattens an imported array into the parent array', () => {
      fs.writeFileSync(path.join(tempDir, 'all-repos.yaml'), '- name: repo-1\n- name: repo-2\n');

      const result = resolveArrayImports([{ $import: 'all-repos.yaml' }], tempDir);

      expect(result).toEqual([{ name: 'repo-1' }, { name: 'repo-2' }]);
    });

    it('resolves nested $import directives inside an imported array file', () => {
      fs.writeFileSync(path.join(tempDir, 'base.yaml'), '- name: repo-1\n');
      fs.writeFileSync(path.join(tempDir, 'wrapper.yaml'), '- $import: base.yaml\n- name: repo-2\n');

      const result = resolveArrayImports([{ $import: 'wrapper.yaml' }], tempDir);

      expect(result).toEqual([{ name: 'repo-1' }, { name: 'repo-2' }]);
    });

    it('throws Import file not found: <path> when the import target is missing', () => {
      const missingPath = path.join(tempDir, 'missing.yaml');

      expect(() => resolveArrayImports([{ $import: 'missing.yaml' }], tempDir)).toThrow(
        `Import file not found: ${missingPath}`
      );
    });

    it('throws Import file <path> is empty when the imported file has no content', () => {
      const emptyPath = path.join(tempDir, 'empty.yaml');
      fs.writeFileSync(emptyPath, '');

      expect(() => resolveArrayImports([{ $import: 'empty.yaml' }], tempDir)).toThrow(
        `Import file ${emptyPath} is empty`
      );
    });

    it('throws must contain either an object or an array when the imported file is a primitive', () => {
      fs.writeFileSync(path.join(tempDir, 'primitive.yaml'), 'just a string');

      expect(() => resolveArrayImports([{ $import: 'primitive.yaml' }], tempDir)).toThrow(
        'must contain either an object or an array'
      );
    });

    it('allows the same file to be imported from two sibling array entries without throwing', () => {
      fs.writeFileSync(path.join(tempDir, 'shared.yaml'), 'name: shared-resource\n');

      const result = resolveArrayImports([{ $import: 'shared.yaml' }, { $import: 'shared.yaml' }], tempDir);

      expect(result).toEqual([{ name: 'shared-resource' }, { name: 'shared-resource' }]);
    });
  });

  describe('loadYamlFile', () => {
    it('parses a YAML file into its data', () => {
      const filePath = path.join(tempDir, 'data.yaml');
      fs.writeFileSync(filePath, 'name: value\n');

      expect(loadYamlFile(filePath)).toEqual({ name: 'value' });
    });

    it('throws Import file not found: <path> for a missing file', () => {
      const filePath = path.join(tempDir, 'missing.yaml');

      expect(() => loadYamlFile(filePath)).toThrow(`Import file not found: ${filePath}`);
    });

    it('throws Import file <path> is empty for an empty file', () => {
      const filePath = path.join(tempDir, 'empty.yaml');
      fs.writeFileSync(filePath, '');

      expect(() => loadYamlFile(filePath)).toThrow(`Import file ${filePath} is empty`);
    });
  });

  describe('findResourceDefinition', () => {
    it('finds a resource defined alone in an imported file and returns that file with inList: false', () => {
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        'resources:\n  assistants:\n    - $import: assistant.yaml\n'
      );
      fs.writeFileSync(path.join(tempDir, 'assistant.yaml'), 'name: my-assistant\ndescription: test\n');

      const result = findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'my-assistant');

      expect(result).toEqual({
        file: path.resolve(tempDir, 'assistant.yaml'),
        resource: { name: 'my-assistant', description: 'test' },
        inList: false,
      });
    });

    it('finds a resource inside an imported list file and returns inList: true', () => {
      fs.writeFileSync(
        path.join(tempDir, 'codemie.yaml'),
        'resources:\n  assistants:\n    - $import: assistants-list.yaml\n'
      );
      fs.writeFileSync(path.join(tempDir, 'assistants-list.yaml'), '- name: alpha\n- name: beta\n');

      const result = findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'beta');

      expect(result).toEqual({
        file: path.resolve(tempDir, 'assistants-list.yaml'),
        resource: { name: 'beta' },
        inList: true,
      });
    });

    it('finds a resource defined inline in codemie.yaml and returns file: null', () => {
      fs.writeFileSync(path.join(tempDir, 'codemie.yaml'), 'resources:\n  assistants:\n    - name: inline-assistant\n');

      const result = findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'inline-assistant');

      expect(result).toEqual({
        file: null,
        resource: { name: 'inline-assistant' },
        inList: true,
      });
    });

    it('finds a resource reached through a nested $import', () => {
      fs.writeFileSync(path.join(tempDir, 'codemie.yaml'), 'resources:\n  assistants:\n    - $import: group.yaml\n');
      fs.writeFileSync(path.join(tempDir, 'group.yaml'), '- $import: individual.yaml\n');
      fs.writeFileSync(path.join(tempDir, 'individual.yaml'), 'name: nested-assistant\n');

      const result = findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'nested-assistant');

      expect(result).toEqual({
        file: path.resolve(tempDir, 'individual.yaml'),
        resource: { name: 'nested-assistant' },
        inList: false,
      });
    });

    it('returns undefined for an unknown name', () => {
      fs.writeFileSync(path.join(tempDir, 'codemie.yaml'), 'resources:\n  assistants:\n    - name: alpha\n');

      const result = findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'does-not-exist');

      expect(result).toBeUndefined();
    });

    it('throws Circular import detected when a cyclic $import chain is walked', () => {
      fs.writeFileSync(path.join(tempDir, 'codemie.yaml'), 'resources:\n  assistants:\n    - $import: file-a.yaml\n');
      fs.writeFileSync(path.join(tempDir, 'file-a.yaml'), '- $import: file-b.yaml\n');
      fs.writeFileSync(path.join(tempDir, 'file-b.yaml'), '- $import: file-a.yaml\n');

      expect(() => findResourceDefinition(tempDir, 'codemie.yaml', 'assistants', 'anything')).toThrow(
        'Circular import detected:'
      );
    });
  });
});
