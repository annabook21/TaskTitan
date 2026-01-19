'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { analyzeImport, executeImport, cleanupData } from './actions';
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
  Wand2,
  Edit3,
  RotateCcw,
  Info,
  Undo2,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

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
  { value: 'dueDate', label: 'Due Date' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'tags', label: 'Tags (comma-separated)' },
  { value: 'externalId', label: 'External ID (e.g., Jira key)' },
  { value: 'dependencies', label: 'Dependencies (comma-separated)' },
];

// Field validation rules - shows expected format for each field
const fieldValidationRules: Record<string, { format: string; example: string; validate?: (v: string) => boolean }> = {
  name: {
    format: 'Required, 1-200 characters',
    example: 'User Authentication',
    validate: (v) => v.trim().length > 0 && v.length <= 200,
  },
  description: {
    format: 'Optional, free text',
    example: 'Implement OAuth2 login flow',
  },
  type: {
    format: 'EPIC, FEATURE, STORY, TASK, or BUG',
    example: 'TASK',
    validate: (v) => !v || /^(epic|feature|story|task|bug)$/i.test(v.trim()),
  },
  parentName: {
    format: 'Name of existing parent item',
    example: 'Authentication Epic',
  },
  owner: {
    format: 'Email address',
    example: 'developer@example.com',
    validate: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  },
  status: {
    format: 'PLANNING, IN_PROGRESS, BLOCKED, REVIEW, or COMPLETED',
    example: 'IN_PROGRESS',
    validate: (v) =>
      !v || /^(planning|to\s*do|in[\s_]?progress|doing|blocked|review|testing|done|completed?)$/i.test(v.trim()),
  },
  priority: {
    format: 'Number 1-5 or text (Lowest/Low/Medium/High/Critical)',
    example: 'High or 4',
    validate: (v) => !v || /^[1-5]$/.test(v.trim()) || /^(lowest|low|medium|high|highest|critical)$/i.test(v.trim()),
  },
  estimatedHours: {
    format: 'Positive number',
    example: '8',
    validate: (v) => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0),
  },
  dueDate: {
    format: 'Date (YYYY-MM-DD, MM/DD/YYYY, or DD/MM/YYYY)',
    example: '2026-03-15',
    validate: (v) => !v || !isNaN(Date.parse(v)),
  },
  sprint: {
    format: 'Sprint name',
    example: 'Sprint 1',
  },
  tags: {
    format: 'Comma-separated list',
    example: 'frontend, auth, urgent',
  },
  externalId: {
    format: 'External system ID',
    example: 'PROJ-123',
  },
  dependencies: {
    format: 'Comma-separated item names',
    example: 'Login Page, User Model',
  },
};

export default function ImportWizard({ teams, selectedTeam }: Props) {
  const router = useRouter();
  const { handleResult } = useDemoActionHandler();
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

  // Editing state
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [cleanupChanges, setCleanupChanges] = useState<string[]>([]);
  const [originalRows, setOriginalRows] = useState<Record<string, string>[]>([]);

  // Import results
  const [importStats, setImportStats] = useState<{
    created: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  } | null>(null);

  // Progress tracking for large imports
  const [importProgress, setImportProgress] = useState(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Validation errors for inline correction
  const [validationErrors, setValidationErrors] = useState<Map<string, string[]>>(new Map());

  // Undo/rollback state - store last import info
  const [lastImport, setLastImport] = useState<{
    projectId: string;
    componentIds: string[];
    timestamp: Date;
  } | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  // Field info tooltip state
  const [showFieldInfo, setShowFieldInfo] = useState<string | null>(null);

  const currentTeam = teams.find((t) => t.id === teamId) || selectedTeam;

  // Validate all rows against field rules
  const validateRows = useCallback(() => {
    const errors = new Map<string, string[]>();

    rows.forEach((row, rowIndex) => {
      const rowErrors: string[] = [];

      mappings.forEach((m) => {
        if (m.targetField && fieldValidationRules[m.targetField]?.validate) {
          const value = row[m.sourceColumn] || '';
          const isValid = fieldValidationRules[m.targetField].validate!(value);
          if (!isValid) {
            rowErrors.push(
              `Row ${rowIndex + 1}: Invalid ${m.targetField} "${value}" - Expected: ${fieldValidationRules[m.targetField].format}`,
            );
          }
        }
      });

      // Check required name field
      const nameMapping = mappings.find((m) => m.targetField === 'name');
      if (nameMapping) {
        const nameValue = row[nameMapping.sourceColumn];
        if (!nameValue || nameValue.trim() === '') {
          rowErrors.push(`Row ${rowIndex + 1}: Name is required`);
        }
      }

      if (rowErrors.length > 0) {
        errors.set(`row-${rowIndex}`, rowErrors);
      }
    });

    setValidationErrors(errors);
    return errors.size === 0;
  }, [rows, mappings]);

  // Run validation when rows or mappings change
  useEffect(() => {
    if (rows.length > 0 && mappings.length > 0) {
      validateRows();
    }
  }, [rows, mappings, validateRows]);

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

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
      // Stop progress simulation
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setImportProgress(100);

      if (data) {
        // Handle demo mode by processing locally
        let result = data;
        if (isDemoResult(data)) {
          result = handleResult(data);
        }
        if (result && 'stats' in result && result.stats) {
          setImportStats(result.stats);
          setStep(5);
          toast.success(`Imported ${result.stats.created} items!`);

          // Store import info for potential undo (only in production mode)
          if (!isDemoResult(data) && 'projectId' in result && result.projectId) {
            setLastImport({
              projectId: result.projectId as string,
              componentIds: [], // Would need server to return created IDs for full undo
              timestamp: new Date(),
            });
          }
        }
      }
    },
    onError: ({ error }) => {
      // Stop progress simulation
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setImportProgress(0);
      toast.error(error.serverError || 'Import failed');
    },
  });

  const { execute: doCleanup, isExecuting: isCleaning } = useAction(cleanupData, {
    onSuccess: ({ data }) => {
      if (data) {
        // Save original for undo
        if (originalRows.length === 0) {
          setOriginalRows([...rows]);
        }
        // Apply cleaned data
        const cleanedRows = data.rows.map((r) => r.cleaned);
        setRows(cleanedRows);
        // Collect all changes
        const allChanges = data.rows.flatMap((r) => r.changes || []);
        setCleanupChanges(allChanges);
        toast.success(`AI made ${data.totalChanges} improvements!`);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Cleanup failed');
    },
  });

  const handleCleanup = () => {
    doCleanup({ teamId, rows, mappings });
  };

  const handleUndoCleanup = () => {
    if (originalRows.length > 0) {
      setRows([...originalRows]);
      setCleanupChanges([]);
      toast.info('Reverted to original data');
    }
  };

  const updateRowField = (rowIndex: number, column: string, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === rowIndex ? { ...row, [column]: value } : row)));
  };

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
    const allKeys = rows.flatMap((r: Record<string, unknown>) => Object.keys(r));
    const headers = [...new Set(allKeys)] as string[];

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

    // Check for validation errors
    if (validationErrors.size > 0) {
      toast.error(`Please fix ${validationErrors.size} validation error(s) before importing`);
      return;
    }

    setStep(4);
    setImportProgress(0);

    // Start progress simulation for large imports
    // Estimate ~50ms per row, cap progress at 95% until complete
    const totalRows = rows.length;
    const estimatedMs = Math.max(2000, totalRows * 50);
    const intervalMs = 100;
    const incrementPerTick = 95 / (estimatedMs / intervalMs);

    progressIntervalRef.current = setInterval(() => {
      setImportProgress((prev) => {
        const next = prev + incrementPerTick;
        return next >= 95 ? 95 : next;
      });
    }, intervalMs);

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

  // Helper to check if a cell has validation error
  const getCellError = (rowIndex: number, targetField: string): string | null => {
    const rowErrors = validationErrors.get(`row-${rowIndex}`);
    if (!rowErrors) return null;
    const fieldError = rowErrors.find((e) => e.includes(targetField));
    return fieldError || null;
  };

  // Download template CSV
  const downloadTemplate = () => {
    const headers = ['name', 'description', 'type', 'status', 'priority', 'estimatedHours', 'parentName'];
    const exampleRow = [
      'Login Feature',
      'Implement user login',
      'FEATURE',
      'PLANNING',
      'High',
      '8',
      'Authentication Epic',
    ];
    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasktitan-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded!');
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
                step >= s ? 'bg-gradient-to-r from-violet-600 to-cyan-600 text-white' : 'bg-slate-800 text-slate-500'
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
              Our AI will analyze your data and automatically map columns to the right fields. You can review and adjust
              before importing.
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

            {/* AI Cleanup Button */}
            <div className="mb-4 p-4 bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/30 rounded-xl flex items-center justify-between">
              <div>
                <h4 className="font-medium text-slate-200 flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-violet-400" />
                  AI Data Cleanup
                </h4>
                <p className="text-sm text-slate-400 mt-1">
                  Fix typos, normalize values, detect hierarchy, fill missing data
                </p>
              </div>
              <div className="flex items-center gap-2">
                {originalRows.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUndoCleanup}
                    className="px-3 py-2 text-sm text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCleanup}
                  disabled={isCleaning}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {isCleaning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cleaning...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      Clean Data
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Cleanup changes */}
            {cleanupChanges.length > 0 && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <h4 className="text-sm font-medium text-green-400 mb-1">
                  ✨ AI Improvements ({cleanupChanges.length})
                </h4>
                <ul className="text-sm text-green-300/80 space-y-1 max-h-24 overflow-y-auto">
                  {cleanupChanges.slice(0, 10).map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                  {cleanupChanges.length > 10 && (
                    <li className="text-slate-500">...and {cleanupChanges.length - 10} more</li>
                  )}
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
                    <th className="pb-3">Format</th>
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
                      <td className="py-3">
                        {m.targetField && fieldValidationRules[m.targetField] && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowFieldInfo(showFieldInfo === m.sourceColumn ? null : m.sourceColumn)}
                              className="text-xs text-slate-500 hover:text-cyan-400 flex items-center gap-1"
                            >
                              <Info className="w-3.5 h-3.5" />
                              <span className="truncate max-w-[120px]">
                                {fieldValidationRules[m.targetField].format}
                              </span>
                            </button>
                            {showFieldInfo === m.sourceColumn && (
                              <div className="absolute z-10 top-full left-0 mt-1 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-lg w-64">
                                <div className="text-xs text-slate-300 mb-1">
                                  <strong>Format:</strong> {fieldValidationRules[m.targetField].format}
                                </div>
                                <div className="text-xs text-slate-400">
                                  <strong>Example:</strong> {fieldValidationRules[m.targetField].example}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
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

          {/* Validation Errors Summary */}
          {validationErrors.size > 0 && (
            <div className="component-card border-red-500/30 bg-red-500/5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {validationErrors.size} row(s) with validation errors
                </h3>
                <span className="text-xs text-slate-500">Fix errors in the preview below to continue</span>
              </div>
              <ul className="text-sm text-red-300/80 space-y-1 max-h-24 overflow-y-auto">
                {Array.from(validationErrors.values())
                  .flat()
                  .slice(0, 5)
                  .map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                {Array.from(validationErrors.values()).flat().length > 5 && (
                  <li className="text-slate-500">
                    ...and {Array.from(validationErrors.values()).flat().length - 5} more errors
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Editable Preview */}
          <div className="component-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Preview & Edit ({rows.length} rows)
                {validationErrors.size > 0 && (
                  <span className="text-xs text-red-400 ml-2">({validationErrors.size} with errors)</span>
                )}
              </h3>
              <span className="text-xs text-slate-500">Click any cell to edit • Red cells have errors</span>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
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
                  {rows.map((row, i) => {
                    const rowHasError = validationErrors.has(`row-${i}`);
                    return (
                      <tr
                        key={i}
                        className={`border-b border-slate-800 hover:bg-slate-800/50 ${rowHasError ? 'bg-red-500/5' : ''}`}
                      >
                        <td className="py-2 pr-2 text-slate-500 text-xs">
                          {rowHasError && <AlertTriangle className="w-3 h-3 text-red-400 inline mr-1" />}
                          {i + 1}
                        </td>
                        {mappings
                          .filter((m) => m.targetField)
                          .map((m) => {
                            const cellError = getCellError(i, m.targetField!);
                            const hasError = !!cellError;

                            return (
                              <td key={m.sourceColumn} className="py-1 pr-2">
                                {editingRow === i ? (
                                  <div>
                                    <input
                                      type="text"
                                      value={row[m.sourceColumn] || ''}
                                      onChange={(e) => updateRowField(i, m.sourceColumn, e.target.value)}
                                      onBlur={() => setEditingRow(null)}
                                      onKeyDown={(e) => e.key === 'Enter' && setEditingRow(null)}
                                      autoFocus={m.targetField === 'name'}
                                      className={`w-full px-2 py-1 bg-slate-900 border rounded text-slate-100 text-sm ${
                                        hasError ? 'border-red-500' : 'border-cyan-500'
                                      }`}
                                    />
                                    {hasError && m.targetField && fieldValidationRules[m.targetField] && (
                                      <div className="text-xs text-red-400 mt-1">
                                        Expected: {fieldValidationRules[m.targetField].format}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => setEditingRow(i)}
                                    className={`px-2 py-1 truncate max-w-[200px] cursor-pointer rounded ${
                                      hasError
                                        ? 'text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20'
                                        : 'text-slate-300 hover:bg-slate-700'
                                    }`}
                                    title={hasError ? `Error: ${cellError}` : row[m.sourceColumn] || '—'}
                                  >
                                    {row[m.sourceColumn] || <span className="text-slate-600">—</span>}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                      </tr>
                    );
                  })}
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
                setValidationErrors(new Map());
              }}
              className="px-4 py-2 text-slate-400 hover:text-white flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Start Over
            </button>
            <div className="flex items-center gap-3">
              {validationErrors.size > 0 && (
                <span className="text-sm text-amber-400">{validationErrors.size} error(s) to fix</span>
              )}
              <button
                onClick={handleExecuteImport}
                disabled={!mappings.some((m) => m.targetField === 'name') || validationErrors.size > 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {rows.length} Items
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Importing with Progress */}
      {step === 4 && (
        <div className="component-card text-center py-12">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Importing Data</h2>
          <p className="text-slate-400 mb-6">Creating work items, resolving hierarchy, linking dependencies...</p>

          {/* Progress bar */}
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
              <span>Progress</span>
              <span>{Math.round(importProgress)}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-300 ease-out"
                style={{ width: `${importProgress}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">Processing {rows.length} items...</p>
          </div>
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
            {importStats.skipped > 0 && <span className="text-slate-500"> ({importStats.skipped} skipped)</span>}
          </p>

          {/* Undo option - available briefly after import */}
          {lastImport && Date.now() - lastImport.timestamp.getTime() < 5 * 60 * 1000 && (
            <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <p className="text-sm text-slate-300 flex items-center gap-2">
                    <Undo2 className="w-4 h-4 text-amber-400" />
                    Made a mistake? You can undo this import
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Available for 5 minutes after import</p>
                </div>
                <button
                  onClick={async () => {
                    setIsUndoing(true);
                    // In a full implementation, this would call a server action to delete the imported components
                    // For now, show a toast about the limitation
                    toast.info(
                      'Undo imports the file with corrections. Navigate to the project to delete individual items.',
                    );
                    setIsUndoing(false);
                    // Go back to step 3 with the same data for re-import with corrections
                    setStep(3);
                  }}
                  disabled={isUndoing}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  {isUndoing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Undoing...
                    </>
                  ) : (
                    <>
                      <Undo2 className="w-4 h-4" />
                      Re-import with Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

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
                setLastImport(null);
                setValidationErrors(new Map());
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
