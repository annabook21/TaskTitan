'use server';

import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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

  // Check membership
  const membership = await prisma.membership.findFirst({
    where: { teamId, userId },
  });

  if (!membership) {
    throw new MyCustomError('You are not a member of this team');
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get all components that have been completed in the time range
  // by looking at their status history
  const completedComponents = await prisma.component.findMany({
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

  // Check membership
  const membership = await prisma.membership.findFirst({
    where: { teamId, userId },
  });

  if (!membership) {
    throw new MyCustomError('You are not a member of this team');
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get completion events from status history
  const completionEvents = await prisma.componentStatusHistory.findMany({
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

    // Check membership
    const membership = await prisma.membership.findFirst({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new MyCustomError('You are not a member of this team');
    }

    const distribution = await prisma.component.groupBy({
      by: ['status'],
      where: {
        Project: { teamId },
      },
      _count: {
        status: true,
      },
    });

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

  // Check membership
  const membership = await prisma.membership.findFirst({
    where: { teamId, userId },
  });

  if (!membership) {
    throw new MyCustomError('You are not a member of this team');
  }

  // For simplicity, just return current WIP count
  // A more sophisticated implementation would track historical WIP
  const currentWip = await prisma.component.count({
    where: {
      Project: { teamId },
      status: 'IN_PROGRESS',
    },
  });

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

    // Check membership
    const membership = await prisma.membership.findFirst({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new MyCustomError('You are not a member of this team');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Get all status history events for this team's components
    const statusHistory = await prisma.componentStatusHistory.findMany({
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

    // Also get current component counts by status
    const currentCounts = await prisma.component.groupBy({
      by: ['status'],
      where: {
        Project: { teamId },
      },
      _count: { status: true },
    });

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

    // Check membership
    const membership = await prisma.membership.findFirst({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new MyCustomError('You are not a member of this team');
    }

    // Get current status entries (exitedAt is null)
    const currentStatusEntries = await prisma.componentStatusHistory.findMany({
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
