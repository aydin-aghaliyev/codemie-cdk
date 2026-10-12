/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { CodeMieClient } from 'codemie-sdk';

import type { StateManager } from './stateManager';

/**
 * Generic function to check if a resource exists on platform by ID from state
 */
async function checkResourceExists(
  getState: () => { id: string } | null | undefined,
  getResource: (id: string) => Promise<unknown>
): Promise<boolean> {
  const existingState = getState();
  if (!existingState) {
    return false;
  }

  try {
    await getResource(existingState.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if assistant exists on platform by ID from state
 */
export function checkAssistantExists(
  client: CodeMieClient,
  name: string,
  stateManager: StateManager
): Promise<boolean> {
  return checkResourceExists(
    () => stateManager.getAssistantState(name),
    (id) => client.assistants.get(id)
  );
}

/**
 * Check if datasource exists on platform by ID from state
 */
export function checkDatasourceExists(
  client: CodeMieClient,
  name: string,
  stateManager: StateManager
): Promise<boolean> {
  return checkResourceExists(
    () => stateManager.getDatasourceState(name),
    (id) => client.datasources.get(id)
  );
}

/**
 * Check if workflow exists on platform by ID from state
 */
export function checkWorkflowExists(client: CodeMieClient, name: string, stateManager: StateManager): Promise<boolean> {
  return checkResourceExists(
    () => stateManager.getWorkflowState(name),
    (id) => client.workflows.get(id)
  );
}

/**
 * Check if skill exists on platform by ID from state
 */
export function checkSkillExists(client: CodeMieClient, name: string, stateManager: StateManager): Promise<boolean> {
  return checkResourceExists(
    () => stateManager.getSkillState(name),
    (id) => client.skills.get(id)
  );
}
