/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'yaml';

import type { IntegrationDefinition, StateFile } from '../types/codemieConfig';

import {
  prepareAssistantForYaml,
  prepareDatasourceForYaml,
  prepareWorkflowForYaml,
  prepareSkillForYaml,
  prepareImportedSkillForYaml,
  collectReferencedSkillIds,
  partitionSkillsForBackupYaml,
} from './backupTransformers';
import type { AssistantResponse, DatasourceResponse, WorkflowResponse, SkillResponse } from './converters';
import { logger } from './logger';

type IntegrationResponse = {
  id: string;
  alias?: string;
  credential_type: string;
  project_name: string;
  setting_type: string;
  credential_values?: Array<{ key: string; value: unknown }>;
};

export interface BackupData {
  metadata: {
    timestamp: string;
    projectName: string;
    codemieApiUrl: string;
  };
  resources: {
    assistants: AssistantResponse[];
    datasources: DatasourceResponse[];
    workflows: WorkflowResponse[];
    integrations: IntegrationResponse[];
    skills: SkillResponse[];
  };
  state: StateFile;
}

// eslint-disable-next-line max-lines-per-function
export function generateCodemieYaml(
  backup: BackupData,
  projectName: string,
  backupDir: string,
  integrationSpecPaths: Map<string, string> = new Map()
): string {
  const integrationIdToAlias = new Map<string, string>();
  const integrationArray: IntegrationDefinition[] = [];

  // Build skill ID → name lookup for assistant skill_ids resolution
  const skillIdToName = new Map<string, string>(backup.resources.skills.map((skill) => [skill.id, skill.name]));
  const referencedSkillIds = collectReferencedSkillIds(backup.resources.assistants);
  const { ownedSkills, importedSkills } = partitionSkillsForBackupYaml(
    backup.resources.skills,
    projectName,
    referencedSkillIds
  );

  for (const integration of backup.resources.integrations) {
    const credentialType = integration.credential_type || 'integration';
    const alias = integration.alias || `${String(credentialType).toLowerCase()}_${integration.id.slice(0, 8)}`;
    integrationIdToAlias.set(integration.id, alias);

    const specPath = integrationSpecPaths.get(integration.id);
    let credentialValues = integration.credential_values;

    if (specPath && credentialValues) {
      credentialValues = credentialValues.map((cred) =>
        cred.key === 'openapi_spec' ? { key: 'openapi_spec', value: specPath } : cred
      );
    }

    integrationArray.push({
      id: integration.id,
      alias,
      credential_type: integration.credential_type,
      project_name: integration.project_name,
      setting_type: integration.setting_type,
      ...(credentialValues && { credential_values: credentialValues }),
    } as IntegrationDefinition);
  }

  const config = {
    version: '1',
    project: {
      name: projectName,
      description: `Backup from ${backup.metadata.timestamp}`,
    },
    environment: {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      codemie_api_url: '${CODEMIE_API_URL}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      auth_server_url: '${CODEMIE_AUTH_URL}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      auth_realm_name: '${CODEMIE_REALM:-codemie}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      client_id: '${CODEMIE_CLIENT_ID:-}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      client_secret: '${CODEMIE_CLIENT_SECRET:-}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      username: '${CODEMIE_USERNAME:-}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Not a template, but exact formatting
      password: '${CODEMIE_PASSWORD:-}',
    },
    imported: {
      assistants: [],
      datasources: [],
      skills: importedSkills.map((skill) => prepareImportedSkillForYaml(skill)),
      integrations: integrationArray,
    },
    datasource_defaults: {
      code: { type: 'code', index_type: 'code', embeddings_model: 'ada-002', shared_with_project: true },
      knowledge_base_confluence: {
        type: 'knowledge_base_confluence',
        embeddings_model: 'ada-002',
        shared_with_project: true,
      },
      knowledge_base_jira: { type: 'knowledge_base_jira', embeddings_model: 'ada-002', shared_with_project: true },
    },
    resources: {
      assistants: backup.resources.assistants.map((assistant) =>
        prepareAssistantForYaml(assistant, backup.state, integrationIdToAlias, integrationSpecPaths, skillIdToName)
      ),
      datasources: backup.resources.datasources.map((datasource) =>
        prepareDatasourceForYaml(datasource, backup.state, integrationIdToAlias)
      ),
      workflows: backup.resources.workflows.map((workflow) =>
        prepareWorkflowForYaml(workflow, backup.state, backup.resources.assistants, backupDir)
      ),
      ...(ownedSkills.length > 0 && {
        skills: ownedSkills.map((skill) => prepareSkillForYaml(skill, backup.state, backupDir)),
      }),
    },
  };

  return yaml.stringify(config);
}

export function saveIntegrationOpenApiSpecs(backupData: BackupData, backupDir: string): Map<string, string> {
  const specsDir = path.join(backupDir, 'openapi_specs');
  let specsCount = 0;
  const integrationSpecPaths = new Map<string, string>();

  for (const integration of backupData.resources.integrations) {
    if (integration.credential_type !== 'OpenAPI' || !integration.credential_values) {
      continue;
    }

    const specEntry = integration.credential_values.find(
      (cv: { key: string; value: unknown }) => cv.key === 'openapi_spec'
    );

    if (specEntry && typeof specEntry.value === 'string' && specEntry.value) {
      const alias = integration.alias || integration.id;
      const fileName = String(alias)
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-');

      if (!fs.existsSync(specsDir)) {
        fs.mkdirSync(specsDir, { recursive: true });
      }

      const specContent = specEntry.value;
      let fileExtension = '.yaml';
      let contentToSave = specContent;

      try {
        const parsed = JSON.parse(specContent) as unknown;
        fileExtension = '.json';
        contentToSave = JSON.stringify(parsed, null, 2);
      } catch {
        fileExtension = '.yaml';
      }

      const specFileName = `${fileName}${fileExtension}`;
      const specPath = path.join(specsDir, specFileName);
      fs.writeFileSync(specPath, contentToSave, 'utf8');

      integrationSpecPaths.set(integration.id, `openapi_specs/${specFileName}`);
      specsCount++;
    }
  }

  if (specsCount > 0) {
    logger.info(`   ✓ Saved ${specsCount} integration OpenAPI spec(s)`);
  }

  return integrationSpecPaths;
}

export function saveBackupFiles(backupData: BackupData, backupDir: string, projectName: string): void {
  logger.info('💾 Writing backup files...\n');

  const integrationSpecPaths = saveIntegrationOpenApiSpecs(backupData, backupDir);

  const codemieYamlPath = path.join(backupDir, 'codemie.yaml');
  const codemieYaml = generateCodemieYaml(backupData, projectName, backupDir, integrationSpecPaths);
  fs.writeFileSync(codemieYamlPath, codemieYaml, 'utf8');
  logger.info(`   ✓ Saved config file: codemie.yaml`);

  const backupJsonPath = path.join(backupDir, 'backup.json');
  fs.writeFileSync(backupJsonPath, JSON.stringify(backupData, null, 2), 'utf8');
  logger.info(`   ✓ Saved full backup: backup.json`);

  const statePath = path.join(backupDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(backupData.state, null, 2), 'utf8');
  logger.info(`   ✓ Saved state file: state.json`);
}
