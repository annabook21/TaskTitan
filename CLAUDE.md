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
