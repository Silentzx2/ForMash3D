"use client";

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Briefcase,
  Clock,
  CheckmarkCircle01Icon,
  CancelCircleIcon,
  LoaderCircle,
  RefreshCw,
  AlertCircle,
  TriangleAlertIcon,
  ExternalLink,
  ArrowRight,
} from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { Badge } from '@/components/premium/Badge';
import { ProgressBar } from '@/components/premium/ProgressBar';
import { Spinner } from '@/components/premium/Spinner';
import { getApiClient } from '@/services/apiClient';
import { diagnoseJobError } from '@/lib/jobDiagnostics';
import type { AdminJob } from '@/types';
import { cn } from '@/lib/utils';

  const STATUS_CONFIG = {
    completed: { icon: CheckmarkCircle01Icon, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Completed' },
    generating: { icon: LoaderCircle, color: 'text-primary', bg: 'bg-primary/10', label: 'Running' },
    queued: { icon: Clock, color: 'text-primary', bg: 'bg-primary/10', label: 'Queued' },
    failed: { icon: CancelCircleIcon, color: 'text-[hsl(var(--destructive))]', bg: 'bg-[hsl(var(--destructive)/0.1)]', label: 'Failed' },
    cancelled: { icon: CancelCircleIcon, color: 'text-zinc-400', bg: 'bg-zinc-500/10', label: 'Cancelled' },
  };

export function JobsTab() {
  const router = useRouter();
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getApiClient().getJobsHistory({ limit: 50 });
      setJobs((data.jobs ?? []).map((j: any) => ({
        id: j.job_id ?? j.id,
        status: j.status === 'processing' ? 'generating' : j.status,
        type: j.feature ?? 'generation',
        progress: typeof j.progress === 'number' ? Math.round(Math.max(0, Math.min(1, j.progress)) * 100) : j.status === 'completed' ? 100 : j.status === 'failed' ? 0 : 0,
        created_at: j.created_at,
        completed_at: j.completed_at,
        error: j.error,
        mode: j.feature,
        provider: j.model_preference,
      })));
      setError(data.jobs.length === 0 ? 'No jobs found' : null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, 5000);

    return () => clearInterval(interval);
  }, [load]);

  const filtered = jobs.filter((j) => filter === 'all' || j.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <HugeiconsIcon icon={AlertCircle} size={16} className="w-10 h-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-primary hover:underline flex items-center gap-1.5 cursor-pointer">
          <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Canonical Experience Shortcut Banner */}
      <GlassCard className="p-4 border-[hsl(var(--admin-accent)/0.3)] bg-[hsl(var(--admin-accent)/0.05)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span>Canonical Workspace Jobs Inspector</span>
            <Badge variant="default" className="text-[10px]">Authoritative</Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            View real-time GPU telemetry, stage progress, live logs, and interactive 3D output inspection in the Workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/workspace/jobs')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--admin-accent))] hover:bg-[hsl(var(--admin-accent)/0.9)] text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap cursor-pointer"
        >
          <span>Open Jobs View</span>
           <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5" />
        </button>
      </GlassCard>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Generation Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filtered.length} jobs · {jobs.filter(j => j.status === 'completed').length} completed · {jobs.filter(j => j.status === 'failed').length} failed
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          title="RefreshIcon jobs"
          className="p-2 rounded-xl glass border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {['all', 'generating', 'queued', 'completed', 'failed'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-all border cursor-pointer',
              filter === f
                ? 'bg-primary/15 text-primary border-primary/30 font-semibold'
                : 'glass text-muted-foreground border-[hsl(var(--border))] hover:text-foreground'
            )}
          >
            {f === 'generating' ? 'Running' : f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((job, i) => {
          const cfg = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.queued;
          const Icon = cfg.icon;
          const diag = diagnoseJobError(job);

          return (
            <motion.div key={job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <GlassCard hover className="p-4">
                <div className="flex items-start gap-4">
                  <div className={cn('flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 mt-0.5', cfg.bg)}>
                    <HugeiconsIcon icon={Icon} size={16} className={cn('w-5 h-5', cfg.color, job.status === 'generating' && 'animate-spin')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-mono text-foreground font-semibold">{job.id}</span>
                      <Badge variant="default">{job.type}</Badge>
                      {job.provider && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-muted-foreground">
                          {job.provider}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => router.push(`/workspace/jobs?id=${job.id}`)}
                        className="text-[11px] text-[hsl(var(--admin-accent))] hover:underline flex items-center gap-0.5 font-medium cursor-pointer ml-auto"
                      >
                        <span>Inspect in Workspace</span>
                         <HugeiconsIcon icon={ExternalLink} size={16} className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(job.created_at).toLocaleString()}
                      {job.completed_at && ` · Completed: ${new Date(job.completed_at).toLocaleString()}`}
                    </p>

                    {/* Standard Error Display */}
                    {!diag && job.error && (
                      <p className="text-xs text-[hsl(var(--destructive))] mt-1 font-mono break-all">{job.error}</p>
                    )}

                    {/* Interpreted RuntimeError Diagnosis */}
                    {diag && (
                      <div className="mt-2.5 p-3 rounded-xl bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.25)] space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--destructive))]">
                           <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4 flex-shrink-0" />
                          <span>{diag.issueDescription}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono break-all pl-5">
                          {job.error || job.error_message}
                        </p>
                        <div className="text-[10px] text-muted-foreground pl-5 border-t border-[hsl(var(--destructive)/0.15)] pt-1.5">
                          💡 <span className="font-medium text-foreground">Remedy:</span> {diag.suggestedAction}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="w-28 sm:w-32 flex-shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{cfg.label}</span>
                      {job.progress !== undefined && (
                        <span className="text-xs font-mono text-foreground">{job.progress}%</span>
                      )}
                    </div>
                    {job.progress !== undefined ? (
                      <ProgressBar value={job.progress} color={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'pink' : 'amber'} size="sm" />
                    ) : (
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        {job.status === 'generating' && (
                          <div className="h-full w-full bg-primary animate-pulse" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <HugeiconsIcon icon={Briefcase} size={16} className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No jobs found</p>
        </div>
      )}
    </div>
  );
}
