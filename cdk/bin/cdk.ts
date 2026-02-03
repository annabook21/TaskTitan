#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';
import { WafStack } from '../lib/waf-stack';
import { loadConfig, ConfigurationError } from '../lib/config';

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;

// Fail fast if no account is available
if (!account) {
  console.error(`
ERROR: AWS account ID not available.

Please ensure you have configured AWS credentials:
  - Run 'aws configure' to set up credentials, OR
  - Set AWS_PROFILE environment variable, OR
  - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY

Then run 'cdk deploy' again.
`);
  process.exit(1);
}

// Load and validate configuration (fail fast with clear error messages)
let config;
try {
  config = loadConfig(app, account);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`\nCONFIGURATION ERROR:\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// WAF Stack: Must be in us-east-1 for CloudFront (global) scope
// Simple rate limiting only - no payload size restrictions
const wafStack = new WafStack(app, 'TaskTitanWafStack', {
  env: {
    account,
    region: 'us-east-1', // Required for CloudFront WAF
  },
  rateLimit: 2000, // 2000 requests per 5-minute window per IP
  crossRegionReferences: true, // Enable cross-region exports
});

// FORGE v3: Fully serverless static SPA architecture
// - CloudFront + S3 (static frontend with security headers + WAF)
// - AppSync GraphQL API (Cognito auth)
// - DynamoDB (single-table design, no VPC needed)
// - Lambda for async jobs and AI features (Bedrock)
const mainStack = new MainStack(app, 'TaskTitanForgeStack', {
  env: {
    account,
    region: 'us-east-2',
  },
  crossRegionReferences: true, // Enable cross-region imports
  webAclArn: wafStack.webAclArn, // Pass WAF ARN from us-east-1
  // Configuration from cdk.json - validated at startup
  customDomain: config.customDomain,
  certificateArn: config.certificateArn,
  fromEmail: config.email.fromAddress,
});

// Explicit dependency: main stack depends on WAF stack
mainStack.addDependency(wafStack);
