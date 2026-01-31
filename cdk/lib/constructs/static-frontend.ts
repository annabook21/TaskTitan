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
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface StaticFrontendProps {
  /**
   * Optional bucket for CloudFront access logs.
   * If not provided, logging is disabled.
   */
  readonly accessLogBucket?: Bucket;

  /**
   * Optional WAF WebACL ARN for CloudFront protection.
   * Must be created in us-east-1 with CLOUDFRONT scope.
   * Provides rate limiting without payload size restrictions.
   */
  readonly webAclArn?: string;
}

export class StaticFrontend extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly distributionDomainName: string;
  public readonly distributionUrl: string;
  public readonly errorRateAlarm: cloudwatch.Alarm;
  public readonly highLatencyAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: StaticFrontendProps = {}) {
    super(scope, id);

    const { accessLogBucket, webAclArn } = props;

    // S3 bucket for static assets (private; CloudFront only via OAC)
    // Object ownership must be BUCKET_OWNER_ENFORCED when using OAC per AWS docs
    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

    const s3Origin = S3BucketOrigin.withOriginAccessControl(this.bucket);

    // AWS Best Practice: Security headers policy
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html
    const securityHeadersPolicy = new ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `${Stack.of(this).stackName}-SecurityHeaders`,
      comment: 'Security headers for static frontend',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'", // Vite requires unsafe-inline for dev
            "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com wss://*.amazonaws.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true }, // X-Content-Type-Options: nosniff
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    // AWS Best Practice: Use managed CACHING_DISABLED policy for index.html
    // This ensures users always get the latest version while assets use long TTL

    this.distribution = new Distribution(this, 'Distribution', {
      comment: `${Stack.of(this).stackName} static frontend`,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        // AWS Best Practice: No cache for index.html (always fetch latest)
        cachePolicy: CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      // AWS Best Practice: Separate cache behavior for hashed assets (long TTL)
      additionalBehaviors: {
        '/assets/*': {
          origin: s3Origin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          // Long cache for immutable hashed assets (Vite adds hash to filenames)
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        // SPA client-side routing: serve index.html for 403/404
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      // WAF WebACL for rate limiting (must be CLOUDFRONT scope from us-east-1)
      ...(webAclArn && { webAclId: webAclArn }),
      ...(accessLogBucket && {
        enableLogging: true,
        logBucket: accessLogBucket,
        logFilePrefix: 'static-frontend/',
      }),
    });

    // AWS Best Practice: CloudWatch alarms for monitoring
    // 5xx error rate alarm - critical indicator of issues
    this.errorRateAlarm = new cloudwatch.Alarm(this, 'ErrorRateAlarm', {
      alarmName: `${Stack.of(this).stackName}-CloudFront-5xxErrorRate`,
      alarmDescription: 'CloudFront 5xx error rate exceeds threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: '5xxErrorRate',
        dimensionsMap: {
          DistributionId: this.distribution.distributionId,
          Region: 'Global',
        },
        statistic: 'Average',
        period: Duration.minutes(5),
      }),
      threshold: 1, // 1% error rate
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // 4xx error rate alarm - may indicate routing or config issues
    this.highLatencyAlarm = new cloudwatch.Alarm(this, 'High4xxErrorAlarm', {
      alarmName: `${Stack.of(this).stackName}-CloudFront-4xxErrorRate`,
      alarmDescription: 'CloudFront 4xx error rate exceeds threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: '4xxErrorRate',
        dimensionsMap: {
          DistributionId: this.distribution.distributionId,
          Region: 'Global',
        },
        statistic: 'Average',
        period: Duration.minutes(5),
      }),
      threshold: 5, // 5% error rate (higher threshold since 404s are expected for SPA)
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
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
