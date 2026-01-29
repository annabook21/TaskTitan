#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';

const app = new cdk.App();

// FORGE v2: Fully serverless deployment to us-east-2
// - App Runner (no ALB/NAT Gateway needed)
// - DynamoDB (no VPC needed)
// - No custom domain (uses *.awsapprunner.com)
new MainStack(app, 'TaskTitanForgeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT!,
    region: 'us-east-2',
  },
});
