"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Database01Icon, RefreshCwIcon, LoaderCircleIcon, AlertCircleIcon, TrashIcon, StopCircleIcon,
  Search01Icon, Key01Icon, ArrowDown01Icon, CancelCircleIcon, File01Icon, TriangleAlertIcon
} from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

interface DbJob {
  job_id: string;
  status: string;
  feature?: string;
  model_preference?: string;
  assigned_model?: string;
  progress?: number;
  created_at?: string;
}

interface RedisKeyInfo {
  key: string;
  type?: string;
  size?: number | null;
  ttl?: number;
  error?: string;
}

interface RedisKeysResult {
  pattern: string;
  keys: RedisKeyInfo[];
  count: number;
  truncated: boolean;
}

const STATUS_FILTERS: StatusFilter[] = ['all', 'queued', 'processing', 'completed', 'failed', 'cancelled'];
const STATUS_COUNTS: string[] = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
const PAGE_SIZE = 50;
// ponytail: accumulation is capped so a huge database can never dump every row into the DOM; narrow with the status filters to see more.
const MAX_ROWS = 200;
const REDIS_KEY_LIMIT = 200;

const STATUS_CHIP: Record<string, string> = {
  queued: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  processing: 'bg-primary/15 text-primary border-primary/30 animate-pulse',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

const formatBytes = (bytes?: number | null): string => {
  const b = Number(bytes ?? 0);
  if (!b || b < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const progressPct = (progress?: number): number => {
  const n = Number(progress ?? 0);
  return Math.round(n > 0 && n <= 1 ? n * 100 : n);
};

const errMessage = (err: any, fallback: string): string => err?.message || fallback;

const loadingButton = (busy: boolean, label: string) => (
  <>
    <HugeiconsIcon icon={LoaderCircleIcon} size={16} className={cn('w-3.5 h-3.5 mr-1.5', busy && 'animate-spin')} />
    {label}
  </>
);

export function DatabaseTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());

  const [jobs, setJobs] = useState<DbJob[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{ label: string; jobIds?: string[]; status?: StatusFilter } | null>(null);

  const [pattern, setPattern] = useState('3daigc:*');
  const [redis, setRedis] = useState<RedisKeysResult | null>(null);
  const [redisLoading, setRedisLoading] = useState(false);
  const [redisError, setRedisError] = useState<string | null>(null);

  const [clearJobsOpen, setClearJobsOpen] = useState(false);
  const [clearFilesOpen, setClearFilesOpen] = useState(false);
  const [jobsToken, setJobsToken] = useState('');
  const [filesToken, setFilesToken] = useState('');
  const [clearing, setClearing] = useState(false);
  const statsRequestSequence = useRef(0);
  const jobsRequestSequence = useRef(0);

  const fetchStats = useCallback(async (quiet = false) => {
    const requestId = ++statsRequestSequence.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const nextStats = await getApiClient().getDatabaseStats();
      if (requestId !== statsRequestSequence.current) return;
      setStats(nextStats);
      setLastSynced(new Date());
    } catch (err: any) {
      if (requestId === statsRequestSequence.current) {
        setError(errMessage(err, 'Failed to load database statistics'));
      }
    } finally {
      if (requestId === statsRequestSequence.current) setLoading(false);
    }
  }, []);

  const fetchJobs = useCallback(async (offset: number, append: boolean) => {
    const requestId = ++jobsRequestSequence.current;
    if (append) setLoadingMore(true);
    else setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await getApiClient().getJobsHistory({
        limit: PAGE_SIZE,
        offset,
        status: filter === 'all' ? undefined : filter,
      });
      if (requestId !== jobsRequestSequence.current) return;
      const page: DbJob[] = (res.jobs ?? []).map((j: any) => ({
        job_id: j.job_id ?? j.id,
        status: j.status,
        feature: j.feature,
        model_preference: j.model_preference ?? j.model,
        assigned_model: j.assigned_model,
        progress: j.progress,
        created_at: j.created_at,
      }));
      setJobs((prev) => (append ? [...prev, ...page] : page));
      setNextOffset(offset + PAGE_SIZE);
      setTotalJobs(res.pagination?.total ?? 0);
      setHasMore(!!res.pagination?.has_more);
    } catch (err: any) {
      if (requestId === jobsRequestSequence.current) {
        setJobsError(errMessage(err, 'Failed to load jobs'));
      }
    } finally {
      if (requestId === jobsRequestSequence.current) {
        setJobsLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filter]);

  const refreshAll = useCallback(() => {
    void fetchStats(true);
    void fetchJobs(0, false);
  }, [fetchStats, fetchJobs]);

  useEffect(() => {
    void fetchStats();
    void fetchJobs(0, false);
  }, [fetchStats, fetchJobs]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchStats(true);
      if (jobs.length <= PAGE_SIZE) void fetchJobs(0, false);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchJobs, jobs.length]);

  const handleCancel = async (jobId: string) => {
    setBusy(`cancel:${jobId}`);
    try {
      await getApiClient().cancelGenerationJob(jobId);
      toast.success('Job cancelled', { description: `${jobId} was marked as cancelled.` });
      refreshAll();
    } catch (err: any) {
      toast.error('Failed to cancel job', { description: errMessage(err, 'The worker could not be signalled.') });
    } finally {
      setBusy(null);
    }
  };

  const confirmDeleteJob = async () => {
    if (!pendingDelete) return;
    const jobId = pendingDelete;
    setBusy(`delete:${jobId}`);
    try {
      const res = await getApiClient().deleteJob(jobId);
      const wsStatus = (res as any).asset_workspace_status;
      let wsMsg = 'and its workspace was deleted';
      if (wsStatus === 'deleted' || (res.asset_workspace_deleted && !wsStatus)) {
        wsMsg = 'and its workspace was deleted';
      } else if (wsStatus === 'missing') {
        wsMsg = 'but its workspace was missing';
      } else if (wsStatus === 'not_recorded') {
        wsMsg = 'but no workspace was recorded';
      } else if (wsStatus === 'failed' || res.cleanup_error) {
        wsMsg = `but workspace cleanup failed${res.cleanup_error ? `: ${res.cleanup_error}` : ''}`;
      } else if (res.asset_workspace_deleted === false) {
        wsMsg = 'but no workspace was recorded';
      }
      toast.success('Job deleted', { description: `${jobId} was removed from the jobs database ${wsMsg}.` });
      setPendingDelete(null);
      setSelected((prev) => prev.filter((id) => id !== jobId));
      refreshAll();
    } catch (err: any) {
      toast.error('Failed to delete job', { description: errMessage(err, 'The job row could not be removed.') });
    } finally {
      setBusy(null);
    }
  };

  const confirmBulkDelete = async () => {
    if (!pendingBulk) return;
    setBusy('bulk');
    try {
      const res = await getApiClient().deleteDatabaseJobs({
        confirm: true,
        ...(pendingBulk.jobIds ? { job_ids: pendingBulk.jobIds } : { status: pendingBulk.status }),
      });
      toast.success(`Deleted ${res.deleted} job(s)`, {
        description: `Skipped ${res.skipped}, failed ${res.failed}. Skipped jobs are still running or queued — cancel them first.`,
      });
      setPendingBulk(null);
      setSelected([]);
      refreshAll();
    } catch (err: any) {
      toast.error('Bulk delete failed', { description: errMessage(err, 'The database rejected the bulk delete.') });
    } finally {
      setBusy(null);
    }
  };

  const handleClearJobs = async () => {
    setClearing(true);
    try {
      const res = await getApiClient().clearDatabaseJobs();
      toast.success('Job database cleared', {
        description: `${res.jobs_deleted} jobs deleted, ${res.sqlite_rows_deleted} SQLite rows removed, ${res.workspaces_removed} workspaces removed${res.jobs_cancelled ? `, ${res.jobs_cancelled} cancelled` : ''}${res.active_unresponsive?.length ? `, ${res.active_unresponsive.length} active jobs could not be stopped` : ''}${res.jobs_failed ? `, ${res.jobs_failed} failed` : ''}.`,
      });
      setClearJobsOpen(false);
      setJobsToken('');
      setSelected([]);
      refreshAll();
    } catch (err: any) {
      toast.error('Failed to clear jobs', { description: errMessage(err, 'The clear operation failed.') });
    } finally {
      setClearing(false);
    }
  };

  const handleClearFiles = async () => {
    setClearing(true);
    try {
      const res = await getApiClient().clearDatabaseFiles();
      toast.success('File metadata and uploads cleared', {
        description: `${res.file_metadata_removed} metadata records removed, ${res.redis_keys_swept} Redis keys swept${res.errors?.length ? `, ${res.errors.length} errors` : ''}.`,
      });
      setClearFilesOpen(false);
      setFilesToken('');
      refreshAll();
    } catch (err: any) {
      toast.error('Failed to clear files', { description: errMessage(err, 'The clear operation failed.') });
    } finally {
      setClearing(false);
    }
  };

  const inspectRedis = async () => {
    setRedisLoading(true);
    setRedisError(null);
    try {
      setRedis(await getApiClient().getRedisKeys({ pattern, limit: REDIS_KEY_LIMIT }));
    } catch (err: any) {
      setRedis(null);
      setRedisError(errMessage(err, 'Redis is not available.'));
    } finally {
      setRedisLoading(false);
    }
  };

  const toggleSelect = (jobId: string) =>
    setSelected((prev) => (prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]));
  const allVisibleSelected = jobs.length > 0 && jobs.every((j) => selected.includes(j.job_id));

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center flex-col gap-3">
        <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-8 h-8 animate-spin text-[hsl(var(--primary))]" />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading database statistics...</p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-5 h-5" />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchStats()}>
            <HugeiconsIcon icon={RefreshCwIcon} size={16} className="w-3.5 h-3.5 mr-1" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const sqlite = stats?.sqlite ?? {};
  const redisStats = stats?.redis ?? {};
  const disk = stats?.disk ?? {};
  const fileMeta = stats?.file_metadata ?? {};

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] flex items-center gap-2">
            <HugeiconsIcon icon={Database01Icon} size={16} className="w-6 h-6 text-[hsl(var(--primary))]" />
            Database Control Center
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Every job record, Redis key, and destructive database operation for the dual-store job queue (SQLite + Redis).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading} className="text-xs font-semibold">
          <HugeiconsIcon icon={RefreshCwIcon} size={16} className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && stats && (
        <div role="alert" aria-live="polite" className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchStats(true)} disabled={loading}>
            <HugeiconsIcon icon={RefreshCwIcon} size={16} className="w-3.5 h-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Total Jobs</CardTitle>
            <CardDescription className="text-xs">SQLite job rows</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[hsl(var(--foreground))]">{Number(sqlite.total_jobs ?? 0)}</div>
          </CardContent>
        </Card>

        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Jobs by Status</CardTitle>
            <CardDescription className="text-xs">Live SQLite counts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_COUNTS.map((s) => (
                <span key={s} className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border', STATUS_CHIP[s])}>
                  {s.slice(0, 4)} {Number(sqlite[`${s}_jobs`] ?? 0)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">SQLite Database</CardTitle>
            <CardDescription className="text-xs">Job queue DB file (+WAL)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">{formatBytes(sqlite.database_size_bytes)}</div>
          </CardContent>
        </Card>

        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Redis</CardTitle>
            <CardDescription className="text-xs">Hot queue + live keys</CardDescription>
          </CardHeader>
          <CardContent>
            {redisStats.available ? (
              <>
                <div className="text-2xl font-bold font-mono text-[hsl(var(--foreground))]">{Number(redisStats.keys ?? 0)} keys</div>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">{redisStats.used_memory_human || formatBytes(redisStats.used_memory)}</p>
              </>
            ) : (
              <div className="text-sm font-bold text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-4 h-4" /> Unavailable
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <HugeiconsIcon icon={File01Icon} size={16} className="w-4 h-4 text-primary" /> File Metadata
            </CardTitle>
            <CardDescription className="text-xs">Upload registry records</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[hsl(var(--foreground))]">{Number(fileMeta.count ?? 0)}</div>
          </CardContent>
        </Card>

        <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">On-Disk Assets</CardTitle>
            <CardDescription className="text-xs">Meshes + uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[hsl(var(--foreground))]">
              {formatBytes(Number(disk.meshes_bytes ?? 0) + Number(disk.uploads_bytes ?? 0))}
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 font-mono truncate" title={disk.storage_root}>{disk.storage_root || 'storage'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-1))] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Jobs Table</CardTitle>
              <CardDescription>{totalJobs} total · loaded {jobs.length} · page size {PAGE_SIZE}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setSelected([]); }}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-all border cursor-pointer',
                    filter === f
                      ? 'bg-primary/15 text-primary border-primary/30 font-semibold'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))]'
                  )}
                >
                  {f}
                </button>
              ))}
              {filter !== 'all' && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs font-bold ml-1"
                  onClick={() => setPendingBulk({ label: `all ${filter} jobs`, status: filter })}
                >
                  <HugeiconsIcon icon={TrashIcon} size={16} className="w-3.5 h-3.5 mr-1.5" />
                  Delete all {filter}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <span className="text-xs font-semibold text-destructive">{selected.length} selected</span>
              <Button variant="destructive" size="sm" className="text-xs" onClick={() => setPendingBulk({ label: `${selected.length} selected job(s)`, jobIds: selected })}>
                <HugeiconsIcon icon={TrashIcon} size={16} className="w-3.5 h-3.5 mr-1.5" />
                Delete selected ({selected.length})
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelected([])}>
                <HugeiconsIcon icon={CancelCircleIcon} size={16} className="w-3.5 h-3.5 mr-1.5" />
                Clear
              </Button>
            </div>
          )}

          {jobsError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between text-xs">
              <span className="flex items-center gap-2"><HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-4 h-4" /> {jobsError}</span>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => void fetchJobs(0, false)}>Retry</Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border)/0.6)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border)/0.6)]">
                  <th className="px-3 py-2 w-8">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={() => setSelected(allVisibleSelected ? [] : jobs.map((j) => j.job_id))} aria-label="Select all jobs" />
                  </th>
                  <th className="px-3 py-2">Job ID</th>
                  <th className="px-3 py-2">Feature</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 w-24">Progress</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border)/0.4)]">
                {jobs.map((j) => {
                  const running = j.status === 'queued' || j.status === 'processing';
                  const pct = progressPct(j.progress);
                  return (
                    <tr key={j.job_id} className="hover:bg-[hsl(var(--surface-2))] transition-colors">
                      <td className="px-3 py-2">
                        <Checkbox checked={selected.includes(j.job_id)} onCheckedChange={() => toggleSelect(j.job_id)} aria-label={`Select ${j.job_id}`} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[hsl(var(--foreground))]">
                        <span className="block max-w-[140px] truncate" title={j.job_id}>{j.job_id}</span>
                      </td>
                      <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">{j.feature || 'mesh generation'}</td>
                      <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">{j.assigned_model || j.model_preference || 'auto'}</td>
                      <td className="px-3 py-2 text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border', STATUS_CHIP[j.status] || STATUS_CHIP.cancelled)}>
                          {j.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 rounded-full bg-[hsl(var(--surface-2))] overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {running ? (
                          <Button variant="outline" size="sm" className="text-xs" disabled={busy === `cancel:${j.job_id}`} onClick={() => void handleCancel(j.job_id)}>
                            {busy === `cancel:${j.job_id}`
                              ? loadingButton(true, 'Cancelling')
                              : <><HugeiconsIcon icon={StopCircleIcon} size={16} className="w-3.5 h-3.5 mr-1.5" />Cancel</>}
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(j.job_id)}>
                            <HugeiconsIcon icon={TrashIcon} size={16} className="w-3.5 h-3.5 mr-1.5" /> Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[hsl(var(--muted-foreground))]">
                      {jobsLoading ? 'Loading jobs...' : 'No jobs found for this filter.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            {jobs.length >= MAX_ROWS ? (
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                Capped at {MAX_ROWS} loaded rows to protect browser performance — use the status filters to narrow results.
              </p>
            ) : hasMore ? (
              <Button variant="outline" size="sm" className="text-xs" disabled={loadingMore} onClick={() => void fetchJobs(nextOffset, true)}>
                {loadingMore
                  ? loadingButton(true, 'Loading')
                  : <><HugeiconsIcon icon={ArrowDown01Icon} size={16} className="w-3.5 h-3.5 mr-1.5" />Load more</>}
              </Button>
            ) : jobs.length > 0 ? (
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">All {totalJobs} matching jobs loaded.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-1))] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <HugeiconsIcon icon={Key01Icon} size={16} className="w-4 h-4 text-primary" /> Redis Key Inspector
          </CardTitle>
          <CardDescription>Read-only SCAN over live keys (capped at {REDIS_KEY_LIMIT}). No key mutations here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 max-w-sm">
              <HugeiconsIcon icon={Search01Icon} size={16} className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="3daigc:*" className="pl-8 font-mono text-xs" />
            </div>
            <Button size="sm" className="text-xs font-semibold" disabled={redisLoading} onClick={() => void inspectRedis()}>
              {redisLoading ? loadingButton(true, 'Inspecting') : 'Inspect'}
            </Button>
          </div>

          {redisError && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
              <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-4 h-4 text-amber-400" />
              {redisError} Run the app with Redis enabled to inspect live keys.
            </p>
          )}

          {redis && (
            <div className="space-y-2">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                {redis.count} keys matching {redis.pattern}
                {redis.truncated && <span className="text-amber-300"> · truncated — narrow the pattern to see the rest</span>}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-[hsl(var(--border)/0.6)]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border)/0.6)] sticky top-0 bg-[hsl(var(--surface-1))]">
                      <th className="px-3 py-2">Key</th>
                      <th className="px-3 py-2 w-20">Type</th>
                      <th className="px-3 py-2 w-20">Size</th>
                      <th className="px-3 py-2 w-20">TTL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--border)/0.4)]">
                    {redis.keys.map((k) => (
                      <tr key={k.key} className="hover:bg-[hsl(var(--surface-2))] transition-colors">
                        <td className="px-3 py-2 font-mono text-[hsl(var(--foreground))]">
                          <span className="block max-w-[420px] truncate" title={k.key}>{k.key}</span>
                        </td>
                        <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">{k.type ?? (k.error ? 'error' : '—')}</td>
                        <td className="px-3 py-2 font-mono text-[hsl(var(--muted-foreground))]">{k.size ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-[hsl(var(--muted-foreground))]">{k.ttl == null ? '—' : k.ttl >= 0 ? `${k.ttl}s` : 'none'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-destructive flex items-center gap-2">
            <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4" /> Danger Zone
          </CardTitle>
          <CardDescription>Irreversible operations against the live SQLite + Redis stores. Type the confirmation token to enable each action.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">Clear All Jobs</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Deletes every job row from Redis + SQLite and removes all asset workspaces. Uploads and file metadata are kept.</p>
            </div>
            <AlertDialog open={clearJobsOpen} onOpenChange={(open) => { setClearJobsOpen(open); if (!open) setJobsToken(''); }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="text-xs font-bold shrink-0">
                  <HugeiconsIcon icon={TrashIcon} size={16} className="w-3.5 h-3.5 mr-1.5" /> Clear All Jobs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear the entire job database?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every job row in Redis and SQLite is deleted, every job asset workspace is removed, and the database is vacuumed. Uploads and file metadata are preserved. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Type <code className="font-mono text-destructive">CLEAR_ALL_JOBS</code> to confirm</p>
                  <Input value={jobsToken} onChange={(e) => setJobsToken(e.target.value)} placeholder="CLEAR_ALL_JOBS" className="font-mono text-xs" />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={jobsToken !== 'CLEAR_ALL_JOBS' || clearing}
                    onClick={(e) => { e.preventDefault(); void handleClearJobs(); }}
                  >
                    {clearing ? loadingButton(true, 'Clearing') : 'Clear All Jobs'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">Clear All File Metadata &amp; Uploads</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Deletes all file metadata records and every upload file on disk. Job records and generated assets are preserved.</p>
            </div>
            <AlertDialog open={clearFilesOpen} onOpenChange={(open) => { setClearFilesOpen(open); if (!open) setFilesToken(''); }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="text-xs font-bold shrink-0">
                  <HugeiconsIcon icon={File01Icon} size={16} className="w-3.5 h-3.5 mr-1.5" /> Clear All Files
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all file metadata and uploads?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All file metadata records and upload files are deleted from disk and Redis. Job records and generated assets are preserved. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Type <code className="font-mono text-destructive">CLEAR_ALL_FILES</code> to confirm</p>
                  <Input value={filesToken} onChange={(e) => setFilesToken(e.target.value)} placeholder="CLEAR_ALL_FILES" className="font-mono text-xs" />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={filesToken !== 'CLEAR_ALL_FILES' || clearing}
                    onClick={(e) => { e.preventDefault(); void handleClearFiles(); }}
                  >
                    {clearing ? loadingButton(true, 'Clearing') : 'Clear All Files'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-[hsl(var(--foreground))] break-all">{pendingDelete}</span> will be removed from Redis and SQLite together with its asset workspace. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy?.startsWith('delete:')}
              onClick={(e) => { e.preventDefault(); void confirmDeleteJob(); }}
            >
              {busy?.startsWith('delete:') ? loadingButton(true, 'Deleting') : 'Delete job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBulk !== null} onOpenChange={(open) => { if (!open) setPendingBulk(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingBulk?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Matching jobs are removed from Redis and SQLite together with their asset workspaces. Running and queued jobs are skipped and reported — cancel them first if you want them gone too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === 'bulk'}
              onClick={(e) => { e.preventDefault(); void confirmBulkDelete(); }}
            >
              {busy === 'bulk' ? loadingButton(true, 'Deleting') : 'Delete jobs'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-2 border-t border-[hsl(var(--border)/0.4)]">
        <span>Auto-refreshes every 30s while the tab is visible · destructive actions hit the real SQLite + Redis stores</span>
        <span>Last synced: {lastSynced.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
