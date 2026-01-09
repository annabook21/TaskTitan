import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';

export default async function PrivacyPage() {
  let user = null;
  try {
    const session = await getSession();
    user = session.user;
  } catch {
    // Not logged in, that's fine for privacy page
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>

          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
              <Shield className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Privacy Policy</h1>
              <p className="text-slate-400">How we handle your data</p>
            </div>
          </div>

          <div className="prose prose-invert prose-slate max-w-none">
            <div className="component-card space-y-6">
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Data Collection</h2>
                <p className="text-slate-400">
                  TaskTitan collects only the information necessary to provide our service:
                </p>
                <ul className="list-disc list-inside text-slate-400 space-y-2 mt-3">
                  <li>Account information (email, name) for authentication</li>
                  <li>Project and component data you create</li>
                  <li>Team membership information</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Data Storage</h2>
                <p className="text-slate-400">
                  Your data is stored securely on AWS infrastructure with encryption at rest
                  and in transit. We use Amazon Aurora PostgreSQL for reliable data storage
                  with automated backups.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Data Sharing</h2>
                <p className="text-slate-400">
                  We do not sell or share your personal data with third parties. Your project
                  data is only visible to team members you explicitly invite.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">AI Features</h2>
                <p className="text-slate-400">
                  When using AI component generation, your project description is sent to
                  OpenAI&apos;s API for processing. OpenAI&apos;s data handling policies apply to this
                  interaction.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Contact</h2>
                <p className="text-slate-400">
                  For privacy-related inquiries, please contact us through the application.
                </p>
              </section>
            </div>
          </div>

          <div className="mt-8 text-center text-sm text-slate-500">
            Last updated: January 2026
          </div>
        </div>
      </main>
    </div>
  );
}
