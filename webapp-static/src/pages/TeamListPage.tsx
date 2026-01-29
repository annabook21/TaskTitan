export function TeamListPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Teams</h1>
      <p className="text-slate-400 mb-6">
        Team list requires listTeams query (not yet in schema). Use direct link to a team:
      </p>
      <p className="text-slate-500 text-sm">
        Navigate to <code className="bg-slate-800 px-1 rounded">/team/:teamId</code> with a known team ID, or add listTeams to AppSync schema.
      </p>
    </div>
  );
}
