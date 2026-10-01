"use client";


import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cpu, HardDrive, Zap, Activity01, BoxIcon,
  CancelCircle, ServerIcon, MemoryStick, Thermometer, Gauge, ScrollText, RefreshCw
} from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { MetricCard } from '@/components/premium/MetricCard';
import { ProgressBar } from '@/components/premium/ProgressBar';
import { StatusDot } from '@/components/premium/StatusDot';
import { Badge } from '@/components/premium/Badge';
import { Spinner } from '@/components/premium/Spinner';
import { GpuVramLineChart } from '@/components/premium/GpuVramLineChart';
import { getApiClient } from '@/services/apiClient';
import type { AdminOverview, RuntimeStatus } from '@/types';

export function OverviewTab() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [status, queueStats] = await Promise.all([
        getApiClient().getSystemStatus(),
        getApiClient().getQueueStats().catch(() => null),
      ]);
      setRuntime(status as unknown as RuntimeStatus);
      const queue = queueStats?.data;
      setOverview({
        status: 'online',
        uptime: '—',
        active_jobs: queue?.processing_jobs ?? 0,
        queued_jobs: queue?.pending_jobs ?? 0,
        completed_today: 0,
        success_rate: 0,
        gpu_utilization: status.gpu_utilization ?? 0,
        vram_used_mb: status.vram_used_mb ?? 0,
        vram_total_mb: status.vram_total_mb ?? 1,
        cpu_usage: status.cpu_usage ?? 0,
        ram_usage: status.ram_usage ?? 0,
        storage_used_gb: status.storage_used_gb ?? 0,
        storage_total_gb: status.storage_total_gb ?? 1,
        gpu_temp: status.gpu_temp ?? 0,
        cuda_available: status.cuda_available ?? false,
        queue_running: (queue?.processing_jobs ?? 0) > 0,
      } as any);
      setError(null);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setTimeout(() => load(), 0);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const quickActions = [
    { label: 'New Generation', icon: BoxIcon, color: 'amber' as const, href: '/workspace' },
    { label: 'Manage Models', icon: HardDrive, color: 'blue' as const, href: '/admin' },
    { label: 'View Runtime', icon: Activity01, color: 'amber' as const, href: '/admin' },
    { label: 'System Logs', icon: ScrollText, color: 'green' as const, href: '/admin' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !overview && !runtime) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <HugeiconsIcon icon={CancelCircle} size={24} className="w-10 h-10 text-[hsl(var(--destructive))]" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-primary hover:underline flex items-center gap-1.5 cursor-pointer">
          <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  // Use overview as primary source (has all metrics from a single API call),
  // fall back to runtime status for any fields overview lacks.
  const gpu = overview?.gpu_utilization ?? runtime?.gpu_utilization ?? 0;
  const vram = overview?.vram_used_mb ?? runtime?.vram_used_mb ?? 0;
  const vramTotal = overview?.vram_total_mb ?? runtime?.vram_total_mb ?? 1;
  const cpu = overview?.cpu_usage ?? runtime?.cpu_usage ?? 0;
  const ram = overview?.ram_usage ?? runtime?.ram_usage ?? 0;
  const temp = (overview as any)?.gpu_temp ?? runtime?.gpu_temp ?? 0;
  const storage = overview?.storage_used_gb ?? runtime?.storage_used_gb ?? 0;
  const storageTotal = overview?.storage_total_gb ?? runtime?.storage_total_gb ?? 1;

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl bg-[hsl(var(--surface-1))] border border-border p-6"
      >
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary/15 text-primary border border-primary/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                System Online
              </span>
              <span className="text-xs text-zinc-400 font-mono">Uptime: {overview?.uptime ?? '—'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
              Welcome to <span className="text-primary">ForMash 3D</span>
            </h1>
            <p className="text-xs text-zinc-400">
              Your AI generation engine is running. {overview?.active_jobs ?? 0} active jobs, {overview?.queued_jobs ?? 0} in queue.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Today</p>
              <p className="text-2xl font-bold font-mono text-white">{overview?.completed_today ?? 0}</p>
              <p className="text-[11px] text-primary font-medium">models generated</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Success Rate</p>
              <p className="text-2xl font-bold font-mono text-emerald-400">{overview?.success_rate != null ? `${overview.success_rate}%` : '—'}</p>
              <p className="text-[11px] text-zinc-400 font-medium">last 24h</p>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {quickActions.map((action, i) => {
          const Icon = action.icon;
          return (
            <motion.a
              key={action.label}
              href={action.href}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.03 }}
              whileHover={{ scale: 1.02 }}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-border hover:border-primary/50 hover:bg-[hsl(var(--surface-2))] transition-all"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[hsl(var(--surface-0))] text-primary">
                <HugeiconsIcon icon={Icon} size={16} className="w-4 h-4 stroke-[2.2]" />
              </div>
              <span className="text-xs font-bold text-white">{action.label}</span>
            </motion.a>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <MetricCard label="GPU Usage" value={Math.round(gpu)} unit="%" icon={Cpu} color="amber" delay={0.1}>
          <div className="mt-3"><ProgressBar value={gpu} color="amber" size="sm" showGlow /></div>
        </MetricCard>
        <MetricCard label="VRAM" value={`${(vram / 1024).toFixed(1)}`} unit={`/ ${(vramTotal / 1024).toFixed(0)} GB`} icon={Zap} color="blue" delay={0.15}>
          <div className="mt-3"><ProgressBar value={(vram / vramTotal) * 100} color="blue" size="sm" /></div>
        </MetricCard>
        <MetricCard label="CPU" value={Math.round(cpu)} unit="%" icon={ServerIcon} color="amber" delay={0.2}>
          <div className="mt-3"><ProgressBar value={cpu} color="amber" size="sm" /></div>
        </MetricCard>
        <MetricCard label="RAM" value={Math.round(ram)} unit="%" icon={MemoryStick} color="green" delay={0.25}>
          <div className="mt-3"><ProgressBar value={ram} color="green" size="sm" /></div>
        </MetricCard>
      </div>

      {/* Real-time Recharts Line Chart for VRAM and GPU Utilization */}
      <GlassCard className="p-5 lg:p-6" delay={0.3}>
        <GpuVramLineChart height={280} autoPoll pollIntervalMs={15000} />
      </GlassCard>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-5" delay={0.4}>
          <div className="flex items-center gap-2 mb-3">
            <HugeiconsIcon icon={HardDrive} size={16} className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Storage</h3>
          </div>
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-xl font-bold font-mono">{storage.toFixed(0)}</span>
            <span className="text-sm text-muted-foreground">/ {storageTotal.toFixed(0)} GB</span>
          </div>
          <ProgressBar value={(storage / storageTotal) * 100} color="amber" size="sm" showGlow />
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
            <span>{((storage / storageTotal) * 100).toFixed(0)}% used</span>
            <span>{(storageTotal - storage).toFixed(0)} GB free</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5" delay={0.45}>
          <div className="flex items-center gap-2 mb-3">
            <HugeiconsIcon icon={Thermometer} size={16} className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Temperature</h3>
          </div>
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-xl font-bold font-mono">{Math.round(temp)}</span>
            <span className="text-sm text-muted-foreground">°C</span>
          </div>
          <ProgressBar value={temp} color="amber" size="sm" />
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
            <span>Normal range</span>
            <span className={temp > 80 ? 'text-[hsl(var(--destructive))]' : 'text-emerald-400'}>
              {temp > 80 ? 'High' : 'Optimal'}
            </span>
          </div>
        </GlassCard>

        <GlassCard className="p-5" delay={0.5}>
          <div className="flex items-center gap-2 mb-3">
            <HugeiconsIcon icon={Gauge} size={16} className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">System Status</h3>
          </div>
          <div className="space-y-2">
            {[
              { label: 'CUDA', status: (overview as any)?.cuda_available ?? runtime?.cuda_available ? 'online' as const : 'offline' as const },
              { label: 'Backend API', status: overview ? 'online' as const : 'offline' as const },
              { label: 'Worker Queue', status: overview?.queue_running ? 'online' as const : 'offline' as const },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <div className="flex items-center gap-2">
                  <StatusDot status={item.status} size="sm" />
                  <span className="text-xs text-emerald-400">{item.status === 'online' ? 'Operational' : 'Offline'}</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
