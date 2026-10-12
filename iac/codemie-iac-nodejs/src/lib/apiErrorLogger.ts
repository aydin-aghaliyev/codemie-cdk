/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { logger } from './logger';

/**
 * Log the details of a failed API call in a consistent shape.
 *
 * Handles the SDK ApiError (statusCode + response) before the Axios shape
 * (response.status/data), so SDK errors never report `Status: undefined`.
 */
export function logApiErrorDetails(error: unknown): void {
  if (error instanceof Error) {
    logger.error(`     ${error.message}`);
    logger.debug(`     Stack:`, error.stack);
    // Handle SDK ApiError (uses statusCode + response, not Axios response.status/data)
    if ('statusCode' in error) {
      logger.error(`     Status: ${String(error.statusCode)}`);
      logger.error(`     Data: ${JSON.stringify('response' in error ? error.response : undefined, null, 2)}`);
    } else if ('response' in error) {
      const axiosError = error as { response: { status: number; data: unknown } };
      logger.error(`     Status: ${axiosError.response?.status}`);
      logger.error(`     Data: ${JSON.stringify(axiosError.response?.data, null, 2)}`);
    }
  } else {
    logger.error(`     ${String(error)}`);
  }
}
