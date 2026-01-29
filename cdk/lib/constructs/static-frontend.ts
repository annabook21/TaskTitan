/**
 * Phase 3: CloudFront + S3 static frontend (client architecture entry point).
 * - S3 bucket for static/SPA assets (private, OAC)
 * - CloudFront distribution: HTTPS only, SPA fallback (403/404 → index.html)
 * - Tiered TTLs: short for index.html, long for hashed assets (configure in behaviors if needed)
 */

import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  ErrorResponse,
  HttpVersion,
  OriginAccessIdentity,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StaticFrontendProps {
  /**
   * Optional bucket for CloudFront access logs.
   * If not provided, logging is disabled.
   */
  readonly accessLogBucket?: Bucket;
}

export class StaticFrontend extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly distributionDomainName: string;
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: StaticFrontendProps = {}) {
    super(scope, id);

    const { accessLogBucket } = props;

    // S3 bucket for static assets (private; CloudFront only via OAI)
    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
    });

    const oai = new OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${Stack.of(this).stackName} static frontend`,
    });
    this.bucket.grantRead(oai);

    this.distribution = new Distribution(this, 'Distribution', {
      comment: `${Stack.of(this).stackName} static frontend`,
      defaultBehavior: {
        origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        // SPA client-side routing: serve index.html for 403/404
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      ...(accessLogBucket && {
        enableLogging: true,
        logBucket: accessLogBucket,
        logFilePrefix: 'static-frontend/',
      }),
    });

    this.distributionDomainName = this.distribution.distributionDomainName;
    this.distributionUrl = `https://${this.distribution.distributionDomainName}`;

    new CfnOutput(this, 'StaticFrontendUrl', {
      value: this.distributionUrl,
      description: 'CloudFront URL for static frontend (Phase 3 entry point)',
    });
    new CfnOutput(this, 'StaticFrontendBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for static frontend assets',
    });
  }
}
