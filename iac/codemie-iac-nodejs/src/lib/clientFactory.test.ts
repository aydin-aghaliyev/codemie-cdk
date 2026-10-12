/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { CodeMieClient } from 'codemie-sdk';

import type { CodemieConfig } from '../types/codemieConfig';

import { createClient } from './clientFactory';

jest.mock('codemie-sdk');

describe('clientFactory', () => {
  let mockInitialize: jest.Mock;
  let MockedCodeMieClient: jest.MockedClass<typeof CodeMieClient>;

  beforeEach(() => {
    mockInitialize = jest.fn().mockResolvedValue(undefined);
    MockedCodeMieClient = CodeMieClient as jest.MockedClass<typeof CodeMieClient>;
    MockedCodeMieClient.mockImplementation(
      () =>
        ({
          initialize: mockInitialize,
        }) as unknown as CodeMieClient
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createClient', () => {
    it('should create client with correct configuration', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          username: 'username@example.com',
          password: 'password',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(MockedCodeMieClient).toHaveBeenCalledWith({
        auth_server_url: 'https://auth.example.com',
        auth_realm_name: 'test-realm',
        codemie_api_domain: 'https://api.example.com',
        auth_client_id: 'test-client-id',
        auth_client_secret: 'test-client-secret',
        username: 'username@example.com',
        password: 'password',
        verify_ssl: true,
      });
    });

    it('should call initialize on the client', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('should return initialized client', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      const client = await createClient(config);

      expect(client).toBeDefined();
      expect(client).toHaveProperty('initialize');
    });

    it('should always set verify_ssl to true', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(MockedCodeMieClient).toHaveBeenCalledWith(
        expect.objectContaining({
          verify_ssl: true,
        })
      );
    });

    it('should map codemie_api_url to codemie_api_domain', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://custom-api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(MockedCodeMieClient).toHaveBeenCalledWith(
        expect.objectContaining({
          codemie_api_domain: 'https://custom-api.example.com',
        })
      );
    });

    it('should map client_id to auth_client_id', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'custom-client-123',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(MockedCodeMieClient).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_client_id: 'custom-client-123',
        })
      );
    });

    it('should map client_secret to auth_client_secret', async () => {
      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'super-secret-123',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await createClient(config);

      expect(MockedCodeMieClient).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_client_secret: 'super-secret-123',
        })
      );
    });

    it('should handle initialization errors', async () => {
      mockInitialize.mockRejectedValue(new Error('Authentication failed'));

      const config = {
        version: '1',
        project: { name: 'test', description: 'test' },
        environment: {
          auth_server_url: 'https://auth.example.com',
          auth_realm_name: 'test-realm',
          codemie_api_url: 'https://api.example.com',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
        },
        imported: {},
        resources: {},
      } as unknown as CodemieConfig;

      await expect(createClient(config)).rejects.toThrow('Authentication failed');
    });
  });
});
