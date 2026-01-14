'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import {
  updateComponentContextAction,
  generateContextSummaryAction,
  clearComponentContextAction,
} from './context-actions';
import { FileText, Sparkles, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface ComponentContextData {
  id: string;
  name: string;
  type: string;
  contextDecision: string | null;
  contextRationale: string | null;
  contextAlternatives: string | null;
  contextLinks: string[];
  contextAiSummary: string | null;
}

interface Props {
  component: ComponentContextData;
}

export default function ComponentContextPanel({ component }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [decision, setDecision] = useState(component.contextDecision || '');
  const [rationale, setRationale] = useState(component.contextRationale || '');
  const [alternatives, setAlternatives] = useState(component.contextAlternatives || '');
  const [links, setLinks] = useState<string[]>(component.contextLinks || []);
  const [newLink, setNewLink] = useState('');
  const [showKeyPoints, setShowKeyPoints] = useState(false);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);

  const hasContext = Boolean(component.contextDecision || component.contextRationale);

  const { execute: saveContext, isExecuting: isSaving } = useAction(updateComponentContextAction, {
    onSuccess: () => {
      toast.success('Context saved');
      setIsEditing(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to save context');
    },
  });

  const { execute: generateSummary, isExecuting: isGenerating } = useAction(generateContextSummaryAction, {
    onSuccess: ({ data }) => {
      if (data?.keyPoints) {
        setKeyPoints(data.keyPoints);
        setShowKeyPoints(true);
        toast.success('AI summary generated');
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to generate summary');
    },
  });

  const { execute: clearContext, isExecuting: isClearing } = useAction(clearComponentContextAction, {
    onSuccess: () => {
      toast.success('Context cleared');
      setDecision('');
      setRationale('');
      setAlternatives('');
      setLinks([]);
      setKeyPoints([]);
      setIsEditing(false);
      setIsExpanded(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to clear context');
    },
  });

  const handleSave = () => {
    if (!decision.trim() || !rationale.trim()) {
      toast.error('Decision and rationale are required');
      return;
    }

    // Validate links
    const validLinks = links.filter((link) => {
      try {
        new URL(link);
        return true;
      } catch {
        return false;
      }
    });

    saveContext({
      componentId: component.id,
      contextDecision: decision.trim(),
      contextRationale: rationale.trim(),
      contextAlternatives: alternatives.trim() || undefined,
      contextLinks: validLinks.length > 0 ? validLinks : undefined,
    });
  };

  const handleGenerateSummary = () => {
    if (!component.contextDecision || !component.contextRationale) {
      toast.error('Save context first before generating summary');
      return;
    }
    generateSummary({ componentId: component.id });
  };

  const handleAddLink = () => {
    if (!newLink.trim()) return;
    try {
      new URL(newLink);
      setLinks([...links, newLink.trim()]);
      setNewLink('');
    } catch {
      toast.error('Invalid URL');
    }
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  if (!isExpanded && !hasContext) {
    // Collapsed, no context - show "Add Context" button
    return (
      <button
        onClick={() => {
          setIsExpanded(true);
          setIsEditing(true);
        }}
        className="w-full text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1.5 py-2 transition-colors"
      >
        <FileText className="w-3.5 h-3.5" />
        Add Context / Decision
      </button>
    );
  }

  if (!isExpanded && hasContext) {
    // Collapsed, has context - show summary badge
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full text-xs bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2 flex items-center justify-between hover:bg-violet-500/20 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-violet-300">
          <FileText className="w-3.5 h-3.5" />
          Has Context
        </span>
        <ChevronDown className="w-3 h-3 text-violet-400" />
      </button>
    );
  }

  // Expanded view
  return (
    <div className="border border-slate-700 rounded-lg p-3 mb-3 bg-slate-800/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-sm font-medium text-slate-200 flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-400" />
          Component Context
        </h5>
        <div className="flex items-center gap-2">
          {!isEditing && hasContext && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs text-slate-400 hover:text-cyan-400 transition-colors"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Display mode */}
      {!isEditing && hasContext && (
        <div className="space-y-3">
          {/* AI Summary */}
          {component.contextAiSummary && (
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
              <p className="text-xs font-medium text-violet-300 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                AI Summary
              </p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{component.contextAiSummary}</p>
            </div>
          )}

          {/* Key Points */}
          {showKeyPoints && keyPoints.length > 0 && (
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-300 mb-2">Key Points</p>
              <ul className="space-y-1">
                {keyPoints.map((point, i) => (
                  <li key={i} className="text-sm text-slate-400 flex items-start gap-2">
                    <span className="text-cyan-400 mt-1">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">What was decided</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{component.contextDecision}</p>
          </div>

          {/* Rationale */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">Why this approach</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{component.contextRationale}</p>
          </div>

          {/* Alternatives */}
          {component.contextAlternatives && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Alternatives considered</p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{component.contextAlternatives}</p>
            </div>
          )}

          {/* Links */}
          {component.contextLinks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Related Links</p>
              <ul className="space-y-1">
                {component.contextLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-cyan-400 hover:text-cyan-300 underline break-all"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <button
              onClick={handleGenerateSummary}
              disabled={isGenerating}
              className="text-xs px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 rounded-lg text-violet-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isGenerating ? 'Generating...' : 'Generate AI Summary'}
            </button>
            <button
              onClick={() => clearContext({ componentId: component.id })}
              disabled={isClearing}
              className="text-xs px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {isEditing && (
        <div className="space-y-3">
          {/* Decision */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              What was decided? <span className="text-red-400">*</span>
            </label>
            <textarea
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              placeholder="We decided to use React instead of Vue..."
            />
          </div>

          {/* Rationale */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              Why this approach? <span className="text-red-400">*</span>
            </label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              placeholder="React has better TypeScript support and larger ecosystem..."
            />
          </div>

          {/* Alternatives */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              Alternatives considered (optional)
            </label>
            <textarea
              value={alternatives}
              onChange={(e) => setAlternatives(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              placeholder="Considered Vue.js and Svelte..."
            />
          </div>

          {/* Links */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">Related Links</label>
            <div className="flex gap-2 mb-2">
              <input
                type="url"
                value={newLink}
                onChange={(e) => setNewLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddLink();
                  }
                }}
                className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                placeholder="https://..."
              />
              <button
                onClick={handleAddLink}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-200 transition-colors"
              >
                Add
              </button>
            </div>
            {links.length > 0 && (
              <ul className="space-y-1">
                {links.map((link, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-cyan-400 hover:text-cyan-300 underline truncate"
                    >
                      {link}
                    </a>
                    <button
                      onClick={() => handleRemoveLink(i)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 px-3 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg text-sm font-medium text-slate-900 transition-colors disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Context'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                if (!hasContext) setIsExpanded(false);
              }}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
