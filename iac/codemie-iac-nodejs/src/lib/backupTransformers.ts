/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Integration, MCPServerDetails, ToolDetails, ToolKitDetails } from 'codemie-sdk';
import * as yaml from 'yaml';

import type {
  AssistantResource,
  AssistantWithSkills,
  DatasourceResource,
  IaCMcpServer,
  IaCTool,
  IaCToolkit,
  ImportedResource,
  IntegrationReference,
  SkillResource,
  StateFile,
  WorkflowResource,
} from '../types/codemieConfig';

import { calculateAssistantConfigChecksum, calculateChecksum } from './checksumUtils';
import {
  calculateCompanionFilesChecksum,
  calculateDatasourceConfigChecksum,
  calculateWorkflowConfigChecksum,
  calculateSkillConfigChecksum,
} from './codemieConfigChecksums';
import {
  assistantResponseToResource,
  datasourceResponseToResource,
  workflowResponseToResource,
  skillResponseToResource,
  type AssistantResponse,
  type DatasourceResponse,
  type WorkflowResponse,
  type SkillResponse,
} from './converters';
import { ensureDirectoryExists, sanitizeFileName, skillMarkdownRelativePath } from './fileUtils';
import { logger } from './logger';
import { sanitizeMcpServer } from './mcpSanitizer';
import { collectCompanionFiles, type CompanionFile } from './skillCompanionFiles';
import { isProjectOwnedSkill } from './skillUtils';
import { hasName, hasSettingId, isResolvedIntegration } from './typeGuards';

/**
 * Transform integration settings to use $ref or replace openapi_spec with file reference
 */
function transformIntegrationSettings(
  settings: Integration,
  integrationIdToAlias: Map<string, string>,
  integrationSpecPaths?: Map<string, string>,
  contextLabel = 'integration'
): IntegrationReference {
  const integrationId = settings.id;
  const alias = settings.alias || (integrationId && integrationIdToAlias.get(integrationId));

  if (alias) {
    return { $ref: `imported.integrations.${alias}` };
  }

  if (integrationId) {
    logger.warn(`    ⚠️  No alias found for ${contextLabel} ${integrationId}, keeping full settings`);

    const specPath = integrationSpecPaths?.get(integrationId);
    if (specPath && settings.credential_values) {
      return {
        ...settings,
        credential_values: settings.credential_values.map((cred) =>
          cred.key === 'openapi_spec' ? { key: 'openapi_spec', value: specPath } : cred
        ),
      };
    }
  }

  return settings;
}

export function transformTool(
  tool: ToolDetails,
  integrationIdToAlias: Map<string, string>,
  integrationSpecPaths?: Map<string, string>
): IaCTool {
  const result: IaCTool = {
    name: tool.name,
    settings_config: tool.settings_config,
  };

  if (tool.label !== undefined && tool.label !== null) {
    result.label = tool.label;
  }

  if (tool.settings) {
    result.settings = transformIntegrationSettings(tool.settings, integrationIdToAlias, integrationSpecPaths, 'tool');
  }

  return result;
}

export function transformMcpServer(mcp: MCPServerDetails, integrationIdToAlias: Map<string, string>): IaCMcpServer {
  // Pass-through so fields added to MCPServerDetails reach the backup without a code change.
  // The cast is required: IaCMcpServer is a closed type a raw MCPServerDetails does not satisfy.
  const result = { ...mcp } as IaCMcpServer;

  if (mcp.settings && isResolvedIntegration(mcp.settings)) {
    const alias = mcp.settings.alias || integrationIdToAlias.get(mcp.settings.id);

    if (alias) {
      result.settings = { $ref: `imported.integrations.${alias}` };
    } else {
      logger.warn(`    ⚠️  No alias found for MCP integration ${mcp.settings.id}, keeping full settings`);
      result.settings = mcp.settings;
    }
  } else if (mcp.settings) {
    result.settings = mcp.settings;
  }

  if (result.mcp_connect_auth_token && isResolvedIntegration(result.mcp_connect_auth_token)) {
    const authAlias = result.mcp_connect_auth_token.alias || integrationIdToAlias.get(result.mcp_connect_auth_token.id);

    if (authAlias) {
      result.mcp_connect_auth_token = { $ref: `imported.integrations.${authAlias}` };
    } else {
      logger.warn(
        `    ⚠️  No alias found for MCP auth token integration ${result.mcp_connect_auth_token.id}, keeping full object`
      );
    }
  }

  return sanitizeMcpServer(result);
}

export function transformToolkits(
  toolkits: ToolKitDetails[] | undefined,
  integrationIdToAlias: Map<string, string>,
  integrationSpecPaths?: Map<string, string>
): IaCToolkit[] | undefined {
  return toolkits?.map(({ toolkit, tools, label, settings_config, is_external, settings }) => ({
    toolkit,
    tools: tools.map((tool) => transformTool(tool, integrationIdToAlias, integrationSpecPaths)),
    label,
    settings_config,
    is_external,
    ...(settings
      ? {
          settings: transformIntegrationSettings(settings, integrationIdToAlias, integrationSpecPaths, 'toolkit'),
        }
      : {}),
  }));
}

export function prepareAssistantForYaml(
  assistant: AssistantResponse,
  state: StateFile,
  integrationIdToAlias: Map<string, string>,
  integrationSpecPaths: Map<string, string>,
  skillIdToName: Map<string, string> = new Map()
): AssistantResource {
  // Transform SDK toolkits/mcp_servers to IaC format (with $ref)
  const transformedToolkits = transformToolkits(assistant.toolkits, integrationIdToAlias, integrationSpecPaths);
  const transformedMcpServers = assistant.mcp_servers?.map((mcp) => transformMcpServer(mcp, integrationIdToAlias));

  // Resolve skill_ids to skill names for IaC YAML
  const assistantData = assistant as AssistantWithSkills;
  const resolvedSkillNames =
    assistantData.skill_ids && assistantData.skill_ids.length > 0
      ? assistantData.skill_ids
          .map((id: string) => skillIdToName.get(id))
          .filter((name): name is string => Boolean(name))
      : undefined;

  // Build AssistantResource with transformed data
  const finalAssistant: AssistantResource = {
    ...assistantResponseToResource(assistant),
    ...(transformedToolkits && { toolkits: transformedToolkits }),
    ...(transformedMcpServers && { mcp_servers: transformedMcpServers }),
    ...(resolvedSkillNames && resolvedSkillNames.length > 0 && { skills: resolvedSkillNames }),
  };

  state.resources.assistants[assistant.name] = {
    id: assistant.id,
    lastDeployed: new Date().toISOString(),
    promptChecksum: calculateChecksum(assistant.system_prompt || ''),
    configChecksum: calculateAssistantConfigChecksum(finalAssistant),
  };

  return finalAssistant;
}

export function prepareDatasourceForYaml(
  datasource: DatasourceResponse,
  state: StateFile,
  integrationIdToAlias: Map<string, string>
): DatasourceResource {
  const settingId = hasSettingId(datasource) ? String(datasource.setting_id || '') : '';
  const integrationAlias = integrationIdToAlias.get(settingId);
  const finalDatasource = datasourceResponseToResource(datasource, integrationAlias);

  state.resources.datasources[datasource.name] = {
    id: datasource.id,
    lastDeployed: new Date().toISOString(),
    configChecksum: calculateDatasourceConfigChecksum(finalDatasource),
  };

  return finalDatasource;
}

export function prepareWorkflowForYaml(
  workflow: WorkflowResponse,
  state: StateFile,
  assistants: AssistantResponse[],
  backupDir: string
): WorkflowResource {
  const resource = workflowResponseToResource(workflow);
  const yamlConfig = workflow.yaml_config;
  let finalYamlContent = yamlConfig || '';

  if (yamlConfig) {
    try {
      const workflowYaml = yaml.parse(yamlConfig) as {
        assistants?: Record<string, unknown>[];
        states?: unknown[];
      };

      const transformedAssistants = workflowYaml.assistants?.map((assistant) => {
        if (assistant.assistant_id && typeof assistant.assistant_id === 'string') {
          const assistantId = assistant.assistant_id;
          const matchedAssistant = assistants.find(({ id }) => id === assistantId);

          if (matchedAssistant && hasName(matchedAssistant)) {
            const { assistant_id: _assistantId, ...rest } = assistant;
            return { ...rest, assistant_name: matchedAssistant.name };
          }
        }
        return assistant;
      });

      if (transformedAssistants) {
        const transformedYaml = { ...workflowYaml, assistants: transformedAssistants };
        const fileName = `${sanitizeFileName(workflow.name)}.yaml`;
        const filePath = path.join(backupDir, 'workflows', fileName);
        ensureDirectoryExists(filePath);
        finalYamlContent = yaml.stringify(transformedYaml);
        fs.writeFileSync(filePath, finalYamlContent, 'utf8');
      }
    } catch (error) {
      logger.warn(
        `    ⚠️  Failed to transform workflow YAML for ${workflow.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  state.resources.workflows[workflow.name] = {
    id: workflow.id,
    lastDeployed: new Date().toISOString(),
    workflowYamlChecksum: calculateChecksum(finalYamlContent),
    configChecksum: calculateWorkflowConfigChecksum(resource),
  };

  return resource;
}

export function collectReferencedSkillIds(assistants: AssistantResponse[]): Set<string> {
  const referencedSkillIds = new Set<string>();

  for (const assistant of assistants) {
    const assistantData = assistant as AssistantWithSkills;
    for (const skillId of assistantData.skill_ids || []) {
      referencedSkillIds.add(skillId);
    }
  }

  return referencedSkillIds;
}

export function partitionSkillsForBackupYaml(
  skills: SkillResponse[],
  projectName: string,
  referencedSkillIds: Set<string>
): { ownedSkills: SkillResponse[]; importedSkills: SkillResponse[] } {
  const ownedSkills: SkillResponse[] = [];
  const importedSkills: SkillResponse[] = [];

  for (const skill of skills) {
    if (isProjectOwnedSkill(skill, projectName)) {
      ownedSkills.push(skill);
      continue;
    }

    if (referencedSkillIds.has(skill.id)) {
      importedSkills.push(skill);
    }
  }

  return { ownedSkills, importedSkills };
}

export function prepareImportedSkillForYaml(skill: SkillResponse): ImportedResource {
  return {
    name: skill.name,
    id: skill.id,
  };
}

export function prepareSkillForYaml(skill: SkillResponse, state: StateFile, backupDir?: string): SkillResource {
  const resource = skillResponseToResource(skill);
  let companionFiles: CompanionFile[] = [];

  // A skill with companion files is restored as a SKILL.md-plus-companions directory rather
  // than a single flat file, so a redeploy of this backup collects its companions again (the
  // same basename-keyed mechanism `hasCompanionFileLayout` already uses — no second one).
  if (resource.file && (skill.companion_files?.length ?? 0) > 0) {
    resource.file = skillMarkdownRelativePath(skill.name);

    // Checksum the companion bytes backup has already written, read back through the very
    // collector deploy/preview use — otherwise a restored backup reports every companion-bearing
    // skill as changed on its first deploy.
    if (backupDir) {
      const skillDir = path.join(backupDir, path.dirname(resource.file));
      if (fs.existsSync(skillDir)) {
        companionFiles = collectCompanionFiles(skillDir);
      }
    }
  }

  if (!state.resources.skills) {
    state.resources.skills = {};
  }
  state.resources.skills[skill.name] = {
    id: skill.id,
    lastDeployed: new Date().toISOString(),
    contentChecksum: calculateChecksum(skill.content || ''),
    configChecksum: calculateSkillConfigChecksum(resource),
    // Omitted entirely for a companion-less skill, so its state entry stays exactly as before.
    ...(companionFiles.length > 0 ? calculateCompanionFilesChecksum(companionFiles) : {}),
  };

  return resource;
}
