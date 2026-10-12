/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { CodeMieClient } from 'codemie-sdk';

import type { CodemieConfig } from '../types/codemieConfig';

/**
 * Creates and initializes a Codemie API client from config
 *
 * This factory function centralizes client creation to avoid code duplication
 * across multiple scripts (apply, preview, destroy, validate).
 *
 * @param config - Codemie IaC configuration containing environment settings
 * @returns Initialized CodeMieClient ready for API calls
 */
export async function createClient(config: CodemieConfig): Promise<CodeMieClient> {
  const client = new CodeMieClient({
    auth_server_url: config.environment.auth_server_url,
    auth_realm_name: config.environment.auth_realm_name,
    codemie_api_domain: config.environment.codemie_api_url,
    auth_client_id: config.environment.client_id,
    auth_client_secret: config.environment.client_secret,
    username: config.environment.username,
    password: config.environment.password,
    verify_ssl: true,
  });

  try {
    await client.initialize();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to initialize Codemie client (auth: ${config.environment.auth_server_url}, api: ${config.environment.codemie_api_url}): ${reason}`
    );
  }

  return client;
}
