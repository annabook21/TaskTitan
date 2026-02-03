import { useState, useRef, useEffect, useCallback } from 'react';
import { searchTeamMembersForMention, type TeamMemberSuggestion } from '../api/appsync';
import { Loader2 } from 'lucide-react';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  teamId: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function MentionInput({
  value,
  onChange,
  teamId,
  placeholder = 'Add a comment...',
  disabled = false,
  rows = 2,
  onKeyDown,
  className = '',
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<TeamMemberSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Debounce the mention query to avoid excessive API calls
  const debouncedQuery = useDebounce(mentionQuery, 200);

  // Fetch suggestions when query changes
  useEffect(() => {
    if (debouncedQuery === null || debouncedQuery.length < 1) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;

    const fetchSuggestions = async () => {
      setLoading(true);
      try {
        const results = await searchTeamMembersForMention(teamId, debouncedQuery);
        if (!cancelled) {
          setSuggestions(results.slice(0, 8)); // Limit to 8 suggestions
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error('Failed to fetch mention suggestions:', err);
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchSuggestions();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, teamId]);

  // Handle input change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      onChange(newValue);

      // Check if we're in a mention context
      // Look for @ that isn't preceded by ] (which would be part of a completed mention)
      const textBeforeCursor = newValue.substring(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf('@');

      if (atIndex !== -1) {
        // Check if this @ is part of an existing mention or a new one
        const textAfterAt = textBeforeCursor.substring(atIndex + 1);

        // If there's a closing bracket before the @, or if the @ is part of a completed mention, ignore
        const textBetweenAtAndCursor = textAfterAt;
        const hasCompletedMention = textBetweenAtAndCursor.includes('[') && textBetweenAtAndCursor.includes('](');

        // If the character before @ is alphanumeric, it's not a mention trigger
        const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
        const isWordBoundary = /[\s\n]/.test(charBeforeAt) || atIndex === 0;

        if (!hasCompletedMention && isWordBoundary && !textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
          setMentionQuery(textAfterAt);
          setMentionStartPos(atIndex);
          return;
        }
      }

      // No active mention
      setMentionQuery(null);
      setMentionStartPos(null);
      setSuggestions([]);
    },
    [onChange]
  );

  // Handle keyboard navigation in dropdown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.length > 0 && mentionQuery !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % suggestions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          selectSuggestion(suggestions[selectedIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
          setMentionStartPos(null);
          setSuggestions([]);
          return;
        }
      }

      // Call parent's onKeyDown
      onKeyDown?.(e);
    },
    [suggestions, mentionQuery, selectedIndex, onKeyDown]
  );

  // Select a suggestion and insert the mention
  const selectSuggestion = useCallback(
    (suggestion: TeamMemberSuggestion) => {
      if (mentionStartPos === null) return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      // Format: @[Name](userId)
      const mentionText = `@[${suggestion.name}](${suggestion.id}) `;

      // Replace the @query with the mention
      const beforeMention = value.substring(0, mentionStartPos);
      const afterMention = value.substring(textarea.selectionStart);
      const newValue = beforeMention + mentionText + afterMention;

      onChange(newValue);

      // Reset mention state
      setMentionQuery(null);
      setMentionStartPos(null);
      setSuggestions([]);

      // Set cursor position after the mention
      setTimeout(() => {
        const newCursorPos = mentionStartPos + mentionText.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [mentionStartPos, value, onChange]
  );

  // Calculate dropdown position
  const getDropdownPosition = () => {
    if (!textareaRef.current || mentionStartPos === null) return { top: 0, left: 0 };

    // Simple positioning - show below the textarea
    return {
      top: '100%',
      left: 0,
    };
  };

  const showDropdown = mentionQuery !== null && (loading || suggestions.length > 0);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={`w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none disabled:opacity-50 ${className}`}
      />

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto"
          style={getDropdownPosition()}
        >
          {loading && suggestions.length === 0 ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-400">Searching...</span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="py-3 px-4 text-sm text-slate-500">
              No members found
            </div>
          ) : (
            <ul>
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  onClick={() => selectSuggestion(suggestion)}
                  className={`px-4 py-2 cursor-pointer flex items-center gap-2 ${
                    index === selectedIndex
                      ? 'bg-cyan-600/30 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs font-medium">
                    {suggestion.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1">{suggestion.name}</span>
                  {suggestion.isGuest && (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                      Guest
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
