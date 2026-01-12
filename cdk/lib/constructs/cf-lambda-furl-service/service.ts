import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { FunctionUrlAuthType, Function, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  FunctionEventType,
  Function as CloudFrontFunction,
  FunctionCode,
  LambdaEdgeEventType,
  OriginRequestPolicy,
  SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { EdgeFunction } from './edge-function';
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { join } from 'path';
import { readFileSync } from 'fs';

export interface CloudFrontLambdaFunctionUrlServiceProps {
  /**
   * Subdomain name for the service. If not specified, the root domain will be used.
   *
   * @default use root domain
   */
  subDomain?: string;
  handler: Function;

  /**
   * This should be unique across the app
   */
  serviceName: string;

  /**
   * @default basic auth is disabled
   */
  basicAuthUsername?: string;
  basicAuthPassword?: string;

  /**
   * Route 53 hosted zone for custom domain.
   *
   * @default No custom domain. CloudFront's default domain will be used.
   */
  hostedZone?: IHostedZone;
  /**
   * ACM certificate for custom domain (must be in us-east-1 for CloudFront).
   *
   * @default No custom domain.
   */
  certificate?: ICertificate;
  signPayloadHandler?: EdgeFunction; // Optional - OAC handles signing natively
  accessLogBucket: Bucket;
}

export class CloudFrontLambdaFunctionUrlService extends Construct {
  public readonly urlParameter: StringParameter;
  public readonly url: string;
  public readonly domainName: string;
  /**
   * The Route53 A record pointing to CloudFront.
   * Only set when using a custom domain (hostedZone is provided).
   * Use this to add dependencies for resources that need the A record to exist first.
   */
  public readonly aRecord?: ARecord;

  constructor(scope: Construct, id: string, props: CloudFrontLambdaFunctionUrlServiceProps) {
    super(scope, id);
    const { handler, serviceName, subDomain, hostedZone, certificate, accessLogBucket, signPayloadHandler } = props;
    let domainName = '';
    if (hostedZone) {
      domainName = subDomain ? `${subDomain}.${hostedZone.zoneName}` : hostedZone.zoneName;
    }

    const furl = handler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });
    const origin = FunctionUrlOrigin.withOriginAccessControl(furl, {
      connectionTimeout: Duration.seconds(6),
      readTimeout: Duration.seconds(60),
    });

    const cachePolicy = new CachePolicy(this, 'SharedCachePolicy', {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        // CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS contains Host header here,
        // making it impossible to use with API Gateway
        'authorization',
        'Origin',
        'X-HTTP-Method-Override',
        'X-HTTP-Method',
        'X-Method-Override',
      ),
      defaultTtl: Duration.seconds(0),
      cookieBehavior: CacheCookieBehavior.all(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    // CloudFront Function to set x-forwarded-host for Next.js Server Actions
    const setForwardedHostFn = new CloudFrontFunction(this, 'SetForwardedHost', {
      code: FunctionCode.fromFile({
        filePath: join(__dirname, 'set-forwarded-host.js'),
      }),
    });

    const distribution = new Distribution(this, 'Resource', {
      comment: `CloudFront for ${serviceName}`,
      defaultBehavior: {
        origin,
        cachePolicy,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          {
            function: setForwardedHostFn,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
        // NOTE: Lambda@Edge signing removed - CloudFront OAC natively handles SigV4 signing
        // for Lambda Function URLs with IAM auth. The sign-payload Lambda@Edge was causing
        // signature conflicts on POST requests, especially with large bodies (>1MB) due to
        // Lambda@Edge body size limits. OAC automatically signs requests correctly without
        // the 1MB truncation issue.
        // Ref: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
      },
      // errorResponses: [{ httpStatus: 404, responsePagePath: '/', responseHttpStatus: 200 }],
      logBucket: accessLogBucket,
      logFilePrefix: `${serviceName}/`,

      ...(hostedZone ? { certificate: certificate, domainNames: [domainName] } : {}),

      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    if (hostedZone) {
      this.aRecord = new ARecord(this, 'Record', {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        recordName: subDomain,
      });
    } else {
      domainName = distribution.domainName;
    }

    // Invalidate CloudFront when Lambda function version changes
    new AwsCustomResource(this, 'CloudFrontInvalidation', {
      onUpdate: {
        service: 'cloudfront',
        action: 'createInvalidation',
        parameters: {
          DistributionId: distribution.distributionId,
          InvalidationBatch: {
            CallerReference: `${handler.currentVersion.version}`,
            Paths: {
              Quantity: 1,
              Items: ['/*'],
            },
          },
        },
        physicalResourceId: PhysicalResourceId.of('invalidation'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [distribution.distributionArn],
      }),
    });

    this.url = `https://${domainName}`;
    this.domainName = domainName;
  }
}
