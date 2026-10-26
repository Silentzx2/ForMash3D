import React from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LoaderCircle,
  Plus,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

export interface GenerateActionFooterProps {
  isExecuting: boolean;
  executionProgress: number;
  executionStep: string;
  onGenerate: () => void;
  onQueueNext?: () => void;
  activeModelLabel: string;
  isPostprocessOff: boolean;
  targetPolycount: number;
  isQuad: boolean;
  generateTexture: boolean;
}

export const GenerateActionFooter: React.FC<GenerateActionFooterProps> = React.memo(({
  isExecuting,
  executionProgress,
  executionStep,
  onGenerate,
  onQueueNext,
  activeModelLabel,
  isPostprocessOff,
  targetPolycount,
  isQuad,
  generateTexture,
}) => {
  return (
    <div className="p-3 border-t border-white/[0.08] bg-[#16171B] relative z-20 flex-shrink-0 space-y-2.5 overflow-x-hidden">
      {/* Pre-flight Configuration Summary Bar */}
      <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-400 px-0.5">
        <div className="flex items-center gap-1.5 truncate min-w-0">
          <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-200 font-semibold truncate max-w-[140px]">
            {activeModelLabel}
          </span>
          <span>•</span>
          <span
            className={`px-1.5 py-0.5 rounded font-semibold uppercase flex-shrink-0 ${
              isPostprocessOff
                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                : 'bg-[#F5C542]/15 text-[#F5C542]'
            }`}
          >
            {isPostprocessOff
              ? 'RAW NATIVE'
              : `${targetPolycount <= 0 ? 'RAW' : `${Math.round(targetPolycount / 1000)}K`} ${
                  isQuad ? 'QUADS' : 'TRIS'
                }`}
          </span>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border flex-shrink-0 ${
            isPostprocessOff
              ? 'bg-zinc-800/80 text-zinc-400 border-white/[0.08]'
              : generateTexture
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
          }`}
        >
          {isPostprocessOff
            ? 'RAW GEOMETRY'
            : generateTexture
            ? 'PBR TEXTURED'
            : 'GEOMETRY ONLY'}
        </span>
      </div>

      {/* Main 44px Rounded-Full Action Button in Warm Studio Gold #F5C542 */}
      <div className="flex items-center gap-2 w-full">
        <button
          id="btn-generate-model-action"
          type="button"
          disabled={isExecuting}
          onClick={onGenerate}
          className={`flex-1 h-11 rounded-full font-black text-xs flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer disabled:cursor-wait ${
            isExecuting
              ? 'bg-[#242732] text-[#F5C542] border border-[#F5C542]/30 shadow-none'
              : 'bg-[#F5C542] hover:bg-[#FFE066] text-black shadow-[0_4px_16px_rgba(245,197,66,0.35)] hover:shadow-[0_6px_20px_rgba(245,197,66,0.5)] active:scale-[0.98]'
          }`}
        >
          {isExecuting ? (
            <>
              <HugeiconsIcon
                icon={LoaderCircle}
                size={18}
                className="animate-spin text-[#F5C542]"
              />
              <span className="tracking-wide truncate max-w-[190px]">
                {executionStep || 'Generating 3D Model...'}
              </span>
            </>
          ) : (
            <>
              <HugeiconsIcon
                icon={ZapIcon}
                size={16}
                className="text-black stroke-[2.5]"
              />
              <span className="tracking-wider uppercase">GENERATE 3D MODEL</span>
            </>
          )}
        </button>

        {isExecuting && onQueueNext && (
          <SimpleTooltip label="Queue next asset in background" side="top">
            <button
              type="button"
              onClick={onQueueNext}
              className="h-11 px-3.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-zinc-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0"
            >
              <HugeiconsIcon icon={Plus} size={15} />
              <span>Queue Next</span>
            </button>
          </SimpleTooltip>
        )}
      </div>

      {/* Live Execution Progress Ring / Bar */}
      {isExecuting && (
        <div className="relative mt-1 p-2 rounded-xl bg-[#1D1F26] border border-white/[0.06] overflow-hidden space-y-1.5">
          <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-400 px-0.5">
            <span className="truncate max-w-[200px]">{executionStep || 'Processing generation...'}</span>
            <span className="text-[#F5C542] font-bold">
              {Math.round(executionProgress || 0)}%
            </span>
          </div>
          <div className="w-full bg-[#16171B] h-1.5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${executionProgress || 0}%` }}
              className="bg-[#F5C542] h-full rounded-full"
            />
          </div>
        </div>
      )}
    </div>
  );
});

GenerateActionFooter.displayName = 'GenerateActionFooter';
