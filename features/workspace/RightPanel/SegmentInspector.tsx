import React, { useMemo, useState } from 'react';
import { CheckCircle2, Layers, Sparkles, ArrowRight, Boxes, Download } from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';

interface SegmentPart {
  id: string;
  name: string;
  color: string;
  faces: number;
}

const PART_COLORS = ['#F9CF00', '#22C55E', '#3B82F6', '#EF4444', '#A855F7', '#14B8A6', '#F97316', '#EC4899'];

export const SegmentInspector: React.FC = () => {
  const { currentAsset, activeTask, navigateToTool } = useWorkspace();
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  const segmentationInfo = (currentAsset?.meshDetails?.segmentation_info ||
    (currentAsset?.meshDetails as any)?.segmentationInfo) as any;
  const partSizes = (segmentationInfo?.part_statistics?.part_sizes ||
    segmentationInfo?.part_statistics?.partSizes) as Record<string, number> | undefined;

  const parts = useMemo<SegmentPart[]>(() => {
    if (!partSizes || typeof partSizes !== 'object') return [];
    return Object.entries(partSizes)
      .map(([label, faces], index) => ({
        id: String(label),
        name: 'Part ' + label,
        color: PART_COLORS[index % PART_COLORS.length],
        faces: Number(faces) || 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [partSizes]);

  const selectedPart = parts.find((part) => part.id === selectedPartId) || parts[0];
  const isSegmentRunning = activeTask?.type === 'segment' &&
    (activeTask.status === 'running' || activeTask.status === 'queued');
  const totalFaces = parts.reduce((sum, part) => sum + part.faces, 0);

  return (
    <div id="inspector-segment" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none p-3 space-y-3.5">
      <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className={'w-4 h-4 ' + (parts.length > 0 ? 'text-emerald-400' : 'text-zinc-500')} />
            <span className="text-xs font-bold text-white">Segmentation Result</span>
          </div>
          <span className={'px-2 py-0.5 rounded-full text-[10px] font-bold border ' + (
            isSegmentRunning
              ? 'bg-primary/10 text-primary border-primary/30'
              : parts.length > 0
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
          )}>
            {isSegmentRunning ? 'Processing' : parts.length > 0 ? 'Completed' : 'No result'}
          </span>
        </div>

        {parts.length > 0 ? (
          <>
            <div className="text-[10px] text-zinc-400">
              <span className="font-bold text-white">{parts.length} parts detected</span>
              <span className="mx-1.5">•</span>
              <span>{totalFaces.toLocaleString()} faces across reported parts</span>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto scrollbar-thin pr-1">
              {parts.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  onClick={() => setSelectedPartId(part.id)}
                  className={'w-full p-1.5 rounded-lg flex items-center justify-between gap-2 text-left text-xs transition-all cursor-pointer ' +
                    (selectedPart?.id === part.id ? 'bg-[hsl(var(--surface-2))] border border-white/[0.12]' : 'hover:bg-white/[0.03]')}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: part.color }} />
                    <span className="truncate text-[11px] font-medium text-zinc-200">{part.name}</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0">{part.faces.toLocaleString()} faces</span>
                </button>
              ))}
            </div>
            {currentAsset?.id && (
              <a
                href={'/api/v1/system/jobs/' + encodeURIComponent(currentAsset.id) + '/download?artifact_format=glb'}
                className="w-full py-2 px-3 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-colors"
                download
              >
                <Download className="w-3.5 h-3.5 text-primary" />
                <span>Download Segmented GLB</span>
              </a>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center">
            <Layers className="w-6 h-6 mx-auto text-zinc-600 mb-2" />
            <div className="text-[11px] font-semibold text-zinc-300">No segmentation result loaded</div>
            <div className="text-[9.5px] text-zinc-500 mt-1">Run Segmentation on the current mesh to populate backend-reported part statistics.</div>
            <button
              type="button"
              onClick={() => navigateToTool('segment')}
              className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-black text-[10px] font-bold cursor-pointer"
            >
              Open Segmentation
            </button>
          </div>
        )}
      </div>

      {selectedPart && (
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-white">Selected Part</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-[hsl(var(--surface-2))] p-2">
              <div className="text-zinc-500">Part</div>
              <div className="font-mono text-white font-bold">{selectedPart.name}</div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--surface-2))] p-2">
              <div className="text-zinc-500">Faces</div>
              <div className="font-mono text-white font-bold">{selectedPart.faces.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--surface-2))] p-2 col-span-2">
              <div className="text-zinc-500">Geometry metadata</div>
              <div className="font-mono text-zinc-300">Vertex count, volume, and bounds are shown only when the backend reports them.</div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => navigateToTool('uv')}
          className="w-full py-2.5 px-3 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span>Unwrap Selected Parts (UV)</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
        </button>
        <button
          type="button"
          onClick={() => navigateToTool('animation')}
          className="w-full py-2.5 px-3 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <Boxes className="w-3.5 h-3.5 text-primary" />
          <span>Use in Auto-Rigging</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>
    </div>
  );
};