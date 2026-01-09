import { sendEvent } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Notification job for TaskTitan async events
 *
 * This job handles asynchronous notifications such as:
 * - Component assignment notifications
 * - Project activity updates
 * - Team invitations
 */

export const notifyJobSchema = z.object({
  type: z.literal('notify'),
  notificationType: z.enum(['component_assigned', 'component_status_changed', 'project_activity']),
  userId: z.string(),
  componentId: z.string().optional(),
  projectId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const notifyJobHandler = async (params: z.infer<typeof notifyJobSchema>) => {
  logger.info('Processing notification job', {
    extra: {
      notificationType: params.notificationType,
      userId: params.userId,
    },
  });

  switch (params.notificationType) {
    case 'component_assigned': {
      if (!params.componentId) {
        logger.warn('component_assigned notification missing componentId');
        return;
      }

      const component = await prisma.component.findUnique({
        where: { id: params.componentId },
        include: {
          Project: { select: { name: true } },
        },
      });

      if (!component) {
        logger.warn('Component not found for notification', { extra: { componentId: params.componentId } });
        return;
      }

      logger.info('Sending component assignment notification', {
        extra: {
          componentName: component.name,
          projectName: component.Project.name,
          userId: params.userId,
        },
      });

      // Send real-time event to the user
      await sendEvent(`user/${params.userId}/notifications`, {
        type: 'component_assigned',
        componentId: component.id,
        componentName: component.name,
        projectName: component.Project.name,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case 'component_status_changed': {
      if (!params.componentId) {
        logger.warn('component_status_changed notification missing componentId');
        return;
      }

      const component = await prisma.component.findUnique({
        where: { id: params.componentId },
        include: {
          Project: { select: { name: true } },
          Assignment: { select: { userId: true } },
        },
      });

      if (!component) {
        logger.warn('Component not found for status notification', { extra: { componentId: params.componentId } });
        return;
      }

      // Notify all assigned users about the status change
      for (const assignment of component.Assignment) {
        await sendEvent(`user/${assignment.userId}/notifications`, {
          type: 'component_status_changed',
          componentId: component.id,
          componentName: component.name,
          projectName: component.Project.name,
          newStatus: component.status,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info('Sent status change notifications', {
        extra: {
          componentId: component.id,
          notifiedUsers: component.Assignment.length,
        },
      });
      break;
    }

    case 'project_activity': {
      if (!params.projectId) {
        logger.warn('project_activity notification missing projectId');
        return;
      }

      // Send activity update to the user
      await sendEvent(`user/${params.userId}/notifications`, {
        type: 'project_activity',
        projectId: params.projectId,
        metadata: params.metadata,
        timestamp: new Date().toISOString(),
      });

      logger.info('Sent project activity notification', {
        extra: {
          projectId: params.projectId,
          userId: params.userId,
        },
      });
      break;
    }
  }

  // Signal job completion
  await sendEvent(`user/${params.userId}/jobs`, { type: 'completed' });
};
