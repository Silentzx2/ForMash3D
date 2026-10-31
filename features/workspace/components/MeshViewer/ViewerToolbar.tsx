'use client';

import React, { useCallback } from 'react';
import { useWorkspace } from '../../store/WorkspaceContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircle, SparklesIcon } from '@hugeicons/core-free-icons';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

export function ViewerToolbar() {
  const { currentAsset, isExecuting, refineMesh, jobsById } = useWorkspace();

  const refineJob = Object.values(jobsById).find(job => job.type === 'refine');
  const isRefining =
    refineJob !== undefined &&
    refineJob.status !== 'completed' &&
    refineJob.status !== 'failed' &&
    refineJob.status !== 'interrupted';

  const handleRefine = useCallback(() => {
    void refineMesh();
  }, [refineMesh]);

  // No mesh loaded: nothing to refine. Another job running: hide the button
  // but keep the refine pill visible while our own job is in flight.
  if (!currentAsset) return null;
  if (isExecuting && !isRefining) return null;

  return (
    <SimpleTooltip side="top" label={isRefining ? 'Hi3D refinement in progress' : 'Refine with Hi3D'}>
      {isRefining ? (
        <div className="px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.12] shadow-xl flex items-center gap-2 text-xs font-bold text-white animate-in fade-in zoom-in-95">
          <HugeiconsIcon icon={LoaderCircle} size={16} className="w-3.5 h-3.5 text-primary animate-spin" />
          <span>Refining geometry with Hi3D...</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleRefine}
          className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 active:scale-95 text-[#080808] text-xs font-black shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] transition-all cursor-pointer border border-white/20 btn-lighting-shine"
        >
          <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Refine with Hi3D</span>
        </button>
      )}
    </SimpleTooltip>
  );
}
