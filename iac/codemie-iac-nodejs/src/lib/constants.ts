/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 100,
  DEFAULT_PAGE: 0,
} as const;

export const TIMEOUTS_MS = {
  ASSISTANT_FETCH: 30_000,
  DATASOURCE_FETCH: 30_000,
  WORKFLOW_FETCH: 30_000,
  INTEGRATION_FETCH: 30_000,
  SKILL_FETCH: 30_000,
} as const;

export const RATE_LIMITING = {
  MAX_CONCURRENT_REQUESTS: 5,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const;

export const BACKUP = {
  TEMP_DIR_PREFIX: '.temp-',
  MIN_DISK_SPACE_GB: 1,
  TRANSACTION_SAVE_TIMEOUT_MS: 5000,
} as const;
