import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { Architecture, IFunction, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { join } from 'path';

export interface EmailServiceProps {
  /**
   * Email address or domain to use for sending invitations.
   * If not provided, defaults to 'noreply@tasktitan.live'
   */
  readonly fromEmail?: string;
  /**
   * Frontend URL for invitation links (e.g., 'https://tasktitan.live')
   */
  readonly frontendUrl: string;
}

export class EmailService extends Construct {
  readonly handler: IFunction;
  readonly tokenGenerator: IFunction;
  readonly tokenHasher: IFunction;
  readonly fromEmail: string;

  constructor(scope: Construct, id: string, props: EmailServiceProps) {
    super(scope, id);
    const { fromEmail = 'noreply@tasktitan.live', frontendUrl } = props;
    this.fromEmail = fromEmail;

    // SES Email Identity (must be verified in AWS Console)
    // AWS Best Practice: Use verified email identity for production
    // Reference: https://docs.aws.amazon.com/ses/latest/dg/verify-email-addresses.html
    const emailIdentity = new EmailIdentity(this, 'EmailIdentity', {
      identity: Identity.email(fromEmail),
    });

    new CfnOutput(this, 'EmailIdentityArn', {
      value: emailIdentity.emailIdentityArn,
      description: 'SES Email Identity ARN - verify this email in AWS SES Console',
    });

    // Dead Letter Queue for failed email Lambda invocations
    // AWS Best Practice: Use DLQ for failed async operations
    const emailDlq = new Queue(this, 'EmailDLQ', {
      queueName: `${Stack.of(this).stackName}-EmailDLQ`,
      retentionPeriod: Duration.days(14), // Retain failed emails for 14 days
    });

    // Lambda function for sending invitation emails
    const handler = new NodejsFunction(this, 'EmailHandler', {
      entry: join(__dirname, 'email-service', 'send-invitation-email.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        FROM_EMAIL: fromEmail,
        FRONTEND_URL: frontendUrl,
      },
      tracing: Tracing.ACTIVE,
      deadLetterQueue: emailDlq, // Failed invocations go to DLQ
      retryAttempts: 2, // Retry failed invocations twice before sending to DLQ
    });

    // Grant SES SendEmail permission
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [emailIdentity.emailIdentityArn],
      }),
    );

    // Lambda function for generating cryptographically secure tokens
    // AWS Best Practice: Use crypto.randomBytes for secure token generation
    const tokenGenerator = new NodejsFunction(this, 'TokenGenerator', {
      entry: join(__dirname, 'email-service', 'generate-secure-token.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      tracing: Tracing.ACTIVE,
    });

    // Lambda function for hashing tokens using SHA-256
    // AWS Best Practice: Hash sensitive tokens before storage
    const tokenHasher = new NodejsFunction(this, 'TokenHasher', {
      entry: join(__dirname, 'email-service', 'hash-token.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      tracing: Tracing.ACTIVE,
    });

    this.handler = handler;
    this.tokenGenerator = tokenGenerator;
    this.tokenHasher = tokenHasher;
  }
}
