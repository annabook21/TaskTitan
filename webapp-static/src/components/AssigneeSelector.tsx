import { useState, useEffect } from 'react';
import {
  listAssignmentsForComponent,
  assignUserToComponent,
  unassignUserFromComponent,
  type Assignment,
  type Membership,
} from '../api/appsync';
import { getMemberDisplayName } from '../utils/userDisplay';

interface AssigneeSelectorProps {
  componentId: string;
  teamMembers: Membership[];
  currentUserId?: string;
  projectOwnerId?: string;
  onAssignmentChange?: () => void;
}

// Extract error message from various error formats (GraphQL, Error, etc.)
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    const errObj = err as { errors?: Array<{ message: string }>; message?: string };
    if (errObj.errors && errObj.errors.length > 0) {
      return errObj.errors.map((e) => e.message).join('; ');
    }
    if (errObj.message) {
      return errObj.message;
    }
  }
  return fallback;
}

export function AssigneeSelector({
  componentId,
  teamMembers,
  currentUserId,
  projectOwnerId,
  onAssignmentChange,
}: AssigneeSelectorProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    loadAssignments();
  }, [componentId]);

  const loadAssignments = async () => {
    try {
      const data = await listAssignmentsForComponent(componentId);
      setAssignments(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load assignments'));
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (userId: string) => {
    setAssigning(true);
    setError(null);
    try {
      const assignment = await assignUserToComponent(componentId, userId);
      setAssignments((prev) => [...prev, assignment]);
      onAssignmentChange?.();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to assign user'));
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (userId: string) => {
    setError(null);
    try {
      await unassignUserFromComponent(componentId, userId);
      setAssignments((prev) => prev.filter((a) => a.userId !== userId));
      onAssignmentChange?.();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to unassign user'));
    }
  };

  // Get first assignment (single assignment model)
  const assignment = assignments[0];
  const assignedMember = assignment ? teamMembers.find((m) => m.userId === assignment.userId) : null;

  // Check if current user is project owner
  const isOwner = currentUserId && projectOwnerId && currentUserId === projectOwnerId;

  // Available members (only show if no one is assigned)
  const availableMembers = assignment ? [] : teamMembers;

  if (loading) {
    return <p className="text-sm text-slate-400">Loading assignee...</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Assigned To
        </label>

        {/* Show assigned user */}
        {assignment && assignedMember ? (
          <div className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded-lg">
            <span className="text-slate-200 text-sm">
              {getMemberDisplayName(assignedMember)}
            </span>
            {isOwner && (
              <button
                onClick={() => handleUnassign(assignment.userId)}
                className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                title="Remove assignment"
              >
                Remove
              </button>
            )}
          </div>
        ) : assignment && !assignedMember ? (
          <div className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded-lg">
            <span className="text-slate-400 text-sm">{assignment.userId}</span>
            {isOwner && (
              <button
                onClick={() => handleUnassign(assignment.userId)}
                className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                title="Remove assignment"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          /* Show dropdown when no one is assigned */
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAssign(e.target.value);
                e.target.value = '';
              }
            }}
            disabled={assigning}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
          >
            <option value="">Select a team member...</option>
            {availableMembers.map((member) => (
              <option key={member.userId} value={member.userId}>
                {getMemberDisplayName(member)} ({member.role})
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
