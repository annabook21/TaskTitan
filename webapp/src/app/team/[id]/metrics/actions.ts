'use server';

import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { z } from 'zod';
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
 */
export const getCycleTimeMetrics = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, days } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();

  const access = await verifyTeamMembership(userId, teamId);
  if (!access) throw new MyCustomError('You are not a member of this team');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const projects = await entities.project.query.byTeam({ teamId }).go();
  const projectIds = projects.data.map((p) => p.id);
  if (projectIds.length === 0) return { stats: null, message: 'No projects found' };

  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
  );
  const allComponents = componentResults.flatMap((r) => r.data);
  const completed = allComponents.filter((c) => c.status === 'COMPLETED');

  if (completed.length === 0) return { stats: null, message: 'No completed items found' };

  const histories = await Promise.all(
    completed.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()),
  );
  const cutoffIso = startDate.toISOString();

  const cycleTimes: number[] = [];

  for (let i = 0; i < completed.length; i++) {
    const statusHistory = histories[i].data
      .map((h) => ({
        status: h.status,
        enteredAt: new Date(h.enteredAt),
        exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
      }))
      .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

    const hasCompletedInRange = statusHistory.some(
      (h) => h.status === 'COMPLETED' && h.enteredAt.toISOString() >= cutoffIso,
    );
    if (!hasCompletedInRange) continue;

    const inProgressEntry = statusHistory.find((h) => h.status === 'IN_PROGRESS');
    const completedEntry = statusHistory.find((h) => h.status === 'COMPLETED');

    if (inProgressEntry && completedEntry) {
      const cycleTimeMs = completedEntry.enteredAt.getTime() - inProgressEntry.enteredAt.getTime();
      const cycleTimeDays = cycleTimeMs / (1000 * 60 * 60 * 24);
      if (cycleTimeDays > 0) cycleTimes.push(cycleTimeDays);
    }
  }

  if (cycleTimes.length === 0) return { stats: null, message: 'No cycle time data available' };

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
 * Calculate throughput (items completed per week)
 */
export const getThroughputMetrics = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, days } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();

  const access = await verifyTeamMembership(userId, teamId);
  if (!access) throw new MyCustomError('You are not a member of this team');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const projects = await entities.project.query.byTeam({ teamId }).go();
  const projectIds = projects.data.map((p) => p.id);
  if (projectIds.length === 0) return { data: [], totalCompleted: 0, dailyAverage: 0, weeklyAverage: 0 };

  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
  );
  const allComponents = componentResults.flatMap((r) => r.data);

  const histories = await Promise.all(
    allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()),
  );
  const cutoffIso = startDate.toISOString();

  const completionEvents = histories
    .flatMap((r) => r.data)
    .filter((h) => h.status === 'COMPLETED' && h.enteredAt >= cutoffIso)
    .map((h) => ({ enteredAt: new Date(h.enteredAt) }))
    .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

  const weeklyThroughput: Map<string, number> = new Map();

  for (const event of completionEvents) {
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

  const totalCompleted = completionEvents.length;

  return { data, totalCompleted, dailyAverage: totalCompleted / days, weeklyAverage: totalCompleted / (days / 7) };
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
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) throw new MyCustomError('You are not a member of this team');

    const projects = await entities.project.query.byTeam({ teamId }).go();
    const projectIds = projects.data.map((p) => p.id);
    if (projectIds.length === 0) return { data: [] };

    const componentResults = await Promise.all(
      projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
    );
    const allComponents = componentResults.flatMap((r) => r.data);

    const counts = new Map<string, number>();
    for (const c of allComponents) {
      counts.set(c.status, (counts.get(c.status) || 0) + 1);
    }

    const data: StatusDistribution[] = Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
    return { data };
  });

/**
 * Get WIP over time
 */
export const getWipOverTime = authActionClient.schema(metricsQuerySchema).action(async ({ parsedInput, ctx }) => {
  const { teamId } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();
  const access = await verifyTeamMembership(userId, teamId);
  if (!access) throw new MyCustomError('You are not a member of this team');

  const projects = await entities.project.query.byTeam({ teamId }).go();
  const projectIds = projects.data.map((p) => p.id);
  if (projectIds.length === 0) return { currentWip: 0, message: 'No projects found' };

  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
  );
  const allComponents = componentResults.flatMap((r) => r.data);
  const currentWip = allComponents.filter((c) => c.status === 'IN_PROGRESS').length;

  return { currentWip, message: 'Historical WIP tracking coming soon' };
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
 * Get cumulative flow diagram data
 */
export const getCumulativeFlowData = authActionClient
  .schema(metricsQuerySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { teamId, days } = parsedInput;
    const { userId } = ctx;

    const entities = getEntities();
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) throw new MyCustomError('You are not a member of this team');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const projects = await entities.project.query.byTeam({ teamId }).go();
    const projectIds = projects.data.map((p) => p.id);
    if (projectIds.length === 0) return { data: [] };

    const componentResults = await Promise.all(
      projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
    );
    const allComponents = componentResults.flatMap((r) => r.data);

    const histories = await Promise.all(
      allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()),
    );

    const statusHistory = histories
      .flatMap((r) => r.data)
      .map((h) => ({
        status: h.status,
        enteredAt: new Date(h.enteredAt),
        exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
      }))
      .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

    const data: CumulativeFlowData[] = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      const dateStr = d.toISOString().split('T')[0];

      const dayCounts: Record<string, number> = { PLANNING: 0, IN_PROGRESS: 0, BLOCKED: 0, REVIEW: 0, COMPLETED: 0 };

      for (const event of statusHistory) {
        if (event.enteredAt <= dayEnd && (!event.exitedAt || event.exitedAt > dayEnd)) {
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
 * Get aging analysis for items in each status
 */
export const getAgingAnalysis = authActionClient
  .schema(z.object({ teamId: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { teamId } = parsedInput;
    const { userId } = ctx;

    const entities = getEntities();
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) throw new MyCustomError('You are not a member of this team');

    const projects = await entities.project.query.byTeam({ teamId }).go();
    const projectIds = projects.data.map((p) => p.id);
    if (projectIds.length === 0) return { data: [] };

    const componentResults = await Promise.all(
      projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
    );
    const allComponents = componentResults.flatMap((r) => r.data).filter((c) => c.status !== 'COMPLETED');

    const histories = await Promise.all(
      allComponents.map((c) => entities.componentStatusHistory.query.primary({ componentId: c.id }).go()),
    );

    const now = new Date();
    const statusAging: Map<string, number[]> = new Map();

    for (let i = 0; i < allComponents.length; i++) {
      const component = allComponents[i];
      const history = histories[i].data;
      const currentEntry = history.find((h) => !h.exitedAt);

      if (currentEntry) {
        const enteredAt = new Date(currentEntry.enteredAt);
        const ageDays = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24);
        const status = component.status;
        if (!statusAging.has(status)) statusAging.set(status, []);
        statusAging.get(status)!.push(ageDays);
      }
    }

    const data: AgingData[] = Array.from(statusAging.entries()).map(([status, ages]) => ({
      status,
      avgDays: ages.reduce((sum, a) => sum + a, 0) / ages.length,
      maxDays: Math.max(...ages),
      itemCount: ages.length,
    }));

    return { data };
  });
