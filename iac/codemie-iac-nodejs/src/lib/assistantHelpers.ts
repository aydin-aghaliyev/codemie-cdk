/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { CodeMieClient, AssistantCreateParams } from 'codemie-sdk';

import { findAssistantByName } from './paginationUtils';

/**
 * Creates an assistant and retrieves its UUID
 *
 * Workaround for SDK's create() not returning the assistant ID.
 * Creates assistant, then fetches it by slug (if provided) or by name.
 *
 * @param client - Initialized Codemie client
 * @param params - Assistant creation parameters
 * @param slug - Optional assistant slug for lookup (platform-generated if not provided)
 * @returns Created assistant's UUID
 * @throws Error if assistant cannot be found after creation
 */
export async function createAssistantAndGetId(
  client: CodeMieClient,
  params: AssistantCreateParams,
  slug?: string | null
): Promise<string> {
  await client.assistants.create(params);

  if (slug) {
    const created = await client.assistants.getBySlug(slug);

    if (!created?.id) {
      throw new Error(`Assistant created but not found by slug: ${slug}`);
    }

    return created.id;
  }

  const assistantId = await findAssistantByName(client, params.name, {
    isGlobal: params.is_global === true,
  });

  if (!assistantId) {
    throw new Error(`Assistant created but not found by name: ${params.name}`);
  }

  return assistantId;
}
