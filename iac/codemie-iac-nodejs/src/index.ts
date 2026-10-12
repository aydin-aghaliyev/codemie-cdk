/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

// Export Core Classes
export { CodemieConfigLoader } from './lib/codemieConfigLoader';
export { StateManager } from './lib/stateManager';
export { createClient } from './lib/clientFactory';
export { CleanupManager } from './lib/cleanupManager';
export { logger, LogLevel } from './lib/logger';

// Export Types
export * from './types/codemieConfig';

// Export Core Logic Functions

/**
 * Deploy all resources (assistants, datasources, workflows) to Codemie platform
 * @param options - Deployment options including rootDir and dryRun flag
 * @returns Promise that resolves when deployment completes
 * @throws Error if deployment fails
 */
export { deployResources, deployAssistants, deployDatasources, deployWorkflows, deploySkills } from './deploy';

/**
 * Validate configuration file and optionally check for API conflicts
 * @param checkApi - Whether to check for slug conflicts with existing platform resources
 * @returns Promise with validation result containing success status and error messages
 */
export { validateConfig } from './validate';

/**
 * Preview changes that would be applied during deployment
 * @param existingClient - Optional pre-configured CodeMie client
 * @param configPath - Path to configuration file (defaults to 'codemie.yaml')
 * @returns Promise with changes array and summary statistics
 */
export { previewChanges } from './preview';

/**
 * Backup all resources from Codemie platform to local state
 * @param options - Backup options including rootDir
 * @returns Promise that resolves when backup completes
 * @throws Error if backup fails
 */
export { backupResources } from './backup';

/**
 * Import a single resource from the Codemie platform into the local IaC configuration
 * @param options - Import options including resourceType and slug
 * @returns Promise that resolves when import completes
 * @throws Error if import fails or resource not found
 */
export { importResource } from './import';
export type { ImportResourceType, ImportOptions } from './import';

/**
 * Destroy all resources managed by IaC (removes from platform and state)
 * @param options - Destroy options including rootDir and force flag
 * @returns Promise that resolves when destruction completes
 * @throws Error if destruction fails or is cancelled
 */
export { destroyResources } from './destroy';
