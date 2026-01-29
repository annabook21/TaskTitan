# Deploying the FORGE stack (for humans and AI deployers)

**Use this file when deploying the FORGE stack.** It tells you exactly where the stack lives and which commands to run.

---

## Where the stack is

| What | Where |
|------|--------|
| **Repo** | Main TaskTitan repo (this repo; not a worktree like uas). |
| **Path to CDK** | `cdk/` at the **root of this repo**. |
| **Absolute path (example)** | `/Users/anna/Desktop/TaskTitan/cdk` |
| **Branch** | **FORGE-branch** (DynamoDB, ElectroDB, no Aurora). |
| **Stack name** | **TaskTitanForgeStack** |
| **Region** | **us-east-2** (fixed in `cdk/bin/cdk.ts`). |

The stack definition is in:

- `cdk/bin/cdk.ts` – app entry, stack name and region
- `cdk/lib/main-stack.ts` – what gets deployed (App Runner, DynamoDB, Cognito, Lambda, DLQ, EventBus)
- `cdk/lib/constructs/` – individual resources (e.g. `async-job.ts` – Lambda + DLQ; EventBridge Scheduler was removed in Phase 1)

**If you are in a worktree (e.g. uas):** the FORGE CDK code lives in the **main repo**, not in the worktree. Change directory to the main repo’s `cdk/` before running deploy (see commands below).

---

## Commands to deploy

Run these from a shell with AWS credentials and network access.

```bash
# 1. Go to this repo’s cdk directory.
cd /Users/anna/Desktop/TaskTitan/cdk

# 2. Install dependencies (required once per clone/checkout).
npm install

# 3. Deploy the FORGE stack. Region is us-east-2 (set in cdk/bin/cdk.ts).
npx cdk deploy TaskTitanForgeStack --require-approval never
```

For automation or CI, use the same path and stack name; ensure `AWS_REGION=us-east-2` or that your profile/default is us-east-2.

---

## What “success” looks like

- CloudFormation reports **UPDATE_COMPLETE** or **CREATE_COMPLETE** for **TaskTitanForgeStack** in **us-east-2**.
- Stack outputs include: `FrontendDomainName`, `DynamoDBTableName`, `CognitoUserPoolId`, `AppRunnerServiceUrl`, etc.
- After Phase 1: there is **no** EventBridge Schedule for SampleJob (Lambda is invoked only by App Runner / future AppSync).

---

## Quick reference for AI deployers

- **Directory to run deploy from:** `{this repo root}/cdk` (e.g. `/Users/anna/Desktop/TaskTitan/cdk`).
- **Stack to deploy:** `TaskTitanForgeStack`.
- **Region:** `us-east-2`.
- **Commands in order:** `npm install` then `npx cdk deploy TaskTitanForgeStack --require-approval never`.
- **Do not** run deploy from a worktree’s `cdk/` unless that worktree contains the same FORGE CDK code as this repo.
