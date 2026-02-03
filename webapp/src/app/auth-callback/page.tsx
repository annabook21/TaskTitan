import { redirect } from 'next/navigation';
import { getSession, UserNotCreatedError } from '@/lib/auth';
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';

export const dynamic = 'force-dynamic';

export default async function AuthCallbackPage() {
  // Note: Demo cookie is cleared in the auth route handler (sign-in-callback)
  // before redirecting here. cookies().delete() doesn't work in Server Components.

  try {
    await getSession();
  } catch (e) {
    console.log(e);
    if (e instanceof UserNotCreatedError) {
      const { userId, email } = e;
      console.log('Creating new user:', userId);

      const entities = getEntities();

      // Create user in DynamoDB
      await dualWrite(
        'user',
        'create',
        async () => null, // Prisma removed - DynamoDB only
        async () => {
          const now = new Date().toISOString();
          const result = await entities.user
            .create({
              id: userId,
              email: email,
              createdAt: now,
              updatedAt: now,
            })
            .go();
          return result.data;
        },
        { context: { action: 'auth-callback-createUser', userId, email } },
      );
    } else {
      throw e;
    }
  }
  redirect('/');
}
