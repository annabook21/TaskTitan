/**
 * Unit tests for batch-queries.ts
 * Mocks DynamoDB batch-ops and service; asserts correct keys and return shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  batchFetchUsers,
  batchFetchTeams,
  batchFetchComponents,
  batchFetchProjects,
  batchFetchSprints,
  getComponentCountsByProjectIds,
  batchFetchPreviewsByComponents,
  fetchProjectDetailData,
  fetchSprintComponents,
} from './batch-queries';

const mockBatchGet = vi.fn();
vi.mock('./batch-ops', () => ({
  batchGet: (keys: Array<{ pk: string; sk: string }>) => mockBatchGet(keys),
}));

const mockGetEntities = vi.fn();
vi.mock('./service', () => ({
  getEntities: () => mockGetEntities(),
}));

describe('batch-queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('batchFetchUsers', () => {
    it('returns empty Map when userIds is empty', async () => {
      const result = await batchFetchUsers([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockBatchGet).not.toHaveBeenCalled();
    });

    it('deduplicates and filters empty ids', async () => {
      mockBatchGet.mockResolvedValue([
        { id: 'u1', email: 'a@test.com', name: 'User 1' },
        { id: 'u2', email: 'b@test.com', name: 'User 2' },
      ]);
      const result = await batchFetchUsers(['u1', 'u1', '', 'u2']);
      expect(mockBatchGet).toHaveBeenCalledTimes(1);
      expect(mockBatchGet).toHaveBeenCalledWith([
        { pk: 'USER#u1', sk: 'METADATA' },
        { pk: 'USER#u2', sk: 'METADATA' },
      ]);
      expect(result.size).toBe(2);
      expect(result.get('u1')).toMatchObject({ id: 'u1', email: 'a@test.com' });
      expect(result.get('u2')).toMatchObject({ id: 'u2', email: 'b@test.com' });
    });
  });

  describe('batchFetchTeams', () => {
    it('returns empty Map when teamIds is empty', async () => {
      const result = await batchFetchTeams([]);
      expect(result.size).toBe(0);
      expect(mockBatchGet).not.toHaveBeenCalled();
    });

    it('calls batchGet with TEAM# keys and returns Map', async () => {
      mockBatchGet.mockResolvedValue([
        { id: 't1', name: 'Team Alpha' },
        { id: 't2', name: 'Team Beta' },
      ]);
      const result = await batchFetchTeams(['t1', 't2']);
      expect(mockBatchGet).toHaveBeenCalledWith([
        { pk: 'TEAM#t1', sk: 'METADATA' },
        { pk: 'TEAM#t2', sk: 'METADATA' },
      ]);
      expect(result.get('t1')).toMatchObject({ id: 't1', name: 'Team Alpha' });
      expect(result.get('t2')).toMatchObject({ id: 't2', name: 'Team Beta' });
    });
  });

  describe('batchFetchComponents', () => {
    it('returns empty Map when componentIds is empty', async () => {
      const result = await batchFetchComponents([]);
      expect(result.size).toBe(0);
      expect(mockBatchGet).not.toHaveBeenCalled();
    });

    it('calls batchGet with COMPONENT# keys', async () => {
      mockBatchGet.mockResolvedValue([
        { id: 'c1', name: 'Comp 1', projectId: 'p1', status: 'PLANNING' },
      ]);
      const result = await batchFetchComponents(['c1']);
      expect(mockBatchGet).toHaveBeenCalledWith([
        { pk: 'COMPONENT#c1', sk: 'METADATA' },
      ]);
      expect(result.get('c1')).toMatchObject({ id: 'c1', name: 'Comp 1' });
    });
  });

  describe('batchFetchProjects', () => {
    it('returns empty Map when projectIds is empty', async () => {
      const result = await batchFetchProjects([]);
      expect(result.size).toBe(0);
      expect(mockBatchGet).not.toHaveBeenCalled();
    });

    it('calls batchGet with PROJECT# keys', async () => {
      mockBatchGet.mockResolvedValue([
        { id: 'p1', name: 'Project One', teamId: 't1' },
      ]);
      const result = await batchFetchProjects(['p1']);
      expect(mockBatchGet).toHaveBeenCalledWith([
        { pk: 'PROJECT#p1', sk: 'METADATA' },
      ]);
      expect(result.get('p1')).toMatchObject({ id: 'p1', name: 'Project One' });
    });
  });

  describe('batchFetchSprints', () => {
    it('returns empty Map when sprintIds is empty', async () => {
      const result = await batchFetchSprints([]);
      expect(result.size).toBe(0);
      expect(mockBatchGet).not.toHaveBeenCalled();
    });

    it('calls batchGet with SPRINT# keys', async () => {
      mockBatchGet.mockResolvedValue([
        { id: 's1', name: 'Sprint 1', teamId: 't1', status: 'PLANNING' },
      ]);
      const result = await batchFetchSprints(['s1']);
      expect(mockBatchGet).toHaveBeenCalledWith([
        { pk: 'SPRINT#s1', sk: 'METADATA' },
      ]);
      expect(result.get('s1')).toMatchObject({ id: 's1', name: 'Sprint 1' });
    });
  });

  describe('getComponentCountsByProjectIds', () => {
    it('returns empty Map when projectIds is empty', async () => {
      const result = await getComponentCountsByProjectIds([]);
      expect(result.size).toBe(0);
      expect(mockGetEntities).not.toHaveBeenCalled();
    });

    it('returns count and componentsByStatus per project', async () => {
      const mockGo = vi.fn();
      mockGo
        .mockResolvedValueOnce({
          data: [
            { id: 'c1', status: 'PLANNING' },
            { id: 'c2', status: 'IN_PROGRESS' },
            { id: 'c3', status: 'PLANNING' },
          ],
        })
        .mockResolvedValueOnce({ data: [{ id: 'c4', status: 'COMPLETED' }] });
      mockGetEntities.mockReturnValue({
        component: {
          query: { byProject: () => ({ go: mockGo }) },
        },
      });

      const result = await getComponentCountsByProjectIds(['proj1', 'proj2']);
      expect(mockGo).toHaveBeenCalledTimes(2);
      expect(result.get('proj1')).toEqual({
        count: 3,
        componentsByStatus: { PLANNING: 2, IN_PROGRESS: 1 },
      });
      expect(result.get('proj2')).toEqual({
        count: 1,
        componentsByStatus: { COMPLETED: 1 },
      });
    });

    it('handles rejected project query with count 0', async () => {
      const mockGo = vi.fn().mockRejectedValue(new Error('Throttled'));
      mockGetEntities.mockReturnValue({
        component: {
          query: { byProject: () => ({ go: mockGo }) },
        },
      });
      const result = await getComponentCountsByProjectIds(['proj1']);
      expect(result.get('proj1')).toEqual({ count: 0, componentsByStatus: {} });
    });
  });

  describe('batchFetchPreviewsByComponents', () => {
    it('returns empty Map when componentIds is empty', async () => {
      const result = await batchFetchPreviewsByComponents([]);
      expect(result.size).toBe(0);
      expect(mockGetEntities).not.toHaveBeenCalled();
    });

    it('returns preview list per component', async () => {
      const mockGo = vi.fn()
        .mockResolvedValueOnce({
          data: [
            { id: 'prev1', componentId: 'c1', htmlContent: '<p>Hi</p>', createdAt: '2025-01-01', status: 'COMPLETED' },
          ],
        })
        .mockResolvedValueOnce({ data: [] });
      mockGetEntities.mockReturnValue({
        componentPreview: {
          query: { primary: () => ({ go: mockGo }) },
        },
      });

      const result = await batchFetchPreviewsByComponents(['c1', 'c2']);
      expect(mockGo).toHaveBeenCalledTimes(2);
      expect(result.get('c1')).toHaveLength(1);
      expect(result.get('c1')![0]).toMatchObject({
        id: 'prev1',
        componentId: 'c1',
        htmlContent: '<p>Hi</p>',
        status: 'COMPLETED',
      });
      expect(result.get('c2')).toEqual([]);
    });
  });

  describe('fetchProjectDetailData', () => {
    it('returns empty maps when project has no components', async () => {
      mockGetEntities.mockReturnValue({
        component: {
          query: { byProject: () => ({ go: vi.fn().mockResolvedValue({ data: [] }) }) },
        },
      });
      const result = await fetchProjectDetailData('proj-empty');
      expect(result.components).toEqual([]);
      expect(result.assignmentsMap.size).toBe(0);
      expect(result.dependenciesMap.dependsOn.size).toBe(0);
      expect(result.statusHistoryMap.size).toBe(0);
      expect(result.usersMap.size).toBe(0);
    });
  });

  describe('fetchSprintComponents', () => {
    it('returns empty maps when sprint has no components', async () => {
      mockGetEntities.mockReturnValue({
        component: {
          query: { bySprint: () => ({ go: vi.fn().mockResolvedValue({ data: [] }) }) },
        },
      });
      const result = await fetchSprintComponents('sprint-empty');
      expect(result.components).toEqual([]);
      expect(result.assignmentsMap.size).toBe(0);
      expect(result.usersMap.size).toBe(0);
    });
  });
});
