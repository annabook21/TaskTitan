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
  crossRegionReferences: true,
  domainName: props.domainName,
  hostedZoneId: props.hostedZoneId,
});

new MainStack(app, 'TaskTitanStack', {
  env: {
    account: props.account,
    region: process.env.CDK_DEFAULT_REGION,
  },
  crossRegionReferences: true,
  sharedCertificate: virginia.certificate,
  hostedZone: virginia.hostedZone,
  domainName: props.domainName,
  useNatInstance: props.useNatInstance,
  signPayloadHandler: virginia.signPayloadHandler,
});
