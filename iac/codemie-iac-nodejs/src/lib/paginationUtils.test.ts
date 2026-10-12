/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { logger } from './logger';
import {
  findResourceByName,
  findDatasourceByName,
  findAssistantByName,
  findWorkflowByName,
  findSkillByName,
  SkillNameIndex,
} from './paginationUtils';

jest.mock('./logger');
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('paginationUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findResourceByName', () => {
    it('should find resource in first page', async () => {
      const mockListFn = jest.fn().mockResolvedValue([
        { id: '1', name: 'resource-1' },
        { id: '2', name: 'resource-2' },
        { id: '3', name: 'target' },
      ]);

      const result = await findResourceByName(mockListFn, 'target', 'test');

      expect(result).toEqual({ id: '3', name: 'target' });
      expect(mockListFn).toHaveBeenCalledTimes(1);
      expect(mockListFn).toHaveBeenCalledWith({ page: 0, per_page: 100 });
    });

    it('should find resource in second page (100+ resources)', async () => {
      // Create 100 resources for first page
      const firstPage = Array.from({ length: 100 }, (_, i) => ({
        id: `${i + 1}`,
        name: `resource-${i + 1}`,
      }));

      // Second page with target
      const secondPage = [
        { id: '101', name: 'resource-101' },
        { id: '102', name: 'target' },
        { id: '103', name: 'resource-103' },
      ];

      const mockListFn = jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

      const result = await findResourceByName(mockListFn, 'target', 'test');

      expect(result).toEqual({ id: '102', name: 'target' });
      expect(mockListFn).toHaveBeenCalledTimes(2);
      expect(mockListFn).toHaveBeenNthCalledWith(1, { page: 0, per_page: 100 });
      expect(mockListFn).toHaveBeenNthCalledWith(2, { page: 1, per_page: 100 });
    });

    it('should return null if resource not found', async () => {
      const mockListFn = jest.fn().mockResolvedValue([
        { id: '1', name: 'resource-1' },
        { id: '2', name: 'resource-2' },
      ]);

      const result = await findResourceByName(mockListFn, 'nonexistent', 'test');

      expect(result).toBeNull();
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('test "nonexistent" not found'));
    });

    it('should stop pagination after checking all pages', async () => {
      const mockListFn = jest
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, name: `r${i}` })))
        .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: `${i + 100}`, name: `r${i + 100}` }))); // Last page

      const result = await findResourceByName(mockListFn, 'nonexistent', 'test');

      expect(result).toBeNull();
      expect(mockListFn).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found after checking 150 resources across 2 page(s)')
      );
    });
  });

  describe('findDatasourceByName', () => {
    it('should find datasource by name', async () => {
      const mockClient = {
        datasources: {
          list: jest.fn().mockResolvedValue([
            { id: 'ds-1', name: 'datasource-1' },
            { id: 'ds-2', name: 'target-datasource' },
          ]),
        },
      };

      const result = await findDatasourceByName(mockClient, 'target-datasource');

      expect(result).toBe('ds-2');
    });

    it('should return null if datasource not found', async () => {
      const mockClient = {
        datasources: {
          list: jest.fn().mockResolvedValue([{ id: 'ds-1', name: 'datasource-1' }]),
        },
      };

      const result = await findDatasourceByName(mockClient, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findAssistantByName', () => {
    it('should find assistant by name', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([
            { id: 'ast-1', name: 'My Assistant' },
            { id: 'ast-2', name: 'Other Assistant' },
          ]),
        },
      };

      const result = await findAssistantByName(mockClient, 'My Assistant');

      expect(result).toBe('ast-1');
    });

    it('should find assistant across multiple pages', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({
        id: `ast-${i}`,
        name: `Assistant ${i}`,
        created_date: `2025-01-01T${String(i).padStart(2, '0')}:00:00Z`,
      }));

      const secondPage = [
        { id: 'ast-100', name: 'Target Assistant', created_date: '2025-01-02T10:00:00Z' },
        { id: 'ast-101', name: 'Other', created_date: '2025-01-02T11:00:00Z' },
      ];

      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
        },
      };

      const result = await findAssistantByName(mockClient, 'Target Assistant');

      expect(result).toBe('ast-100');
      expect(mockClient.assistants.list).toHaveBeenCalledTimes(2);
    });

    it('should find global assistant via marketplace scope fallback', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockImplementation((params: { scope?: string }) => {
            if (params.scope === 'marketplace') {
              return Promise.resolve([{ id: 'ast-global-1', name: 'Public Assistant' }]);
            }
            return Promise.resolve([{ id: 'ast-1', name: 'Project Assistant' }]);
          }),
        },
      };

      const result = await findAssistantByName(mockClient, 'Public Assistant', { isGlobal: true });

      expect(result).toBe('ast-global-1');
      expect(mockClient.assistants.list).toHaveBeenCalledWith(expect.objectContaining({ scope: 'marketplace' }));
    });

    it('should not search marketplace scope without isGlobal flag', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([{ id: 'ast-1', name: 'Other' }]),
        },
      };

      const result = await findAssistantByName(mockClient, 'Nonexistent');

      expect(result).toBeNull();
      expect(mockClient.assistants.list).toHaveBeenCalledTimes(1);
      expect(mockClient.assistants.list).not.toHaveBeenCalledWith(expect.objectContaining({ scope: 'marketplace' }));
    });

    it('should return null if assistant not found in any scope with isGlobal', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([]),
        },
      };

      const result = await findAssistantByName(mockClient, 'Nonexistent', { isGlobal: true });

      expect(result).toBeNull();
      expect(mockClient.assistants.list).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('assistant "Nonexistent" not found'));
    });

    it('should return null if assistant not found', async () => {
      const mockClient = {
        assistants: {
          list: jest.fn().mockResolvedValue([{ id: 'ast-1', name: 'Assistant 1' }]),
        },
      };

      const result = await findAssistantByName(mockClient, 'Nonexistent');

      expect(result).toBeNull();
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('assistant "Nonexistent" not found'));
    });
  });

  describe('findWorkflowByName', () => {
    it('should find workflow by name', async () => {
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValue([
            { id: 'wf-1', name: 'Test Workflow' },
            { id: 'wf-2', name: 'Other Workflow' },
          ]),
        },
      };

      const result = await findWorkflowByName(mockClient, 'Test Workflow', 'proj');

      expect(result).toBe('wf-1');
    });

    it('should scope every list call to the given project', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `wf-${i}`, name: `Workflow ${i}` }));
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]),
        },
      };

      await findWorkflowByName(mockClient, 'Missing', 'proj');

      expect(mockClient.workflows.list).toHaveBeenCalledTimes(2);
      expect(mockClient.workflows.list).toHaveBeenNthCalledWith(1, { page: 0, per_page: 100, projects: ['proj'] });
      expect(mockClient.workflows.list).toHaveBeenNthCalledWith(2, { page: 1, per_page: 100, projects: ['proj'] });
    });

    it('should find workflow across multiple pages', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({
        id: `wf-${i}`,
        name: `Workflow ${i}`,
      }));

      const secondPage = [
        { id: 'wf-100', name: 'Target Workflow' },
        { id: 'wf-101', name: 'Other' },
      ];

      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
        },
      };

      const result = await findWorkflowByName(mockClient, 'Target Workflow', 'proj');

      expect(result).toBe('wf-100');
      expect(mockClient.workflows.list).toHaveBeenCalledTimes(2);
    });

    it('should treat an undefined page as empty', async () => {
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValue(undefined),
        },
      };

      const result = await findWorkflowByName(
        mockClient as unknown as Parameters<typeof findWorkflowByName>[0],
        'Anything',
        'proj'
      );

      expect(result).toBeNull();
      expect(mockClient.workflows.list).toHaveBeenCalledTimes(1);
    });

    it('should return null if workflow not found', async () => {
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValue([{ id: 'wf-1', name: 'Workflow 1' }]),
        },
      };

      const result = await findWorkflowByName(mockClient, 'Nonexistent', 'proj');

      expect(result).toBeNull();
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('workflow "Nonexistent" not found'));
    });

    it('should throw when several workflows share the name, listing ids sorted', async () => {
      const firstPage = [
        { id: 'b', name: 'Dup' },
        ...Array.from({ length: 99 }, (_, i) => ({ id: `wf-${i}`, name: `Workflow ${i}` })),
      ];
      const mockClient = {
        workflows: {
          list: jest
            .fn()
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce([{ id: 'a', name: 'Dup' }]),
        },
      };

      await expect(findWorkflowByName(mockClient, 'Dup', 'proj')).rejects.toThrow(
        'Multiple workflows named "Dup" in project "proj": a, b'
      );
    });

    it('should throw instead of adopting or creating when the 1000-page limit truncates the scan', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: `wf-${i}`, name: `Workflow ${i}` }));
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValue(fullPage),
        },
      };

      await expect(findWorkflowByName(mockClient, 'Nonexistent', 'proj')).rejects.toThrow(
        /Workflow lookup for "Nonexistent" in project "proj" stopped after 1000 pages \(\d+ resources checked\); refusing to create a possible duplicate/
      );
      expect(mockClient.workflows.list).toHaveBeenCalledTimes(1001);
    });

    it('should throw on truncation even when a match was already found', async () => {
      const fullPage = [
        { id: 'wf-match', name: 'Target' },
        ...Array.from({ length: 99 }, (_, i) => ({ id: `wf-${i}`, name: `Workflow ${i}` })),
      ];
      const mockClient = {
        workflows: {
          list: jest.fn().mockResolvedValue(fullPage),
        },
      };

      await expect(findWorkflowByName(mockClient, 'Target', 'proj')).rejects.toThrow('stopped after 1000 pages');
    });
  });
  describe('SkillNameIndex', () => {
    function skills(count: number, offset = 0): Array<{ id: string; name: string }> {
      return Array.from({ length: count }, (_, i) => ({ id: `sk-${offset + i}`, name: `Skill ${offset + i}` }));
    }

    function pagedClient(all: Array<{ id: string; name: string }>) {
      return {
        skills: {
          list: jest.fn(({ page, per_page }: { page: number; per_page: number }) =>
            Promise.resolve(all.slice(page * per_page, (page + 1) * per_page))
          ),
        },
      };
    }

    it('builds from a single page', async () => {
      const client = pagedClient(skills(3));
      const index = new SkillNameIndex(client);

      await expect(index.find('Skill 1')).resolves.toBe('sk-1');
      expect(client.skills.list).toHaveBeenCalledTimes(1);
      expect(client.skills.list).toHaveBeenCalledWith({ page: 0, per_page: 100 });
    });

    it('builds across multiple pages with ceil(total/100) list calls', async () => {
      const client = pagedClient(skills(250));
      const index = new SkillNameIndex(client);

      await expect(index.find('Skill 249')).resolves.toBe('sk-249');
      expect(client.skills.list).toHaveBeenCalledTimes(3);
    });

    it('builds once for many lookups', async () => {
      const client = pagedClient(skills(150));
      const index = new SkillNameIndex(client);

      await expect(index.find('Skill 0')).resolves.toBe('sk-0');
      await expect(index.find('Skill 120')).resolves.toBe('sk-120');
      await expect(index.find('Skill 149')).resolves.toBe('sk-149');
      expect(client.skills.list).toHaveBeenCalledTimes(2);
    });

    it('resolves a recorded name before the first find', async () => {
      const client = pagedClient(skills(3));
      const index = new SkillNameIndex(client);

      index.record('Fresh Skill', 'sk-fresh');

      await expect(index.find('Fresh Skill')).resolves.toBe('sk-fresh');
      expect(client.skills.list).not.toHaveBeenCalled();
    });

    it('keeps recorded names when the lazy build runs later', async () => {
      const client = pagedClient(skills(3));
      const index = new SkillNameIndex(client);

      index.record('Fresh Skill', 'sk-fresh');
      await expect(index.find('Skill 2')).resolves.toBe('sk-2');
      await expect(index.find('Fresh Skill')).resolves.toBe('sk-fresh');
    });

    it('treats an undefined page as empty', async () => {
      const client = { skills: { list: jest.fn().mockResolvedValue(undefined) } };
      const index = new SkillNameIndex(client);

      await expect(index.find('Anything')).resolves.toBeNull();
      expect(client.skills.list).toHaveBeenCalledTimes(1);
    });

    it('rebuilds for a new instance', async () => {
      const client = pagedClient(skills(3));

      await new SkillNameIndex(client).find('Skill 0');
      await new SkillNameIndex(client).find('Skill 0');

      expect(client.skills.list).toHaveBeenCalledTimes(2);
    });

    it('returns null and warns for an unknown name', async () => {
      const client = pagedClient(skills(3));
      const index = new SkillNameIndex(client);

      await expect(index.find('Missing Skill')).resolves.toBeNull();
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('skill "Missing Skill" not found'));
    });

    it('stops the build at the 1000-page limit with a warning', async () => {
      const fullPage = skills(100);
      const client = { skills: { list: jest.fn().mockResolvedValue(fullPage) } };
      const index = new SkillNameIndex(client);

      await index.find('Skill 5');

      expect(client.skills.list).toHaveBeenCalledTimes(1001);
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Stopped pagination after 1000 pages'));
    });

    it('findSkillByName delegates to the index', async () => {
      const client = pagedClient(skills(3));
      const index = new SkillNameIndex(client);

      await expect(findSkillByName(index, 'Skill 2')).resolves.toBe('sk-2');
      await expect(findSkillByName(index, 'Skill 0')).resolves.toBe('sk-0');
      expect(client.skills.list).toHaveBeenCalledTimes(1);
    });
  });
});
