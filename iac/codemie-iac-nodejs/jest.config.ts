/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import type { Config } from 'jest';

const config: Config = {
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/cli/**/*.ts'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  modulePaths: ['src'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^ora$': '<rootDir>/src/test/oraMock.ts',
  },
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|ora|p-limit|yocto-queue)/)', // Transform ESM packages (supports both npm and pnpm layouts)
  ],
  testMatch: ['**/*.test.ts'],
  restoreMocks: true,
  resetMocks: true,
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};

export default config;
