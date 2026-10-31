import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { Skeleton } from '@/components/ui/skeleton';
import { ModelAsset } from '../types';

import { HugeiconsIcon } from '@hugeicons/react';
import { Box, BrushCleaningIcon, Cancel, CheckIcon, Database01Icon, FolderOpenIcon, GripVerticalIcon, HardDriveIcon, LoaderCircle, RefreshCw, ShieldCheckIcon, SparklesIcon, Trash2, TriangleAlertIcon } from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

interface SortableAssetCardProps {
  asset: ModelAsset;
  onSelect: (asset: ModelAsset) => void;
}

const SortableAssetCard: React.FC<SortableAssetCardProps> = ({ asset, onSelect }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: asset.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.7 : 1,
  };

  // Determine if asset is rigged
  const isRigged = Boolean(asset.artifacts?.rigged);

  // Determine printability status if available
  const printabilityStatus = asset.qaStatus ?? undefined;

  // Determine if asset is production ready (simplified check)
  const isProductionReady = asset.postprocessStatus === 'completed' && 
                            (asset.qaStatus === 'pass' || asset.qaStatus === undefined);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-1))] text-left hover:border-primary/60 hover:bg-[hsl(var(--surface-2))] transition-all flex flex-col shadow-lg select-none"
    >
      <div 
        {...attributes} 
        {...listeners} 
        className="absolute top-2 left-2 z-10 p-1 rounded-md bg-black/60 backdrop-blur-md text-zinc-400 hover:text-white cursor-grab active:cursor-grabbing border border-white/[0.1] opacity-0 group-hover:opacity-100 transition-opacity"
        title="Drag to reorder"
      >
        <HugeiconsIcon icon={GripVerticalIcon} size={16} className="w-3.5 h-3.5" />
      </div>

      <button 
        onClick={() => onSelect(asset)}
        className="w-full text-left cursor-pointer flex flex-col flex-1"
      >
        <div className="aspect-square w-full bg-[hsl(var(--surface-0))] relative flex items-center justify-center overflow-hidden">
          {asset.thumbnail ? (
            <img 
              src={asset.thumbnail} 
              alt={asset.name} 
              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" 
              crossOrigin="anonymous" 
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <HugeiconsIcon icon={Box} size={16} className="h-8 w-8 text-primary" />
            </div>
          )}
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[9px] font-mono font-bold text-primary border border-white/[0.1]">
            {asset.format}
          </span>
        </div>
        <div className="p-3 space-y-2 w-full">
          <div className="truncate text-xs font-bold text-white group-hover:text-primary transition-colors">
            {asset.name}
          </div>
          {/* Model/Intent Info */}
          {asset.artifacts?.source || asset.source?.promptId ? (
            <div className="text-[9px] text-zinc-400 truncate">
              {asset.artifacts?.source ?? 
               asset.source?.promptId ?? 
               'Unknown Source'}
            </div>
          ) : null}
          {/* Vertex/Face Counts */}
          {asset.statsAvailable ? (
            <div className="flex items-center justify-between text-[9px] text-zinc-400">
              <span>{asset.vertices.toLocaleString()} vertices</span>
              <span>{asset.faces.toLocaleString()} faces</span>
            </div>
          ) : (
            <div className="text-[9px] text-zinc-400">
              Vertices: —, Faces: —
            </div>
          )}
          {/* Status Indicators */}
          <div className="flex items-center justify-between text-[8px]">
            <div className="flex items-center gap-1">
              {/* Post-process Status */}
              <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded 
                ${asset.postprocessStatus === 'completed' 
                  ? 'bg-emerald-500/20 text-emerald-300' 
                  : asset.postprocessStatus === 'failed' 
                    ? 'bg-rose-500/20 text-rose-300' 
                    : 'bg-gray-500/20 text-gray-400'}`}>
                {asset.postprocessStatus ?? 'processing'}
              </div>
              {/* Rigged Status */}
              {isRigged && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                  Rigged
                </div>
              )}
              {/* Printability Status */}
              {printabilityStatus !== undefined && (
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded 
                  ${printabilityStatus === 'pass' 
                    ? 'bg-emerald-500/20 text-emerald-300' 
                    : printabilityStatus === 'warn' 
                      ? 'bg-yellow-500/20 text-yellow-300' 
                      : 'bg-rose-500/20 text-rose-300'}`}>
                  {printabilityStatus ?? 'unknown'}
                </div>
              )}
            </div>
            {/* Production Ready Indicator */}
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded 
              ${isProductionReady 
                ? 'bg-emerald-500/20 text-emerald-300' 
                : 'bg-gray-500/20 text-gray-400'}`}>
                {isProductionReady ? 'Ready' : 'Not Ready'}
              </div>
          </div>
        </div>
      </button>
    </div>
  );
};

export const OutputsPage: React.FC = () => {
  const { assets, isAssetsLoading, setMainNav, setCurrentAsset, setActiveTool } = useWorkspace();
  const [items, setItems] = useState<ModelAsset[]>([]);

  // Storage breakdown & cleanup state
  const [storageData, setStorageData] = useState<any>(null);
  const [isStorageLoading, setIsStorageLoading] = useState(false);
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);

  const loadStorage = React.useCallback(async () => {
    setIsStorageLoading(true);
    try {
      const res = await getApiClient().getStorageBreakdown();
      if (res?.success) {
        setStorageData(res.data);
      }
    } catch {
      // ignore
    } finally {
      setIsStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  const handleRunCleanup = async () => {
    setIsCleaning(true);
    setCleanupStatus(null);
    try {
      const res = await getApiClient().cleanupStorage(cleanupDays, false);
      if (res?.success) {
        setCleanupStatus(res.message);
        await loadStorage();
      }
    } catch (e: any) {
      setCleanupStatus(e.message || 'Cleanup failed.');
    } finally {
      setIsCleaning(false);
    }
  };

  useEffect(() => {
    setItems(assets);
  }, [assets]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id);
        const newIndex = prev.findIndex((item) => item.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  return (
    <div id="outputs-page-view" className="flex-1 w-full h-full overflow-y-auto bg-[hsl(var(--surface-0))] select-none text-xs">
      <div className="max-w-6xl mx-auto w-full p-6 lg:p-8 space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
              Outputs & Asset History
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              Real-time generated 3D meshes, quad-remeshed topology, and PBR texture outputs.
            </p>
          </div>
          <button
            onClick={() => {
              setActiveTool('model');
              setMainNav('workspace');
            }}
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-primary/20 active:scale-95 transition-all cursor-pointer"
          >
            <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 fill-current stroke-current" />
            <span>New Generation</span>
          </button>
        </div>

        {/* Storage Breakdown & Cleanup Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-4 sm:p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-primary/15 text-primary border border-primary/25">
                <HugeiconsIcon icon={HardDriveIcon} size={18} className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Storage Usage Breakdown</span>
                  {storageData && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-black/40 text-primary border border-white/[0.08]">
                      {storageData.total_mb >= 1024 ? `${storageData.total_gb} GB` : `${storageData.total_mb} MB`}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400">
                  Real filesystem disk usage across master meshes, LODs, textures, and temp caches.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadStorage}
                disabled={isStorageLoading}
                className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh storage stats"
              >
                <HugeiconsIcon icon={RefreshCw} size={14} className={`w-3.5 h-3.5 ${isStorageLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => { setIsCleanupOpen(true); setCleanupStatus(null); }}
                className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-zinc-200 hover:text-white font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <HugeiconsIcon icon={BrushCleaningIcon} size={14} className="w-3.5 h-3.5 text-primary" />
                <span>Clean Up Intermediate Files</span>
              </button>
            </div>
          </div>

          {/* Progress Share Bar */}
          {storageData?.categories && (
            <div className="space-y-3">
              <div className="h-2.5 w-full bg-black/40 rounded-full overflow-hidden flex">
                <div style={{ width: `${storageData.categories.master?.percent || 0}%` }} className="bg-blue-500 h-full" title={`Master: ${storageData.categories.master?.percent || 0}%`} />
                <div style={{ width: `${storageData.categories.game_ready?.percent || 0}%` }} className="bg-emerald-500 h-full" title={`Game-Ready: ${storageData.categories.game_ready?.percent || 0}%`} />
                <div style={{ width: `${storageData.categories.textures?.percent || 0}%` }} className="bg-amber-500 h-full" title={`Textures: ${storageData.categories.textures?.percent || 0}%`} />
                <div style={{ width: `${storageData.categories.lods?.percent || 0}%` }} className="bg-purple-500 h-full" title={`LODs: ${storageData.categories.lods?.percent || 0}%`} />
                <div style={{ width: `${storageData.categories.rigging?.percent || 0}%` }} className="bg-cyan-500 h-full" title={`Rigging: ${storageData.categories.rigging?.percent || 0}%`} />
                <div style={{ width: `${storageData.categories.temp?.percent || 0}%` }} className="bg-zinc-500 h-full" title={`Temp: ${storageData.categories.temp?.percent || 0}%`} />
              </div>

              {/* Categorized Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {[
                  { id: 'master', label: 'Master Lineage', color: 'bg-blue-500', data: storageData.categories.master },
                  { id: 'game_ready', label: 'Game-Ready', color: 'bg-emerald-500', data: storageData.categories.game_ready },
                  { id: 'textures', label: 'PBR Textures', color: 'bg-amber-500', data: storageData.categories.textures },
                  { id: 'lods', label: 'LOD Meshes', color: 'bg-purple-500', data: storageData.categories.lods },
                  { id: 'rigging', label: 'Rigging / Skeletons', color: 'bg-cyan-500', data: storageData.categories.rigging },
                  { id: 'temp', label: 'Temp / Scratch', color: 'bg-zinc-500', data: storageData.categories.temp },
                ].map(cat => (
                  <div key={cat.id} className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] flex flex-col justify-between">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                      <span className="text-[10px] font-bold text-zinc-300 truncate">{cat.label}</span>
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className="text-xs font-bold text-white">{formatBytes(cat.data?.bytes || 0)}</span>
                      <span className="text-[9px] text-zinc-400">{cat.data?.percent || 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cleanup Dialog / Confirmation Overlay */}
          {isCleanupOpen && (
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                  <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4 flex-shrink-0" />
                  <span>Clean Up Obsolete Intermediate Files</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCleanupOpen(false)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel} size={14} className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-black/40 p-2.5 rounded-lg border border-emerald-500/20">
                <HugeiconsIcon icon={ShieldCheckIcon} size={16} className="w-4 h-4 flex-shrink-0" />
                <span>
                  <strong>Safety Guarantee:</strong> Source master models (<code className="font-mono text-white">source.glb</code>) and active asset lineage are strictly protected and will never be deleted.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 text-xs">Delete temp outputs older than:</span>
                  <select
                    value={cleanupDays}
                    onChange={e => setCleanupDays(Number(e.target.value))}
                    className="px-2.5 py-1 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.15] text-xs text-white outline-none cursor-pointer"
                  >
                    <option value={1} className="bg-[hsl(var(--surface-1))]">1 Day</option>
                    <option value={7} className="bg-[hsl(var(--surface-1))]">7 Days</option>
                    <option value={14} className="bg-[hsl(var(--surface-1))]">14 Days</option>
                    <option value={30} className="bg-[hsl(var(--surface-1))]">30 Days</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCleanupOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRunCleanup}
                    disabled={isCleaning}
                    className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isCleaning ? (
                      <>
                        <HugeiconsIcon icon={LoaderCircle} size={14} className="w-3.5 h-3.5 animate-spin" />
                        <span>Cleaning…</span>
                      </>
                    ) : (
                      <>
                        <HugeiconsIcon icon={Trash2} size={14} className="w-3.5 h-3.5" />
                        <span>Confirm Cleanup</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {cleanupStatus && (
                <div className="p-2 rounded-lg bg-black/50 text-[11px] text-zinc-300 font-mono">
                  {cleanupStatus}
                </div>
              )}
            </div>
          )}
        </div>

        {isAssetsLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-3 space-y-3">
                <Skeleton className="aspect-square w-full rounded-lg bg-[hsl(var(--surface-2))]" />
                <Skeleton className="h-3 w-3/4 rounded bg-[hsl(var(--surface-2))]" />
                <div className="flex justify-between">
                  <Skeleton className="h-2.5 w-1/3 rounded bg-[hsl(var(--surface-2))]" />
                  <Skeleton className="h-2.5 w-1/4 rounded bg-[hsl(var(--surface-2))]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] p-12 text-center shadow-xl space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center mx-auto text-zinc-400">
              <HugeiconsIcon icon={FolderOpenIcon} size={16} className="h-6 w-6" />
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {items.map((asset) => (
                  <SortableAssetCard
                    key={asset.id}
                    asset={asset}
                    onSelect={(selected) => {
                      setCurrentAsset(selected);
                      setMainNav('workspace');
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};