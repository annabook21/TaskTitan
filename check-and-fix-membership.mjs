// Script to check and fix membership via Lambda
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({ region: 'us-west-2' });
const functionName = 'TaskTitanStack-WebappMigrationRunnerAC67C012-DjTW509ewwrC';

// Custom migration command to check membership
const checkPayload = {
  command: 'custom-check',
  code: `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const users = await prisma.user.findMany({
      include: {
        Membership: {
          include: { Team: true }
        }
      }
    });

    const result = users.map(u => ({
      userId: u.id,
      email: u.email,
      memberships: u.Membership.map(m => ({
        teamId: m.teamId,
        teamName: m.Team.name,
        role: m.role
      }))
    }));

    await prisma.$disconnect();
    return result;
  `
};

console.log('Checking current memberships...\n');

const checkCommand = new InvokeCommand({
  FunctionName: functionName,
  Payload: JSON.stringify(checkPayload)
});

try {
  const response = await lambda.send(checkCommand);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}
