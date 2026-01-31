/**
 * Phase 2: AppSync GraphQL API (parallel to Next.js)
 * - Cognito User Pools auth (us-east-2)
 * - DynamoDB data source (same table as ElectroDB)
 * - Lambda data source (Bedrock via AsyncJob Lambda)
 * - JS resolvers for DynamoDB; Lambda resolver for AI mutation
 */

import { CfnOutput, Duration, Expiration, Stack } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
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
    // API_KEY added as additional auth for unauthenticated operations (registerUser)
    // AWS Documentation: https://docs.aws.amazon.com/appsync/latest/devguide/security-authz.html
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
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.API_KEY,
            apiKeyConfig: {
              expires: Expiration.after(Duration.days(365)),
              description: 'API key for unauthenticated operations (registerUser)',
            },
          },
          {
            // IAM auth for Lambda -> AppSync calls (e.g., publishAIProgress)
            // AWS Best Practice: Use IAM for service-to-service calls
            authorizationType: appsync.AuthorizationType.IAM,
          },
        ],
      },
      xrayEnabled: true,
    });

    this.graphqlUrl = this.api.graphqlUrl;
    this.apiId = this.api.apiId;

    // DynamoDB data source (same table as Next.js/ElectroDB)
    const dynamoDs = this.api.addDynamoDbDataSource('DynamoDB', dynamoTable.table);

    // Lambda data source (Bedrock via AsyncJob)
    const lambdaDs = this.api.addLambdaDataSource('BedrockLambda', asyncJob.handler);

    // Grant Lambda permission to call AppSync mutations (for async progress updates)
    // AWS Best Practice: Scope IAM permissions to specific GraphQL operations
    this.api.grant(asyncJob.handler, appsync.IamResource.custom('types/Mutation/fields/publishAIProgress'), 'appsync:GraphQL');

    // Lambda for user registration (AdminCreateUser - requires unauthenticated access)
    // AWS Documentation: https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html
    const registerUserLambda = new lambdaNode.NodejsFunction(this, 'RegisterUserHandler', {
      entry: join(__dirname, 'appsync-graphql', 'register-user-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        USER_POOL_ID: auth.userPool.userPoolId,
      },
    });

    // Grant Cognito AdminCreateUser permission
    auth.userPool.grant(registerUserLambda, 'cognito-idp:AdminCreateUser');

    // Lambda data source for registration
    const registerUserDs = this.api.addLambdaDataSource('RegisterUserLambda', registerUserLambda);

    // Resolver: Mutation.registerUser (Lambda) - unauthenticated, uses API_KEY
    // AWS best practice: Lambda for admin SDK operations
    new appsync.Resolver(this, 'RegisterUserResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'registerUser',
      dataSource: registerUserDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

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

    // Resolver: Query.getCurrentUser (JS) - Upsert pattern: creates User if not exists
    // Uses ctx.identity.sub and claims from Cognito JWT
    // AWS Best Practice: Auto-create user record on first access for seamless onboarding
    // NOTE: Access token may not include email/name claims - ID token does.
    // If claims are available, we update even if existing value is NULL (fixes data migration issues)
    new appsync.Resolver(this, 'GetCurrentUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getCurrentUser',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const claims = ctx.identity.claims || {};
  const email = claims.email || null;
  const name = claims.name || claims['custom:name'] || null;
  const now = util.time.nowISO8601();

  // Build dynamic update expression based on available claims
  // Core fields always set with if_not_exists
  let expression = 'SET #id = if_not_exists(#id, :id), #createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now, #gsi1sk = if_not_exists(#gsi1sk, :gsi1sk)';
  const expNames = {
    '#id': 'id',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt',
    '#gsi1sk': 'gsi1sk'
  };
  const expValues = {
    ':id': userId,
    ':now': now,
    ':gsi1sk': 'USER#' + userId
  };

  // If we have email from claims, update it (even if NULL exists in DB)
  // This fixes records that were created before email was properly extracted
  if (email) {
    expression += ', #email = :email, #gsi1pk = :gsi1pk';
    expNames['#email'] = 'email';
    expNames['#gsi1pk'] = 'gsi1pk';
    expValues[':email'] = email;
    expValues[':gsi1pk'] = 'EMAIL#' + email;
  } else {
    // No email in claims - only set if doesn't exist
    expression += ', #email = if_not_exists(#email, :emailNull), #gsi1pk = if_not_exists(#gsi1pk, :gsi1pkUnknown)';
    expNames['#email'] = 'email';
    expNames['#gsi1pk'] = 'gsi1pk';
    expValues[':emailNull'] = null;
    expValues[':gsi1pkUnknown'] = 'EMAIL#unknown';
  }

  // If we have name from claims, update it (even if NULL exists in DB)
  if (name) {
    expression += ', #name = :name';
    expNames['#name'] = 'name';
    expValues[':name'] = name;
  } else {
    expression += ', #name = if_not_exists(#name, :nameNull)';
    expNames['#name'] = 'name';
    expValues[':nameNull'] = null;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    }),
    update: {
      expression: expression,
      expressionNames: expNames,
      expressionValues: util.dynamodb.toMapValues(expValues)
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // UpdateItem returns the updated attributes
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.syncUserProfile (JS) - Updates user email/name from ID token
    // AWS Best Practice: Access token doesn't contain email/name claims, so frontend
    // extracts these from ID token and syncs them to DynamoDB after OAuth callback
    new appsync.Resolver(this, 'SyncUserProfileResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'syncUserProfile',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const input = ctx.args.input;
  const email = input.email;
  const name = input.name;
  const now = util.time.nowISO8601();

  // Update user record with email and name from ID token
  // This fixes records created with null values from access token claims
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET #id = if_not_exists(#id, :id), #email = :email, #name = :name, #createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now, #gsi1pk = :gsi1pk, #gsi1sk = if_not_exists(#gsi1sk, :gsi1sk)',
      expressionNames: {
        '#id': 'id',
        '#email': 'email',
        '#name': 'name',
        '#createdAt': 'createdAt',
        '#updatedAt': 'updatedAt',
        '#gsi1pk': 'gsi1pk',
        '#gsi1sk': 'gsi1sk'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':id': userId,
        ':email': email,
        ':name': name,
        ':now': now,
        ':gsi1pk': 'EMAIL#' + email,
        ':gsi1sk': 'USER#' + userId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Query.getUserByEmail (JS) - Query GSI1 gsi1pk=EMAIL#email
    new appsync.Resolver(this, 'GetUserByEmailResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getUserByEmail',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const email = ctx.args.email;
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND gsi1sk = :sk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'EMAIL#' + email,
        ':sk': 'USER'
      })
    },
    limit: 1
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  return items.length > 0 ? items[0] : null;
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

    // Pipeline functions for getTeamWithMembers
    // Function 1: Query team + members
    const getTeamAndMembersFn = new appsync.AppsyncFunction(this, 'GetTeamAndMembersFn', {
      name: 'getTeamAndMembers',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + teamId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  let team = null;
  const members = [];
  for (const item of items) {
    if (item.sk === 'METADATA') {
      team = item;
    } else if (item.sk && item.sk.startsWith('MEMBER#')) {
      members.push(item);
    }
  }
  ctx.stash.team = team;
  ctx.stash.members = members;
  return { team, members };
}
`.trim()),
    });

    // Function 2: Batch fetch user details for all members
    const batchGetMemberUsersFn = new appsync.AppsyncFunction(this, 'BatchGetMemberUsersFn', {
      name: 'batchGetMemberUsers',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const members = ctx.stash.members || [];
  if (members.length === 0 || !ctx.stash.team) {
    // No members or no team, skip batch fetch
    return { operation: 'Query', query: { expression: 'pk = :pk', expressionValues: util.dynamodb.toMapValues({ ':pk': 'NONE' }) } };
  }
  // BatchGetItem for user details
  const keys = members.map(m => util.dynamodb.toMapValues({ pk: 'USER#' + m.userId, sk: 'METADATA' }));
  return {
    operation: 'BatchGetItem',
    tables: {
      '${dynamoTable.tableName}': { keys: keys }
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const team = ctx.stash.team;
  if (!team) return null;

  // Build user lookup map
  const userMap = {};
  const userData = ctx.result?.data?.['${dynamoTable.tableName}'] || [];
  for (const user of userData) {
    if (user && user.id) {
      userMap[user.id] = user;
    }
  }

  // Attach user details to each member
  const members = ctx.stash.members || [];
  const membersWithUsers = members.map(m => ({
    ...m,
    user: userMap[m.userId] || null
  }));

  return { team, members: membersWithUsers };
}
`.trim()),
    });

    // Resolver: Query.getTeamWithMembers (Pipeline) - Query team + members, then batch fetch user details
    new appsync.Resolver(this, 'GetTeamWithMembersResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getTeamWithMembers',
      pipelineConfig: [getTeamAndMembersFn, batchGetMemberUsersFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
    });

    // Pipeline functions for listTeamsForUser
    const listMembershipsForUserFn = new appsync.AppsyncFunction(this, 'ListMembershipsForUserFn', {
      name: 'listMembershipsForUser',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.memberships = ctx.result.items || [];
  return ctx.result.items || [];
}
`.trim()),
    });

    const batchGetTeamsFn = new appsync.AppsyncFunction(this, 'BatchGetTeamsFn', {
      name: 'batchGetTeams',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const memberships = ctx.stash.memberships || [];
  if (memberships.length === 0) {
    return { operation: 'Query', query: { expression: 'pk = :pk', expressionValues: util.dynamodb.toMapValues({ ':pk': 'NONE' }) } };
  }
  // BatchGetItem format per AWS docs: tables: { tableName: { keys: [...] } }
  const keys = memberships.map(m => util.dynamodb.toMapValues({ pk: 'TEAM#' + m.teamId, sk: 'METADATA' }));
  return {
    operation: 'BatchGetItem',
    tables: {
      '#{tableName}': { keys: keys }
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const memberships = ctx.stash.memberships || [];
  // BatchGetItem result: ctx.result.data[tableName] contains array of items
  const teams = ctx.result.data ? (ctx.result.data['#{tableName}'] || []) : [];
  const teamMap = {};
  for (const team of teams) {
    if (team && team.id) teamMap[team.id] = team;
  }
  return memberships.map(m => ({
    team: teamMap[m.teamId] || { id: m.teamId, name: 'Unknown' },
    members: [m]
  })).filter(t => t.team && t.team.name !== 'Unknown');
}
`.trim().replace(/#{tableName}/g, dynamoTable.tableName)),
    });

    // Resolver: Query.listTeamsForUser (Pipeline) - Query user memberships → batch get teams
    new appsync.Resolver(this, 'ListTeamsForUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listTeamsForUser',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [listMembershipsForUserFn, batchGetTeamsFn],
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

    // Resolver: Query.listProjectsForUser (JS) - Query GSI1 gsi1pk=OWNER#userId
    new appsync.Resolver(this, 'ListProjectsForUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listProjectsForUser',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'OWNER#' + userId,
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
    attributeValues: util.dynamodb.toMapValues(item),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Project already exists', 'ProjectAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  return { id: input.id, name: input.name, description: input.description || null, teamId: input.teamId, ownerId: input.ownerId, createdAt: now, updatedAt: now };
}
`.trim()),
    });

    // Resolver: Mutation.updateProject (JS) - UpdateItem pk=PROJECT#id, sk=METADATA
    new appsync.Resolver(this, 'UpdateProjectResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const projectId = ctx.args.id;
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const expNames = { '#updatedAt': 'updatedAt' };
  const expValues = { ':updatedAt': util.dynamodb.toDynamoDB(now) };
  let updateExp = 'SET #updatedAt = :updatedAt';
  if (input.name !== undefined && input.name !== null) {
    expNames['#name'] = 'name';
    expValues[':name'] = util.dynamodb.toDynamoDB(input.name);
    updateExp += ', #name = :name';
  }
  if (input.description !== undefined) {
    expNames['#description'] = 'description';
    expValues[':description'] = util.dynamodb.toDynamoDB(input.description);
    updateExp += ', #description = :description';
  }
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'PROJECT#' + projectId, sk: 'METADATA' }),
    update: { expression: updateExp, expressionNames: expNames, expressionValues: expValues }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.deleteProject (JS) - DeleteItem pk=PROJECT#id, sk=METADATA
    // Note: In production, consider cascade delete for related components via Lambda resolver
    new appsync.Resolver(this, 'DeleteProjectResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'deleteProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const projectId = ctx.args.id;
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'PROJECT#' + projectId,
      sk: 'METADATA'
    }),
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Project not found', 'ProjectNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.createTeam (JS) - TransactWrite: Team + Membership (OWNER)
    new appsync.Resolver(this, 'CreateTeamResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const teamId = input.id;
  const userId = ctx.identity.sub;
  const now = util.time.nowISO8601();
  const membershipId = util.autoId();
  const team = {
    pk: 'TEAM#' + teamId,
    sk: 'METADATA',
    id: teamId,
    name: input.name,
    description: input.description || null,
    createdAt: now,
    updatedAt: now
  };
  const membership = {
    pk: 'TEAM#' + teamId,
    sk: 'MEMBER#' + userId,
    id: membershipId,
    userId: userId,
    teamId: teamId,
    role: 'OWNER',
    joinedAt: now,
    title: null,
    hoursPerDay: 6,
    availability: 100,
    gsi1pk: 'USER#' + userId,
    gsi1sk: 'TEAM#' + teamId
  };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      { table: '${dynamoTable.tableName}', operation: 'PutItem', key: util.dynamodb.toMapValues({ pk: team.pk, sk: team.sk }), attributeValues: util.dynamodb.toMapValues(team) },
      { table: '${dynamoTable.tableName}', operation: 'PutItem', key: util.dynamodb.toMapValues({ pk: membership.pk, sk: membership.sk }), attributeValues: util.dynamodb.toMapValues(membership) }
    ]
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const input = ctx.args.input;
  const userId = ctx.identity.sub;
  const now = util.time.nowISO8601();
  const team = { id: input.id, name: input.name, description: input.description || null, createdAt: now, updatedAt: now };
  const membership = { id: util.autoId(), userId, teamId: input.id, role: 'OWNER', joinedAt: now, title: null, hoursPerDay: 6, availability: 100 };
  return { team, members: [membership] };
}
`.trim()),
    });

    // Resolver: Mutation.updateTeam (JS) - UpdateItem pk=TEAM#id, sk=METADATA
    new appsync.Resolver(this, 'UpdateTeamResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const expNames = { '#updatedAt': 'updatedAt' };
  const expValues = { ':updatedAt': util.dynamodb.toDynamoDB(now) };
  let updateExp = 'SET #updatedAt = :updatedAt';
  if (input.name !== undefined && input.name !== null) {
    expNames['#name'] = 'name';
    expValues[':name'] = util.dynamodb.toDynamoDB(input.name);
    updateExp += ', #name = :name';
  }
  if (input.description !== undefined) {
    expNames['#description'] = 'description';
    expValues[':description'] = util.dynamodb.toDynamoDB(input.description);
    updateExp += ', #description = :description';
  }
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'TEAM#' + teamId, sk: 'METADATA' }),
    update: { expression: updateExp, expressionNames: expNames, expressionValues: expValues }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.addTeamMember (JS) - PutItem Membership
    new appsync.Resolver(this, 'AddTeamMemberResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'addTeamMember',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const membershipId = util.autoId();
  const membership = {
    pk: 'TEAM#' + input.teamId,
    sk: 'MEMBER#' + input.userId,
    id: membershipId,
    userId: input.userId,
    teamId: input.teamId,
    role: input.role,
    joinedAt: now,
    title: input.title || null,
    hoursPerDay: 6,
    availability: 100,
    gsi1pk: 'USER#' + input.userId,
    gsi1sk: 'TEAM#' + input.teamId
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk: membership.pk, sk: membership.sk }),
    attributeValues: util.dynamodb.toMapValues(membership),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Member already exists in team', 'MemberAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.removeTeamMember (JS) - DeleteItem Membership with existence check
    new appsync.Resolver(this, 'RemoveTeamMemberResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeTeamMember',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  const userId = ctx.args.userId;
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    }),
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Member not found in team', 'MemberNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.updateMemberRole (JS) - UpdateItem Membership role
    new appsync.Resolver(this, 'UpdateMemberRoleResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateMemberRole',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + input.teamId,
      sk: 'MEMBER#' + input.userId
    }),
    update: {
      expression: 'SET #role = :role',
      expressionNames: { '#role': 'role' },
      expressionValues: { ':role': util.dynamodb.toDynamoDB(input.role) }
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // ========== COMPONENT RESOLVERS ==========

    // Resolver: Query.getComponent (JS) - GetItem pk=COMPONENT#id, sk=METADATA
    new appsync.Resolver(this, 'GetComponentResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + ctx.args.id,
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

    // Resolver: Query.listComponentsByProject (JS) - Query GSI1 gsi1pk=PROJECT#projectId
    new appsync.Resolver(this, 'ListComponentsByProjectResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listComponentsByProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'PROJECT#' + ctx.args.projectId,
        ':sk': 'COMPONENT#'
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

    // Pipeline functions for getComponentChildren
    const getParentComponentFn = new appsync.AppsyncFunction(this, 'GetParentComponentFn', {
      name: 'getParentComponent',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + ctx.args.parentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const parent = ctx.result;
  if (!parent) {
    ctx.stash.projectId = null;
    return [];
  }
  ctx.stash.parentId = ctx.args.parentId;
  ctx.stash.projectId = parent.projectId;
  return parent;
}
`.trim()),
    });

    const queryChildComponentsFn = new appsync.AppsyncFunction(this, 'QueryChildComponentsFn', {
      name: 'queryChildComponents',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const projectId = ctx.stash.projectId;
  if (!projectId) {
    // Return empty query if parent not found
    return { operation: 'Query', query: { expression: 'pk = :pk', expressionValues: util.dynamodb.toMapValues({ ':pk': 'NONE' }) } };
  }
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'PROJECT#' + projectId,
        ':sk': 'COMPONENT#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const parentId = ctx.stash.parentId;
  const items = ctx.result.items || [];
  // Filter to only return children of the specified parent
  return items.filter(item => item.parentId === parentId);
}
`.trim()),
    });

    // Resolver: Query.getComponentChildren (Pipeline) - Get parent, then query project components filtered by parentId
    new appsync.Resolver(this, 'GetComponentChildrenResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getComponentChildren',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [getParentComponentFn, queryChildComponentsFn],
    });

    // Resolver: Mutation.createComponent (JS) - PutItem COMPONENT#id METADATA + GSI keys
    new appsync.Resolver(this, 'CreateComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const id = input.id;
  const now = util.time.nowISO8601();
  const item = {
    pk: 'COMPONENT#' + id,
    sk: 'METADATA',
    id,
    name: input.name,
    description: input.description || null,
    type: input.type,
    projectId: input.projectId,
    parentId: input.parentId || null,
    sprintId: null,
    status: input.status || 'PLANNING',
    priority: input.priority || 0,
    estimatedHours: input.estimatedHours || null,
    actualHours: null,
    dueDate: input.dueDate || null,
    owner: input.owner || null,
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now,
    gsi1pk: 'PROJECT#' + input.projectId,
    gsi1sk: 'COMPONENT#' + id
  };
  // Add GSI2 keys only if sprintId is set (sparse index)
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk: item.pk, sk: item.sk }),
    attributeValues: util.dynamodb.toMapValues(item),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Component with this ID already exists', 'ComponentAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  return {
    id: input.id,
    name: input.name,
    description: input.description || null,
    type: input.type,
    projectId: input.projectId,
    parentId: input.parentId || null,
    sprintId: null,
    status: input.status || 'PLANNING',
    priority: input.priority || 0,
    estimatedHours: input.estimatedHours || null,
    actualHours: null,
    dueDate: input.dueDate || null,
    owner: input.owner || null,
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now
  };
}
`.trim()),
    });

    // Resolver: Mutation.updateComponent (JS) - UpdateItem with dynamic fields
    new appsync.Resolver(this, 'UpdateComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.id;
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const expNames = { '#updatedAt': 'updatedAt' };
  const expValues = { ':updatedAt': util.dynamodb.toDynamoDB(now) };
  let updateExp = 'SET #updatedAt = :updatedAt';

  const fields = ['name', 'description', 'type', 'parentId', 'sprintId', 'status', 'priority', 'estimatedHours', 'actualHours', 'dueDate', 'owner', 'tags'];
  for (const field of fields) {
    if (input[field] !== undefined) {
      expNames['#' + field] = field;
      expValues[':' + field] = util.dynamodb.toDynamoDB(input[field]);
      updateExp += ', #' + field + ' = :' + field;
    }
  }

  // Handle GSI2 (sprint) updates - sparse index
  if (input.sprintId !== undefined) {
    if (input.sprintId) {
      expNames['#gsi2pk'] = 'gsi2pk';
      expNames['#gsi2sk'] = 'gsi2sk';
      expValues[':gsi2pk'] = util.dynamodb.toDynamoDB('SPRINT#' + input.sprintId);
      expValues[':gsi2sk'] = util.dynamodb.toDynamoDB('COMPONENT#' + componentId);
      updateExp += ', #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk';
    } else {
      // Remove from sprint GSI by setting to null (sparse index will exclude)
      expNames['#gsi2pk'] = 'gsi2pk';
      expNames['#gsi2sk'] = 'gsi2sk';
      expValues[':gsi2pk'] = util.dynamodb.toDynamoDB(null);
      expValues[':gsi2sk'] = util.dynamodb.toDynamoDB(null);
      updateExp += ', #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk';
    }
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + componentId, sk: 'METADATA' }),
    update: { expression: updateExp, expressionNames: expNames, expressionValues: expValues }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Pipeline functions for deleteComponent with cascade dependency deletion
    const queryDependenciesFn = new appsync.AppsyncFunction(this, 'QueryDependenciesForDeleteFn', {
      name: 'queryDependenciesForDelete',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  ctx.stash.componentId = ctx.args.id;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'COMPONENT#' + ctx.args.id,
        ':sk': 'DEPENDS_ON#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.dependencies = ctx.result.items || [];
  return ctx.result;
}
`.trim()),
    });

    const queryDependentsFn = new appsync.AppsyncFunction(this, 'QueryDependentsForDeleteFn', {
      name: 'queryDependentsForDelete',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'REQUIRED_BY#' + ctx.stash.componentId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.dependents = ctx.result.items || [];
  return ctx.result;
}
`.trim()),
    });

    const batchDeleteComponentFn = new appsync.AppsyncFunction(this, 'BatchDeleteComponentFn', {
      name: 'batchDeleteComponent',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  const dependencies = ctx.stash.dependencies || [];
  const dependents = ctx.stash.dependents || [];

  // Build delete requests: component + its dependencies + dependents pointing to it
  const deleteRequests = [];

  // Delete the component itself
  deleteRequests.push({
    table: '${props.dynamoTable.tableName}',
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + componentId, sk: 'METADATA' }),
    condition: { expression: 'attribute_exists(pk)' }
  });

  // Delete dependencies (what this component depends on)
  for (const dep of dependencies) {
    deleteRequests.push({
      table: '${props.dynamoTable.tableName}',
      operation: 'DeleteItem',
      key: util.dynamodb.toMapValues({ pk: dep.pk, sk: dep.sk })
    });
  }

  // Delete dependents (what depends on this component)
  for (const dep of dependents) {
    deleteRequests.push({
      table: '${props.dynamoTable.tableName}',
      operation: 'DeleteItem',
      key: util.dynamodb.toMapValues({ pk: dep.pk, sk: dep.sk })
    });
  }

  // Use TransactWriteItems for atomic deletion (max 100 items)
  if (deleteRequests.length > 100) {
    util.error('Too many items to delete in single transaction', 'TransactionLimitExceeded');
  }

  return {
    operation: 'TransactWriteItems',
    transactItems: deleteRequests
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.result && ctx.result.cancellationReasons) {
      const reasons = ctx.result.cancellationReasons;
      if (reasons[0] && reasons[0].type === 'ConditionCheckFailed') {
        util.error('Component not found', 'ComponentNotFound');
      }
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.deleteComponent (Pipeline) - Query dependencies, then batch delete
    new appsync.Resolver(this, 'DeleteComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'deleteComponent',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [queryDependenciesFn, queryDependentsFn, batchDeleteComponentFn],
    });

    // ========== DEPENDENCY RESOLVERS ==========

    // Resolver: Query.getDependencies (JS) - Query pk=COMPONENT#id, sk begins_with DEPENDS_ON#
    new appsync.Resolver(this, 'GetDependenciesResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getDependencies',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'COMPONENT#' + ctx.args.componentId,
        ':sk': 'DEPENDS_ON#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    fromComponentId: item.fromComponentId,
    toComponentId: item.toComponentId,
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Resolver: Query.getDependents (JS) - Query GSI1 gsi1pk=REQUIRED_BY#id
    new appsync.Resolver(this, 'GetDependentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getDependents',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'REQUIRED_BY#' + ctx.args.componentId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    fromComponentId: item.fromComponentId,
    toComponentId: item.toComponentId,
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Resolver: Mutation.addDependency (JS) - TransactWriteItems to create dependency with validation
    new appsync.Resolver(this, 'AddDependencyResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'addDependency',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const fromId = ctx.args.fromComponentId;
  const toId = ctx.args.toComponentId;

  // Validate: cannot depend on self
  if (fromId === toId) {
    util.error('A component cannot depend on itself', 'SelfDependencyError');
  }

  const now = util.time.nowISO8601();
  const dependencyItem = {
    pk: 'COMPONENT#' + fromId,
    sk: 'DEPENDS_ON#' + toId,
    fromComponentId: fromId,
    toComponentId: toId,
    createdAt: now,
    gsi1pk: 'REQUIRED_BY#' + toId,
    gsi1sk: 'COMPONENT#' + fromId
  };

  return {
    operation: 'TransactWriteItems',
    transactItems: [
      // Check that the "from" component exists
      {
        table: '${props.dynamoTable.tableName}',
        operation: 'ConditionCheck',
        key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + fromId, sk: 'METADATA' }),
        condition: { expression: 'attribute_exists(pk)' }
      },
      // Check that the "to" component exists
      {
        table: '${props.dynamoTable.tableName}',
        operation: 'ConditionCheck',
        key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + toId, sk: 'METADATA' }),
        condition: { expression: 'attribute_exists(pk)' }
      },
      // Create the dependency (fail if already exists)
      {
        table: '${props.dynamoTable.tableName}',
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk: dependencyItem.pk, sk: dependencyItem.sk }),
        attributeValues: util.dynamodb.toMapValues(dependencyItem),
        condition: { expression: 'attribute_not_exists(pk)' }
      }
    ]
  };
}
export function response(ctx) {
  if (ctx.error) {
    // Check for transaction cancellation reasons
    if (ctx.result && ctx.result.cancellationReasons) {
      const reasons = ctx.result.cancellationReasons;
      if (reasons[0] && reasons[0].type === 'ConditionCheckFailed') {
        util.error('Source component not found', 'ComponentNotFound');
      }
      if (reasons[1] && reasons[1].type === 'ConditionCheckFailed') {
        util.error('Target component not found', 'ComponentNotFound');
      }
      if (reasons[2] && reasons[2].type === 'ConditionCheckFailed') {
        util.error('Dependency already exists', 'DependencyAlreadyExists');
      }
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const fromId = ctx.args.fromComponentId;
  const toId = ctx.args.toComponentId;
  const now = util.time.nowISO8601();
  return { fromComponentId: fromId, toComponentId: toId, createdAt: now };
}
`.trim()),
    });

    // Resolver: Mutation.removeDependency (JS) - DeleteItem with existence check
    new appsync.Resolver(this, 'RemoveDependencyResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeDependency',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const fromId = ctx.args.fromComponentId;
  const toId = ctx.args.toComponentId;
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + fromId,
      sk: 'DEPENDS_ON#' + toId
    }),
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Dependency not found', 'DependencyNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // ========== SPRINT RESOLVERS ==========

    // Resolver: Query.getSprint (JS) - GetItem pk=SPRINT#id, sk=METADATA
    new appsync.Resolver(this, 'GetSprintResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'SPRINT#' + ctx.args.id,
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

    // Resolver: Query.listSprintsByTeam (JS) - Query GSI1 gsi1pk=TEAM#teamId
    new appsync.Resolver(this, 'ListSprintsByTeamResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listSprintsByTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + ctx.args.teamId,
        ':sk': 'SPRINT#'
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

    // Pipeline functions for getSprintWithComponents
    const getSprintFn = new appsync.AppsyncFunction(this, 'GetSprintFn', {
      name: 'getSprintForWithComponents',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  ctx.stash.sprintId = ctx.args.sprintId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'SPRINT#' + ctx.args.sprintId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) {
    util.error('Sprint not found', 'SprintNotFound');
  }
  ctx.stash.sprint = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    const querySprintComponentsFn = new appsync.AppsyncFunction(this, 'QuerySprintComponentsFn', {
      name: 'querySprintComponents',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'gsi2',
    query: {
      expression: 'gsi2pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'SPRINT#' + ctx.stash.sprintId
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    sprint: ctx.stash.sprint,
    components: ctx.result.items || []
  };
}
`.trim()),
    });

    // Resolver: Query.getSprintWithComponents (Pipeline)
    new appsync.Resolver(this, 'GetSprintWithComponentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getSprintWithComponents',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [getSprintFn, querySprintComponentsFn],
    });

    // Resolver: Mutation.createSprint (JS) - PutItem with condition
    new appsync.Resolver(this, 'CreateSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const id = input.id;
  const now = util.time.nowISO8601();
  const item = {
    pk: 'SPRINT#' + id,
    sk: 'METADATA',
    id,
    teamId: input.teamId,
    name: input.name,
    goal: input.goal || null,
    status: 'PLANNING',
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    createdAt: now,
    updatedAt: now,
    gsi1pk: 'TEAM#' + input.teamId,
    gsi1sk: 'SPRINT#' + id
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk: item.pk, sk: item.sk }),
    attributeValues: util.dynamodb.toMapValues(item),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint with this ID already exists', 'SprintAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  return {
    id: input.id,
    teamId: input.teamId,
    name: input.name,
    goal: input.goal || null,
    status: 'PLANNING',
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    createdAt: now,
    updatedAt: now
  };
}
`.trim()),
    });

    // Resolver: Mutation.updateSprint (JS) - UpdateItem
    new appsync.Resolver(this, 'UpdateSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const sprintId = ctx.args.id;
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const expNames = { '#updatedAt': 'updatedAt' };
  const expValues = { ':updatedAt': util.dynamodb.toDynamoDB(now) };
  let updateExp = 'SET #updatedAt = :updatedAt';

  const fields = ['name', 'goal', 'startDate', 'endDate'];
  for (const field of fields) {
    if (input[field] !== undefined) {
      expNames['#' + field] = field;
      expValues[':' + field] = util.dynamodb.toDynamoDB(input[field]);
      updateExp += ', #' + field + ' = :' + field;
    }
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + sprintId, sk: 'METADATA' }),
    update: { expression: updateExp, expressionNames: expNames, expressionValues: expValues },
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint not found', 'SprintNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.deleteSprint (JS) - DeleteItem
    new appsync.Resolver(this, 'DeleteSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'deleteSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'SPRINT#' + ctx.args.id,
      sk: 'METADATA'
    }),
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint not found', 'SprintNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.startSprint (JS) - UpdateItem status to ACTIVE
    new appsync.Resolver(this, 'StartSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'startSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + ctx.args.id, sk: 'METADATA' }),
    update: {
      expression: 'SET #status = :status, #updatedAt = :updatedAt',
      expressionNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'ACTIVE', ':updatedAt': now, ':planning': 'PLANNING' })
    },
    condition: { expression: 'attribute_exists(pk) AND #status = :planning' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint not found or not in PLANNING status', 'InvalidSprintStatus');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.completeSprint (JS) - UpdateItem status to COMPLETED
    new appsync.Resolver(this, 'CompleteSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'completeSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + ctx.args.id, sk: 'METADATA' }),
    update: {
      expression: 'SET #status = :status, #updatedAt = :updatedAt',
      expressionNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'COMPLETED', ':updatedAt': now, ':active': 'ACTIVE' })
    },
    condition: { expression: 'attribute_exists(pk) AND #status = :active' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint not found or not in ACTIVE status', 'InvalidSprintStatus');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.assignComponentToSprint (JS) - UpdateItem component with sprintId + GSI2
    new appsync.Resolver(this, 'AssignComponentToSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'assignComponentToSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  const sprintId = ctx.args.sprintId;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + componentId, sk: 'METADATA' }),
    update: {
      expression: 'SET #sprintId = :sprintId, #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk, #updatedAt = :updatedAt',
      expressionNames: {
        '#sprintId': 'sprintId',
        '#gsi2pk': 'gsi2pk',
        '#gsi2sk': 'gsi2sk',
        '#updatedAt': 'updatedAt'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':sprintId': sprintId,
        ':gsi2pk': 'SPRINT#' + sprintId,
        ':gsi2sk': 'COMPONENT#' + componentId,
        ':updatedAt': now
      })
    },
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Component not found', 'ComponentNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Mutation.removeComponentFromSprint (JS) - UpdateItem to clear sprintId + GSI2
    new appsync.Resolver(this, 'RemoveComponentFromSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeComponentFromSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + componentId, sk: 'METADATA' }),
    update: {
      expression: 'SET #sprintId = :null, #updatedAt = :updatedAt REMOVE #gsi2pk, #gsi2sk',
      expressionNames: {
        '#sprintId': 'sprintId',
        '#gsi2pk': 'gsi2pk',
        '#gsi2sk': 'gsi2sk',
        '#updatedAt': 'updatedAt'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':null': null,
        ':updatedAt': now
      })
    },
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Component not found', 'ComponentNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`.trim()),
    });

    // ========== ASSIGNMENT RESOLVERS ==========

    // Pipeline functions for listAssignmentsForUser
    const queryAssignmentsForUserFn = new appsync.AppsyncFunction(this, 'QueryAssignmentsForUserFn', {
      name: 'queryAssignmentsForUser',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  ctx.stash.userId = userId;
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'ASSIGNMENT#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.assignments = ctx.result.items || [];
  return ctx.result.items || [];
}
`.trim()),
    });

    const batchGetAssignmentComponentsFn = new appsync.AppsyncFunction(this, 'BatchGetAssignmentComponentsFn', {
      name: 'batchGetAssignmentComponents',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const assignments = ctx.stash.assignments || [];
  if (assignments.length === 0) {
    return { operation: 'Query', query: { expression: 'pk = :pk', expressionValues: util.dynamodb.toMapValues({ ':pk': 'NONE' }) } };
  }
  const keys = assignments.map(a => util.dynamodb.toMapValues({ pk: 'COMPONENT#' + a.componentId, sk: 'METADATA' }));
  return {
    operation: 'BatchGetItem',
    tables: {
      '#{tableName}': { keys: keys }
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const assignments = ctx.stash.assignments || [];
  const components = ctx.result.data ? (ctx.result.data['#{tableName}'] || []) : [];
  const componentMap = {};
  for (const comp of components) {
    if (comp && comp.id) componentMap[comp.id] = comp;
  }
  return assignments.map(a => ({
    assignment: {
      id: a.id,
      componentId: a.componentId,
      userId: a.userId,
      assignedAt: a.assignedAt
    },
    component: componentMap[a.componentId] || null
  })).filter(item => item.component !== null);
}
`.trim().replace(/#{tableName}/g, dynamoTable.tableName)),
    });

    // Resolver: Query.listAssignmentsForUser (Pipeline) - Query user assignments → batch get components
    new appsync.Resolver(this, 'ListAssignmentsForUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listAssignmentsForUser',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [queryAssignmentsForUserFn, batchGetAssignmentComponentsFn],
    });

    // Resolver: Query.listAssignmentsForComponent (JS) - Query pk=COMPONENT#id, sk begins_with ASSIGNEE#
    new appsync.Resolver(this, 'ListAssignmentsForComponentResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listAssignmentsForComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'COMPONENT#' + ctx.args.componentId,
        ':sk': 'ASSIGNEE#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    componentId: item.componentId,
    userId: item.userId,
    assignedAt: item.assignedAt
  }));
}
`.trim()),
    });

    // Resolver: Mutation.assignUserToComponent (JS) - TransactWriteItems to validate component exists then create assignment
    new appsync.Resolver(this, 'AssignUserToComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'assignUserToComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  const userId = ctx.args.userId;
  const now = util.time.nowISO8601();
  const id = util.autoId();
  const assignment = {
    pk: 'COMPONENT#' + componentId,
    sk: 'ASSIGNEE#' + userId,
    id: id,
    componentId: componentId,
    userId: userId,
    assignedAt: now,
    gsi1pk: 'USER#' + userId,
    gsi1sk: 'ASSIGNMENT#' + componentId
  };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      // Check that the component exists
      {
        table: '${props.dynamoTable.tableName}',
        operation: 'ConditionCheck',
        key: util.dynamodb.toMapValues({ pk: 'COMPONENT#' + componentId, sk: 'METADATA' }),
        condition: { expression: 'attribute_exists(pk)' }
      },
      // Create the assignment (fail if already assigned)
      {
        table: '${props.dynamoTable.tableName}',
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk: assignment.pk, sk: assignment.sk }),
        attributeValues: util.dynamodb.toMapValues(assignment),
        condition: { expression: 'attribute_not_exists(pk)' }
      }
    ]
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.result && ctx.result.cancellationReasons) {
      const reasons = ctx.result.cancellationReasons;
      if (reasons[0] && reasons[0].type === 'ConditionCheckFailed') {
        util.error('Component not found', 'ComponentNotFound');
      }
      if (reasons[1] && reasons[1].type === 'ConditionCheckFailed') {
        util.error('User is already assigned to this component', 'AssignmentAlreadyExists');
      }
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const componentId = ctx.args.componentId;
  const userId = ctx.args.userId;
  const now = util.time.nowISO8601();
  return { id: util.autoId(), componentId, userId, assignedAt: now };
}
`.trim()),
    });

    // Resolver: Mutation.unassignUserFromComponent (JS) - DeleteItem with existence check
    new appsync.Resolver(this, 'UnassignUserFromComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'unassignUserFromComponent',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  const userId = ctx.args.userId;
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#' + userId
    }),
    condition: { expression: 'attribute_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Assignment not found', 'AssignmentNotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // ========== ACTIVITY & NOTIFICATION RESOLVERS ==========

    // Resolver: Query.listActivitiesForProject (JS) - Query pk=PROJECT#id, sk begins_with ACTIVITY#
    new appsync.Resolver(this, 'ListActivitiesForProjectResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listActivitiesForProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const limit = ctx.args.limit || 50;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'PROJECT#' + ctx.args.projectId,
        ':sk': 'ACTIVITY#'
      })
    },
    scanIndexForward: false,
    limit: limit
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    type: item.type,
    projectId: item.projectId,
    userId: item.userId,
    metadata: item.metadata ? JSON.stringify(item.metadata) : null,
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Pipeline function: Query notifications and compute read status using timestamp
    const queryNotificationsWithReadStatusFn = new appsync.AppsyncFunction(this, 'QueryNotificationsWithReadStatusFn', {
      name: 'queryNotificationsWithReadStatus',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  const limit = ctx.args.limit || 50;
  const unreadOnly = ctx.args.unreadOnly || false;
  const readUntil = ctx.stash.notificationsReadUntil;

  // If unreadOnly is true, use sort key range to get only notifications after readUntil
  if (unreadOnly) {
    return {
      operation: 'Query',
      query: {
        expression: 'pk = :pk AND sk > :sk',
        expressionValues: util.dynamodb.toMapValues({
          ':pk': 'USER#' + userId,
          ':sk': 'NOTIFICATION#' + readUntil
        })
      },
      scanIndexForward: false,
      limit: limit
    };
  }

  // Otherwise, get all notifications
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'NOTIFICATION#'
      })
    },
    scanIndexForward: false,
    limit: limit
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const readUntil = ctx.stash.notificationsReadUntil;
  // Compute read status: notification is read if createdAt <= readUntil OR if explicitly marked read
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    userId: item.userId,
    type: item.type,
    title: item.title,
    message: item.message,
    componentId: item.componentId || null,
    projectId: item.projectId || null,
    read: item.read === true || (item.createdAt && item.createdAt <= readUntil),
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Pipeline function: Get user's notificationsReadUntil timestamp (shared by multiple resolvers)
    const getUserReadUntilFn = new appsync.AppsyncFunction(this, 'GetUserReadUntilFn', {
      name: 'getUserReadUntil',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  ctx.stash.userId = userId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // Store the timestamp; if not set, use epoch start so all notifications count
  ctx.stash.notificationsReadUntil = ctx.result?.notificationsReadUntil || '1970-01-01T00:00:00.000Z';
  return ctx.result;
}
`.trim()),
    });

    // Resolver: Query.listNotificationsForUser (Pipeline) - Uses timestamp for read status computation
    // AWS best practice: computes read status from timestamp instead of storing boolean per notification
    new appsync.Resolver(this, 'ListNotificationsForUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listNotificationsForUser',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [getUserReadUntilFn, queryNotificationsWithReadStatusFn],
    });

    // Pipeline function: Count notifications after notificationsReadUntil timestamp
    const countNotificationsAfterFn = new appsync.AppsyncFunction(this, 'CountNotificationsAfterFn', {
      name: 'countNotificationsAfter',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  const readUntil = ctx.stash.notificationsReadUntil;
  // Query notifications created AFTER the readUntil timestamp
  // sk format is NOTIFICATION#createdAt#id, so we use > to get newer ones
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND sk > :sk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'NOTIFICATION#' + readUntil
      })
    },
    select: 'COUNT'
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.count || 0;
}
`.trim()),
    });

    // Resolver: Query.countUnreadNotifications (Pipeline) - Uses timestamp for O(1) counting
    // AWS best practice: uses sort key range query instead of filter expression
    new appsync.Resolver(this, 'CountUnreadNotificationsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'countUnreadNotifications',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [getUserReadUntilFn, countNotificationsAfterFn],
    });

    // Pipeline function to update notification read status
    const updateNotificationReadFn = new appsync.AppsyncFunction(this, 'UpdateNotificationReadFn', {
      name: 'updateNotificationRead',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const notification = ctx.stash.notification || ctx.prev.result;
  if (!notification) {
    util.error('Notification not found', 'NotificationNotFound');
  }
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: notification.pk, sk: notification.sk }),
    update: {
      expression: 'SET #read = :readVal',
      expressionNames: { '#read': 'read' },
      expressionValues: util.dynamodb.toMapValues({ ':readVal': true })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`.trim()),
    });

    // Override markNotificationRead to use pipeline
    // Note: We need to make this a pipeline resolver, so let's create the find function first
    const findNotificationFn = new appsync.AppsyncFunction(this, 'FindNotificationFn', {
      name: 'findNotification',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const notificationId = ctx.args.notificationId;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'NOTIFICATION#'
      })
    },
    filter: {
      expression: 'id = :id',
      expressionValues: util.dynamodb.toMapValues({ ':id': notificationId })
    },
    limit: 1
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  if (items.length === 0) {
    util.error('Notification not found', 'NotificationNotFound');
  }
  ctx.stash.notification = items[0];
  return items[0];
}
`.trim()),
    });

    // Resolver: Mutation.markNotificationRead (Pipeline)
    new appsync.Resolver(this, 'MarkNotificationReadPipelineResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'markNotificationRead',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) {
  const notification = ctx.stash.notification;
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    componentId: notification.componentId || null,
    projectId: notification.projectId || null,
    read: true,
    createdAt: notification.createdAt
  };
}
`.trim()),
      pipelineConfig: [findNotificationFn, updateNotificationReadFn],
    });

    // Resolver: Mutation.markAllNotificationsRead (JS) - O(1) timestamp-based approach (AWS best practice)
    // Instead of updating each notification, we update the user's notificationsReadUntil timestamp
    // Any notification with createdAt <= notificationsReadUntil is considered read
    new appsync.Resolver(this, 'MarkAllNotificationsReadResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'markAllNotificationsRead',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const now = util.time.nowISO8601();
  // O(1) operation: just update the user's notificationsReadUntil timestamp
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET #notificationsReadUntil = :now, #updatedAt = :now',
      expressionNames: {
        '#notificationsReadUntil': 'notificationsReadUntil',
        '#updatedAt': 'updatedAt'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':now': now
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // Return 0 as we no longer track individual notification updates
  // The frontend should refresh the notification list after this call
  return 0;
}
`.trim()),
    });

    // ==================== Phase 9: Workflow Config & Metrics ====================
    // AWS Best Practices Applied:
    // - Direct DynamoDB GetItem for O(1) config reads (no Lambda overhead)
    // - Direct DynamoDB UpdateItem for O(1) config writes
    // - Pipeline Resolver with Query operations (not Scan) for metrics aggregation

    // Resolver: Query.getTeamWorkflowConfig (JS) - Direct DynamoDB GetItem
    new appsync.Resolver(this, 'GetTeamWorkflowConfigResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getTeamWorkflowConfig',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + ctx.args.teamId,
      sk: 'WORKFLOW_CONFIG'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) return null;
  return {
    id: ctx.result.id,
    teamId: ctx.result.teamId,
    wipLimitPlanning: ctx.result.wipLimitPlanning || null,
    wipLimitInProgress: ctx.result.wipLimitInProgress || null,
    wipLimitBlocked: ctx.result.wipLimitBlocked || null,
    wipLimitReview: ctx.result.wipLimitReview || null,
    cycleEnabled: ctx.result.cycleEnabled || false,
    cycleDurationWeeks: ctx.result.cycleDurationWeeks || null,
    cycleStartDayOfWeek: ctx.result.cycleStartDayOfWeek || null,
    cycleName: ctx.result.cycleName || 'Sprint',
    backlogName: ctx.result.backlogName || 'Backlog',
    workflowTemplate: ctx.result.workflowTemplate || 'CUSTOM',
    enforceEstimates: ctx.result.enforceEstimates || false,
    autoArchiveCompleted: ctx.result.autoArchiveCompleted || false,
    createdAt: ctx.result.createdAt,
    updatedAt: ctx.result.updatedAt
  };
}
`.trim()),
    });

    // Resolver: Mutation.updateTeamWorkflowConfig (JS) - Direct DynamoDB UpdateItem with if_not_exists
    new appsync.Resolver(this, 'UpdateTeamWorkflowConfigResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'updateTeamWorkflowConfig',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  const input = ctx.args.input;
  const now = util.time.nowISO8601();
  const id = util.autoId();

  // Build update expression with if_not_exists for id, teamId, createdAt
  let setExpressions = [
    '#id = if_not_exists(#id, :id)',
    '#teamId = if_not_exists(#teamId, :teamIdVal)',
    '#createdAt = if_not_exists(#createdAt, :now)',
    '#updatedAt = :now'
  ];
  const expressionNames = {
    '#id': 'id',
    '#teamId': 'teamId',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt'
  };
  const expressionValues = {
    ':id': id,
    ':teamIdVal': teamId,
    ':now': now
  };

  // Add input fields
  if (input.wipLimitPlanning !== undefined && input.wipLimitPlanning !== null) {
    setExpressions.push('#wipLimitPlanning = :wipLimitPlanning');
    expressionNames['#wipLimitPlanning'] = 'wipLimitPlanning';
    expressionValues[':wipLimitPlanning'] = input.wipLimitPlanning;
  }
  if (input.wipLimitInProgress !== undefined && input.wipLimitInProgress !== null) {
    setExpressions.push('#wipLimitInProgress = :wipLimitInProgress');
    expressionNames['#wipLimitInProgress'] = 'wipLimitInProgress';
    expressionValues[':wipLimitInProgress'] = input.wipLimitInProgress;
  }
  if (input.wipLimitBlocked !== undefined && input.wipLimitBlocked !== null) {
    setExpressions.push('#wipLimitBlocked = :wipLimitBlocked');
    expressionNames['#wipLimitBlocked'] = 'wipLimitBlocked';
    expressionValues[':wipLimitBlocked'] = input.wipLimitBlocked;
  }
  if (input.wipLimitReview !== undefined && input.wipLimitReview !== null) {
    setExpressions.push('#wipLimitReview = :wipLimitReview');
    expressionNames['#wipLimitReview'] = 'wipLimitReview';
    expressionValues[':wipLimitReview'] = input.wipLimitReview;
  }
  if (input.cycleEnabled !== undefined && input.cycleEnabled !== null) {
    setExpressions.push('#cycleEnabled = :cycleEnabled');
    expressionNames['#cycleEnabled'] = 'cycleEnabled';
    expressionValues[':cycleEnabled'] = input.cycleEnabled;
  }
  if (input.cycleDurationWeeks !== undefined && input.cycleDurationWeeks !== null) {
    setExpressions.push('#cycleDurationWeeks = :cycleDurationWeeks');
    expressionNames['#cycleDurationWeeks'] = 'cycleDurationWeeks';
    expressionValues[':cycleDurationWeeks'] = input.cycleDurationWeeks;
  }
  if (input.cycleStartDayOfWeek !== undefined && input.cycleStartDayOfWeek !== null) {
    setExpressions.push('#cycleStartDayOfWeek = :cycleStartDayOfWeek');
    expressionNames['#cycleStartDayOfWeek'] = 'cycleStartDayOfWeek';
    expressionValues[':cycleStartDayOfWeek'] = input.cycleStartDayOfWeek;
  }
  if (input.cycleName !== undefined && input.cycleName !== null) {
    setExpressions.push('#cycleName = :cycleName');
    expressionNames['#cycleName'] = 'cycleName';
    expressionValues[':cycleName'] = input.cycleName;
  }
  if (input.backlogName !== undefined && input.backlogName !== null) {
    setExpressions.push('#backlogName = :backlogName');
    expressionNames['#backlogName'] = 'backlogName';
    expressionValues[':backlogName'] = input.backlogName;
  }
  if (input.workflowTemplate !== undefined && input.workflowTemplate !== null) {
    setExpressions.push('#workflowTemplate = :workflowTemplate');
    expressionNames['#workflowTemplate'] = 'workflowTemplate';
    expressionValues[':workflowTemplate'] = input.workflowTemplate;
  }
  if (input.enforceEstimates !== undefined && input.enforceEstimates !== null) {
    setExpressions.push('#enforceEstimates = :enforceEstimates');
    expressionNames['#enforceEstimates'] = 'enforceEstimates';
    expressionValues[':enforceEstimates'] = input.enforceEstimates;
  }
  if (input.autoArchiveCompleted !== undefined && input.autoArchiveCompleted !== null) {
    setExpressions.push('#autoArchiveCompleted = :autoArchiveCompleted');
    expressionNames['#autoArchiveCompleted'] = 'autoArchiveCompleted';
    expressionValues[':autoArchiveCompleted'] = input.autoArchiveCompleted;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'WORKFLOW_CONFIG'
    }),
    update: {
      expression: 'SET ' + setExpressions.join(', '),
      expressionNames: expressionNames,
      expressionValues: util.dynamodb.toMapValues(expressionValues)
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const r = ctx.result;
  return {
    id: r.id,
    teamId: r.teamId,
    wipLimitPlanning: r.wipLimitPlanning || null,
    wipLimitInProgress: r.wipLimitInProgress || null,
    wipLimitBlocked: r.wipLimitBlocked || null,
    wipLimitReview: r.wipLimitReview || null,
    cycleEnabled: r.cycleEnabled || false,
    cycleDurationWeeks: r.cycleDurationWeeks || null,
    cycleStartDayOfWeek: r.cycleStartDayOfWeek || null,
    cycleName: r.cycleName || 'Sprint',
    backlogName: r.backlogName || 'Backlog',
    workflowTemplate: r.workflowTemplate || 'CUSTOM',
    enforceEstimates: r.enforceEstimates || false,
    autoArchiveCompleted: r.autoArchiveCompleted || false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}
`.trim()),
    });

    // Resolver: Query.getTeamMetrics (Lambda) - Uses Lambda for reliable metrics computation
    new appsync.Resolver(this, 'GetTeamMetricsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getTeamMetrics',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
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

    // Resolver: Mutation.generateFullPlan (Lambda) - workflow-aware AI generation with context
    new appsync.Resolver(this, 'GenerateFullPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateFullPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.applyFullPlan (Lambda) - atomic plan application with saga pattern
    new appsync.Resolver(this, 'ApplyFullPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'applyFullPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.refineComponent (Lambda) - chat-based single component refinement
    new appsync.Resolver(this, 'RefineComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'refineComponent',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.refineBulkPlan (Lambda) - chat-based bulk plan refinement
    new appsync.Resolver(this, 'RefineBulkPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'refineBulkPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.createSmartComponent (Lambda) - natural language component creation
    new appsync.Resolver(this, 'CreateSmartComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createSmartComponent',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.planSprint (Lambda) - AI sprint planning
    new appsync.Resolver(this, 'PlanSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'planSprint',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // ============================================
    // Phase 1-5: New AI Feature Resolvers
    // ============================================

    // Resolver: Mutation.applyTemplate (Lambda) - Template application
    new appsync.Resolver(this, 'ApplyTemplateResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'applyTemplate',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.suggestBreakdown (Lambda) - Component breakdown
    new appsync.Resolver(this, 'SuggestBreakdownResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'suggestBreakdown',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateWireframe (Lambda) - Wireframe generation
    new appsync.Resolver(this, 'GenerateWireframeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateWireframe',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.analyzeImportData (Lambda) - Import analysis
    new appsync.Resolver(this, 'AnalyzeImportDataResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'analyzeImportData',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.cleanupImportData (Lambda) - Import cleanup
    new appsync.Resolver(this, 'CleanupImportDataResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'cleanupImportData',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateRetrospective (Lambda) - Retrospective generation
    new appsync.Resolver(this, 'GenerateRetrospectiveResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateRetrospective',
      dataSource: lambdaDs,
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest('$util.toJson($ctx.arguments.input)'),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // ============================================
    // Async AI Generation Resolvers (bypass 30s timeout)
    // Pattern: startAIGeneration -> async Lambda -> publishAIProgress -> subscription
    // ============================================

    // None data source for publishAIProgress (subscription trigger)
    const noneDs = this.api.addNoneDataSource('NoneDataSource');

    // Resolver: Mutation.startAIGeneration - async Lambda invocation
    // Returns sessionId immediately, Lambda processes in background
    new appsync.Resolver(this, 'StartAIGenerationResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'startAIGeneration',
      dataSource: lambdaDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
        export function request(ctx) {
          const sessionId = util.autoId();
          // Store sessionId in stash for response function
          ctx.stash.sessionId = sessionId;
          return {
            operation: 'Invoke',
            invocationType: 'Event',
            payload: {
              type: 'startAIGeneration',
              sessionId: sessionId,
              projectId: ctx.arguments.input.projectId,
              generateEpics: ctx.arguments.input.generateEpics || false,
              graphqlUrl: '${this.api.graphqlUrl}',
            },
          };
        }
        export function response(ctx) {
          // Return immediately with sessionId (Lambda runs async)
          // Get sessionId from stash (stored in request function)
          return {
            sessionId: ctx.stash.sessionId,
            status: 'PENDING',
            createdAt: util.time.nowISO8601(),
          };
        }
      `),
    });

    // Resolver: Mutation.publishAIProgress - triggers subscription
    // Lambda calls this to publish progress updates
    new appsync.Resolver(this, 'PublishAIProgressResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'publishAIProgress',
      dataSource: noneDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
        export function request(ctx) {
          return { payload: ctx.arguments };
        }
        export function response(ctx) {
          return {
            sessionId: ctx.arguments.sessionId,
            progress: ctx.arguments.progress,
            message: ctx.arguments.message,
            status: ctx.arguments.status,
            result: ctx.arguments.result,
            error: ctx.arguments.error,
          };
        }
      `),
    });

    // ============================================
    // Share Code / Guest Access Resolvers
    // AWS Best Practice: Cognito Identity Pool + IAM auth for guests
    // ============================================

    // Resolver: Query.validateShareCode (API_KEY auth) - Check if code is valid
    new appsync.Resolver(this, 'ValidateShareCodeResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'validateShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + ctx.args.code.toUpperCase(),
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const item = ctx.result;
  if (!item) {
    return { valid: false };
  }
  // Check if code has expired (TTL is in Unix seconds)
  const now = Math.floor(Date.now() / 1000);
  if (item.ttl && item.ttl < now) {
    return { valid: false };
  }
  return {
    valid: true,
    projectId: item.projectId,
    projectName: item.projectName || null,
    teamId: item.teamId,
    teamName: item.teamName || null,
    expiresAt: item.expiresAt
  };
}
`.trim()),
    });

    // Resolver: Mutation.generateShareCode (Cognito auth) - Generate share code for project
    new appsync.Resolver(this, 'GenerateShareCodeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const input = ctx.args.input;
  const projectId = input.projectId;
  
  // Generate 6-character alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Calculate expiration (default 7 days, max 30 days)
  const expiresInHours = Math.min(input.expiresInHours || 168, 720);
  const now = util.time.nowEpochSeconds();
  const ttl = now + (expiresInHours * 3600);
  const expiresAt = util.time.epochSecondsToISO8601(ttl);
  const createdAt = util.time.nowISO8601();
  
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + code,
      sk: 'METADATA'
    }),
    attributeValues: util.dynamodb.toMapValues({
      code: code,
      projectId: projectId,
      teamId: ctx.stash.teamId || '', // Will be set in pipeline if needed
      createdBy: userId,
      ttl: ttl,
      expiresAt: expiresAt,
      createdAt: createdAt
    }),
    condition: {
      expression: 'attribute_not_exists(pk)'
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    // Code collision - retry would be needed in production
    util.error(ctx.error.message, ctx.error.type);
  }
  const item = ctx.result;
  return {
    code: item.code,
    projectId: item.projectId,
    teamId: item.teamId,
    expiresAt: item.expiresAt,
    createdAt: item.createdAt
  };
}
`.trim()),
    });

    // Resolver: Mutation.revokeShareCode (Cognito auth) - Delete share code
    new appsync.Resolver(this, 'RevokeShareCodeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'revokeShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + ctx.args.code.toUpperCase(),
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.guestJoinProject (IAM auth) - Create guest user and membership
    new appsync.Resolver(this, 'GuestJoinProjectResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestJoinProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const code = input.code.toUpperCase();
  const displayName = input.displayName;
  const guestId = util.autoId();
  const now = util.time.nowISO8601();
  
  // First, validate the code exists
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + code,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const codeItem = ctx.result;
  if (!codeItem) {
    util.error('Invalid share code', 'InvalidShareCode');
  }
  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (codeItem.ttl && codeItem.ttl < now) {
    util.error('Share code has expired', 'ExpiredShareCode');
  }
  // Store info for next step (would be pipeline resolver in production)
  return {
    guestId: util.autoId(),
    displayName: ctx.args.input.displayName,
    projectId: codeItem.projectId,
    teamId: codeItem.teamId
  };
}
`.trim()),
    });

    // Resolver: Query.guestGetProject (IAM auth) - Get project for guest
    new appsync.Resolver(this, 'GuestGetProjectResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestGetProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  // First verify guest exists and get their projectId
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const guest = ctx.result;
  if (!guest) {
    util.error('Guest not found', 'GuestNotFound');
  }
  // Return project info from guest record
  // In production, would do a second query for full project data
  return {
    id: guest.projectId,
    name: guest.projectName || 'Project',
    teamId: guest.teamId
  };
}
`.trim()),
    });

    // Resolver: Query.guestListComponents (IAM auth) - List components for guest's project
    new appsync.Resolver(this, 'GuestListComponentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListComponents',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  // First verify guest and get projectId
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const guest = ctx.result;
  if (!guest) {
    util.error('Guest not found', 'GuestNotFound');
  }
  // Store projectId for component query
  // In production, this would be a pipeline resolver
  ctx.stash.projectId = guest.projectId;
  return [];
}
`.trim()),
    });

    // Resolver: Query.guestListAssignments (IAM auth) - List guest's assignments
    new appsync.Resolver(this, 'GuestListAssignmentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListAssignments',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  // Query GSI1 for guest's assignments
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'GUEST#' + guestId,
        ':sk': 'ASSIGNMENT#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  // Map to AssignmentWithComponent format
  return (ctx.result.items || []).map(item => ({
    assignment: {
      id: item.id,
      componentId: item.componentId,
      userId: item.guestId,
      assignedAt: item.assignedAt
    },
    component: item.component || { id: item.componentId, name: 'Component' }
  }));
}
`.trim()),
    });

    // Resolver: Mutation.guestAssignSelf (IAM auth) - Guest assigns self to component
    new appsync.Resolver(this, 'GuestAssignSelfResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestAssignSelf',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  const assignmentId = util.autoId();
  const now = util.time.nowISO8601();
  
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#GUEST#' + guestId
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: assignmentId,
      componentId: componentId,
      guestId: guestId,
      assignedAt: now,
      isGuest: true,
      gsi1pk: 'GUEST#' + guestId,
      gsi1sk: 'ASSIGNMENT#' + componentId
    }),
    condition: {
      expression: 'attribute_not_exists(pk)'
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Already assigned to this component', 'AlreadyAssigned');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const item = ctx.result;
  return {
    id: item.id,
    componentId: item.componentId,
    userId: item.guestId,
    assignedAt: item.assignedAt
  };
}
`.trim()),
    });

    // Resolver: Mutation.guestUnassignSelf (IAM auth) - Guest removes self from component
    new appsync.Resolver(this, 'GuestUnassignSelfResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestUnassignSelf',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#GUEST#' + guestId
    }),
    condition: {
      expression: 'attribute_exists(pk)'
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Not assigned to this component', 'NotAssigned');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
`.trim()),
    });

    // Resolver: Mutation.guestUpdateStatus (IAM auth) - Guest updates component status
    new appsync.Resolver(this, 'GuestUpdateStatusResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestUpdateStatus',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  const status = ctx.args.status;
  const now = util.time.nowISO8601();
  
  // Update component status
  // In production, would first verify guest is assigned to this component
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET #status = :status, #updatedAt = :now',
      expressionNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':status': status,
        ':now': now
      })
    }
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

    // Resolver: Query.listAssignmentsForTeamMember (Cognito auth) - Owner views member's assignments
    new appsync.Resolver(this, 'ListAssignmentsForTeamMemberResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listAssignmentsForTeamMember',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.args.userId;
  // Query GSI1 for user's assignments
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'ASSIGNMENT#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  // Map to AssignmentWithComponent format
  // In production, would batch-get component details
  return (ctx.result.items || []).map(item => ({
    assignment: {
      id: item.id,
      componentId: item.componentId,
      userId: item.userId,
      assignedAt: item.assignedAt
    },
    component: {
      id: item.componentId,
      name: item.componentName || 'Component',
      status: item.componentStatus || 'PLANNING',
      type: item.componentType || 'TASK',
      projectId: item.projectId
    }
  }));
}
`.trim()),
    });

    new CfnOutput(this, 'GraphQLApiUrl', {
      value: this.api.graphqlUrl,
      description: 'AppSync GraphQL API URL (us-east-2)',
    });
    new CfnOutput(this, 'GraphQLApiId', {
      value: this.api.apiId,
      description: 'AppSync GraphQL API ID',
    });
    new CfnOutput(this, 'GraphQLApiKey', {
      value: this.api.apiKey || '',
      description: 'AppSync API Key for unauthenticated operations (registerUser)',
    });
  }
}
