#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';
import { WafStack } from '../lib/waf-stack';

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT!;

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
});

// Explicit dependency: main stack depends on WAF stack
mainStack.addDependency(wafStack);
