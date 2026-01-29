import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTeam, listProjectsByTeam, createProject, getCurrentUserId } from '@/api/appsync';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<{ id: string; name: string; description?: string | null } | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([getTeam(id), listProjectsByTeam(id)])
      .then(([t, list]) => {
        setTeam(t ?? null);
        setProjects(list);
      })
      .catch((err) => setError(err?.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !newName.trim()) return;
    const userId = await getCurrentUserId();
    if (!userId) {
      setError('Sign in required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        id: crypto.randomUUID(),
        teamId: id,
        ownerId: userId,
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setProjects((prev) => [...prev, { id: project.id, name: project.name }]);
      setNewName('');
      setNewDesc('');
    } catch (err) {
      setError((err as Error)?.message ?? 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (error && !team) return <p className="text-red-400">{error}</p>;
  if (!team) return <p className="text-slate-400">Team not found.</p>;

  return (
    <div>
      <Link to="/team" className="text-cyan-400 hover:underline mb-4 inline-block">
        ← Teams
      </Link>
      <h1 className="text-2xl font-bold mb-2">{team.name}</h1>
      {team.description && <p className="text-slate-400 mb-6">{team.description}</p>}
      <h2 className="text-lg font-semibold mb-2">Projects</h2>
      <ul className="mb-6 space-y-2">
        {projects.length === 0 ? (
          <li className="text-slate-500">No projects yet.</li>
        ) : (
          projects.map((p) => (
            <li key={p.id}>
              <span className="text-slate-300">{p.name}</span>
            </li>
          ))
        )}
      </ul>
      <form onSubmit={handleCreate} className="space-y-2 max-w-md">
        <input
          type="text"
          placeholder="Project name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Project'}
        </button>
      </form>
      {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
    </div>
  );
}
