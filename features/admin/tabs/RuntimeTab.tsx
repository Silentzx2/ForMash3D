"use client";


import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CpuIcon, ZapIcon, MemoryStickIcon, ThermometerIcon, HardDriveIcon, Activity01Icon,
  ServerIcon, NetworkIcon, RefreshCwIcon, CheckmarkCircle01Icon,
  GaugeIcon, CancelCircleIcon
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/premium/GlassCard';
import { MetricCard } from '@/components/premium/MetricCard';
import { ProgressBar } from '@/components/premium/ProgressBar';
import { StatusDot } from '@/components/premium/StatusDot';
import { NeonButton } from '@/components/premium/NeonButton';
import { Spinner } from '@/components/premium/Spinner';
import { GpuVramLineChart } from '@/components/premium/GpuVramLineChart';
import { getApiClient } from '@/services/apiClient';
import type { RuntimeStatus, AdminLog } from '@/types';
import { toast } from 'sonner';

export function RuntimeTab() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ gpu: number; vram: number; cpu: number; ram: number }[]>([]);

  const load = useCallback(async () => {
    try {
      const [st, lg] = await Promise.all([
        getApiClient().getSystemStatus(),
        getApiClient().getLogs(10),
      ]);
      if (st) setStatus(st as unknown as RuntimeStatus);
      if (lg.length > 0) setLogs(lg);
      setError(!st ? 'Failed to load runtime status' : null);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setTimeout(() => load(), 0);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, 10000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (status) {
      setTimeout(() => {
        setHistory((prev) => [...prev.slice(-39), {
          gpu: status.gpu_utilization ?? 0,
          vram: ((status.vram_used_mb ?? 0) / (status.vram_total_mb ?? 1)) * 100,
          cpu: status.cpu_usage ?? 0,
          ram: status.ram_usage ?? 0,
        }]);
      }, 0);
    }
  }, [status]);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <HugeiconsIcon icon={CancelCircleIcon} size={16} className="w-10 h-10 text-[hsl(var(--destructive))]" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-primary hover:underline flex items-center gap-1.5 cursor-pointer">
          <HugeiconsIcon icon={RefreshCwIcon} size={16} className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const gpu = status?.gpu_utilization ?? 0;
  const vram = status?.vram_used_mb ?? 0;
  const vramTotal = status?.vram_total_mb ?? 1;
  const cpu = status?.cpu_usage ?? 0;
  const ram = status?.ram_usage ?? 0;
  const temp = status?.gpu_temp ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runtime Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time system performance & GPU diagnostics</p>
        </div>
      </div>

      <GlassCard className="p-4" delay={0.05}>
        <div className="flex flex-wrap items-center gap-4 lg:gap-6">
          {[
             { label: 'CUDA', value: status?.cuda_version ?? '—', icon: CpuIcon, color: 'text-emerald-400' },
             { label: 'Driver', value: status?.driver_version ?? '—', icon: ServerIcon, color: 'text-foreground' },
             { label: 'Network In', value: (status?.network_in ?? 0) > 0 ? `${(status?.network_in ?? 0).toFixed(1)} MB` : '—', icon: NetworkIcon, color: 'text-primary' },
             { label: 'Network Out', value: (status?.network_out ?? 0) > 0 ? `${(status?.network_out ?? 0).toFixed(1)} MB` : '—', icon: Activity01Icon, color: 'text-primary' },
          ].map((item) => {
            return (
              <div key={item.label} className="flex items-center gap-2">
                <HugeiconsIcon icon={item.icon} size={14} className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className={`text-xs font-mono ${item.color}`}>{item.value}</span>
              </div>
            );
          })}
        </div>
        
        {/* Enhanced Hardware Details - Prominent Display */}
        <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]/[0.15] grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* GPU Detail Card */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--primary)/0.25)]">
             <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--primary)/0.15)]">
               <HugeiconsIcon icon={CpuIcon} size={16} className="w-5 h-5 text-primary" />
             </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase tracking-wider text-primary font-medium">GPU</span>
              <p className="text-sm font-semibold text-foreground truncate" title={status?.gpu_name}>
                {status?.gpu_name || 'Not Detected'}
              </p>
              {status?.vram_total_mb && (
                <span className="text-[10px] text-muted-foreground">
                  {(status.vram_total_mb / 1024).toFixed(1)} GB VRAM
                </span>
              )}
            </div>
          </div>
          
          {/* CPU Detail Card */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
             <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--surface-3))]">
               <HugeiconsIcon icon={ServerIcon} size={16} className="w-5 h-5 text-muted-foreground" />
             </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">CPU</span>
              <p className="text-sm font-semibold text-foreground truncate" title={status?.cpu_name}>
                {status?.cpu_name 
                  ? (status.cpu_name.length > 35 ? status.cpu_name.slice(0, 35) + '…' : status.cpu_name)
                  : 'Not Detected'}
              </p>
              {status?.cpu_cores && (
                <span className="text-[10px] text-muted-foreground">
                  {status.cpu_cores} Cores · {status.cpu_threads || status.cpu_cores * 2} Threads
                </span>
              )}
            </div>
          </div>
          
          {/* Disk/Storage Detail Card */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
             <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(var(--surface-3))]">
               <HugeiconsIcon icon={HardDriveIcon} size={16} className="w-5 h-5 text-emerald-400" />
             </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-medium">Storage</span>
              <p className="text-sm font-semibold text-foreground">
                {(status?.storage_used_gb ?? 0).toFixed(0)} / {(status?.storage_total_gb ?? 0).toFixed(0)} GB
              </p>
              <span className="text-[10px] text-muted-foreground">
                {status?.storage_total_gb ?? 0 ? Math.round(((status?.storage_used_gb ?? 0) / (status?.storage_total_gb ?? 1)) * 100) : 0}% Used
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="GPU" value={Math.round(gpu)} unit="%" icon={<HugeiconsIcon icon={CpuIcon} size={16} className="w-4 h-4 text-primary" />} color="amber" delay={0.1}>
          <div className="mt-3"><ProgressBar value={gpu} color="amber" size="sm" showGlow /></div>
        </MetricCard>
        <MetricCard label="VRAM" value={vramTotal > 0 ? Math.round((vram / vramTotal) * 100) : 0} unit="%" icon={<HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 text-primary" />} color="blue" delay={0.15}>
          <div className="mt-3"><ProgressBar value={(vram / vramTotal) * 100} color="blue" size="sm" showGlow /></div>
          <div className="mt-2 text-[10px] text-center text-muted-foreground font-mono">
            {(vram / 1024).toFixed(1)} / {(vramTotal / 1024).toFixed(0)} GB
          </div>
        </MetricCard>
        <MetricCard label="CPU" value={Math.round(cpu)} unit="%" icon={<HugeiconsIcon icon={ServerIcon} size={16} className="w-4 h-4 text-primary" />} color="amber" delay={0.2}>
          <div className="mt-3"><ProgressBar value={cpu} color="amber" size="sm" showGlow /></div>
        </MetricCard>
        <MetricCard label="RAM" value={Math.round(ram)} unit="%" icon={<HugeiconsIcon icon={MemoryStickIcon} size={16} className="w-4 h-4 text-primary" />} color="green" delay={0.25}>
          <div className="mt-3"><ProgressBar value={ram} color="green" size="sm" showGlow /></div>
          <div className="mt-2 text-[10px] text-center text-muted-foreground font-mono">
            {((status?.ram_total ?? 0) * ram / 100 / 1024).toFixed(1)} / {((status?.ram_total ?? 0) / 1024).toFixed(1)} GB
          </div>
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard className="p-5 lg:col-span-2" delay={0.3}>
           <GpuVramLineChart height={240} autoPoll pollIntervalMs={15000} />
        </GlassCard>

        <GlassCard className="p-5" delay={0.35}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Runtime Logs</h3>
            <StatusDot status={status ? 'online' : 'offline'} size="sm" />
          </div>
          <div className="space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin font-mono">
            {logs.length > 0 ? logs.map((log, i) => (
              <motion.div key={log.id || i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-2 text-xs">
                <span className="text-muted-foreground/50 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={cn('shrink-0 font-bold', log.level === 'error' ? 'text-destructive' : log.level === 'warn' ? 'text-primary' : log.level === 'success' ? 'text-emerald-400' : 'text-sky-400')}>
                  {log.level.toUpperCase()}
                </span>
                <span className="text-muted-foreground">
                  {typeof log.message === 'string' ? log.message : JSON.stringify(log.message)}
                </span>
              </motion.div>
            )) : (
              <p className="text-xs text-muted-foreground/50 text-center py-8">No logs available</p>
            )}
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard className="p-5" delay={0.4}>
          <h3 className="text-sm font-semibold mb-4">System Health</h3>
          <div className="space-y-3">
            {[
              { label: 'CUDA Available', status: status?.cuda_available ?? false, detail: status?.cuda_version ? `v${status.cuda_version}` : 'Not detected' },
              { label: 'GPU Detected', status: !!status?.gpu_name, detail: status?.gpu_name ?? 'No GPU' },
              { label: 'Blender Available', status: status?.blender_available ?? false, detail: status?.blender_version ? `v${status.blender_version}` : 'Not found' },
              { label: 'Repos Installed', status: (status?.repos_installed ?? 0) > 0, detail: `${status?.repos_installed ?? 0}/${status?.repos_total ?? 0}` },
              { label: 'Weights Downloaded', status: status?.weights_downloaded ?? false, detail: status?.weights_downloaded ? 'All models' : 'Pending' },
              { label: 'Scheduler Running', status: status?.scheduler_running ?? false, detail: status?.scheduler_running ? `${status?.workers ?? 0} workers` : 'Stopped' },
            ].map((check) => (
              <div key={check.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={check.status ? 'online' : 'error'} size="sm" />
                  <span className="text-sm text-foreground">{check.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{check.detail}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5" delay={0.45}>
          <h3 className="text-sm font-semibold mb-4">Storage & Temperature</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                 <span className="text-xs text-muted-foreground flex items-center gap-1.5"><HugeiconsIcon icon={HardDriveIcon} size={16} className="w-3.5 h-3.5" /> Storage</span>
                <span className="text-xs font-mono text-foreground">{(status?.storage_used_gb ?? 0).toFixed(0)} / {(status?.storage_total_gb ?? 0).toFixed(0)} GB</span>
              </div>
              <ProgressBar value={((status?.storage_used_gb ?? 0) / (status?.storage_total_gb ?? 1)) * 100} color="amber" size="sm" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                 <span className="text-xs text-muted-foreground flex items-center gap-1.5"><HugeiconsIcon icon={ThermometerIcon} size={16} className="w-3.5 h-3.5" /> GPU Temperature</span>
                <span className="text-xs font-mono text-foreground">{Math.round(temp)}°C</span>
              </div>
              <ProgressBar value={temp} color={temp > 80 ? 'pink' : 'amber'} size="sm" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                 <span className="text-xs text-muted-foreground flex items-center gap-1.5"><HugeiconsIcon icon={GaugeIcon} size={16} className="w-3.5 h-3.5" /> GPU Utilization</span>
                <span className="text-xs font-mono text-foreground">{Math.round(gpu)}%</span>
              </div>
              <ProgressBar value={gpu} color="amber" size="sm" showGlow />
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
