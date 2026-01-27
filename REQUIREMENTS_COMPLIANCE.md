# Requirements Compliance

Assessment of TaskTitan against the serverless 3-tier application requirements.

## Summary

| Category | Met | Partially Met |
|----------|-----|---------------|
| Technical Requirements (5) | 4 | 1 |
| Solution Requirements (5) | 5 | 0 |
| Stretch Goals (2) | 2 | 0 |
| **Total** | **11** | **1** |

---

## Technical Requirements

### 1. Three-Tier Architecture — Met

| Tier | Implementation |
|------|---------------|
| Presentation | CloudFront → ALB → ECS Fargate (Next.js 15, 2-10 ARM64 containers) |
| Logic | Next.js Server Actions (in Fargate) + Lambda (async jobs, DB migrations) |
| Data | Aurora PostgreSQL Serverless v2 (0-16 ACU) |

All three tiers use AWS serverless services: ECS Fargate (no server management, auto-scaling), Lambda (fully managed compute), and Aurora Serverless v2 (auto-scaling capacity, scales to zero). The VPC is required by Aurora and provides network isolation -- it does not affect the serverless classification.

**Key files:** `cdk/lib/constructs/webapp.ts`, `cdk/lib/constructs/async-job.ts`, `cdk/lib/constructs/database.ts`

### 2. Authentication — Met

All routes are protected by Next.js middleware using Amazon Cognito. Unauthenticated users are redirected to `/sign-in`. Public exceptions: `/sign-in`, `/privacy`, `/docs`, `/api/auth/*`, `/api/health`.

Cognito is configured with email-only sign-in, email verification, strong password policy (uppercase + symbol + digit + 8 chars), and email-only account recovery.

**Key files:** `webapp/src/middleware.ts`, `cdk/lib/constructs/auth/index.ts`

### 3. HTTPS — Met

CloudFront enforces `REDIRECT_TO_HTTPS` with minimum TLS 1.2 (2021 policy). ACM manages certificates. The ALB accepts HTTP internally but is protected by an origin verification header (`X-Origin-Verify`) so it cannot be accessed directly — only through CloudFront.

**Key files:** `cdk/lib/constructs/webapp.ts` (Distribution and ALB listener configuration)

### 4. Structured Logging — Met

AWS Lambda Powertools Logger is configured and outputs structured JSON. Lambda functions (async jobs, migration runner) get full Lambda context (function name, cold start, memory). ECS Fargate containers use the same Powertools Logger, which produces structured JSON to stdout, but without Lambda-specific context fields.

Note: `webapp/src/lib/logger.ts` also exports a `log` wrapper that falls back to plain `console.*` calls outside Lambda. If application code uses this wrapper instead of the Powertools `logger` directly, those log lines will not be structured JSON.

**Key files:** `webapp/src/lib/logger.ts`

### 5. Request Tracing — Partially Met

X-Ray tracing is active on Lambda functions (async job handler and migration runner have `Tracing.ACTIVE`). However, the Powertools Tracer is **explicitly disabled in non-Lambda environments** — see `webapp/src/lib/tracer.ts` line 50: `enabled: isLambdaEnvironment`. Since the main webapp runs on ECS Fargate, user-facing HTTP requests have no distributed tracing. Only background Lambda jobs are traced.

To fully meet this requirement, ECS Fargate would need its own tracing integration (e.g., OpenTelemetry with X-Ray exporter or the AWS Distro for OpenTelemetry sidecar).

**Key files:** `webapp/src/lib/tracer.ts`, `cdk/lib/constructs/async-job.ts`

---

## Solution Requirements

### 1. Infrastructure as Code — Met

All infrastructure is defined in AWS CDK (TypeScript). Two stacks: `UsEast1Stack` (Route 53, ACM, Lambda@Edge) and `MainStack` (VPC, database, auth, webapp, async jobs, monitoring). Deployable with `npm run cdk deploy --all` from the `cdk/` directory.

**Key files:** `cdk/lib/main-stack.ts`, `cdk/lib/us-east-1-stack.ts`

### 2. Version Control with Documentation — Met

Git repository with documentation: `README.md` (project overview and setup), `CLAUDE.md` (architecture reference and development guide), `DEMO_GUIDE.md`, `AI_TESTING_GUIDE.md`, `cdk/README.md`.

### 3. Architecture Diagram — Met

`tasktitan-architecture.drawio` (editable) and `tasktitan-architecture.drawio.svg` (rendered). Shows deployed resources, VPC layout, data flows, and managed service boundaries.

### 4. Security Best Practices — Met

| Practice | Implementation |
|----------|---------------|
| Network isolation | VPC with public/private subnets; database in private subnet |
| Encryption at rest | Aurora storage encryption, S3 server-side encryption, SQS KMS encryption |
| Encryption in transit | TLS 1.2+ via CloudFront, enforceSSL on S3 buckets |
| Secrets management | Secrets Manager for DB credentials and Next.js encryption key; ECS secret injection |
| Access control | Origin verification header prevents direct ALB access; Cognito auth on all routes |
| IAM least privilege | Scoped Bedrock, S3, Lambda invoke, and AppSync policies per service |
| Deletion protection | Enabled on Aurora cluster; Cognito user pool set to RETAIN |

**Key files:** `cdk/lib/main-stack.ts`, `cdk/lib/constructs/webapp.ts`, `cdk/lib/constructs/database.ts`

### 5. Monitoring and Logging — Met

CloudWatch dashboard (`TaskTitan-Monitoring`) with Lambda metrics (invocations, errors, duration, concurrency) and database metrics (connections, CPU, ACU capacity, latency, IOPS). CloudWatch Logs receive structured logs from Lambda and stdout from ECS. PostgreSQL logs are exported to CloudWatch.

**Gap:** The dashboard does not include ECS Fargate metrics (task count, CPU/memory utilization) or ALB metrics (request count, latency, 5xx rate). Since Fargate is the primary compute, this is a meaningful monitoring blind spot.

**Key files:** `cdk/lib/constructs/monitoring.ts`

---

## Stretch Goals

### 1. Unit Tests — Met

| Suite | Framework | Files |
|-------|-----------|-------|
| Application | Vitest | `webapp/src/app/projects/actions/component-crud.test.ts`, `project-crud.test.ts`, `webapp/src/app/sprints/actions/sprint-crud.test.ts`, `webapp/src/app/team/actions.test.ts` |
| Infrastructure | Jest (snapshots) | `cdk/test/serverless-fullstack-webapp-starter-kit.test.ts`, `cdk/test/serverless-fullstack-webapp-starter-kit-without-domain.test.ts` |

### 2. Data Store Backups — Met

Aurora PostgreSQL automated backups with 30-day retention (configurable via `backupRetentionDays`), preferred backup window 03:00-04:00 UTC. Deletion protection enabled. Point-in-time recovery supported by Aurora. Bastion host available for manual database operations via SSM port forwarding.

**Key files:** `cdk/lib/constructs/database.ts`

---

## Known Gaps

1. **No request tracing on the main webapp.** X-Ray is disabled in ECS Fargate. User requests are not traced end-to-end.
2. **Monitoring dashboard is incomplete.** No ECS Fargate or ALB metrics. The primary compute layer is unmonitored in the dashboard.
3. **Dead infrastructure.** The `signPayloadHandler` Lambda@Edge in `us-east-1-stack.ts` is a leftover from a prior Lambda Function URL architecture. It is deployed but not referenced by the current ECS Fargate setup.
4. **CLAUDE.md states "CloudFront + Lambda Function URLs"** for the infrastructure, which is outdated. The actual architecture is CloudFront + ALB + ECS Fargate.
5. **VPC is required infrastructure, not a serverless concern.** Aurora PostgreSQL requires a VPC. Fargate and Lambda connect to the database through it. This is standard for any AWS serverless application with a relational database.
