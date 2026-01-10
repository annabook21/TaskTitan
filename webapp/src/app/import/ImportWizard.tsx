'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { analyzeImport, executeImport } from './actions';
import {
  Upload,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertTriangle,
  Loader2,
  ChevronDown,
  X,
  FileJson,
} from 'lucide-react';
import { toast } from 'sonner';

interface Team {
  id: string;
  name: string;
  Project: { id: string; name: string }[];
  Sprint: { id: string; name: string }[];
}

interface Mapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
}

interface Props {
  teams: Team[];
  selectedTeam: Team;
}

const targetFieldOptions = [
  { value: '', label: '— Skip —' },
  { value: 'name', label: 'Name (required)' },
  { value: 'description', label: 'Description' },
  { value: 'type', label: 'Type (Epic/Feature/Story/Task/Bug)' },
  { value: 'parentName', label: 'Parent Name (for hierarchy)' },
  { value: 'owner', label: 'Owner/Assignee' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'estimatedHours', label: 'Estimated Hours' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'tags', label: 'Tags (comma-separated)' },
  { value: 'externalId', label: 'External ID (e.g., Jira key)' },
  { value: 'dependencies', label: 'Dependencies (comma-separated)' },
];

export default function ImportWizard({ teams, selectedTeam }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [teamId, setTeamId] = useState(selectedTeam.id);
  const [projectId, setProjectId] = useState<string>('');
  const [newProjectName, setNewProjectName] = useState('');
  const [sprintId, setSprintId] = useState<string>('');

  // File data
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // AI analysis results
  const [detectedFormat, setDetectedFormat] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Import results
  const [importStats, setImportStats] = useState<{
    created: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const currentTeam = teams.find((t) => t.id === teamId) || selectedTeam;

  const { execute: analyze, isExecuting: isAnalyzing } = useAction(analyzeImport, {
    onSuccess: ({ data }) => {
      if (data) {
        setMappings(data.mappings);
        setDetectedFormat(data.detectedFormat);
        setSuggestions(data.suggestions);
        setWarnings(data.warnings);
        setStep(3);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to analyze data');
    },
  });

  const { execute: doImport, isExecuting: isImporting } = useAction(executeImport, {
    onSuccess: ({ data }) => {
      if (data) {
        setImportStats(data.stats);
        setStep(5);
        toast.success(`Imported ${data.stats.created} items!`);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Import failed');
    },
  });

  // Parse CSV
  const parseCSV = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    // Simple CSV parsing (handles basic quoted fields)
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

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const values = parseLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || '';
      });
      return row;
    });

    return { headers, rows };
  };

  // Parse JSON
  const parseJSON = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : data.issues || data.items || data.data || [data];

    if (items.length === 0) return { headers: [], rows: [] };

    // Flatten nested objects
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

    const rows = items.map((item: Record<string, unknown>) => flatten(item));
    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];

    return { headers, rows };
  };

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
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
            toast.error('No data found in file');
            return;
          }

          setHeaders(parsed.headers);
          setRows(parsed.rows);
          setStep(2);

          // Trigger AI analysis
          analyze({
            teamId,
            headers: parsed.headers,
            sampleRows: parsed.rows.slice(0, 5),
          });
        } catch (error) {
          toast.error('Failed to parse file: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
      };

      reader.readAsText(file);
    },
    [teamId, analyze],
  );

  const updateMapping = (sourceColumn: string, targetField: string | null) => {
    setMappings((prev) =>
      prev.map((m) => (m.sourceColumn === sourceColumn ? { ...m, targetField, confidence: 1 } : m)),
    );
  };

  const handleExecuteImport = () => {
    if (!mappings.some((m) => m.targetField === 'name')) {
      toast.error('You must map at least one column to "Name"');
      return;
    }

    setStep(4);
    doImport({
      teamId,
      projectId: projectId || undefined,
      projectName: projectId ? undefined : newProjectName || `Imported ${new Date().toLocaleDateString()}`,
      mappings: mappings.map((m) => ({ sourceColumn: m.sourceColumn, targetField: m.targetField })),
      rows,
      createMissingParents: true,
      autoAssignSprint: sprintId || undefined,
    });
  };

  return (
    <div className="space-y-8">
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
        {[1, 2, 3, 4, 5].map((s) => (
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
            {s < 5 && <div className={`w-8 h-0.5 ${step > s ? 'bg-cyan-500' : 'bg-slate-700'}`} />}
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
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
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
              <p className="text-lg font-medium text-slate-300 mb-2">Drop your file here or click to upload</p>
              <p className="text-sm text-slate-500">Supports CSV, JSON, and Jira exports</p>
            </div>
            <input type="file" accept=".csv,.json" onChange={handleFileUpload} className="hidden" />
          </label>

          <div className="mt-6 p-4 bg-slate-800/50 rounded-xl">
            <h3 className="font-medium text-slate-300 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              AI-Powered Mapping
            </h3>
            <p className="text-sm text-slate-400">
              Our AI will analyze your data and automatically map columns to the right fields. You can review and
              adjust before importing.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Analyzing */}
      {step === 2 && (
        <div className="component-card text-center py-12">
          <Loader2 className="w-12 h-12 text-violet-400 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Analyzing Your Data</h2>
          <p className="text-slate-400">AI is examining {rows.length} rows to suggest the best mappings...</p>
        </div>
      )}

      {/* Step 3: Review Mappings */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="component-card">
            <h2 className="text-xl font-semibold mb-2">Step 2: Review Mappings</h2>
            <p className="text-slate-400 mb-4">
              AI detected: <span className="text-cyan-400">{detectedFormat}</span> ({rows.length} rows)
            </p>

            {/* Project selection */}
            <div className="grid sm:grid-cols-2 gap-4 mb-6 p-4 bg-slate-800/50 rounded-xl">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Import to Project</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100"
                >
                  <option value="">+ Create New Project</option>
                  {currentTeam.Project.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!projectId && (
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New project name"
                    className="w-full mt-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-2">Auto-assign to Sprint (optional)</label>
                <select
                  value={sprintId}
                  onChange={(e) => setSprintId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100"
                >
                  <option value="">Keep in Backlog</option>
                  {currentTeam.Sprint.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                <h4 className="text-sm font-medium text-cyan-400 mb-1">💡 Suggestions</h4>
                <ul className="text-sm text-cyan-300/80 space-y-1">
                  {suggestions.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <h4 className="text-sm font-medium text-amber-400 flex items-center gap-1 mb-1">
                  <AlertTriangle className="w-4 h-4" /> Warnings
                </h4>
                <ul className="text-sm text-amber-300/80 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Mapping table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-slate-500 border-b border-slate-700">
                    <th className="pb-3">Source Column</th>
                    <th className="pb-3">Sample Value</th>
                    <th className="pb-3">Maps To</th>
                    <th className="pb-3 text-right">Confidence</th>
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
                      <td className="py-3 text-right">
                        {m.targetField && (
                          <span
                            className={`text-sm ${
                              m.confidence >= 0.8
                                ? 'text-green-400'
                                : m.confidence >= 0.5
                                  ? 'text-amber-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {Math.round(m.confidence * 100)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Preview */}
          <div className="component-card">
            <h3 className="font-medium mb-3">Preview (first 3 rows)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-700">
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
                  {rows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-b border-slate-800">
                      {mappings
                        .filter((m) => m.targetField)
                        .map((m) => (
                          <td key={m.sourceColumn} className="py-2 pr-4 text-slate-300 truncate max-w-[150px]">
                            {row[m.sourceColumn] || '—'}
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
              className="btn-primary"
            >
              Import {rows.length} Items
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Importing */}
      {step === 4 && (
        <div className="component-card text-center py-12">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Importing Data</h2>
          <p className="text-slate-400">Creating work items, resolving hierarchy, linking dependencies...</p>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && importStats && (
        <div className="component-card text-center py-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-r from-green-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Import Complete!</h2>
          <p className="text-slate-400 mb-6">
            Successfully imported <span className="text-cyan-400 font-semibold">{importStats.created}</span> items
            {importStats.skipped > 0 && (
              <span className="text-slate-500"> ({importStats.skipped} skipped)</span>
            )}
          </p>

          {/* Warnings */}
          {importStats.warnings.length > 0 && (
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-left max-h-40 overflow-y-auto">
              <h4 className="text-sm font-medium text-amber-400 mb-2">Warnings ({importStats.warnings.length})</h4>
              <ul className="text-xs text-amber-300/70 space-y-1">
                {importStats.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
                {importStats.warnings.length > 10 && (
                  <li className="text-slate-500">...and {importStats.warnings.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Errors */}
          {importStats.errors.length > 0 && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-left max-h-40 overflow-y-auto">
              <h4 className="text-sm font-medium text-red-400 mb-2">Errors ({importStats.errors.length})</h4>
              <ul className="text-xs text-red-300/70 space-y-1">
                {importStats.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
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
            <button onClick={() => router.push(`/team/${teamId}`)} className="btn-primary">
              View Team
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
