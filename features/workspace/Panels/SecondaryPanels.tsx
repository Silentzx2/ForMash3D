import React from 'react';
import { ToolType } from '../types';


import { HugeiconsIcon } from '@hugeicons/react';
import { HexagonIcon, LayersIcon, MaximizeIcon, PaletteIcon } from '@hugeicons/core-free-icons';
export const SecondaryPanel: React.FC<{ tool: ToolType }> = ({ tool }) => {
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
