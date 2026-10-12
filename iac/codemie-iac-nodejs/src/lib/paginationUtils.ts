/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { AssistantListParams } from 'codemie-sdk';

import { logger } from './logger';

/**
 * Pagination utilities for resource lookup
 *
 * Fixes the bug where .list({ per_page: 100 }) only returns first 100 resources,
 * causing newly created resources to not be found if platform has >100 resources total.
 */

/**
 * Find a resource by name with proper pagination support
 *
 * @param listFn - Function that calls the SDK list method (e.g., client.datasources.list)
 * @param name - Resource name to search for
 * @param resourceType - Type of resource for error messages (e.g., "datasource", "assistant")
 * @returns Resource object if found, null if not found
 *
 * @example
 * const datasource = await findResourceByName(
 *   (params) => client.datasources.list(params),
 *   "my-datasource",
 *   "datasource"
 * );
 */
export async function findResourceByName<T extends { name?: string; id?: string }>(
  listFn: (params: { page: number; per_page: number }) => Promise<T[]>,
  name: string,
  resourceType: string,
  options?: { silent?: boolean }
): Promise<T | null> {
  let page = 0;
  const perPage = 100;
  let totalChecked = 0;

  while (true) {
    const resources = await listFn({ page, per_page: perPage });
    totalChecked += resources.length;

    // Find matching resource by name
    const found = resources.find((r) => r.name === name);
    if (found && found.id) {
      return found;
    }

    // If less than perPage returned, we've reached the end
    if (resources.length < perPage) {
      if (!options?.silent) {
        logger.warn(
          `  ⚠️  ${resourceType} "${name}" not found after checking ${totalChecked} resources across ${page + 1} page(s)`
        );
      }
      return null;
    }

    page++;

    // Safety limit: stop after 1000 pages (100,000 resources)
    if (page > 1000) {
      if (!options?.silent) {
        logger.warn(`  ⚠️  Stopped pagination after 1000 pages (${totalChecked} resources checked)`);
      }
      return null;
    }
  }
}

/**
 * Find a datasource by name with proper pagination
 *
 * @param client - Initialized Codemie client
 * @param name - Datasource name to search for
 * @returns Datasource ID if found, null if not found
 *
 * @example
 * const datasourceId = await findDatasourceByName(client, "my-datasource");
 */
export async function findDatasourceByName(
  client: {
    datasources: {
      list: (params: { page: number; per_page: number }) => Promise<Array<{ name?: string; id?: string }>>;
    };
  },
  name: string
): Promise<string | null> {
  const datasource = await findResourceByName((params) => client.datasources.list(params), name, 'datasource');

  return datasource?.id || null;
}

/**
 * Find an assistant by name with proper pagination
 *
 * @param client - Initialized Codemie client
 * @param name - Assistant name to search for
 * @returns Assistant ID if found, null if not found
 */
export async function findAssistantByName(
  client: {
    assistants: { list: (params?: Partial<AssistantListParams>) => Promise<Array<{ name?: string; id?: string }>> };
  },
  name: string,
  options?: { isGlobal?: boolean }
): Promise<string | null> {
  const assistant = await findResourceByName(
    (params) => client.assistants.list(params),
    name,
    'assistant',
    options?.isGlobal ? { silent: true } : undefined
  );
  if (assistant?.id) {
    return assistant.id;
  }

  if (options?.isGlobal) {
    const marketplaceAssistant = await findResourceByName(
      (params) => client.assistants.list({ ...params, scope: 'marketplace' }),
      name,
      'assistant'
    );
    return marketplaceAssistant?.id || null;
  }

  return null;
}

/**
 * Find a workflow by exact name within a project, with proper pagination.
 *
 * Unlike findResourceByName this scans every page, because adopting the wrong
 * workflow is worse than failing: several same-name workflows in the project
 * are reported as an error instead of picking one.
 *
 * @param client - Initialized Codemie client
 * @param name - Workflow name to search for
 * @param project - Project the lookup is scoped to
 * @returns Workflow ID if exactly one matches, null if none match
 * @throws Error when more than one workflow in the project has this name
 */
export async function findWorkflowByName(
  client: {
    workflows: {
      list: (params: {
        page: number;
        per_page: number;
        projects?: string[];
      }) => Promise<Array<{ name?: string; id?: string }>>;
    };
  },
  name: string,
  project: string
): Promise<string | null> {
  const perPage = 100;
  const matches: string[] = [];
  let totalChecked = 0;
  let page = 0;

  while (true) {
    const workflows = (await client.workflows.list({ page, per_page: perPage, projects: [project] })) ?? [];
    totalChecked += workflows.length;

    for (const workflow of workflows) {
      if (workflow.name === name && workflow.id) {
        matches.push(workflow.id);
      }
    }

    if (workflows.length < perPage) {
      break;
    }

    page++;

    // Safety limit: stop after 1000 pages (100,000 resources). A truncated scan
    // cannot tell "no such workflow" from "beyond the scanned range", and the
    // caller would then create a duplicate, so fail closed instead.
    if (page > 1000) {
      throw new Error(
        `Workflow lookup for "${name}" in project "${project}" stopped after 1000 pages (${totalChecked} resources checked); refusing to create a possible duplicate`
      );
    }
  }

  if (matches.length > 1) {
    const ids = [...matches].sort((a, b) => a.localeCompare(b)).join(', ');
    throw new Error(`Multiple workflows named "${name}" in project "${project}": ${ids}`);
  }

  if (matches.length === 0) {
    logger.warn(
      `  ⚠️  workflow "${name}" not found after checking ${totalChecked} resources across ${page + 1} page(s)`
    );
    return null;
  }

  return matches[0];
}

type SkillListClient = {
  skills: {
    list: (params: { page: number; per_page: number }) => Promise<Array<{ name?: string; id?: string }> | undefined>;
  };
};

/**
 * Per-run skill name → id index.
 *
 * Lists every skill once, on the first lookup that misses, and answers every later
 * lookup from memory. Skills created during the run are added with record(), so they
 * resolve without another list call. Create one instance per deploy run.
 */
export class SkillNameIndex {
  private readonly ids = new Map<string, string>();
  private built = false;
  private scanned = { skills: 0, pages: 0 };

  constructor(private readonly client: SkillListClient) {}

  async find(name: string): Promise<string | null> {
    const known = this.ids.get(name);
    if (known) {
      return known;
    }

    if (!this.built) {
      await this.build();
      const id = this.ids.get(name);
      if (id) {
        return id;
      }
    }

    logger.warn(
      `  ⚠️  skill "${name}" not found after checking ${this.scanned.skills} resources across ${this.scanned.pages} page(s)`
    );
    return null;
  }

  record(name: string, id: string): void {
    this.ids.set(name, id);
  }

  private async build(): Promise<void> {
    const perPage = 100;
    let page = 0;
    let totalChecked = 0;

    while (true) {
      const skills = (await this.client.skills.list({ page, per_page: perPage })) ?? [];
      totalChecked += skills.length;

      for (const skill of skills) {
        // Merge on top: names recorded during this run keep their id
        if (skill.name && skill.id && !this.ids.has(skill.name)) {
          this.ids.set(skill.name, skill.id);
        }
      }

      if (skills.length < perPage) {
        break;
      }

      page++;

      // Safety limit: stop after 1000 pages (100,000 resources)
      if (page > 1000) {
        logger.warn(`  ⚠️  Stopped pagination after 1000 pages (${totalChecked} resources checked)`);
        break;
      }
    }

    this.built = true;
    this.scanned = { skills: totalChecked, pages: page + 1 };
  }
}

/**
 * Find a skill by name through a per-run SkillNameIndex
 *
 * @param index - Skill name index for the current deploy run
 * @param name - Skill name to search for
 * @returns Skill ID if found, null if not found
 */
export function findSkillByName(index: SkillNameIndex, name: string): Promise<string | null> {
  return index.find(name);
}
