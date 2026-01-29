/**
 * Phase 2: AppSync GraphQL API (parallel to Next.js)
 * - Cognito User Pools auth (us-east-2)
 * - DynamoDB data source (same table as ElectroDB)
 * - Lambda data source (Bedrock via AsyncJob Lambda)
 * - JS resolvers for DynamoDB; Lambda resolver for AI mutation
 */

import { CfnOutput, Stack } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import { Construct } from 'constructs';
import { join } from 'path';
import { TaskTitanTable } from './dynamodb';
import { Auth } from './auth';
import { AsyncJob } from './async-job';

export interface AppSyncGraphqlProps {
  readonly dynamoTable: TaskTitanTable;
  readonly auth: Auth;
  readonly asyncJob: AsyncJob;
}

export class AppSyncGraphql extends Construct {
  public readonly api: appsync.GraphqlApi;
  public readonly graphqlUrl: string;
  public readonly apiId: string;

  constructor(scope: Construct, id: string, props: AppSyncGraphqlProps) {
    super(scope, id);
    const { dynamoTable, auth, asyncJob } = props;

    // GraphQL API with Cognito User Pools as default auth (AWS best practice for user-facing APIs)
    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: `${Stack.of(this).stackName}-GraphQL`,
      definition: appsync.Definition.fromFile(join(__dirname, 'appsync-graphql', 'schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: auth.userPool,
          },
        },
      },
      xrayEnabled: true,
    });

    this.graphqlUrl = this.api.graphqlUrl;
    this.apiId = this.api.apiId;

    // DynamoDB data source (same table as Next.js/ElectroDB)
    const dynamoDs = this.api.addDynamoDbDataSource('DynamoDB', dynamoTable.table);

    // Lambda data source (Bedrock via AsyncJob)
    const lambdaDs = this.api.addLambdaDataSource('BedrockLambda', asyncJob.handler);

    // Resolver: Query.getProject (JS) - GetItem pk=PROJECT#id, sk=METADATA (single-table key pattern)
    new appsync.Resolver(this, 'GetProjectResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'PROJECT#' + ctx.args.id,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Query.getTeam (JS) - GetItem pk=TEAM#id, sk=METADATA
    new appsync.Resolver(this, 'GetTeamResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + ctx.args.id,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Query.listProjectsByTeam (JS) - Query GSI2 gsi2pk=TEAM#teamId
    new appsync.Resolver(this, 'ListProjectsByTeamResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listProjectsByTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  return {
    operation: 'Query',
    index: 'gsi2',
    query: {
      expression: 'gsi2pk = :pk AND begins_with(gsi2sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + teamId,
        ':sk': 'PROJECT#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
`.trim()),
    });

    // Resolver: Mutation.createProject (JS) - PutItem PROJECT#id METADATA + GSI keys (client sends id)
    new appsync.Resolver(this, 'CreateProjectResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const id = input.id;
  const now = util.time.nowISO8601();
  const item = {
    pk: 'PROJECT#' + id,
    sk: 'METADATA',
    id,
    name: input.name,
    description: input.description || null,
    teamId: input.teamId,
    ownerId: input.ownerId,
    createdAt: now,
    updatedAt: now,
    gsi1pk: 'OWNER#' + input.ownerId,
    gsi1sk: 'PROJECT#' + id,
    gsi2pk: 'TEAM#' + input.teamId,
    gsi2sk: 'PROJECT#' + id
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk: item.pk, sk: item.sk }),
    attributeValues: util.dynamodb.toMapValues(item)
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  return { id: input.id, name: input.name, description: input.description || null, teamId: input.teamId, ownerId: input.ownerId, createdAt: now, updatedAt: now };
}
`.trim()),
    });

    // Resolver: Mutation.generateComponentViaAI (Lambda) - pass GraphQL args to Lambda (sync Bedrock)
    new appsync.Resolver(this, 'GenerateComponentViaAIResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateComponentViaAI',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    new CfnOutput(this, 'GraphQLApiUrl', {
      value: this.api.graphqlUrl,
      description: 'AppSync GraphQL API URL (us-east-2)',
    });
    new CfnOutput(this, 'GraphQLApiId', {
      value: this.api.apiId,
      description: 'AppSync GraphQL API ID',
    });
  }
}
