import { z } from 'zod';
import { logger } from '@/lib/logger';

export const notifyJobSchema = z.object({
  type: z.literal('notify'),
  userId: z.string(),
  message: z.string(),
  channel: z.enum(['email', 'in-app', 'push']).optional().default('in-app'),
});

export type NotifyJobPayload = z.infer<typeof notifyJobSchema>;

export async function notifyJobHandler(payload: NotifyJobPayload): Promise<void> {
  logger.info('Processing notify job', { userId: payload.userId, channel: payload.channel });

  // TODO: Implement actual notification logic
  // For now, just log the notification
  logger.info('Notification sent', {
    userId: payload.userId,
    message: payload.message,
    channel: payload.channel,
  });
}
