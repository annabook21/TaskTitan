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

  // Get assigned user IDs for filtering
  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const availableMembers = teamMembers.filter((m) => !assignedUserIds.has(m.userId));

  // Map user IDs to member info for display
  const memberMap = new Map(teamMembers.map((m) => [m.userId, m]));

  if (loading) {
    return <p className="text-sm text-slate-400">Loading assignees...</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Current Assignees */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Assigned To
        </label>
        {assignments.length === 0 ? (
          <p className="text-sm text-slate-500">No one assigned</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assignments.map((assignment) => {
              const member = memberMap.get(assignment.userId);
              return (
                <div
                  key={assignment.userId}
                  className="flex items-center gap-2 px-2 py-1 bg-slate-700 rounded text-sm"
                >
                  <span className="text-slate-200">
                    {member ? getMemberDisplayName(member) : assignment.userId}
                  </span>
                  <button
                    onClick={() => handleUnassign(assignment.userId)}
                    className="text-slate-400 hover:text-red-400 text-xs"
                    title="Remove assignee"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Assignee */}
      {availableMembers.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Add Assignee
          </label>
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAssign(e.target.value);
                e.target.value = '';
              }
            }}
            disabled={assigning}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="">Select a team member...</option>
            {availableMembers.map((member) => (
              <option key={member.userId} value={member.userId}>
                {getMemberDisplayName(member)} ({member.role})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
