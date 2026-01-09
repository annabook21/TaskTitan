# TaskTitan - Component-Based Project Planning

[![Build](https://github.com/annabook21/TaskTitan/actions/workflows/build.yml/badge.svg)](https://github.com/annabook21/TaskTitan/actions/workflows/build.yml)

**🚀 Live Demo: [https://d3sqkupxqi9lrv.cloudfront.net](https://d3sqkupxqi9lrv.cloudfront.net)**

TaskTitan is an AI-powered project planning tool that helps development teams break down projects into manageable components, assign ownership, visualize dependencies, and coordinate integration timelines — eliminating merge conflicts before they happen.

## Features

- **AI-Powered Component Generation**: Describe your project and let AI suggest the component architecture
- **Dependency Visualization**: Interactive graph showing how components relate to each other
- **Team Assignment**: Assign team members to specific components with clear ownership
- **Timeline Planning**: Visualize component timelines and integration points
- **Real-time Collaboration**: Live updates when team members make changes
- **Activity Tracking**: Full audit trail of project changes

## Architecture

TaskTitan is built on AWS Serverless architecture for high availability, scalability, and cost efficiency:

![TaskTitan Architecture](./tasktitan-architecture.drawio.svg)

### Key Technologies

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 App Router, React, Tailwind CSS |
| Backend | AWS Lambda, Server Actions |
| Database | Aurora PostgreSQL Serverless v2 + Prisma ORM |
| Auth | Amazon Cognito |
| Real-time | AWS AppSync Events |
| AI | OpenAI GPT-3.5 Turbo |
| Infrastructure | AWS CDK (TypeScript) |
| Observability | AWS Powertools (Logging + X-Ray Tracing), CloudWatch |

## Prerequisites

- [Node.js](https://nodejs.org/) >= v20
- [Docker](https://docs.docker.com/get-docker/)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured with credentials
- (Optional) [OpenAI API Key](https://platform.openai.com/api-keys) for AI features

## Local Development

1. **Start the database**:
   ```bash
   cd webapp
   docker compose up -d
   ```

2. **Install dependencies and set up database**:
   ```bash
   npm install
   npx prisma generate
   npx prisma db push
   ```

3. **Create `.env.local`** (copy from `.env.local.example`):
   ```bash
   cp .env.local.example .env.local
   ```
   
   Add your OpenAI API key if you want AI features:
   ```
   OPENAI_API_KEY=sk-your-api-key-here
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3010](http://localhost:3010)

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

Initial deployment takes approximately 20 minutes. After deployment, you'll see output like:

```
✅  TaskTitanStack

Outputs:
TaskTitanStack.AuthUserPoolClientId = xxxxxxxxxxxxxxxxxx
TaskTitanStack.AuthUserPoolId = us-west-2_xxxxxx
TaskTitanStack.FrontendDomainName = https://d1234567890.cloudfront.net
```

### Configuration Options

Edit `cdk/bin/cdk.ts` to customize:

```typescript
const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  // Uncomment to use a custom domain (requires Route53 hosted zone)
  // domainName: 'tasktitan.example.com',
  useNatInstance: false, // false = NAT Gateway (production), true = NAT Instance (dev/cost savings)
};
```

### Adding OpenAI API Key for Production

The AI component generation feature requires an OpenAI API key. Add it as an environment variable to the Lambda function:

1. Go to AWS Lambda Console
2. Find the TaskTitan webapp function
3. Add environment variable: `OPENAI_API_KEY` = your key

Or use AWS Secrets Manager for better security.

## Project Structure

```
├── cdk/                    # AWS CDK infrastructure
│   ├── bin/cdk.ts          # Stack entry point
│   ├── lib/
│   │   ├── main-stack.ts   # Main stack orchestration
│   │   └── constructs/     # CDK constructs (auth, database, webapp, etc.)
│   └── test/               # Infrastructure tests
│
└── webapp/                 # Next.js application
    ├── prisma/             # Database schema and migrations
    ├── src/
    │   ├── app/            # Next.js App Router pages
    │   │   ├── projects/   # Project management
    │   │   ├── team/       # Team management
    │   │   └── sign-in/    # Authentication
    │   ├── components/     # Shared React components
    │   ├── lib/            # Utilities (auth, db, ai, logging)
    │   └── jobs/           # Async job handlers
    └── public/             # Static assets
```

## Data Model

```
User ──┬── Membership ──── Team ──── Project ──┬── Component ──┬── Assignment
       │                                       │               │
       └── Activity ◀──────────────────────────┘               └── Dependency
```

- **User**: Authenticated users
- **Team**: Groups of users collaborating
- **Project**: A software project being planned
- **Component**: Individual pieces of the project
- **Dependency**: Relationships between components
- **Assignment**: Who is responsible for each component
- **Activity**: Audit log of changes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `cd cdk && npm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built on [AWS Serverless Full Stack Webapp Starter Kit](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit).
