# TaskTitan FORGE v3 Architecture

This document describes the fully serverless AWS architecture for TaskTitan FORGE v3, aligned with the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html).

## Architecture Overview

![TaskTitan FORGE v3 Architecture](./tasktitan-architecture.drawio.svg)

TaskTitan FORGE v3 is a fully serverless architecture with **no VPC, NAT Gateway, or load balancers**. All traffic flows through managed AWS services with automatic scaling.

### Request Flow

1. **User → WAF → CloudFront → S3**: User loads the React SPA from CloudFront
2. **Browser → Cognito**: OAuth 2.0 authentication, receives JWT tokens
3. **Browser → AppSync**: GraphQL API calls with JWT authentication
4. **AppSync → DynamoDB**: Direct resolvers for CRUD operations
5. **AppSync → Lambda → Bedrock**: AI operations (component generation, sprint planning)
6. **Lambda → AppSync Events**: Real-time updates via WebSocket

### Two-Region Deployment

| Region | Stack | Services |
|--------|-------|----------|
| us-east-1 | TaskTitanWafStack | WAF WebACL (required for CloudFront) |
| us-east-2 | TaskTitanForgeStack | All other services |

---

## AWS Services Inventory

### 1. AWS WAF (us-east-1)

**Purpose**: Rate limiting to protect against abuse and DDoS attacks.

| Configuration | Value |
|--------------|-------|
| Scope | CLOUDFRONT (global) |
| Default Action | Allow |
| Rules | RateLimitPerIP (2000 req/5min), RateLimitAPI (1000 req/5min for /graphql, /api) |
| Metrics | CloudWatch enabled |

**Cost**: ~$5-10/month (WebACL + rule evaluation)

---

### 2. Amazon CloudFront

**Purpose**: Global CDN for static frontend delivery with edge caching.

| Configuration | Value |
|--------------|-------|
| HTTP Version | HTTP/2 and HTTP/3 |
| Price Class | PRICE_CLASS_100 (US, Canada, Europe) |
| Default Root Object | index.html |
| Error Responses | 403/404 → 200 index.html (SPA routing) |
| WAF | Associated WebACL from us-east-1 |
| Access Logging | Enabled (S3) |

**Security Headers**:
- Content-Security-Policy (CSP)
- Strict-Transport-Security (HSTS): 365 days, includeSubDomains, preload
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin

**Cost**: ~$5-15/month

---

### 3. Amazon S3 (2 buckets)

#### Static Assets Bucket
**Purpose**: Host the React SPA (Vite build output).

| Configuration | Value |
|--------------|-------|
| Access | CloudFront via Origin Access Control (OAC) |
| Public Access | Blocked |
| Encryption | SSE-S3 |
| Object Ownership | BUCKET_OWNER_ENFORCED |

#### Access Logs Bucket
**Purpose**: Store CloudFront access logs.

| Configuration | Value |
|--------------|-------|
| Encryption | SSE-S3 |
| Public Access | Blocked |

**Cost**: ~$1-5/month

---

### 4. AWS AppSync GraphQL API

**Purpose**: Main GraphQL API for all CRUD operations and AI mutations.

| Configuration | Value |
|--------------|-------|
| X-Ray Tracing | Enabled |
| Default Auth | Cognito User Pools |
| Additional Auth | API Key, IAM |
| Resolvers | 50+ JavaScript resolvers |

**Data Sources**:
- DynamoDB (direct resolvers for CRUD)
- Lambda (AI operations)
- None (subscriptions)

**Cost**: ~$5-20/month

---

### 5. AWS AppSync Events API

**Purpose**: Real-time WebSocket pub/sub for live updates.

| Configuration | Value |
|--------------|-------|
| Protocol | WebSocket |
| Auth | IAM + Cognito |
| Channel Namespace | event-bus |

**Use Cases**:
- AI generation progress updates
- Component status changes
- Team activity feed

**Cost**: Included in AppSync pricing

---

### 6. AWS Lambda

#### AsyncJob Handler
**Purpose**: Execute AI operations that exceed AppSync's 30-second timeout.

| Configuration | Value |
|--------------|-------|
| Runtime | Docker (Node.js 22, ARM64) |
| Memory | 1024 MB |
| Timeout | 10 minutes |
| Concurrency | Reserved: 100 |
| Tracing | X-Ray Active |
| DLQ | SQS enabled |

**Permissions**:
- DynamoDB: Read/Write
- Bedrock: InvokeModel (Claude Sonnet 4.5)
- AppSync: Publish to Events API
- Translate/Comprehend: Language detection

#### RegisterUserHandler
**Purpose**: Create Cognito users during sign-up flow.

| Configuration | Value |
|--------------|-------|
| Runtime | Node.js 20.x (ARM64) |
| Memory | 256 MB |
| Timeout | 10 seconds |

**Cost**: ~$1-10/month

---

### 7. Amazon DynamoDB

**Purpose**: Single-table NoSQL database for all application data.

| Configuration | Value |
|--------------|-------|
| Billing | On-demand (pay-per-request) |
| Encryption | AWS-managed keys |
| Point-in-Time Recovery | Enabled (35-day retention) |
| Streams | Enabled (NEW_AND_OLD_IMAGES) |
| Contributor Insights | Enabled |

**Schema**:
- Partition Key: `pk` (STRING)
- Sort Key: `sk` (STRING)

**Global Secondary Indexes**:
| Index | Keys | Purpose |
|-------|------|---------|
| GSI1 | gsi1pk, gsi1sk | User email, teams, assignments |
| GSI2 | gsi2pk, gsi2sk | Sprint and status queries |
| GSI3 | gsi3pk, gsi3sk | GitHub repo URL lookup (sparse) |

**Cost**: ~$5-25/month

---

### 8. Amazon Cognito

**Purpose**: User authentication with OAuth 2.0 / OIDC.

| Configuration | Value |
|--------------|-------|
| Sign-in | Email only |
| Self Sign-up | Disabled (admin-created) |
| MFA | Optional |
| Password Policy | 8+ chars, uppercase, symbol, digit |
| Token Validity | ID: 1 day, Access: 1 hour, Refresh: 30 days |

**Cost**: Free (under 50,000 MAU)

---

### 9. Amazon SQS

**Purpose**: Dead Letter Queue for failed Lambda invocations.

| Configuration | Value |
|--------------|-------|
| Retention | 14 days |
| Encryption | KMS-managed |

**Cost**: ~$0.01/month

---

### 10. Amazon CloudWatch

**Purpose**: Monitoring, logging, and alerting.

**Dashboard Metrics**:
- Lambda: Invocations, Errors, Duration, Concurrent Executions
- DynamoDB: Consumed Capacity, Throttled Requests, Latency

**Alarms**:
| Alarm | Threshold | Evaluation |
|-------|-----------|------------|
| ErrorRateAlarm | CloudFront 5xx > 1% | 2 periods |
| High4xxErrorAlarm | CloudFront 4xx > 5% | 3 periods |

**Cost**: ~$3-5/month

---

## AWS Well-Architected Pillars

### Operational Excellence

| Practice | Implementation |
|----------|----------------|
| Infrastructure as Code | AWS CDK (TypeScript) |
| Observability | CloudWatch Dashboard, X-Ray Tracing |
| Structured Logging | Lambda Powertools v2 |
| Runbook | CLAUDE.md with debugging commands |

### Security

| Practice | Implementation |
|----------|----------------|
| Identity | Cognito User Pools with JWT |
| Network Protection | WAF rate limiting (no VPC needed) |
| Data Protection | S3 encryption, DynamoDB encryption |
| Access Control | S3 OAC (no public access), IAM least privilege |
| HTTPS | Enforced everywhere (CloudFront redirect) |
| Security Headers | CSP, HSTS, X-Frame-Options, etc. |

### Reliability

| Practice | Implementation |
|----------|----------------|
| Auto-scaling | All services scale automatically |
| Fault Isolation | Multi-AZ (CloudFront, DynamoDB) |
| Error Handling | SQS Dead Letter Queue, retry logic |
| Data Durability | DynamoDB PITR, 35-day recovery |
| Concurrency Limits | Lambda reserved concurrency: 100 |

### Performance Efficiency

| Practice | Implementation |
|----------|----------------|
| Edge Caching | CloudFront with optimized cache policies |
| Efficient Compute | ARM64 Lambda (Graviton2) |
| Database | DynamoDB on-demand, direct AppSync resolvers |
| AI Optimization | Bedrock global inference profiles |

### Cost Optimization

| Practice | Implementation |
|----------|----------------|
| No VPC | Eliminates NAT Gateway costs (~$32/month saved) |
| Serverless | Pay only for actual usage |
| Right-sizing | Lambda 1024MB (optimal for AI workloads) |
| Regional Pricing | CloudFront PRICE_CLASS_100 |
| On-demand DB | DynamoDB scales to zero |

### Sustainability

| Practice | Implementation |
|----------|----------------|
| Efficient Hardware | ARM64 processors (up to 60% more efficient) |
| Serverless | No idle resources |
| Edge Computing | CloudFront reduces origin load |
| Right-sized Resources | Lambda memory optimized per workload |

---

## Cost Summary

| Service | Monthly Estimate |
|---------|-----------------|
| CloudFront | $5-15 |
| S3 | $1-5 |
| AppSync | $5-20 |
| DynamoDB | $5-25 |
| Lambda | $1-10 |
| Cognito | Free (50K MAU) |
| WAF | $5-10 |
| CloudWatch | $3-5 |
| **Total** | **$25-90/month** |

*Estimates based on moderate usage. Actual costs vary with traffic.*

---

## Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js >= 20
- Docker (for Lambda container builds)

### Deploy Commands

```bash
# First-time setup
cd cdk
npm ci
npx cdk bootstrap

# Deploy both stacks
npx cdk deploy --all

# Deploy specific stack
npx cdk deploy TaskTitanForgeStack
npx cdk deploy TaskTitanWafStack
```

### Stack Outputs

After deployment:
- `FrontendURL`: CloudFront distribution URL
- `GraphQLEndpoint`: AppSync API endpoint
- `UserPoolId`: Cognito User Pool ID
- `DynamoDBTableName`: DynamoDB table name

---

## References

- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [AWS AppSync Developer Guide](https://docs.aws.amazon.com/appsync/latest/devguide/what-is-appsync.html)
- [AWS WAF Developer Guide](https://docs.aws.amazon.com/waf/latest/developerguide/what-is-aws-waf.html)
- [Amazon Bedrock User Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
