import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel } from '@hugeicons/core-free-icons';

export const ActiveJobFloatingCard: React.FC = React.memo(() => {
  const {
    activeTask,
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    jobsById,
  } = useWorkspace();

  // Find currently active generation task
  const activeJob = useMemo(() => {
    if (activeTask && (activeTask.status === 'running' || activeTask.status === 'queued' || (activeTask.status as string) === 'processing' || isExecuting)) {
      return activeTask;
    }
    return Object.values(jobsById).find(
      (job) => job.status === 'running' || job.status === 'queued' || (job.status as string) === 'processing'
    ) || null;
  }, [activeTask, isExecuting, jobsById]);

  const isJobActive = Boolean(
    isExecuting ||
    (activeJob && (activeJob.status === 'running' || activeJob.status === 'queued' || (activeJob.status as string) === 'processing'))
  );

  // Fallback start timestamp to ensure elapsed timer keeps counting even if startedAt is unset
  const fallbackStartRef = useRef<number>(Date.now());
  const prevActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (isJobActive && !prevActiveRef.current) {
      fallbackStartRef.current = Date.now();
    }
    prevActiveRef.current = isJobActive;
  }, [isJobActive]);

  // Live elapsed timer state (updates once per second when active)
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (!isJobActive) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isJobActive]);

  const elapsedSeconds = useMemo(() => {
    const start = activeJob?.startedAt || fallbackStartRef.current;
    return Math.max(0, Math.floor((now - start) / 1000));
  }, [activeJob?.startedAt, now]);

  const formattedTimer = useMemo(() => {
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const seconds = String(elapsedSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}s`;
  }, [elapsedSeconds]);

  // Normalized progress (0 to 100)
  const progress = useMemo(() => {
    const val = activeJob?.progress ?? executionProgress ?? 0;
    return Math.min(100, Math.max(0, Math.round(val)));
  }, [activeJob?.progress, executionProgress]);

  // Radial SVG calculation
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  // Live stage text with fallback stages matching generation pipeline
  const liveStageText = useMemo(() => {
    if (activeJob?.currentStep && activeJob.currentStep.trim().length > 0) {
      return activeJob.currentStep;
    }
    if (executionStep && executionStep.trim().length > 0) {
      return executionStep;
    }
    if (progress < 25) return 'Geometry synthesis...';
    if (progress < 55) return 'Surface reconstruction...';
    if (progress < 85) return 'Normal refinement...';
    return 'Finalizing asset bundle...';
  }, [activeJob?.currentStep, executionStep, progress]);

  const jobTitle = activeJob?.title || '3D Asset Generation';

  const jobTypeBadge = useMemo(() => {
    const type = activeJob?.type || 'image-to-3d';
    switch (type) {
      case 'image-to-3d': return '3D Gen';
      case 'texture': return 'Texture';
      case 'remesh': return 'Retopo';
      case 'segment': return 'Segment';
      case 'rigging': return 'Rigging';
      case 'animation': return 'Animation';
      default: return 'Job';
    }
  }, [activeJob?.type]);

  const handleCancel = () => {
    void cancelExecution();
  };

  return (
    <AnimatePresence>
      {isJobActive && (
        <motion.aside
          id="active-job-floating-card"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.94 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-40 bg-[#16171B]/95 border border-white/[0.08] backdrop-blur-xl rounded-2xl p-4 shadow-2xl w-[320px] h-[148px] max-h-[148px] box-border select-none text-xs flex flex-col justify-between"
        >
          {/* Top Row: Radial Ring + Title & Timer (Fixed 48px height) */}
          <div className="flex items-center gap-3 h-12 flex-shrink-0">
            {/* Radial SVG Progress Ring with Percentage inside */}
            <div className="relative w-12 h-12 flex-shrink-0 flex items-center justify-center">
              <svg className="w-12 h-12 -rotate-90 transform" viewBox="0 0 48 48">
                {/* Background track circle */}
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className="text-white/[0.08]"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="transparent"
                />
                {/* Studio Gold Progress Arc */}
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className="text-[#F5C542] transition-all duration-300 ease-out"
                  strokeWidth="3.5"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] font-mono font-bold text-white tracking-tight tabular-nums">
                  {progress}%
                </span>
              </div>
            </div>

            {/* Job Metadata & Timer */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[#F5C542]/15 text-[#F5C542] border border-[#F5C542]/30 flex-shrink-0">
                  {jobTypeBadge}
                </span>
                <span className="text-[11px] font-mono font-bold text-zinc-300 tabular-nums">
                  {formattedTimer}
                </span>
              </div>
              <div className="text-xs font-bold text-white truncate h-4 leading-4" title={jobTitle}>
                {jobTitle}
              </div>
            </div>
          </div>

          {/* Middle Row: Live Stage Indicator with Animated Pulsing Dot (Fixed 24px height) */}
          <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 min-w-0 h-6 flex-shrink-0">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F5C542] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#F5C542]" />
            </span>
            <span className="text-[11px] text-zinc-200 font-medium truncate h-4 leading-4" title={liveStageText}>
              {liveStageText}
            </span>
          </div>

          {/* Bottom Row: Cancel Job Button (Fixed 32px height) */}
          <div className="h-8 flex-shrink-0">
            <button
              type="button"
              id="btn-cancel-active-job"
              onClick={handleCancel}
              className="w-full h-8 flex items-center justify-center gap-1.5 px-3 rounded-xl bg-white/[0.04] hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/30 text-zinc-400 border border-white/[0.06] text-xs font-semibold transition-all cursor-pointer active:scale-[0.98]"
            >
              <HugeiconsIcon icon={Cancel} size={14} className="w-3.5 h-3.5" />
              <span>Cancel Job</span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
});

ActiveJobFloatingCard.displayName = 'ActiveJobFloatingCard';

export default ActiveJobFloatingCard;
