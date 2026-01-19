'use client';

import { useState } from 'react';
import { GitBranch, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  componentId: string;
  componentName: string;
  userName?: string;
}

/**
 * Generates a git-friendly branch name from a component
 * Format: {username}/{component-id-prefix}-{slugified-name}
 * Example: anna/clx123-user-authentication
 */
function generateBranchName(componentId: string, componentName: string, userName?: string): string {
  // Use first 7 characters of component ID (like git short hash)
  const idPrefix = componentId.slice(0, 7);
  
  // Slugify the component name
  const slug = componentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')     // Trim leading/trailing hyphens
    .slice(0, 40);               // Limit length
  
  // Build branch name
  const prefix = userName 
    ? `${userName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/` 
    : '';
  
  return `${prefix}${idPrefix}-${slug}`;
}

export default function CopyBranchButton({ componentId, componentName, userName }: Props) {
  const [copied, setCopied] = useState(false);
  
  const branchName = generateBranchName(componentId, componentName, userName);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(branchName);
      setCopied(true);
      toast.success('Branch name copied!', {
        description: branchName,
      });
      
      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy branch name');
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
      title={`Copy branch name: ${branchName}`}
    >
      <GitBranch className="w-3.5 h-3.5" />
      {copied ? (
        <>
          <Check className="w-3 h-3 text-green-400" />
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span>Copy Branch</span>
        </>
      )}
    </button>
  );
}

// Export the utility function for use elsewhere
export { generateBranchName };
