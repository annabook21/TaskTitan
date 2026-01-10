#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const app = new cdk.App();

interface EnvironmentProps {
  account: string;

  /**
   * Custom domain name for the webapp and Cognito.
   * CDK will automatically create a Route53 hosted zone for this domain.
   * After deployment, update your domain registrar's nameservers to match the CDK output.
   *
   * @default No custom domain name. When not specified, the stack automatically generates
   * a random prefix for the Cognito domain (e.g., tasktitan-abc123def4.auth.us-west-2.amazoncognito.com)
   * and uses the CloudFront default domain (e.g., d1234567890.cloudfront.net) for the webapp.
   */
  domainName?: string;

  /**
   * Use a NAT instance instead of NAT Gateways.
   * Set to false (default) for production to use NAT Gateway for high availability.
   * Set to true for development/cost savings.
   * @default false
   */
  useNatInstance?: boolean;
}

const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  // Custom domain name - requires Route53 hosted zone in your AWS account
  domainName: 'tasktitan.live',
  useNatInstance: false, // Use NAT Gateway for production (best practice)
};

const virginia = new UsEast1Stack(app, 'TaskTitanUsEast1Stack', {
  env: {
    account: props.account,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
  domainName: props.domainName,
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

// Uncomment to enable CDK Nag security checks
// import { Aspects } from 'aws-cdk-lib';
// import { AwsSolutionsChecks } from 'cdk-nag';
// Aspects.of(app).add(new AwsSolutionsChecks());
