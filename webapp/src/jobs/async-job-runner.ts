import { notifyJobHandler, notifyJobSchema } from '@/jobs/async-job/notify';
import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const jobPayloadPropsSchema = z.discriminatedUnion('type', [
  notifyJobSchema,
  z.object({
    type: z.literal('example'),
  }),
]);

export type JobPayloadProps = z.infer<typeof jobPayloadPropsSchema>;

export const handler: Handler<unknown> = async (event, context) => {
  logger.info('Async job received', { event });

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
