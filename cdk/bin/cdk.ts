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

const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  domainName: 'tasktitan.live',
  hostedZoneId: 'Z011770293USOPDADH3X',
  useNatInstance: false,
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
