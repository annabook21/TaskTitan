/**
 * WAF Stack for CloudFront Protection
 *
 * Creates a WAF WebACL with rate limiting rules for CloudFront distributions.
 * Must be deployed in us-east-1 (required for CloudFront scope).
 *
 * AWS Best Practice: Simple rate limiting without payload inspection.
 * - No body size restrictions
 * - No managed rule sets that inspect payloads
 * - Just IP-based rate limiting for DDoS protection
 *
 * Sources:
 * - https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html
 * - https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-wafv2-webacl-ratebasedstatement.html
 */

import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface WafStackProps extends StackProps {
  /**
   * Rate limit: maximum requests per 5-minute window per IP.
   * Default: 2000 requests per 5 minutes (400/minute average).
   */
  readonly rateLimit?: number;
}

export class WafStack extends Stack {
  /**
   * The ARN of the WebACL. Use this to associate with CloudFront distributions.
   */
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafStackProps = {}) {
    super(scope, id, props);

    const rateLimit = props.rateLimit ?? 2000;

    // Create WebACL with rate limiting only
    // No payload size rules, no managed rules that inspect body
    const webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWebACL', {
      name: `${this.stackName}-RateLimitACL`,
      description: 'Rate limiting WebACL for CloudFront - no payload inspection',
      scope: 'CLOUDFRONT', // Required for CloudFront association
      defaultAction: { allow: {} }, // Allow by default, only block rate-limited IPs

      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${this.stackName}-WebACL`,
        sampledRequestsEnabled: true,
      },

      rules: [
        // Rule 1: Global rate limit per IP address
        {
          name: 'RateLimitPerIP',
          priority: 1,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${this.stackName}-RateLimitPerIP`,
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: rateLimit,
              aggregateKeyType: 'IP', // Aggregate by source IP
              evaluationWindowSec: 300, // 5-minute window (default)
            },
          },
        },

        // Rule 2: Stricter rate limit for API paths (if applicable)
        // This catches aggressive API usage patterns
        {
          name: 'RateLimitAPI',
          priority: 2,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${this.stackName}-RateLimitAPI`,
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: Math.floor(rateLimit / 2), // 50% of global limit for API paths
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              // Scope down to API-like paths
              scopeDownStatement: {
                orStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        fieldToMatch: { uriPath: {} },
                        positionalConstraint: 'STARTS_WITH',
                        searchString: '/graphql',
                        textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                      },
                    },
                    {
                      byteMatchStatement: {
                        fieldToMatch: { uriPath: {} },
                        positionalConstraint: 'STARTS_WITH',
                        searchString: '/api',
                        textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;

    // Outputs
    new CfnOutput(this, 'WebACLArn', {
      value: this.webAclArn,
      description: 'WAF WebACL ARN for CloudFront association',
      exportName: `${this.stackName}-WebACLArn`,
    });

    new CfnOutput(this, 'WebACLId', {
      value: webAcl.attrId,
      description: 'WAF WebACL ID',
    });
  }
}
