import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import './ComfyTextButton.css';

export default function ComfyTextButton({
  onResult,
  title = 'AI prompt helper',
  className = ''
}: {
  onResult?: (text: string) => void;
  title?: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [promptText, setPromptText] = useState('');

  const handleApply = () => {
    if (promptText.trim() && onResult) {
      onResult(promptText.trim());
    }
    setIsOpen(false);
    setPromptText('');
  };

  return (
    <>
      <button
        type="button"
        className={`comfy-text-btn ${className}`.trim()}
        title={title}
        aria-label={title}
        onClick={() => setIsOpen(true)}
      >
        <Sparkles className="w-3.5 h-3.5 text-primary" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[hsl(var(--surface-0))] border border-white/[0.12] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">AI Prompt Assistant</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white text-xs px-2 py-1 rounded-md bg-white/[0.04]"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-zinc-400">
              Enter enhanced description, prompt guidelines, or stylistic tokens to insert into the field:
            </p>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="e.g. photorealistic weathered brass, detailed ambient occlusion, 8k textures..."
              className="w-full h-28 p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-primary resize-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white bg-white/[0.05]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!promptText.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-primary hover:brightness-110 disabled:opacity-40"
              >
                Insert Prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
