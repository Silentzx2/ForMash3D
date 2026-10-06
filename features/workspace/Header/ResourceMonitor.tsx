'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { GaugeIcon, RamMemoryIcon, CpuIcon, GpuIcon, SparklesIcon, ChevronDown, ChevronUp } from '@hugeicons/core-free-icons';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

interface SystemResourceStats {
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  gpu_percent: number; // kept for backward compatibility (primary GPU load %)
  vram_used_gb: number; // kept for backward compatibility (primary GPU used GB)
  vram_total_gb: number; // kept for backward compatibility (primary GPU total GB)
  vram_percent: number; // kept for backward compatibility (primary GPU utilization %)
  gpu_name?: string; // kept for backward compatibility (primary GPU name)
  gpu_temp_c?: number; // kept for backward compatibility (primary GPU temp)
  timestamp: string;
  // New fields for multiple GPUs
  gpus?: Array<{
    id: number;
    name: string;
    memory_total_mb: number;
    memory_used_mb: number;
    memory_util: number; // 0-1
    load: number; // 0-1
    temperature?: number;
  }>;
  total_vram_used_gb?: number;
  total_vram_total_gb?: number;
  avg_vram_percent?: number;
}

export const ResourceMonitor: React.FC = () => {
  const [stats, setStats] = useState<SystemResourceStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/v1/system/stats', {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const getColor = (percent: number) => {
    if (percent >= 90) return 'text-rose-400';
    if (percent >= 75) return 'text-amber-400';
    if (percent >= 50) return 'text-yellow-400';
    return 'text-emerald-400';
  };

  const getBgColor = (percent: number) => {
    if (percent >= 90) return 'bg-rose-500/20 border-rose-500/30';
    if (percent >= 75) return 'bg-amber-500/20 border-amber-500/30';
    if (percent >= 50) return 'bg-yellow-500/20 border-yellow-500/30';
    return 'bg-emerald-500/20 border-emerald-500/30';
  };

  const formatPercent = (val: number) => `${Math.round(val)}%`;
  const formatGB = (used: number, total: number) => `${used.toFixed(1)}/${total.toFixed(1)} GB`;

  if (!stats) {
    return (
      <SimpleTooltip label="System Resources" side="bottom">
        <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] text-zinc-400">
          <HugeiconsIcon icon={GaugeIcon} size={16} className="w-3 h-3" />
          <span className="font-mono text-[10px]">Loading...</span>
        </div>
      </SimpleTooltip>
    );
  }

  // Determine VRAM percentage to display in collapsed view: use average if available, else fallback to primary GPU
  const vramPercentToShow = stats.avg_vram_percent !== undefined ? stats.avg_vram_percent : stats.vram_percent;

  return (
    <div className="relative">
      {/* Collapsed View - always visible in header */}
      <SimpleTooltip label="System Resources • Click to expand" side="bottom">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="group flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:bg-[hsl(var(--surface-2))] hover:border-primary/30 transition-all cursor-pointer"
          aria-label={isExpanded ? 'Collapse resource monitor' : 'Expand resource monitor'}
          aria-expanded={isExpanded}
        >
          <HugeiconsIcon icon={GaugeIcon} size={16} className="w-3 h-3 text-primary" />
          
          {/* VRAM - most critical for 3D work (showing average across GPUs if available) */}
          <div className="flex items-center gap-0.5">
            <HugeiconsIcon icon={GpuIcon} size={12} className={`w-2.5 h-2.5 ${getColor(vramPercentToShow)}`} />
            <span className={`font-mono text-[10px] font-bold ${getColor(vramPercentToShow)}`}>
              {formatPercent(vramPercentToShow)}
            </span>
          </div>
          
          {/* RAM */}
          <div className="flex items-center gap-0.5 ml-1">
            <HugeiconsIcon icon={RamMemoryIcon} size={12} className={`w-2.5 h-2.5 ${getColor(stats.ram_percent)}`} />
            <span className={`font-mono text-[10px] font-bold ${getColor(stats.ram_percent)}`}>
              {formatPercent(stats.ram_percent)}
            </span>
          </div>
          
          {/* CPU */}
          <div className="flex items-center gap-0.5 ml-1">
            <HugeiconsIcon icon={CpuIcon} size={12} className={`w-2.5 h-2.5 ${getColor(stats.cpu_percent)}`} />
            <span className={`font-mono text-[10px] font-bold ${getColor(stats.cpu_percent)}`}>
              {formatPercent(stats.cpu_percent)}
            </span>
          </div>
          
          <HugeiconsIcon 
            icon={isExpanded ? ChevronUp : ChevronDown} 
            size={14} 
            className={`w-3 h-3 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </button>
      </SimpleTooltip>

      {/* Expanded Panel */}
      {isExpanded && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsExpanded(false)}
            aria-hidden="true"
          />
          
          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed right-2 md:right-4 top-[48px] z-50 w-[280px] bg-[hsl(var(--surface-1))]/95 backdrop-blur-xl border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden"
            role="region"
            aria-label="System resource details"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 bg-[hsl(var(--surface-0))] border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold text-xs text-white">System Resources</span>
                {isLoading && (
                  <span className="text-[9px] text-zinc-400 animate-pulse">Updating...</span>
                )}
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))] transition-colors"
                aria-label="Close"
              >
                <HugeiconsIcon icon={ChevronDown} size={14} className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>

            {/* Content */}
            <div className="p-3 space-y-3">
              {/* VRAM - GPU Memory (show each GPU if multiple available) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon icon={GpuIcon} size={16} className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="font-semibold text-zinc-200 text-xs">VRAM (GPU Memory)</span>
                  </div>
                  <span className={`font-mono text-[11px] font-bold ${getColor(vramPercentToShow)}`}>
                    {formatPercent(vramPercentToShow)}
                  </span>
                </div>
                
                {stats.gpus && stats.gpus.length > 0 ? (
                  <>
                    {stats.gpus.map((gpu, index) => (
                      <div key={gpu.id} className="space-y-1 pt-2 border-t border-white/[0.06] first:pt-0 first:border-t-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <HugeiconsIcon icon={GpuIcon} size={14} className="w-2.5 h-2.5 text-cyan-300" />
                            <span className="font-semibold text-zinc-200 text-xs">GPU {gpu.id}: {gpu.name}</span>
                          </div>
                          <span className={`font-mono text-[10px] ${getColor(gpu.memory_util * 100)}`}>
                            {formatPercent(gpu.memory_util * 100)}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-[hsl(var(--surface-2))] rounded overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(gpu.memory_util * 100, 100)}%` }}
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                            className={`h-full rounded ${getBgColor(gpu.memory_util * 100).replace('bg-', 'bg-').replace('border-', '')}`}
                             style={{ background: `linear-gradient(90deg, ${getColor(gpu.memory_util * 100).replace('text-', '')} 0%, ${getColor(gpu.memory_util * 100).replace('text-', '')} 100%)` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-zinc-400">
                          <span>{formatGB(gpu.memory_used_mb / 1024, gpu.memory_total_mb / 1024)}</span>
                           {gpu.temperature && (
                             <span className="ml-2">Temp: {gpu.temperature}°C</span>
                           )}
                         </div>
                       </div>
                     ))}
                    {stats.gpus.length > 1 && (
                      <div className="pt-2 border-t border-white/[0.06]">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-200 text-xs">Total VRAM</span>
                          <span className={`font-mono text-[10px] font-bold ${getColor(stats.avg_vram_percent ?? 0)}`}>
                            {formatPercent(stats.avg_vram_percent ?? 0)}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[hsl(var(--surface-2))] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(stats.avg_vram_percent ?? 0, 100)}%` }}
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                            className={`h-full rounded-full ${getBgColor(stats.avg_vram_percent ?? 0).replace('bg-', 'bg-').replace('border-', '')}`}
                             style={{ background: `linear-gradient(90deg, ${getColor(stats.avg_vram_percent ?? 0).replace('text-', '')} 0%, ${getColor(stats.avg_vram_percent ?? 0).replace('text-', '')} 100%)` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-zinc-400">
                          <span>{formatGB(stats.total_vram_used_gb, stats.total_vram_total_gb)}</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  {/* Fallback to single GPU display (original behavior) */}
                   <div className="w-full h-1.5 bg-[hsl(var(--surface-2))] rounded-full overflow-hidden">
                     <motion.div
                       initial={{ width: 0 }}
                       animate={{ width: `${Math.min(stats.vram_percent, 100)}%` }}
                       transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                       className={`h-full rounded-full ${getBgColor(stats.vram_percent).replace('bg-', 'bg-').replace('border-', '')}`}
                       style={{ background: `linear-gradient(90deg, ${getColor(stats.vram_percent).replace('text-', '')} 0%, ${getColor(stats.vram_percent).replace('text-', '')} 100%)` }}
                     />
                   </div>
                   <div className="flex items-center justify-between text-[9px] text-zinc-400">
                     <span>{formatGB(stats.vram_used_gb, stats.vram_total_gb)}</span>
                     {stats.gpu_name && <span className="truncate max-w-[140px]">{stats.gpu_name}</span>}
                   </div>
                   {stats.gpu_temp_c && (
                     <div className="text-[9px] text-zinc-500">
                       GPU Temp: {stats.gpu_temp_c}°C
                     </div>
                   )}
                )}
                
                {stats.gpus && stats.gpus.length > 0 && stats.gpus[0].temperature !== undefined && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between text-[9px] text-zinc-400">
                      <span>GPU Temperatures</span>
                    </div>
                    <div className="space-y-1">
                      {stats.gpus.map((gpu, index) => (
                        <div key={gpu.id} className="flex items-center justify-between">
                          <span className="text-xs">GPU {gpu.id}: {gpu.name}</span>
                          <span className="font-mono text-[9px]">{gpu.temperature}°C</span>
                        </div>
                      ))}
                     </div>
                    </div>
                  )}
               </div>

              {/* RAM - System Memory */}
              <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon icon={RamMemoryIcon} size={16} className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold text-zinc-200 text-xs">RAM (System Memory)</span>
                  </div>
                  <span className={`font-mono text-[11px] font-bold ${getColor(stats.ram_percent)}`}>
                    {formatPercent(stats.ram_percent)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[hsl(var(--surface-2))] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(stats.ram_percent, 100)}%` }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                     style={{ background: `linear-gradient(90deg, ${getColor(stats.ram_percent).replace('text-', '')} 0%, ${getColor(stats.ram_percent).replace('text-', '')} 100%)` }}
                    className="h-full rounded-full"
                  />
                </div>
                <div className="flex items-center justify-between text-[9px] text-zinc-400">
                  <span>{formatGB(stats.ram_used_gb, stats.ram_total_gb)}</span>
                </div>
              </div>

              {/* CPU */}
              <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon icon={CpuIcon} size={16} className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold text-zinc-200 text-xs">CPU Usage</span>
                  </div>
                  <span className={`font-mono text-[11px] font-bold ${getColor(stats.cpu_percent)}`}>
                    {formatPercent(stats.cpu_percent)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[hsl(var(--surface-2))] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(stats.cpu_percent, 100)}%` }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                     style={{ background: `linear-gradient(90deg, ${getColor(stats.cpu_percent).replace('text-', '')} 0%, ${getColor(stats.cpu_percent).replace('text-', '')} 100%)` }}
                    className="h-full rounded-full"
                  />
                </div>
              </div>

              {/* Refresh / Last Updated */}
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[9px] text-zinc-500">
                <span>Updated: {new Date(stats.timestamp).toLocaleTimeString()}</span>
                <button
                  onClick={fetchStats}
                  disabled={isLoading}
                  className="flex items-center gap-1 text-primary hover:text-primary/70 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <HugeiconsIcon icon={SparklesIcon} size={12} className={`w-2.5 h-2.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {error && (
                <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[9px]">
                  Error: {error}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
export default ResourceMonitor;