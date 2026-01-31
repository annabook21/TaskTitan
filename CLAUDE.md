# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskTitan FORGE v3 is a fully serverless project management application built on AWS. It features component-based project planning with hierarchy support (Epic → Feature → Story → Task/Bug), sprint management, and AI-powered features using Amazon Bedrock (Claude Sonnet 4.5).

> For detailed architecture documentation, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

### Frontend (run from `/webapp-static`)
```bash
npm run dev              # Start Vite dev server on port 5173
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
```

### Backend/Lambda (run from `/webapp`)
```bash
npm install              # Install dependencies (for Lambda builds)
# Lambda handlers are built during CDK deploy via Docker
```

### CDK (run from `/cdk`)
```bash
npm run build            # Compile TypeScript
npm run test             # Run Jest snapshot tests
npx cdk deploy --all     # Deploy both WAF and main stacks
npx cdk diff             # Show infrastructure changes
npx cdk destroy --all    # Destroy all infrastructure
```

### Local Development Setup
```bash
cd webapp-static
npm install
cp .env.example .env.local    # Create env file with AppSync/Cognito endpoints
npm run dev                   # Start Vite dev server
```

## Architecture

### Three-Package Structure
- **`/webapp-static`**: Vite + React 18 frontend (deployed to S3 + CloudFront)
- **`/webapp`**: Backend code (Lambda handlers, AI generators, ElectroDB entities)
- **`/cdk`**: AWS CDK infrastructure as code (two stacks)

### Key Technologies
- **Frontend**: Vite, React 18, Tailwind CSS, React Router, AWS Amplify
- **API**: AWS AppSync GraphQL (Cognito + API Key auth)
- **Database**: Amazon DynamoDB (single-table design with ElectroDB)
- **Auth**: Amazon Cognito (OAuth 2.0 / OIDC)
- **AI**: Amazon Bedrock with Claude Sonnet 4.5
- **Real-time**: AWS AppSync Events (WebSocket pub/sub)
- **Security**: AWS WAF (rate limiting)
- **Infra**: CloudFront + S3, Lambda (Docker ARM64), AppSync

### AI Configuration
- Default model: `global.anthropic.claude-sonnet-4-5-20250929-v1:0` (global inference profile for 10% cost savings)
- Override via `BEDROCK_MODEL_ID` environment variable
- All AI prompts use sentinel delimiters (`<<<JSON` / `JSON>>>`) for robust parsing
- Fallback to markdown code blocks if sentinels not found

### AppSync GraphQL Pattern
All API operations use AppSync GraphQL:
1. **Frontend** (`webapp-static/src/api/appsync.ts`): GraphQL queries/mutations via Amplify
2. **Resolvers** (`cdk/lib/constructs/appsync-graphql.ts`): JS resolvers for DynamoDB, Lambda for AI
3. **Lambda Handlers** (`webapp/src/jobs/async-job/`): Process AI mutations

Example frontend call:
```typescript
import { generateFullPlan } from '@/api/appsync';

const result = await generateFullPlan({
  projectId: 'project-123',
  generateEpics: true,
});
```

### Database Schema (DynamoDB)
Single-table design with ElectroDB entities in `webapp/src/lib/dynamodb/`:

Core entities:
- **User**: Cognito users (pk: `USER#<id>`)
- **Team**: Container with Memberships (OWNER, ADMIN, MEMBER, VIEWER roles)
- **Project**: Belongs to Team, has Components
- **Component**: Hierarchical work items (EPIC → FEATURE → STORY → TASK/BUG)
- **Sprint**: Time-boxed iteration with status (PLANNING, ACTIVE, COMPLETED, CANCELLED)

Global Secondary Indexes:
- **GSI1**: User email, team membership, assignments
- **GSI2**: Sprint and status queries
- **GSI3**: GitHub repo URL lookup (sparse)

### Async Jobs (Lambda)
Background Lambda functions for long-running AI tasks:
- Entry point: `webapp/src/jobs/async-job-runner.ts`
- Handlers: `webapp/src/jobs/async-job/appsync-*.ts`
- AI generators: `webapp/src/lib/ai/generators/`
- Invoked by AppSync Lambda resolvers (10-minute timeout)

Available AI mutations:
- `generateFullPlan` - Generate component hierarchy from project description
- `applyFullPlan` - Atomically save generated plan to DynamoDB
- `refineComponent` - Chat refinement for single component
- `refineBulkPlan` - Chat refinement for entire plan
- `createSmartComponent` - Natural language component creation
- `planSprint` - AI-powered sprint planning
- `applyTemplate` - Apply predefined component templates
- `suggestBreakdown` - Suggest component decomposition
- `generateWireframe` - Generate HTML wireframe
- `analyzeImport` / `cleanupImport` - AI-powered data import
- `generateRetrospective` - Sprint retrospective analysis

### File Organization

**Frontend** (`webapp-static/src/`):
```
├── api/                    # AppSync GraphQL client
│   └── appsync.ts          # All GraphQL operations
├── components/             # Reusable React components
├── pages/                  # Route pages (React Router)
├── hooks/                  # Custom React hooks
└── config.ts               # Environment configuration
```

**Backend** (`webapp/src/`):
```
├── jobs/
│   ├── async-job-runner.ts # Lambda entry point
│   └── async-job/          # AppSync mutation handlers
├── lib/
│   ├── ai/                 # Bedrock AI generators
│   │   └── generators/     # Component, sprint, wireframe, etc.
│   ├── dynamodb/           # ElectroDB entities and client
│   └── logger.ts           # Lambda Powertools logger
```

**Infrastructure** (`cdk/lib/`):
```
├── main-stack.ts           # Main stack (us-east-2)
├── waf-stack.ts            # WAF stack (us-east-1)
└── constructs/
    ├── appsync-graphql.ts  # AppSync API + resolvers
    ├── static-frontend.ts  # CloudFront + S3
    ├── async-job.ts        # Lambda + SQS DLQ
    └── auth/               # Cognito
```

## Development Notes

- Frontend connects to deployed AppSync/Cognito endpoints (configure in `.env.local`)
- Lambda Powertools v2 used for logging (`@/lib/logger`) and tracing
- AI features use Bedrock global inference profiles for cost savings
- Lambda handlers are built as Docker images (ARM64) during CDK deploy
- The `webapp/` package.json is used for Lambda dependencies, not frontend
- DynamoDB schema changes require updating ElectroDB entities in `webapp/src/lib/dynamodb/`

## Performance Debugging

### X-Ray Tracing

X-Ray tracing is enabled on AppSync and Lambda. View traces in the AWS Console:

1. Go to **CloudWatch > X-Ray traces > Traces** in **us-east-2**
2. Filter by service: `TaskTitanForgeStack-AsyncJob` (Lambda) or AppSync API
3. Look for subsegments: `Bedrock`, `DynamoDB`, AI generator functions

**CLI Commands:**

```bash
# Get recent Lambda traces (last 5 minutes)
aws xray get-trace-summaries \
  --start-time $(date -u -v-5M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanForgeStack")' \
  --region us-east-2

# Get slow traces (duration > 5s)
aws xray get-trace-summaries \
  --start-time $(date -u -v-1H +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'duration > 5' \
  --region us-east-2

# Get detailed trace
TRACE_ID="your-trace-id"
aws xray batch-get-traces --trace-ids "$TRACE_ID" --region us-east-2 | jq '.Traces[0]'
```

### CloudWatch Logs Insights

```sql
-- Find AI generation errors
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 50

-- Bedrock token usage
fields @timestamp, @message
| filter @message like /tokens/
| sort @timestamp desc
| limit 20
```

### CloudWatch Dashboard

A pre-configured dashboard is deployed: **TaskTitan-Monitoring**

Metrics tracked:
- Lambda: invocations, errors, duration, concurrent executions
- DynamoDB: consumed capacity, throttling, latency
- CloudFront: error rates (4xx/5xx alarms configured)
