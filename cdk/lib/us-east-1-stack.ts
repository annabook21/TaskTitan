import * as cdk from 'aws-cdk-lib';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
import { join } from 'path';

interface UsEast1StackProps extends cdk.StackProps {
  /**
   * Custom domain name for the webapp and Cognito.
   *
   * @default No custom domain. CloudFront and Cognito will use their default domains.
   */
  domainName?: string;
}

export class UsEast1Stack extends cdk.Stack {
  /**
   * the Route53 hosted zone for the custom domain.
   * undefined if domainName is not set.
   */
  public readonly hostedZone: HostedZone | undefined = undefined;
  /**
   * the ACM certificate for CloudFront (it must be deployed in us-east-1).
   * undefined if domainName is not set.
   */
  public readonly certificate: ICertificate | undefined = undefined;
  /**
   * the signer L@E function (it must be deployed in us-east-1).
   */
  public readonly signPayloadHandler: EdgeFunction;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    if (props.domainName) {
      // Create the hosted zone for the custom domain
      // If you already have a hosted zone, you can import it by modifying this code to use:
      // HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      //   zoneName: props.domainName,
      //   hostedZoneId: 'YOUR_EXISTING_ZONE_ID',
      // })
      const zone = new HostedZone(this, 'HostedZone', {
        zoneName: props.domainName,
      });
      this.hostedZone = zone;

      // Export the hosted zone ID for reference in other stacks
      new cdk.CfnOutput(this, 'HostedZoneId', {
        value: zone.hostedZoneId,
        description: 'Route53 Hosted Zone ID - update your domain nameservers to these',
        exportName: `${this.stackName}-HostedZoneId`,
      });

      new cdk.CfnOutput(this, 'NameServers', {
        value: cdk.Fn.join(',', zone.hostedZoneNameServers || []),
        description: 'Route53 Name Servers - configure these at your domain registrar',
        exportName: `${this.stackName}-NameServers`,
      });

      // cognito requires A record for Hosted UI custom domain
      // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html#cognito-user-pools-add-custom-domain-adding
      // > Its parent domain must have a valid DNS A record. You can assign any value to this record.
      new ARecord(this, 'Record', {
        zone: zone,
        target: RecordTarget.fromIpAddresses('8.8.8.8'),
      });

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
