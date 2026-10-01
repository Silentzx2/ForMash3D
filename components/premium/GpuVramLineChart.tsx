"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cpu, Zap, Activity01, RefreshCw, Flame } from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import type { RealtimeGpuData } from '@/hooks/useRealtime';

export interface TelemetryPoint {
  time: string;
  rawTime: number;
  gpu: number;
  vram: number;
  vramUsedGb: number;
  vramTotalGb: number;
  cpu: number;
  ram: number;
  temp: number;
}

interface GpuVramLineChartProps {
  initialHistory?: TelemetryPoint[];
  autoPoll?: boolean;
  pollIntervalMs?: number;
  height?: number | string;
  showDetails?: boolean;
  className?: string;
  /** When provided, used as the live GPU source instead of polling. */
  realtimeGpu?: RealtimeGpuData | null;
}

export function GpuVramLineChart({
  initialHistory,
  autoPoll = true,
  pollIntervalMs = 10000,
  height = 260,
  showDetails = true,
  className = '',
  realtimeGpu = null,
}: GpuVramLineChartProps) {
  const { systemStats } = useWorkspace();
  const [data, setData] = useState<TelemetryPoint[]>(() => {
    if (initialHistory && initialHistory.length > 0) return initialHistory;
    // Seed with empty or initial point
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return [
      {
        time: timeStr,
        rawTime: now.getTime(),
        gpu: 0,
        vram: 0,
        vramUsedGb: 0,
        vramTotalGb: systemStats.vramTotalGb || 0,
        cpu: 0,
        ram: 0,
        temp: 0,
      }
    ];
  });

  const [activeMetrics, setActiveMetrics] = useState({
    gpu: true,
    vram: true,
    cpu: false,
  });

  const [maxPoints, setMaxPoints] = useState<number>(30);
  const [isLive, setIsLive] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Record a telemetry sample from realtime WebSocket GPU data
  useEffect(() => {
    if (!realtimeGpu) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const totalVramMb = realtimeGpu.total_vram_mb ?? 0;
    const freeVramMb = realtimeGpu.free_vram_mb ?? 0;
    const usedVramMb = totalVramMb > 0 ? totalVramMb - freeVramMb : 0;
    const vramPct = totalVramMb > 0 ? Math.min(100, Math.round((usedVramMb / totalVramMb) * 100)) : 0;
    const vramUsedGb = Number((usedVramMb / 1024).toFixed(2));
    const vramTotalGb = Number((totalVramMb / 1024).toFixed(1));

    // Use first device's utilization/temperature if available
    const device = realtimeGpu.devices?.[0];
    const gpuUtil = Math.round(device?.utilization ?? 0);
    const tempVal = Math.round(device?.temperature ?? 0);

    const newPoint: TelemetryPoint = {
      time: timeStr,
      rawTime: now.getTime(),
      gpu: gpuUtil,
      vram: vramPct,
      vramUsedGb,
      vramTotalGb,
      cpu: 0,
      ram: 0,
      temp: tempVal,
    };

    setData((prev) => {
      const next = [...prev, newPoint];
      if (next.length > maxPoints) return next.slice(-maxPoints);
      return next;
    });
  }, [realtimeGpu, maxPoints]);

  // Function to record a new telemetry sample from real backend
  const recordSample = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const status = await getApiClient().getSystemStatus();
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const gpuUtil = Math.round(status?.gpu_utilization ?? 0);
      const vramUsedMb = status?.vram_used_mb ?? ((systemStats.vramUsedGb || 0) * 1024);
      const vramTotalMb = status?.vram_total_mb ?? ((systemStats.vramTotalGb || 0) * 1024);
      const vramPct = vramTotalMb > 0 ? Math.min(100, Math.round((vramUsedMb / vramTotalMb) * 100)) : 0;
      const vramUsedGb = Number((vramUsedMb / 1024).toFixed(2));
      const vramTotalGb = Number((vramTotalMb / 1024).toFixed(1));
      const cpuUtil = Math.round(status?.cpu_usage ?? 0);
      const ramUtil = Math.round(status?.ram_usage ?? 0);
      const tempVal = Math.round(status?.gpu_temp ?? 0);

      const newPoint: TelemetryPoint = {
        time: timeStr,
        rawTime: now.getTime(),
        gpu: gpuUtil,
        vram: vramPct,
        vramUsedGb,
        vramTotalGb,
        cpu: cpuUtil,
        ram: ramUtil,
        temp: tempVal,
      };

      setData((prev) => {
        const next = [...prev, newPoint];
        if (next.length > maxPoints) {
          return next.slice(-maxPoints);
        }
        return next;
      });
    } catch {
      // Backend not running or unreachable
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  }, [systemStats.vramUsedGb, systemStats.vramTotalGb, maxPoints]);

  useEffect(() => {
    if (!autoPoll || !isLive) return;
    // When realtime GPU data is provided via WebSocket, skip polling entirely
    if (realtimeGpu) return;

    // Trigger initial sample silently
    void recordSample(false);

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void recordSample(false);
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [autoPoll, isLive, pollIntervalMs, recordSample, realtimeGpu]);

  // Derived current metrics and peaks
  const latest = data[data.length - 1] || {
    gpu: 0,
    vram: 0,
    vramUsedGb: 0,
    vramTotalGb: 0,
    cpu: 0,
    temp: 0,
  };

  const peakGpu = useMemo(() => Math.max(...data.map((d) => d.gpu), 0), [data]);
  const peakVram = useMemo(() => Math.max(...data.map((d) => d.vram), 0), [data]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const current = payload[0]?.payload as TelemetryPoint;

    return (
      <div className="p-3 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-[hsl(var(--border))] shadow-2xl backdrop-blur-md text-xs font-mono space-y-1.5 min-w-[170px] z-50">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-1 mb-1">
          <span className="text-[hsl(var(--muted-foreground))] font-sans font-semibold text-[11px]">{label}</span>
          <span className="text-[10px] text-[hsl(var(--chart-vram))] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--status-online))] animate-pulse" /> Live
          </span>
        </div>

        {activeMetrics.gpu && (
          <div className="flex items-center justify-between text-[hsl(var(--chart-gpu))]">
            <span className="flex items-center gap-1.5 font-sans font-medium">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-gpu))]" /> GPU Load:
            </span>
            <span className="font-bold">{current.gpu}%</span>
          </div>
        )}

        {activeMetrics.vram && (
          <div className="flex items-center justify-between text-[hsl(var(--chart-vram))]">
            <span className="flex items-center gap-1.5 font-sans font-medium">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-vram))]" /> VRAM Used:
            </span>
            <span className="font-bold">
              {current.vram}% ({current.vramUsedGb} / {current.vramTotalGb} GB)
            </span>
          </div>
        )}

        {activeMetrics.cpu && (
          <div className="flex items-center justify-between text-[hsl(var(--chart-cpu))]">
            <span className="flex items-center gap-1.5 font-sans font-medium">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-cpu))]" /> CPU Usage:
            </span>
            <span className="font-bold">{current.cpu}%</span>
          </div>
        )}

        {current.temp > 0 && (
          <div className="flex items-center justify-between text-[hsl(var(--chart-temp))] pt-0.5 border-t border-[hsl(var(--border))]">
            <span className="flex items-center gap-1.5 font-sans font-medium">
              <HugeiconsIcon icon={Flame} size={16} className="w-3 h-3 text-[hsl(var(--chart-temp))]" /> Temp:
            </span>
            <span className="font-bold">{current.temp}°C</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top Header Controls and Telemetry Pill Summary */}
      {showDetails && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1 border-b border-[hsl(var(--border))]/80">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[hsl(var(--chart-gpu))]/15 border border-[hsl(var(--chart-gpu))]/30 text-[hsl(var(--chart-gpu))]">
                <HugeiconsIcon icon={Activity01} size={16} className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs lg:text-sm font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
                  <span>GPU & VRAM Real-Time Telemetry</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[hsl(var(--surface-2))] text-[hsl(var(--chart-vram))] border border-[hsl(var(--border))]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--status-online))] animate-pulse" />
                    {isLive ? 'STREAMING' : 'PAUSED'}
                  </span>
                </h3>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  Live telemetry from the FastAPI runtime
                </p>
              </div>
            </div>
          </div>

          {/* Quick Metrics Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* GPU Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[hsl(var(--chart-gpu))]/10 border border-[hsl(var(--chart-gpu))]/30 text-xs">
              <HugeiconsIcon icon={Cpu} size={16} className="w-3.5 h-3.5 text-[hsl(var(--chart-gpu))]" />
              <span className="text-[hsl(var(--muted-foreground))] text-[11px]">GPU:</span>
              <span className="font-mono font-bold text-[hsl(var(--chart-gpu))]">{latest.gpu}%</span>
              <span className="text-[10px] text-[hsl(var(--chart-gpu))]/70 font-mono">(Peak {peakGpu}%)</span>
            </div>

            {/* VRAM Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[hsl(var(--chart-vram))]/10 border border-[hsl(var(--chart-vram))]/30 text-xs">
              <HugeiconsIcon icon={Zap} size={16} className="w-3.5 h-3.5 text-[hsl(var(--chart-vram))]" />
              <span className="text-[hsl(var(--muted-foreground))] text-[11px]">VRAM:</span>
              <span className="font-mono font-bold text-[hsl(var(--chart-vram))]">
                {latest.vramTotalGb > 0 ? `${latest.vramUsedGb} / ${latest.vramTotalGb} GB (${latest.vram}%)` : 'Unavailable'}
              </span>
            </div>

            {/* Temp Badge if available */}
            {latest.temp > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[hsl(var(--chart-temp))]/10 border border-[hsl(var(--chart-temp))]/30 text-xs">
                <HugeiconsIcon icon={Flame} size={16} className="w-3.5 h-3.5 text-[hsl(var(--chart-temp))]" />
                <span className="font-mono font-bold text-[hsl(var(--chart-temp))]">{latest.temp}°C</span>
              </div>
            )}

            {/* Toggle Streaming & Refresh */}
            <button
              onClick={() => setIsLive(!isLive)}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                isLive
                  ? 'bg-[hsl(var(--chart-vram))]/10 border-[hsl(var(--chart-vram))]/40 text-[hsl(var(--chart-vram))] hover:bg-[hsl(var(--chart-vram))]/20'
                  : 'bg-[hsl(var(--destructive))]/10 border-[hsl(var(--destructive))]/40 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/20'
              }`}
              title={isLive ? 'Pause live polling' : 'Resume live polling'}
            >
              {isLive ? 'Live' : 'Paused'}
            </button>

            <button
              onClick={() => recordSample(true)}
              disabled={isRefreshing}
              className="p-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-50"
              title="Refresh now"
            >
              <HugeiconsIcon icon={RefreshCw} size={16} className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[hsl(var(--chart-vram))]' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Chart Filter Toggles */}
      <div className="flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))] px-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveMetrics((m) => ({ ...m, gpu: !m.gpu }))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all ${
              activeMetrics.gpu
                ? 'bg-[hsl(var(--chart-gpu))]/15 border-[hsl(var(--chart-gpu))]/50 text-[hsl(var(--chart-gpu))] font-semibold'
                : 'bg-[hsl(var(--surface-2))] border-transparent text-[hsl(var(--muted-foreground))]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-gpu))]" />
            GPU Load
          </button>

          <button
            onClick={() => setActiveMetrics((m) => ({ ...m, vram: !m.vram }))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all ${
              activeMetrics.vram
                ? 'bg-[hsl(var(--chart-vram))]/15 border-[hsl(var(--chart-vram))]/50 text-[hsl(var(--chart-vram))] font-semibold'
                : 'bg-[hsl(var(--surface-2))] border-transparent text-[hsl(var(--muted-foreground))]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-vram))]" />
            VRAM Usage (%)
          </button>

          <button
            onClick={() => setActiveMetrics((m) => ({ ...m, cpu: !m.cpu }))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all ${
              activeMetrics.cpu
                ? 'bg-[hsl(var(--chart-cpu))]/15 border-[hsl(var(--chart-cpu))]/50 text-[hsl(var(--chart-cpu))] font-semibold'
                : 'bg-[hsl(var(--surface-2))] border-transparent text-[hsl(var(--muted-foreground))]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--chart-cpu))]" />
            CPU Usage
          </button>
        </div>

        {/* History Window Size */}
        <div className="flex items-center gap-1">
          <span>Window:</span>
          {[20, 30, 50].map((pts) => (
            <button
              key={pts}
              onClick={() => setMaxPoints(pts)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                maxPoints === pts
                  ? 'bg-[hsl(var(--primary))]/20 text-[hsl(var(--primary))] font-bold border border-[hsl(var(--primary))]/40'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              {pts}s
            </button>
          ))}
        </div>
      </div>

      {/* Main Recharts Area */}
      <div className="w-full relative rounded-2xl bg-[hsl(var(--surface-0))]/90 border border-[hsl(var(--border))] p-3 pt-4 overflow-hidden shadow-inner">
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                dy={6}
              />
              
              <YAxis
                domain={[0, 100]}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickFormatter={(val) => `${val}%`}
              />

              <Tooltip content={<CustomTooltip />} />

              {activeMetrics.gpu && (
                <Line
                  type="monotone"
                  dataKey="gpu"
                  name="GPU Load"
                  stroke="hsl(var(--chart-gpu))"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'hsl(var(--chart-gpu))', stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )}

              {activeMetrics.vram && (
                <Line
                  type="monotone"
                  dataKey="vram"
                  name="VRAM Usage"
                  stroke="hsl(var(--chart-vram))"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'hsl(var(--chart-vram))', stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )}

              {activeMetrics.cpu && (
                <Line
                  type="monotone"
                  dataKey="cpu"
                  name="CPU Usage"
                  stroke="hsl(var(--chart-cpu))"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 4, fill: 'hsl(var(--chart-cpu))', stroke: 'hsl(var(--foreground))', strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
