import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { Skeleton } from '@/components/ui/skeleton';
import { ModelAsset } from '../types';

import { HugeiconsIcon } from '@hugeicons/react';
import { Box, FolderOpenIcon, GripVerticalIcon, SparklesIcon } from '@hugeicons/core-free-icons';
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