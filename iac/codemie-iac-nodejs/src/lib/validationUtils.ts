/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import type { Assistant, CodeMieClient } from 'codemie-sdk';

import type { AssistantState, CodemieConfig, SkillResource } from '../types/codemieConfig';

/**
 * Minimum allowed length for a skill description
 */
export const MIN_SKILL_DESCRIPTION_LENGTH = 10;

/**
 * Maximum allowed length for a skill description
 */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1000;

/**
 * Type guard for Assistant with slug
 */
export function isAssistantWithSlug(obj: unknown): obj is { slug: string; name: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'slug' in obj &&
    'name' in obj &&
    typeof (obj as { slug: unknown }).slug === 'string' &&
    typeof (obj as { name: unknown }).name === 'string'
  );
}

/**
 * Type guard for Assistant type from SDK
 */
export function isAssistant(obj: unknown): obj is Assistant {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'slug' in obj;
}

/**
 * Validate slug uniqueness within configuration
 */
export function validateSlugUniqueness(config: CodemieConfig): string[] {
  const slugErrors: string[] = [];
  const slugMap = new Map<string, string[]>();

  if (config.resources.assistants) {
    for (const assistant of config.resources.assistants) {
      if (assistant.slug) {
        if (!slugMap.has(assistant.slug)) {
          slugMap.set(assistant.slug, []);
        }
        slugMap.get(assistant.slug)!.push(assistant.name);
      }
    }
  }

  for (const [slug, names] of slugMap.entries()) {
    if (names.length > 1) {
      slugErrors.push(`Duplicate slug "${slug}" for assistants: ${names.join(', ')}`);
    }
  }

  return slugErrors;
}

/**
 * Check for slug conflicts with existing assistants on the platform
 */
export async function checkApiSlugConflicts({
  config,
  client,
  assistantState,
}: {
  config: CodemieConfig;
  client: CodeMieClient;
  assistantState: Record<string, AssistantState>;
}): Promise<string[]> {
  const existingAssistants = await client.assistants.list({
    minimal_response: false,
    per_page: 100,
  });
  const existingSlugs = new Map<string, string>();

  for (const assistant of existingAssistants) {
    if (isAssistantWithSlug(assistant) && assistant.slug) {
      existingSlugs.set(assistant.slug, assistant.name);
    }
  }

  const conflictErrors: string[] = [];
  const iacAssistantNames = new Set(Object.keys(assistantState));

  if (config.resources.assistants) {
    for (const assistant of config.resources.assistants) {
      if (!assistant.slug || iacAssistantNames.has(assistant.name)) {
        continue;
      }

      if (existingSlugs.has(assistant.slug)) {
        const existingName = existingSlugs.get(assistant.slug);
        const existingAssistant = existingAssistants.find((a) => isAssistant(a) && a.slug === assistant.slug);

        conflictErrors.push(
          `❌ Slug "${assistant.slug}" for assistant "${assistant.name}" already exists in Codemie\n` +
            `   Existing assistant: "${existingName}" (ID: ${isAssistant(existingAssistant) ? existingAssistant.id : 'unknown'})\n` +
            `   💡 Change slug to a unique value or omit slug (platform will generate)`
        );
      }
    }
  }

  return conflictErrors;
}

/**
 * Validate that every skill's description length falls within the allowed range.
 * Offline, pure and never touches the network — content-length limits are validated
 * separately by validateSkillContentLengths using limits injected from the API.
 */
export function validateSkillDescriptions(skills: SkillResource[]): string[] {
  const errors: string[] = [];

  for (const skill of skills) {
    const length = skill.description?.length ?? 0;

    if (length < MIN_SKILL_DESCRIPTION_LENGTH || length > MAX_SKILL_DESCRIPTION_LENGTH) {
      errors.push(
        `❌ Skill "${skill.name}" description length is ${length} characters\n` +
          `   💡 Allowed range: ${MIN_SKILL_DESCRIPTION_LENGTH}-${MAX_SKILL_DESCRIPTION_LENGTH} characters`
      );
    }
  }

  return errors;
}

/**
 * Validate that every skill's content length falls within limits injected by the caller.
 * Pure and never touches the network — limits are read from client.skills.getConfig()
 * by the caller under --check-api and passed in here; this function never defines them.
 */
export function validateSkillContentLengths(
  entries: Array<{ name: string; content: string }>,
  limits: { min_content_length: number; max_content_length: number }
): string[] {
  const errors: string[] = [];

  for (const entry of entries) {
    const length = entry.content?.length ?? 0;

    if (length < limits.min_content_length || length > limits.max_content_length) {
      errors.push(
        `❌ Skill "${entry.name}" content length is ${length} characters\n` +
          `   💡 Allowed range: ${limits.min_content_length}-${limits.max_content_length} characters`
      );
    }
  }

  return errors;
}
