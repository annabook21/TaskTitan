import { useState, useRef } from 'react';
import {
  createSmartComponent,
  refineComponent,
  createComponent,
  type Component,
  type ComponentType,
  type GeneratedComponent,
  type NaturalLanguageComponent,
} from '../api/appsync';

interface SmartComponentCreatorProps {
  projectId: string;
  onComponentCreated: (component: Component) => void;
  onClose: () => void;
}

// AWS Best Practice: Rate limiting to prevent abuse
const RATE_LIMIT_MS = 3000;

type Step = 'input' | 'preview' | 'refine' | 'manual';

const TYPE_COLORS: Record<string, string> = {
  EPIC: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  FEATURE: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  STORY: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  TASK: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  BUG: 'bg-red-500/20 text-red-300 border-red-500/30',
};

export function SmartComponentCreator({
  projectId,
  onComponentCreated,
  onClose,
}: SmartComponentCreatorProps) {
  const [step, setStep] = useState<Step>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Natural language input
  const [userInput, setUserInput] = useState('');

  // Generated component preview
  const [generatedComponent, setGeneratedComponent] = useState<GeneratedComponent | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);

  // Editable preview fields
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedType, setEditedType] = useState<ComponentType>('TASK');
  const [editedEstimate, setEditedEstimate] = useState('');
  const [editedPriority, setEditedPriority] = useState('');

  // Refinement chat
  const [refineInput, setRefineInput] = useState('');

  // Manual form fields
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualType, setManualType] = useState<ComponentType>('TASK');

  // Rate limiting
  const lastRequestTime = useRef<number>(0);

  const checkRateLimit = (): boolean => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRequestTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before trying again`);
      return false;
    }
    lastRequestTime.current = now;
    return true;
  };

  // Generate component from natural language
  const handleGenerate = async () => {
    if (!userInput.trim() || !checkRateLimit()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await createSmartComponent({
        projectId,
        userInput: userInput.trim(),
      });

      setGeneratedComponent(result.component);
      setReasoning(result.reasoning);
      setSuggestedFollowUps(result.suggestedFollowUps);

      // Initialize editable fields
      setEditedName(result.component.name);
      setEditedDescription(result.component.description);
      setEditedType(result.component.type);
      setEditedEstimate(String(result.component.estimatedHours));
      setEditedPriority(String(result.component.priority));

      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate component';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait and try again.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Refine the generated component
  const handleRefine = async (request: string) => {
    if (!generatedComponent || !request.trim() || !checkRateLimit()) return;

    setLoading(true);
    setError(null);

    try {
      // Build the current component state for refinement
      const currentComponent: NaturalLanguageComponent = {
        name: editedName,
        description: editedDescription,
        type: editedType,
        estimatedHours: parseFloat(editedEstimate) || generatedComponent.estimatedHours,
        priority: parseInt(editedPriority, 10) || generatedComponent.priority,
        suggestedDependencies: generatedComponent.suggestedDependencies || [],
        reasoning: reasoning,
        acceptanceCriteria: generatedComponent.acceptanceCriteria,
      };

      const result = await refineComponent({
        projectId,
        currentComponent,
        refinementRequest: request.trim(),
      });

      // Update with refined component
      setGeneratedComponent(result.component);
      setReasoning(result.explanation);
      setSuggestedFollowUps(result.suggestedFollowUps);

      // Update editable fields
      setEditedName(result.component.name);
      setEditedDescription(result.component.description);
      setEditedType(result.component.type);
      setEditedEstimate(String(result.component.estimatedHours));
      setEditedPriority(String(result.component.priority));

      setRefineInput('');
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Create the component from preview
  const handleCreate = async () => {
    if (!generatedComponent) return;

    setLoading(true);
    setError(null);

    try {
      const component = await createComponent({
        id: crypto.randomUUID(),
        projectId,
        name: editedName,
        description: editedDescription || undefined,
        type: editedType,
        status: 'PLANNING',
        priority: parseInt(editedPriority, 10) || undefined,
        estimatedHours: parseFloat(editedEstimate) || undefined,
      });

      onComponentCreated(component);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    } finally {
      setLoading(false);
    }
  };

  // Create component from manual form
  const handleManualCreate = async () => {
    if (!manualName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const component = await createComponent({
        id: crypto.randomUUID(),
        projectId,
        name: manualName.trim(),
        description: manualDescription.trim() || undefined,
        type: manualType,
        status: 'PLANNING',
      });

      onComponentCreated(component);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-slate-800 border border-slate-700 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-cyan-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Smart Component Creator
        </h2>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        <span className={`px-2 py-1 rounded ${step === 'input' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
          1. Describe
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className={`px-2 py-1 rounded ${step === 'preview' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
          2. Preview
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className={`px-2 py-1 rounded ${step === 'refine' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
          3. Refine
        </span>
        {step === 'manual' && (
          <>
            <span className="text-slate-600">|</span>
            <span className="px-2 py-1 rounded bg-slate-600 text-white">Manual</span>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Step: Input */}
      {step === 'input' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Describe what you want to build
            </label>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder='e.g., "Add user authentication with email/password and OAuth support"'
              disabled={loading}
              className="w-full px-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
              rows={4}
            />
            <p className="text-xs text-slate-500 mt-1">Press Cmd+Enter to generate</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={loading || !userInput.trim()}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                  </svg>
                  Generate Component
                </>
              )}
            </button>
            <button
              onClick={() => setStep('manual')}
              disabled={loading}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Create Manually
            </button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && generatedComponent && (
        <div className="space-y-4">
          {/* Editable preview card */}
          <div className="p-4 bg-slate-900/50 border border-slate-600 rounded-lg space-y-3">
            {/* Type badge + Name */}
            <div className="flex items-start gap-3">
              <select
                value={editedType}
                onChange={(e) => setEditedType(e.target.value as ComponentType)}
                className={`text-xs px-2 py-1 rounded border ${TYPE_COLORS[editedType]} bg-transparent cursor-pointer`}
              >
                <option value="EPIC">EPIC</option>
                <option value="FEATURE">FEATURE</option>
                <option value="STORY">STORY</option>
                <option value="TASK">TASK</option>
                <option value="BUG">BUG</option>
              </select>
              {editingField === 'name' ? (
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                  autoFocus
                  className="flex-1 px-2 py-1 bg-slate-800 border border-cyan-500 rounded text-white font-medium focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => setEditingField('name')}
                  className="flex-1 font-medium text-white cursor-pointer hover:text-cyan-300"
                >
                  {editedName}
                </span>
              )}
            </div>

            {/* Description */}
            {editingField === 'description' ? (
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={() => setEditingField(null)}
                autoFocus
                className="w-full px-2 py-1 bg-slate-800 border border-cyan-500 rounded text-slate-300 text-sm focus:outline-none resize-none"
                rows={3}
              />
            ) : (
              <p
                onClick={() => setEditingField('description')}
                className="text-sm text-slate-400 cursor-pointer hover:text-slate-300"
              >
                {editedDescription || 'Click to add description...'}
              </p>
            )}

            {/* Metadata */}
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Est:</span>
                {editingField === 'estimate' ? (
                  <input
                    type="number"
                    value={editedEstimate}
                    onChange={(e) => setEditedEstimate(e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                    autoFocus
                    className="w-16 px-1 py-0.5 bg-slate-800 border border-cyan-500 rounded text-white text-sm focus:outline-none"
                  />
                ) : (
                  <span
                    onClick={() => setEditingField('estimate')}
                    className="text-white cursor-pointer hover:text-cyan-300"
                  >
                    {editedEstimate}h
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Priority:</span>
                {editingField === 'priority' ? (
                  <input
                    type="number"
                    value={editedPriority}
                    onChange={(e) => setEditedPriority(e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                    autoFocus
                    className="w-12 px-1 py-0.5 bg-slate-800 border border-cyan-500 rounded text-white text-sm focus:outline-none"
                  />
                ) : (
                  <span
                    onClick={() => setEditingField('priority')}
                    className="text-white cursor-pointer hover:text-cyan-300"
                  >
                    P{editedPriority}
                  </span>
                )}
              </div>
            </div>

            {/* Acceptance Criteria */}
            {generatedComponent.acceptanceCriteria && generatedComponent.acceptanceCriteria.length > 0 && (
              <div className="pt-2 border-t border-slate-700">
                <p className="text-xs text-slate-400 mb-1">Acceptance Criteria:</p>
                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                  {generatedComponent.acceptanceCriteria.map((ac, i) => (
                    <li key={i}>{ac}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Dependencies */}
            {generatedComponent.suggestedDependencies && generatedComponent.suggestedDependencies.length > 0 && (
              <div className="pt-2 border-t border-slate-700">
                <p className="text-xs text-slate-400 mb-1">Suggested Dependencies:</p>
                <div className="flex flex-wrap gap-1">
                  {generatedComponent.suggestedDependencies.map((dep, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Reasoning */}
          {reasoning && (
            <div className="p-3 bg-violet-900/20 border border-violet-500/30 rounded-lg">
              <p className="text-xs text-violet-400 mb-1">AI Reasoning:</p>
              <p className="text-sm text-violet-200">{reasoning}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={loading || !editedName.trim()}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Component'
              )}
            </button>
            <button
              onClick={() => setStep('refine')}
              disabled={loading}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors"
            >
              Refine
            </button>
            <button
              onClick={() => setStep('input')}
              disabled={loading}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step: Refine */}
      {step === 'refine' && (
        <div className="space-y-4">
          {/* Suggested follow-ups */}
          {suggestedFollowUps.length > 0 && (
            <div>
              <p className="text-xs text-violet-400 mb-2">Suggested refinements:</p>
              <div className="flex flex-wrap gap-2">
                {suggestedFollowUps.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleRefine(suggestion)}
                    disabled={loading}
                    className="text-xs px-2 py-1 bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 disabled:opacity-50 text-violet-200 rounded transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom refinement */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">Custom refinement:</label>
            <div className="flex gap-2">
              <textarea
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleRefine(refineInput);
                  }
                }}
                placeholder="Describe how you'd like to change the component..."
                disabled={loading}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                rows={2}
              />
              <button
                onClick={() => handleRefine(refineInput)}
                disabled={loading || !refineInput.trim()}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            onClick={() => setStep('preview')}
            disabled={loading}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            Back to Preview
          </button>
        </div>
      )}

      {/* Step: Manual */}
      {step === 'manual' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Component name"
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value as ComponentType)}
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="EPIC">Epic</option>
              <option value="FEATURE">Feature</option>
              <option value="STORY">Story</option>
              <option value="TASK">Task</option>
              <option value="BUG">Bug</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <textarea
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
              placeholder="Brief description"
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
              rows={3}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleManualCreate}
              disabled={loading || !manualName.trim()}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Creating...' : 'Create Component'}
            </button>
            <button
              onClick={() => setStep('input')}
              disabled={loading}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Use AI Instead
            </button>
          </div>
        </div>
      )}

      {/* Tip */}
      {step === 'input' && !loading && (
        <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
          <p className="text-xs text-slate-500">
            <strong className="text-slate-400">Tip:</strong> Describe the component in natural language. The AI will interpret your request and create a structured component with type, estimate, priority, and acceptance criteria.
          </p>
        </div>
      )}
    </div>
  );
}
