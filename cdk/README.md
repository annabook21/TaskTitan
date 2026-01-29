# Infrastructure as Code (AWS CDK)
This is the IaC project written in AWS Cloud Development Kit (CDK).

## FORGE stack (TaskTitanForgeStack)

- **Stack name:** `TaskTitanForgeStack`
- **Region:** `us-east-2` (set in `bin/cdk.ts`)
- **Deploy from this directory:** `cdk/` at the **root of this repo** (main TaskTitan repo). Run:
  - `npm install`
  - `npx cdk deploy TaskTitanForgeStack --require-approval never`
- **Full deploy instructions (path, worktree vs main repo, AI deployers):** see **`DEPLOY_FORGE.md`** in the **repo root** (same directory as this `cdk/` folder).

## Useful commands
* `npx cdk deploy`: deploy the infrastructure
* `npx cdk deploy --require-approval never`: deploy without confirmation (useful for automation)
* `npx cdk deploy --hotswap`: deploy with hotswap feature enabled (useful for development)
* `npx cdk watch`: watch your code and deploy every time changes are detected
* `npx cdk destroy`: delete the infrastructure
