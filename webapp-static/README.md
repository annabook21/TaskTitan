# TaskTitan Static Frontend (Vite + React)

Production static frontend for TaskTitan. Served from **CloudFront + S3**. Uses **AppSync GraphQL** and **Cognito** (client-only, no server).

## Prerequisites

- Node.js 18+
- Deployed stack with AppSync GraphQL API and Cognito User Pool (see main repo `cdk/` and `docs/PHASE3_PLAN.md`).

## Env vars

Copy `.env.example` to `.env.local` and set from stack outputs:

| Variable | Description |
|---------|-------------|
| `VITE_GRAPHQL_URL` | AppSync GraphQL endpoint (e.g. `https://xxx.appsync-api.us-east-2.amazonaws.com/graphql`) |
| `VITE_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_USER_POOL_CLIENT_ID` | Cognito User Pool Client ID |
| `VITE_COGNITO_DOMAIN` | Cognito domain (e.g. `xxxxx.auth.us-east-2.amazoncognito.com`) |
| `VITE_APP_ORIGIN` | App origin for OAuth redirects (CloudFront URL or `http://localhost:5173` for dev) |
| `VITE_AWS_REGION` | AWS region (e.g. `us-east-2`) |

## Local dev

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Sign-in redirects to Cognito Hosted UI; callback is `http://localhost:5173/auth-callback`. Add that URL to the Cognito app client for local testing.

## Build

```bash
npm run build
```

Output is in `dist/`.

## Deploy to S3 (Phase 3)

After stack deploy, sync the build to the static frontend bucket:

```bash
npm run build
aws s3 sync dist/ s3://<StaticFrontendBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

Bucket and distribution IDs are in CDK outputs (e.g. `StaticFrontendBucketName`, CloudFront distribution ID).

## Architecture

- **Entry:** CloudFront → S3 (this app’s `dist/`)
- **API:** AppSync GraphQL (DynamoDB + Lambda/Bedrock)
- **Auth:** Cognito User Pools (Hosted UI, redirect to `/auth-callback`)

See repo root `README.md` and `docs/ARCHITECTURE_CURRENT.md`.
