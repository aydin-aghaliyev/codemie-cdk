/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SkillResource } from '../types/codemieConfig';

import { logger } from './logger';
import { collectCompanionFiles, hasCompanionFileLayout, matchesExcludePattern } from './skillCompanionFiles';

describe('hasCompanionFileLayout', () => {
  it('should be true when file points at SKILL.md', () => {
    const skill: SkillResource = { name: 'a', description: 'd', file: 'skills-src/foo/SKILL.md' };
    expect(hasCompanionFileLayout(skill)).toBe(true);
  });

  it('should be false when file points at a plain .skill.md file', () => {
    const skill: SkillResource = { name: 'a', description: 'd', file: 'skills/foo.skill.md' };
    expect(hasCompanionFileLayout(skill)).toBe(false);
  });

  it('should be false without throwing when file is undefined', () => {
    const skill: SkillResource = { name: 'a', description: 'd', content: 'body only' };
    expect(hasCompanionFileLayout(skill)).toBe(false);
  });
});

describe('matchesExcludePattern', () => {
  it('should match an exact path', () => {
    expect(matchesExcludePattern('docs/secret.txt', 'docs/secret.txt')).toBe(true);
    expect(matchesExcludePattern('docs/other.txt', 'docs/secret.txt')).toBe(false);
  });

  it('should match everything beneath a directory prefix', () => {
    expect(matchesExcludePattern('vendor/lib/deep/file.txt', 'vendor/lib')).toBe(true);
    expect(matchesExcludePattern('vendor/other/file.txt', 'vendor/lib')).toBe(false);
  });

  it('should support {a,b} alternation', () => {
    expect(matchesExcludePattern('foo.txt', '{foo,bar}.txt')).toBe(true);
    expect(matchesExcludePattern('bar.txt', '{foo,bar}.txt')).toBe(true);
    expect(matchesExcludePattern('baz.txt', '{foo,bar}.txt')).toBe(false);
  });

  it('should match ? as exactly one character', () => {
    expect(matchesExcludePattern('file1.txt', 'file?.txt')).toBe(true);
    expect(matchesExcludePattern('file12.txt', 'file?.txt')).toBe(false);
  });

  it('should not let * cross a / boundary', () => {
    expect(matchesExcludePattern('docs/file.txt', 'docs/*.txt')).toBe(true);
    expect(matchesExcludePattern('docs/sub/file.txt', 'docs/*.txt')).toBe(false);
  });

  it('should let ** cross a / boundary', () => {
    expect(matchesExcludePattern('docs/a/b/secret.txt', 'docs/**/secret.txt')).toBe(true);
  });

  it('should match a slash-free pattern against the basename at any depth', () => {
    expect(matchesExcludePattern('secret.txt', 'secret.txt')).toBe(true);
    expect(matchesExcludePattern('a/b/secret.txt', 'secret.txt')).toBe(true);
    expect(matchesExcludePattern('a/b/notsecret.txt', 'secret.txt')).toBe(false);
  });

  it('should treat an unbalanced brace as a literal character instead of throwing', () => {
    // A malformed pattern used to reach `new RegExp` as an unterminated group and blow up the
    // whole preview/backup run with a raw regex error; it now matches the brace literally.
    expect(matchesExcludePattern('a{b', 'a{b')).toBe(true);
    expect(matchesExcludePattern('ab', 'a{b')).toBe(false);
    expect(matchesExcludePattern('a}b', 'a}b')).toBe(true);
    expect(matchesExcludePattern('ab', 'a}b')).toBe(false);
    expect(matchesExcludePattern('{', '{')).toBe(true);
    expect(matchesExcludePattern('}', '}')).toBe(true);
    expect(matchesExcludePattern('x', '{')).toBe(false);
  });

  it('should still treat a balanced brace group as alternation when another brace is unbalanced', () => {
    expect(matchesExcludePattern('a{foo', 'a{{foo,bar}')).toBe(true);
    expect(matchesExcludePattern('a{bar', 'a{{foo,bar}')).toBe(true);
    expect(matchesExcludePattern('a{baz', 'a{{foo,bar}')).toBe(false);
  });

  it('should treat a literal dot and plus as literal characters, not regex metacharacters', () => {
    expect(matchesExcludePattern('file.txt', 'file.txt')).toBe(true);
    expect(matchesExcludePattern('fileXtxt', 'file.txt')).toBe(false);
    expect(matchesExcludePattern('a+b.txt', 'a+b.txt')).toBe(true);
  });
});

describe('collectCompanionFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-companion-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function write(relPath: string, content: string | Buffer): void {
    const fullPath = path.join(tempDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it('should always skip SKILL.md, .codemie-exclude, node_modules, .git, evals and lockfiles', () => {
    write('SKILL.md', '# Skill');
    write('.codemie-exclude', 'irrelevant-pattern.txt');
    write('node_modules/pkg/index.js', 'module.exports = {};');
    write('.git/HEAD', 'ref: refs/heads/main');
    write('evals/case1.yaml', 'input: foo');
    write('package-lock.json', '{}');
    write('yarn.lock', '# yarn lockfile');
    write('pnpm-lock.yaml', 'lockfileVersion: 6');
    write('keep.md', '# Keep me');

    const result = collectCompanionFiles(tempDir);

    expect(result.map((f) => f.path)).toEqual(['keep.md']);
  });

  it('should honour .codemie-exclude patterns read from the skill directory', () => {
    write('.codemie-exclude', ['secret.txt', 'vendor/', ''].join('\n'));
    write('secret.txt', 'nope');
    write('vendor/lib/file.txt', 'nope');
    write('keep.txt', 'yes');

    const result = collectCompanionFiles(tempDir);

    expect(result.map((f) => f.path)).toEqual(['keep.txt']);
  });

  it('should encode a binary file as base64 with a non-text mime type', () => {
    const pngLike = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    write('image.png', pngLike);

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('base64');
    expect(result[0].content).toBe(pngLike.toString('base64'));
    expect(result[0].mime_type).not.toMatch(/^text\//);
  });

  it('should encode a text file as text as-is', () => {
    write('notes.md', 'Some notes here.');

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('text');
    expect(result[0].content).toBe('Some notes here.');
    expect(result[0].mime_type).toBe('text/markdown');
  });

  it('should report size_bytes as the raw byte length, not the base64 length', () => {
    const pngLike = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    write('image.png', pngLike);

    const result = collectCompanionFiles(tempDir);

    expect(result[0].size_bytes).toBe(pngLike.length);
    expect(result[0].size_bytes).not.toBe(result[0].content.length);
  });

  it('should return output sorted by path regardless of walk order', () => {
    write('zeta.txt', 'z');
    write('alpha/beta.txt', 'b');
    write('alpha.txt', 'a');

    const result = collectCompanionFiles(tempDir);

    expect(result.map((f) => f.path)).toEqual(['alpha.txt', 'alpha/beta.txt', 'zeta.txt']);
  });

  it('should treat a non-UTF-8 byte sequence with no NUL as binary and round-trip it byte-for-byte', () => {
    const latin1 = Buffer.from([0x48, 0x65, 0xe9, 0x6c, 0x6c, 0x6f]);
    write('legacy.txt', latin1);

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('base64');
    expect(Buffer.from(result[0].content, 'base64').equals(latin1)).toBe(true);
    expect(result[0].size_bytes).toBe(latin1.length);
  });

  it('should keep a valid UTF-8 file with multi-byte characters as unchanged text', () => {
    const text = 'h\u00e9llo \u2014 na\u00efve \u65e5\u672c\u8a9e';
    write('notes.md', Buffer.from(text, 'utf8'));

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('text');
    expect(result[0].content).toBe(text);
  });

  it('should classify a NUL-containing file as base64 even when the NUL sits past the first 8000 bytes', () => {
    const buffer = Buffer.concat([Buffer.alloc(9000, 0x41), Buffer.from([0x00]), Buffer.alloc(10, 0x42)]);
    write('late-nul.dat', buffer);

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('base64');
    expect(Buffer.from(result[0].content, 'base64').equals(buffer)).toBe(true);
  });

  it('should treat an empty file as text with empty content', () => {
    write('empty.txt', Buffer.alloc(0));

    const result = collectCompanionFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].encoding).toBe('text');
    expect(result[0].content).toBe('');
    expect(result[0].size_bytes).toBe(0);
  });

  it('should ignore comment lines in .codemie-exclude, so a commented-out pattern excludes nothing', () => {
    write('.codemie-exclude', ['# notes are shipped on purpose', '  #notes.md', 'secret.txt'].join('\n'));
    write('#notes.md', 'shipped');
    write('secret.txt', 'nope');
    write('keep.txt', 'yes');

    const result = collectCompanionFiles(tempDir);

    expect(result.map((f) => f.path)).toEqual(['#notes.md', 'keep.txt']);
  });
});

describe('collectCompanionFiles with a malformed .codemie-exclude pattern', () => {
  let tempDir: string;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-companion-malformed-'));
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('collects files and warns naming the exclude file and the pattern', () => {
    fs.writeFileSync(path.join(tempDir, '.codemie-exclude'), 'a{b\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'yes', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'a{b'), 'excluded literally', 'utf8');

    const result = collectCompanionFiles(tempDir);

    expect(result.map((f) => f.path)).toEqual(['keep.txt']);

    const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warnings).toContain('a{b');
    expect(warnings).toContain(path.join(tempDir, '.codemie-exclude'));
    expect(warnings).not.toMatch(/Unterminated group|Unmatched/);
  });
});

describe('collectCompanionFiles directory pruning', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-companion-prune-'));
  });

  afterEach(() => {
    const vendorDir = path.join(tempDir, 'vendor');
    if (fs.existsSync(vendorDir)) {
      fs.chmodSync(vendorDir, 0o755);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('excludes every file under a trailing-slash pattern', () => {
    fs.writeFileSync(path.join(tempDir, '.codemie-exclude'), 'vendor/\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'yes', 'utf8');
    fs.mkdirSync(path.join(tempDir, 'vendor', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'vendor', 'a.txt'), 'nope', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'vendor', 'sub', 'b.txt'), 'nope', 'utf8');

    expect(collectCompanionFiles(tempDir).map((f) => f.path)).toEqual(['keep.txt']);
  });

  it('does not descend into a directory a trailing-slash pattern already excludes', () => {
    // An unreadable directory is the cheapest observable proof of pruning: descending into it
    // throws EACCES, so a walk that still recurses fails this test outright. Running as root
    // bypasses the permission bits, so the assertion is only meaningful for a non-root user.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }

    fs.writeFileSync(path.join(tempDir, '.codemie-exclude'), 'vendor/\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'yes', 'utf8');
    fs.mkdirSync(path.join(tempDir, 'vendor'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'vendor', 'a.txt'), 'nope', 'utf8');
    fs.chmodSync(path.join(tempDir, 'vendor'), 0o000);

    expect(collectCompanionFiles(tempDir).map((f) => f.path)).toEqual(['keep.txt']);
  });
});
