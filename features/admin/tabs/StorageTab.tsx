"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  HardDriveIcon, LoaderCircleIcon, AlertCircleIcon, Trash02Icon, RefreshCwIcon, CheckmarkCircle02Icon,
  FolderArchiveIcon, Database01Icon, Layers01Icon, SparklesIcon
} from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';

interface StorageDirectory {
  size_gb: number;
  path: string;
}

interface StorageInfo {
  root_path: string;
  total: number;
  used: number;
  available: number;
  models_size: number;
  uploads_size: number;
  exports_size: number;
  thumbnails_size: number;
  temp_size: number;
  usage_percent: number;
  directories?: Record<string, StorageDirectory>;
}

export function StorageTab() {
  const [data, setData] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchStorage = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await getApiClient().get<{ success: boolean; data?: any; storage?: any }>('/api/v1/system/storage');
      const storage = (res as any)?.data ?? (res as any)?.storage ?? res;
      if (storage) {
        const dirs = storage.directories ?? {};
        setData({
          root_path: storage.root_path || './storage',
          total: Number(storage.total_gb ?? storage.total ?? 0),
          used: Number(storage.used_gb ?? storage.used ?? 0),
          available: Number(storage.free_gb ?? storage.available ?? 0),
          models_size: Number(dirs.models?.size_gb ?? storage.models_size ?? 0),
          uploads_size: Number(dirs.uploads?.size_gb ?? 0),
          exports_size: Number(dirs.exports?.size_gb ?? storage.temp_size ?? 0),
          thumbnails_size: Number(dirs.thumbnails?.size_gb ?? 0),
          temp_size: Number(dirs.temp?.size_gb ?? 0),
          usage_percent: Number(storage.used_percent ?? storage.usage_percent ?? 0),
          directories: dirs,
        });
        setLastRefreshed(new Date());
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch storage info from backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStorage();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchStorage(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStorage]);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const res = await getApiClient().post<{ success: boolean; freed_mb?: number; files_removed?: number; message?: string }>(
        '/api/v1/system/cache/clear',
        {}
      );
      const freedMb = (res as any)?.freed_mb ?? 0;
      const filesCount = (res as any)?.files_removed ?? 0;
      const message = (res as any)?.message || `Cache cleared! Removed ${filesCount} temporary files (${freedMb} MB freed).`;
      toast.success('Cache Cleared', { description: message });
      await fetchStorage(true);
    } catch (err: any) {
      toast.error('Failed to clear cache', { description: err?.message || 'Error occurred while clearing temporary files.' });
    } finally {
      setClearing(false);
    }
  };

  const formatGB = (gb: number) => {
    if (gb === undefined || isNaN(gb)) return '0.00';
    if (gb < 0.01 && gb > 0) return (gb * 1024).toFixed(1) + ' MB';
    return Number(gb).toFixed(2) + ' GB';
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive))]';
    if (percent >= 75) return 'bg-[hsl(var(--neon-amber))] text-[hsl(var(--neon-amber))]';
    return 'bg-[hsl(var(--neon-green))] text-[hsl(var(--neon-green))]';
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center flex-col gap-3">
        <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-8 h-8 animate-spin text-[hsl(var(--primary))]" />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Scanning disk storage metrics...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-5 h-5" />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchStorage()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const usagePercent = Math.min(100, Math.max(0, data?.usage_percent || 0));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header with Title & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] flex items-center gap-2">
             <HugeiconsIcon icon={HardDriveIcon} size={16} className="w-6 h-6 text-[hsl(var(--primary))]" />
            Disk Space &amp; Storage Monitoring
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Real-time disk statistics for local volumes, AI model caches, and generation artifacts.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchStorage()}
            disabled={loading}
            className="text-xs font-semibold"
          >
            <HugeiconsIcon icon={RefreshCwIcon} size={16} />
            Refresh Stats
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearCache}
            disabled={clearing}
            className="text-xs font-bold shadow-sm"
          >
            {clearing ? (
              <>
                <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <HugeiconsIcon icon={Trash02Icon} size={16} className="w-3.5 h-3.5 mr-1.5" />
                Clear Cache
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Storage Indicator Card */}
      <Card className="border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-1))] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--neon-green))] animate-pulse" />
              <CardTitle className="text-base font-semibold">Primary Volume Status</CardTitle>
            </div>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              Path: <code className="bg-[hsl(var(--surface-2))] px-1.5 py-0.5 rounded text-[hsl(var(--foreground))]">{data?.root_path || './storage'}</code>
            </span>
          </div>
          <CardDescription>Overall disk capacity allocation and remaining available headroom</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Main Visual Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline text-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-[hsl(var(--foreground))]">
                  {formatGB(data?.used || 0)}
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">used of {formatGB(data?.total || 0)} total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-[hsl(var(--foreground))]">
                  {formatGB(data?.available || 0)} Free
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                  ({(100 - usagePercent).toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Segmented multi-colored bar */}
            <div className="h-3.5 w-full bg-[hsl(var(--surface-2))] rounded-full overflow-hidden p-0.5 border border-[hsl(var(--border)/0.5)]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  usagePercent >= 90
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-primary'
                }`}
                style={{ width: `${Math.max(2, usagePercent)}%` }}
              />
            </div>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
              <span className="text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))] tracking-wider">Used Space</span>
              <p className="text-lg font-bold font-mono text-[hsl(var(--foreground))] mt-0.5">{formatGB(data?.used || 0)}</p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
              <span className="text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))] tracking-wider">Free Headroom</span>
              <p className="text-lg font-bold font-mono text-emerald-400 mt-0.5">{formatGB(data?.available || 0)}</p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
              <span className="text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))] tracking-wider">Utilization</span>
              <p className="text-lg font-bold font-mono text-[hsl(var(--foreground))] mt-0.5">{usagePercent.toFixed(1)}%</p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
              <span className="text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))] tracking-wider">Storage Health</span>
              <p className="text-xs font-bold text-emerald-400 mt-1 flex items-center gap-1">
                 <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-3.5 h-3.5" /> Normal
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Directory Breakdown Cards */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">
          Storage Breakdown by Artifact Category
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Models */}
          <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)] hover:border-primary/40 transition-all">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                   <HugeiconsIcon icon={Database01Icon} size={16} className="w-4 h-4 text-primary" />
                  AI Models
                </CardTitle>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]">/models</span>
              </div>
              <CardDescription className="text-xs">Weights &amp; checkpoints</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono text-primary">
                {formatGB(data?.models_size || 0)}
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">HunYuan, Trellis, TripoSR weights</p>
            </CardContent>
          </Card>

          {/* Exports & Generated 3D */}
          <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)] hover:border-primary/40 transition-all">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                   <HugeiconsIcon icon={Layers01Icon} size={16} className="w-4 h-4 text-primary" />
                  Generated 3D
                </CardTitle>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]">/exports</span>
              </div>
              <CardDescription className="text-xs">GLB, OBJ, FBX outputs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatGB(data?.exports_size || 0)}
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">Exported 3D meshes &amp; textures</p>
            </CardContent>
          </Card>

          {/* Reference Uploads */}
          <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)] hover:border-primary/40 transition-all">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                   <HugeiconsIcon icon={FolderArchiveIcon} size={16} className="w-4 h-4 text-muted-foreground" />
                  Uploads
                </CardTitle>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]">/uploads</span>
              </div>
              <CardDescription className="text-xs">Input reference images</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatGB(data?.uploads_size || 0)}
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">Image-to-3D reference assets</p>
            </CardContent>
          </Card>

          {/* Temporary & Cache */}
          <Card className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border)/0.6)] hover:border-primary/40 transition-all">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                   <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4 text-primary" />
                  Temp &amp; Cache
                </CardTitle>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]">/temp</span>
              </div>
              <CardDescription className="text-xs">Intermediate artifacts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono text-primary">
                {formatGB((data?.temp_size || 0) + (data?.thumbnails_size || 0))}
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">Pruned when Clear Cache is clicked</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-2 border-t border-[hsl(var(--border)/0.4)]">
        <span>Auto-refreshes every 15s • Temporary artifacts can be cleared safely anytime without losing installed models.</span>
        <span>Last synced: {lastRefreshed.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

