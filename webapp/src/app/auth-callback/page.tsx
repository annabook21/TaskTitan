import { redirect } from 'next/navigation';
import { getSession, UserNotCreatedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
      await prisma.user.create({
        data: {
          id: userId,
          email: email,
        },
      });
    } else {
      throw e;
    }
  }
  redirect('/');
}
