'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { analyzeImportData, cleanupImportData, isAIConfigured } from '@/lib/ai';
import type { ComponentType, ComponentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

// DynamoDB migration imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
import { verifyTeamMembership, verifyProjectAccess } from '@/lib/dynamodb/auth-helpers';

const analyzeSchema = z.object({
  teamId: z.string().min(1),
  headers: z.array(z.string()),
  sampleRows: z.array(z.record(z.string())),
});

const importSchema = z.object({
  teamId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  projectName: z.string().optional(),
  mappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: z.string().nullable(),
    }),
  ),
  rows: z.array(z.record(z.string())),
  createMissingParents: z.boolean().default(true),
  autoAssignSprint: z.string().min(1).optional(),
});

/**
 * Analyze uploaded data and suggest column mappings using AI
 */
export const analyzeImport = authActionClient.schema(analyzeSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, headers, sampleRows } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - use simple heuristic-based mapping
  if (isDemo) {
    return generateSimpleMappings(headers, sampleRows);
  }

  const phase = getMigrationPhase('membership');
  const entities = getEntities();

  // Verify user is member of team (phase-aware)
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new MyCustomError('You must be a team member to import data');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!membership) {
      throw new MyCustomError('You must be a team member to import data');
    }
  }

  // Get existing projects and sprints for context (phase-aware)
  let projectNames: string[];
  let sprintNames: string[];

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    // DynamoDB path
    const [projectsResult, sprintsResult] = await Promise.all([
      entities.project.query.byTeam({ teamId }).go(),
      entities.sprint.query.byTeam({ teamId }).go(),
    ]);

    projectNames = projectsResult.data.map((p) => p.name);
    sprintNames = sprintsResult.data
      .filter((s) => s.status === 'PLANNING' || s.status === 'ACTIVE')
      .map((s) => s.name);
  } else {
    // Prisma path
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

    projectNames = projects.map((p) => p.name);
    sprintNames = sprints.map((s) => s.name);
  }

  // Check if AI is configured
  if (!isAIConfigured()) {
    // Fallback to simple heuristic mapping
    return generateSimpleMappings(headers, sampleRows);
  }

  const result = await analyzeImportData(headers, sampleRows, projectNames, sprintNames);

  return result;
});

/**
 * Simple heuristic-based column mapping for demo mode or when AI is not available
 */
function generateSimpleMappings(headers: string[], sampleRows: Record<string, string>[]) {
  const mappings: Array<{ sourceColumn: string; targetField: string | null; confidence: number }> = [];

  const fieldPatterns: Record<string, RegExp[]> = {
    name: [/^(name|title|summary|issue|ticket)$/i, /name|title|summary/i],
    description: [/^(description|desc|details|body|content)$/i, /description|desc/i],
    type: [/^(type|issue.?type|kind|category)$/i, /type/i],
    status: [/^(status|state|stage)$/i, /status|state/i],
    priority: [/^(priority|severity|importance)$/i, /priority|severity/i],
    owner: [/^(owner|assignee|assigned|assigned.?to|user)$/i, /assignee|owner|assigned/i],
    estimatedHours: [/^(estimate|hours|effort|story.?points|points)$/i, /estimate|hours|effort/i],
    dueDate: [/^(due.?date|due|deadline|target.?date|end.?date)$/i, /due|deadline/i],
    parentName: [/^(parent|epic|parent.?name|epic.?name|epic.?link)$/i, /parent|epic/i],
    externalId: [/^(id|key|external.?id|jira.?key|issue.?key)$/i, /^key$/i],
    sprint: [/^(sprint|iteration|milestone)$/i, /sprint|iteration/i],
    tags: [/^(tags|labels|components)$/i, /tags|labels/i],
    dependencies: [/^(dependencies|depends.?on|blocked.?by|links)$/i, /depends|blocked/i],
  };

  for (const header of headers) {
    let matched = false;

    for (const [field, patterns] of Object.entries(fieldPatterns)) {
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(header)) {
          mappings.push({
            sourceColumn: header,
            targetField: field,
            confidence: i === 0 ? 0.95 : 0.7,
          });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      mappings.push({
        sourceColumn: header,
        targetField: null,
        confidence: 0,
      });
    }
  }

  // Detect format based on headers
  let detectedFormat = 'Generic spreadsheet';
  const headerStr = headers.join(' ').toLowerCase();
  if (headerStr.includes('jira') || headerStr.includes('issue key')) {
    detectedFormat = 'Jira export';
  } else if (headerStr.includes('asana')) {
    detectedFormat = 'Asana export';
  } else if (headerStr.includes('trello')) {
    detectedFormat = 'Trello export';
  }

  const suggestions: string[] = [];
  const warnings: string[] = [];

  if (!mappings.some((m) => m.targetField === 'name')) {
    warnings.push('No column mapped to Name - please select one manually');
  }

  return {
    mappings,
    detectedFormat,
    suggestions,
    warnings,
  };
}

const cleanupSchema = z.object({
  teamId: z.string().min(1),
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
  const { userId, isDemo } = ctx;

  // Demo mode - use simple cleanup
  if (isDemo) {
    return simpleCleanup(rows, mappings);
  }

  const phase = getMigrationPhase('membership');

  // Verify user is member of team (phase-aware)
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new MyCustomError('You must be a team member to clean data');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!membership) {
      throw new MyCustomError('You must be a team member to clean data');
    }
  }

  // Check if AI is configured
  if (!isAIConfigured()) {
    return simpleCleanup(rows, mappings);
  }

  const result = await cleanupImportData(rows, mappings);
  return result;
});

/**
 * Simple data cleanup for demo mode or when AI is not available
 */
function simpleCleanup(
  rows: Record<string, string>[],
  mappings: Array<{ sourceColumn: string; targetField: string | null }>,
) {
  const cleanedRows: Array<{ cleaned: Record<string, string>; changes: string[] }> = [];
  let totalChanges = 0;

  // Find which columns map to which fields
  const typeColumn = mappings.find((m) => m.targetField === 'type')?.sourceColumn;
  const statusColumn = mappings.find((m) => m.targetField === 'status')?.sourceColumn;
  const priorityColumn = mappings.find((m) => m.targetField === 'priority')?.sourceColumn;

  for (const row of rows) {
    const cleaned = { ...row };
    const changes: string[] = [];

    // Normalize type values
    if (typeColumn && cleaned[typeColumn]) {
      const original = cleaned[typeColumn];
      const lower = original.toLowerCase();
      let normalized = original;

      if (lower.includes('epic')) normalized = 'EPIC';
      else if (lower.includes('feature')) normalized = 'FEATURE';
      else if (lower.includes('story') || lower.includes('user story')) normalized = 'STORY';
      else if (lower.includes('bug') || lower.includes('defect')) normalized = 'BUG';
      else if (lower.includes('task') || lower.includes('sub-task')) normalized = 'TASK';

      if (normalized !== original) {
        cleaned[typeColumn] = normalized;
        changes.push(`Type: "${original}" → "${normalized}"`);
        totalChanges++;
      }
    }

    // Normalize status values
    if (statusColumn && cleaned[statusColumn]) {
      const original = cleaned[statusColumn];
      const lower = original.toLowerCase();
      let normalized = original;

      if (lower.includes('to do') || lower.includes('todo') || lower.includes('open') || lower.includes('new'))
        normalized = 'PLANNING';
      else if (lower.includes('progress') || lower.includes('doing') || lower.includes('active'))
        normalized = 'IN_PROGRESS';
      else if (lower.includes('block')) normalized = 'BLOCKED';
      else if (lower.includes('review') || lower.includes('testing') || lower.includes('qa')) normalized = 'REVIEW';
      else if (lower.includes('done') || lower.includes('complete') || lower.includes('closed'))
        normalized = 'COMPLETED';

      if (normalized !== original) {
        cleaned[statusColumn] = normalized;
        changes.push(`Status: "${original}" → "${normalized}"`);
        totalChanges++;
      }
    }

    // Normalize priority values
    if (priorityColumn && cleaned[priorityColumn]) {
      const original = cleaned[priorityColumn];
      const lower = original.toLowerCase();
      let normalized = original;

      if (lower.includes('highest') || lower.includes('critical') || lower === 'p0') normalized = '5';
      else if (lower.includes('high') || lower === 'p1') normalized = '4';
      else if (lower.includes('medium') || lower === 'p2') normalized = '3';
      else if (lower.includes('low') || lower === 'p3') normalized = '2';
      else if (lower.includes('lowest') || lower === 'p4') normalized = '1';

      if (normalized !== original) {
        cleaned[priorityColumn] = normalized;
        changes.push(`Priority: "${original}" → "${normalized}"`);
        totalChanges++;
      }
    }

    cleanedRows.push({ cleaned, changes });
  }

  return { rows: cleanedRows, totalChanges };
}

/**
 * Execute the import with mapped data
 */
export const executeImport = authActionClient.schema(importSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, projectId, projectName, mappings, rows, createMissingParents, autoAssignSprint } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return {
      _demo: true,
      _action: 'executeImport',
      _input: { teamId, projectId, projectName, mappings, rows, createMissingParents, autoAssignSprint },
    };
  }

  const phase = getMigrationPhase('component');
  const entities = getEntities();

  // Verify user is member of team (phase-aware)
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new MyCustomError('You must be a team member to import data');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!membership) {
      throw new MyCustomError('You must be a team member to import data');
    }
  }

  // Create or get project
  let targetProjectId = projectId;
  if (!targetProjectId && projectName) {
    const newProjectId = randomUUID();

    await dualWrite(
      'project',
      'create',
      async () =>
        prisma.project.create({
          data: {
            id: newProjectId,
            name: projectName,
            teamId,
            ownerId: userId,
          },
        }),
      async () => {
        await entities.project
          .create({
            id: newProjectId,
            name: projectName,
            teamId,
            ownerId: userId,
          })
          .go();
        return { id: newProjectId };
      },
      { context: { action: 'executeImport-createProject', projectName } }
    );

    targetProjectId = newProjectId;
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

  // Helper to parse date
  const parseDate = (value?: string): Date | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (isNaN(parsed)) return null;
    return new Date(parsed);
  };

  // Pre-generate UUIDs for all parsed items
  const nameToId = new Map<string, string>();

  // Parse all rows first
  const parsedRows: Array<{
    id: string;
    rowIndex: number;
    name: string;
    description: string | null;
    type: ComponentType;
    status: ComponentStatus;
    priority: number;
    owner: string | null;
    externalId: string | null;
    tags: string[];
    estimatedHours: number | null;
    dueDate: Date | null;
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

    const id = randomUUID();
    nameToId.set(name, id);

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

    const dueDate = parseDate(getValue(row, 'dueDate'));

    parsedRows.push({
      id,
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
      dueDate,
      parentName: parentName || null,
    });
  }

  // Identify missing parents and pre-generate IDs for them
  const missingParents = new Set<string>();
  for (const comp of parsedRows) {
    if (comp.parentName && !nameToId.has(comp.parentName)) {
      missingParents.add(comp.parentName);
    }
  }

  if (createMissingParents) {
    for (const parentName of missingParents) {
      const parentId = randomUUID();
      nameToId.set(parentName, parentId);
    }
  }

  // Separate into components without parents and with parents
  const componentsWithoutParents = parsedRows.filter((r) => !r.parentName);
  const componentsWithParents = parsedRows.filter((r) => r.parentName);

  // Build dependency data
  const dependenciesToCreate: Array<{ id: string; dependentComponentId: string; requiredComponentId: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = getValue(row, 'name');
    const depsRaw = getValue(row, 'dependencies');

    if (!name || !depsRaw) continue;

    const componentId = nameToId.get(name);
    if (!componentId) continue;

    const depNames = depsRaw
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    for (const depName of depNames) {
      const requiredId = nameToId.get(depName);
      if (requiredId && requiredId !== componentId) {
        dependenciesToCreate.push({
          id: randomUUID(),
          dependentComponentId: componentId,
          requiredComponentId: requiredId,
        });
      } else if (!requiredId) {
        stats.warnings.push(`Dependency not found: "${name}" depends on "${depName}"`);
      }
    }
  }

  // Execute dual-write for all component operations
  const BATCH_SIZE = 25;

  await dualWrite(
    'component',
    'create',
    async () => {
      // Prisma: Batch create components

      // First: Create missing parents if needed
      if (missingParents.size > 0 && createMissingParents) {
        try {
          await prisma.component.createMany({
            data: Array.from(missingParents).map((name) => ({
              id: nameToId.get(name)!,
              name,
              type: 'EPIC',
              projectId: targetProjectId,
              sprintId: autoAssignSprint || null,
            })),
            skipDuplicates: true,
          });

          missingParents.forEach((name) => {
            createdItems.set(name, nameToId.get(name)!);
            stats.created++;
            stats.warnings.push(`Auto-created parent Epic: "${name}"`);
          });
        } catch (error) {
          stats.errors.push(
            `Failed to create missing parents: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Second: Create components without parents
      if (componentsWithoutParents.length > 0) {
        try {
          await prisma.component.createMany({
            data: componentsWithoutParents.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              type: c.type,
              status: c.status,
              priority: c.priority,
              owner: c.owner,
              externalId: c.externalId,
              tags: c.tags,
              estimatedHours: c.estimatedHours,
              dueDate: c.dueDate,
              projectId: targetProjectId,
              sprintId: autoAssignSprint || null,
            })),
            skipDuplicates: true,
          });

          componentsWithoutParents.forEach((c) => {
            createdItems.set(c.name, c.id);
          });

          stats.created += componentsWithoutParents.length;
        } catch (error) {
          stats.errors.push(`Batch create failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Third: Create components with parents
      if (componentsWithParents.length > 0) {
        try {
          await prisma.component.createMany({
            data: componentsWithParents.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              type: c.type,
              status: c.status,
              priority: c.priority,
              owner: c.owner,
              externalId: c.externalId,
              tags: c.tags,
              estimatedHours: c.estimatedHours,
              dueDate: c.dueDate,
              projectId: targetProjectId,
              sprintId: autoAssignSprint || null,
              parentId: nameToId.get(c.parentName!) || null,
            })),
            skipDuplicates: true,
          });

          componentsWithParents.forEach((c) => {
            createdItems.set(c.name, c.id);
          });

          stats.created += componentsWithParents.length;
        } catch (error) {
          stats.errors.push(
            `Batch create with parents failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Fourth: Create dependencies
      if (dependenciesToCreate.length > 0) {
        try {
          await prisma.dependency.createMany({
            data: dependenciesToCreate.map((d) => ({
              id: d.id,
              dependentComponentId: d.dependentComponentId,
              requiredComponentId: d.requiredComponentId,
            })),
            skipDuplicates: true,
          });
        } catch (error) {
          stats.warnings.push(
            `Some dependencies could not be created: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      return { count: stats.created };
    },
    async () => {
      // DynamoDB: Batch create with chunking

      // Helper for batch creation
      const batchCreate = async <T>(
        items: T[],
        createFn: (item: T) => Promise<unknown>
      ): Promise<void> => {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map((item) => createFn(item).catch(() => null)));
        }
      };

      // First: Create missing parents if needed
      if (missingParents.size > 0 && createMissingParents) {
        const parentData = Array.from(missingParents).map((name) => ({
          id: nameToId.get(name)!,
          name,
          type: 'EPIC' as const,
          projectId: targetProjectId!,
          status: 'PLANNING' as const,
          sprintId: autoAssignSprint || undefined,
        }));

        await batchCreate(parentData, (p) => entities.component.create(p).go());

        parentData.forEach((p) => {
          createdItems.set(p.name, p.id);
        });
      }

      // Second: Create components without parents
      if (componentsWithoutParents.length > 0) {
        await batchCreate(componentsWithoutParents, (c) =>
          entities.component
            .create({
              id: c.id,
              name: c.name,
              description: c.description || undefined,
              type: c.type,
              status: c.status,
              priority: c.priority,
              owner: c.owner || undefined,
              externalId: c.externalId || undefined,
              tags: c.tags,
              estimatedHours: c.estimatedHours || undefined,
              dueDate: c.dueDate?.toISOString(),
              projectId: targetProjectId!,
              sprintId: autoAssignSprint || undefined,
            })
            .go()
        );

        componentsWithoutParents.forEach((c) => {
          createdItems.set(c.name, c.id);
        });
      }

      // Third: Create components with parents
      if (componentsWithParents.length > 0) {
        await batchCreate(componentsWithParents, (c) =>
          entities.component
            .create({
              id: c.id,
              name: c.name,
              description: c.description || undefined,
              type: c.type,
              status: c.status,
              priority: c.priority,
              owner: c.owner || undefined,
              externalId: c.externalId || undefined,
              tags: c.tags,
              estimatedHours: c.estimatedHours || undefined,
              dueDate: c.dueDate?.toISOString(),
              projectId: targetProjectId!,
              sprintId: autoAssignSprint || undefined,
              parentId: nameToId.get(c.parentName!) || undefined,
            })
            .go()
        );

        componentsWithParents.forEach((c) => {
          createdItems.set(c.name, c.id);
        });
      }

      // Fourth: Create dependencies
      if (dependenciesToCreate.length > 0) {
        await batchCreate(dependenciesToCreate, (d) =>
          entities.dependency
            .create({
              id: d.id,
              dependentComponentId: d.dependentComponentId,
              requiredComponentId: d.requiredComponentId,
            })
            .go()
        );
      }

      return { count: parsedRows.length + (createMissingParents ? missingParents.size : 0) };
    },
    { context: { action: 'executeImport', projectId: targetProjectId, rowCount: parsedRows.length } }
  );

  revalidatePath(`/projects/${targetProjectId}`);
  revalidatePath(`/team/${teamId}`);

  return {
    projectId: targetProjectId,
    stats,
  };
});
