'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';


import { HugeiconsIcon } from '@hugeicons/react';
import { ActivityIcon, AlertCircle, Box, CheckIcon, CheckmarkCircle02Icon, Copy, DownloadIcon, LayersIcon, RefreshCw, SearchIcon, SparklesIcon, StopCircleIcon, Trash2 } from '@hugeicons/core-free-icons';
const MeshViewer = dynamic(() => import('../Viewport/MeshViewer').then(mod => mod.MeshViewer), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-[hsl(var(--surface-0))] animate-pulse flex items-center justify-center text-xs text-zinc-500">Loading 3D Output...</div>
});

interface JobDetailViewProps {
  jobId?: string;
  onBack?: () => void;
}

interface RealJobItem {
  id: string;
  job_id?: string;
  status: string;
  feature?: string;
  model_preference?: string;
  progress?: number;
  stage?: string;
  created_at?: string;
  completed_at?: string;
  error?: string;
  error_message?: string;
  result?: any;
  inputs?: any;
  parameters?: any;
  logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
}

export const JobDetailView: React.FC<JobDetailViewProps> = ({ jobId: propJobId, onBack }) => {
  const { currentAsset, activeTask, setCurrentAsset, navigateToTool } = useWorkspace();

  const [jobsList, setJobsList] = useState<RealJobItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(propJobId || activeTask?.id || '');
  const [selectedJob, setSelectedJob] = useState<RealJobItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [isRawJsonOpen, setIsRawJsonOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // 1. Fetch real jobs list from backend
  const fetchJobs = useCallback(async () => {
    try {
      const client = getApiClient();
      const res = await client.getJobsHistory({ limit: 50 });
      const jobs = (res?.jobs || []).map((j: any) => ({
        id: j.job_id || j.id,
        ...j,
      }));
      setJobsList(jobs);
      if (!selectedJobId && jobs.length > 0) {
        setSelectedJobId(jobs[0].id);
      }
    } catch (err) {
      console.warn('Could not fetch jobs history:', err);
    }
  }, [selectedJobId]);

  const hasRunningJobs = jobsList.some((job) => ['processing', 'running', 'queued'].includes(job.status));
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchJobs();
    };
    void fetchJobs();
    const interval = setInterval(refresh, hasRunningJobs ? 5000 : 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetchJobs, hasRunningJobs]);

  // 2. Fetch specific selected job details
  const fetchSelectedJobDetails = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const client = getApiClient();
      const res = await client.getJobStatus(id);
      if (res) {
        setSelectedJob({
          id,
          status: res.status,
          progress: Math.max(0, Math.min(100, Number((res as any).progress ?? 0) <= 1 ? Number((res as any).progress ?? 0) * 100 : Number((res as any).progress ?? 0))),
          stage: (res as any).stage || (res as any).message || res.status,
          feature: (res as any).feature || (res as any).type,
          model_preference: (res as any).model_preference || (res as any).model,
          created_at: (res as any).created_at,
          completed_at: (res as any).completed_at,
          error: (res as any).error || (res as any).error_message,
          result: res.result,
          inputs: (res as any).inputs,
          parameters: (res as any).parameters || (res as any).inputs?.model_parameters,
          logs: (res as any).logs || (res as any).metadata?.logs || [],
        });
      }
    } catch (err) {
      console.warn(`Could not fetch details for job ${id}:`, err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectedJobIsRunning = selectedJob?.status === 'processing' || selectedJob?.status === 'running' || selectedJob?.status === 'queued';
  useEffect(() => {
    if (!selectedJobId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchSelectedJobDetails(selectedJobId);
    };
    void fetchSelectedJobDetails(selectedJobId);
    const interval = setInterval(refresh, selectedJobIsRunning ? 1200 : 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [selectedJobId, selectedJobIsRunning, fetchSelectedJobDetails]);

  const handleCopyId = () => {
    if (!selectedJobId) return;
    navigator.clipboard.writeText(selectedJobId);
    setCopiedId(true);
    toast.success('Job ID copied to clipboard');
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCancelOrDeleteJob = async () => {
    if (!selectedJobId) return;
    try {
      if (selectedJobIsRunning) {
        const res = await getApiClient().cancelGenerationJob(selectedJobId);
        if (res.cancelled) {
          toast.success('Generation cancelled');
          await fetchSelectedJobDetails(selectedJobId);
        } else {
          toast.info('Job is already running', { description: res.message });
        }
      } else {
        await getApiClient().deleteJob(selectedJobId);
        toast.success('Job deleted from history');
        await fetchJobs();
      }
    } catch (e: any) {
      toast.error(selectedJobIsRunning ? 'Failed to cancel job' : 'Failed to delete job', { description: e?.message });
    }
  };

  const handleLoadResultToViewport = () => {
    if (!selectedJob) return;
    const downloadUrl = `/api/v1/system/jobs/${selectedJob.id}/download`;
    setCurrentAsset({
      id: selectedJob.id,
      name: `${selectedJob.feature || 'Generated_Mesh'}_${selectedJob.id.slice(0, 6)}.glb`,
      category: 'mesh',
      thumbnail: '',
      meshType: 'custom',
      source: {
        viewUrl: downloadUrl,
        localUrl: downloadUrl,
        filename: `${selectedJob.feature || 'Generated_Mesh'}_${selectedJob.id.slice(0, 6)}.glb`,
        subfolder: '',
        type: 'model',
      },
    } as any);
    toast.success('Loaded 3D result into active viewport');
    if (onBack) onBack();
  };

  const filteredJobs = jobsList.filter((j) => {
    const matchesFilter =
      listFilter === 'all'
        ? true
        : listFilter === 'running'
        ? j.status === 'processing' || j.status === 'running' || j.status === 'queued'
        : j.status === listFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      j.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (j.feature || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (j.model_preference || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const isCompleted = selectedJob?.status === 'completed';
  const isFailed = selectedJob?.status === 'failed';
  const isRunning = selectedJob?.status === 'processing' || selectedJob?.status === 'running' || selectedJob?.status === 'queued';

  return (
    <div id="job-detail-view" className="flex flex-col h-full w-full bg-[hsl(var(--surface-0))] text-white overflow-hidden select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
            <HugeiconsIcon icon={Box} size={16} className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-wide">Jobs & Execution Pipeline</h1>
              {onBack && (
                <button
                  onClick={onBack}
                  className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer"
                >
                  ← Back to Workspace
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">Real-time GPU queue, model execution telemetry & outputs</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] hover:border-white/[0.16] text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" />
            <span>RefreshIcon</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout: Left Queue Sidebar + Right Job Details */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Jobs List Sidebar */}
        <div className="w-80 border-r border-white/[0.08] bg-[hsl(var(--surface-1))]/50 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-white/[0.06] space-y-2">
            <div className="relative">
              <HugeiconsIcon icon={SearchIcon} size={16} className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="SearchIcon job ID or model..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-primary"
              />
            </div>

            {/* FilterIcon pills */}
            <div className="flex items-center gap-1">
              {(['all', 'running', 'completed', 'failed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setListFilter(f)}
                  className={`flex-1 py-1 rounded text-[10px] font-bold capitalize transition-colors cursor-pointer ${
                    listFilter === f
                      ? 'bg-primary text-black font-extrabold'
                      : 'text-zinc-400 hover:text-white bg-[hsl(var(--surface-0))]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
            {filteredJobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500 space-y-1">
                <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 text-zinc-600 mx-auto mb-2 opacity-50" />
                <p>No jobs found</p>
                <p className="text-[10px]">Generate a 3D model to see jobs here</p>
              </div>
            ) : (
              filteredJobs.map((j) => {
                const isSel = j.id === selectedJobId;
                const isRun = j.status === 'processing' || j.status === 'running' || j.status === 'queued';
                const isDone = j.status === 'completed';
                const isErr = j.status === 'failed';
                return (
                  <button
                    key={j.id}
                    onClick={() => setSelectedJobId(j.id)}
                    className={`w-full text-left p-3 transition-colors cursor-pointer flex flex-col gap-1 ${
                      isSel ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-white truncate max-w-[170px]">
                        {j.id.slice(0, 12)}...
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          isDone
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : isRun
                            ? 'bg-primary/20 text-primary animate-pulse'
                            : isErr
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-300 truncate">
                      {j.feature || '3D Model Generation'}
                    </div>
                    <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                      <span className="truncate">{j.model_preference || 'Standard'}</span>
                      {j.created_at && (
                        <span>{new Date(j.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Job Details View */}
        <div className="flex-1 overflow-y-auto p-5">
          {!selectedJob ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-2">
              <HugeiconsIcon icon={Box} size={16} className="w-10 h-10 stroke-[1.5] text-zinc-600" />
              <p className="text-xs">Select a job from the list to view its real parameters and output</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Header Card */}
              <div className="rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-white">Job ID: {selectedJob.id}</span>
                    <button
                      onClick={handleCopyId}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                    >
                      {copiedId ? <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-emerald-400" /> : <HugeiconsIcon icon={Copy} size={16} className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Operation: <span className="text-white font-medium">{selectedJob.feature || '3D Mesh Synthesis'}</span> • Engine: <span className="text-primary font-medium">{selectedJob.model_preference || 'Auto'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : isRunning
                        ? 'bg-primary/20 text-primary border border-primary/30 animate-pulse'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isCompleted ? 'bg-emerald-400' : isRunning ? 'bg-primary' : 'bg-rose-400'}`} />
                    {selectedJob.status}
                  </span>

                  <button
                    onClick={handleCancelOrDeleteJob}
                    className="p-1.5 rounded-lg bg-[hsl(var(--surface-0))] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/[0.06] transition-colors cursor-pointer"
                    title={selectedJobIsRunning ? 'Cancel Job' : 'Delete Job'}
                  >
                    {selectedJobIsRunning ? <HugeiconsIcon icon={StopCircleIcon} size={16} className="w-4 h-4" /> : <HugeiconsIcon icon={Trash2} size={16} className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Progress & Error Diagnostics */}
              {isRunning && (
                <div className="rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                      <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4 text-primary animate-pulse" />
                      <span>{selectedJob.stage || 'GPU Synthesis active...'}</span>
                    </span>
                    <span className="font-mono font-bold text-primary">{Math.round(selectedJob.progress || 0)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden border border-white/[0.06]">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 via-primary to-emerald-400 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, selectedJob.progress || 0))}%` }}
                    />
                  </div>
                </div>
              )}

              {isFailed && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                    <HugeiconsIcon icon={AlertCircle} size={16} className="w-4 h-4" />
                    <span>Generation Error Diagnostics</span>
                  </div>
                  <p className="text-xs text-rose-200 font-mono bg-black/40 p-2.5 rounded-lg border border-rose-500/20 whitespace-pre-wrap">
                    {selectedJob.error || 'The worker encountered an unhandled exception during synthesis.'}
                  </p>
                </div>
              )}

              {/* Output Actions & Details Card */}
              {isCompleted && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="space-y-1 text-left w-full sm:w-auto">
                    <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-4 h-4" />
                      <span>3D Mesh Generation Succeeded</span>
                    </div>
                    <p className="text-[11px] text-zinc-300">The GLB asset is compiled and available for preview and export.</p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleLoadResultToViewport}
                      className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-primary hover:brightness-105 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                    >
                      <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5" />
                      <span>Load into Viewport</span>
                    </button>
                    <a
                      href={`/api/v1/system/jobs/${selectedJob.id}/download`}
                      download
                      className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-white/[0.12] text-white font-bold text-xs flex items-center justify-center gap-1.5 border border-white/[0.08] transition-colors"
                    >
                      <HugeiconsIcon icon={DownloadIcon} size={16} className="w-3.5 h-3.5" />
                      <span>DownloadIcon GLB</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Two Column GridIcon: Parameters & Telemetry */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Parameters Card */}
                <div className="rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-white">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={LayersIcon} size={16} className="w-4 h-4 text-primary" />
                      <span>Job Parameters</span>
                    </div>
                    <button
                      onClick={() => setIsRawJsonOpen(!isRawJsonOpen)}
                      className="text-[10px] text-primary hover:underline font-mono cursor-pointer"
                    >
                      {isRawJsonOpen ? 'Table View' : 'Raw JSON'}
                    </button>
                  </div>

                  {isRawJsonOpen ? (
                    <pre className="p-3 rounded-lg bg-[hsl(var(--surface-0))] text-[10px] font-mono text-emerald-400 overflow-x-auto border border-white/[0.04] max-h-56">
                      {JSON.stringify(selectedJob.parameters || selectedJob.inputs || {}, null, 2)}
                    </pre>
                  ) : (
                    <div className="space-y-1.5 text-[11px] divide-y divide-white/[0.04]">
                      <div className="flex justify-between py-1"><span className="text-zinc-400">Created At</span><span className="font-mono text-white">{selectedJob.created_at ? new Date(selectedJob.created_at).toLocaleString() : 'N/A'}</span></div>
                      <div className="flex justify-between py-1"><span className="text-zinc-400">Completed At</span><span className="font-mono text-white">{selectedJob.completed_at ? new Date(selectedJob.completed_at).toLocaleString() : 'In Progress'}</span></div>
                      <div className="flex justify-between py-1"><span className="text-zinc-400">Output Format</span><span className="font-mono text-white uppercase">GLB</span></div>
                      {selectedJob.parameters && typeof selectedJob.parameters === 'object' && Object.entries(selectedJob.parameters).slice(0, 6).map(([k, v]) => (
                        <div key={k} className="flex justify-between py-1">
                          <span className="text-zinc-400 truncate max-w-[140px]">{k}</span>
                          <span className="font-mono text-white truncate max-w-[180px]">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Input Asset & Telemetry */}
                <div className="rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <HugeiconsIcon icon={ActivityIcon} size={16} className="w-4 h-4 text-primary" />
                    <span>Input Asset & Pipeline Details</span>
                  </div>

                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.04]">
                    <div className="w-12 h-12 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0">
                      <img
                        src={`/api/v1/system/jobs/${selectedJob.id}/input`}
                        alt="Input"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <HugeiconsIcon icon={Box} size={16} className="w-5 h-5 text-zinc-500" />
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="font-bold text-white truncate">Input Reference</div>
                      <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                        Status: <span className="text-emerald-400">{selectedJob.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/[0.04] space-y-1.5 text-[11px]">
                    <div className="flex justify-between"><span className="text-zinc-400">Queue Mode</span><span className="font-mono text-white">Multi-Worker Async</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Engine Protocol</span><span className="font-mono text-white">{selectedJob.feature || 'Mesh Generation'}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">TargetIcon Pipeline</span><span className="font-mono text-white">{selectedJob.model_preference || 'Standard'}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
