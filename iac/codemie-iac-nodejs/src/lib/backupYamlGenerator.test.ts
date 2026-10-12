/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as yaml from 'yaml';
import { SkillVisibility } from 'codemie-sdk';

import { createMockAssistant, createMockSkill } from '../testFixtures';

import {
  generateCodemieYaml,
  saveIntegrationOpenApiSpecs,
  saveBackupFiles,
  type BackupData,
} from './backupYamlGenerator';

function createMinimalBackupData(overrides: Partial<BackupData> = {}): BackupData {
  const { resources: resourceOverrides, state: stateOverrides, ...rest } = overrides;
  return {
    metadata: {
      timestamp: '2025-01-01T00:00:00Z',
      projectName: 'test-project',
      codemieApiUrl: 'https://api.example.com',
    },
    resources: {
      assistants: [],
      datasources: [],
      workflows: [],
      skills: [],
      integrations: [],
      ...resourceOverrides,
    },
    state: {
      version: '1',
      project: 'test-project',
      lastSync: null,
      resources: {
        assistants: {},
        datasources: {},
        workflows: {},
        skills: {},
        ...(stateOverrides as BackupData['state'] | undefined)?.resources,
      },
      ...(stateOverrides ? { ...stateOverrides, resources: undefined } : {}),
    },
    ...rest,
  } as BackupData;
}

describe('backupYamlGenerator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-generator-test-'));
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('generateCodemieYaml', () => {
    it('should generate valid YAML with correct structure', () => {
      const backupData = createMinimalBackupData();

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as Record<string, unknown>;

      expect(parsed.version).toBe('1');
      expect(parsed.project).toEqual({
        name: 'test-project',
        description: 'Backup from 2025-01-01T00:00:00Z',
      });
      expect(parsed.environment).toBeDefined();
      expect(parsed.imported).toBeDefined();
      expect(parsed.resources).toBeDefined();
    });

    it('should include environment placeholders', () => {
      const backupData = createMinimalBackupData();

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as { environment: Record<string, string> };

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      expect(parsed.environment.codemie_api_url).toBe('${CODEMIE_API_URL}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      expect(parsed.environment.auth_server_url).toBe('${CODEMIE_AUTH_URL}');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      expect(parsed.environment.auth_realm_name).toBe('${CODEMIE_REALM:-codemie}');
    });

    it('should include datasource_defaults', () => {
      const backupData = createMinimalBackupData();

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as { datasource_defaults: Record<string, unknown> };

      expect(parsed.datasource_defaults.code).toBeDefined();
      expect(parsed.datasource_defaults.knowledge_base_confluence).toBeDefined();
      expect(parsed.datasource_defaults.knowledge_base_jira).toBeDefined();
    });

    it('should process integrations and create alias mapping', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-123',
              alias: 'Jira Connection',
              credential_type: 'Jira',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'url', value: 'https://jira.example.com' }],
            },
          ],
          skills: [],
        },
      });

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as { imported: { integrations: Array<{ alias: string }> } };

      expect(parsed.imported.integrations).toHaveLength(1);
      expect(parsed.imported.integrations[0].alias).toBe('Jira Connection');
    });

    it('should generate alias from credential_type if alias not provided', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-12345678-abcd',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
            },
          ],
          skills: [],
        },
      });

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as { imported: { integrations: Array<{ alias: string }> } };

      expect(parsed.imported.integrations[0].alias).toBe('openapi_int-1234');
    });

    it('should replace openapi_spec with file reference when provided', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-openapi-123',
              alias: 'Coda API',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [
                { key: 'url', value: 'https://coda.io/api' },
                { key: 'openapi_spec', value: '{"openapi":"3.0.0"}' },
              ],
            },
          ],
          skills: [],
        },
      });

      const integrationSpecPaths = new Map([['int-openapi-123', 'openapi_specs/coda-api.json']]);

      const result = generateCodemieYaml(backupData, 'test-project', tempDir, integrationSpecPaths);
      const parsed = yaml.parse(result) as {
        imported: { integrations: Array<{ credential_values: Array<{ key: string; value: string }> }> };
      };

      const specValue = parsed.imported.integrations[0].credential_values.find((cv) => cv.key === 'openapi_spec');
      expect(specValue?.value).toBe('openapi_specs/coda-api.json');
    });

    it('should record a companion files checksum in the state it emits for a companion-bearing skill', () => {
      const skillDir = path.join(tempDir, 'skills', 'companioned-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Companioned skill');
      fs.writeFileSync(path.join(skillDir, 'reference.md'), 'reference body');

      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [],
          skills: [
            createMockSkill({
              id: 'companioned-skill-id',
              name: 'companioned-skill',
              project: 'test-project',
              description: 'Companioned skill',
              content: '# Companioned skill',
              visibility: SkillVisibility.PROJECT,
              companion_files: [{ path: 'reference.md', mime_type: 'text/markdown', encoding: 'text', size_bytes: 14 }],
            }),
          ],
        },
      });

      generateCodemieYaml(backupData, 'test-project', tempDir);

      const skillState = backupData.state.resources.skills?.['companioned-skill'];
      expect(skillState?.companionFilesChecksum).toBeDefined();
      expect(Object.keys(skillState?.companionFileHashes ?? {})).toEqual(['reference.md']);
    });
  });

  describe('saveIntegrationOpenApiSpecs', () => {
    it('should return empty map when no OpenAPI integrations', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-jira',
              credential_type: 'Jira',
              project_name: 'test-project',
              setting_type: 'project',
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.size).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'openapi_specs'))).toBe(false);
    });

    it('should save JSON spec with .json extension', () => {
      const jsonSpec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Test API' } });
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-openapi-json',
              alias: 'Test API',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'openapi_spec', value: jsonSpec }],
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.get('int-openapi-json')).toBe('openapi_specs/test-api.json');
      expect(fs.existsSync(path.join(tempDir, 'openapi_specs', 'test-api.json'))).toBe(true);

      const savedContent = fs.readFileSync(path.join(tempDir, 'openapi_specs', 'test-api.json'), 'utf8');
      expect(JSON.parse(savedContent)).toEqual({ openapi: '3.0.0', info: { title: 'Test API' } });
    });

    it('should save YAML spec with .yaml extension', () => {
      const yamlSpec = 'openapi: "3.0.0"\ninfo:\n  title: Test API';
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-openapi-yaml',
              alias: 'YAML API',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'openapi_spec', value: yamlSpec }],
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.get('int-openapi-yaml')).toBe('openapi_specs/yaml-api.yaml');
      expect(fs.existsSync(path.join(tempDir, 'openapi_specs', 'yaml-api.yaml'))).toBe(true);
    });

    it('should sanitize filename from alias', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-special',
              alias: 'My Special API @#$% v2.0',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'openapi_spec', value: '{}' }],
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.get('int-special')).toBe('openapi_specs/my-special-api-v2-0.json');
    });

    it('should use id as filename when alias not provided', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-no-alias-123',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'openapi_spec', value: '{}' }],
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.get('int-no-alias-123')).toBe('openapi_specs/int-no-alias-123.json');
    });

    it('should skip integrations without openapi_spec credential', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-openapi-no-spec',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'url', value: 'https://api.example.com' }],
            },
          ],
          skills: [],
        },
      });

      const result = saveIntegrationOpenApiSpecs(backupData, tempDir);

      expect(result.size).toBe(0);
    });
  });

  describe('saveBackupFiles', () => {
    it('should save all backup files', () => {
      const backupData = createMinimalBackupData();

      saveBackupFiles(backupData, tempDir, 'test-project');

      expect(fs.existsSync(path.join(tempDir, 'codemie.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'backup.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'state.json'))).toBe(true);
    });

    it('should save valid codemie.yaml', () => {
      const backupData = createMinimalBackupData();

      saveBackupFiles(backupData, tempDir, 'my-project');

      const content = fs.readFileSync(path.join(tempDir, 'codemie.yaml'), 'utf8');
      const parsed = yaml.parse(content) as { project: { name: string } };

      expect(parsed.project.name).toBe('my-project');
    });

    it('should save valid backup.json', () => {
      const backupData = createMinimalBackupData();

      saveBackupFiles(backupData, tempDir, 'test-project');

      const content = fs.readFileSync(path.join(tempDir, 'backup.json'), 'utf8');
      const parsed = JSON.parse(content) as BackupData;

      expect(parsed.metadata.projectName).toBe('test-project');
    });

    it('should save valid state.json', () => {
      const backupData = createMinimalBackupData();
      backupData.state.resources.assistants['Test Assistant'] = {
        id: 'ast-123',
        lastDeployed: '2025-01-01T00:00:00Z',
        promptChecksum: 'abc123',
        configChecksum: 'def456',
      };

      saveBackupFiles(backupData, tempDir, 'test-project');

      const content = fs.readFileSync(path.join(tempDir, 'state.json'), 'utf8');
      const parsed = JSON.parse(content) as typeof backupData.state;

      expect(parsed.resources.assistants['Test Assistant'].id).toBe('ast-123');
    });

    it('should extract OpenAPI specs before generating YAML', () => {
      const jsonSpec = JSON.stringify({ openapi: '3.0.0' });
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [
            {
              id: 'int-openapi',
              alias: 'Test OpenAPI',
              credential_type: 'OpenAPI',
              project_name: 'test-project',
              setting_type: 'project',
              credential_values: [{ key: 'openapi_spec', value: jsonSpec }],
            },
          ],
          skills: [],
        },
      });

      saveBackupFiles(backupData, tempDir, 'test-project');

      // OpenAPI spec should be saved to file
      expect(fs.existsSync(path.join(tempDir, 'openapi_specs', 'test-openapi.json'))).toBe(true);

      // codemie.yaml should reference the file, not contain full spec
      const codemieYaml = fs.readFileSync(path.join(tempDir, 'codemie.yaml'), 'utf8');
      expect(codemieYaml).toContain('openapi_specs/test-openapi.json');
      expect(codemieYaml).not.toContain('"openapi":"3.0.0"');
    });

    it('should place owned skills in resources and referenced external skills in imported.skills', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [
            createMockAssistant({
              id: 'ast-1',
              name: 'Reviewer',
              skill_ids: ['external-skill-id'],
            }),
          ],
          datasources: [],
          workflows: [],
          integrations: [],
          skills: [
            createMockSkill({
              id: 'owned-skill-id',
              name: 'owned-skill',
              project: 'test-project',
              description: 'Owned skill',
              content: '# Owned skill',
              visibility: SkillVisibility.PROJECT,
            }),
            createMockSkill({
              id: 'external-skill-id',
              name: 'external-skill',
              project: 'epm-cdme',
              description: 'External skill',
              content: '# External skill',
              visibility: SkillVisibility.PUBLIC,
            }),
            createMockSkill({
              id: 'unused-external-id',
              name: 'unused-external',
              project: 'other-project',
              description: 'Unused external skill',
              content: '# Unused',
              visibility: SkillVisibility.PUBLIC,
            }),
          ],
        },
      });

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as {
        imported: { skills: Array<{ name: string; id: string }> };
        resources: {
          assistants: Array<{ skills?: string[] }>;
          skills?: Array<{ name: string; file: string }>;
        };
      };

      expect(parsed.resources.skills).toHaveLength(1);
      expect(parsed.resources.skills?.[0]?.name).toBe('owned-skill');
      expect(parsed.resources.skills?.[0]?.file).toBe('skills/owned-skill.skill.md');
      expect(parsed.imported.skills).toEqual([{ name: 'external-skill', id: 'external-skill-id' }]);
      expect(parsed.resources.assistants[0]?.skills).toEqual(['external-skill']);
      expect(backupData.state.resources.skills?.['owned-skill']?.id).toBe('owned-skill-id');
      expect(backupData.state.resources.skills?.['external-skill']).toBeUndefined();
    });

    it('should classify owned skills using normalized project names', () => {
      const backupData = createMinimalBackupData({
        resources: {
          assistants: [],
          datasources: [],
          workflows: [],
          integrations: [],
          skills: [
            createMockSkill({
              id: 'owned-skill-id',
              name: 'owned-skill',
              project: ' Test-Project ',
              description: 'Owned skill',
              content: '# Owned skill',
              visibility: SkillVisibility.PROJECT,
            }),
          ],
        },
      });

      const result = generateCodemieYaml(backupData, 'test-project', tempDir);
      const parsed = yaml.parse(result) as {
        imported: { skills: Array<{ name: string; id: string }> };
        resources: { skills?: Array<{ name: string }> };
      };

      expect(parsed.resources.skills).toEqual([expect.objectContaining({ name: 'owned-skill' })]);
      expect(parsed.imported.skills).toEqual([]);
    });
  });
});
