import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import NewTeamForm from './NewTeamForm';
import DemoNewTeamPage from './DemoNewTeamPage';

export default async function NewTeamPage() {
  const session = await getSession();
  const { user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoNewTeamPage />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />
      <main className="flex-grow">
        <NewTeamForm />
      </main>
    </div>
  );
}
