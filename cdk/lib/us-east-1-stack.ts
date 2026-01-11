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
  public readonly hostedZone: IHostedZone | undefined = undefined;
  public readonly certificate: ICertificate | undefined = undefined;
  public readonly signPayloadHandler: EdgeFunction;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    if (props.domainName && props.hostedZoneId) {
      const zone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        zoneName: props.domainName,
        hostedZoneId: props.hostedZoneId,
      });
      this.hostedZone = zone;

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
