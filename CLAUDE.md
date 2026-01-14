# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskTitan is a serverless full-stack project management application built on AWS. It features component-based project planning with hierarchy support (Epic → Feature → Story → Task/Bug), sprint management, and AI-powered features using Amazon Bedrock (Claude Sonnet 4.5).

## Commands

### Webapp (run from `/webapp`)
```bash
npm run dev              # Start dev server on port 3010 with Turbopack
npm run build            # Build for production
npm run lint             # Run ESLint
npm run format           # Format with Prettier + Prisma
npm run format:check     # Check formatting
```

### CDK (run from `/cdk`)
```bash
npm run build            # Compile TypeScript
npm run test             # Run Jest snapshot tests
npm run cdk deploy       # Deploy infrastructure
npm run cdk diff         # Show infrastructure changes
npm run cdk destroy      # Destroy infrastructure
```

### Local Development Setup
```bash
docker compose up -d                    # Start PostgreSQL
cd webapp && npx prisma db push         # Sync database schema
cp .env.local.example .env.local        # Create env file (then populate values)
npm run dev                             # Start dev server
```

## Architecture

### Two-Package Structure
- **`/webapp`**: Next.js 15 application (frontend + backend via server actions)
- **`/cdk`**: AWS CDK infrastructure as code

### Key Technologies
- **Frontend**: React 19, Tailwind CSS 4, React Hook Form, Zod validation
- **Backend**: Next.js Server Actions with `next-safe-action`, Prisma ORM
- **Database**: Aurora PostgreSQL Serverless v2
- **Auth**: Amazon Cognito (bypassed in local dev when `USER_POOL_ID` not set)
- **AI**: Amazon Bedrock with Claude Sonnet 4.5
- **Infra**: CloudFront + Lambda Function URLs, EventBridge, AppSync Events

### AI Configuration
- Default model: `global.anthropic.claude-sonnet-4-5-20250929-v1:0` (global inference profile for 10% cost savings)
- Override via `BEDROCK_MODEL_ID` environment variable
- All AI prompts use sentinel delimiters (`<<<JSON` / `JSON>>>`) for robust parsing
- Fallback to markdown code blocks if sentinels not found

### Server Actions Pattern
All backend logic uses type-safe server actions:
1. Define Zod schema for input validation
2. Use `authActionClient` wrapper from `@/lib/safe-action` for authentication
3. Use `MyCustomError` class to return user-facing error messages
4. Call `revalidatePath()` after mutations

Example:
```typescript
export const myAction = authActionClient.schema(mySchema).action(
  async ({ parsedInput, ctx }) => {
    const { userId } = ctx;
    // ... logic
    revalidatePath('/');
    return { result };
  }
);
```

### Client-Side Action Usage
- With forms: Use `useHookFormAction` from `@next-safe-action/adapter-react-hook-form/hooks`
- Without forms: Use `useAction` from `next-safe-action/hooks`
- Toast notifications via `sonner`

### Database Schema (Prisma)
Core entities:
- **User**: Cognito users (id from Cognito, not auto-generated)
- **Team**: Container with Memberships (OWNER, ADMIN, MEMBER, VIEWER roles)
- **Project**: Belongs to Team, has Components
- **Component**: Hierarchical work items (EPIC → FEATURE → STORY → TASK/BUG)
- **Sprint**: Time-boxed iteration with status (PLANNING, ACTIVE, COMPLETED, CANCELLED)

Zod types are auto-generated from Prisma schema to `src/lib/generated/prisma/zod`.

### Async Jobs
Background Lambda functions for long-running tasks:
- Jobs live in `webapp/src/jobs/async-job/`
- Entry point: `webapp/src/jobs/async-job-runner.ts`
- Invoke via `@/lib/jobs` helpers

### File Organization
Feature-based structure with colocated files:
```
app/
├── (authenticated)/         # Protected route group
├── projects/[id]/
│   ├── page.tsx            # Page component
│   ├── actions.ts          # Server actions
│   ├── schemas.ts          # Zod schemas
│   └── components/         # Feature-specific components
```

Shared code:
- `src/components/`: Reusable UI components
- `src/hooks/`: Custom React hooks
- `src/lib/`: Utilities (auth, prisma, ai, events, jobs, logger, tracer)

## Development Notes

- Local dev mode automatically creates a mock user when `USER_POOL_ID` is not set
- Lambda Powertools v2 used for logging (`@/lib/logger`) and tracing (`@/lib/tracer`)
- AI features use cross-region inference routing for Bedrock
- Run `npx prisma generate` after schema changes to regenerate client and Zod types

## Performance Debugging

### X-Ray Tracing

The application has X-Ray tracing enabled for auth flow analysis. View traces in AWS Console or via CLI:

**AWS Console:**
1. Go to **CloudWatch > X-Ray traces > Traces**
2. Filter by service name:
   - In X-Ray, the “service” is typically the **Lambda function name** (e.g. `TaskTitanStack-WebappHandler...`), not the Powertools `serviceName`.
   - Use the Lambda function name you see in traces, or set `XRAY_SERVICE_NAME` when using the helper script below.
3. Look for subsegments:
   - `SSM` - SSM parameter fetch (cold start only)
   - `auth-middleware` - Middleware authentication check
   - `auth-route-sign-in` / `auth-route-sign-in-callback` - Auth route handlers

**AWS CLI Commands:**

**Get recent traces (last 5 minutes):**
```bash
XRAY_SERVICE_NAME="your-lambda-function-name-here"
aws xray get-trace-summaries \
  --start-time $(date -u -v-5M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression "service(\"$XRAY_SERVICE_NAME\")" \
  --region us-east-1
```

**Get traces with cold starts (last 10 minutes):**
```bash
aws xray get-trace-summaries \
  --start-time $(date -u -v-10M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanWebapp") AND annotation.cold_start = true' \
  --region us-east-1
```

**Get traces for unauthenticated requests:**
```bash
aws xray get-trace-summaries \
  --start-time $(date -u -v-10M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanWebapp") AND annotation.authenticated = false' \
  --region us-east-1
```

**Get traces for sign-in auth action:**
```bash
aws xray get-trace-summaries \
  --start-time $(date -u -v-10M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanWebapp") AND annotation.auth_action = "sign-in"' \
  --region us-east-1
```

**Get detailed trace by trace ID:**
```bash
# First get a trace ID from the summaries above, then:
TRACE_ID="your-trace-id-here"
aws xray batch-get-traces \
  --trace-ids "$TRACE_ID" \
  --region us-east-1 | jq '.Traces[0]'
```

**Get slow traces (duration > 500ms) in last hour:**
```bash
XRAY_SERVICE_NAME="your-lambda-function-name-here"
aws xray get-trace-summaries \
  --start-time $(date -u -v-1H +%s) \
  --end-time $(date -u +%s) \
  --filter-expression "service(\"$XRAY_SERVICE_NAME\") AND duration > 500" \
  --region us-east-1
```

**Get all traces with auth-middleware subsegment (last 15 minutes):**
```bash
XRAY_SERVICE_NAME="your-lambda-function-name-here"
aws xray get-trace-summaries \
  --start-time $(date -u -v-15M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression "service(\"$XRAY_SERVICE_NAME\") AND name = \"auth-middleware\"" \
  --region us-east-1
```

**Export trace summaries to JSON file for analysis:**
```bash
XRAY_SERVICE_NAME="your-lambda-function-name-here"
aws xray get-trace-summaries \
  --start-time $(date -u -v-1H +%s) \
  --end-time $(date -u +%s) \
  --filter-expression "service(\"$XRAY_SERVICE_NAME\")" \
  --region us-east-1 \
  > traces-$(date +%Y%m%d-%H%M%S).json
```

**Helper Script:**

A convenience script is available at the repo root: `./query-xray-traces.sh`

```bash
# IMPORTANT: X-Ray service name is usually your Lambda function name.
# Set it once per shell:
export XRAY_SERVICE_NAME="TaskTitanStack-WebappHandler...."

# Query last 10 minutes of all traces
./query-xray-traces.sh 10

# Query cold start traces from last 15 minutes
./query-xray-traces.sh 15 cold-start

# Query slow traces (>500ms) from last 30 minutes
./query-xray-traces.sh 30 slow

# Query unauthenticated requests
./query-xray-traces.sh 20 unauthenticated

# Query sign-in auth actions
./query-xray-traces.sh 20 sign-in
```

**Note:** Replace `us-east-1` with your actual AWS region if different. On Linux, use `date -d '5 minutes ago' +%s` instead of `date -u -v-5M +%s`.

### CloudWatch Logs Insights Queries

**Find slow auth middleware requests:**
```
fields @timestamp, extra.duration_ms, extra.cold_start, extra.authenticated, extra.path
| filter message = "Auth middleware completed"
| sort extra.duration_ms desc
| limit 50
```

**Analyze SSM parameter fetch timing (cold starts):**
```
fields @timestamp, extra.duration_ms, extra.parameter
| filter message = "SSM parameter loaded"
| sort @timestamp desc
| limit 20
```

**Auth middleware statistics over time:**
```
fields @timestamp, extra.duration_ms, extra.cold_start
| filter message = "Auth middleware completed"
| stats avg(extra.duration_ms) as avg_ms, max(extra.duration_ms) as max_ms, count(*) as requests by bin(5m)
```

**Auth route handler performance:**
```
fields @timestamp, extra.action, extra.duration_ms, extra.status
| filter message = "Auth route handler completed"
| sort extra.duration_ms desc
| limit 50
```

### Provisioned Concurrency Metrics (Cold Start Elimination)

Use these CloudWatch metrics to confirm cold starts are effectively eliminated during normal and burst traffic:

- **`ProvisionedConcurrencyUtilization`**: how “full” your provisioned pool is
- **`ProvisionedConcurrencySpilloverInvocations`**: invocations that required on-demand environments (cold starts). Goal: **near 0**.
- **`Duration` p95/p99** on redirect endpoints: should stabilize once spillover is ~0

Quick CLI check (example):

```bash
FUNCTION_NAME="TaskTitanStack-WebappHandler...."
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ProvisionedConcurrencySpilloverInvocations \
  --dimensions Name=FunctionName,Value="$FUNCTION_NAME" \
  --start-time "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 \
  --statistics Sum \
  --region us-east-1
```
