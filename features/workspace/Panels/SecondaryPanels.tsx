import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { ToolType } from '../types';


import { HugeiconsIcon } from '@hugeicons/react';
import { HexagonIcon, LayersIcon, MaximizeIcon, PaletteIcon } from '@hugeicons/core-free-icons';
export const SecondaryPanel: React.FC<{ tool: ToolType }> = ({ tool }) => {
  const {
    isExecuting,
    currentAsset,
    runRemeshGeneration,
    runSegmentation,
    remeshSettings,
    setRemeshSettings,
  } = useWorkspace();

  if (tool === 'segment') {
    return (
      <div id="panel-segment" className="flex flex-col h-full overflow-y-auto px-2.5 py-2.5 space-y-3 text-xs select-none bg-[hsl(var(--surface-1))]">
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Mesh Segmentation</span>
          <p className="text-[10px] text-zinc-400 font-medium">Decompose mesh into semantic functional sub-meshes for animation &amp; rigging.</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {['Auto Semantic Split', 'Joints & Limbs', 'Armor & Apparel', 'Loose Islands'].map((mode, i) => (
            <button
              key={mode}
              type="button"
              title={`${mode} segmentation`}
              className={`p-1.5 rounded-lg border text-left font-bold text-[10px] transition-all cursor-pointer ${
                i === 0
                  ? 'bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] border-transparent text-[#080808] shadow-md font-black'
                  : 'bg-[hsl(var(--surface-2))] border-white/[0.12] text-zinc-300 hover:text-white hover:border-white/[0.25]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">TargetIcon Mesh:</span>
            <span className="font-mono text-primary font-bold truncate max-w-[120px]">{currentAsset?.name || 'No asset selected'}</span>
          </div>
          <div className="text-[9px] text-zinc-500">PartField segmentation decomposes your mesh into functional parts.</div>
        </div>

        <button
          type="button"
          onClick={() => void runSegmentation()}
          disabled={isExecuting || (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl && !currentAsset?.source?.fileId)}
          className={`w-full h-10 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.35)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed btn-lighting-shine ${isExecuting ? 'is-executing' : ''}`}
        >
          <HugeiconsIcon icon={LayersIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
          <span>{isExecuting ? 'Segmenting...' : currentAsset ? 'RUN SEGMENTATION' : 'SELECT A MODEL'}</span>
        </button>
      </div>
    );
  }

  if (tool === 'remesh') {
    return (
      <div id="panel-remesh-secondary" className="flex flex-col h-full overflow-y-auto px-2.5 py-2.5 space-y-3 text-xs select-none bg-[hsl(var(--surface-1))]">
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">FastMesh Variant</span>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { label: 'V1K · ~1K vertices', variant: 'V1K' as const },
              { label: 'V4K · ~4K vertices', variant: 'V4K' as const },
            ]).map((q) => (
              <button
                key={q.variant}
                onClick={() => setRemeshSettings(prev => ({ ...prev, variant: q.variant }))}
                className={`p-1.5 rounded-lg border font-bold text-[10px] transition-all ${
                  remeshSettings.variant === q.variant
                    ? 'bg-primary text-[hsl(var(--primary-foreground))] border-transparent shadow-md font-black'
                    : 'bg-[hsl(var(--surface-2))] border-white/[0.12] text-zinc-300 hover:text-white hover:border-white/[0.25]'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">Current Topology:</span>
            <span className="font-mono text-primary font-bold">{currentAsset ? (currentAsset.statsAvailable ? `${currentAsset.topology} (${currentAsset.faces.toLocaleString()} faces)` : 'Geometry stats unavailable') : 'No asset selected'}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">Edge Loop Flow:</span>
            <span className="font-mono text-emerald-400 font-bold">Parameter-driven</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runRemeshGeneration()}
          disabled={isExecuting || !currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl}
          className={`w-full h-10 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.35)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed btn-lighting-shine ${isExecuting ? 'is-executing' : ''}`}
        >
          <HugeiconsIcon icon={HexagonIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
          <span>{isExecuting ? 'Remeshing...' : currentAsset ? 'EXECUTE QUAD RETOPO' : 'SELECT A MODEL'}</span>
        </button>
      </div>
    );
  }

  if (tool === 'edit') {
    return (
      <div id="panel-edit" className="flex flex-col h-full overflow-y-auto px-2.5 py-2.5 space-y-3 text-xs select-none bg-[hsl(var(--surface-1))]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Sculpt Brushes</span>
        <div className="grid grid-cols-2 gap-1.5">
          {['Grab / MoveIcon', 'Smooth', 'Inflate', 'Pinch', 'Flatten', 'Clay Strips'].map((brush) => (
            <button key={brush} type="button" disabled title="Sculpt backend is not implemented" className="p-1.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] text-zinc-400 font-bold text-[10px] text-left transition-all opacity-60 cursor-not-allowed">
              {brush}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (tool === 'upscale') {
    return (
      <div id="panel-upscale" className="flex flex-col h-full overflow-y-auto px-2.5 py-2.5 space-y-3 text-xs select-none bg-[hsl(var(--surface-1))]">
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Upscale Factor</span>
          <div className="grid grid-cols-3 gap-1.5">
            {['2X Super', '4X Ultra', '8K Production'].map((f) => (
              <button key={f} type="button" disabled title="3D upscale backend is not implemented" className="p-1.5 rounded-lg bg-[hsl(var(--surface-2))] opacity-60 cursor-not-allowed border border-white/[0.12] text-zinc-300 font-bold text-[10px] hover:text-primary hover:border-primary transition-all">
                {f}
              </button>
            ))}
          </div>
        </div>
        <button
          disabled={true}
          className="w-full h-10 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.12] text-zinc-400 font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <HugeiconsIcon icon={MaximizeIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
          <span>UPSCALE UNAVAILABLE</span>
        </button>
      </div>
    );
  }

  if (tool === 'pbr') {
    return (
      <div id="panel-pbr" className="flex flex-col h-full overflow-y-auto px-2.5 py-2.5 space-y-3 text-xs select-none bg-[hsl(var(--surface-1))]">
        <div className="p-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12]">
          <p className="text-zinc-300 leading-relaxed font-medium text-[10px]">Bake physically based rendering channels (Albedo, Normal, Roughness, Metallic, Height, AO) using 3D Generation Pipeline nodes.</p>
        </div>
        <button
          type="button"
          disabled
          title="Dedicated PBR baking backend is not implemented"
          className="w-full h-10 rounded-xl bg-zinc-800 text-zinc-400 font-extrabold text-xs flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <HugeiconsIcon icon={PaletteIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
          <span>PBR BAKING UNAVAILABLE</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full items-center justify-center px-2.5 py-2.5 text-xs select-none bg-[hsl(var(--surface-1))]">
      <div className="w-10 h-10 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] flex items-center justify-center text-zinc-400 mb-2">
        <HugeiconsIcon icon={LayersIcon} size={16} className="w-5 h-5 stroke-[2.2]" />
      </div>
      <p className="text-zinc-400 text-center font-medium text-[10px]">This tool is not available yet.</p>
    </div>
  );
};
