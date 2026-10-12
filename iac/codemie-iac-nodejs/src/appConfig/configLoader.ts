/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AppConfig, ExternalAppConfig } from './configSchema';
import { appConfigSchema, externalConfigSchema } from './configSchema';
import { defaultConfig } from './defaultConfig';
import { logger } from '../lib/logger';

const PROJECT_MARKER_FILE = 'codemie.yaml';

/**
 * Resolve the effective app config. `rootDir` priority, highest first:
 * 1. `rootDir` declared by the `-c` config file (that file stays authoritative wherever it
 *    actually sets a value),
 * 2. an explicit `--root-dir` argument, resolved to an absolute path — `-c` and `-d` are
 *    independent, so a config file that carries no `rootDir` no longer swallows `-d`,
 * 3. the project root detected by walking up from the working directory (never reached when
 *    a `-c` file is given),
 * 4. the default config.
 */
export function loadAppConfig(userConfigPath?: string, rootDir?: string): AppConfig {
  if (userConfigPath) {
    const userConfig = loadUserConfig(userConfigPath);
    const sanitizedUserConfig = removeEmptyFields(userConfig);
    const merged = { ...defaultConfig, ...sanitizedUserConfig };

    if (sanitizedUserConfig.rootDir === undefined && rootDir) {
      merged.rootDir = path.resolve(rootDir);
    }

    return appConfigSchema.parse(merged);
  }

  if (rootDir) {
    return { ...defaultConfig, rootDir: path.resolve(rootDir) };
  }

  const detectedRoot = findProjectRoot(process.cwd());
  if (detectedRoot) {
    logger.info(`Using detected project root: ${detectedRoot}`);
    return { ...defaultConfig, rootDir: detectedRoot };
  }

  return defaultConfig;
}

function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(dir, PROJECT_MARKER_FILE))) {
      return dir;
    }

    const parentDir = path.dirname(dir);
    if (parentDir === dir || dir === path.parse(dir).root) {
      return null;
    }

    dir = parentDir;
  }
}

function loadUserConfig(configPath: string): ExternalAppConfig {
  const resolvedPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read config file: ${resolvedPath}`, { cause: error });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON in config file: ${resolvedPath}`, { cause: error });
  }

  try {
    return externalConfigSchema.parse(json);
  } catch (error) {
    throw new Error(`Invalid config structure: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function removeEmptyFields(userConfig: ExternalAppConfig): ExternalAppConfig {
  return Object.fromEntries(
    Object.entries(userConfig).filter(([_, value]) => {
      if (value === null || value === undefined) {
        return false;
      }
      return value.trim() !== '';
    })
  ) as ExternalAppConfig;
}
