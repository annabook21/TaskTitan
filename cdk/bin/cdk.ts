#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const app = new cdk.App();

interface EnvironmentProps {
  account: string;
  domainName?: string;
  hostedZoneId?: string;
  useNatInstance?: boolean;
}

// Read configuration from CDK context (cdk.json or --context flag)
// This allows deployment to different AWS accounts without hardcoding values
const domainName = app.node.tryGetContext('domainName');
const hostedZoneId = app.node.tryGetContext('hostedZoneId');
const useNatInstance = app.node.tryGetContext('useNatInstance') ?? false;

const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  domainName,
  hostedZoneId,
  useNatInstance,
};

const virginia = new UsEast1Stack(app, 'TaskTitanUsEast1Stack', {
  env: {
    account: props.account,
    region: 'us-east-1',
  },
  domainName: props.domainName,
  hostedZoneId: props.hostedZoneId,
});

// Temporary migration safety:
// - We allow supplying the Lambda@Edge Version ARN via context to avoid CloudFormation export update deadlocks.
// - Once `TaskTitanUsEast1Stack` deploys successfully with the stable export, we can switch back to importValue.
//
// Usage:
//   npx cdk deploy --context signPayloadHandlerVersionArn=arn:aws:lambda:...:1
const signPayloadHandlerVersionArn =
  (app.node.tryGetContext('signPayloadHandlerVersionArn') as string | undefined) ??
  // Default to the currently deployed version ARN (safe fallback during migration).
  'arn:aws:lambda:us-east-1:232894901916:function:TaskTitanUsEast1Stack-SignPayloadHandlerFnDDFF6B33-UWg1mqha8auQ:1';

new MainStack(app, 'TaskTitanStack', {
  env: {
    account: props.account,
    region: 'us-east-1', // Deploy to us-east-1 (same as Lambda@Edge)
  },
  sharedCertificate: virginia.certificate,
  hostedZone: virginia.hostedZone,
  domainName: props.domainName,
  useNatInstance: props.useNatInstance,
  signPayloadHandlerVersionArn,
});
