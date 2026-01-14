import * as cdk from 'aws-cdk-lib';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { experimental } from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { join } from 'path';

interface UsEast1StackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
}

export class UsEast1Stack extends cdk.Stack {
  /**
   * the Route53 hosted zone for the custom domain.
   * undefined if domainName is not set.
   */
  public readonly hostedZone: IHostedZone | undefined = undefined;
  /**
   * the ACM certificate for CloudFront (it must be deployed in us-east-1).
   * undefined if domainName is not set.
   */
  public readonly certificate: ICertificate | undefined = undefined;
  public readonly signPayloadHandler: experimental.EdgeFunction;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    if (props.domainName && props.hostedZoneId) {
      // Import the existing hosted zone for the custom domain
      const zone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        zoneName: props.domainName,
        hostedZoneId: props.hostedZoneId,
      });
      this.hostedZone = zone;

      // Export the hosted zone ID for reference in other stacks
      new cdk.CfnOutput(this, 'HostedZoneId', {
        value: zone.hostedZoneId,
        description: 'Route53 Hosted Zone ID',
        exportName: `${this.stackName}-HostedZoneId`,
      });

      // Note: Cognito requires the parent domain to have a valid A record before adding a custom domain.
      // The root domain A record is created in MainStack pointing to CloudFront (serving the webapp).
      // The Auth construct adds an explicit dependency to ensure proper ordering.


      const cert = new Certificate(this, 'CertificateV2', {
        domainName: `*.${zone.zoneName}`,
        validation: CertificateValidation.fromDns(zone),
        subjectAlternativeNames: [zone.zoneName],
      });
      this.certificate = cert;
    }

    // Lambda@Edge requires compiled JavaScript (index.js is pre-compiled from sign-payload.ts)
    const signPayloadHandler = new experimental.EdgeFunction(this, 'SignPayloadHandler', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromAsset(join(__dirname, 'constructs', 'cf-lambda-furl-service', 'lambda')),
    });

    this.signPayloadHandler = signPayloadHandler;

    // Stable export for the Edge Lambda Version ARN.
    // Main stack imports this value rather than relying on CDK's auto-generated cross-stack exports
    // (which can change when construct internals change).
    new cdk.CfnOutput(this, 'SignPayloadHandlerVersionArn', {
      value: signPayloadHandler.currentVersion.functionArn,
      exportName: `${this.stackName}-SignPayloadHandlerVersionArn`,
    });

    // Legacy export name retained to avoid CloudFormation "cannot delete export in use" failures
    // when updating stacks that still reference the older auto-generated export.
    new cdk.CfnOutput(this, 'LegacySignPayloadHandlerFunctionVersionExport', {
      value: signPayloadHandler.currentVersion.functionArn,
      exportName: `${this.stackName}:ExportsOutputRefSignPayloadHandlerFunctionVersionF9FE430AFB7A5BC1`,
    });
  }
}
