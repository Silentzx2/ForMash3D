'use client';

/**
 * ActivityLogger & ProjectTimeline — project-wide activity logger and visual project tracker.
 *
 * Mounted once in app/layout.tsx to capture API events and user interactions,
 * and exports the interactive <ProjectTimeline /> component for the History tab.
 */

// Module-level fallback time (avoids calling Date.now() during render)
const FALLBACK_TIMESTAMP = Date.now();

import React, { useEffect, useState, useMemo } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ClockIcon, CheckmarkCircle02Icon, AlertCircle, LoaderCircle, PlayIcon, HeartIcon,
  Search01Icon, Layers01Icon, BoxIcon, CpuIcon,
  RefreshCw, EyeIcon, FileCodeIcon, Copy01Icon
} from '@hugeicons/core-free-icons';
import { getApiUrl } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const LOG_ENDPOINT = '/api/v1/system/logs';

export interface ActivityEntry {
  ts: string;
  type: 'api' | 'click' | 'error' | 'generation';
  detail: string;
}

function now(): string {
  return new Date().toISOString();
}

let logBatchTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingLogs: ActivityEntry[] = [];

function flushLogs(): void {
  if (pendingLogs.length === 0) return;
  const latestEntry = pendingLogs[pendingLogs.length - 1];
  pendingLogs = [];
  try {
    fetch(`${getApiUrl()}${LOG_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(latestEntry),
      keepalive: true,
    }).catch(() => {
      // Logging must never break the app — swallow failures silently.
    });
  } catch {
    // ignore
  }
}

function postLog(entry: ActivityEntry): void {
  pendingLogs.push(entry);
  if (!logBatchTimeout) {
    logBatchTimeout = setTimeout(() => {
      logBatchTimeout = null;
      flushLogs();
    }, 2500);
  }
}

// In-memory event buffer for real-time timeline visualization
const globalActivityListeners = new Set<(entry: ActivityEntry) => void>();

export function emitActivity(entry: ActivityEntry) {
  globalActivityListeners.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // ignore listener error
    }
  });
}

export function ActivityLogger() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── 1. Button/link click logging (delegated listener) ───────────────────
    // ponytail: fetch interceptor removed — it caused a death spiral where
    // every API call spawned a log POST that timed out under load, flooding
    // the backend connection pool and slowing all endpoints. Click events are
    // infrequent and safe to log.
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        'button, a, [role="button"], [role="menuitem"], [onclick]',
      ) as HTMLElement | null;
      if (!target) return;
      const label =
        target.getAttribute('aria-label') ||
        target.textContent?.trim().slice(0, 80) ||
        target.tagName.toLowerCase();
      const entry: ActivityEntry = { ts: now(), type: 'click', detail: label };
      console.info(`[activity] click: ${label}`);
      postLog(entry);
      emitActivity(entry);
    };
    document.addEventListener('click', onClick, { capture: true });

    return () => {
      document.removeEventListener('click', onClick, { capture: true });
    };
  }, []);

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Visual Project Timeline Component                                         */
/* -------------------------------------------------------------------------- */

interface ProjectTimelineProps {
  onLoadProject?: (item: any) => void;
  className?: string;
}

export function ProjectTimeline({ onLoadProject, className }: ProjectTimelineProps) {
  const { jobHistory, loadHistory, isLoadingHistory } = useAppStore();
  const batchQueue = useAppStore((s) => s.batchQueue);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'generating' | 'failed' | 'queued'>('all');
  const [selectedJobDetails, setSelectedJobDetails] = useState<any | null>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Combine backend history jobs and current batch queue items into a unified timeline
  const timelineItems = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      prompt: string;
      status: 'completed' | 'generating' | 'queued' | 'failed';
      timestamp: string;
      rawDate: Date;
      model?: string;
      format: string;
      duration?: string;
      thumbnailUrl?: string | null;
      modelUrl?: string | null;
      isFavorite?: boolean;
      error?: string;
    }> = [];

    // Add active batch queue items
    batchQueue.forEach((bq) => {
      items.push({
        id: bq.id,
        title: bq.prompt.slice(0, 32) || 'Queued Prompt',
        prompt: bq.prompt,
        status: bq.status === 'running' ? 'generating' : (bq.status === 'cancelled' ? 'failed' : bq.status),
        timestamp: bq.startedAt ? new Date(bq.startedAt).toLocaleTimeString() : 'In Queue',
        rawDate: bq.startedAt ? new Date(bq.startedAt) : new Date(),
        format: 'GLB',
        model: 'TRELLIS',
        error: bq.error,
      });
    });

    // Add backend history jobs
    (jobHistory || []).forEach((job: any) => {
      // Avoid duplicate IDs if already in batch queue
      if (items.some(i => i.id === job.id)) return;

      const prompt = job.prompt || job.config?.prompt || 'Neural 3D Reconstruction';
      const status: 'completed' | 'generating' | 'queued' | 'failed' =
        job.status === 'completed' || job.status === 'succeeded'
          ? 'completed'
          : job.status === 'failed' || job.status === 'error'
          ? 'failed'
          : job.status === 'running' || job.status === 'processing'
          ? 'generating'
          : 'queued';

      const createdAt = new Date(job.created_at || job.createdAt || FALLBACK_TIMESTAMP);
      const durationSeconds = job.elapsedSeconds || job.result?.generation_time_seconds || 24;

      items.push({
        id: job.id,
        title: prompt.split(' ').slice(0, 4).join(' ') || '3D Model Asset',
        prompt,
        status,
        timestamp: createdAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        rawDate: createdAt,
        model: job.model_id || job.config?.model || 'Neural 3D Generator',
        format: job.format || 'GLB',
        duration: `${Math.round(durationSeconds)}s`,
        thumbnailUrl: job.thumbnail_url || job.result?.thumbnail_url || null,
        modelUrl: job.model_url || job.result?.model_url || null,
        isFavorite: Boolean(job.is_favorite || job.isFavorite),
      });
    });

    // Sort newest first
    return items.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
  }, [jobHistory, batchQueue]);

  // Filtered timeline items
  const filteredItems = useMemo(() => {
    return timelineItems.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.model && item.model.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [timelineItems, searchQuery, statusFilter]);

  // Analytics summary metrics
  const totalCount = timelineItems.length;
  const completedCount = timelineItems.filter((i) => i.status === 'completed').length;
  const activeCount = timelineItems.filter((i) => i.status === 'generating' || i.status === 'queued').length;
  const successRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  const handleOpenModel = (item: any) => {
    if (onLoadProject) {
      onLoadProject({
        id: item.id,
        name: item.title,
        prompt: item.prompt,
        format: item.format,
        timestamp: item.timestamp,
        modelUrl: item.modelUrl,
        thumbnailUrl: item.thumbnailUrl,
        isFavorite: item.isFavorite,
      });
    } else if (item.modelUrl) {
      window.dispatchEvent(new CustomEvent('load-glb-model', { detail: { url: item.modelUrl } }));
      toast.success(`Loaded "${item.title}" into 3D viewport`);
    } else {
      toast.info(`Asset "${item.title}" selected`);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6 w-full text-[hsl(var(--foreground))]', className)} id="project-timeline-view">
      {/* Header & Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Total Jobs</span>
            <div className="text-xl font-black mt-0.5">{totalCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-[hsl(var(--primary)/0.1)] border border-[hsl(var(--primary)/0.2)] flex items-center justify-center text-[hsl(var(--primary))]">
            <HugeiconsIcon icon={Layers01Icon} size={16} className="w-[18px] h-[18px]" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Success Rate</span>
            <div className="text-xl font-black text-[hsl(var(--neon-green))] mt-0.5">{successRate}%</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-[hsl(var(--neon-green)/0.1)] border border-[hsl(var(--neon-green)/0.2)] flex items-center justify-center text-[hsl(var(--neon-green))]">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-[18px] h-[18px]" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Active Pipelined</span>
            <div className="text-xl font-black text-primary mt-0.5">{activeCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <HugeiconsIcon icon={CpuIcon} size={16} className="w-[18px] h-[18px]" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Avg Bake Time</span>
            <div className="text-xl font-black text-primary mt-0.5">~22s</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <HugeiconsIcon icon={ClockIcon} size={16} className="w-[18px] h-[18px]" />
          </div>
        </div>
      </div>

      {/* SearchIcon & Status Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] rounded-2xl p-3">
        <div className="relative flex-1 max-w-md">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="SearchIcon timeline by prompt, model, or title..."
            className="w-full bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl py-2 pl-9 pr-3 text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-all"
          />
        </div>

        {/* FilterIcon Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'completed', 'generating', 'queued', 'failed'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap',
                statusFilter === filter
                  ? 'bg-primary text-[#080808] font-bold shadow-sm'
                  : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
              )}
            >
              {filter}
            </button>
          ))}

          <button
            onClick={() => loadHistory()}
            disabled={isLoadingHistory}
            className="p-2 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"
            title="RefreshIcon Timeline"
          >
            <HugeiconsIcon icon={RefreshCw} size={13} className={isLoadingHistory ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Visual Chronological Timeline */}
      <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-primary before:via-primary/30 before:to-transparent">
        {filteredItems.map((item, index) => {
          const isCompleted = item.status === 'completed';
          const isGenerating = item.status === 'generating';
          const isQueued = item.status === 'queued';
          const isFailed = item.status === 'failed';

          return (
            <div
              key={item.id || index}
              className="relative group transition-all"
            >
              {/* Timeline node icon */}
              <div
                className={cn(
                  'absolute -left-6 sm:-left-8 top-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm z-10',
                  isCompleted
                    ? 'bg-[hsl(var(--surface-0))] border-emerald-500 text-emerald-400'
                    : isGenerating
                    ? 'bg-[hsl(var(--surface-0))] border-primary text-primary animate-pulse'
                    : isFailed
                    ? 'bg-[hsl(var(--surface-0))] border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]'
                    : 'bg-[hsl(var(--surface-0))] border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                )}
              >
                {isCompleted && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />}
                {isGenerating && <HugeiconsIcon icon={LoaderCircle} size={12} className="animate-spin" />}
                {isFailed && <HugeiconsIcon icon={AlertCircle} size={12} />}
                {isQueued && <HugeiconsIcon icon={ClockIcon} size={12} />}
              </div>

              {/* Timeline Card */}
              <div className="bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] hover:border-primary/40 rounded-2xl p-4 transition-all duration-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Thumbnail / Wireframe Preview */}
                  <div className="relative w-16 h-16 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] overflow-hidden flex items-center justify-center shrink-0 group-hover:border-primary/40 transition-all">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gradient-to-tr from-primary/20 to-transparent flex items-center justify-center">
                        <HugeiconsIcon icon={BoxIcon} size={20} className="text-primary opacity-80" />
                      </div>
                    )}

                    {/* Format pill overlay */}
                    <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/70 text-[7px] font-mono font-bold text-[hsl(var(--foreground))] uppercase">
                      {item.format}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-black text-[hsl(var(--foreground))] truncate group-hover:text-primary transition-colors">
                        {item.title}
                      </h4>

                      {/* Status Badge */}
                      <span
                        className={cn(
                          'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1',
                          isCompleted
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : isGenerating
                            ? 'bg-primary/15 text-primary border border-primary/30'
                            : isFailed
                            ? 'bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))] border border-[hsl(var(--destructive)/0.3)]'
                            : 'bg-[hsl(var(--surface-3))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]'
                        )}
                      >
                        {isGenerating && <HugeiconsIcon icon={LoaderCircle} size={9} className="animate-spin" />}
                        {item.status}
                      </span>

                      {item.isFavorite && (
                        <span className="text-[hsl(var(--destructive))] text-xs" title="Favorite">
                          <HugeiconsIcon icon={HeartIcon} size={12} className="fill-rose-500" />
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-1">
                      "{item.prompt}"
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-[hsl(var(--muted-foreground))]/70 pt-0.5">
                      <span className="flex items-center gap-1">
                        <HugeiconsIcon icon={ClockIcon} size={16} /> {item.timestamp}
                      </span>
                      {item.duration && <span>Duration: {item.duration}</span>}
                      {item.model && <span>Model: {item.model}</span>}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <button
                    onClick={() => handleOpenModel(item)}
                    className="px-3 py-1.5 rounded-xl bg-[hsl(var(--primary))] hover:brightness-110 active:scale-95 text-[hsl(var(--foreground))] text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={11} /> Open
                  </button>

                  <button
                    onClick={() => setSelectedJobDetails(item)}
                    className="px-2.5 py-1.5 rounded-xl bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-3)/0.8)] text-[hsl(var(--foreground))] text-[11px] font-bold transition-all"
                    title="View Job Metadata"
                  >
                    <HugeiconsIcon icon={EyeIcon} size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="p-12 rounded-2xl bg-[hsl(var(--surface-1))] border border-dashed border-[hsl(var(--border))] text-center flex flex-col items-center justify-center text-[hsl(var(--muted-foreground))]">
            <HugeiconsIcon icon={ClockIcon} size={36} className="text-[hsl(var(--border))] mb-3" />
            <p className="text-xs font-bold text-[hsl(var(--foreground))] uppercase">No Timeline Activities</p>
            <p className="text-[11px] mt-1 max-w-sm">No past generation jobs match your current filter criteria. Start a generation to track your project milestones!</p>
          </div>
        )}
      </div>

      {/* Inspect Modal Drawer for selected timeline item */}
      {selectedJobDetails && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] rounded-2xl p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border)/0.5)] pb-3">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={FileCodeIcon} size={16} className="text-[hsl(var(--primary))]" />
                <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">Job Metadata Inspection</h3>
              </div>
              <button
                onClick={() => setSelectedJobDetails(null)}
                className="p-1 rounded-lg hover:bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-[hsl(var(--muted-foreground))] font-bold text-[10px] uppercase">Job ID</span>
                <p className="font-mono text-[11px] bg-[hsl(var(--surface-2))] p-2 rounded-lg break-all">{selectedJobDetails.id}</p>
              </div>
              <div>
                <span className="text-[hsl(var(--muted-foreground))] font-bold text-[10px] uppercase">Full Prompt</span>
                <p className="bg-[hsl(var(--surface-2))] p-2 rounded-lg text-[11px] leading-relaxed">{selectedJobDetails.prompt}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="bg-[hsl(var(--surface-2))] p-2 rounded-lg">
                  <span className="text-[hsl(var(--muted-foreground))] text-[9px] block">STATUS</span>
                  <span className="font-bold uppercase text-[hsl(var(--primary))]">{selectedJobDetails.status}</span>
                </div>
                <div className="bg-[hsl(var(--surface-2))] p-2 rounded-lg">
                  <span className="text-[hsl(var(--muted-foreground))] text-[9px] block">FORMAT</span>
                  <span className="font-bold">{selectedJobDetails.format}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[hsl(var(--border)/0.5)]">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selectedJobDetails, null, 2));
                  toast.success('Copied JSON metadata to clipboard');
                }}
                className="px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-xs font-bold flex items-center gap-1.5"
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} /> Copy JSON
              </button>
              <button
                onClick={() => setSelectedJobDetails(null)}
                className="px-4 py-1.5 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--foreground))] text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

