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

import { expandSkillSourceDirs, parseSkillFrontMatter } from './skillSourceLoader';

describe('parseSkillFrontMatter', () => {
  it('should parse plain front matter and body', () => {
    const raw = [
      '---',
      'name: my-skill',
      'description: A perfectly fine description here',
      '---',
      'Skill body text.',
    ].join('\n');

    const result = parseSkillFrontMatter(raw);

    expect(result.frontMatter).toEqual({
      name: 'my-skill',
      description: 'A perfectly fine description here',
    });
    expect(result.body).toBe('Skill body text.');
  });

  it('should tolerate a UTF-8 BOM before the opening delimiter', () => {
    const raw = `﻿${['---', 'name: bom-skill', '---', 'Body after BOM.'].join('\n')}`;

    const result = parseSkillFrontMatter(raw);

    expect(result.frontMatter).toEqual({ name: 'bom-skill' });
    expect(result.body).toBe('Body after BOM.');
  });

  it('should tolerate CRLF line endings throughout', () => {
    const raw = [
      '---',
      'name: crlf-skill',
      'description: Uses CRLF endings throughout',
      '---',
      'Body line one.',
      'Body line two.',
    ].join('\r\n');

    const result = parseSkillFrontMatter(raw);

    expect(result.frontMatter).toEqual({
      name: 'crlf-skill',
      description: 'Uses CRLF endings throughout',
    });
    expect(result.body).toBe('Body line one.\r\nBody line two.');
  });

  it('should treat absent front matter as empty and preserve body exactly', () => {
    const raw = 'Just a plain skill body with no front matter.';

    const result = parseSkillFrontMatter(raw);

    expect(result.frontMatter).toEqual({});
    expect(result.body).toBe(raw);
  });
});

describe('expandSkillSourceDirs', () => {
  let tempDir: string;

  function writeSkillDir(parentDir: string, dirName: string, skillMdContent: string | null): void {
    const dirPath = path.join(parentDir, dirName);
    fs.mkdirSync(dirPath, { recursive: true });
    if (skillMdContent !== null) {
      fs.writeFileSync(path.join(dirPath, 'SKILL.md'), skillMdContent);
    }
  }

  function sourceEntry(overrides: Partial<SkillResource> = {}): SkillResource {
    return {
      name: 'placeholder',
      description: 'placeholder description long enough',
      source_dir: 'skills-src',
      ...overrides,
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-source-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should pass through entries without source_dir untouched', () => {
    const passthrough: SkillResource = {
      name: 'hand-written',
      description: 'A hand written skill entry',
      file: 'skills/hand-written.skill.md',
    };

    const result = expandSkillSourceDirs([passthrough], tempDir);

    expect(result).toEqual([passthrough]);
    expect(result[0]).toBe(passthrough);
  });

  it('should expand one resource per immediate subdirectory containing SKILL.md', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'alpha-skill',
      ['---', 'name: alpha-skill', 'description: Alpha skill description text here', '---', 'Alpha body.'].join('\n')
    );
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'beta-skill',
      ['---', 'description: Beta skill description text here', '---', 'Beta body.'].join('\n')
    );

    const entry = sourceEntry({ categories: ['dev'], visibility: 'public', group: 'core' });
    const result = expandSkillSourceDirs([entry], tempDir);

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      name: 'alpha-skill',
      description: 'Alpha skill description text here',
      file: path.join('skills-src', 'alpha-skill', 'SKILL.md'),
      content: 'Alpha body.',
      categories: ['dev'],
      visibility: 'public',
      group: 'core',
    });

    // beta-skill has no front matter `name`, falls back to directory name
    expect(result[1]).toEqual({
      name: 'beta-skill',
      description: 'Beta skill description text here',
      file: path.join('skills-src', 'beta-skill', 'SKILL.md'),
      content: 'Beta body.',
      categories: ['dev'],
      visibility: 'public',
      group: 'core',
    });

    for (const skill of result) {
      expect(skill).not.toHaveProperty('source_dir');
      expect(skill).not.toHaveProperty('ignore_file');
    }
  });

  it('should skip a subdirectory that does not contain SKILL.md', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'has-skill',
      ['---', 'name: has-skill', 'description: This one has a SKILL.md file', '---', 'Body.'].join('\n')
    );
    writeSkillDir(path.join(tempDir, 'skills-src'), 'no-skill-md', null);

    const result = expandSkillSourceDirs([sourceEntry()], tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('has-skill');
  });

  it('should skip directories named in ignore_file', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'keep-me',
      ['---', 'name: keep-me', 'description: This directory should be kept', '---', 'Body.'].join('\n')
    );
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'ignore-me',
      ['---', 'name: ignore-me', 'description: This directory should be ignored', '---', 'Body.'].join('\n')
    );
    fs.writeFileSync(path.join(tempDir, 'ignore.yaml'), 'skills:\n  - ignore-me\n');

    const result = expandSkillSourceDirs([sourceEntry({ ignore_file: 'ignore.yaml' })], tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('keep-me');
  });

  it('should produce identical, sorted order across two loads', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    const names = ['zeta-skill', 'alpha-skill', 'mu-skill'];
    for (const dirName of names) {
      writeSkillDir(
        path.join(tempDir, 'skills-src'),
        dirName,
        ['---', `name: ${dirName}`, `description: Description text for ${dirName} here`, '---', 'Body.'].join('\n')
      );
    }

    const first = expandSkillSourceDirs([sourceEntry()], tempDir).map((s) => s.name);
    const second = expandSkillSourceDirs([sourceEntry()], tempDir).map((s) => s.name);

    expect(first).toEqual(['alpha-skill', 'mu-skill', 'zeta-skill']);
    expect(second).toEqual(first);
  });

  it('should throw naming both the resolved path and the config entry for a non-existent source_dir', () => {
    const entry = sourceEntry({ source_dir: 'does-not-exist' });
    const resolvedPath = path.join(tempDir, 'does-not-exist');

    expect(() => expandSkillSourceDirs([entry], tempDir)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(resolvedPath),
      })
    );
    expect(() => expandSkillSourceDirs([entry], tempDir)).toThrow(/does-not-exist/);
  });

  it('should fail on a name that is not valid kebab-case', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'bad-dir',
      ['---', 'name: Not_Kebab_Case', 'description: A perfectly fine description text', '---', 'Body.'].join('\n')
    );

    expect(() => expandSkillSourceDirs([sourceEntry()], tempDir)).toThrow();
  });

  it('should fail on a name shorter than 3 characters', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'bad-dir',
      ['---', 'name: ab', 'description: A perfectly fine description text', '---', 'Body.'].join('\n')
    );

    expect(() => expandSkillSourceDirs([sourceEntry()], tempDir)).toThrow();
  });

  it('should fail on a name not starting or ending with a letter or digit', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'bad-dir',
      ['---', 'name: -bad-name-', 'description: A perfectly fine description text', '---', 'Body.'].join('\n')
    );

    expect(() => expandSkillSourceDirs([sourceEntry()], tempDir)).toThrow();
  });

  it('should fail on a missing description without generating a placeholder', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'no-description',
      ['---', 'name: no-description', '---', 'Body.'].join('\n')
    );

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry()], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain('...');
    expect(message).not.toMatch(/lorem ipsum/i);
    expect(message).not.toBe('');
  });

  it('should fail on a too-short description without truncating or padding it', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'short-description',
      ['---', 'name: short-description', 'description: short', '---', 'Body.'].join('\n')
    );

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry()], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('5 characters');
    expect(message).not.toContain('short...');
  });

  it('should report the bad descriptions of every source_dir in a single error', () => {
    for (const [parent, dirName] of [
      ['skills-src', 'alpha-skill'],
      ['skills-src-2', 'beta-skill'],
    ]) {
      fs.mkdirSync(path.join(tempDir, parent), { recursive: true });
      writeSkillDir(
        path.join(tempDir, parent),
        dirName,
        ['---', `name: ${dirName}`, 'description: short', '---', 'Body.'].join('\n')
      );
    }

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry(), sourceEntry({ source_dir: 'skills-src-2' })], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('alpha-skill');
    expect(message).toContain('beta-skill');
  });

  it('should name the SKILL.md path when its front matter is not valid YAML', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'broken-skill',
      ['---', 'name: broken-skill', 'description: [unclosed', '---', 'Body.'].join('\n')
    );

    const skillMdPath = path.join(tempDir, 'skills-src', 'broken-skill', 'SKILL.md');

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry()], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('Invalid YAML front matter in');
    expect(message).toContain(skillMdPath);
  });

  it('should name the ignore file path when ignore_file does not exist', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'alpha-skill',
      ['---', 'name: alpha-skill', 'description: Alpha skill description text here', '---', 'Body.'].join('\n')
    );

    const missingIgnorePath = path.join(tempDir, 'skills-ignore.yaml');

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry({ ignore_file: 'skills-ignore.yaml' })], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(missingIgnorePath);
    expect(message).toContain('skills-ignore.yaml');
    expect(message).toContain('skills-src');
    expect(message).not.toContain('ENOENT');
  });

  it('should name the ignore file path when it is not valid YAML', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'alpha-skill',
      ['---', 'name: alpha-skill', 'description: Alpha skill description text here', '---', 'Body.'].join('\n')
    );
    fs.writeFileSync(path.join(tempDir, 'skills-ignore.yaml'), 'skills: [unclosed');

    const ignorePath = path.join(tempDir, 'skills-ignore.yaml');

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry({ ignore_file: 'skills-ignore.yaml' })], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('Invalid YAML in skill ignore file');
    expect(message).toContain(ignorePath);
  });

  it('should reject a front-matter name colliding with another directory fallback name', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'alpha-skill',
      ['---', 'description: Alpha skill description text here', '---', 'Alpha body.'].join('\n')
    );
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'zeta-skill',
      ['---', 'name: alpha-skill', 'description: Zeta skill description text here', '---', 'Zeta body.'].join('\n')
    );

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry()], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('alpha-skill');
    expect(message).toContain('zeta-skill');
    expect(message).toContain('skills-src');
  });

  it('should reject an expanded name colliding with a hand-written entry', () => {
    fs.mkdirSync(path.join(tempDir, 'skills-src'), { recursive: true });
    writeSkillDir(
      path.join(tempDir, 'skills-src'),
      'alpha-skill',
      ['---', 'name: alpha-skill', 'description: Alpha skill description text here', '---', 'Alpha body.'].join('\n')
    );

    const handWritten: SkillResource = {
      name: 'alpha-skill',
      description: 'A hand written skill entry',
      file: 'skills/alpha-skill.skill.md',
    };

    let thrown: unknown;
    try {
      expandSkillSourceDirs([handWritten, sourceEntry()], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('alpha-skill');
    expect(message).toContain('hand-written');
    expect(message).toContain('skills-src');
  });

  it('should reject the same name expanded from two different source_dir entries', () => {
    for (const parent of ['skills-src', 'skills-src-2']) {
      fs.mkdirSync(path.join(tempDir, parent), { recursive: true });
      writeSkillDir(
        path.join(tempDir, parent),
        'alpha-skill',
        ['---', 'name: alpha-skill', 'description: Alpha skill description text here', '---', 'Alpha body.'].join('\n')
      );
    }

    let thrown: unknown;
    try {
      expandSkillSourceDirs([sourceEntry(), sourceEntry({ source_dir: 'skills-src-2' })], tempDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('alpha-skill');
    expect(message).toContain('skills-src');
    expect(message).toContain('skills-src-2');
  });
});
