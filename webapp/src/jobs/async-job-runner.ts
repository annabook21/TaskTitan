import { notifyJobHandler, notifyJobSchema } from '@/jobs/async-job/notify';
import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { handleAppSyncGenerateComponentViaAI } from '@/jobs/async-job/appsync-bedrock';

const jobPayloadPropsSchema = z.discriminatedUnion('type', [
  notifyJobSchema,
  z.object({
    type: z.literal('example'),
  }),
]);

export type JobPayloadProps = z.infer<typeof jobPayloadPropsSchema>;

/** AppSync invokes with { projectId, prompt }; async jobs use { type, ... } */
function isAppSyncGenerateComponentViaAI(event: unknown): event is { projectId: string; prompt: string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'prompt' in event &&
    typeof (event as { projectId: unknown }).projectId === 'string' &&
    typeof (event as { prompt: unknown }).prompt === 'string'
  );
}

export const handler: Handler<unknown> = async (event, context) => {
  logger.info('Async job received', { event });

  // Phase 2: AppSync mutation generateComponentViaAI (sync Bedrock)
  if (isAppSyncGenerateComponentViaAI(event)) {
    const result = await handleAppSyncGenerateComponentViaAI(event.projectId, event.prompt);
    return result;
  }

  const { data: payload, error } = jobPayloadPropsSchema.safeParse(event);
  if (error) {
    logger.error('Invalid job payload', { error: error.toString() });
    throw new Error(error.toString());
  }

  switch (payload.type) {
    case 'notify':
      await notifyJobHandler(payload);
      break;
    case 'example':
      logger.info('Example job processed');
      break;
  }
};
