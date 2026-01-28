#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';

const app = new cdk.App();

interface EnvironmentProps {
  account: string;
  useNatInstance?: boolean;
}

// Read configuration from CDK context (cdk.json or --context flag)
const useNatInstance = app.node.tryGetContext('useNatInstance') ?? false;

const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  useNatInstance,
};

// FORGE: Cost-optimized deployment to us-east-2 only
// No custom domain - uses CloudFront default domain
new MainStack(app, 'TaskTitanForgeStack', {
  env: {
    account: props.account,
    region: 'us-east-2',
  },
  useNatInstance: props.useNatInstance,
});
