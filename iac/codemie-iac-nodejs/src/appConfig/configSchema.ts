/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { z } from 'zod';

export const appConfigSchema = z.object({
  rootDir: z.string(),
  codemieConfig: z.string(),
  codemieState: z.string(),
  backupsDirectory: z.string(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const externalConfigSchema = appConfigSchema.partial();
export type ExternalAppConfig = z.infer<typeof externalConfigSchema>;
