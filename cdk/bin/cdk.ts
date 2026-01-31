#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';

const app = new cdk.App();

// FORGE v3: Fully serverless static SPA architecture
// - CloudFront + S3 (static frontend with security headers)
// - AppSync GraphQL API (Cognito auth)
// - DynamoDB (single-table design, no VPC needed)
// - Lambda for async jobs and AI features (Bedrock)
new MainStack(app, 'TaskTitanForgeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT!,
    region: 'us-east-2',
  },
});
