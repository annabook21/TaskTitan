# TaskTitan - AI-Powered Project Planning

[![Build](https://github.com/annabook21/TaskTitan/actions/workflows/build.yml/badge.svg)](https://github.com/annabook21/TaskTitan/actions/workflows/build.yml)

TaskTitan is an AI-powered project planning tool that helps development teams break down projects into manageable components, track decisions, visualize dependencies, and coordinate sprints — eliminating merge conflicts before they happen.

## Features

### Core Planning
- **Component Hierarchy**: Organize work as Epics → Features → Stories → Tasks/Bugs
- **Dependency Visualization**: Interactive graph showing how components relate
- **Sprint Management**: Plan and track time-boxed iterations with capacity planning
- **Team Assignment**: Assign team members with availability and capacity tracking

### AI-Powered Features
- **Smart Component Generation**: Describe your project and let AI suggest the architecture
- **Natural Language Creation**: Create components from plain English descriptions
- **Component Refinement**: Chat with AI to break down and improve components
- **Wireframe Preview**: Generate UI mockups from component descriptions
- **Sprint Planning**: AI suggests which backlog items to include based on priority and dependencies
- **Retrospective Analysis**: AI analyzes sprint performance and suggests improvements

### Team Collaboration
- **Decision Journal**: Document why decisions were made, not just what
- **Real-time Updates**: Live sync when team members make changes
- **GitHub Integration**: Link PRs to components with automatic status updates
- **Team Metrics**: Track cycle time, throughput, and status distribution

### Workflow Support
- **Scrum**: 2-week sprints with planning and retrospectives
- **Kanban**: Continuous flow with WIP limits
- **Shape Up**: 6-week cycles with cooldown periods
- **Custom**: Configure your own workflow settings

## Architecture

TaskTitan FORGE v2 is built on a fully serverless AWS architecture — no VPC, NAT Gateway, or ALB required:

![TaskTitan Architecture](./tasktitan-architecture.drawio.svg)

### Key Technologies

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 App Router, React 19, Tailwind CSS 4 |
| Compute | AWS App Runner (auto-scaling, built-in HTTPS) |
| Database | Amazon DynamoDB (single-table design with ElectroDB) |
| Async Jobs | AWS Lambda (ARM64, no VPC) |
| Auth | Amazon Cognito (User Pool with self sign-up) |
| Real-time | AWS AppSync Events (WebSocket) |
| AI | Amazon Bedrock (Claude Sonnet 4.5) |
| Infrastructure | AWS CDK (TypeScript) |
| Observability | CloudWatch Dashboard, X-Ray Tracing |

### Cost Estimate

| Service | Monthly Cost |
|---------|-------------|
| App Runner (1 vCPU, 2GB) | ~$45-50 |
| DynamoDB (on-demand) | ~$5-25 |
| Lambda (async jobs) | ~$1-5 |
| Other (Cognito, CloudWatch, etc.) | ~$5-10 |
| **Total** | **~$55-90/month** |

## Prerequisites

- [Node.js](https://nodejs.org/) >= v20
- [Docker](https://docs.docker.com/get-docker/)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured with credentials

## Local Development

1. **Start DynamoDB Local**:
   ```bash
   docker compose up -d
   ```

2. **Install dependencies**:
   ```bash
   cd webapp
   npm install
   ```

3. **Create `.env.local`** (if not exists):
   ```bash
   # DynamoDB Local
   DYNAMODB_TABLE_NAME=TaskTitan
   DYNAMODB_ENDPOINT=http://localhost:8000
   AWS_ACCESS_KEY_ID=local
   AWS_SECRET_ACCESS_KEY=local
   AWS_REGION=us-east-2
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3010](http://localhost:3010)

In local development mode, authentication is bypassed and a mock user is created automatically.

## Deploy to AWS

### First-time Setup

```bash
cd cdk
npm ci
npx cdk bootstrap
```

### Deploy

```bash
npx cdk deploy --all
```

Initial deployment takes approximately 15 minutes. After deployment, you'll see output like:

```
TaskTitanForgeStack.FrontendDomainName = https://xxxxxxxxxx.us-east-2.awsapprunner.com
TaskTitanForgeStack.CognitoUserPoolId = us-east-2_xxxxxx
TaskTitanForgeStack.DynamoDBTableName = TaskTitanForgeStack-DynamoTable-xxxxxx
```

### AI Features

AI features are powered by Amazon Bedrock with Claude Sonnet 4.5. No external API keys are needed — everything runs within AWS. Ensure your AWS account has Bedrock model access enabled for the Claude models in us-east-2.

## Project Structure

```
├── cdk/                    # AWS CDK infrastructure
│   ├── bin/cdk.ts          # Stack entry point
│   ├── lib/
│   │   ├── main-stack.ts   # Main stack orchestration
│   │   └── constructs/     # CDK constructs
│   │       ├── app-runner.ts   # App Runner service
│   │       ├── dynamodb.ts     # DynamoDB table
│   │       ├── async-job.ts    # Lambda async jobs
│   │       ├── auth/           # Cognito authentication
│   │       ├── event-bus/      # AppSync real-time
│   │       └── monitoring.ts   # CloudWatch dashboard
│   └── test/               # Infrastructure tests
│
└── webapp/                 # Next.js application
    ├── src/
    │   ├── app/            # Next.js App Router pages
    │   │   ├── projects/   # Project management
    │   │   ├── team/       # Team management
    │   │   ├── sprints/    # Sprint planning
    │   │   └── api/        # API routes
    │   ├── components/     # Shared React components
    │   ├── lib/
    │   │   ├── dynamodb/   # DynamoDB client & ElectroDB entities
    │   │   ├── ai/         # Bedrock client and generators
    │   │   └── demo/       # Demo mode (browser-only storage)
    │   └── jobs/           # Async job handlers
    └── public/             # Static assets
```

## Data Model

TaskTitan uses a single-table DynamoDB design with ElectroDB for type-safe access:

```
User ──┬── Membership ──── Team ──┬── Project ──┬── Component ──┬── Assignment
       │                          │             │               │
       └── Activity ◀─────────────┘             │               └── Dependency
                                                │
                                                └── Sprint
```

- **User**: Authenticated users (Cognito)
- **Team**: Groups with roles (Owner, Admin, Member, Viewer)
- **Project**: Software project being planned
- **Component**: Work items (Epic, Feature, Story, Task, Bug)
- **Sprint**: Time-boxed iterations with capacity
- **Dependency**: Relationships between components
- **Assignment**: Who is responsible for each component

## Demo Mode

Try TaskTitan without signing up by clicking "Try Demo Mode" on the sign-in page. Demo mode stores all data locally in your browser — nothing is sent to the server.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `cd webapp && npm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.
