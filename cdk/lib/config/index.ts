/**
 * CDK Configuration Management
 *
 * AWS Best Practice: Use cdk.json context for environment-specific configuration
 * with fail-fast validation at synthesis time (before CloudFormation deployment).
 *
 * Reference: https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html
 */
import * as cdk from 'aws-cdk-lib';

/**
 * Email configuration for SES
 */
export interface EmailConfig {
  /** Email address for sending invitations (e.g., 'noreply@tasktitan.live') */
  readonly fromAddress: string;
}

/**
 * Environment-specific configuration for TaskTitan
 */
export interface EnvironmentConfig {
  /** AWS Account ID for this environment */
  readonly accountId: string;

  /** Custom domain for CloudFront (e.g., 'tasktitan.live') */
  readonly customDomain: string;

  /**
   * ACM Certificate ARN for the custom domain.
   * MUST be in us-east-1 region for CloudFront.
   */
  readonly certificateArn: string;

  /** Email configuration */
  readonly email: EmailConfig;
}

/**
 * Root configuration containing all environments
 */
export interface TaskTitanConfig {
  readonly [environmentName: string]: EnvironmentConfig | undefined;
}

/**
 * Configuration validation error with clear, actionable messages
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates that a certificate ARN is in us-east-1 region (required for CloudFront)
 */
function validateCertificateArn(arn: string, environmentName: string): void {
  // ARN format: arn:aws:acm:REGION:ACCOUNT:certificate/ID
  const arnPattern = /^arn:aws:acm:([a-z0-9-]+):(\d+):certificate\/[\w-]+$/;
  const match = arn.match(arnPattern);

  if (!match) {
    throw new ConfigurationError(
      `Invalid certificate ARN format for environment '${environmentName}'.\n` +
        `Expected: arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID\n` +
        `Got: ${arn}`,
    );
  }

  const region = match[1];
  if (region !== 'us-east-1') {
    throw new ConfigurationError(
      `Certificate for environment '${environmentName}' must be in us-east-1 region (required for CloudFront).\n` +
        `Current region: ${region}\n` +
        `Certificate ARN: ${arn}`,
    );
  }
}

/**
 * Validates a complete environment configuration
 */
function validateEnvironmentConfig(config: EnvironmentConfig, environmentName: string): void {
  const missingFields: string[] = [];

  if (!config.accountId) missingFields.push('accountId');
  if (!config.customDomain) missingFields.push('customDomain');
  if (!config.certificateArn) missingFields.push('certificateArn');
  if (!config.email?.fromAddress) missingFields.push('email.fromAddress');

  if (missingFields.length > 0) {
    throw new ConfigurationError(
      `Missing required configuration for environment '${environmentName}':\n` +
        `  - ${missingFields.join('\n  - ')}\n\n` +
        `Add these to cdk.json under context.taskTitanConfig.${environmentName}`,
    );
  }

  validateCertificateArn(config.certificateArn, environmentName);
}

/**
 * Loads and validates TaskTitan configuration from CDK context.
 *
 * AWS Best Practice: Fail fast at synthesis time with clear error messages,
 * rather than waiting for CloudFormation deployment to fail.
 *
 * @param app - The CDK App instance
 * @param currentAccountId - The current AWS account ID (from CDK_DEFAULT_ACCOUNT)
 * @returns The validated environment configuration
 * @throws ConfigurationError if configuration is missing or invalid
 */
export function loadConfig(app: cdk.App, currentAccountId: string): EnvironmentConfig {
  const taskTitanConfig = app.node.tryGetContext('taskTitanConfig') as TaskTitanConfig | undefined;

  if (!taskTitanConfig) {
    throw new ConfigurationError(
      `No TaskTitan configuration found in cdk.json.\n\n` +
        `Please add configuration under context.taskTitanConfig in cdk/cdk.json:\n\n` +
        `{
  "context": {
    "taskTitanConfig": {
      "production": {
        "accountId": "${currentAccountId}",
        "customDomain": "your-domain.com",
        "certificateArn": "arn:aws:acm:us-east-1:${currentAccountId}:certificate/YOUR_CERT_ID",
        "email": {
          "fromAddress": "noreply@your-domain.com"
        }
      }
    }
  }
}`,
    );
  }

  // Find environment config matching current account
  let matchedEnvironment: string | undefined;
  let matchedConfig: EnvironmentConfig | undefined;

  for (const [envName, envConfig] of Object.entries(taskTitanConfig)) {
    if (envConfig && envConfig.accountId === currentAccountId) {
      matchedEnvironment = envName;
      matchedConfig = envConfig;
      break;
    }
  }

  if (!matchedConfig || !matchedEnvironment) {
    const availableAccounts = Object.entries(taskTitanConfig)
      .filter(([_, config]) => config?.accountId)
      .map(([env, config]) => `  - ${env}: ${config!.accountId}`)
      .join('\n');

    throw new ConfigurationError(
      `No configuration found for AWS account '${currentAccountId}'.\n\n` +
        `Available configurations in cdk.json:\n${availableAccounts || '  (none)'}\n\n` +
        `To deploy to this account, add a new environment configuration:\n\n` +
        `{
  "context": {
    "taskTitanConfig": {
      "your-environment-name": {
        "accountId": "${currentAccountId}",
        "customDomain": "your-domain.com",
        "certificateArn": "arn:aws:acm:us-east-1:${currentAccountId}:certificate/YOUR_CERT_ID",
        "email": {
          "fromAddress": "noreply@your-domain.com"
        }
      }
    }
  }
}`,
    );
  }

  // Validate the matched configuration
  validateEnvironmentConfig(matchedConfig, matchedEnvironment);

  console.log(`[TaskTitan] Using '${matchedEnvironment}' configuration for account ${currentAccountId}`);

  return matchedConfig;
}
