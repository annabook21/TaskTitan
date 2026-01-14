import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { FunctionUrlAuthType, Function, InvokeMode, IVersion } from 'aws-cdk-lib/aws-lambda';
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
// import { EdgeFunction } from './edge-function';
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
  signPayloadHandlerVersion?: IVersion; // Optional - OAC handles signing natively
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
    const { handler, serviceName, subDomain, hostedZone, certificate, accessLogBucket, signPayloadHandlerVersion } =
      props;
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
      // Avoid cache-key explosion from Next.js RSC query params (e.g. `_rsc`).
      // Note: forwarding is controlled by OriginRequestPolicy; this only affects caching keys.
      queryStringBehavior: CacheQueryStringBehavior.none(),
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
      // Keep SSR uncached by default, but allow explicit origin Cache-Control (e.g. s-maxage=30 on 302s)
      // to be honored up to this max TTL.
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(60),
      // CRITICAL FIX: Forward only essential Amplify auth cookies, not ALL cookies
      // This prevents hitting Lambda's 6MB payload limit during authentication
      // Amplify stores tokens in cookies prefixed with "CognitoIdentityServiceProvider"
      // Reference: https://github.com/nextauthjs/next-auth/issues/7215
      cookieBehavior: CacheCookieBehavior.allowList(
        'CognitoIdentityServiceProvider.*', // Amplify auth tokens (idToken, accessToken, refreshToken)
      ),
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
        // Lambda@Edge signing is REQUIRED for Next.js Server Actions POST requests
        // CloudFront OAC alone cannot properly sign these requests due to the custom
        // headers (next-action, next-router-state-tree) that Next.js adds.
        // The sign-payload Lambda@Edge function runs AFTER OAC's initial attempt,
        // allowing it to properly sign the request with all necessary headers included.
        edgeLambdas: signPayloadHandlerVersion
          ? [
              {
                functionVersion: signPayloadHandlerVersion,
                eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                includeBody: true,
              },
            ]
          : [],
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
