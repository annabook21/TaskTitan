/**
 * Modular team invitation resolvers
 * Uses Cognito AdminCreateUser for email-based invitations
 */
import * as appsync from 'aws-cdk-lib/aws-appsync';
import { IGraphqlApi, BaseDataSource } from 'aws-cdk-lib/aws-appsync';
import { Construct } from 'constructs';

export interface TeamInvitationResolversProps {
  api: IGraphqlApi;
  dynamoDs: BaseDataSource;
  inviteTeamMemberDs: BaseDataSource;
}

export class TeamInvitationResolvers extends Construct {
  constructor(scope: Construct, id: string, props: TeamInvitationResolversProps) {
    super(scope, id);

    const { api, dynamoDs, inviteTeamMemberDs } = props;

    // ============================================
    // Query.checkPendingInvitations
    // ============================================
    // AWS Best Practice: Split into two pipeline functions (one DynamoDB operation per function)
    const getUserEmailForInvitesFn = new appsync.AppsyncFunction(this, 'GetUserEmailForInvitesFn', {
      name: 'getUserEmailForInvites',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  
  // Get user's email from DynamoDB
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  const user = ctx.result;
  if (!user || !user.email) {
    // No email found - store empty flag in stash
    ctx.stash.hasEmail = false;
    return { hasEmail: false };
  }
  
  const email = user.email.toLowerCase().trim();
  ctx.stash.email = email;
  ctx.stash.hasEmail = true;
  
  return { hasEmail: true, email };
}
`.trim()),
    });

    const queryPendingInvitationsFn = new appsync.AppsyncFunction(this, 'QueryPendingInvitationsFn', {
      name: 'queryPendingInvitations',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // Check if user has email from previous function
  if (!ctx.stash.hasEmail || !ctx.stash.email) {
    // No email - return empty result
    return {
      operation: 'Query',
      query: {
        expression: 'pk = :pk',
        expressionValues: util.dynamodb.toMapValues({
          ':pk': 'NONE'
        })
      },
      limit: 0
    };
  }
  
  const email = ctx.stash.email;
  
  // Query for pending invitations by email
  // pk=TEAM_INVITE#<email>, sk begins_with TEAM#
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM_INVITE#' + email,
        ':sk': 'TEAM#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  const invites = ctx.result.items || [];
  const nowEpoch = util.time.nowEpochSeconds();
  
  // Filter out expired invitations
  const validInvites = invites.filter(inv => {
    if (inv.status !== 'PENDING') return false;
    if (inv.ttl && inv.ttl < nowEpoch) return false;
    return true;
  });
  
  return validInvites;
}
`.trim()),
    });

    new appsync.Resolver(this, 'CheckPendingInvitationsResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'checkPendingInvitations',
      pipelineConfig: [getUserEmailForInvitesFn, queryPendingInvitationsFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // Mutation.inviteTeamMember
    // ============================================
    const verifyTeamOwnerAdminForInviteFn = new appsync.AppsyncFunction(this, 'VerifyTeamOwnerAdminForInviteFn', {
      name: 'verifyTeamOwnerAdminForInvite',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  const input = ctx.args.input;
  
  ctx.stash.userId = userId;
  ctx.stash.teamId = input.teamId;
  ctx.stash.email = input.email.toLowerCase().trim();
  ctx.stash.role = input.role || 'MEMBER';
  ctx.stash.title = input.title || null;
  
  // Verify user is OWNER or ADMIN
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + input.teamId,
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
    util.error('You must be a member of this team', 'Unauthorized');
  }
  
  const role = membership.role;
  if (role !== 'OWNER' && role !== 'ADMIN') {
    util.error('Only team owners and admins can invite members', 'Forbidden');
  }
  
  return membership;
}
`.trim()),
    });

    const checkOrCreateUserFn = new appsync.AppsyncFunction(this, 'CheckOrCreateUserFn', {
      name: 'checkOrCreateUser',
      api: api,
      dataSource: inviteTeamMemberDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  // Invoke Lambda to check/create user
  return {
    email: ctx.stash.email,
    teamId: ctx.stash.teamId,
    role: ctx.stash.role,
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  // Lambda returns { success, message, userExists, userId? }
  const result = ctx.result;
  if (!result.success) {
    util.error(result.message || 'Failed to invite user', 'InviteFailed');
  }
  
  ctx.stash.userExists = result.userExists || false;
  ctx.stash.invitedUserId = result.userId || null;
  
  return result;
}
`.trim()),
    });

    const addMemberOrCreateInviteFn = new appsync.AppsyncFunction(this, 'AddMemberOrCreateInviteFn', {
      name: 'addMemberOrCreateInvite',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userExists = ctx.stash.userExists;
  const invitedUserId = ctx.stash.invitedUserId;
  const teamId = ctx.stash.teamId;
  const email = ctx.stash.email;
  const role = ctx.stash.role;
  const title = ctx.stash.title;
  const inviterId = ctx.stash.userId;
  
  if (userExists && invitedUserId) {
    // User already exists - add them to team immediately
    const now = util.time.nowISO8601();
    const membershipId = util.autoId();
    
    return {
      operation: 'PutItem',
      key: util.dynamodb.toMapValues({
        pk: 'TEAM#' + teamId,
        sk: 'MEMBER#' + invitedUserId
      }),
      attributeValues: util.dynamodb.toMapValues({
        id: membershipId,
        userId: invitedUserId,
        teamId: teamId,
        role: role,
        joinedAt: now,
        title: title || null,
        hoursPerDay: 6,
        availability: 100,
        gsi1pk: 'USER#' + invitedUserId,
        gsi1sk: 'TEAM#' + teamId
      }),
      condition: { expression: 'attribute_not_exists(pk)' }
    };
  } else {
    // User doesn't exist yet - create invitation record for when they sign in
    // Store invitation by email so we can find it when user signs in
    const now = util.time.nowISO8601();
    const nowEpoch = util.time.nowEpochSeconds();
    const invitationId = util.autoId();
    const expiresInHours = 168; // 7 days default
    const ttl = nowEpoch + expiresInHours * 3600;
    
    ctx.stash.invitationId = invitationId;
    
    return {
      operation: 'PutItem',
      key: util.dynamodb.toMapValues({
        pk: 'TEAM_INVITE#' + email,
        sk: 'TEAM#' + teamId
      }),
      attributeValues: util.dynamodb.toMapValues({
        id: invitationId,
        email: email,
        teamId: teamId,
        role: role,
        title: title || null,
        invitedBy: inviterId,
        invitedAt: now,
        expiresAt: new Date((nowEpoch + expiresInHours * 3600) * 1000).toISOString(),
        status: 'PENDING',
        ttl: ttl,
        gsi1pk: 'TEAM#' + teamId,
        gsi1sk: 'INVITE#' + email + '#' + now,
      }),
      condition: { expression: 'attribute_not_exists(pk)' }
    };
  }
}
export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      if (ctx.stash.userExists) {
        util.error('User is already a member of this team', 'MemberAlreadyExists');
      } else {
        util.error('Invitation already exists for this email and team', 'InvitationExists');
      }
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  
  return ctx.result;
}
`.trim()),
    });

    new appsync.Resolver(this, 'InviteTeamMemberResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'inviteTeamMember',
      pipelineConfig: [verifyTeamOwnerAdminForInviteFn, checkOrCreateUserFn, addMemberOrCreateInviteFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) {
  return ctx.prev.result;
}
`.trim()),
    });

    // ============================================
    // Mutation.acceptPendingInvitations
    // ============================================
    const queryPendingInvitesForAcceptFn = new appsync.AppsyncFunction(this, 'QueryPendingInvitesForAcceptFn', {
      name: 'queryPendingInvitesForAccept',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const userId = ctx.identity.sub;
  
  // Get user's email from DynamoDB
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'USER#' + userId,
      sk: 'METADATA'
    })
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  const user = ctx.result;
  if (!user || !user.email) {
    ctx.stash.hasEmail = false;
    return { hasEmail: false, invites: [] };
  }
  
  const email = user.email.toLowerCase().trim();
  ctx.stash.email = email;
  ctx.stash.hasEmail = true;
  
  // Query for pending invitations by email
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'TEAM_INVITE#' + email,
        ':sk': 'TEAM#'
      })
    }
  };
}
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  if (!ctx.stash.hasEmail) {
    return { invites: [] };
  }
  
  const invites = ctx.result.items || [];
  const nowEpoch = util.time.nowEpochSeconds();
  
  // Filter out expired invitations
  const validInvites = invites.filter(inv => {
    if (inv.status !== 'PENDING') return false;
    if (inv.ttl && inv.ttl < nowEpoch) return false;
    return true;
  });
  
  ctx.stash.invites = validInvites;
  ctx.stash.userId = ctx.identity.sub;
  
  return { invites: validInvites };
}
`.trim()),
    });

    const createMembershipsFromInvitesFn = new appsync.AppsyncFunction(this, 'CreateMembershipsFromInvitesFn', {
      name: 'createMembershipsFromInvites',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const invites = ctx.stash.invites || [];
  const userId = ctx.stash.userId;
  
  if (invites.length === 0) {
    // No invites - return empty result
    return {
      operation: 'GetItem',
      key: util.dynamodb.toMapValues({ pk: 'NONE', sk: 'NONE' })
    };
  }
  
  // Process first invitation (we'll process others in subsequent pipeline functions if needed)
  // For simplicity, we'll process all in one batch operation
  // But AppSync doesn't support batch writes in JS resolvers, so we'll use a loop pattern
  // Actually, we need to create memberships one at a time
  const firstInvite = invites[0];
  ctx.stash.currentInvite = firstInvite;
  ctx.stash.processedCount = 0;
  ctx.stash.totalInvites = invites.length;
  
  const now = util.time.nowISO8601();
  const membershipId = util.autoId();
  
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM#' + firstInvite.teamId,
      sk: 'MEMBER#' + userId
    }),
    attributeValues: util.dynamodb.toMapValues({
      id: membershipId,
      userId: userId,
      teamId: firstInvite.teamId,
      role: firstInvite.role,
      joinedAt: now,
      title: firstInvite.title || null,
      hoursPerDay: 6,
      availability: 100,
      gsi1pk: 'USER#' + userId,
      gsi1sk: 'TEAM#' + firstInvite.teamId
    }),
    condition: { expression: 'attribute_not_exists(pk)' }
  };
}
export function response(ctx) {
  if (ctx.error) {
    // If membership already exists, that's okay - continue
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      ctx.stash.processedCount = (ctx.stash.processedCount || 0) + 1;
      return { success: true, skipped: true };
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  
  ctx.stash.processedCount = (ctx.stash.processedCount || 0) + 1;
  return { success: true };
}
`.trim()),
    });

    const deleteInvitationRecordsFn = new appsync.AppsyncFunction(this, 'DeleteInvitationRecordsFn', {
      name: 'deleteInvitationRecords',
      api: api,
      dataSource: dynamoDs,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const invites = ctx.stash.invites || [];
  const email = ctx.stash.email;
  
  if (invites.length === 0) {
    return {
      operation: 'GetItem',
      key: util.dynamodb.toMapValues({ pk: 'NONE', sk: 'NONE' })
    };
  }
  
  // Delete first invitation record
  const firstInvite = invites[0];
  
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({
      pk: 'TEAM_INVITE#' + email,
      sk: 'TEAM#' + firstInvite.teamId
    })
  };
}
export function response(ctx) {
  if (ctx.error && ctx.error.type !== 'DynamoDB:ResourceNotFoundException') {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  return { deleted: true };
}
`.trim()),
    });

    new appsync.Resolver(this, 'AcceptPendingInvitationsResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'acceptPendingInvitations',
      pipelineConfig: [queryPendingInvitesForAcceptFn, createMembershipsFromInvitesFn, deleteInvitationRecordsFn],
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) { return {}; }
export function response(ctx) {
  const processedCount = ctx.stash.processedCount || 0;
  return processedCount > 0;
}
`.trim()),
    });
  }
}
