import * as cdk from 'aws-cdk-lib';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
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
  public readonly signPayloadHandler: EdgeFunction;

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

    const signPayloadHandler = new EdgeFunction(this, 'SignPayloadHandler', {
      entryPath: join(__dirname, 'constructs', 'cf-lambda-furl-service', 'lambda', 'sign-payload.ts'),
    });

    this.signPayloadHandler = signPayloadHandler;
  }
}
