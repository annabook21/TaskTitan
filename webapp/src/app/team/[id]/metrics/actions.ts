'use server';

import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { dualRead } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

const metricsQuerySchema = z.object({
  teamId: z.string().cuid(),
  days: z.number().int().min(7).max(365).default(30),
});

export interface CycleTimeStats {
  average: number;
  median: number;
  p85: number;
  p95: number;
  count: number;
}

export interface ThroughputData {
  date: string;
  count: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
}

/**
 * Calculate cycle time statistics for completed components.
 * Cycle time = time from IN_PROGRESS to COMPLETED
 */
export const getCycleTimeMetrics = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, days } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();

  // Check membership (dualRead)
  await dualRead(
    'membership',
    async () => {
      const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
      if (!membership) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    async () => {
      const access = await verifyTeamMembership(userId, teamId);
      if (!access) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    { context: { action: 'getCycleTimeMetrics', teamId } }
  );

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get all components that have been completed in the time range by looking at status history (dualRead)
  const completedComponents = await dualRead(
    'componentStatusHistory',
    async () => {
      return prisma.component.findMany({
        where: {
          Project: { teamId },
          status: 'COMPLETED',
          StatusHistory: {
            some: {
              status: 'COMPLETED',
              enteredAt: { gte: startDate },
            },
          },
        },
        include: {
          StatusHistory: {
            orderBy: { enteredAt: 'asc' },
          },
        },
      });
    },
    async () => {
      // DynamoDB: fetch team projects -> components -> status histories per component
      const projects = await entities.project.query.byTeam({ teamId }).go();
      const projectIds = projects.data.map((p) => p.id);
      if (projectIds.length === 0) return [];

      const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
      const allComponents = componentResults.flatMap((r) => r.data);

      const completed = allComponents.filter((c) => c.status === 'COMPLETED');
      if (completed.length === 0) return [];

      const histories = await Promise.all(completed.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()));

      const cutoffIso = startDate.toISOString();

      const mapped = completed
        .map((c, idx) => {
          const statusHistory = histories[idx].data
            .map((h) => ({
              status: h.status,
              enteredAt: new Date(h.enteredAt),
              exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
            }))
            .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

          const hasCompletedInRange = statusHistory.some((h) => h.status === 'COMPLETED' && h.enteredAt.toISOString() >= cutoffIso);
          if (!hasCompletedInRange) return null;

          return {
            id: c.id,
            status: c.status,
            StatusHistory: statusHistory,
          };
        })
        .filter(Boolean);

      return mapped as unknown;
    },
    { context: { action: 'getCycleTimeMetrics', teamId, days } }
  );

  // Calculate cycle times
  const cycleTimes: number[] = [];

  for (const component of completedComponents) {
    // Find when it entered IN_PROGRESS (first time)
    const inProgressEntry = component.StatusHistory.find((h) => h.status === 'IN_PROGRESS');

    // Find when it entered COMPLETED
    const completedEntry = component.StatusHistory.find((h) => h.status === 'COMPLETED');

    if (inProgressEntry && completedEntry) {
      const cycleTimeMs = completedEntry.enteredAt.getTime() - inProgressEntry.enteredAt.getTime();
      const cycleTimeDays = cycleTimeMs / (1000 * 60 * 60 * 24);
      if (cycleTimeDays > 0) {
        cycleTimes.push(cycleTimeDays);
      }
    }
  }

  if (cycleTimes.length === 0) {
    return {
      stats: null,
      message: 'No completed items with cycle time data in this period',
    };
  }

  // Sort for percentile calculations
  cycleTimes.sort((a, b) => a - b);

  const stats: CycleTimeStats = {
    average: cycleTimes.reduce((sum, ct) => sum + ct, 0) / cycleTimes.length,
    median: cycleTimes[Math.floor(cycleTimes.length / 2)],
    p85: cycleTimes[Math.floor(cycleTimes.length * 0.85)],
    p95: cycleTimes[Math.floor(cycleTimes.length * 0.95)],
    count: cycleTimes.length,
  };

  return { stats };
});

/**
 * Calculate throughput (items completed per day/week)
 */
export const getThroughputMetrics = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, days } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();

  await dualRead(
    'membership',
    async () => {
      const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
      if (!membership) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    async () => {
      const access = await verifyTeamMembership(userId, teamId);
      if (!access) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    { context: { action: 'getThroughputMetrics', teamId } }
  );

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get completion events from status history (dualRead)
  const completionEvents = await dualRead(
    'componentStatusHistory',
    async () => {
      return prisma.componentStatusHistory.findMany({
        where: {
          status: 'COMPLETED',
          enteredAt: { gte: startDate },
          Component: {
            Project: { teamId },
          },
        },
        select: {
          enteredAt: true,
        },
        orderBy: { enteredAt: 'asc' },
      });
    },
    async () => {
      const projects = await entities.project.query.byTeam({ teamId }).go();
      const projectIds = projects.data.map((p) => p.id);
      if (projectIds.length === 0) return [];

      const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
      const allComponents = componentResults.flatMap((r) => r.data);

      const histories = await Promise.all(allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()));
      const cutoffIso = startDate.toISOString();

      const events = histories
        .flatMap((r) => r.data)
        .filter((h) => h.status === 'COMPLETED' && h.enteredAt >= cutoffIso)
        .map((h) => ({ enteredAt: new Date(h.enteredAt) }))
        .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

      return events as unknown;
    },
    { context: { action: 'getThroughputMetrics', teamId, days } }
  );

  // Group by week
  const weeklyThroughput: Map<string, number> = new Map();

  for (const event of completionEvents) {
    // Get the Monday of the week
    const date = new Date(event.enteredAt);
    const dayOfWeek = date.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    date.setDate(date.getDate() + diff);
    const weekKey = date.toISOString().split('T')[0];

    weeklyThroughput.set(weekKey, (weeklyThroughput.get(weekKey) || 0) + 1);
  }

  const data: ThroughputData[] = Array.from(weeklyThroughput.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Calculate averages
  const totalCompleted = completionEvents.length;
  const dailyAverage = totalCompleted / days;
  const weeklyAverage = totalCompleted / (days / 7);

  return {
    data,
    totalCompleted,
    dailyAverage,
    weeklyAverage,
  };
});

/**
 * Get current status distribution for all components
 */
export const getStatusDistribution = authActionClient
  .schema(z.object({ teamId: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { teamId } = parsedInput;
    const { userId } = ctx;

    const entities = getEntities();
    await dualRead(
      'membership',
      async () => {
        const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
        if (!membership) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      async () => {
        const access = await verifyTeamMembership(userId, teamId);
        if (!access) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      { context: { action: 'getStatusDistribution', teamId } }
    );

    const distribution = await dualRead(
      'component',
      async () => {
        return prisma.component.groupBy({
          by: ['status'],
          where: {
            Project: { teamId },
          },
          _count: {
            status: true,
          },
        });
      },
      async () => {
        const projects = await entities.project.query.byTeam({ teamId }).go();
        const projectIds = projects.data.map((p) => p.id);
        if (projectIds.length === 0) return [];

        const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
        const allComponents = componentResults.flatMap((r) => r.data);

        const counts = new Map<string, number>();
        for (const c of allComponents) {
          counts.set(c.status, (counts.get(c.status) || 0) + 1);
        }

        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } })) as unknown;
      },
      { context: { action: 'getStatusDistribution', teamId } }
    );

    const data: StatusDistribution[] = distribution.map((d) => ({
      status: d.status,
      count: d._count.status,
    }));

    return { data };
  });

/**
 * Get WIP over time (items in progress by day)
 */
export const getWipOverTime = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, days } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();
  await dualRead(
    'membership',
    async () => {
      const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
      if (!membership) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    async () => {
      const access = await verifyTeamMembership(userId, teamId);
      if (!access) throw new MyCustomError('You are not a member of this team');
      return true;
    },
    { context: { action: 'getWipOverTime', teamId } }
  );

  // For simplicity, just return current WIP count
  // A more sophisticated implementation would track historical WIP
  const currentWip = await dualRead(
    'component',
    async () => {
      return prisma.component.count({
        where: {
          Project: { teamId },
          status: 'IN_PROGRESS',
        },
      });
    },
    async () => {
      const projects = await entities.project.query.byTeam({ teamId }).go();
      const projectIds = projects.data.map((p) => p.id);
      if (projectIds.length === 0) return 0;

      const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
      const allComponents = componentResults.flatMap((r) => r.data);
      return allComponents.filter((c) => c.status === 'IN_PROGRESS').length as unknown;
    },
    { context: { action: 'getWipOverTime', teamId } }
  );

  return {
    currentWip,
    message: 'Historical WIP tracking coming soon',
  };
});

export interface CumulativeFlowData {
  date: string;
  PLANNING: number;
  IN_PROGRESS: number;
  BLOCKED: number;
  REVIEW: number;
  COMPLETED: number;
}

/**
 * Get cumulative flow diagram data (Kanban-specific metric)
 * Shows the distribution of items across statuses over time
 */
export const getCumulativeFlowData = authActionClient
  .schema(metricsQuerySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { teamId, days } = parsedInput;
    const { userId } = ctx;

    const entities = getEntities();
    await dualRead(
      'membership',
      async () => {
        const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
        if (!membership) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      async () => {
        const access = await verifyTeamMembership(userId, teamId);
        if (!access) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      { context: { action: 'getCumulativeFlowData', teamId } }
    );

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Get all status history events for this team's components (dualRead)
    const statusHistory = await dualRead(
      'componentStatusHistory',
      async () => {
        return prisma.componentStatusHistory.findMany({
          where: {
            Component: {
              Project: { teamId },
            },
          },
          select: {
            status: true,
            enteredAt: true,
            exitedAt: true,
          },
          orderBy: { enteredAt: 'asc' },
        });
      },
      async () => {
        const projects = await entities.project.query.byTeam({ teamId }).go();
        const projectIds = projects.data.map((p) => p.id);
        if (projectIds.length === 0) return [];

        const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
        const allComponents = componentResults.flatMap((r) => r.data);

        const histories = await Promise.all(allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()));

        const events = histories
          .flatMap((r) => r.data)
          .map((h) => ({
            status: h.status,
            enteredAt: new Date(h.enteredAt),
            exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
          }))
          .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

        return events as unknown;
      },
      { context: { action: 'getCumulativeFlowData', teamId, days } }
    );

    // Also get current component counts by status (dualRead)
    const currentCounts = await dualRead(
      'component',
      async () => {
        return prisma.component.groupBy({
          by: ['status'],
          where: {
            Project: { teamId },
          },
          _count: { status: true },
        });
      },
      async () => {
        const projects = await entities.project.query.byTeam({ teamId }).go();
        const projectIds = projects.data.map((p) => p.id);
        if (projectIds.length === 0) return [];

        const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
        const allComponents = componentResults.flatMap((r) => r.data);

        const counts = new Map<string, number>();
        for (const c of allComponents) {
          counts.set(c.status, (counts.get(c.status) || 0) + 1);
        }
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } })) as unknown;
      },
      { context: { action: 'getCumulativeFlowData_counts', teamId } }
    );

    const currentCountMap: Record<string, number> = {};
    for (const c of currentCounts) {
      currentCountMap[c.status] = c._count.status;
    }

    // Build daily snapshots
    // For simplicity, we'll generate data for each day from startDate to now
    const data: CumulativeFlowData[] = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Initialize with zeros
    const statuses = ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const;

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      const dateStr = d.toISOString().split('T')[0];

      // Count items in each status at the end of this day
      // An item is in a status on a given day if:
      // - enteredAt <= dayEnd AND (exitedAt > dayEnd OR exitedAt is null)
      const dayCounts: Record<string, number> = {
        PLANNING: 0,
        IN_PROGRESS: 0,
        BLOCKED: 0,
        REVIEW: 0,
        COMPLETED: 0,
      };

      for (const event of statusHistory) {
        const enteredAt = new Date(event.enteredAt);
        const exitedAt = event.exitedAt ? new Date(event.exitedAt) : null;

        if (enteredAt <= dayEnd && (!exitedAt || exitedAt > dayEnd)) {
          dayCounts[event.status]++;
        }
      }

      data.push({
        date: dateStr,
        PLANNING: dayCounts.PLANNING,
        IN_PROGRESS: dayCounts.IN_PROGRESS,
        BLOCKED: dayCounts.BLOCKED,
        REVIEW: dayCounts.REVIEW,
        COMPLETED: dayCounts.COMPLETED,
      });
    }

    return { data };
  });

export interface AgingData {
  status: string;
  avgDays: number;
  maxDays: number;
  itemCount: number;
}

/**
 * Get aging analysis for items in each status (Kanban-specific)
 * Shows how long items have been sitting in each column
 */
export const getAgingAnalysis = authActionClient
  .schema(z.object({ teamId: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { teamId } = parsedInput;
    const { userId } = ctx;

    const entities = getEntities();
    await dualRead(
      'membership',
      async () => {
        const membership = await prisma.membership.findFirst({ where: { teamId, userId } });
        if (!membership) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      async () => {
        const access = await verifyTeamMembership(userId, teamId);
        if (!access) throw new MyCustomError('You are not a member of this team');
        return true;
      },
      { context: { action: 'getAgingAnalysis', teamId } }
    );

    // Get current status entries (exitedAt is null / undefined) (dualRead)
    const currentStatusEntries = await dualRead(
      'componentStatusHistory',
      async () => {
        return prisma.componentStatusHistory.findMany({
          where: {
            exitedAt: null,
            Component: {
              Project: { teamId },
              status: { not: 'COMPLETED' },
            },
          },
          select: {
            status: true,
            enteredAt: true,
          },
        });
      },
      async () => {
        const projects = await entities.project.query.byTeam({ teamId }).go();
        const projectIds = projects.data.map((p) => p.id);
        if (projectIds.length === 0) return [];

        const componentResults = await Promise.all(projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()));
        const allComponents = componentResults.flatMap((r) => r.data).filter((c) => c.status !== 'COMPLETED');

        const histories = await Promise.all(allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()));
        const entries = histories
          .flatMap((r) => r.data)
          .filter((h) => !h.exitedAt)
          .map((h) => ({ status: h.status, enteredAt: new Date(h.enteredAt) }));

        return entries as unknown;
      },
      { context: { action: 'getAgingAnalysis', teamId } }
    );

    // Calculate aging by status
    const agingByStatus: Record<string, { days: number[] }> = {
      PLANNING: { days: [] },
      IN_PROGRESS: { days: [] },
      BLOCKED: { days: [] },
      REVIEW: { days: [] },
    };

    const now = new Date();
    for (const entry of currentStatusEntries) {
      const daysInStatus = (now.getTime() - entry.enteredAt.getTime()) / (1000 * 60 * 60 * 24);
      if (agingByStatus[entry.status]) {
        agingByStatus[entry.status].days.push(daysInStatus);
      }
    }

    const data: AgingData[] = Object.entries(agingByStatus).map(([status, { days }]) => ({
      status,
      avgDays: days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : 0,
      maxDays: days.length > 0 ? Math.max(...days) : 0,
      itemCount: days.length,
    }));

    return { data };
  });
