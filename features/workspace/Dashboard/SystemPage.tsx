import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { GpuVramLineChart } from '@/components/premium/GpuVramLineChart';


import { HugeiconsIcon } from '@hugeicons/react';
import { Activity, Cpu, HardDrive, Server, Terminal } from '@hugeicons/core-free-icons';
const value = (v: unknown) => v == null ? 'Unavailable' : String(v);

export const SystemPage: React.FC = () => {
  const { systemStats, assets } = useWorkspace();

  return (
    <div id="system-page-view" className="flex-1 w-full h-full overflow-y-auto bg-[hsl(var(--surface-0))] select-none text-xs">
      <div className="max-w-6xl mx-auto w-full p-6 lg:p-8 space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">System Telemetry & VRAM</h1>
          <p className="mt-1 text-xs text-zinc-400">Live hardware acceleration and FastAPI runtime status.</p>
        </div>

        {/* 4 Cards Stat Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-4 shadow-lg space-y-1">
            <HugeiconsIcon icon={Server} size={16} className="mb-2 h-4 w-4 text-primary" />
            <div className="text-[10px] uppercase font-bold text-zinc-500">Service Status</div>
            <div className={`mt-1 text-sm font-black flex items-center gap-1.5 ${systemStats.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`w-2 h-2 rounded-full ${systemStats.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span className="capitalize">{systemStats.status}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-4 shadow-lg space-y-1">
            <HugeiconsIcon icon={Cpu} size={16} className="mb-2 h-4 w-4 text-primary" />
            <div className="text-[10px] uppercase font-bold text-zinc-500">GPU Device</div>
            <div className="mt-1 truncate text-sm font-black text-white">{value(systemStats.gpu)}</div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-4 shadow-lg space-y-1">
            <HugeiconsIcon icon={Activity} size={16} className="mb-2 h-4 w-4 text-primary" />
            <div className="text-[10px] uppercase font-bold text-zinc-500">VRAM Allocation</div>
<div className="mt-1 text-sm font-black text-primary font-mono">
                {systemStats.vramUsedGb != null && systemStats.vramTotalGb != null ? (
                  <div className="flex items-center gap-1">
                    <span>{systemStats.vramUsedGb.toFixed(1)}</span>
                    <span>/ {systemStats.vramTotalGb} GB</span>
                  </div>
                ) : (
                  'Unavailable'
                )}
              </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-4 shadow-lg space-y-1">
            <HugeiconsIcon icon={HardDrive} size={16} className="mb-2 h-4 w-4 text-primary" />
            <div className="text-[10px] uppercase font-bold text-zinc-500">Outputs Cached</div>
            <div className="mt-1 text-sm font-black text-white font-mono flex items-center gap-1">
              <span>{assets.length}</span> <span>Assets</span>
            </div>
          </div>
        </div>

        {/* Real-time Recharts Line Chart */}
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-xs text-white flex items-center gap-2">
              <HugeiconsIcon icon={Activity} size={16} className="w-3.5 h-3.5 text-primary" />
              <span>Real-Time VRAM & GPU Utilization</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Polling every 3000ms</span>
          </div>
          <GpuVramLineChart height={240} autoPoll pollIntervalMs={3000} />
        </div>

        {/* System Specs Table */}
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-5 shadow-xl space-y-2.5 text-xs">
          <div className="font-bold text-xs text-white flex items-center gap-2 pb-2 border-b border-white/[0.08]">
            <HugeiconsIcon icon={Terminal} size={16} className="w-3.5 h-3.5 text-primary" />
            <span>Environment Specs</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/[0.04]">
            <span className="text-zinc-400">FastAPI Version</span>
            <span className="font-mono text-white font-semibold">{value(systemStats.apiVersion)}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/[0.04]">
            <span className="text-zinc-400">Python Runtime</span>
            <span className="font-mono text-white font-semibold">{value(systemStats.pythonVersion)}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/[0.04]">
            <span className="text-zinc-400">PyTorch Build</span>
            <span className="font-mono text-white font-semibold">{value(systemStats.torchVersion)}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/[0.04]">
            <span className="text-zinc-400">Queue State</span>
            <span className="font-mono text-primary font-semibold">{systemStats.queueRunning} running / {systemStats.queuePending} pending</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-zinc-400">Host Endpoint</span>
            <span className="font-mono text-zinc-300">{systemStats.host}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
