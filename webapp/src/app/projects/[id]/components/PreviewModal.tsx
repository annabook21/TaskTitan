'use client';

import { X, Eye } from 'lucide-react';

interface Props {
  htmlContent: string;
  componentName: string;
  previewId: string;
  onClose: () => void;
}

// FORGE: Export HTML feature removed - wireframe bucket not available
export default function PreviewModal({ htmlContent, componentName, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-slate-900 rounded-xl border border-slate-800 shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400" />
            Wireframe Preview: {componentName}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Iframe Container */}
        <div className="p-4 bg-white">
          <iframe
            srcDoc={htmlContent}
            className="w-full h-[70vh] border-0 rounded-lg"
            sandbox="" // Empty sandbox for maximum security (best practice from research)
            title={`Wireframe Preview: ${componentName}`}
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex justify-between items-center">
          <p className="text-xs text-slate-500">
            This is an AI-generated wireframe. Use it as a starting point for development.
          </p>
          <button onClick={onClose} className="btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
