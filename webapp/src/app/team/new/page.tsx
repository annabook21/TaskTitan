import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import NewTeamForm from './NewTeamForm';

export default async function NewTeamPage() {
  const { user } = await getSession();

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />
      <main className="flex-grow">
        <NewTeamForm />
      </main>
    </div>
  );
}
