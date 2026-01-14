import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack, TimeZone } from 'aws-cdk-lib';
import { Architecture, DockerImageCode, DockerImageFunction, IFunction, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Database } from './database';
import { EventBus } from './event-bus';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';

export interface AsyncJobProps {
  readonly database: Database;
  readonly eventBus: EventBus;
}

export class AsyncJob extends Construct {
  readonly handler: IFunction;

  constructor(scope: Construct, id: string, props: AsyncJobProps) {
    super(scope, id);
    const { database, eventBus } = props;

    // Dead Letter Queue for failed async jobs
    // AWS Best Practice: Capture failed invocations for debugging and retry
    // Reference: https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html#invocation-dlq
    const deadLetterQueue = new Queue(this, 'DeadLetterQueue', {
      queueName: `${Stack.of(this).stackName}-AsyncJob-DLQ`,
      retentionPeriod: Duration.days(14), // Maximum allowed retention
      encryption: QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
    });

    new CfnOutput(this, 'DLQUrl', {
      value: deadLetterQueue.queueUrl,
      description: 'Dead Letter Queue URL for failed async jobs - monitor this queue for failures',
    });

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset(join('..', 'webapp'), {
        cmd: ['async-job-runner.handler'],
        platform: Platform.LINUX_ARM64,
        file: 'job.Dockerfile',
      }),
      memorySize: 1024, // Increased for AI operations (Bedrock SDK + JSON parsing)
      timeout: Duration.minutes(10),
      architecture: Architecture.ARM_64,
      environment: {
        ...database.getLambdaEnvironment('main'),
        EVENT_HTTP_ENDPOINT: eventBus.httpEndpoint,
        // AWS Powertools configuration for structured logging
        POWERTOOLS_SERVICE_NAME: 'TaskTitanAsyncJob',
        LOG_LEVEL: 'INFO',
      },
      vpc: database.cluster.vpc,
      // AWS Best Practice: Set based on downstream capacity
      // 25 concurrent × 1 Prisma connection = 25 DB connections (safe for Aurora)
      // Reference: https://docs.aws.amazon.com/lambda/latest/operatorguide/lambda-concurrency.html
      reservedConcurrentExecutions: 25,
      // X-Ray tracing for async job processing
      tracing: Tracing.ACTIVE,
      // DLQ configuration for failed async invocations
      deadLetterQueue: deadLetterQueue,
      deadLetterQueueEnabled: true,
      retryAttempts: 2, // Retry 2 times before sending to DLQ (AWS max)
    });

    handler.connections.allowToDefaultPort(database);
    eventBus.api.grantPublish(handler);

    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['translate:TranslateText', 'comprehend:DetectDominantLanguage'],
        resources: ['*'], // These services don't support resource-level permissions
      }),
    );

    // Add Bedrock permissions for AI features in async jobs
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Global inference profile (10% cost savings)
          `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:inference-profile/global.anthropic.claude-sonnet-4-5-*`,
          // Regional inference profile (fallback)
          `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:inference-profile/us.anthropic.claude-sonnet-4-5-*`,
          // Foundation model access
          `arn:aws:bedrock:*:${Stack.of(this).account}:foundation-model/anthropic.claude-*`,
        ],
      }),
    );

    new CfnOutput(this, 'HandlerArn', { value: handler.functionArn });
    this.handler = handler;

    // you can add scheduled jobs here.
    this.addSchedule(
      'SampleJob',
      ScheduleExpression.cron({ minute: '0', hour: '0', day: '1', timeZone: TimeZone.ETC_UTC }),
    );
  }

  public addSchedule(jobType: string, schedule: ScheduleExpression, payload?: any) {
    return new Schedule(this, jobType, {
      schedule,
      target: new LambdaInvoke(this.handler, {
        input: ScheduleTargetInput.fromObject({ jobType, payload }),
        retryAttempts: 5,
      }),
    });
  }
}
