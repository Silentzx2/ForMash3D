"use client";


import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  TrashIcon,
  Activity01Icon,
  UsersIcon,
  ClockIcon,
  ZapIcon,
  RefreshCwIcon,
  AlertCircleIcon,
  TriangleAlertIcon,
  WrenchIcon,
  CheckmarkCircle02Icon,
  LoaderCircleIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { MetricCard } from '@/components/premium/MetricCard';
import { Badge } from '@/components/premium/Badge';
import { NeonButton } from '@/components/premium/NeonButton';
import { StatusDot } from '@/components/premium/StatusDot';
import { Spinner } from '@/components/premium/Spinner';
import { getApiClient } from '@/services/apiClient';
import { diagnoseJobError, type JobDiagnostic } from '@/lib/jobDiagnostics';
import type { QueueStatus, AdminJob } from '@/types';
import { toast } from 'sonner';

export function QueueTab() {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [failedJobs, setFailedJobs] = useState<AdminJob[]>([]);
  const [queuedJobs, setQueuedJobs] = useState<AdminJob[]>([]);
  const [activeJob, setActiveJob] = useState<AdminJob | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repairingJobs, setRepairingJobs] = useState<Record<string, boolean>>({});
  const [repairedJobs, setRepairedJobs] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const [queueData, jobsData] = await Promise.allSettled([
        getApiClient().getQueueStats(),
        getApiClient().getJobsHistory({ limit: 50 }),
      ]);

      if (queueData.status === 'fulfilled' && queueData.value) {
        const q = queueData.value.data;
        setQueue({
          active: q.processing_jobs ?? 0,
          queued: q.pending_jobs ?? 0,
          reserved: 0,
          workers: 0,
          scheduler_running: q.processing_jobs > 0,
        } as any);
        setError(null);
      } else {
        setError('Failed to load queue status');
      }

      if (jobsData.status === 'fulfilled') {
        const rawJobs = (jobsData.value?.jobs ?? []) as unknown as AdminJob[];
        setFailedJobs(rawJobs.filter((j: any) => j.status === 'failed'));
        setActiveJob(rawJobs.find((j: any) => j.status === 'processing') || null);
        setQueuedJobs(rawJobs.filter((j: any) => j.status === 'queued'));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const handleCancelQueuedJob = async (jobId: string) => {
    setCancellingJobId(jobId);
    try {
      const res = await getApiClient().cancelJob(jobId);
      if (res?.success) {
        toast.success(`Job ${jobId.slice(0, 8)} cancelled`);
        setQueuedJobs(prev => prev.filter(j => j.id !== jobId));
        await load();
      } else {
        toast.error('Failed to cancel job');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error cancelling job');
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleMoveJob = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= queuedJobs.length) return;
    const updated = [...queuedJobs];
    const [moved] = updated.splice(index, 1);
    updated.splice(newIndex, 0, moved);
    setQueuedJobs(updated);

    setIsReordering(true);
    try {
      await getApiClient().reorderQueue(updated.map(j => j.id));
      toast.success('Queue order updated');
    } catch {
      toast.error('Failed to update queue order on backend');
      await load();
    } finally {
      setIsReordering(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, 12000);
    return () => clearInterval(interval);
  }, [load]);

const handleRepair = async (job: AdminJob, diag: JobDiagnostic) => {
  const key = job.id;
  setRepairingJobs(prev => ({ ...prev, [key]: true }));
  toast.info(`Repair for ${diag.providerLabel} not available in this backend.`, {
    description: 'The new backend does not support provider repair operations.',
  });
  setRepairingJobs(prev => ({ ...prev, [key]: false }));
};

const handlePurge = async () => {
  toast.info('Purge not available in this backend');
};

  const repairableJobs = failedJobs
    .map(job => ({ job, diag: diagnoseJobError(job) }))
    .filter((item): item is { job: AdminJob; diag: JobDiagnostic } => item.diag !== null);

  if (loading && !queue) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !queue) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <HugeiconsIcon icon={AlertCircleIcon} className="w-10 h-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-primary hover:underline flex items-center gap-1.5 cursor-pointer">
          <HugeiconsIcon icon={RefreshCwIcon} className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Job Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Celery task queue &amp; runtime monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLoading(true); load(); }}
            title="Refresh queue"
            className="p-2 rounded-xl glass border border-[hsl(var(--border)/0.5)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={RefreshCwIcon} className="w-4 h-4" />
          </button>
          <NeonButton variant="destructive" size="sm" onClick={handlePurge}>
            <HugeiconsIcon icon={TrashIcon} className="w-3.5 h-3.5" /> Purge Queue
          </NeonButton>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Active" value={queue?.active ?? 0} icon={<HugeiconsIcon icon={Activity01Icon} size={16} className="w-4 h-4 text-primary" />} color="amber" delay={0.05} />
        <MetricCard label="Queued" value={queue?.queued ?? 0} icon={<HugeiconsIcon icon={ClockIcon} size={16} className="w-4 h-4 text-primary" />} color="blue" delay={0.1} />
        <MetricCard label="Reserved" value={queue?.reserved ?? 0} icon={<HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 text-primary" />} color="amber" delay={0.15} />
        <MetricCard label="Workers" value={queue?.workers ?? 0} icon={<HugeiconsIcon icon={UsersIcon} size={16} className="w-4 h-4 text-primary" />} color="green" delay={0.2} />
      </div>

      {/* Active Job (Locked) */}
      {activeJob && (
        <GlassCard className="p-5 border-amber-500/30 bg-amber-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-bold text-white">Active Job Running (Single-GPU Lock)</span>
              <Badge variant="warning">Executing</Badge>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">ID: {activeJob.id}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>Feature: <strong className="text-white">{activeJob.feature || (activeJob as any).type || 'Generation'}</strong></span>
            <span>Started: <span className="font-mono">{activeJob.started_at ? new Date(activeJob.started_at).toLocaleTimeString() : 'In Progress'}</span></span>
          </div>
          <p className="text-[10.5px] text-zinc-400">
            🔒 This job is actively computing on hardware and cannot be reordered. Pending queue jobs below will run sequentially upon completion.
          </p>
        </GlassCard>
      )}

      {/* Queued Jobs (Manual Reorder & Cancel) */}
      <GlassCard className="p-5 space-y-4" delay={0.2}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Pending Queue Sequence</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                {queuedJobs.length} {queuedJobs.length === 1 ? 'Job' : 'Jobs'}
              </span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Pending jobs to be processed. Reorder priority with buttons before execution starts.
            </p>
          </div>
          {isReordering && (
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <HugeiconsIcon icon={LoaderCircleIcon} className="w-3.5 h-3.5 animate-spin" />
              <span>Saving order…</span>
            </div>
          )}
        </div>

        {queuedJobs.length === 0 ? (
          <div className="py-8 text-center text-zinc-400 border border-dashed border-white/[0.08] rounded-xl">
            <HugeiconsIcon icon={ClockIcon} className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
            <p className="text-xs">No pending jobs in queue.</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">New generation and batch requests will appear here in live priority order.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {queuedJobs.map((job, idx) => {
              const isCancelling = cancellingJobId === job.id;
              return (
                <div
                  key={job.id}
                  className="p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-white/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-black/40 text-primary font-mono font-bold text-xs border border-white/[0.06]">
                      #{idx + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {job.feature || (job as any).type || 'Generation Job'}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[120px] sm:max-w-none">
                          ({job.id})
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                        <span>Queued: {job.created_at ? new Date(job.created_at).toLocaleTimeString() : 'Just now'}</span>
                        {job.model_preference && <span>• Model: {job.model_preference}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Move Up */}
                    <button
                      type="button"
                      disabled={idx === 0 || isReordering}
                      onClick={() => handleMoveJob(idx, -1)}
                      title="Move up in queue"
                      className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={ArrowUp01Icon} className="w-3.5 h-3.5" />
                    </button>

                    {/* Move Down */}
                    <button
                      type="button"
                      disabled={idx === queuedJobs.length - 1 || isReordering}
                      onClick={() => handleMoveJob(idx, 1)}
                      title="Move down in queue"
                      className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={ArrowDown01Icon} className="w-3.5 h-3.5" />
                    </button>

                    {/* Cancel Queued Job */}
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={() => handleCancelQueuedJob(job.id)}
                      title="Cancel queued job"
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isCancelling ? (
                        <HugeiconsIcon icon={LoaderCircleIcon} className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <HugeiconsIcon icon={TrashIcon} className="w-3.5 h-3.5" />
                      )}
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Runtime Errors & Repair Actions */}
      {repairableJobs.length > 0 && (
        <GlassCard className="p-5 border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.04)] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--destructive))]">
              <HugeiconsIcon icon={TriangleAlertIcon} className="w-4 h-4 flex-shrink-0" />
              <span>Provider Runtime Errors ({repairableJobs.length})</span>
            </div>
            <span className="text-xs text-muted-foreground">Requires environment re-initialization</span>
          </div>

          <div className="space-y-2">
            {repairableJobs.map(({ job, diag }) => {
              const isRepairing = Boolean(repairingJobs[job.id]);
              const isRepaired = Boolean(repairedJobs[job.id]);

              return (
                <div
                  key={job.id}
                  className="p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--destructive)/0.2)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{diag.providerLabel}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">({job.id})</span>
                      <Badge variant="error">{diag.issueDescription}</Badge>
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground break-all">
                      {job.error || job.error_message}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      💡 {diag.suggestedAction}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRepaired && !isRepairing && (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                         <HugeiconsIcon icon={CheckmarkCircle02Icon} className="w-3.5 h-3.5" /> Repaired
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRepair(job, diag)}
                      disabled={isRepairing}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive)/0.85)] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isRepairing ? (
                        <>
                           <HugeiconsIcon icon={LoaderCircleIcon} className="w-3.5 h-3.5 animate-spin" />
                          <span>Repairing...</span>
                        </>
                      ) : (
                        <>
                           <HugeiconsIcon icon={WrenchIcon} className="w-3.5 h-3.5" />
                          <span>Try Repair ({diag.providerLabel})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-5" delay={0.25}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Scheduler Status</h3>
          <div className="flex items-center gap-2">
            <StatusDot status={queue?.scheduler_running ? 'online' : 'offline'} size="sm" />
            <span className="text-xs text-muted-foreground">{queue?.scheduler_running ? 'Running' : 'Stopped'}</span>
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: queue?.workers ?? 0 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="flex items-center justify-between p-3 rounded-xl glass border border-[hsl(var(--border)/0.3)]"
            >
              <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-2">
                   <HugeiconsIcon icon={UsersIcon} className="w-4 h-4 text-muted-foreground" />
                 </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Worker {i + 1}</p>
                  <p className="text-xs text-muted-foreground">celery@worker-{i + 1}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success">
                  <StatusDot status="online" size="sm" pulse={false} />
                  Active
                </Badge>
              </div>
            </motion.div>
          ))}
          {(queue?.workers ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
               <HugeiconsIcon icon={UsersIcon} className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No active workers</p>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
