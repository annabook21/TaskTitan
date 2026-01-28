/**
 * Background Validation Job for Data Consistency
 *
 * Periodically samples and compares data between Prisma (Aurora) and DynamoDB
 * to detect discrepancies during the dual-write migration phase.
 *
 * Usage:
 * - Run as a scheduled Lambda (e.g., every 5 minutes)
 * - Or trigger manually for spot checks
 *
 * ```typescript
 * const result = await runValidationJob({
 *   entities: ['team', 'project', 'component'],
 *   sampleSize: 100,
 * });
 * ```
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { prisma } from '@/lib/prisma';
import { getEntities } from './service';
import type { EntityName } from './feature-flags';

const logger = new Logger({ serviceName: 'ValidationJob' });

export interface ValidationOptions {
  /**
   * Entities to validate (defaults to all)
   */
  entities?: EntityName[];

  /**
   * Number of records to sample per entity (default: 100)
   */
  sampleSize?: number;

  /**
   * Maximum age of records to consider (in hours, default: 24)
   */
  maxAgeHours?: number;

  /**
   * Stop on first discrepancy (default: false)
   */
  stopOnFirstDiscrepancy?: boolean;
}

export interface ValidationResult {
  entityName: EntityName;
  sampledCount: number;
  matchedCount: number;
  discrepancyCount: number;
  missingInDynamoDB: string[];
  missingInPrisma: string[];
  fieldDiscrepancies: Array<{
    id: string;
    field: string;
    prismaValue: unknown;
    dynamoValue: unknown;
  }>;
  duration: number;
}

export interface ValidationJobResult {
  success: boolean;
  totalSampled: number;
  totalDiscrepancies: number;
  results: ValidationResult[];
  duration: number;
  timestamp: string;
}

/**
 * Run the validation job
 */
export async function runValidationJob(
  options: ValidationOptions = {}
): Promise<ValidationJobResult> {
  const {
    entities = ['team', 'project', 'component', 'membership'],
    sampleSize = 100,
    maxAgeHours = 24,
    stopOnFirstDiscrepancy = false,
  } = options;

  const startTime = Date.now();
  const results: ValidationResult[] = [];
  let totalDiscrepancies = 0;
  let totalSampled = 0;

  logger.info('Starting validation job', { entities, sampleSize, maxAgeHours });

  for (const entityName of entities) {
    try {
      const result = await validateEntity(entityName, sampleSize, maxAgeHours);
      results.push(result);
      totalDiscrepancies += result.discrepancyCount;
      totalSampled += result.sampledCount;

      if (stopOnFirstDiscrepancy && result.discrepancyCount > 0) {
        logger.warn('Stopping validation due to discrepancy', { entityName });
        break;
      }
    } catch (error) {
      logger.error('Validation failed for entity', { entityName, error });
      results.push({
        entityName,
        sampledCount: 0,
        matchedCount: 0,
        discrepancyCount: 0,
        missingInDynamoDB: [],
        missingInPrisma: [],
        fieldDiscrepancies: [],
        duration: 0,
      });
    }
  }

  const duration = Date.now() - startTime;

  const jobResult: ValidationJobResult = {
    success: totalDiscrepancies === 0,
    totalSampled,
    totalDiscrepancies,
    results,
    duration,
    timestamp: new Date().toISOString(),
  };

  // Log summary
  logger.info('Validation job completed', {
    success: jobResult.success,
    totalSampled,
    totalDiscrepancies,
    duration,
  });

  // Log detailed discrepancies
  if (totalDiscrepancies > 0) {
    logger.warn('Discrepancies found', {
      results: results.filter((r) => r.discrepancyCount > 0),
    });
  }

  return jobResult;
}

/**
 * Validate a single entity type
 */
async function validateEntity(
  entityName: EntityName,
  sampleSize: number,
  maxAgeHours: number
): Promise<ValidationResult> {
  const startTime = Date.now();
  const result: ValidationResult = {
    entityName,
    sampledCount: 0,
    matchedCount: 0,
    discrepancyCount: 0,
    missingInDynamoDB: [],
    missingInPrisma: [],
    fieldDiscrepancies: [],
    duration: 0,
  };

  const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const entities = getEntities();

  try {
    switch (entityName) {
      case 'team':
        await validateTeams(result, sampleSize, cutoffDate, entities);
        break;
      case 'project':
        await validateProjects(result, sampleSize, cutoffDate, entities);
        break;
      case 'membership':
        await validateMemberships(result, sampleSize, cutoffDate, entities);
        break;
      case 'component':
        await validateComponents(result, sampleSize, cutoffDate, entities);
        break;
      default:
        logger.debug('Validation not implemented for entity', { entityName });
    }
  } catch (error) {
    logger.error('Entity validation failed', { entityName, error });
  }

  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Validate teams
 */
async function validateTeams(
  result: ValidationResult,
  sampleSize: number,
  cutoffDate: Date,
  entities: ReturnType<typeof getEntities>
): Promise<void> {
  // Get sample from Prisma
  const prismaTeams = await prisma.team.findMany({
    where: { createdAt: { gte: cutoffDate } },
    take: sampleSize,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, description: true },
  });

  result.sampledCount = prismaTeams.length;

  for (const prismaTeam of prismaTeams) {
    try {
      const dynamoResult = await entities.team.get({ id: prismaTeam.id }).go();
      const dynamoTeam = dynamoResult.data;

      if (!dynamoTeam) {
        result.missingInDynamoDB.push(prismaTeam.id);
        result.discrepancyCount++;
        continue;
      }

      // Compare fields
      const fieldChecks = [
        { field: 'name', prisma: prismaTeam.name, dynamo: dynamoTeam.name },
        {
          field: 'description',
          prisma: prismaTeam.description ?? null,
          dynamo: dynamoTeam.description ?? null,
        },
      ];

      let hasDiscrepancy = false;
      for (const check of fieldChecks) {
        if (check.prisma !== check.dynamo) {
          result.fieldDiscrepancies.push({
            id: prismaTeam.id,
            field: check.field,
            prismaValue: check.prisma,
            dynamoValue: check.dynamo,
          });
          hasDiscrepancy = true;
        }
      }

      if (hasDiscrepancy) {
        result.discrepancyCount++;
      } else {
        result.matchedCount++;
      }
    } catch (error) {
      logger.error('Failed to validate team', { id: prismaTeam.id, error });
      result.missingInDynamoDB.push(prismaTeam.id);
      result.discrepancyCount++;
    }
  }
}

/**
 * Validate projects
 */
async function validateProjects(
  result: ValidationResult,
  sampleSize: number,
  cutoffDate: Date,
  entities: ReturnType<typeof getEntities>
): Promise<void> {
  const prismaProjects = await prisma.project.findMany({
    where: { createdAt: { gte: cutoffDate } },
    take: sampleSize,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, description: true, teamId: true, ownerId: true },
  });

  result.sampledCount = prismaProjects.length;

  for (const prismaProject of prismaProjects) {
    try {
      const dynamoResult = await entities.project.get({ id: prismaProject.id }).go();
      const dynamoProject = dynamoResult.data;

      if (!dynamoProject) {
        result.missingInDynamoDB.push(prismaProject.id);
        result.discrepancyCount++;
        continue;
      }

      const fieldChecks = [
        { field: 'name', prisma: prismaProject.name, dynamo: dynamoProject.name },
        {
          field: 'description',
          prisma: prismaProject.description ?? null,
          dynamo: dynamoProject.description ?? null,
        },
        { field: 'teamId', prisma: prismaProject.teamId, dynamo: dynamoProject.teamId },
        { field: 'ownerId', prisma: prismaProject.ownerId, dynamo: dynamoProject.ownerId },
      ];

      let hasDiscrepancy = false;
      for (const check of fieldChecks) {
        if (check.prisma !== check.dynamo) {
          result.fieldDiscrepancies.push({
            id: prismaProject.id,
            field: check.field,
            prismaValue: check.prisma,
            dynamoValue: check.dynamo,
          });
          hasDiscrepancy = true;
        }
      }

      if (hasDiscrepancy) {
        result.discrepancyCount++;
      } else {
        result.matchedCount++;
      }
    } catch (error) {
      logger.error('Failed to validate project', { id: prismaProject.id, error });
      result.missingInDynamoDB.push(prismaProject.id);
      result.discrepancyCount++;
    }
  }
}

/**
 * Validate memberships
 */
async function validateMemberships(
  result: ValidationResult,
  sampleSize: number,
  cutoffDate: Date,
  entities: ReturnType<typeof getEntities>
): Promise<void> {
  const prismaMemberships = await prisma.membership.findMany({
    where: { joinedAt: { gte: cutoffDate } },
    take: sampleSize,
    orderBy: { joinedAt: 'desc' },
    select: { id: true, teamId: true, userId: true, role: true },
  });

  result.sampledCount = prismaMemberships.length;

  for (const prismaMembership of prismaMemberships) {
    try {
      // Use get with composite key
      const dynamoResult = await entities.membership
        .get({
          teamId: prismaMembership.teamId,
          userId: prismaMembership.userId,
        })
        .go();
      const dynamoMembership = dynamoResult.data;

      if (!dynamoMembership) {
        result.missingInDynamoDB.push(prismaMembership.id);
        result.discrepancyCount++;
        continue;
      }

      const fieldChecks = [
        { field: 'role', prisma: prismaMembership.role, dynamo: dynamoMembership.role },
      ];

      let hasDiscrepancy = false;
      for (const check of fieldChecks) {
        if (check.prisma !== check.dynamo) {
          result.fieldDiscrepancies.push({
            id: prismaMembership.id,
            field: check.field,
            prismaValue: check.prisma,
            dynamoValue: check.dynamo,
          });
          hasDiscrepancy = true;
        }
      }

      if (hasDiscrepancy) {
        result.discrepancyCount++;
      } else {
        result.matchedCount++;
      }
    } catch (error) {
      logger.error('Failed to validate membership', { id: prismaMembership.id, error });
      result.missingInDynamoDB.push(prismaMembership.id);
      result.discrepancyCount++;
    }
  }
}

/**
 * Validate components
 */
async function validateComponents(
  result: ValidationResult,
  sampleSize: number,
  cutoffDate: Date,
  entities: ReturnType<typeof getEntities>
): Promise<void> {
  const prismaComponents = await prisma.component.findMany({
    where: { createdAt: { gte: cutoffDate } },
    take: sampleSize,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      type: true,
      priority: true,
      projectId: true,
    },
  });

  result.sampledCount = prismaComponents.length;

  for (const prismaComponent of prismaComponents) {
    try {
      const dynamoResult = await entities.component.get({ id: prismaComponent.id }).go();
      const dynamoComponent = dynamoResult.data;

      if (!dynamoComponent) {
        result.missingInDynamoDB.push(prismaComponent.id);
        result.discrepancyCount++;
        continue;
      }

      const fieldChecks = [
        { field: 'name', prisma: prismaComponent.name, dynamo: dynamoComponent.name },
        { field: 'status', prisma: prismaComponent.status, dynamo: dynamoComponent.status },
        { field: 'type', prisma: prismaComponent.type, dynamo: dynamoComponent.type },
        {
          field: 'priority',
          prisma: prismaComponent.priority ?? null,
          dynamo: dynamoComponent.priority ?? null,
        },
        { field: 'projectId', prisma: prismaComponent.projectId, dynamo: dynamoComponent.projectId },
      ];

      let hasDiscrepancy = false;
      for (const check of fieldChecks) {
        if (check.prisma !== check.dynamo) {
          result.fieldDiscrepancies.push({
            id: prismaComponent.id,
            field: check.field,
            prismaValue: check.prisma,
            dynamoValue: check.dynamo,
          });
          hasDiscrepancy = true;
        }
      }

      if (hasDiscrepancy) {
        result.discrepancyCount++;
      } else {
        result.matchedCount++;
      }
    } catch (error) {
      logger.error('Failed to validate component', { id: prismaComponent.id, error });
      result.missingInDynamoDB.push(prismaComponent.id);
      result.discrepancyCount++;
    }
  }
}

/**
 * Quick consistency check for a single record
 */
export async function validateSingleRecord(
  entityName: EntityName,
  id: string
): Promise<{
  exists: { prisma: boolean; dynamodb: boolean };
  matches: boolean;
  discrepancies: Array<{ field: string; prismaValue: unknown; dynamoValue: unknown }>;
}> {
  const result = {
    exists: { prisma: false, dynamodb: false },
    matches: false,
    discrepancies: [] as Array<{ field: string; prismaValue: unknown; dynamoValue: unknown }>,
  };

  const entities = getEntities();

  try {
    switch (entityName) {
      case 'team': {
        const [prismaTeam, dynamoResult] = await Promise.all([
          prisma.team.findUnique({ where: { id } }),
          entities.team.get({ id }).go(),
        ]);

        result.exists.prisma = !!prismaTeam;
        result.exists.dynamodb = !!dynamoResult.data;

        if (prismaTeam && dynamoResult.data) {
          const dynamoTeam = dynamoResult.data;
          if (prismaTeam.name !== dynamoTeam.name) {
            result.discrepancies.push({
              field: 'name',
              prismaValue: prismaTeam.name,
              dynamoValue: dynamoTeam.name,
            });
          }
          if ((prismaTeam.description ?? null) !== (dynamoTeam.description ?? null)) {
            result.discrepancies.push({
              field: 'description',
              prismaValue: prismaTeam.description,
              dynamoValue: dynamoTeam.description,
            });
          }
          result.matches = result.discrepancies.length === 0;
        }
        break;
      }
      // Add other entities as needed
      default:
        logger.debug('Single record validation not implemented', { entityName });
    }
  } catch (error) {
    logger.error('Single record validation failed', { entityName, id, error });
  }

  return result;
}
