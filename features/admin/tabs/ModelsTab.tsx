"use client";

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  PackageIcon,
  Layers01Icon,
  CpuIcon,
  CheckmarkCircle02Icon,
  HardDriveIcon,
  RefreshCwIcon,
  Search01Icon,
  FilterIcon,
  InfoIcon,
  SlidersIcon,
  SparklesIcon,
  ExternalLinkIcon,
} from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { Badge } from '@/components/premium/Badge';
import { Spinner } from '@/components/premium/Spinner';
import { getApiClient } from '@/services/apiClient';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { CANONICAL_MODELS, ModelDefinition } from '@/constants/models';

export function ModelsTab() {
  const [models, setModels] = useState<ModelDefinition[]>(CANONICAL_MODELS);
  const [search, setSearch] = useState('');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [backendFeatures, setBackendFeatures] = useState<Record<string, string[]>>({});
  const [backendModelDetails, setBackendModelDetails] = useState<Record<string, any>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const client = getApiClient();
      const res = await client.getAvailableModels();
      if (res && res.available_models) {
        setBackendFeatures(res.available_models);
      }
      if ((res as any)?.model_details) {
        setBackendModelDetails((res as any).model_details);
      }
    } catch {
      // Backend status is optional, canonical catalog acts as source of truth
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const uniqueFeatures = Array.from(new Set(models.map(m => m.feature)));

  const filteredModels = models.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase());
    const matchesFeature = featureFilter === 'all' || m.feature === featureFilter;
    return matchesSearch && matchesFeature;
  });

  const totalVram = models.reduce((acc, m) => acc + m.vramMb, 0) / 1024;
  const readinessEntries = Object.values(backendModelDetails);
  const readyCount = readinessEntries.filter((m: any) => m.status === 'ready').length;
  const readinessLabel = readinessEntries.length
    ? `${readyCount}/${readinessEntries.length} ready`
    : 'Backend status unavailable';

  return (
    <div className="space-y-6">
      {/* Top Banner & Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Models</span>
             <HugeiconsIcon icon={PackageIcon} size={16} className="w-4 h-4 text-[hsl(var(--admin-accent))]" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-foreground">{models.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Configured in registry</p>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Capabilities</span>
             <HugeiconsIcon icon={Layers01Icon} size={16} className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-foreground">{uniqueFeatures.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">3D processing pipelines</p>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">VRAM Pool</span>
             <HugeiconsIcon icon={CpuIcon} size={16} className="w-4 h-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-foreground">{totalVram.toFixed(0)} GB</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Peak GPU allocation</p>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Status</span>
             <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{readinessLabel}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Runtime model readiness from backend manifest</p>
        </GlassCard>
      </div>

      {/* Filter and Search Bar */}
      <GlassCard className="p-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
             <HugeiconsIcon icon={Search01Icon} size={16} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search model by name, ID or keywords..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--admin-accent))]"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
             <HugeiconsIcon icon={FilterIcon} size={16} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <select
              value={featureFilter}
              onChange={(e) => setFeatureFilter(e.target.value)}
              className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] text-xs text-foreground focus:outline-none focus:border-[hsl(var(--admin-accent))] cursor-pointer"
            >
              <option value="all">All Capabilities</option>
              {uniqueFeatures.map(f => (
                <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Refresh Models"
            >
               <HugeiconsIcon icon={RefreshCwIcon} size={16} />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Models Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredModels.map((m, idx) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
          >
            <GlassCard hover className="p-4 space-y-3 h-full flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{m.name}</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                        Available
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{m.id}</div>
                  </div>
                  <Badge variant="default">{m.featureLabel}</Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {m.description}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-[hsl(var(--border)/0.5)] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">VRAM Requirement</span>
                  <span className="font-mono text-foreground font-semibold">{(m.vramMb / 1024).toFixed(1)} GB</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Inputs</span>
                  <div className="flex gap-1">
                    {m.supportedInputs.map(inp => (
                      <span key={inp} className="px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] font-mono text-[10px] text-foreground">
                        {inp}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Outputs</span>
                  <div className="flex gap-1">
                    {m.supportedOutputs.map(out => (
                      <span key={out} className="px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] font-mono text-[10px] text-foreground">
                        .{out}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Model Path</span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[200px]" title={m.modelPath}>
                    {m.modelPath}
                  </span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
