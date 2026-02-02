import { useState, useEffect, useRef } from 'react';
import { guestListComments, guestCreateComment, type Comment } from '../api/appsync';
import { Loader2, MessageSquare, Send } from 'lucide-react';

interface GuestCommentSectionProps {
  guestId: string;
  componentId: string;
  /** If true, hides the add comment form (for read-only views) */
  readOnly?: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function GuestCommentSection({ guestId, componentId, readOnly = false }: GuestCommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadComments();
  }, [guestId, componentId]);

  const loadComments = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await guestListComments(guestId, componentId);
      setComments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const created = await guestCreateComment(guestId, componentId, newComment.trim());
      setComments((prev) => [...prev, created]);
      setNewComment('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Ctrl/Cmd + Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <MessageSquare className="w-4 h-4" />
        <span>Comments ({comments.length})</span>
      </div>

      {error && (
        <div className="p-2 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-500 py-2">No comments yet.</p>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="flex items-start gap-3 text-sm"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-300 font-medium">
                {comment.authorName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-slate-200">
                    {comment.authorName}
                  </span>
                  <span className="text-slate-500 text-xs">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                  {comment.authorType === 'GUEST' && (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                      Guest
                    </span>
                  )}
                </div>
                <p className="text-slate-300 mt-0.5 whitespace-pre-wrap break-words">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <form onSubmit={handleSubmit} className="mt-4">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (Ctrl+Enter to send)"
              disabled={submitting}
              rows={2}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={submitting || !newComment.trim()}
              className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors self-end"
              title="Post comment"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Press Ctrl+Enter to send
          </p>
        </form>
      )}
    </div>
  );
}
