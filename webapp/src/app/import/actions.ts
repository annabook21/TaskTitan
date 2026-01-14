'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { analyzeImportData, cleanupImportData } from '@/lib/ai';
import type { ComponentType, ComponentStatus } from '@prisma/client';

const analyzeSchema = z.object({
  teamId: z.string().cuid(),
  headers: z.array(z.string()),
  sampleRows: z.array(z.record(z.string())),
});

const importSchema = z.object({
  teamId: z.string().cuid(),
  projectId: z.string().cuid().optional(),
  projectName: z.string().optional(),
  mappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: z.string().nullable(),
    }),
  ),
  rows: z.array(z.record(z.string())),
  createMissingParents: z.boolean().default(true),
  autoAssignSprint: z.string().cuid().optional(),
});

/**
 * Analyze uploaded data and suggest column mappings using AI
 */
export const analyzeImport = authActionClient.schema(analyzeSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, headers, sampleRows } = parsedInput;
  const { userId } = ctx;

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to import data');
  }

  // Get existing projects and sprints for context
  const [projects, sprints] = await Promise.all([
    prisma.project.findMany({
      where: { teamId },
      select: { name: true },
    }),
    prisma.sprint.findMany({
      where: { teamId, status: { in: ['PLANNING', 'ACTIVE'] } },
      select: { name: true },
    }),
  ]);

  const result = await analyzeImportData(
    headers,
    sampleRows,
    projects.map((p) => p.name),
    sprints.map((s) => s.name),
  );

  return result;
});

const cleanupSchema = z.object({
  teamId: z.string().cuid(),
  rows: z.array(z.record(z.string())),
  mappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: z.string().nullable(),
    }),
  ),
});

/**
 * AI-powered data cleanup - normalizes and enhances messy data
 */
export const cleanupData = authActionClient.schema(cleanupSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, rows, mappings } = parsedInput;
  const { userId } = ctx;

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to clean data');
  }

  const result = await cleanupImportData(rows, mappings);
  return result;
});

/**
 * Execute the import with mapped data
 */
export const executeImport = authActionClient.schema(importSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, projectId, projectName, mappings, rows, createMissingParents, autoAssignSprint } = parsedInput;
  const { userId } = ctx;

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to import data');
  }

  // Create or get project
  let targetProjectId = projectId;
  if (!targetProjectId && projectName) {
    const project = await prisma.project.create({
      data: {
        name: projectName,
        teamId,
        ownerId: userId,
      },
    });
    targetProjectId = project.id;
  }

  if (!targetProjectId) {
    throw new Error('Project is required for import');
  }

  // Build mapping lookup
  const fieldMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.targetField) {
      fieldMap.set(m.sourceColumn, m.targetField);
    }
  }

  // Track created items for hierarchy resolution
  const createdItems = new Map<string, string>(); // name -> id
  const stats = {
    created: 0,
    skipped: 0,
    errors: [] as string[],
    warnings: [] as string[],
  };

  // Helper to get mapped value
  const getValue = (row: Record<string, string>, field: string): string | undefined => {
    for (const [col, target] of fieldMap.entries()) {
      if (target === field && row[col]) {
        return row[col].trim();
      }
    }
    return undefined;
  };

  // Helper to parse type
  const parseType = (value?: string): ComponentType => {
    if (!value) return 'TASK';
    const lower = value.toLowerCase();
    if (lower.includes('epic')) return 'EPIC';
    if (lower.includes('feature')) return 'FEATURE';
    if (lower.includes('story') || lower.includes('user story')) return 'STORY';
    if (lower.includes('bug')) return 'BUG';
    return 'TASK';
  };

  // Helper to parse status
  const parseStatus = (value?: string): ComponentStatus => {
    if (!value) return 'PLANNING';
    const lower = value.toLowerCase();
    if (lower.includes('progress') || lower.includes('doing') || lower.includes('active')) return 'IN_PROGRESS';
    if (lower.includes('block')) return 'BLOCKED';
    if (lower.includes('review') || lower.includes('testing') || lower.includes('qa')) return 'REVIEW';
    if (lower.includes('done') || lower.includes('complete') || lower.includes('closed')) return 'COMPLETED';
    return 'PLANNING';
  };

  // Helper to parse priority
  const parsePriority = (value?: string): number => {
    if (!value) return 0;
    const lower = value.toLowerCase();
    if (lower.includes('critical') || lower.includes('highest') || lower === 'p0') return 5;
    if (lower.includes('high') || lower === 'p1') return 4;
    if (lower.includes('medium') || lower === 'p2') return 3;
    if (lower.includes('low') || lower === 'p3') return 2;
    if (lower.includes('lowest') || lower === 'p4') return 1;
    const num = parseInt(value, 10);
    if (!isNaN(num)) return Math.min(5, Math.max(0, num));
    return 0;
  };

  // Parse all rows first
  const parsedRows: Array<{
    rowIndex: number;
    name: string;
    description: string | null;
    type: string;
    status: string;
    priority: number;
    owner: string | null;
    externalId: string | null;
    tags: string[];
    estimatedHours: number | null;
    parentName: string | null;
  }> = [];

  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = getValue(row, 'name');

    if (!name) {
      stats.skipped++;
      stats.warnings.push(`Row ${i + 1}: Skipped - no name`);
      continue;
    }

    // Check for duplicate
    if (seenNames.has(name)) {
      stats.skipped++;
      stats.warnings.push(`Row ${i + 1}: Skipped duplicate "${name}"`);
      continue;
    }
    seenNames.add(name);

    const description = getValue(row, 'description');
    const type = parseType(getValue(row, 'type'));
    const status = parseStatus(getValue(row, 'status'));
    const priority = parsePriority(getValue(row, 'priority'));
    const owner = getValue(row, 'owner');
    const externalId = getValue(row, 'externalId');
    const parentName = getValue(row, 'parentName');
    const tagsRaw = getValue(row, 'tags');
    const tags = tagsRaw
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    let estimatedHours: number | null = null;
    const hoursRaw = getValue(row, 'estimatedHours');
    if (hoursRaw) {
      const parsed = parseFloat(hoursRaw);
      if (!isNaN(parsed)) estimatedHours = parsed;
    }

    parsedRows.push({
      rowIndex: i + 1,
      name,
      description: description || null,
      type,
      status,
      priority,
      owner: owner || null,
      externalId: externalId || null,
      tags,
      estimatedHours,
      parentName: parentName || null,
    });
  }

  // Separate into components without parents and with parents
  const componentsWithoutParents = parsedRows.filter((r) => !r.parentName);
  const componentsWithParents = parsedRows.filter((r) => r.parentName);

  // Batch create components without parents
  if (componentsWithoutParents.length > 0) {
    try {
      await prisma.component.createMany({
        data: componentsWithoutParents.map((c) => ({
          name: c.name,
          description: c.description,
          type: c.type as any, // Type from parseType is already validated
          status: c.status as any, // Status from parseStatus is already validated
          priority: c.priority,
          owner: c.owner,
          externalId: c.externalId,
          tags: c.tags,
          estimatedHours: c.estimatedHours,
          projectId: targetProjectId,
          sprintId: autoAssignSprint || null,
        })),
        skipDuplicates: true,
      });

      // Fetch created components to get their IDs
      const created = await prisma.component.findMany({
        where: {
          projectId: targetProjectId,
          name: { in: componentsWithoutParents.map((c) => c.name) },
        },
        select: { id: true, name: true },
      });

      created.forEach((c) => {
        createdItems.set(c.name, c.id);
      });

      stats.created += created.length;
    } catch (error) {
      stats.errors.push(`Batch create failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Create missing parents first (if needed)
  const missingParents = new Set<string>();
  for (const comp of componentsWithParents) {
    if (comp.parentName && !createdItems.has(comp.parentName)) {
      missingParents.add(comp.parentName);
    }
  }

  if (missingParents.size > 0 && createMissingParents) {
    try {
      await prisma.component.createMany({
        data: Array.from(missingParents).map((name) => ({
          name,
          type: 'EPIC',
          projectId: targetProjectId,
          sprintId: autoAssignSprint || null,
        })),
        skipDuplicates: true,
      });

      const createdParents = await prisma.component.findMany({
        where: {
          projectId: targetProjectId,
          name: { in: Array.from(missingParents) },
        },
        select: { id: true, name: true },
      });

      createdParents.forEach((p) => {
        createdItems.set(p.name, p.id);
        stats.created++;
        stats.warnings.push(`Auto-created parent Epic: "${p.name}"`);
      });
    } catch (error) {
      stats.errors.push(
        `Failed to create missing parents: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Batch create components with parents
  if (componentsWithParents.length > 0) {
    try {
      await prisma.component.createMany({
        data: componentsWithParents.map((c) => ({
          name: c.name,
          description: c.description,
          type: c.type as any,
          status: c.status as any,
          priority: c.priority,
          owner: c.owner,
          externalId: c.externalId,
          tags: c.tags,
          estimatedHours: c.estimatedHours,
          projectId: targetProjectId,
          sprintId: autoAssignSprint || null,
          parentId: createdItems.get(c.parentName!) || null,
        })),
        skipDuplicates: true,
      });

      const created = await prisma.component.findMany({
        where: {
          projectId: targetProjectId,
          name: { in: componentsWithParents.map((c) => c.name) },
        },
        select: { id: true, name: true },
      });

      created.forEach((c) => {
        createdItems.set(c.name, c.id);
      });

      stats.created += created.length;
    } catch (error) {
      stats.errors.push(
        `Batch create with parents failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Resolve dependencies - batch create
  const dependenciesToCreate: Array<{ dependentComponentId: string; requiredComponentId: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = getValue(row, 'name');
    const depsRaw = getValue(row, 'dependencies');

    if (!name || !depsRaw) continue;

    const componentId = createdItems.get(name);
    if (!componentId) continue;

    const depNames = depsRaw
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    for (const depName of depNames) {
      const requiredId = createdItems.get(depName);
      if (requiredId && requiredId !== componentId) {
        dependenciesToCreate.push({
          dependentComponentId: componentId,
          requiredComponentId: requiredId,
        });
      } else if (!requiredId) {
        stats.warnings.push(`Dependency not found: "${name}" depends on "${depName}"`);
      }
    }
  }

  // Batch create dependencies
  if (dependenciesToCreate.length > 0) {
    try {
      await prisma.dependency.createMany({
        data: dependenciesToCreate,
        skipDuplicates: true,
      });
    } catch (error) {
      // Log but don't fail the import
      stats.warnings.push(
        `Some dependencies could not be created: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  revalidatePath(`/projects/${targetProjectId}`);
  revalidatePath(`/team/${teamId}`);

  return {
    projectId: targetProjectId,
    stats,
  };
});
