"use client";


import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Trash2,
  Activity,
  Users,
  Clock,
  Zap,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
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
        const queue = queueData.value.data;
        setQueue({
          active: queue.processing_jobs ?? 0,
          queued: queue.pending_jobs ?? 0,
          reserved: 0,
          workers: 0,
          scheduler_running: queue.processing_jobs > 0,
        } as any);
        setError(null);
      } else {
        setError('Failed to load queue status');
      }

      if (jobsData.status === 'fulfilled') {
        setFailedJobs((jobsData.value?.jobs ?? []).filter((j: any) => j.status === 'failed') as unknown as AdminJob[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

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
        <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-primary hover:underline flex items-center gap-1.5 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
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
            <RefreshCw className="w-4 h-4" />
          </button>
          <NeonButton variant="destructive" size="sm" onClick={handlePurge}>
            <Trash2 className="w-3.5 h-3.5" /> Purge Queue
          </NeonButton>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Active" value={queue?.active ?? 0} icon={Activity} color="amber" delay={0.05} />
        <MetricCard label="Queued" value={queue?.queued ?? 0} icon={Clock} color="blue" delay={0.1} />
        <MetricCard label="Reserved" value={queue?.reserved ?? 0} icon={Zap} color="amber" delay={0.15} />
        <MetricCard label="Workers" value={queue?.workers ?? 0} icon={Users} color="green" delay={0.2} />
      </div>

      {/* Runtime Errors & Repair Actions */}
      {repairableJobs.length > 0 && (
        <GlassCard className="p-5 border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.04)] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--destructive))]">
              <AlertTriangle className="w-4 h-4" />
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
                        <CheckCircle2 className="w-3.5 h-3.5" /> Repaired
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
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Repairing...</span>
                        </>
                      ) : (
                        <>
                          <Wrench className="w-3.5 h-3.5" />
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
                  <Users className="w-4 h-4 text-muted-foreground" />
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
              <Users className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No active workers</p>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
