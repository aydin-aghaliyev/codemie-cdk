/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AppConfig } from '../appConfig';
import type {
  StateFile,
  AssistantState,
  DatasourceState,
  WorkflowState,
  SkillState,
  DatasourceResource,
  AssistantResource,
  SkillResource,
} from '../types/codemieConfig';

import { calculateChecksum, calculateAssistantConfigChecksum } from './checksumUtils';
import {
  calculateDatasourceConfigChecksum,
  calculateSkillConfigChecksum,
  calculateCompanionFilesChecksum,
} from './codemieConfigChecksums';
import type { CompanionFile } from './skillCompanionFiles';

export type ResourceType = 'assistant' | 'datasource' | 'workflow';

export class StateManager {
  private readonly statePath: string;

  constructor(appConfig: AppConfig) {
    const { rootDir, codemieState } = appConfig;
    this.statePath = path.join(rootDir, codemieState);
  }

  /**
   * Load state file
   */
  loadState(): StateFile {
    if (!fs.existsSync(this.statePath)) {
      return this.createEmptyState();
    }

    const content = fs.readFileSync(this.statePath, 'utf8');
    const state = JSON.parse(content) as StateFile;

    // Ensure resources structure exists
    if (!state.resources) {
      state.resources = {
        assistants: {},
        datasources: {},
        workflows: {},
        skills: {},
      };
    }
    if (!state.resources.assistants) {
      state.resources.assistants = {};
    }
    if (!state.resources.datasources) {
      state.resources.datasources = {};
    }
    if (!state.resources.workflows) {
      state.resources.workflows = {};
    }
    if (!state.resources.skills) {
      state.resources.skills = {};
    }

    return state;
  }

  /**
   * Save state file
   */
  saveState(state: StateFile): void {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    state.lastSync = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Create empty state structure
   */
  private createEmptyState(): StateFile {
    return {
      version: '1.0',
      project: '',
      lastSync: null,
      resources: {
        assistants: {},
        datasources: {},
        workflows: {},
        skills: {},
      },
    };
  }

  /**
   * Update assistant state (keyed by NAME)
   * @param name
   * @param id
   * @param promptContent
   * @param assistantResource - The assistant resource object (used to calculate consistent checksum)
   * @param buildConfig - Optional build-time configuration
   */
  updateAssistantState(
    name: string,
    id: string,
    promptContent: string,
    assistantResource: AssistantResource,
    buildConfig: unknown = null
  ): void {
    const state = this.loadState();

    state.resources.assistants[name] = {
      id,
      lastDeployed: new Date().toISOString(),
      promptChecksum: calculateChecksum(promptContent),
      configChecksum: calculateAssistantConfigChecksum(assistantResource, buildConfig),
    };

    this.saveState(state);
  }

  /**
   * Get assistant state by NAME
   */
  getAssistantState(name: string): AssistantState | undefined {
    const state = this.loadState();
    return state.resources.assistants[name];
  }

  /**
   * Delete assistant state by NAME
   */
  deleteAssistantState(name: string): void {
    const state = this.loadState();
    delete state.resources.assistants[name];
    this.saveState(state);
  }

  /**
   * Update datasource state (keyed by NAME)
   * @param datasourceResource - The datasource resource object (used to calculate consistent checksum)
   */
  updateDatasourceState(name: string, id: string, datasourceResource: DatasourceResource): void {
    const state = this.loadState();

    state.resources.datasources[name] = {
      id,
      lastDeployed: new Date().toISOString(),
      configChecksum: calculateDatasourceConfigChecksum(datasourceResource),
    };

    this.saveState(state);
  }

  /**
   * Get datasource state by NAME
   */
  getDatasourceState(name: string): DatasourceState | undefined {
    const state = this.loadState();
    return state.resources.datasources[name];
  }

  /**
   * Delete datasource state by NAME
   */
  deleteDatasourceState(name: string): void {
    const state = this.loadState();
    delete state.resources.datasources[name];
    this.saveState(state);
  }

  /**
   * Update workflow state (keyed by NAME)
   */
  updateWorkflowState(name: string, id: string, workflowYamlChecksum: string, configChecksum: string): void {
    const state = this.loadState();

    state.resources.workflows[name] = {
      id,
      lastDeployed: new Date().toISOString(),
      workflowYamlChecksum,
      configChecksum,
    };

    this.saveState(state);
  }

  /**
   * Get workflow state by NAME
   */
  getWorkflowState(name: string): WorkflowState | undefined {
    const state = this.loadState();
    return state.resources.workflows[name];
  }

  /**
   * Delete workflow state by NAME
   */
  deleteWorkflowState(name: string): void {
    const state = this.loadState();
    delete state.resources.workflows[name];
    this.saveState(state);
  }

  /**
   * Get all managed resources (for cleanup/destroy)
   * Returns: { assistants: [name1, name2], datasources: [name1], workflows: [name1], skills: [name1] }
   */
  getAllManagedResources(): {
    assistants: string[];
    datasources: string[];
    workflows: string[];
    skills: string[];
  } {
    const state = this.loadState();
    return {
      assistants: Object.keys(state.resources.assistants),
      datasources: Object.keys(state.resources.datasources),
      workflows: Object.keys(state.resources.workflows),
      skills: Object.keys(state.resources.skills || {}),
    };
  }

  /**
   * Check if a resource is managed by IaC (exists in state.json)
   * @param type Resource type ('assistant', 'datasource', 'workflow', 'skill')
   * @param name Resource name
   */
  isManagedResource(type: 'assistant' | 'datasource' | 'workflow' | 'skill', name: string): boolean {
    const state = this.loadState();

    switch (type) {
      case 'assistant': {
        return name in state.resources.assistants;
      }
      case 'datasource': {
        return name in state.resources.datasources;
      }
      case 'workflow': {
        return name in state.resources.workflows;
      }
      case 'skill': {
        return name in (state.resources.skills || {});
      }
      default: {
        return false;
      }
    }
  }

  /**
   * Get ID by name for a specific resource type
   */
  getIdByName(type: 'assistant' | 'datasource' | 'workflow' | 'skill', name: string): string | undefined {
    const state = this.loadState();

    switch (type) {
      case 'assistant': {
        return state.resources.assistants[name]?.id;
      }
      case 'datasource': {
        return state.resources.datasources[name]?.id;
      }
      case 'workflow': {
        return state.resources.workflows[name]?.id;
      }
      case 'skill': {
        return (state.resources.skills || {})[name]?.id;
      }
      default: {
        return undefined;
      }
    }
  }

  /**
   * Update skill state (keyed by NAME)
   */
  updateSkillState(
    name: string,
    id: string,
    content: string,
    skillResource: SkillResource,
    companionFiles?: CompanionFile[]
  ): void {
    const state = this.loadState();
    if (!state.resources.skills) {
      state.resources.skills = {};
    }
    state.resources.skills[name] = {
      id,
      lastDeployed: new Date().toISOString(),
      contentChecksum: calculateChecksum(content),
      configChecksum: calculateSkillConfigChecksum(skillResource),
      // Persisted for group selection (`deploy --replace-skill-group`) only. The group label stays out
      // of configChecksum on purpose, so relabelling a skill never marks it as changed.
      ...(skillResource.group !== undefined ? { group: skillResource.group } : {}),
      // Only written when companionFiles is passed, so an older/companion-less entry has
      // neither key at all — the absence itself is what Tasks 10/11 read as "no companion files".
      ...(companionFiles ? calculateCompanionFilesChecksum(companionFiles) : {}),
    };
    this.saveState(state);
  }

  /**
   * Get skill state by NAME
   */
  getSkillState(name: string): SkillState | undefined {
    const state = this.loadState();
    return (state.resources.skills || {})[name];
  }

  /**
   * Delete skill state by NAME
   */
  deleteSkillState(name: string): void {
    const state = this.loadState();
    if (state.resources.skills) {
      delete state.resources.skills[name];
    }
    this.saveState(state);
  }
}
