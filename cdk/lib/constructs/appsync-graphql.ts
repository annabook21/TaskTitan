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

    // ============================================
    // AWS Best Practice: Lambda Request Templates with Operation Name
    // Include $ctx.info.fieldName for explicit routing instead of fragile shape-based type guards
    // ============================================

    // VTL template for mutations with input wrapper (e.g., $ctx.arguments.input)
    const lambdaRequestWithOperation = (useInput: boolean = true) =>
      appsync.MappingTemplate.fromString(`
#set($inputMap = ${useInput ? '$ctx.arguments.input' : '$ctx.arguments'})
$util.qr($inputMap.put("__operation", "$ctx.info.fieldName"))
{
  "version": "2017-02-28",
  "operation": "Invoke",
  "payload": $util.toJson($inputMap)
}
`.trim());

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

    // Lambda for user deletion (AdminDeleteUser - removes user from Cognito)
    // AWS Documentation: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteUser.html
    const deleteUserLambda = new lambdaNode.NodejsFunction(this, 'DeleteUserHandler', {
      entry: join(__dirname, 'appsync-graphql', 'delete-user-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        USER_POOL_ID: auth.userPool.userPoolId,
      },
    });

    // Grant Cognito AdminDeleteUser permission
    auth.userPool.grant(deleteUserLambda, 'cognito-idp:AdminDeleteUser');

    // Lambda data source for user deletion
    const deleteUserDs = this.api.addLambdaDataSource('DeleteUserLambda', deleteUserLambda);

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

    // ============================================
    // PIPELINE RESOLVER: deleteCurrentUser
    // Step 1: Query user's team memberships
    // Step 2: Delete memberships and user record
    // ============================================

    // Function 1: Query user's memberships from GSI1
    const queryUserMembershipsFn = new appsync.AppsyncFunction(this, 'QueryUserMembershipsFn', {
      api: this.api,
      name: 'queryUserMemberships',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  ctx.stash.userId = userId;

  // Query GSI1 for user's team memberships (gsi1pk=USER#userId, gsi1sk begins_with TEAM#)
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'USER#' + userId,
        ':sk': 'TEAM#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const memberships = ctx.result.items || [];
  ctx.stash.memberships = memberships;
  return memberships;
}
`.trim()),
    });

    // Function 2: Delete user record and all memberships
    const deleteUserAndMembershipsFn = new appsync.AppsyncFunction(this, 'DeleteUserAndMembershipsFn', {
      api: this.api,
      name: 'deleteUserAndMemberships',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  const memberships = ctx.stash.memberships || [];

  // Build delete requests for user record and all memberships
  const deleteRequests = [];

  // Delete user record
  deleteRequests.push({
    table: '${dynamoTable.tableName}',
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({ pk: 'USER#' + userId, sk: 'METADATA' })
  });

  // Delete each membership (up to 99 more to stay under 100 item limit)
  for (const membership of memberships.slice(0, 99)) {
    deleteRequests.push({
      table: '${dynamoTable.tableName}',
      operation: 'DeleteItem',
      key: util.dynamodb.toMapValues({ pk: membership.pk, sk: membership.sk })
    });
  }

  return {
    operation: 'TransactWriteItems',
    transactItems: deleteRequests
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

    // Function 3: Delete user from Cognito (Lambda)
    // AWS Best Practice: Use Lambda for admin SDK operations
    const deleteCognitoUserFn = new appsync.AppsyncFunction(this, 'DeleteCognitoUserFn', {
      api: this.api,
      name: 'deleteCognitoUser',
      dataSource: deleteUserDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  return {
    operation: 'Invoke',
    payload: { userId: userId }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const result = ctx.result;
  if (!result.success) {
    util.error(result.message, 'CognitoDeleteFailed');
  }
  return true;
}
`.trim()),
    });

    // Pipeline Resolver: deleteCurrentUser
    // Step 1: Query user's memberships
    // Step 2: Delete DynamoDB records (user + memberships)
    // Step 3: Delete Cognito user (prevents future sign-in)
    new appsync.Resolver(this, 'DeleteCurrentUserResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'deleteCurrentUser',
      pipelineConfig: [queryUserMembershipsFn, deleteUserAndMembershipsFn, deleteCognitoUserFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
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

    // Function 2: Batch get team metadata
    // AWS Best Practice: Use denormalized memberCount on team metadata for aggregates
    // DynamoDB Query only supports single partition key, so we can't query all members
    // across multiple teams efficiently. Instead, we rely on the memberCount field.
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html
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
  // Deduplicate team IDs to avoid BatchGetItem "duplicate keys" error
  const seenTeamIds = {};
  const uniqueTeamIds = [];
  for (const m of memberships) {
    if (!seenTeamIds[m.teamId]) {
      seenTeamIds[m.teamId] = true;
      uniqueTeamIds.push(m.teamId);
    }
  }
  // BatchGetItem format per AWS docs: tables: { tableName: { keys: [...] } }
  const keys = uniqueTeamIds.map(teamId => util.dynamodb.toMapValues({ pk: 'TEAM#' + teamId, sk: 'METADATA' }));
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
  // Group user's memberships by team (for showing user's role)
  // Members array contains only current user's membership - use team.memberCount for total
  const teamMemberMap = {};
  for (const m of memberships) {
    if (!teamMemberMap[m.teamId]) {
      teamMemberMap[m.teamId] = [];
    }
    teamMemberMap[m.teamId].push(m);
  }
  return Object.keys(teamMemberMap).map(teamId => ({
    team: teamMap[teamId] || { id: teamId, name: 'Unknown' },
    members: teamMemberMap[teamId]
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
    memberCount: 1,
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
  const team = { id: input.id, name: input.name, description: input.description || null, memberCount: 1, createdAt: now, updatedAt: now };
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

    // ============================================
    // PIPELINE RESOLVER: deleteTeam
    // Step 1: Verify user is team OWNER
    // Step 2: Query all team items (metadata, members, invites, etc.)
    // Step 3: Batch delete all items
    // ============================================

    // Function 1: Verify user is team OWNER and query team items
    const verifyOwnerAndQueryTeamFn = new appsync.AppsyncFunction(this, 'VerifyOwnerAndQueryTeamFn', {
      api: this.api,
      name: 'verifyOwnerAndQueryTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  const userId = ctx.identity.sub;

  ctx.stash.teamId = teamId;
  ctx.stash.userId = userId;

  // Query all items with pk=TEAM#teamId to get members and verify ownership
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
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const items = ctx.result.items || [];
  if (items.length === 0) {
    util.error('Team not found', 'TeamNotFound');
  }

  // Find the user's membership and verify they are OWNER
  const userId = ctx.stash.userId;
  const userMembership = items.find(item => item.sk === 'MEMBER#' + userId);

  if (!userMembership) {
    util.error('You are not a member of this team', 'Unauthorized');
  }

  if (userMembership.role !== 'OWNER') {
    util.error('Only the team owner can delete the team', 'Unauthorized');
  }

  // Store items for deletion in next step
  ctx.stash.itemsToDelete = items;
  return items;
}
`.trim()),
    });

    // Function 2: Query team invites for deletion
    const queryTeamInvitesForDeleteFn = new appsync.AppsyncFunction(this, 'QueryTeamInvitesForDeleteFn', {
      api: this.api,
      name: 'queryTeamInvitesForDelete',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;

  // Query GSI1 for team invites (gsi1pk=TEAM#teamId, gsi1sk begins_with INVITE#)
  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + teamId,
        ':sk': 'INVITE#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const invites = ctx.result.items || [];
  // Add invites to items to delete
  ctx.stash.itemsToDelete = [...(ctx.stash.itemsToDelete || []), ...invites];
  return invites;
}
`.trim()),
    });

    // Function 3: Batch delete all team items
    const batchDeleteTeamItemsFn = new appsync.AppsyncFunction(this, 'BatchDeleteTeamItemsFn', {
      api: this.api,
      name: 'batchDeleteTeamItems',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const items = ctx.stash.itemsToDelete || [];

  if (items.length === 0) {
    // Nothing to delete
    return { operation: 'Query', query: { expression: 'pk = :pk', expressionValues: util.dynamodb.toMapValues({ ':pk': 'NONE' }) } };
  }

  // DynamoDB TransactWriteItems can handle up to 100 items per request
  // For larger teams (100+ items), you'd need pagination or a Lambda function
  const deleteRequests = items.slice(0, 100).map(item => ({
    table: '${dynamoTable.tableName}',
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({ pk: item.pk, sk: item.sk })
  }));

  return {
    operation: 'TransactWriteItems',
    transactItems: deleteRequests
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

    // Pipeline Resolver: deleteTeam
    new appsync.Resolver(this, 'DeleteTeamResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'deleteTeam',
      pipelineConfig: [verifyOwnerAndQueryTeamFn, queryTeamInvitesForDeleteFn, batchDeleteTeamItemsFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Mutation.addTeamMember (JS) - TransactWrite: PutItem Membership + Increment memberCount
    // AWS Best Practice: Use TransactWriteItems for atomic multi-item operations
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
  ctx.stash.membership = membership;
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: '${dynamoTable.tableName}',
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk: membership.pk, sk: membership.sk }),
        attributeValues: util.dynamodb.toMapValues(membership),
        condition: { expression: 'attribute_not_exists(pk)' }
      },
      {
        table: '${dynamoTable.tableName}',
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk: 'TEAM#' + input.teamId, sk: 'METADATA' }),
        update: {
          expression: 'SET memberCount = if_not_exists(memberCount, :zero) + :one',
          expressionValues: util.dynamodb.toMapValues({ ':zero': 0, ':one': 1 })
        }
      }
    ]
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException' ||
        ctx.error.message.includes('ConditionalCheckFailed')) {
      util.error('Member already exists in team', 'MemberAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.stash.membership;
}
`.trim()),
    });

    // Resolver: Mutation.removeTeamMember (JS) - TransactWrite: DeleteItem Membership + Decrement memberCount
    // AWS Best Practice: Use TransactWriteItems for atomic multi-item operations
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
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: '${dynamoTable.tableName}',
        operation: 'DeleteItem',
        key: util.dynamodb.toMapValues({
          pk: 'TEAM#' + teamId,
          sk: 'MEMBER#' + userId
        }),
        condition: { expression: 'attribute_exists(pk)' }
      },
      {
        table: '${dynamoTable.tableName}',
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk: 'TEAM#' + teamId, sk: 'METADATA' }),
        update: {
          expression: 'SET memberCount = if_not_exists(memberCount, :one) - :one',
          expressionValues: util.dynamodb.toMapValues({ ':one': 1 })
        }
      }
    ]
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException' ||
        ctx.error.message.includes('ConditionalCheckFailed')) {
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

  const fields = ['name', 'description', 'type', 'parentId', 'sprintId', 'status', 'priority', 'estimatedHours', 'actualHours', 'dueDate', 'owner', 'tags', 'acceptanceCriteria'];
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

    // ============================================
    // SPRINT STATUS PIPELINE FUNCTIONS
    // AWS Best Practice: Authorization + Activity Logging
    // ============================================

    // Function: Get sprint and store teamId for authorization
    const getSprintForAuthFn = new appsync.AppsyncFunction(this, 'GetSprintForAuthFn', {
      api: this.api,
      name: 'getSprintForAuth',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  ctx.stash.userId = ctx.identity.sub;
  ctx.stash.sprintId = ctx.args.id;
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
  if (!ctx.result) util.error('Sprint not found', 'SprintNotFound');
  ctx.stash.sprint = ctx.result;
  ctx.stash.teamId = ctx.result.teamId;
  return ctx.result;
}
`.trim()),
    });

    // Function: Verify user is team member with adequate role for sprint operations
    const verifyTeamMemberForSprintFn = new appsync.AppsyncFunction(this, 'VerifyTeamMemberForSprintFn', {
      api: this.api,
      name: 'verifyTeamMemberForSprint',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + ctx.stash.teamId,
      sk: 'MEMBER#' + ctx.stash.userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Access denied: not a team member', 'Unauthorized');
  const role = ctx.result.role;
  // Allow OWNER, ADMIN, MEMBER - deny VIEWER and GUEST
  if (role === 'VIEWER' || role === 'GUEST') {
    util.error('Access denied: insufficient permissions to modify sprint status', 'Unauthorized');
  }
  ctx.stash.membership = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    // Function: Update sprint status to ACTIVE (start)
    const startSprintStatusFn = new appsync.AppsyncFunction(this, 'StartSprintStatusFn', {
      api: this.api,
      name: 'startSprintStatus',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + ctx.stash.sprintId, sk: 'METADATA' }),
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
  // Set activity data for createSprintActivityFn
  ctx.stash.activityType = 'SPRINT_STARTED';
  ctx.stash.authorId = ctx.stash.userId;
  ctx.stash.activityMetadata = { sprintId: ctx.stash.sprintId, sprintName: ctx.stash.sprint.name };
  ctx.stash.mainResult = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    // Function: Update sprint status to COMPLETED
    const completeSprintStatusFn = new appsync.AppsyncFunction(this, 'CompleteSprintStatusFn', {
      api: this.api,
      name: 'completeSprintStatus',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + ctx.stash.sprintId, sk: 'METADATA' }),
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
  // Set activity data for createSprintActivityFn
  ctx.stash.activityType = 'SPRINT_COMPLETED';
  ctx.stash.authorId = ctx.stash.userId;
  ctx.stash.activityMetadata = { sprintId: ctx.stash.sprintId, sprintName: ctx.stash.sprint.name };
  ctx.stash.mainResult = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    // Function: Update sprint status from COMPLETED back to ACTIVE (reopen)
    const reopenSprintStatusFn = new appsync.AppsyncFunction(this, 'ReopenSprintStatusFn', {
      api: this.api,
      name: 'reopenSprintStatus',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: 'SPRINT#' + ctx.stash.sprintId, sk: 'METADATA' }),
    update: {
      expression: 'SET #status = :status, #updatedAt = :updatedAt',
      expressionNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'ACTIVE', ':updatedAt': now, ':completed': 'COMPLETED' })
    },
    condition: { expression: 'attribute_exists(pk) AND #status = :completed' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Sprint not found or not in COMPLETED status', 'InvalidSprintStatus');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // Set activity data for createSprintActivityFn
  ctx.stash.activityType = 'SPRINT_REOPENED';
  ctx.stash.authorId = ctx.stash.userId;
  ctx.stash.activityMetadata = { sprintId: ctx.stash.sprintId, sprintName: ctx.stash.sprint.name };
  ctx.stash.mainResult = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    // Function: Create activity record for sprint status changes
    // Uses team-scoped activity for sprint operations (not project-scoped)
    const createSprintActivityFn = new appsync.AppsyncFunction(this, 'CreateSprintActivityFn', {
      api: this.api,
      name: 'createSprintActivity',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // Skip if no activity data provided
  if (!ctx.stash.activityType) {
    return { payload: null };
  }

  const activityId = util.autoId();
  const now = util.time.nowISO8601();
  const teamId = ctx.stash.teamId;
  const activityType = ctx.stash.activityType;
  const authorId = ctx.stash.authorId;
  const metadata = ctx.stash.activityMetadata || {};

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'ACTIVITY#' + now + '#' + activityId
    }),
    attributeValues: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'ACTIVITY#' + now + '#' + activityId,
      id: activityId,
      type: activityType,
      teamId: teamId,
      userId: authorId,
      metadata: JSON.stringify(metadata),
      createdAt: now,
      gsi1pk: 'USER#' + authorId,
      gsi1sk: 'ACTIVITY#' + now + '#' + activityId
    })
  };
}
export function response(ctx) {
  // Return the main result (updated sprint) regardless of activity creation outcome
  return ctx.stash.mainResult || ctx.prev.result;
}
`.trim()),
    });

    // Pipeline Resolver: Mutation.startSprint - Auth + Status Update + Activity Log
    new appsync.Resolver(this, 'StartSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'startSprint',
      pipelineConfig: [getSprintForAuthFn, verifyTeamMemberForSprintFn, startSprintStatusFn, createSprintActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
    });

    // Pipeline Resolver: Mutation.completeSprint - Auth + Status Update + Activity Log
    new appsync.Resolver(this, 'CompleteSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'completeSprint',
      pipelineConfig: [getSprintForAuthFn, verifyTeamMemberForSprintFn, completeSprintStatusFn, createSprintActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
    });

    // Pipeline Resolver: Mutation.reopenSprint - Auth + Status Update + Activity Log
    // Allows users to reopen accidentally completed sprints or add more work
    new appsync.Resolver(this, 'ReopenSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'reopenSprint',
      pipelineConfig: [getSprintForAuthFn, verifyTeamMemberForSprintFn, reopenSprintStatusFn, createSprintActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
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
  // Handle both regular user assignments (userId) and guest assignments (guestId)
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    componentId: item.componentId,
    userId: item.userId || item.guestId,
    assignedAt: item.assignedAt,
    isGuest: item.isGuest || false
  }));
}
`.trim()),
    });

    // Resolver: Mutation.assignUserToComponent (Pipeline)
    // Step 1: Fetch component to get name, status, type, projectId for denormalization
    // Step 2: Authorize user (must be project owner or team OWNER/ADMIN)
    // Step 3: Check for existing assignments
    // Step 4: Create assignment with denormalized data
    const getComponentForAssignmentFn = new appsync.AppsyncFunction(this, 'GetComponentForAssignmentFn', {
      api: this.api,
      name: 'getComponentForAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  ctx.stash.componentId = componentId;
  ctx.stash.userId = ctx.args.userId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Component not found', 'ComponentNotFound');
  // Store component data for next function
  ctx.stash.component = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    // AWS Best Practice: Authorization check - verify user is project owner or team admin
    // Fetches project and checks ctx.identity.sub against project.ownerId or team membership role
    const authorizeAssignmentFn = new appsync.AppsyncFunction(this, 'AuthorizeAssignmentFn', {
      api: this.api,
      name: 'authorizeAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const component = ctx.stash.component;
  const projectId = component.projectId;
  
  if (!projectId) {
    util.error('Component has no projectId', 'InvalidComponent');
  }
  
  // Store current user ID for authorization check
  ctx.stash.currentUserId = ctx.identity.sub;
  
  // Fetch project to check ownership
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'PROJECT#' + projectId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Project not found', 'ProjectNotFound');
  
  const project = ctx.result;
  const currentUserId = ctx.stash.currentUserId;
  const component = ctx.stash.component;
  
  // Check 1: Is user the project owner?
  if (project.ownerId === currentUserId) {
    ctx.stash.project = project;
    return ctx.prev.result;
  }
  
  // Check 2: Is user a team OWNER or ADMIN?
  // Store teamId for team membership check in next pipeline step
  ctx.stash.teamId = project.teamId;
  ctx.stash.needsTeamRoleCheck = true;
  ctx.stash.project = project;
  
  return ctx.prev.result;
}
`.trim()),
    });

    // AWS Best Practice: Check team membership role if not project owner
    const checkTeamRoleForAssignmentFn = new appsync.AppsyncFunction(this, 'CheckTeamRoleForAssignmentFn', {
      api: this.api,
      name: 'checkTeamRoleForAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // If user is already authorized as project owner, skip this check
  if (!ctx.stash.needsTeamRoleCheck) {
    return {
      operation: 'GetItem',
      key: util.dynamodb.toMapValues({
        pk: 'SKIP',
        sk: 'SKIP'
      })
    };
  }
  
  const teamId = ctx.stash.teamId;
  const userId = ctx.stash.currentUserId;
  
  // Fetch team membership to check role
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  
  // If we skipped the check (user is project owner), continue
  if (!ctx.stash.needsTeamRoleCheck) {
    return ctx.prev.result;
  }
  
  // User must be a team member with OWNER or ADMIN role
  if (!ctx.result) {
    util.error('Unauthorized: You must be a team member to manage assignments', 'Unauthorized');
  }
  
  const membership = ctx.result;
  const role = membership.role;
  
  if (role !== 'OWNER' && role !== 'ADMIN') {
    util.error('Unauthorized: Only project owners or team admins can manage assignments', 'Unauthorized');
  }
  
  // User is authorized
  return ctx.prev.result;
}
`.trim()),
    });

    // Check for existing assignments before allowing new ones
    const checkNoExistingAssignmentsFn = new appsync.AppsyncFunction(this, 'CheckNoExistingAssignmentsFn', {
      api: this.api,
      name: 'checkNoExistingAssignments',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  // Query for any existing ASSIGNEE# entries for this component
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'COMPONENT#' + componentId,
        ':skPrefix': 'ASSIGNEE#'
      })
    },
    limit: 1
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result.items && ctx.result.items.length > 0) {
    util.error('This component is already assigned to someone', 'ComponentAlreadyAssigned');
  }
  return ctx.prev.result;
}
`.trim()),
    });

    const createAssignmentFn = new appsync.AppsyncFunction(this, 'CreateAssignmentFn', {
      api: this.api,
      name: 'createAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  const userId = ctx.stash.userId;
  const component = ctx.stash.component;
  const now = util.time.nowISO8601();
  const id = util.autoId();

  // Denormalize component data on assignment for efficient queries
  const assignment = {
    pk: 'COMPONENT#' + componentId,
    sk: 'ASSIGNEE#' + userId,
    id: id,
    componentId: componentId,
    userId: userId,
    assignedAt: now,
    gsi1pk: 'USER#' + userId,
    gsi1sk: 'ASSIGNMENT#' + componentId,
    // Denormalized component fields for listAssignmentsForTeamMember
    projectId: component.projectId,
    componentName: component.name,
    componentStatus: component.status,
    componentType: component.type
  };

  ctx.stash.assignment = assignment;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk: assignment.pk, sk: assignment.sk }),
    attributeValues: util.dynamodb.toMapValues(assignment),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('User is already assigned to this component', 'AssignmentAlreadyExists');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  const a = ctx.stash.assignment;
  return { id: a.id, componentId: a.componentId, userId: a.userId, assignedAt: a.assignedAt };
}
`.trim()),
    });

    // Step 4: Update component's owner field to sync with assignment
    const updateComponentOwnerFn = new appsync.AppsyncFunction(this, 'UpdateComponentOwnerFn', {
      api: this.api,
      name: 'updateComponentOwner',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  const userId = ctx.stash.userId;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET #owner = :userId, updatedAt = :now',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':userId': userId, ':now': now })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // Return the assignment from the previous step
  return ctx.prev.result;
}
`.trim()),
    });

    new appsync.Resolver(this, 'AssignUserToComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'assignUserToComponent',
      pipelineConfig: [
        getComponentForAssignmentFn,
        authorizeAssignmentFn,
        checkTeamRoleForAssignmentFn,
        checkNoExistingAssignmentsFn,
        createAssignmentFn,
        updateComponentOwnerFn
      ],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
    });

    // Resolver: Mutation.unassignUserFromComponent (Pipeline)
    // Step 1: Fetch component for authorization
    // Step 2: Authorize user (must be project owner or team OWNER/ADMIN)
    // Step 3: Delete the assignment record
    const getComponentForUnassignmentFn = new appsync.AppsyncFunction(this, 'GetComponentForUnassignmentFn', {
      api: this.api,
      name: 'getComponentForUnassignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  ctx.stash.componentId = componentId;
  ctx.stash.userId = ctx.args.userId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Component not found', 'ComponentNotFound');
  // Store component data for authorization check
  ctx.stash.component = ctx.result;
  return ctx.result;
}
`.trim()),
    });

    const deleteAssignmentFn = new appsync.AppsyncFunction(this, 'DeleteAssignmentFn', {
      api: this.api,
      name: 'deleteAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.args.componentId;
  const userId = ctx.args.userId;
  ctx.stash.componentId = componentId;
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

    // Step 2: Clear component's owner field
    const clearComponentOwnerFn = new appsync.AppsyncFunction(this, 'ClearComponentOwnerFn', {
      api: this.api,
      name: 'clearComponentOwner',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'REMOVE #owner SET updatedAt = :now',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':now': now })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return true;
}
`.trim()),
    });

    new appsync.Resolver(this, 'UnassignUserFromComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'unassignUserFromComponent',
      pipelineConfig: [
        getComponentForUnassignmentFn,
        authorizeAssignmentFn,
        checkTeamRoleForAssignmentFn,
        deleteAssignmentFn,
        clearComponentOwnerFn
      ],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
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

    // ==================== COMMENTS RESOLVERS ====================
    // Comments on components with support for both authenticated users and guests
    // pk=COMPONENT#componentId, sk=COMMENT#createdAt#id

    // Resolver: Query.listCommentsForComponent (JS) - Query pk=COMPONENT#id, sk begins_with COMMENT#
    new appsync.Resolver(this, 'ListCommentsForComponentResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listCommentsForComponent',
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
        ':pk': 'COMPONENT#' + ctx.args.componentId,
        ':sk': 'COMMENT#'
      })
    },
    scanIndexForward: true,
    limit: limit
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    componentId: item.componentId,
    projectId: item.projectId,
    authorId: item.authorId,
    authorType: item.authorType,
    authorName: item.authorName,
    content: item.content,
    mentions: item.mentions || [],
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Pipeline function: Get component and project info for comment creation
    const getComponentForCommentFn = new appsync.AppsyncFunction(this, 'GetComponentForCommentFn', {
      name: 'getComponentForComment',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + ctx.args.componentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Component not found', 'NotFoundError');
  ctx.stash.component = ctx.result;
  ctx.stash.projectId = ctx.result.projectId;
  return ctx.result;
}
`.trim()),
    });

    // Pipeline function: Get user info for comment author
    const getUserForCommentFn = new appsync.AppsyncFunction(this, 'GetUserForCommentFn', {
      name: 'getUserForComment',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  ctx.stash.authorId = userId;
  ctx.stash.authorType = 'USER';
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
  ctx.stash.authorName = ctx.result?.name || ctx.result?.email || 'Unknown User';
  return ctx.result;
}
`.trim()),
    });

    // Pipeline function: Create comment item
    // Mentions are passed as an argument from the frontend (extracted there)
    const createCommentItemFn = new appsync.AppsyncFunction(this, 'CreateCommentItemFn', {
      name: 'createCommentItem',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const id = util.autoId();
  const now = util.time.nowISO8601();
  const content = ctx.args.content;
  const mentions = ctx.args.mentions || [];

  const item = {
    pk: 'COMPONENT#' + ctx.args.componentId,
    sk: 'COMMENT#' + now + '#' + id,
    id: id,
    componentId: ctx.args.componentId,
    projectId: ctx.stash.projectId,
    authorId: ctx.stash.authorId,
    authorType: ctx.stash.authorType,
    authorName: ctx.stash.authorName,
    content: content,
    mentions: mentions,
    createdAt: now,
    gsi1pk: 'AUTHOR#' + ctx.stash.authorId,
    gsi1sk: 'COMMENT#' + now + '#' + id
  };

  ctx.stash.comment = item;
  ctx.stash.mentions = mentions;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: item.pk,
      sk: item.sk
    }),
    attributeValues: util.dynamodb.toMapValues(item)
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const comment = ctx.stash.comment;
  return {
    id: comment.id,
    componentId: comment.componentId,
    projectId: comment.projectId,
    authorId: comment.authorId,
    authorType: comment.authorType,
    authorName: comment.authorName,
    content: comment.content,
    mentions: comment.mentions || [],
    createdAt: comment.createdAt
  };
}
`.trim()),
    });

    // Resolver: Mutation.createComment (Pipeline) - Creates comment with author info
    new appsync.Resolver(this, 'CreateCommentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createComment',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [getComponentForCommentFn, getUserForCommentFn, createCommentItemFn],
    });

    // ==================== GUEST COMMENTS RESOLVERS ====================
    // Guest access to comments uses IAM auth via Cognito Identity Pool
    // Security: Verify cognitoIdentityId matches guestId for all operations

    // Pipeline function: Verify guest access for listing comments
    const verifyGuestForListCommentsFn = new appsync.AppsyncFunction(this, 'VerifyGuestForListCommentsFn', {
      name: 'verifyGuestForListComments',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own guest session', 'Unauthorized');
  }

  // Store componentId for response
  ctx.stash.componentId = ctx.args.componentId;
  ctx.stash.guestId = guestId;
  ctx.stash.limit = ctx.args.limit || 50;

  // First verify the guest exists
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  const guest = ctx.result;
  if (!guest) {
    util.error('Guest session not found. Please rejoin the project.', 'GuestNotFound');
  }

  // Store guest info for the next step
  ctx.stash.guest = guest;
  return guest;
}
`.trim()),
    });

    // Pipeline function: Query comments for component (guest)
    const queryCommentsForGuestFn = new appsync.AppsyncFunction(this, 'QueryCommentsForGuestFn', {
      name: 'queryCommentsForGuest',
      api: this.api,
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
        ':pk': 'COMPONENT#' + ctx.stash.componentId,
        ':sk': 'COMMENT#'
      })
    },
    scanIndexForward: true,
    limit: limit
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    componentId: item.componentId,
    projectId: item.projectId,
    authorId: item.authorId,
    authorType: item.authorType,
    authorName: item.authorName,
    content: item.content,
    mentions: item.mentions || [],
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Resolver: Query.guestListComments (Pipeline) - List comments with guest verification
    new appsync.Resolver(this, 'GuestListCommentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListComments',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [verifyGuestForListCommentsFn, queryCommentsForGuestFn],
    });

    // ============================================
    // SHARED PIPELINE FUNCTION: createActivityFn
    // Reusable function for creating Activity records
    // Uses ctx.stash: activityType, activityMetadata, projectId, authorId
    // ============================================

    const createActivityFn = new appsync.AppsyncFunction(this, 'CreateActivityFn', {
      api: this.api,
      name: 'createActivity',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // Skip if no activity data provided
  if (!ctx.stash.activityType) {
    return { payload: null };
  }

  const activityId = util.autoId();
  const now = util.time.nowISO8601();
  const projectId = ctx.stash.projectId;
  const activityType = ctx.stash.activityType;
  const authorId = ctx.stash.authorId || ctx.stash.guestId;
  const metadata = ctx.stash.activityMetadata || {};

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'PROJECT#' + projectId,
      sk: 'ACTIVITY#' + now + '#' + activityId
    }),
    attributeValues: util.dynamodb.toMapValues({
      pk: 'PROJECT#' + projectId,
      sk: 'ACTIVITY#' + now + '#' + activityId,
      id: activityId,
      type: activityType,
      projectId: projectId,
      userId: authorId,
      metadata: JSON.stringify(metadata),
      createdAt: now,
      gsi1pk: 'USER#' + authorId,
      gsi1sk: 'ACTIVITY#' + now + '#' + activityId,
      gsi2pk: 'PROJECT#' + projectId + '#TYPE#' + activityType,
      gsi2sk: 'ACTIVITY#' + now + '#' + activityId
    })
  };
}
export function response(ctx) {
  // Return the main result regardless of activity creation outcome
  // Activity creation is a side effect and should not fail the main operation
  return ctx.stash.mainResult || ctx.prev.result;
}
`.trim()),
    });

    // Pipeline function: Verify guest and get component for guest comment
    const verifyGuestAndGetComponentFn = new appsync.AppsyncFunction(this, 'VerifyGuestAndGetComponentFn', {
      name: 'verifyGuestAndGetComponent',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own guest session', 'Unauthorized');
  }

  ctx.stash.guestId = guestId;
  ctx.stash.componentId = ctx.args.componentId;
  ctx.stash.content = ctx.args.content;
  ctx.stash.mentions = ctx.args.mentions || [];

  // Get the guest record
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  const guest = ctx.result;
  if (!guest) {
    util.error('Guest session not found. Please rejoin the project.', 'GuestNotFound');
  }

  ctx.stash.guest = guest;
  ctx.stash.authorId = guest.cognitoIdentityId;
  ctx.stash.authorType = 'GUEST';
  ctx.stash.authorName = guest.displayName || 'Guest';

  return guest;
}
`.trim()),
    });

    // Pipeline function: Get component for guest comment
    const getComponentForGuestCommentFn = new appsync.AppsyncFunction(this, 'GetComponentForGuestCommentFn', {
      name: 'getComponentForGuestComment',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + ctx.stash.componentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Component not found', 'NotFoundError');

  // Verify guest has access to this component's project
  if (ctx.result.projectId !== ctx.stash.guest.projectId) {
    util.error('Access denied: You do not have access to this component', 'Unauthorized');
  }

  ctx.stash.projectId = ctx.result.projectId;
  return ctx.result;
}
`.trim()),
    });

    // Pipeline function: Create comment for guest
    // Mentions are passed as an argument from the frontend (extracted there)
    const createGuestCommentItemFn = new appsync.AppsyncFunction(this, 'CreateGuestCommentItemFn', {
      name: 'createGuestCommentItem',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const id = util.autoId();
  const now = util.time.nowISO8601();
  const content = ctx.stash.content;
  const mentions = ctx.stash.mentions || [];

  const item = {
    pk: 'COMPONENT#' + ctx.stash.componentId,
    sk: 'COMMENT#' + now + '#' + id,
    id: id,
    componentId: ctx.stash.componentId,
    projectId: ctx.stash.projectId,
    authorId: ctx.stash.authorId,
    authorType: ctx.stash.authorType,
    authorName: ctx.stash.authorName,
    content: content,
    mentions: mentions,
    createdAt: now,
    gsi1pk: 'AUTHOR#' + ctx.stash.authorId,
    gsi1sk: 'COMMENT#' + now + '#' + id
  };

  ctx.stash.comment = item;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: item.pk,
      sk: item.sk
    }),
    attributeValues: util.dynamodb.toMapValues(item)
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const comment = ctx.stash.comment;
  const result = {
    id: comment.id,
    componentId: comment.componentId,
    projectId: comment.projectId,
    authorId: comment.authorId,
    authorType: comment.authorType,
    authorName: comment.authorName,
    content: comment.content,
    mentions: comment.mentions || [],
    createdAt: comment.createdAt
  };

  // Set activity data for createActivityFn
  ctx.stash.mainResult = result;
  ctx.stash.activityType = 'COMMENT_ADDED';
  ctx.stash.authorId = ctx.stash.guestId;
  ctx.stash.activityMetadata = {
    componentId: comment.componentId,
    componentName: ctx.stash.componentName,
    authorType: 'GUEST',
    authorName: comment.authorName
  };

  return result;
}
`.trim()),
    });

    // Resolver: Mutation.guestCreateComment (Pipeline) - Creates comment for guest
    new appsync.Resolver(this, 'GuestCreateCommentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestCreateComment',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result; }
`.trim()),
      pipelineConfig: [verifyGuestAndGetComponentFn, getComponentForGuestCommentFn, createGuestCommentItemFn, createActivityFn],
    });

    // ==================== @MENTIONS AUTOCOMPLETE ====================
    // Search team members and guests for @mention autocomplete

    // Pipeline function: Query team members
    const queryTeamMembersForMentionFn = new appsync.AppsyncFunction(this, 'QueryTeamMembersForMentionFn', {
      name: 'queryTeamMembersForMention',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  ctx.stash.query = ctx.args.query.toLowerCase();
  ctx.stash.teamId = ctx.args.teamId;

  // Query all team members
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + ctx.args.teamId,
        ':sk': 'MEMBER#'
      })
    },
    limit: 100
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  // Store member user IDs for batch get
  const members = ctx.result.items || [];
  ctx.stash.members = members;
  ctx.stash.userIds = members.map(m => m.userId);

  return members;
}
`.trim()),
    });

    // Pipeline function: Batch get user details for team members
    // Note: Table name injected via CDK string interpolation
    const tableName = dynamoTable.tableName;
    const batchGetUsersForMentionFn = new appsync.AppsyncFunction(this, 'BatchGetUsersForMentionFn', {
      name: 'batchGetUsersForMention',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userIds = ctx.stash.userIds || [];

  if (userIds.length === 0) {
    return { operation: 'GetItem', key: util.dynamodb.toMapValues({ pk: 'NONE', sk: 'NONE' }) };
  }

  // Batch get up to 100 users (DynamoDB limit)
  const keys = userIds.slice(0, 100).map(userId =>
    util.dynamodb.toMapValues({ pk: 'USER#' + userId, sk: 'METADATA' })
  );

  return {
    operation: 'BatchGetItem',
    tables: {
      '${tableName}': { keys: keys }
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  // Build map of userId -> user info
  const userMap = {};
  const items = ctx.result?.data?.['${tableName}'] || [];
  for (const item of items) {
    if (item && item.id) {
      userMap[item.id] = { name: item.name || item.email || 'User', email: item.email };
    }
  }
  ctx.stash.userMap = userMap;

  // Filter members by query and build suggestions
  const query = ctx.stash.query;
  const suggestions = [];

  for (const member of ctx.stash.members) {
    const user = userMap[member.userId] || {};
    const name = user.name || member.title || 'Team Member';
    const nameMatch = name.toLowerCase().indexOf(query) !== -1;
    const emailMatch = user.email && user.email.toLowerCase().indexOf(query) !== -1;

    if (nameMatch || emailMatch) {
      suggestions.push({
        id: member.userId,
        name: name,
        isGuest: false
      });
    }
  }

  return suggestions;
}
`.trim()),
    });

    // Resolver: Query.searchTeamMembersForMention (Pipeline)
    new appsync.Resolver(this, 'SearchTeamMembersForMentionResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'searchTeamMembersForMention',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) { return ctx.prev.result || []; }
`.trim()),
      pipelineConfig: [queryTeamMembersForMentionFn, batchGetUsersForMentionFn],
    });

    // ==================== GUEST NOTIFICATIONS ====================
    // Notifications for guests using IAM auth via Cognito Identity Pool
    // Uses notificationsReadUntil timestamp pattern for O(1) mark-all-read

    // Resolver: Query.guestListNotifications (IAM) - List notifications for guest
    new appsync.Resolver(this, 'GuestListNotificationsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListNotifications',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own notifications', 'Unauthorized');
  }

  const limit = ctx.args.limit || 20;

  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'GUEST#' + guestId,
        ':sk': 'NOTIFICATION#'
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
    guestId: item.guestId,
    type: item.type,
    title: item.title,
    message: item.message,
    componentId: item.componentId || null,
    projectId: item.projectId || null,
    read: item.read || false,
    createdAt: item.createdAt
  }));
}
`.trim()),
    });

    // Resolver: Query.guestCountUnreadNotifications (IAM) - Count unread notifications
    new appsync.Resolver(this, 'GuestCountUnreadNotificationsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestCountUnreadNotifications',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own notifications', 'Unauthorized');
  }

  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'GUEST#' + guestId,
        ':sk': 'NOTIFICATION#'
      })
    },
    filter: {
      expression: '#read = :false',
      expressionNames: { '#read': 'read' },
      expressionValues: util.dynamodb.toMapValues({ ':false': false })
    },
    select: 'COUNT'
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.scannedCount || 0;
}
`.trim()),
    });

    // Resolver: Mutation.guestMarkNotificationRead (IAM) - Mark single notification as read
    new appsync.Resolver(this, 'GuestMarkNotificationReadResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestMarkNotificationRead',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const notificationId = ctx.args.notificationId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only modify your own notifications', 'Unauthorized');
  }

  ctx.stash.guestId = guestId;
  ctx.stash.notificationId = notificationId;

  // First get the notification to find its sk (which includes createdAt)
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'GUEST#' + guestId,
        ':sk': 'NOTIFICATION#'
      })
    },
    filter: {
      expression: '#id = :id',
      expressionNames: { '#id': 'id' },
      expressionValues: util.dynamodb.toMapValues({ ':id': notificationId })
    },
    limit: 1
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  const items = ctx.result.items || [];
  if (items.length === 0) {
    util.error('Notification not found', 'NotFoundError');
  }

  const notification = items[0];
  notification.read = true;

  return notification;
}
`.trim()),
    });

    // Resolver: Mutation.guestMarkAllNotificationsRead (IAM) - Mark all as read
    new appsync.Resolver(this, 'GuestMarkAllNotificationsReadResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestMarkAllNotificationsRead',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only modify your own notifications', 'Unauthorized');
  }

  const now = util.time.nowISO8601();

  // Update the guest record with notificationsReadUntil timestamp
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
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
  return 0;
}
`.trim()),
    });

    // ==================== GUEST ACTIVITY FEED ====================
    // Activity feed for guests - shows recent activity on components they're assigned to

    // Resolver: Query.guestListActivityFeed (IAM) - List activity for guest's project
    new appsync.Resolver(this, 'GuestListActivityFeedResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListActivityFeed',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const projectId = ctx.args.projectId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own activity feed', 'Unauthorized');
  }

  const limit = ctx.args.limit || 20;

  // Query activities for the project
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'PROJECT#' + projectId,
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
    authorId: item.userId || item.authorId || 'Unknown',
    authorName: item.userName || item.authorName || null,
    authorType: item.authorType || 'USER',
    metadata: item.metadata ? JSON.stringify(item.metadata) : null,
    createdAt: item.createdAt
  }));
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
      requestMappingTemplate: lambdaRequestWithOperation(false), // Uses $ctx.arguments
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateComponentViaAI (Lambda) - pass GraphQL args to Lambda (sync Bedrock)
    new appsync.Resolver(this, 'GenerateComponentViaAIResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateComponentViaAI',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(false), // Uses $ctx.arguments
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateFullPlan (Lambda) - workflow-aware AI generation with context
    new appsync.Resolver(this, 'GenerateFullPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateFullPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.applyFullPlan (Lambda) - atomic plan application with saga pattern
    new appsync.Resolver(this, 'ApplyFullPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'applyFullPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.refineComponent (Lambda) - chat-based single component refinement
    new appsync.Resolver(this, 'RefineComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'refineComponent',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.guestRefineComponent (Lambda + IAM auth) - chat-based component refinement for guests
    new appsync.Resolver(this, 'GuestRefineComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestRefineComponent',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // ============================================
    // PIPELINE RESOLVER: guestUpdateComponent
    // Allows guests to update component fields (apply AI refinement)
    // Step 1: Verify guest is assigned to component
    // Step 2: Update component fields in DynamoDB
    // ============================================

    // Function 1: Verify guest assignment for component update
    const verifyGuestComponentUpdateFn = new appsync.AppsyncFunction(this, 'VerifyGuestComponentUpdateFn', {
      api: this.api,
      name: 'verifyGuestComponentUpdate',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const guestId = input.guestId;
  const componentId = input.componentId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only update components for your own assignments', 'Unauthorized');
  }

  // Store input for next function
  ctx.stash.input = input;
  ctx.stash.componentId = componentId;
  ctx.stash.guestId = guestId;

  // Verify the guest is assigned to this component
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#GUEST#' + guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const assignment = ctx.result;
  if (!assignment) {
    util.error('You must be assigned to this component to update it', 'NotAssigned');
  }

  // Verify the assignment belongs to this identity
  if (assignment.cognitoIdentityId && assignment.cognitoIdentityId !== ctx.identity.cognitoIdentityId) {
    util.error('Access denied: Assignment does not belong to you', 'Unauthorized');
  }

  ctx.stash.assignmentVerified = true;
  return assignment;
}
`.trim()),
    });

    // Function 2: Update component fields in DynamoDB
    const updateComponentFieldsFn = new appsync.AppsyncFunction(this, 'UpdateComponentFieldsFn', {
      api: this.api,
      name: 'updateComponentFields',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.stash.input;
  const componentId = ctx.stash.componentId;
  const now = util.time.nowISO8601();

  // Build dynamic update expression for provided fields only
  const expressionParts = ['#updatedAt = :now'];
  const expressionNames = { '#updatedAt': 'updatedAt' };
  const expressionValues = { ':now': now };

  if (input.name !== undefined && input.name !== null) {
    expressionParts.push('#name = :name');
    expressionNames['#name'] = 'name';
    expressionValues[':name'] = input.name;
  }

  if (input.description !== undefined && input.description !== null) {
    expressionParts.push('#description = :description');
    expressionNames['#description'] = 'description';
    expressionValues[':description'] = input.description;
  }

  if (input.type !== undefined && input.type !== null) {
    expressionParts.push('#type = :type');
    expressionNames['#type'] = 'type';
    expressionValues[':type'] = input.type;
  }

  if (input.estimatedHours !== undefined && input.estimatedHours !== null) {
    expressionParts.push('#estimatedHours = :estimatedHours');
    expressionNames['#estimatedHours'] = 'estimatedHours';
    expressionValues[':estimatedHours'] = input.estimatedHours;
  }

  if (input.priority !== undefined && input.priority !== null) {
    expressionParts.push('#priority = :priority');
    expressionNames['#priority'] = 'priority';
    expressionValues[':priority'] = input.priority;
  }

  if (input.acceptanceCriteria !== undefined && input.acceptanceCriteria !== null) {
    expressionParts.push('#acceptanceCriteria = :acceptanceCriteria');
    expressionNames['#acceptanceCriteria'] = 'acceptanceCriteria';
    expressionValues[':acceptanceCriteria'] = input.acceptanceCriteria;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET ' + expressionParts.join(', '),
      expressionNames: expressionNames,
      expressionValues: util.dynamodb.toMapValues(expressionValues)
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  // Store componentId for the next function to fetch
  ctx.stash.needsFetch = true;
  return ctx.result;
}
`.trim()),
    });

    // Function 3: Fetch component after update to return complete data
    const fetchComponentAfterUpdateFn = new appsync.AppsyncFunction(this, 'FetchComponentAfterUpdateFn', {
      api: this.api,
      name: 'fetchComponentAfterUpdate',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
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

    // Pipeline Resolver: guestUpdateComponent
    new appsync.Resolver(this, 'GuestUpdateComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestUpdateComponent',
      pipelineConfig: [verifyGuestComponentUpdateFn, updateComponentFieldsFn, fetchComponentAfterUpdateFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Mutation.refineBulkPlan (Lambda) - chat-based bulk plan refinement
    new appsync.Resolver(this, 'RefineBulkPlanResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'refineBulkPlan',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.createSmartComponent (Lambda) - natural language component creation
    new appsync.Resolver(this, 'CreateSmartComponentResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'createSmartComponent',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.planSprint (Lambda) - AI sprint planning
    new appsync.Resolver(this, 'PlanSprintResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'planSprint',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
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
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.suggestBreakdown (Lambda) - Component breakdown
    new appsync.Resolver(this, 'SuggestBreakdownResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'suggestBreakdown',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateWireframe (Lambda) - Wireframe generation
    new appsync.Resolver(this, 'GenerateWireframeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateWireframe',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.analyzeImportData (Lambda) - Import analysis
    new appsync.Resolver(this, 'AnalyzeImportDataResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'analyzeImportData',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.cleanupImportData (Lambda) - Import cleanup
    new appsync.Resolver(this, 'CleanupImportDataResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'cleanupImportData',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Resolver: Mutation.generateRetrospective (Lambda) - Retrospective generation
    new appsync.Resolver(this, 'GenerateRetrospectiveResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateRetrospective',
      dataSource: lambdaDs,
      requestMappingTemplate: lambdaRequestWithOperation(),
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

    // Resolver: Mutation.publishComponentChange - triggers onComponentChange subscription
    // Frontend calls this after component CRUD operations to notify other users viewing the project
    new appsync.Resolver(this, 'PublishComponentChangeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'publishComponentChange',
      dataSource: noneDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
        export function request(ctx) {
          return { payload: ctx.arguments };
        }
        export function response(ctx) {
          return {
            projectId: ctx.arguments.projectId,
            componentId: ctx.arguments.componentId,
            action: ctx.arguments.action,
            component: ctx.arguments.component,
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
      code: appsync.Code.fromAsset(join(__dirname, 'appsync-graphql/resolvers/share-codes/Query.validateShareCode.js')),
    });

    // Function: Verify user is team member before generating share code
    const verifyTeamMemberForShareCodeFn = new appsync.AppsyncFunction(this, 'VerifyTeamMemberForShareCodeFn', {
      api: this.api,
      name: 'verifyTeamMemberForShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const input = ctx.args.input;
  const teamId = input.teamId;
  const projectId = input.projectId;

  ctx.stash.userId = userId;
  ctx.stash.input = input;

  // If no teamId provided, we can't verify membership - reject
  if (!teamId) {
    util.error('teamId is required to generate a share code', 'BadRequest');
  }

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const membership = ctx.result;
  if (!membership) {
    util.error('Not authorized - not a team member', 'Unauthorized');
  }

  // Any team member can generate share codes (not just OWNER/ADMIN)
  // This allows collaboration while still ensuring only team members can share
  return membership;
}
`.trim()),
    });

    // Function: Create the share code
    const createShareCodeFn = new appsync.AppsyncFunction(this, 'CreateShareCodeFn', {
      api: this.api,
      name: 'createShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  const input = ctx.stash.input;
  const projectId = input.projectId;

  const autoId = util.autoId().split('-').join('').toUpperCase();
  const code = autoId.substring(0, 6);

  const requestedHours = input.expiresInHours || 168;
  const expiresInHours = requestedHours > 720 ? 720 : requestedHours;
  const nowMs = util.time.nowEpochMilliSeconds();
  const ttlMs = nowMs + (expiresInHours * 3600 * 1000);
  const ttl = ttlMs / 1000;
  const expiresAt = util.time.epochMilliSecondsToISO8601(ttlMs);
  const createdAt = util.time.nowISO8601();

  ctx.stash.code = code;
  ctx.stash.expiresAt = expiresAt;
  ctx.stash.createdAt = createdAt;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + code,
      sk: 'METADATA'
    }),
    attributeValues: util.dynamodb.toMapValues({
      code: code,
      projectId: projectId,
      projectName: input.projectName || null,
      teamId: input.teamId || '',
      teamName: input.teamName || null,
      createdBy: userId,
      ttl: ttl,
      expiresAt: expiresAt,
      createdAt: createdAt,
      gsi1pk: 'PROJECT#' + projectId,
      gsi1sk: 'SHARE_CODE#' + code
    }),
    condition: {
      expression: 'attribute_not_exists(pk)'
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const input = ctx.stash.input;
  return {
    code: ctx.stash.code,
    projectId: input.projectId,
    projectName: input.projectName || null,
    teamId: input.teamId,
    teamName: input.teamName || null,
    expiresAt: ctx.stash.expiresAt,
    createdAt: ctx.stash.createdAt,
    createdBy: ctx.stash.userId
  };
}
`.trim()),
    });

    // Pipeline Resolver: Mutation.generateShareCode (Cognito auth) - Generate share code for project
    // Security: Verifies user is a team member before allowing share code generation
    new appsync.Resolver(this, 'GenerateShareCodeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateShareCode',
      pipelineConfig: [verifyTeamMemberForShareCodeFn, createShareCodeFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Query.listShareCodesForProject (Cognito auth) - List share codes for a project
    new appsync.Resolver(this, 'ListShareCodesForProjectResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listShareCodesForProject',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset(join(__dirname, 'appsync-graphql/resolvers/share-codes/Query.listShareCodesForProject.js')),
    });

    // Function: Fetch share code and extract projectId/teamId for authorization
    const fetchShareCodeForRevokeFn = new appsync.AppsyncFunction(this, 'FetchShareCodeForRevokeFn', {
      api: this.api,
      name: 'fetchShareCodeForRevoke',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.args.code.toUpperCase();
  ctx.stash.code = code;
  ctx.stash.userId = ctx.identity.sub;

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

  const shareCode = ctx.result;
  if (!shareCode) {
    util.error('Share code not found', 'NotFound');
  }

  ctx.stash.projectId = shareCode.projectId;
  ctx.stash.teamId = shareCode.teamId;
  ctx.stash.createdBy = shareCode.createdBy;
  return shareCode;
}
`.trim()),
    });

    // Function: Verify user is team member (or share code creator) before allowing revoke
    const verifyShareCodeRevokeFn = new appsync.AppsyncFunction(this, 'VerifyShareCodeRevokeFn', {
      api: this.api,
      name: 'verifyShareCodeRevoke',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;
  const userId = ctx.stash.userId;

  // If no teamId, check if user is the creator
  if (!teamId) {
    if (ctx.stash.createdBy === userId) {
      ctx.stash.authorized = true;
      return { operation: 'GetItem', key: util.dynamodb.toMapValues({ pk: 'SKIP', sk: 'SKIP' }) };
    }
    util.error('Not authorized to revoke this share code', 'Unauthorized');
  }

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.stash.authorized) {
    return { authorized: true };
  }

  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const membership = ctx.result;
  // Allow OWNER, ADMIN, or the creator of the share code
  const isTeamOwnerAdmin = membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');
  const isCreator = ctx.stash.createdBy === ctx.stash.userId;

  if (!isTeamOwnerAdmin && !isCreator) {
    util.error('Not authorized to revoke this share code', 'Unauthorized');
  }

  return { authorized: true };
}
`.trim()),
    });

    // Function: Delete the share code
    const deleteShareCodeFn = new appsync.AppsyncFunction(this, 'DeleteShareCodeFn', {
      api: this.api,
      name: 'deleteShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'SHARE_CODE#' + ctx.stash.code,
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

    // Pipeline Resolver: Mutation.revokeShareCode (Cognito auth) - Delete share code
    // Security: Verifies user is team OWNER/ADMIN or the share code creator
    new appsync.Resolver(this, 'RevokeShareCodeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'revokeShareCode',
      pipelineConfig: [fetchShareCodeForRevokeFn, verifyShareCodeRevokeFn, deleteShareCodeFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestJoinProject
    // Step 1: Validate share code
    // Step 2: Create GUEST# record in DynamoDB
    // ============================================

    // Function 1: Validate share code and store info in stash
    const validateShareCodeFn = new appsync.AppsyncFunction(this, 'ValidateShareCodeFn', {
      api: this.api,
      name: 'validateShareCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const code = input.code.toUpperCase();
  const displayName = input.displayName.trim();
  
  // Get cognitoIdentityId from IAM auth
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  if (!cognitoIdentityId) {
    util.error('Invalid authentication', 'Unauthorized');
  }
  
  // Store in stash for next function
  ctx.stash.cognitoIdentityId = cognitoIdentityId;
  ctx.stash.displayName = displayName;
  ctx.stash.code = code;
  
  // Get the share code to validate it
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
  const nowEpoch = util.time.nowEpochSeconds();
  if (codeItem.ttl && codeItem.ttl < nowEpoch) {
    util.error('Share code has expired', 'ExpiredShareCode');
  }
  
  // Store code info for the next function in the pipeline
  ctx.stash.projectId = codeItem.projectId;
  ctx.stash.projectName = codeItem.projectName || null;
  ctx.stash.teamId = codeItem.teamId;
  ctx.stash.teamName = codeItem.teamName || null;
  
  return codeItem;
}
`.trim()),
    });

    // Function 2: Create GUEST# record in DynamoDB
    const createGuestRecordFn = new appsync.AppsyncFunction(this, 'CreateGuestRecordFn', {
      api: this.api,
      name: 'createGuestRecord',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.stash.cognitoIdentityId;
  const now = util.time.nowISO8601();
  
  // Create GUEST# record in DynamoDB
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: guestId,
      cognitoIdentityId: guestId,
      displayName: ctx.stash.displayName,
      projectId: ctx.stash.projectId,
      projectName: ctx.stash.projectName,
      teamId: ctx.stash.teamId,
      teamName: ctx.stash.teamName,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      gsi1pk: 'PROJECT#' + ctx.stash.projectId,
      gsi1sk: 'GUEST#' + guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  // Return the guest session
  return {
    guestId: ctx.stash.cognitoIdentityId,
    displayName: ctx.stash.displayName,
    projectId: ctx.stash.projectId,
    projectName: ctx.stash.projectName,
    teamId: ctx.stash.teamId,
    teamName: ctx.stash.teamName
  };
}
`.trim()),
    });

    // Function 3: Create GUEST team membership record
    const createGuestTeamMembershipFn = new appsync.AppsyncFunction(this, 'CreateGuestTeamMembershipFn', {
      api: this.api,
      name: 'createGuestTeamMembership',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.stash.cognitoIdentityId;
  const teamId = ctx.stash.teamId;
  const now = util.time.nowISO8601();

  // Create team membership with GUEST role
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + guestId
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: teamId + '#' + guestId,
      teamId: teamId,
      userId: guestId,
      role: 'GUEST',
      isGuest: true,
      guestName: ctx.stash.displayName,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      gsi1pk: 'USER#' + guestId,
      gsi1sk: 'TEAM#' + teamId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    // Log but don't fail - membership creation is secondary
    console.log('Guest membership creation warning:', ctx.error.message);
  }

  // Return the guest session (from stash)
  return {
    guestId: ctx.stash.cognitoIdentityId,
    displayName: ctx.stash.displayName,
    projectId: ctx.stash.projectId,
    projectName: ctx.stash.projectName,
    teamId: ctx.stash.teamId,
    teamName: ctx.stash.teamName
  };
}
`.trim()),
    });

    // Pipeline Resolver: guestJoinProject
    new appsync.Resolver(this, 'GuestJoinProjectResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestJoinProject',
      pipelineConfig: [validateShareCodeFn, createGuestRecordFn, createGuestTeamMembershipFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Query.guestGetProject (IAM auth) - Get project for guest
    // AWS Best Practice: Verify cognitoIdentityId matches the guestId
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
  const projectId = ctx.args.projectId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  
  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own guest session', 'Unauthorized');
  }
  
  // Store guestId for verification in response
  ctx.stash.guestId = guestId;
  ctx.stash.projectId = projectId;
  
  // First verify the guest exists and has access to this project
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
    util.error('Guest session not found. Please rejoin the project.', 'GuestNotFound');
  }
  
  // Verify guest has access to the requested project
  if (guest.projectId !== ctx.stash.projectId) {
    util.error('Access denied: You do not have access to this project', 'Unauthorized');
  }
  
  // Return project info from guest record (denormalized during join)
  return {
    id: guest.projectId,
    name: guest.projectName || 'Project',
    description: null,
    teamId: guest.teamId,
    createdAt: guest.joinedAt,
    updatedAt: guest.updatedAt
  };
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestListComponents
    // Step 1: Verify guest has access to project
    // Step 2: Query components for project
    // ============================================

    // Function 1: Verify guest exists and has access to the project
    const verifyGuestAccessFn = new appsync.AppsyncFunction(this, 'VerifyGuestAccessFn', {
      api: this.api,
      name: 'verifyGuestAccess',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const projectId = ctx.args.projectId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  
  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own guest session', 'Unauthorized');
  }
  
  if (!projectId) {
    util.error('projectId is required', 'BadRequest');
  }
  
  // Store for next function
  ctx.stash.projectId = projectId;
  ctx.stash.guestId = guestId;
  
  // Verify the guest exists and has access to this project
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
    util.error('Guest session not found. Please rejoin the project.', 'GuestNotFound');
  }
  
  // Verify guest has access to the requested project
  if (guest.projectId !== ctx.stash.projectId) {
    util.error('Access denied: You do not have access to this project', 'Unauthorized');
  }
  
  ctx.stash.guestVerified = true;
  return guest;
}
`.trim()),
    });

    // Function 2: Query components for the project
    const listComponentsForGuestFn = new appsync.AppsyncFunction(this, 'ListComponentsForGuestFn', {
      api: this.api,
      name: 'listComponentsForGuest',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const projectId = ctx.stash.projectId;
  
  // Query components for this project using GSI1
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
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  // Return components list
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    status: item.status,
    projectId: item.projectId,
    parentId: item.parentId,
    estimatedHours: item.estimatedHours,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}
`.trim()),
    });

    // Pipeline Resolver: guestListComponents
    new appsync.Resolver(this, 'GuestListComponentsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListComponents',
      pipelineConfig: [verifyGuestAccessFn, listComponentsForGuestFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestListTeamProjects
    // Step 1: Verify guest is a member of the team
    // Step 2: Query projects for the team
    // ============================================

    // Function 1: Verify guest is a team member
    const verifyGuestTeamMembershipFn = new appsync.AppsyncFunction(this, 'VerifyGuestTeamMembershipFn', {
      api: this.api,
      name: 'verifyGuestTeamMembership',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const teamId = ctx.args.teamId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own guest session', 'Unauthorized');
  }

  if (!teamId) {
    util.error('teamId is required', 'BadRequest');
  }

  // Store for next function
  ctx.stash.teamId = teamId;
  ctx.stash.guestId = guestId;

  // Verify the guest exists and has access to this team
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
    util.error('Guest session not found. Please rejoin the team.', 'GuestNotFound');
  }

  // Verify guest has access to the requested team
  if (guest.teamId !== ctx.stash.teamId) {
    util.error('Access denied: You do not have access to this team', 'Unauthorized');
  }

  ctx.stash.guestVerified = true;
  return guest;
}
`.trim()),
    });

    // Function 2: Query projects for the team
    const listProjectsForGuestTeamFn = new appsync.AppsyncFunction(this, 'ListProjectsForGuestTeamFn', {
      api: this.api,
      name: 'listProjectsForGuestTeam',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;

  // Query projects for this team using GSI2
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
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  // Return projects list
  return (ctx.result.items || []).map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    teamId: item.teamId,
    ownerId: item.ownerId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}
`.trim()),
    });

    // Pipeline Resolver: guestListTeamProjects
    new appsync.Resolver(this, 'GuestListTeamProjectsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'guestListTeamProjects',
      pipelineConfig: [verifyGuestTeamMembershipFn, listProjectsForGuestTeamFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Query.guestListAssignments (IAM auth) - List guest's assignments
    // AWS Best Practice: Verify cognitoIdentityId matches guestId
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
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  
  // Security: Verify the caller's identity matches the requested guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only access your own assignments', 'Unauthorized');
  }
  
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
    component: {
      id: item.componentId,
      name: item.componentName || 'Component',
      status: item.componentStatus,
      type: item.componentType,
      projectId: item.projectId
    }
  }));
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestAssignSelf
    // Step 1: Fetch component details for denormalization
    // Step 2: Create assignment with denormalized component data
    // Step 3: Create MEMBER_ASSIGNED activity record
    // ============================================

    // Function 1: Fetch component details
    const fetchComponentForAssignmentFn = new appsync.AppsyncFunction(this, 'FetchComponentForAssignmentFn', {
      api: this.api,
      name: 'fetchComponentForAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  
  // Security: Verify the caller can only assign themselves
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only assign yourself', 'Unauthorized');
  }
  
  // Store for next function
  ctx.stash.guestId = guestId;
  ctx.stash.componentId = componentId;
  ctx.stash.cognitoIdentityId = cognitoIdentityId;
  
  // Fetch the component to get its details for denormalization
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  const component = ctx.result;
  if (!component) {
    util.error('Component not found', 'ComponentNotFound');
  }
  
  // Store component details for denormalization
  ctx.stash.componentName = component.name;
  ctx.stash.componentStatus = component.status;
  ctx.stash.componentType = component.type;
  ctx.stash.projectId = component.projectId;
  
  return component;
}
`.trim()),
    });

    // Function 2: Check no existing assignments before allowing new ones
    const checkNoExistingGuestAssignmentsFn = new appsync.AppsyncFunction(this, 'CheckNoExistingGuestAssignmentsFn', {
      api: this.api,
      name: 'checkNoExistingGuestAssignments',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  // Query for any existing ASSIGNEE# entries for this component
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'COMPONENT#' + componentId,
        ':skPrefix': 'ASSIGNEE#'
      })
    },
    limit: 1
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result.items && ctx.result.items.length > 0) {
    util.error('This component is already assigned to someone', 'ComponentAlreadyAssigned');
  }
  return ctx.prev.result;
}
`.trim()),
    });

    // Function 3: Create assignment with denormalized component data
    const createGuestAssignmentFn = new appsync.AppsyncFunction(this, 'CreateGuestAssignmentFn', {
      api: this.api,
      name: 'createGuestAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.stash.guestId;
  const componentId = ctx.stash.componentId;
  const cognitoIdentityId = ctx.stash.cognitoIdentityId;
  const assignmentId = util.autoId();
  const now = util.time.nowISO8601();
  
  // Create assignment with denormalized component data for efficient queries
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
      cognitoIdentityId: cognitoIdentityId,
      assignedAt: now,
      isGuest: true,
      // Denormalized component data for efficient list queries
      componentName: ctx.stash.componentName,
      componentStatus: ctx.stash.componentStatus,
      componentType: ctx.stash.componentType,
      projectId: ctx.stash.projectId,
      // GSI1 for querying guest's assignments
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
  const result = {
    id: item.id,
    componentId: item.componentId,
    userId: item.guestId,
    assignedAt: item.assignedAt
  };

  // Set activity data for createActivityFn
  ctx.stash.mainResult = result;
  ctx.stash.activityType = 'MEMBER_ASSIGNED';
  ctx.stash.authorId = ctx.stash.guestId;
  ctx.stash.activityMetadata = {
    componentId: ctx.stash.componentId,
    componentName: ctx.stash.componentName,
    guestId: ctx.stash.guestId,
    authorType: 'GUEST'
  };

  return result;
}
`.trim()),
    });

    // Pipeline Resolver: guestAssignSelf
    new appsync.Resolver(this, 'GuestAssignSelfResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestAssignSelf',
      pipelineConfig: [fetchComponentForAssignmentFn, checkNoExistingGuestAssignmentsFn, createGuestAssignmentFn, createActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestUnassignSelf
    // Step 1: Fetch assignment to get component details
    // Step 2: Delete the assignment
    // Step 3: Create MEMBER_UNASSIGNED activity record
    // ============================================

    // Function 1: Fetch assignment details for activity record
    const fetchAssignmentForUnassignFn = new appsync.AppsyncFunction(this, 'FetchAssignmentForUnassignFn', {
      api: this.api,
      name: 'fetchAssignmentForUnassign',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;

  // Security: Verify the caller can only unassign themselves
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only unassign yourself', 'Unauthorized');
  }

  ctx.stash.guestId = guestId;
  ctx.stash.componentId = componentId;
  ctx.stash.cognitoIdentityId = cognitoIdentityId;

  // Fetch assignment to get component details
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#GUEST#' + guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const assignment = ctx.result;
  if (!assignment) {
    util.error('Not assigned to this component', 'NotAssigned');
  }

  // Verify ownership
  if (assignment.cognitoIdentityId !== ctx.stash.cognitoIdentityId) {
    util.error('Access denied: Assignment does not belong to you', 'Unauthorized');
  }

  // Store for activity creation
  ctx.stash.componentName = assignment.componentName;
  ctx.stash.projectId = assignment.projectId;

  return assignment;
}
`.trim()),
    });

    // Function 2: Delete the assignment
    const deleteGuestAssignmentFn = new appsync.AppsyncFunction(this, 'DeleteGuestAssignmentFn', {
      api: this.api,
      name: 'deleteGuestAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + ctx.stash.componentId,
      sk: 'ASSIGNEE#GUEST#' + ctx.stash.guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  // Set activity data for createActivityFn
  ctx.stash.mainResult = true;
  ctx.stash.activityType = 'MEMBER_UNASSIGNED';
  ctx.stash.authorId = ctx.stash.guestId;
  ctx.stash.activityMetadata = {
    componentId: ctx.stash.componentId,
    componentName: ctx.stash.componentName,
    guestId: ctx.stash.guestId,
    authorType: 'GUEST'
  };

  return true;
}
`.trim()),
    });

    // Pipeline Resolver: guestUnassignSelf
    new appsync.Resolver(this, 'GuestUnassignSelfResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestUnassignSelf',
      pipelineConfig: [fetchAssignmentForUnassignFn, deleteGuestAssignmentFn, createActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // PIPELINE RESOLVER: guestUpdateStatus
    // Step 1: Verify guest is assigned to component
    // Step 2: Update component status in DynamoDB
    // ============================================

    // Function 1: Verify guest is assigned to the component
    const verifyGuestAssignmentFn = new appsync.AppsyncFunction(this, 'VerifyGuestAssignmentFn', {
      api: this.api,
      name: 'verifyGuestAssignment',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.args.guestId;
  const componentId = ctx.args.componentId;
  const status = ctx.args.status;
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  
  // Security: Verify the caller's identity matches the guestId
  if (guestId !== cognitoIdentityId) {
    util.error('Access denied: You can only update status for your own assignments', 'Unauthorized');
  }
  
  // Store args for next function
  ctx.stash.componentId = componentId;
  ctx.stash.status = status;
  ctx.stash.guestId = guestId;
  
  // Verify the guest is assigned to this component
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'COMPONENT#' + componentId,
      sk: 'ASSIGNEE#GUEST#' + guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  const assignment = ctx.result;
  if (!assignment) {
    util.error('You must be assigned to this component to update its status', 'NotAssigned');
  }
  
  // Verify the assignment belongs to this identity
  if (assignment.cognitoIdentityId && assignment.cognitoIdentityId !== ctx.identity.cognitoIdentityId) {
    util.error('Access denied: Assignment does not belong to you', 'Unauthorized');
  }
  
  ctx.stash.assignmentVerified = true;
  return assignment;
}
`.trim()),
    });

    // Function 2: Update component status in DynamoDB
    const updateComponentStatusFn = new appsync.AppsyncFunction(this, 'UpdateComponentStatusFn', {
      api: this.api,
      name: 'updateComponentStatus',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const componentId = ctx.stash.componentId;
  const status = ctx.stash.status;
  const now = util.time.nowISO8601();
  
  // Update the component status in DynamoDB
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

  // Return the updated component
  const item = ctx.result;
  const result = {
    id: item.id || ctx.stash.componentId,
    name: item.name,
    description: item.description,
    type: item.type,
    status: item.status || ctx.stash.status,
    projectId: item.projectId,
    parentId: item.parentId,
    estimatedHours: item.estimatedHours,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };

  // Set activity data for createActivityFn
  ctx.stash.mainResult = result;
  ctx.stash.projectId = item.projectId;
  ctx.stash.activityType = 'COMPONENT_STATUS_CHANGED';
  ctx.stash.authorId = ctx.stash.guestId;
  ctx.stash.activityMetadata = {
    componentId: ctx.stash.componentId,
    componentName: item.name,
    oldStatus: item.status,
    newStatus: ctx.stash.status,
    authorType: 'GUEST'
  };

  return result;
}
`.trim()),
    });

    // Pipeline Resolver: guestUpdateStatus
    new appsync.Resolver(this, 'GuestUpdateStatusResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestUpdateStatus',
      pipelineConfig: [verifyGuestAssignmentFn, updateComponentStatusFn, createActivityFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
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
  // Filter out records without projectId (required field)
  const items = (ctx.result.items || []).filter(item => item.projectId);
  return items.map(item => ({
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

    // ============================================
    // Team Invite Code Resolvers
    // For inviting authenticated users to join teams
    // ============================================

    // Function: Verify user is team owner/admin and prepare invite data
    const verifyTeamOwnerAdminFn = new appsync.AppsyncFunction(this, 'VerifyTeamOwnerAdminFn', {
      api: this.api,
      name: 'verifyTeamOwnerAdmin',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const userId = ctx.identity.sub;
  const teamId = input.teamId;
  const role = input.role || 'MEMBER';
  const expiresInHours = input.expiresInHours || 168; // 7 days default
  const maxUses = input.maxUses || null;

  // Generate 6-character alphanumeric code (UUID first 6 chars = 36^6 = 2B+ combinations)
  const code = util.autoId().substring(0, 6).toUpperCase();
  const now = util.time.nowISO8601();
  const ttlSeconds = util.time.nowEpochSeconds() + (expiresInHours * 3600);
  const expiresAt = util.time.epochMilliSecondsToISO8601(ttlSeconds * 1000);

  // Store in stash for next function
  ctx.stash.code = code;
  ctx.stash.teamId = teamId;
  ctx.stash.role = role;
  ctx.stash.expiresAt = expiresAt;
  ctx.stash.createdAt = now;
  ctx.stash.createdBy = userId;
  ctx.stash.maxUses = maxUses;
  ctx.stash.ttlSeconds = ttlSeconds;

  // Check if user is owner/admin of the team
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const membership = ctx.result;
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
    util.error('Only team owners and admins can generate invite codes', 'Unauthorized');
  }

  return ctx.result;
}
`.trim()),
    });

    // Function: Fetch team metadata to get team name for invite denormalization
    const fetchTeamForInviteFn = new appsync.AppsyncFunction(this, 'FetchTeamForInviteFn', {
      api: this.api,
      name: 'fetchTeamForInvite',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const team = ctx.result;
  // Store actual team name from team metadata
  ctx.stash.teamName = team ? team.name : 'Team';

  return ctx.result;
}
`.trim()),
    });

    // Function: Create the team invite code record
    const createTeamInviteCodeFn = new appsync.AppsyncFunction(this, 'CreateTeamInviteCodeFn', {
      api: this.api,
      name: 'createTeamInviteCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.stash.code;
  const teamId = ctx.stash.teamId;
  const role = ctx.stash.role;
  const expiresAt = ctx.stash.expiresAt;
  const createdAt = ctx.stash.createdAt;
  const createdBy = ctx.stash.createdBy;
  const maxUses = ctx.stash.maxUses;
  const teamName = ctx.stash.teamName;
  const ttlSeconds = ctx.stash.ttlSeconds;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    }),
    attributeValues: util.dynamodb.toMapValues({
      code: code,
      teamId: teamId,
      teamName: teamName,
      role: role,
      expiresAt: expiresAt,
      createdAt: createdAt,
      createdBy: createdBy,
      usageCount: 0,
      maxUses: maxUses,
      ttl: ttlSeconds,
      gsi1pk: 'TEAM#' + teamId,
      gsi1sk: 'TEAM_INVITE#' + code
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  return {
    code: ctx.stash.code,
    teamId: ctx.stash.teamId,
    teamName: ctx.stash.teamName,
    role: ctx.stash.role,
    expiresAt: ctx.stash.expiresAt,
    createdAt: ctx.stash.createdAt,
    createdBy: ctx.stash.createdBy,
    usageCount: 0,
    maxUses: ctx.stash.maxUses
  };
}
`.trim()),
    });

    // Pipeline Resolver: Mutation.generateTeamInvite
    new appsync.Resolver(this, 'GenerateTeamInviteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'generateTeamInvite',
      pipelineConfig: [verifyTeamOwnerAdminFn, fetchTeamForInviteFn, createTeamInviteCodeFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Resolver: Query.validateTeamInvite - Check if invite code is valid
    new appsync.Resolver(this, 'ValidateTeamInviteResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'validateTeamInvite',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.args.code.toUpperCase();

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    return { valid: false, message: 'Error checking invite code' };
  }

  const invite = ctx.result;
  if (!invite) {
    return { valid: false, message: 'Invalid invite code' };
  }

  // Check expiration
  const nowEpoch = util.time.nowEpochSeconds();
  if (invite.ttl && invite.ttl < nowEpoch) {
    return { valid: false, message: 'Invite code has expired' };
  }

  // Check max uses
  if (invite.maxUses && invite.usageCount >= invite.maxUses) {
    return { valid: false, message: 'Invite code has reached maximum uses' };
  }

  return {
    valid: true,
    teamId: invite.teamId,
    teamName: invite.teamName,
    role: invite.role,
    message: null
  };
}
`.trim()),
    });

    // Function: Verify user is team owner/admin before listing invite codes
    const verifyTeamOwnerAdminForListFn = new appsync.AppsyncFunction(this, 'VerifyTeamOwnerAdminForListFn', {
      api: this.api,
      name: 'verifyTeamOwnerAdminForList',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.args.teamId;
  const userId = ctx.identity.sub;

  ctx.stash.teamId = teamId;

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const membership = ctx.result;
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
    util.error('Only team owners and admins can list invite codes', 'Unauthorized');
  }

  return membership;
}
`.trim()),
    });

    // Function: Query team invite codes
    const queryTeamInvitesFn = new appsync.AppsyncFunction(this, 'QueryTeamInvitesFn', {
      api: this.api,
      name: 'queryTeamInvites',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;

  return {
    operation: 'Query',
    index: 'gsi1',
    query: {
      expression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM#' + teamId,
        ':sk': 'TEAM_INVITE#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const nowEpoch = util.time.nowEpochSeconds();

  // Filter out expired codes and map to output format
  return (ctx.result.items || [])
    .filter(item => !item.ttl || item.ttl >= nowEpoch)
    .map(item => ({
      code: item.code,
      teamId: item.teamId,
      teamName: item.teamName,
      role: item.role,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      usageCount: item.usageCount || 0,
      maxUses: item.maxUses
    }));
}
`.trim()),
    });

    // Pipeline Resolver: Query.listTeamInviteCodes - List active invite codes for a team (owner/admin only)
    // Security: Verifies user is OWNER/ADMIN of the team before listing codes
    new appsync.Resolver(this, 'ListTeamInviteCodesResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listTeamInviteCodes',
      pipelineConfig: [verifyTeamOwnerAdminForListFn, queryTeamInvitesFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Function: Validate invite code and prepare join data
    const validateInviteCodeFn = new appsync.AppsyncFunction(this, 'ValidateInviteCodeFn', {
      api: this.api,
      name: 'validateInviteCode',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.args.code.toUpperCase();
  const userId = ctx.identity.sub;

  ctx.stash.code = code;
  ctx.stash.userId = userId;

  // Get the invite code to validate it
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const invite = ctx.result;
  if (!invite) {
    util.error('Invalid invite code', 'InvalidInviteCode');
  }

  // Check expiration
  const nowEpoch = util.time.nowEpochSeconds();
  if (invite.ttl && invite.ttl < nowEpoch) {
    util.error('Invite code has expired', 'ExpiredInviteCode');
  }

  // Check max uses
  if (invite.maxUses && invite.usageCount >= invite.maxUses) {
    util.error('Invite code has reached maximum uses', 'MaxUsesReached');
  }

  // Store invite info for next step
  ctx.stash.teamId = invite.teamId;
  ctx.stash.teamName = invite.teamName;
  ctx.stash.role = invite.role;
  ctx.stash.usageCount = invite.usageCount || 0;

  return invite;
}
`.trim()),
    });

    // Function: Create membership record
    const createTeamMembershipFromInviteFn = new appsync.AppsyncFunction(this, 'CreateTeamMembershipFromInviteFn', {
      api: this.api,
      name: 'createTeamMembershipFromInvite',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.stash.userId;
  const teamId = ctx.stash.teamId;
  const role = ctx.stash.role;
  const now = util.time.nowISO8601();
  const membershipId = util.autoId();

  ctx.stash.membershipId = membershipId;
  ctx.stash.joinedAt = now;

  // Create membership with condition to prevent duplicates
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: membershipId,
      userId: userId,
      teamId: teamId,
      role: role,
      joinedAt: now,
      hoursPerDay: 6,
      availability: 100,
      gsi1pk: 'USER#' + userId,
      gsi1sk: 'TEAM#' + teamId
    }),
    condition: {
      expression: 'attribute_not_exists(pk)'
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'ConditionalCheckFailedException') {
      util.error('You are already a member of this team', 'AlreadyMember');
    }
    util.error(ctx.error.message, ctx.error.type);
  }

  return {
    id: ctx.stash.membershipId,
    userId: ctx.stash.userId,
    teamId: ctx.stash.teamId,
    role: ctx.stash.role,
    joinedAt: ctx.stash.joinedAt,
    hoursPerDay: 6,
    availability: 100
  };
}
`.trim()),
    });

    // Function to increment usage count on invite code
    const incrementInviteUsageCountFn = new appsync.AppsyncFunction(this, 'IncrementInviteUsageCountFn', {
      api: this.api,
      name: 'incrementInviteUsageCount',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.stash.code;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET usageCount = usageCount + :one',
      expressionValues: util.dynamodb.toMapValues({
        ':one': 1
      })
    }
  };
}
export function response(ctx) {
  // Return the membership from previous function
  return ctx.prev.result;
}
`.trim()),
    });

    // Function: Increment team member count (AWS Best Practice: atomic counter)
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.AtomicCounters
    const incrementTeamMemberCountFn = new appsync.AppsyncFunction(this, 'IncrementTeamMemberCountFn', {
      api: this.api,
      name: 'incrementTeamMemberCount',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;

  // AWS Best Practice: Use atomic counter with if_not_exists for initialization
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET memberCount = if_not_exists(memberCount, :zero) + :one',
      expressionValues: util.dynamodb.toMapValues({
        ':zero': 0,
        ':one': 1
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // Return the membership from previous function
  return ctx.prev.result;
}
`.trim()),
    });

    // Pipeline Resolver: Mutation.joinTeamWithCode
    new appsync.Resolver(this, 'JoinTeamWithCodeResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'joinTeamWithCode',
      pipelineConfig: [validateInviteCodeFn, createTeamMembershipFromInviteFn, incrementInviteUsageCountFn, incrementTeamMemberCountFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // Function: Fetch invite code and extract teamId for authorization
    const fetchInviteForRevokeFn = new appsync.AppsyncFunction(this, 'FetchInviteForRevokeFn', {
      api: this.api,
      name: 'fetchInviteForRevoke',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.args.code.toUpperCase();
  ctx.stash.code = code;
  ctx.stash.userId = ctx.identity.sub;

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const invite = ctx.result;
  if (!invite) {
    util.error('Invite code not found', 'NotFound');
  }

  ctx.stash.teamId = invite.teamId;
  return invite;
}
`.trim()),
    });

    // Function: Verify user is team owner/admin before allowing revoke
    const verifyTeamOwnerAdminForRevokeFn = new appsync.AppsyncFunction(this, 'VerifyTeamOwnerAdminForRevokeFn', {
      api: this.api,
      name: 'verifyTeamOwnerAdminForRevoke',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const teamId = ctx.stash.teamId;
  const userId = ctx.stash.userId;

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#' + userId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const membership = ctx.result;
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
    util.error('Only team owners and admins can revoke invite codes', 'Unauthorized');
  }

  return membership;
}
`.trim()),
    });

    // Function: Delete the team invite code
    const deleteTeamInviteFn = new appsync.AppsyncFunction(this, 'DeleteTeamInviteFn', {
      api: this.api,
      name: 'deleteTeamInvite',
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + ctx.stash.code,
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

    // Pipeline Resolver: Mutation.revokeTeamInvite - Delete invite code (owner/admin only)
    // Security: Verifies user is OWNER/ADMIN of the team before allowing revoke
    new appsync.Resolver(this, 'RevokeTeamInviteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'revokeTeamInvite',
      pipelineConfig: [fetchInviteForRevokeFn, verifyTeamOwnerAdminForRevokeFn, deleteTeamInviteFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // RESOLVER: guestJoinTeam (Pipeline - IAM auth)
    // ============================================

    // Function: Validate team invite code for guest joining
    const validateTeamInviteForGuestJoinFn = new appsync.AppsyncFunction(this, 'ValidateTeamInviteForGuestJoinFn', {
      name: 'validateTeamInviteForGuestJoin',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const input = ctx.args.input;
  const code = input.code.toUpperCase();
  const displayName = (input.displayName || '').trim();

  // Input validation (AWS Best Practice: validate all user input)
  if (!displayName || displayName.length === 0) {
    util.error('Display name is required', 'ValidationError');
  }
  if (displayName.length > 100) {
    util.error('Display name must be 100 characters or less', 'ValidationError');
  }
  if (code.length !== 6) {
    util.error('Invalid invite code format', 'ValidationError');
  }

  // Get cognitoIdentityId from IAM auth (AWS Best Practice: verify identity)
  const cognitoIdentityId = ctx.identity.cognitoIdentityId;
  if (!cognitoIdentityId) {
    util.error('Invalid authentication', 'Unauthorized');
  }

  ctx.stash.cognitoIdentityId = cognitoIdentityId;
  ctx.stash.displayName = displayName;
  ctx.stash.code = code;

  // Get the invitation code to validate it
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const invite = ctx.result;
  if (!invite) {
    util.error('Invalid invitation code', 'InvalidTeamInvite');
  }

  // Check expiration (AWS Best Practice: validate TTL server-side)
  const nowEpoch = util.time.nowEpochSeconds();
  if (invite.ttl && invite.ttl < nowEpoch) {
    util.error('Invitation code has expired', 'ExpiredTeamInvite');
  }

  // Check max uses (AWS Best Practice: enforce usage limits)
  if (invite.maxUses && invite.usageCount >= invite.maxUses) {
    util.error('Invitation code has reached maximum uses', 'MaxUsesReached');
  }

  // Store invite info for next function
  ctx.stash.teamId = invite.teamId;
  ctx.stash.teamName = invite.teamName || null;
  // Guests always get GUEST role, regardless of invite role
  ctx.stash.role = 'GUEST';

  return invite;
}
`.trim()),
    });

    // Function: Create guest record in DynamoDB for team join
    const createGuestRecordForTeamJoinFn = new appsync.AppsyncFunction(this, 'CreateGuestRecordForTeamJoinFn', {
      name: 'createGuestRecordForTeamJoin',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.stash.cognitoIdentityId;
  const now = util.time.nowISO8601();

  // Create GUEST# record
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'GUEST#' + guestId,
      sk: 'METADATA'
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: guestId,
      cognitoIdentityId: guestId,
      displayName: ctx.stash.displayName,
      teamId: ctx.stash.teamId,
      teamName: ctx.stash.teamName,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      gsi1pk: 'TEAM#' + ctx.stash.teamId,
      gsi1sk: 'GUEST#' + guestId
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  // Pass through stash for next function (don't return PutItem result)
  return ctx.stash;
}
`.trim()),
    });

    // Function: Create guest team membership record for team join
    const createGuestMembershipForTeamJoinFn = new appsync.AppsyncFunction(this, 'CreateGuestMembershipForTeamJoinFn', {
      name: 'createGuestMembershipForTeamJoin',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const guestId = ctx.stash.cognitoIdentityId;
  const teamId = ctx.stash.teamId;
  const role = ctx.stash.role;
  const now = util.time.nowISO8601();
  const membershipId = guestId + '#' + teamId;

  // Create guest team membership with condition to prevent duplicates
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + teamId,
      sk: 'MEMBER#GUEST#' + guestId
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: membershipId,
      userId: 'GUEST#' + guestId,
      teamId: teamId,
      role: role,
      isGuest: true,
      guestName: ctx.stash.displayName,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      gsi1pk: 'GUEST#' + guestId,
      gsi1sk: 'TEAM#' + teamId
    }),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    // Handle duplicate membership gracefully (idempotent operation)
    const errorType = ctx.error.type || ctx.error.errorType || '';
    const errorMessage = ctx.error.message || '';

    if (errorType === 'DynamoDB:ConditionalCheckFailedException' ||
        errorMessage.includes('ConditionalCheckFailedException') ||
        errorMessage.includes('conditional request failed')) {
      // Guest already joined - return success (idempotent)
      return {
        guestId: ctx.stash.cognitoIdentityId,
        displayName: ctx.stash.displayName,
        teamId: ctx.stash.teamId,
        teamName: ctx.stash.teamName,
        role: ctx.stash.role || 'GUEST'
      };
    }
    // For other errors, propagate them
    util.error(ctx.error.message || errorMessage, errorType || ctx.error.type);
  }

  // Return the guest team session on success
  return {
    guestId: ctx.stash.cognitoIdentityId,
    displayName: ctx.stash.displayName,
    teamId: ctx.stash.teamId,
    teamName: ctx.stash.teamName,
    role: ctx.stash.role || 'GUEST'
  };
}
`.trim()),
    });

    // Function: Increment invite usage count for guest join
    // AWS Best Practice: Track usage for auditing and enforce limits
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.AtomicCounters
    const incrementGuestInviteUsageFn = new appsync.AppsyncFunction(this, 'IncrementGuestInviteUsageFn', {
      name: 'incrementGuestInviteUsage',
      api: this.api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const code = ctx.stash.code;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + code,
      sk: 'METADATA'
    }),
    update: {
      expression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
      expressionValues: util.dynamodb.toMapValues({
        ':zero': 0,
        ':one': 1
      })
    }
  };
}
export function response(ctx) {
  // Return the membership result from previous function (ignore update result)
  return ctx.prev.result;
}
`.trim()),
    });

    // Pipeline Resolver: Mutation.guestJoinTeam
    new appsync.Resolver(this, 'GuestJoinTeamResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'guestJoinTeam',
      pipelineConfig: [validateTeamInviteForGuestJoinFn, createGuestRecordForTeamJoinFn, createGuestMembershipForTeamJoinFn, incrementGuestInviteUsageFn, incrementTeamMemberCountFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  return {};
}
export function response(ctx) {
  if (ctx.error) {
    const errorType = ctx.error.type || '';
    const errorMessage = ctx.error.message || '';
    if (errorType === 'DynamoDB:ConditionalCheckFailedException' ||
        errorMessage.includes('ConditionalCheckFailedException') ||
        errorMessage.includes('conditional request failed')) {
      if (ctx.stash && ctx.stash.cognitoIdentityId) {
        return {
          guestId: ctx.stash.cognitoIdentityId,
          displayName: ctx.stash.displayName || 'Guest',
          teamId: ctx.stash.teamId,
          teamName: ctx.stash.teamName || null,
          role: ctx.stash.role || 'GUEST'
        };
      }
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // RESOLVER: migrateGuestToUser (Lambda)
    // ============================================

    // Resolver: Mutation.migrateGuestToUser - Migrate guest data to authenticated user
    new appsync.Resolver(this, 'MigrateGuestToUserResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'migrateGuestToUser',
      dataSource: lambdaDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // Get the authenticated user ID from Cognito
  const userId = ctx.identity.sub || ctx.identity.username;
  if (!userId) {
    util.error('Not authenticated', 'Unauthorized');
  }

  return {
    operation: 'Invoke',
    payload: {
      guestId: ctx.args.guestId,
      teamId: ctx.args.teamId,
      userId: userId
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
