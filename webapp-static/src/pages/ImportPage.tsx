import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import {
  listTeamsForUser,
  listProjectsByTeam,
  createProject,
  createComponent,
  getCurrentUserId,
  type TeamWithMembers,
  type Project,
  type ComponentType,
} from '../api/appsync';
import {
  Upload,
  FileSpreadsheet,
  FileJson,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertTriangle,
  Loader2,
  Download,
} from 'lucide-react';

interface Mapping {
  sourceColumn: string;
  targetField: string | null;
}

const targetFieldOptions = [
  { value: '', label: '— Skip —' },
  { value: 'name', label: 'Name (required)' },
  { value: 'description', label: 'Description' },
  { value: 'type', label: 'Type (Epic/Feature/Story/Task/Bug)' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'estimatedHours', label: 'Estimated Hours' },
  { value: 'owner', label: 'Owner/Assignee' },
  { value: 'tags', label: 'Tags (comma-separated)' },
];

export function ImportPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [loading, setLoading] = useState(true);

  // File data
  const [fileName, setFileName] = useState('');
  const [, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // Import results
  const [importStats, setImportStats] = useState<{
    created: number;
    errors: string[];
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function loadData() {
      try {
        const teamsData = await listTeamsForUser();
        setTeams(teamsData);
        if (teamsData.length > 0) {
          setSelectedTeamId(teamsData[0].team.id);
        }
      } catch (err) {
        console.error('Failed to load teams:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isAuthenticated]);

  // Load projects when team changes
  useEffect(() => {
    if (!selectedTeamId) return;

    async function loadProjects() {
      try {
        const projectsData = await listProjectsByTeam(selectedTeamId);
        setProjects(projectsData);
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    }

    loadProjects();
  }, [selectedTeamId]);

  // Parse CSV
  const parseCSV = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const hdrs = parseLine(lines[0]);
    const rws = lines.slice(1).map((line) => {
      const values = parseLine(line);
      const row: Record<string, string> = {};
      hdrs.forEach((h, i) => {
        row[h] = values[i] || '';
      });
      return row;
    });

    return { headers: hdrs, rows: rws };
  };

  // Parse JSON
  const parseJSON = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : data.issues || data.items || data.data || [data];

    if (items.length === 0) return { headers: [], rows: [] };

    const flatten = (obj: Record<string, unknown>, prefix = ''): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(result, flatten(value as Record<string, unknown>, newKey));
        } else {
          result[newKey] = String(value ?? '');
        }
      }
      return result;
    };

    const rws = items.map((item: Record<string, unknown>) => flatten(item));
    const allKeys = rws.flatMap((r: Record<string, string>) => Object.keys(r));
    const hdrs = [...new Set(allKeys)] as string[];

    return { headers: hdrs, rows: rws };
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        let parsed;
        if (file.name.endsWith('.json')) {
          parsed = parseJSON(text);
        } else {
          parsed = parseCSV(text);
        }

        if (parsed.headers.length === 0) {
          alert('No data found in file');
          return;
        }

        setHeaders(parsed.headers);
        setRows(parsed.rows);

        // Auto-map common column names
        const autoMappings: Mapping[] = parsed.headers.map((h) => {
          const lower = h.toLowerCase();
          let targetField: string | null = null;

          if (lower.includes('name') || lower === 'title' || lower === 'summary') {
            targetField = 'name';
          } else if (lower.includes('desc') || lower === 'body') {
            targetField = 'description';
          } else if (lower === 'type' || lower.includes('issuetype')) {
            targetField = 'type';
          } else if (lower === 'status' || lower === 'state') {
            targetField = 'status';
          } else if (lower.includes('priority')) {
            targetField = 'priority';
          } else if (lower.includes('estimate') || lower.includes('hours')) {
            targetField = 'estimatedHours';
          } else if (lower.includes('assignee') || lower.includes('owner')) {
            targetField = 'owner';
          } else if (lower.includes('tag') || lower.includes('label')) {
            targetField = 'tags';
          }

          return { sourceColumn: h, targetField };
        });

        setMappings(autoMappings);
        setStep(2);
      } catch (error) {
        alert('Failed to parse file: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    };

    reader.readAsText(file);
  }, []);

  const updateMapping = (sourceColumn: string, targetField: string | null) => {
    setMappings((prev) =>
      prev.map((m) => (m.sourceColumn === sourceColumn ? { ...m, targetField } : m))
    );
  };

  const handleExecuteImport = async () => {
    if (!mappings.some((m) => m.targetField === 'name')) {
      alert('You must map at least one column to "Name"');
      return;
    }

    setStep(3);

    let projectId = selectedProjectId;
    const errors: string[] = [];
    let created = 0;

    try {
      // Create project if needed
      if (!projectId) {
        const ownerId = await getCurrentUserId();
        if (!ownerId) {
          alert('Unable to identify current user. Please sign in again.');
          setStep(2);
          return;
        }
        const name = newProjectName || `Imported ${new Date().toLocaleDateString()}`;
        const newProject = await createProject({
          id: crypto.randomUUID(),
          teamId: selectedTeamId,
          ownerId,
          name,
        });
        projectId = newProject.id;
      }

      // Import each row as a component
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const nameMapping = mappings.find((m) => m.targetField === 'name');
          const name = nameMapping ? row[nameMapping.sourceColumn] : '';

          if (!name?.trim()) {
            errors.push(`Row ${i + 1}: Missing name, skipped`);
            continue;
          }

          // Build component data
          const descMapping = mappings.find((m) => m.targetField === 'description');
          const typeMapping = mappings.find((m) => m.targetField === 'type');
          const priorityMapping = mappings.find((m) => m.targetField === 'priority');
          const estimateMapping = mappings.find((m) => m.targetField === 'estimatedHours');
          const ownerMapping = mappings.find((m) => m.targetField === 'owner');
          const tagsMapping = mappings.find((m) => m.targetField === 'tags');

          // Parse type
          let type: ComponentType = 'TASK';
          if (typeMapping) {
            const typeVal = row[typeMapping.sourceColumn]?.toUpperCase();
            if (['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'].includes(typeVal)) {
              type = typeVal as ComponentType;
            }
          }

          // Parse priority
          let priority: number | undefined;
          if (priorityMapping) {
            const pVal = row[priorityMapping.sourceColumn]?.toLowerCase();
            if (pVal === 'highest' || pVal === 'critical' || pVal === '5') priority = 5;
            else if (pVal === 'high' || pVal === '4') priority = 4;
            else if (pVal === 'medium' || pVal === '3') priority = 3;
            else if (pVal === 'low' || pVal === '2') priority = 2;
            else if (pVal === 'lowest' || pVal === '1') priority = 1;
          }

          // Parse estimated hours
          let estimatedHours: number | undefined;
          if (estimateMapping) {
            const est = parseFloat(row[estimateMapping.sourceColumn]);
            if (!isNaN(est) && est >= 0) estimatedHours = est;
          }

          // Parse tags
          let tags: string[] | undefined;
          if (tagsMapping) {
            const tagsVal = row[tagsMapping.sourceColumn];
            if (tagsVal) {
              tags = tagsVal.split(',').map((t) => t.trim()).filter(Boolean);
            }
          }

          await createComponent({
            id: crypto.randomUUID(),
            projectId,
            name: name.trim(),
            description: descMapping ? row[descMapping.sourceColumn] : undefined,
            type,
            priority,
            estimatedHours,
            owner: ownerMapping ? row[ownerMapping.sourceColumn] : undefined,
            tags,
          });

          created++;
        } catch (err) {
          errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Failed to create'}`);
        }
      }

      setImportStats({ created, errors });
      setStep(4);
    } catch (err) {
      alert('Import failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStep(2);
    }
  };

  const downloadTemplate = () => {
    const templateHeaders = ['name', 'description', 'type', 'status', 'priority', 'estimatedHours'];
    const exampleRow = ['Login Feature', 'Implement user login', 'FEATURE', 'PLANNING', 'High', '8'];
    const csv = [templateHeaders.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasktitan-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <div className="flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <h1 className="text-2xl font-bold mb-6">Import Data</h1>
        <p className="text-slate-400 mb-4">Sign in to import data.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="btn-primary"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <h1 className="text-2xl font-bold mb-6">Import Data</h1>
        <p className="text-slate-400 mb-4">Create a team first to import data.</p>
        <button onClick={() => navigate('/team/new')} className="btn-primary">
          Create Team
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
            <Upload className="w-6 h-6 text-violet-400" />
          </div>
          Import Wizard
        </h1>
        <p className="text-slate-400 mt-2">Import work items from CSV, JSON, or Jira exports</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step >= s
                  ? 'bg-gradient-to-r from-violet-600 to-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            {s < 4 && <div className={`w-12 h-0.5 ${step > s ? 'bg-cyan-500' : 'bg-slate-700'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="component-card">
          <h2 className="text-xl font-semibold mb-4">Step 1: Upload Your Data</h2>

          {/* Team selector */}
          <div className="mb-6">
            <label className="block text-sm text-slate-400 mb-2">Import to Team</label>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
            >
              {teams.map((t) => (
                <option key={t.team.id} value={t.team.id}>
                  {t.team.name}
                </option>
              ))}
            </select>
          </div>

          {/* File upload */}
          <label className="block">
            <div className="border-2 border-dashed border-slate-700 hover:border-violet-500/50 rounded-2xl p-12 text-center cursor-pointer transition-colors">
              <div className="flex justify-center gap-4 mb-4">
                <FileSpreadsheet className="w-12 h-12 text-green-400" />
                <FileJson className="w-12 h-12 text-amber-400" />
              </div>
              <p className="text-lg font-medium text-slate-300 mb-2">
                Drop your file here or click to upload
              </p>
              <p className="text-sm text-slate-500">Supports CSV, JSON, and Jira exports</p>
            </div>
            <input
              type="file"
              accept=".csv,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          <div className="mt-6 p-4 bg-slate-800/50 rounded-xl">
            <h3 className="font-medium text-slate-300 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              Smart Column Mapping
            </h3>
            <p className="text-sm text-slate-400">
              Common column names will be automatically mapped. You can review and adjust before
              importing.
            </p>
          </div>

          {/* Download template link */}
          <div className="mt-4 flex items-center justify-center">
            <button
              type="button"
              onClick={downloadTemplate}
              className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download CSV template
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review Mappings */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="component-card">
            <h2 className="text-xl font-semibold mb-2">Step 2: Review Mappings</h2>
            <p className="text-slate-400 mb-4">
              File: <span className="text-cyan-400">{fileName}</span> ({rows.length} rows)
            </p>

            {/* Project selection */}
            <div className="grid sm:grid-cols-2 gap-4 mb-6 p-4 bg-slate-800/50 rounded-xl">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Import to Project</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100"
                >
                  <option value="">+ Create New Project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!selectedProjectId && (
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New project name"
                    className="w-full mt-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500"
                  />
                )}
              </div>
            </div>

            {/* Mapping table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-slate-500 border-b border-slate-700">
                    <th className="pb-3">Source Column</th>
                    <th className="pb-3">Sample Value</th>
                    <th className="pb-3">Maps To</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.sourceColumn} className="border-b border-slate-800">
                      <td className="py-3 font-medium text-slate-300">{m.sourceColumn}</td>
                      <td className="py-3 text-sm text-slate-500 truncate max-w-[200px]">
                        {rows[0]?.[m.sourceColumn] || '—'}
                      </td>
                      <td className="py-3">
                        <select
                          value={m.targetField || ''}
                          onChange={(e) => updateMapping(m.sourceColumn, e.target.value || null)}
                          className={`px-3 py-1.5 bg-slate-900 border rounded-lg text-sm ${
                            m.targetField === 'name'
                              ? 'border-cyan-500 text-cyan-400'
                              : m.targetField
                                ? 'border-slate-600 text-slate-200'
                                : 'border-slate-700 text-slate-500'
                          }`}
                        >
                          {targetFieldOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!mappings.some((m) => m.targetField === 'name') && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-sm text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  You must map at least one column to "Name" to continue
                </p>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="component-card">
            <h3 className="font-medium mb-3">Preview ({Math.min(5, rows.length)} of {rows.length} rows)</h3>
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-left text-slate-500 border-b border-slate-700">
                    <th className="pb-2 pr-2 w-8">#</th>
                    {mappings
                      .filter((m) => m.targetField)
                      .map((m) => (
                        <th key={m.sourceColumn} className="pb-2 pr-4">
                          {m.targetField}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="py-2 pr-2 text-slate-500 text-xs">{i + 1}</td>
                      {mappings
                        .filter((m) => m.targetField)
                        .map((m) => (
                          <td key={m.sourceColumn} className="py-2 pr-4 text-slate-300 truncate max-w-[200px]">
                            {row[m.sourceColumn] || <span className="text-slate-600">—</span>}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <button
              onClick={() => {
                setStep(1);
                setHeaders([]);
                setRows([]);
                setMappings([]);
              }}
              className="px-4 py-2 text-slate-400 hover:text-white flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Start Over
            </button>
            <button
              onClick={handleExecuteImport}
              disabled={!mappings.some((m) => m.targetField === 'name')}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import {rows.length} Items
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Importing */}
      {step === 3 && (
        <div className="component-card text-center py-12">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Importing Data</h2>
          <p className="text-slate-400">Creating work items...</p>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && importStats && (
        <div className="component-card text-center py-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-r from-green-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Import Complete!</h2>
          <p className="text-slate-400 mb-6">
            Successfully imported{' '}
            <span className="text-cyan-400 font-semibold">{importStats.created}</span> items
          </p>

          {importStats.errors.length > 0 && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-left max-h-40 overflow-y-auto">
              <h4 className="text-sm font-medium text-red-400 mb-2">
                Errors ({importStats.errors.length})
              </h4>
              <ul className="text-xs text-red-300/70 space-y-1">
                {importStats.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
                {importStats.errors.length > 10 && (
                  <li className="text-slate-500">...and {importStats.errors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="flex justify-center gap-4">
            <button
              onClick={() => {
                setStep(1);
                setHeaders([]);
                setRows([]);
                setMappings([]);
                setImportStats(null);
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
            >
              Import More
            </button>
            <button onClick={() => navigate(`/team/${selectedTeamId}`)} className="btn-primary">
              View Team
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
