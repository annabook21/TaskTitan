'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateComponent } from '@/app/projects/actions';
import { assignComponentToSprint } from '@/app/sprints/actions';
import { generatePreviewAction } from './preview-actions';
import {
  GitBranch,
  Clock,
  User as UserIcon,
  ChevronDown,
  ChevronUp,
  Check,
  Zap,
  Github,
  Sparkles,
  Eye,
  Loader2,
  Timer,
  AlertTriangle,
  MessageSquare,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ComponentStatus, ComponentType, User, SprintStatus } from '@prisma/client';
import AssignmentPanel from './AssignmentPanel';
import PreviewModal from './PreviewModal';
import ComponentContextPanel from './ComponentContextPanel';
import ComponentRefineModal from './ComponentRefineModal';
import CopyBranchButton from './CopyBranchButton';
import PRLinkInput from './PRLinkInput';
import PRStatusBadge from './PRStatusBadge';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

interface Sprint {
  id: string;
  name: string;
  status: SprintStatus;
  startDate: Date;
  endDate: Date;
}

interface ComponentWithRelations {
  id: string;
  name: string;
  description: string | null;
  type: ComponentType;
  status: ComponentStatus;
  priority: number;
  estimatedHours: number | null;
  dueDate: Date | null;
  sprintId: string | null;
  sprint: Sprint | null;
  // GitHub PR Integration
  githubPrUrl: string | null;
  githubPrStatus?: string | null; // "open", "draft", "merged", "closed"
  githubPrNumber?: number | null;
  githubPrTitle?: string | null;
  // Relations
  assignments: { user: User }[];
  dependsOn: { requiredComponent: { id: string; name: string } }[];
  dependedOnBy: { dependentComponent: { id: string; name: string } }[];
  Preview?: { id: string; htmlContent: string }[];
  contextDecision: string | null;
  contextRationale: string | null;
  contextAlternatives: string | null;
  contextLinks: string[];
  contextAiSummary: string | null;
  statusEnteredAt?: Date; // For aging calculation
  cycleTimeDays?: number | null; // Cycle time for completed items
  projectId: string; // For AI refinement
}

interface Props {
  component: ComponentWithRelations;
  teamMembers: User[];
  availableSprints: Sprint[];
  showAging?: boolean; // Show aging indicator (for Kanban teams)
  currentUserName?: string; // For branch name generation
}

const statusOptions: { value: ComponentStatus; label: string; color: string }[] = [
  { value: 'PLANNING', label: 'Planning', color: 'violet' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'cyan' },
  { value: 'BLOCKED', label: 'Blocked', color: 'red' },
  { value: 'REVIEW', label: 'Review', color: 'amber' },
  { value: 'COMPLETED', label: 'Completed', color: 'emerald' },
];

// Calculate days in status for aging indicator
function getDaysInStatus(enteredAt: Date | undefined): number {
  if (!enteredAt) return 0;
  const now = new Date();
  const entered = new Date(enteredAt);
  const diffMs = now.getTime() - entered.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Get aging indicator color based on days
function getAgingColor(days: number, status: ComponentStatus): { bg: string; text: string; border: string } {
  // Blocked items age faster - more urgent colors
  if (status === 'BLOCKED') {
    if (days >= 3) return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' };
    if (days >= 1) return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' };
    return { bg: 'bg-slate-700', text: 'text-slate-400', border: 'border-slate-600' };
  }

  // In Progress - watch for stale items
  if (status === 'IN_PROGRESS') {
    if (days >= 7) return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' };
    if (days >= 4) return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' };
    return { bg: 'bg-slate-700', text: 'text-slate-400', border: 'border-slate-600' };
  }

  // Review - shouldn't sit too long
  if (status === 'REVIEW') {
    if (days >= 5) return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' };
    if (days >= 2) return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' };
    return { bg: 'bg-slate-700', text: 'text-slate-400', border: 'border-slate-600' };
  }

  // Planning - backlog items, less urgent
  if (status === 'PLANNING') {
    if (days >= 30) return { bg: 'bg-slate-600', text: 'text-slate-400', border: 'border-slate-500' };
    return { bg: 'bg-slate-700', text: 'text-slate-400', border: 'border-slate-600' };
  }

  // Completed - no aging concerns
  return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' };
}

const typeConfig = {
  EPIC: {
    label: 'Epic',
    color: 'purple',
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
  },
  FEATURE: {
    label: 'Feature',
    color: 'blue',
    bg: 'bg-blue-500/20',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
  },
  STORY: {
    label: 'Story',
    color: 'green',
    bg: 'bg-green-500/20',
    border: 'border-green-500/30',
    text: 'text-green-400',
  },
  TASK: { label: 'Task', color: 'slate', bg: 'bg-slate-500/20', border: 'border-slate-500/30', text: 'text-slate-400' },
  BUG: { label: 'Bug', color: 'red', bg: 'bg-red-500/20', border: 'border-red-500/30', text: 'text-red-400' },
} as const;

export default function ComponentCard({
  component,
  teamMembers,
  availableSprints,
  showAging = false,
  currentUserName,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isSprintOpen, setIsSprintOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const { handleResult } = useDemoActionHandler();

  // Calculate aging
  const daysInStatus = getDaysInStatus(component.statusEnteredAt);
  const agingColors = getAgingColor(daysInStatus, component.status);
  const isStale =
    (component.status === 'IN_PROGRESS' && daysInStatus >= 7) ||
    (component.status === 'BLOCKED' && daysInStatus >= 3) ||
    (component.status === 'REVIEW' && daysInStatus >= 5);

  const { execute, isExecuting } = useAction(updateComponent, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Component updated');
      setIsStatusOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update');
    },
  });

  const { execute: executeSprint, isExecuting: isSprintExecuting } = useAction(assignComponentToSprint, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Sprint updated');
      setIsSprintOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update sprint');
    },
  });

  const { execute: executeGeneratePreview, isExecuting: isGeneratingPreview } = useAction(generatePreviewAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      const resolved = isDemoResult(data) ? (handleResult(data) as typeof data) : data;
      if (resolved?.preview) {
        toast.success('Wireframe generated!');
        setShowPreview(true);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to generate wireframe');
    },
  });

  const currentStatus = statusOptions.find((s) => s.value === component.status);

  const handleStatusChange = (newStatus: ComponentStatus) => {
    execute({ id: component.id, status: newStatus });
  };

  const handleSprintChange = (sprintId: string | null) => {
    executeSprint({ componentId: component.id, sprintId });
  };

  const handleGeneratePreview = () => {
    executeGeneratePreview({ componentId: component.id });
  };

  const latestPreview = component.Preview?.[0];

  const typeStyle = typeConfig[component.type];

  return (
    <>
      {showPreview && latestPreview && (
        <PreviewModal
          htmlContent={latestPreview.htmlContent}
          componentName={component.name}
          previewId={latestPreview.id}
          onClose={() => setShowPreview(false)}
        />
      )}
      <div className="component-card group">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${typeStyle.bg} ${typeStyle.border} ${typeStyle.text} border`}
              >
                {typeStyle.label}
              </span>
              {component.priority > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  P{component.priority}
                </span>
              )}
            </div>
            <h4 className="font-medium text-slate-100 group-hover:text-cyan-400 transition-colors">{component.name}</h4>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-500 hover:text-slate-300 rounded transition-colors ml-2"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Description - truncated when collapsed, full when expanded */}
        {component.description && (
          <p className={`text-sm text-slate-400 mb-3 ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
            {component.description}
          </p>
        )}

        {/* Expanded Content */}
        {isExpanded && (
          <div className="space-y-3 mb-3 pb-3 border-b border-slate-700">
            {/* Due Date */}
            {component.dueDate && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="text-slate-400">Due:</span>
                <span
                  className={`${new Date(component.dueDate) < new Date() && component.status !== 'COMPLETED' ? 'text-red-400' : 'text-slate-300'}`}
                >
                  {new Date(component.dueDate).toLocaleDateString()}
                </span>
              </div>
            )}

            {/* Estimated Hours */}
            {component.estimatedHours && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-slate-500" />
                <span className="text-slate-400">Estimate:</span>
                <span className="text-slate-300">{component.estimatedHours} hours</span>
              </div>
            )}

            {/* Dependencies - Full list */}
            {component.dependsOn.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <GitBranch className="w-4 h-4 text-slate-500" />
                  <span>Depends on ({component.dependsOn.length}):</span>
                </div>
                <div className="pl-6 space-y-1">
                  {component.dependsOn.map((d) => (
                    <div key={d.requiredComponent.id} className="flex items-center gap-2 text-sm">
                      <ArrowRight className="w-3 h-3 text-cyan-400" />
                      <span className="text-slate-300">{d.requiredComponent.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Depended on by */}
            {component.dependedOnBy.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <GitBranch className="w-4 h-4 text-slate-500 rotate-180" />
                  <span>Blocks ({component.dependedOnBy.length}):</span>
                </div>
                <div className="pl-6 space-y-1">
                  {component.dependedOnBy.map((d) => (
                    <div key={d.dependentComponent.id} className="flex items-center gap-2 text-sm">
                      <ArrowRight className="w-3 h-3 text-amber-400" />
                      <span className="text-slate-300">{d.dependentComponent.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Assignees - Full list */}
            {component.assignments.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <UserIcon className="w-4 h-4 text-slate-500" />
                  <span>Assigned to ({component.assignments.length}):</span>
                </div>
                <div className="pl-6 space-y-1">
                  {component.assignments.map(({ user }) => (
                    <div key={user.id} className="flex items-center gap-2 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-xs font-medium">
                        {user.name?.[0] || user.email[0].toUpperCase()}
                      </div>
                      <span className="text-slate-300">{user.name || user.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GitHub Integration - Expanded View */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Github className="w-4 h-4 text-slate-500" />
                <span>GitHub</span>
              </div>
              <div className="pl-6 space-y-2">
                {/* PR Status Badge or Link Input */}
                {component.githubPrUrl ? (
                  <PRStatusBadge
                    prUrl={component.githubPrUrl}
                    prNumber={component.githubPrNumber}
                    prTitle={component.githubPrTitle}
                    prStatus={component.githubPrStatus as 'open' | 'draft' | 'merged' | 'closed' | null}
                  />
                ) : (
                  <PRLinkInput componentId={component.id} currentPrUrl={component.githubPrUrl} />
                )}
                {/* Copy Branch Button */}
                <CopyBranchButton
                  componentId={component.id}
                  componentName={component.name}
                  userName={currentUserName}
                />
              </div>
            </div>
          </div>
        )}

        {/* GitHub PR - Collapsed view */}
        {!isExpanded && component.githubPrUrl && (
          <div className="mb-2">
            <PRStatusBadge
              prUrl={component.githubPrUrl}
              prNumber={component.githubPrNumber}
              prTitle={component.githubPrTitle}
              prStatus={component.githubPrStatus as 'open' | 'draft' | 'merged' | 'closed' | null}
              compact
            />
          </div>
        )}

        {/* Actions */}
        <div className="mb-2 flex items-center gap-3">
          {latestPreview ? (
            <button
              onClick={() => setShowPreview(true)}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              View Wireframe
            </button>
          ) : (
            <button
              onClick={handleGeneratePreview}
              disabled={isGeneratingPreview}
              className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isGeneratingPreview ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {isGeneratingPreview ? 'Generating...' : 'Generate Wireframe'}
            </button>
          )}
          <button
            onClick={() => setShowRefine(true)}
            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Refine with AI
          </button>
        </div>

        {/* Status Dropdown */}
        <div className="relative mb-3">
          <button
            onClick={() => setIsStatusOpen(!isStatusOpen)}
            disabled={isExecuting}
            className={`status-badge ${component.status.toLowerCase().replace('_', '-')} w-full justify-between`}
          >
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full bg-${currentStatus?.color}-500`} />
              {currentStatus?.label}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isStatusOpen ? 'rotate-180' : ''}`} />
          </button>

          {isStatusOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStatusChange(option.value)}
                  className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full bg-${option.color}-500`} />
                    {option.label}
                  </span>
                  {component.status === option.value && <Check className="w-4 h-4 text-cyan-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sprint Selector */}
        {availableSprints.length > 0 && (
          <div className="relative mb-3">
            <button
              onClick={() => setIsSprintOpen(!isSprintOpen)}
              disabled={isSprintExecuting}
              className={`w-full px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center justify-between ${
                component.sprint
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Zap className="w-3 h-3" />
                {component.sprint ? component.sprint.name : 'No Sprint (Backlog)'}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isSprintOpen ? 'rotate-180' : ''}`} />
            </button>

            {isSprintOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
                <button
                  onClick={() => handleSprintChange(null)}
                  className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
                >
                  <span className="text-slate-400">Backlog (No Sprint)</span>
                  {!component.sprintId && <Check className="w-4 h-4 text-cyan-400" />}
                </button>
                {availableSprints.map((sprint) => (
                  <button
                    key={sprint.id}
                    onClick={() => handleSprintChange(sprint.id)}
                    className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Zap className={`w-3 h-3 ${sprint.status === 'ACTIVE' ? 'text-green-400' : 'text-slate-400'}`} />
                      <span>{sprint.name}</span>
                      {sprint.status === 'ACTIVE' && <span className="text-xs text-green-400">(Active)</span>}
                    </span>
                    {component.sprintId === sprint.id && <Check className="w-4 h-4 text-cyan-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dependencies - Collapsed view (only show if not expanded) */}
        {!isExpanded && component.dependsOn.length > 0 && (
          <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5" />
            Depends on: {component.dependsOn.map((d) => d.requiredComponent.name).join(', ')}
          </div>
        )}

        {/* Component Context Panel */}
        <ComponentContextPanel component={component} />

        {/* Aging Indicator (Kanban feature) */}
        {showAging && component.status !== 'COMPLETED' && daysInStatus > 0 && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs mb-2 border ${agingColors.bg} ${agingColors.text} ${agingColors.border}`}
          >
            {isStale ? <AlertTriangle className="w-3 h-3" /> : <Timer className="w-3 h-3" />}
            <span>
              {daysInStatus} day{daysInStatus !== 1 ? 's' : ''} in{' '}
              {component.status === 'IN_PROGRESS' ? 'progress' : component.status.toLowerCase().replace('_', ' ')}
            </span>
            {isStale && <span className="font-medium">• Stale</span>}
          </div>
        )}

        {/* Cycle Time Display for Completed Items (Kanban feature) */}
        {showAging && component.status === 'COMPLETED' && component.cycleTimeDays !== null && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs mb-2 border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            <Clock className="w-3 h-3" />
            <span>
              Cycle time: {component.cycleTimeDays} day{component.cycleTimeDays !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          {/* Assignees - Collapsed view */}
          <div className="flex items-center gap-2">
            <div className="flex items-center -space-x-2">
              {component.assignments.length === 0 ? (
                <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <UserIcon className="w-3 h-3 text-slate-500" />
                </div>
              ) : (
                component.assignments.slice(0, 3).map(({ user }) => (
                  <div
                    key={user.id}
                    className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-xs font-medium border-2 border-slate-900"
                    title={user.name || user.email}
                  >
                    {user.name?.[0] || user.email[0].toUpperCase()}
                  </div>
                ))
              )}
              {component.assignments.length > 3 && (
                <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs text-slate-400">
                  +{component.assignments.length - 3}
                </div>
              )}
            </div>
            <AssignmentPanel
              componentId={component.id}
              componentName={component.name}
              currentAssignees={component.assignments.map((a) => a.user)}
              teamMembers={teamMembers}
            />
          </div>

          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {component.estimatedHours && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {component.estimatedHours}h
              </span>
            )}
            {component.dueDate && (
              <span
                className={`flex items-center gap-1 ${new Date(component.dueDate) < new Date() && component.status !== 'COMPLETED' ? 'text-red-400' : ''}`}
              >
                <Calendar className="w-3 h-3" />
                {new Date(component.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Refine Modal */}
      {showRefine && (
        <ComponentRefineModal
          component={{
            id: component.id,
            name: component.name,
            description: component.description,
            type: component.type,
            estimatedHours: component.estimatedHours,
            priority: component.priority,
          }}
          projectId={component.projectId}
          onClose={() => setShowRefine(false)}
          onSuccess={() => {
            setShowRefine(false);
            // Component will be updated via revalidatePath
          }}
        />
      )}
    </>
  );
}
