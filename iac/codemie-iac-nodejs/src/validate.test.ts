/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { CodeMieClient } from 'codemie-sdk';

import { createClient } from './lib/clientFactory';
import { CodemieConfigLoader } from './lib/codemieConfigLoader';
import { DependencyValidator } from './lib/dependencyValidator';
import { StateManager } from './lib/stateManager';
import {
  checkApiSlugConflicts,
  validateSkillContentLengths,
  validateSkillDescriptions,
  validateSlugUniqueness,
} from './lib/validationUtils';
import type { CodemieConfig } from './types/codemieConfig';
import { validateConfig } from './validate';

jest.mock('./lib/codemieConfigLoader');
jest.mock('./lib/clientFactory');
jest.mock('./lib/logger');
jest.mock('./lib/stateManager');
jest.mock('./lib/validationUtils', () => ({
  validateSlugUniqueness: jest.fn(),
  checkApiSlugConflicts: jest.fn(),
  validateSkillDescriptions: jest.fn(),
  validateSkillContentLengths: jest.fn(),
}));

const MockedConfigLoader = CodemieConfigLoader as jest.MockedClass<typeof CodemieConfigLoader>;
const MockedStateManager = StateManager as jest.MockedClass<typeof StateManager>;
const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockedValidateSlugUniqueness = validateSlugUniqueness as jest.MockedFunction<typeof validateSlugUniqueness>;
const mockedCheckApiSlugConflicts = checkApiSlugConflicts as jest.MockedFunction<typeof checkApiSlugConflicts>;
const mockedValidateSkillDescriptions = validateSkillDescriptions as jest.MockedFunction<
  typeof validateSkillDescriptions
>;
const mockedValidateSkillContentLengths = validateSkillContentLengths as jest.MockedFunction<
  typeof validateSkillContentLengths
>;

describe('validate.ts', () => {
  let mockConfig: CodemieConfig;
  let mockLoaderInstance: {
    loadConfig: jest.Mock;
    validateFiles: jest.Mock;
    loadSkillContent: jest.Mock;
    resolveSkillContent: jest.Mock;
  };
  let assistantDependencySpy: jest.SpiedFunction<typeof DependencyValidator.validateAssistantDependencies>;
  let assistantSkillReferenceSpy: jest.SpiedFunction<typeof DependencyValidator.validateAssistantSkillReferences>;
  let workflowDependencySpy: jest.SpiedFunction<typeof DependencyValidator.validateWorkflowAssistantReferences>;
  let mockAppConfig: { rootDir: string; codemieConfig: string; codemieState: string; backupsDirectory: string };
  let validateOptions: { appConfig: typeof mockAppConfig; checkApi?: boolean };

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      version: '1',
      project: { name: 'test-project', description: 'Test project' },
      environment: {
        codemie_api_url: 'https://api.example.com',
        auth_server_url: 'https://auth.example.com',
        auth_realm_name: 'example',
      },
      imported: { assistants: [], datasources: [], integrations: [] },
      resources: { assistants: [], datasources: [], workflows: [] },
    };

    mockAppConfig = {
      rootDir: process.cwd(),
      codemieConfig: 'codemie.yaml',
      codemieState: 'state.json',
      backupsDirectory: 'backups',
    };

    mockLoaderInstance = {
      loadConfig: jest.fn().mockReturnValue(mockConfig),
      validateFiles: jest.fn().mockReturnValue({ valid: true, errors: [] }),
      loadSkillContent: jest.fn().mockReturnValue(''),
      resolveSkillContent: jest.fn((skill: { content?: string; file?: string }) =>
        skill.content !== undefined ? skill.content : mockLoaderInstance.loadSkillContent(skill.file)
      ),
    };
    MockedConfigLoader.mockImplementation(() => mockLoaderInstance as unknown as CodemieConfigLoader);

    MockedStateManager.mockImplementation(
      () =>
        ({
          loadState: jest.fn().mockReturnValue({
            version: '1',
            project: 'test-project',
            lastSync: null,
            resources: {
              assistants: {},
              datasources: {},
              workflows: {},
            },
          }),
        }) as unknown as StateManager
    );

    mockedValidateSlugUniqueness.mockReturnValue([]);
    mockedCheckApiSlugConflicts.mockResolvedValue([]);
    mockedValidateSkillDescriptions.mockReturnValue([]);
    mockedValidateSkillContentLengths.mockReturnValue([]);
    assistantDependencySpy = jest.spyOn(DependencyValidator, 'validateAssistantDependencies').mockReturnValue([]);
    assistantSkillReferenceSpy = jest
      .spyOn(DependencyValidator, 'validateAssistantSkillReferences')
      .mockReturnValue([]);
    workflowDependencySpy = jest.spyOn(DependencyValidator, 'validateWorkflowAssistantReferences').mockReturnValue([]);

    mockedCreateClient.mockResolvedValue({} as CodeMieClient);

    validateOptions = {
      appConfig: mockAppConfig,
      checkApi: false,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should succeed when every validator passes', async () => {
    const result = await validateConfig(validateOptions);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockLoaderInstance.validateFiles).toHaveBeenCalledWith(mockConfig);
    expect(mockedValidateSlugUniqueness).toHaveBeenCalledWith(mockConfig);
    expect(assistantDependencySpy).not.toHaveBeenCalled();
    expect(workflowDependencySpy).not.toHaveBeenCalled();
  });

  it('should surface file validation errors', async () => {
    mockLoaderInstance.validateFiles.mockReturnValue({
      valid: false,
      errors: ['Missing prompt file', 'Missing workflow file'],
    });

    const result = await validateConfig(validateOptions);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['Missing prompt file', 'Missing workflow file']);
  });

  it('should include slug uniqueness errors in the final result', async () => {
    mockedValidateSlugUniqueness.mockReturnValue(['Duplicate slug "helper" detected']);

    const result = await validateConfig(validateOptions);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Duplicate slug "helper" detected');
    expect(assistantDependencySpy).not.toHaveBeenCalled();
  });

  it('should aggregate assistant dependency errors', async () => {
    mockConfig.resources.assistants = [
      {
        name: 'Assistant A',
        description: 'desc',
        prompt: 'prompt.md',
        model: 'gpt-4',
      },
    ] as CodemieConfig['resources']['assistants'];
    assistantDependencySpy.mockReturnValue(['Cyclic dependency detected']);

    const result = await validateConfig(validateOptions);

    expect(assistantDependencySpy).toHaveBeenCalled();
    expect(assistantSkillReferenceSpy).toHaveBeenCalledWith(mockConfig.resources.assistants, [], []);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Cyclic dependency detected');
  });

  it('should aggregate assistant skill reference errors', async () => {
    mockConfig.resources.assistants = [
      {
        name: 'Assistant A',
        description: 'desc',
        prompt: 'prompt.md',
        model: 'gpt-4',
        skills: ['missing-skill'],
      },
    ] as CodemieConfig['resources']['assistants'];
    assistantSkillReferenceSpy.mockReturnValue(['Assistant "Assistant A": Skill reference "missing-skill" not found']);

    const result = await validateConfig(validateOptions);

    expect(assistantSkillReferenceSpy).toHaveBeenCalledWith(mockConfig.resources.assistants, [], []);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Assistant "Assistant A": Skill reference "missing-skill" not found');
  });

  it('should skip API slug check when local validations already failed', async () => {
    mockedValidateSlugUniqueness.mockReturnValue(['Duplicate slug']);

    const result = await validateConfig({ ...validateOptions, checkApi: true });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['Duplicate slug']);
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(mockedCheckApiSlugConflicts).not.toHaveBeenCalled();
  });

  it('should run API slug check when requested and local validations pass', async () => {
    const fakeClient = { assistants: { list: jest.fn() } } as unknown as CodeMieClient;
    mockedCreateClient.mockResolvedValue(fakeClient);
    mockedCheckApiSlugConflicts.mockResolvedValue(['existing slug conflict']);

    const result = await validateConfig({ ...validateOptions, checkApi: true });

    expect(mockedCreateClient).toHaveBeenCalledWith(mockConfig);
    expect(mockedCheckApiSlugConflicts).toHaveBeenCalledWith({
      config: mockConfig,
      client: fakeClient,
      assistantState: expect.any(Object),
    });
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['existing slug conflict']);
  });

  it('should include the skill description errors validateFiles reports', async () => {
    const descriptionError =
      '❌ Skill "my-skill" description length is 5 characters\n   💡 Allowed range: 10-1000 characters';
    mockConfig.resources.skills = [{ name: 'my-skill', description: 'short', file: 'skill.md' }];
    mockLoaderInstance.validateFiles.mockReturnValue({ valid: false, errors: [descriptionError] });

    const result = await validateConfig(validateOptions);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(descriptionError);
  });

  it('should report an out-of-range skill description exactly once, from validateFiles alone', async () => {
    const descriptionError =
      '❌ Skill "my-skill" description length is 5 characters\n   💡 Allowed range: 10-1000 characters';
    mockConfig.resources.skills = [{ name: 'my-skill', description: 'short', file: 'skill.md' }];
    // validateFiles already runs validateSkillDescriptions over the very same skills array, so
    // validate.ts must not run it a second time and dedupe the result afterwards.
    mockLoaderInstance.validateFiles.mockReturnValue({ valid: false, errors: [descriptionError] });
    mockedValidateSkillDescriptions.mockReturnValue([descriptionError]);

    const result = await validateConfig(validateOptions);

    expect(result.errors.filter((error) => error === descriptionError)).toHaveLength(1);
    expect(mockedValidateSkillDescriptions).not.toHaveBeenCalled();
  });

  it('should skip the content-length check via getConfig when there are no skills', async () => {
    const getConfigMock = jest.fn();
    const fakeClient = {
      assistants: { list: jest.fn() },
      skills: { getConfig: getConfigMock },
    } as unknown as CodeMieClient;
    mockedCreateClient.mockResolvedValue(fakeClient);

    const result = await validateConfig({ ...validateOptions, checkApi: true });

    expect(getConfigMock).not.toHaveBeenCalled();
    expect(mockedValidateSkillContentLengths).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should call getConfig exactly once and report content length errors under --check-api', async () => {
    mockConfig.resources.skills = [
      { name: 'skill-a', description: 'A perfectly valid description', file: 'a.skill.md' },
      { name: 'skill-b', description: 'Another perfectly valid description', file: 'b.skill.md' },
    ];
    const getConfigMock = jest.fn().mockResolvedValue({ min_content_length: 5, max_content_length: 20 });
    const fakeClient = {
      assistants: { list: jest.fn() },
      skills: { getConfig: getConfigMock },
    } as unknown as CodeMieClient;
    mockedCreateClient.mockResolvedValue(fakeClient);
    mockLoaderInstance.loadSkillContent
      .mockReturnValueOnce('short')
      .mockReturnValueOnce('this content is definitely too long for the configured limit');
    mockedValidateSkillContentLengths.mockReturnValue([
      '❌ Skill "skill-b" content length is 62 characters\n   💡 Allowed range: 5-20 characters',
    ]);

    const result = await validateConfig({ ...validateOptions, checkApi: true });

    expect(getConfigMock).toHaveBeenCalledTimes(1);
    expect(mockedValidateSkillContentLengths).toHaveBeenCalledWith(
      [
        { name: 'skill-a', content: 'short' },
        { name: 'skill-b', content: 'this content is definitely too long for the configured limit' },
      ],
      { min_content_length: 5, max_content_length: 20 }
    );
    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      '❌ Skill "skill-b" content length is 62 characters\n   💡 Allowed range: 5-20 characters'
    );
  });

  it('checks content length for an inline-content skill without reading any file', async () => {
    mockConfig.resources.skills = [
      { name: 'inline-skill', description: 'A valid description', content: 'inline body' },
    ];
    const getConfigMock = jest.fn().mockResolvedValue({ min_content_length: 5, max_content_length: 20 });
    const fakeClient = {
      assistants: { list: jest.fn() },
      skills: { getConfig: getConfigMock },
    } as unknown as CodeMieClient;
    mockedCreateClient.mockResolvedValue(fakeClient);

    const result = await validateConfig({ ...validateOptions, checkApi: true });

    expect(mockLoaderInstance.loadSkillContent).not.toHaveBeenCalled();
    expect(mockedValidateSkillContentLengths).toHaveBeenCalledWith([{ name: 'inline-skill', content: 'inline body' }], {
      min_content_length: 5,
      max_content_length: 20,
    });
    expect(result.success).toBe(true);
  });
});
