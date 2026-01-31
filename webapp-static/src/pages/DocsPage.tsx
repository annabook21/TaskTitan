import { Link } from 'react-router-dom';

export function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Documentation</h1>

      {/* Quick Start */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Quick Start</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <ol className="list-decimal list-inside space-y-3 text-slate-300">
            <li>
              <strong className="text-white">Create a Team</strong> - Navigate to{' '}
              <Link to="/teams" className="text-cyan-400 hover:underline">Teams</Link> and create your first team.
            </li>
            <li>
              <strong className="text-white">Add Team Members</strong> - Invite collaborators to join your team with different roles.
            </li>
            <li>
              <strong className="text-white">Create a Project</strong> - Go to{' '}
              <Link to="/projects" className="text-cyan-400 hover:underline">Projects</Link> and create a project within your team.
            </li>
            <li>
              <strong className="text-white">Add Components</strong> - Break down your project into Epics, Features, Stories, Tasks, and Bugs.
            </li>
            <li>
              <strong className="text-white">Track Progress</strong> - Use the Kanban board to move components through status columns.
            </li>
          </ol>
        </div>
      </section>

      {/* Component Types */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Component Types</h2>
        <div className="grid gap-4">
          <div className="bg-slate-800 border border-violet-500/30 rounded-lg p-4">
            <h3 className="text-lg font-medium text-violet-300 mb-2">Epic</h3>
            <p className="text-slate-400">
              Large initiatives that span multiple sprints. Epics contain Features and provide high-level tracking of major project goals.
            </p>
          </div>
          <div className="bg-slate-800 border border-blue-500/30 rounded-lg p-4">
            <h3 className="text-lg font-medium text-blue-300 mb-2">Feature</h3>
            <p className="text-slate-400">
              Functional capabilities that deliver value. Features group related Stories and can be completed within 1-3 sprints.
            </p>
          </div>
          <div className="bg-slate-800 border border-cyan-500/30 rounded-lg p-4">
            <h3 className="text-lg font-medium text-cyan-300 mb-2">Story</h3>
            <p className="text-slate-400">
              User-facing functionality described from the user's perspective. Stories should be completable within a single sprint.
            </p>
          </div>
          <div className="bg-slate-800 border border-emerald-500/30 rounded-lg p-4">
            <h3 className="text-lg font-medium text-emerald-300 mb-2">Task</h3>
            <p className="text-slate-400">
              Technical work items that don't deliver direct user value. Tasks are typically smaller and more focused than Stories.
            </p>
          </div>
          <div className="bg-slate-800 border border-red-500/30 rounded-lg p-4">
            <h3 className="text-lg font-medium text-red-300 mb-2">Bug</h3>
            <p className="text-slate-400">
              Defects or issues that need to be fixed. Bugs track problems in existing functionality.
            </p>
          </div>
        </div>
      </section>

      {/* Status Workflow */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Status Workflow</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex flex-wrap items-center gap-4 justify-center">
            <div className="px-4 py-2 bg-slate-700 rounded-lg text-slate-300 font-medium">Planning</div>
            <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-300 font-medium">Ready</div>
            <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="px-4 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-300 font-medium">In Progress</div>
            <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="px-4 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-300 font-medium">Review</div>
            <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg text-green-300 font-medium">Done</div>
          </div>
          <p className="text-slate-400 text-sm mt-4 text-center">
            Drag components between columns on the Kanban board to update their status.
          </p>
        </div>
      </section>

      {/* AI Features */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">AI Features</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h3 className="text-lg font-medium text-violet-300 mb-3">AI Component Generator</h3>
          <p className="text-slate-400 mb-4">
            Use natural language to describe what you want to build, and the AI will generate a structured breakdown of work items.
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            <li>Describe features, user flows, or technical requirements</li>
            <li>AI suggests component types, estimates, and priorities</li>
            <li>Review and select which suggestions to create</li>
            <li>Powered by Amazon Bedrock (Claude)</li>
          </ul>
        </div>
      </section>

      {/* Team Roles */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Team Roles</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="px-4 py-3 text-slate-300 font-medium">Role</th>
                <th className="px-4 py-3 text-slate-300 font-medium">Permissions</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              <tr className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">Owner</td>
                <td className="px-4 py-3">Full access including team deletion and member management</td>
              </tr>
              <tr className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">Admin</td>
                <td className="px-4 py-3">Create/edit projects, manage members (except owner)</td>
              </tr>
              <tr className="border-b border-slate-700/50">
                <td className="px-4 py-3 text-white font-medium">Member</td>
                <td className="px-4 py-3">Create and manage components, update status</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-white font-medium">Viewer</td>
                <td className="px-4 py-3">Read-only access to team resources</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Keyboard Shortcuts */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Keyboard Shortcuts</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="grid gap-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-300">Quick search</span>
              <kbd className="px-2 py-1 bg-slate-700 rounded text-sm text-slate-300 font-mono">/</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-300">New component</span>
              <kbd className="px-2 py-1 bg-slate-700 rounded text-sm text-slate-300 font-mono">N</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-300">Close modal</span>
              <kbd className="px-2 py-1 bg-slate-700 rounded text-sm text-slate-300 font-mono">Esc</kbd>
            </div>
          </div>
        </div>
      </section>

      {/* Support */}
      <section>
        <h2 className="text-2xl font-semibold mb-4 text-cyan-400">Need Help?</h2>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <p className="text-slate-400 mb-4">
            If you have questions or need assistance, please reach out through one of these channels:
          </p>
          <ul className="space-y-2 text-slate-300">
            <li>
              <a href="mailto:support@tasktitan.dev" className="text-cyan-400 hover:underline">
                support@tasktitan.dev
              </a>
            </li>
            <li>
              <a href="https://github.com/tasktitan/tasktitan" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                GitHub Issues
              </a>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
