'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { analyzeImportData } from '@/lib/ai';
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
  const parentQueue: { id: string; parentName: string }[] = [];
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

  // First pass: Create all items
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = getValue(row, 'name');

    if (!name) {
      stats.skipped++;
      stats.warnings.push(`Row ${i + 1}: Skipped - no name`);
      continue;
    }

    // Check for duplicate
    if (createdItems.has(name)) {
      stats.skipped++;
      stats.warnings.push(`Row ${i + 1}: Skipped duplicate "${name}"`);
      continue;
    }

    try {
      const description = getValue(row, 'description');
      const type = parseType(getValue(row, 'type'));
      const status = parseStatus(getValue(row, 'status'));
      const priority = parsePriority(getValue(row, 'priority'));
      const owner = getValue(row, 'owner');
      const externalId = getValue(row, 'externalId');
      const parentName = getValue(row, 'parentName');
      const tagsRaw = getValue(row, 'tags');
      const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

      let estimatedHours: number | null = null;
      const hoursRaw = getValue(row, 'estimatedHours');
      if (hoursRaw) {
        const parsed = parseFloat(hoursRaw);
        if (!isNaN(parsed)) estimatedHours = parsed;
      }

      const component = await prisma.component.create({
        data: {
          name,
          description,
          type,
          status,
          priority,
          owner,
          externalId,
          tags,
          estimatedHours,
          projectId: targetProjectId,
          sprintId: autoAssignSprint,
        },
      });

      createdItems.set(name, component.id);
      stats.created++;

      // Queue for parent resolution
      if (parentName) {
        parentQueue.push({ id: component.id, parentName });
      }
    } catch (error) {
      stats.errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Second pass: Resolve parent relationships
  for (const { id, parentName } of parentQueue) {
    let parentId = createdItems.get(parentName);

    // If parent doesn't exist and we should create it
    if (!parentId && createMissingParents) {
      try {
        const parent = await prisma.component.create({
          data: {
            name: parentName,
            type: 'EPIC', // Assume missing parents are epics
            projectId: targetProjectId,
            sprintId: autoAssignSprint,
          },
        });
        parentId = parent.id;
        createdItems.set(parentName, parentId);
        stats.created++;
        stats.warnings.push(`Auto-created parent Epic: "${parentName}"`);
      } catch {
        stats.warnings.push(`Could not create parent "${parentName}"`);
      }
    }

    if (parentId) {
      await prisma.component.update({
        where: { id },
        data: { parentId },
      });
    } else {
      stats.warnings.push(`Parent not found: "${parentName}"`);
    }
  }

  // Third pass: Resolve dependencies
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = getValue(row, 'name');
    const depsRaw = getValue(row, 'dependencies');

    if (!name || !depsRaw) continue;

    const componentId = createdItems.get(name);
    if (!componentId) continue;

    const depNames = depsRaw.split(',').map((d) => d.trim()).filter(Boolean);
    for (const depName of depNames) {
      const requiredId = createdItems.get(depName);
      if (requiredId) {
        try {
          await prisma.dependency.create({
            data: {
              dependentComponentId: componentId,
              requiredComponentId: requiredId,
            },
          });
        } catch {
          // Likely duplicate, ignore
        }
      } else {
        stats.warnings.push(`Dependency not found: "${name}" depends on "${depName}"`);
      }
    }
  }

  revalidatePath(`/projects/${targetProjectId}`);
  revalidatePath(`/team/${teamId}`);

  return {
    projectId: targetProjectId,
    stats,
  };
});
