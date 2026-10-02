import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { SparklesIcon, Cancel } from '@hugeicons/core-free-icons';

interface GenerationLoadingPreviewProps {
  isExecuting: boolean;
  progress: number;
  stepMessage?: string | null;
  stage?: string | null;
  referenceImage?: string | null;
  prompt?: string | null;
  modelId?: string | null;
  onCancel?: () => void;
}

export const GenerationLoadingPreview: React.FC<GenerationLoadingPreviewProps> = ({
  isExecuting,
  progress,
  stepMessage,
  stage,
  referenceImage,
  prompt,
  modelId,
  onCancel,
}) => {
  if (!isExecuting) return null;

  const displayProgress = Math.max(5, Math.min(100, Math.round(progress || 10)));
  const formatModelName = (raw?: string | null) => {
    if (!raw) return '3D Model Engine';
    return raw
      .replace(/_/g, ' ')
      .replace(/image to (textured |raw )?mesh/gi, '')
      .replace(/text to (textured |raw )?mesh/gi, '')
      .trim()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4 select-none pointer-events-none animate-in fade-in duration-300">
      <style>{`
        @keyframes scanline {
          0% { top: 0%; opacity: 0.3; }
          50% { opacity: 0.9; }
          100% { top: 96%; opacity: 0.3; }
        }
      `}</style>
      {/* Soft Ambient Backdrop Blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md pointer-events-none" />

      {/* Studio Glassmorphic Card */}
      <div className="relative pointer-events-auto max-w-sm w-full bg-[hsl(var(--surface-1))]/85 border border-white/[0.1] rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.65)] backdrop-blur-xl flex flex-col items-center text-center space-y-4">
        {/* Header Badge */}
        <div className="w-full flex items-center justify-between border-b border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-[11px] font-semibold text-white tracking-wide">
              {stage ? `Stage: ${stage}` : 'Generating 3D Asset'}
            </span>
          </div>

          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 truncate max-w-[150px]">
            {formatModelName(modelId)}
          </span>
        </div>

        {/* Center Visual: Reference Image Preview OR Elegant Shimmer Ring */}
        {referenceImage ? (
          <div className="relative group my-1">
            {/* Ambient Image Glow */}
            <div 
              className="absolute -inset-2 rounded-2xl blur-xl opacity-35 transition-opacity pointer-events-none"
              style={{
                backgroundImage: `url(${referenceImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />

            {/* Thumbnail Card */}
            <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-white/[0.12] bg-black/60 shadow-lg flex items-center justify-center">
              <img
                src={referenceImage}
                alt="Generation source"
                className="w-full h-full object-cover"
              />
              
              {/* Subtle Scanning Shimmer Line */}
              <div 
                className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary/80 to-transparent animate-[shimmer_2.5s_infinite]"
                style={{
                  animation: 'scanline 2.4s ease-in-out infinite alternate',
                }}
              />
            </div>
            
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/80 border border-white/[0.1] text-[9px] text-zinc-300 whitespace-nowrap shadow">
              Reference Input
            </div>
          </div>
        ) : (
          <div className="relative my-2 flex flex-col items-center justify-center">
            {/* Minimalist Studio Spinner */}
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" />
              <div 
                className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin"
                style={{ animationDuration: '1.2s' }}
              />
              <HugeiconsIcon icon={SparklesIcon} size={22} className="w-5 h-5 text-primary animate-pulse" />
            </div>

            {prompt && (
              <p className="mt-3 text-[11px] text-zinc-300 italic max-w-[260px] line-clamp-2 px-2">
                &ldquo;{prompt}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Live Step Message & Percentage */}
        <div className="w-full space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs px-0.5">
            <span className="text-zinc-300 text-[11px] font-medium truncate max-w-[240px] text-left">
              {stepMessage || 'Synthesizing neural 3D representation...'}
            </span>
            <span className="font-mono text-xs font-bold text-primary">
              {displayProgress}%
            </span>
          </div>

          {/* Minimalist Progress Track */}
          <div className="w-full h-1.5 rounded-full bg-black/60 border border-white/[0.08] overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
              style={{ width: `${displayProgress}%` }}
            />
          </div>
        </div>

        {/* Bottom Bar: Status + Cancel */}
        <div className="w-full flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-white/[0.04]">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>GPU Active</span>
          </span>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer flex items-center gap-1 font-medium"
            >
              <HugeiconsIcon icon={Cancel} size={12} className="w-3 h-3" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
