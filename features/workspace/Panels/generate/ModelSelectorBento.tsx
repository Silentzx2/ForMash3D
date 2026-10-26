import React, { useRef, useState, useEffect } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  ChevronDown,
  SparklesIcon,
  TriangleAlertIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons';

export interface DiscoveredModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  supports_texture: boolean;
  supports: { texture_generation: boolean };
  shape_vram_mb: number;
  texture_vram_mb: number;
  capabilities?: Record<string, any>;
}

export interface ModelSelectorBentoProps {
  activeModelId: string;
  activeModelObj?: DiscoveredModel;
  providersList: DiscoveredModel[];
  onSelectModel: (modelId: string) => void;
  lowVram: boolean;
  onToggleLowVram: () => void;
  isPostprocessOff: boolean;
  generateTexture: boolean;
  onToggleGenerateTexture: () => void;
  textureAtlasSize: '1K' | '2K' | '4K' | '8K';
  onChangeTextureAtlasSize: (size: '1K' | '2K' | '4K' | '8K') => void;
  showTextureToggle?: boolean;
}

/** Canonical display labels for studio precision */
export function getModelDisplayName(id: string, defaultLabel?: string): string {
  if (id.startsWith('trellis2')) return 'TRELLIS 2 (4B)';
  if (id.startsWith('trellis_') || id === 'trellis') return 'TRELLIS (2B)';
  if (id.includes('hunyuan3d_shape_v21') || id === 'hunyuan3d_21') return 'Hunyuan3D 2.1';
  if (id.includes('hunyuan3d_dit_v2_mini_turbo')) return 'Hunyuan3D 2-mini Turbo';
  if (id.includes('unique3d')) return 'Unique3D';
  if (id.includes('triposg')) return 'TripoSG';
  return defaultLabel || id;
}

/** Canonical subtitle detailing architecture and VRAM requirements */
export function getModelSubtitle(id: string, vramMb?: number): string {
  const vramText = vramMb ? `${Math.round(vramMb / 1024)}GB VRAM` : '';
  if (id.startsWith('trellis2')) return `${vramText ? `${vramText} · ` : ''}4B Dense FlexiCubes`;
  if (id.startsWith('trellis_') || id === 'trellis') return `${vramText ? `${vramText} · ` : ''}2B Diffusion`;
  if (id.includes('hunyuan3d_shape_v21') || id === 'hunyuan3d_21') return `${vramText ? `${vramText} · ` : ''}3.3B Watertight Shape`;
  if (id.includes('hunyuan3d_dit_v2_mini_turbo')) return `${vramText ? `${vramText} · ` : ''}0.6B DiT Turbo`;
  if (id.includes('unique3d')) return `${vramText ? `${vramText} · ` : ''}Multi-View Diffusion`;
  if (id.includes('triposg')) return `${vramText ? `${vramText} · ` : ''}Fast Feed-Forward`;
  return vramText ? `${vramText} · Geometry Engine` : 'Generative 3D Model';
}

/** Fallback canonical models in case provider registry is loading */
const CANONICAL_FALLBACK_MODELS: DiscoveredModel[] = [
  {
    id: 'trellis2_image_to_raw_mesh',
    label: 'TRELLIS 2 (4B)',
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: 23552,
    supports_texture: false,
    supports: { texture_generation: false },
    shape_vram_mb: 14131,
    texture_vram_mb: 23552,
  },
  {
    id: 'trellis_image_to_textured_mesh',
    label: 'TRELLIS (2B)',
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: 11776,
    supports_texture: true,
    supports: { texture_generation: true },
    shape_vram_mb: 7065,
    texture_vram_mb: 11776,
  },
  {
    id: 'hunyuan3d_shape_v21_image_to_raw_mesh',
    label: 'Hunyuan3D 2.1',
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: 10240,
    supports_texture: false,
    supports: { texture_generation: false },
    shape_vram_mb: 6144,
    texture_vram_mb: 10240,
  },
  {
    id: 'unique3d_image_to_raw_mesh',
    label: 'Unique3D',
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: 10240,
    supports_texture: true,
    supports: { texture_generation: true },
    shape_vram_mb: 6144,
    texture_vram_mb: 10240,
  },
  {
    id: 'triposg_image_to_raw_mesh',
    label: 'TripoSG',
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: 8192,
    supports_texture: false,
    supports: { texture_generation: false },
    shape_vram_mb: 4915,
    texture_vram_mb: 8192,
  },
];

export const ModelSelectorBento: React.FC<ModelSelectorBentoProps> = React.memo(({
  activeModelId,
  activeModelObj,
  providersList,
  onSelectModel,
  lowVram,
  onToggleLowVram,
  isPostprocessOff,
  generateTexture,
  onToggleGenerateTexture,
  textureAtlasSize,
  onChangeTextureAtlasSize,
  showTextureToggle = true,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        const trigger = document.getElementById('btn-select-ai-model-bento');
        if (trigger && trigger.contains(target)) return;
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelDropdownOpen]);

  const effectiveModels = providersList.length > 0 ? providersList : CANONICAL_FALLBACK_MODELS;
  const currentModelId = activeModelObj?.id || activeModelId || effectiveModels[0]?.id || '';
  const currentDisplayName = getModelDisplayName(currentModelId, activeModelObj?.label);
  const currentSubtitle = getModelSubtitle(currentModelId, activeModelObj?.vram_required_mb);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] p-3 space-y-2.5 relative">
      {/* Header with Title and Mode Badge */}
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
          <HugeiconsIcon icon={SparklesIcon} size={15} className="text-[#F5C542]" />
          <span>AI 3D Engine</span>
        </span>
        <span
          className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full border font-bold ${
            isPostprocessOff
              ? 'text-zinc-400 bg-zinc-800/80 border-white/[0.08]'
              : generateTexture
              ? 'text-[#F5C542] bg-[#F5C542]/10 border-[#F5C542]/25'
              : 'text-zinc-300 bg-white/[0.06] border-white/[0.1]'
          }`}
        >
          {isPostprocessOff
            ? 'Raw Mesh (Fast)'
            : generateTexture
            ? `Textured (${textureAtlasSize})`
            : 'Raw Geometry'}
        </span>
      </div>

      {/* Model Trigger Button */}
      <button
        id="btn-select-ai-model-bento"
        type="button"
        onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#16171B] border border-white/[0.08] hover:border-[#F5C542]/30 transition-all text-left cursor-pointer shadow-sm group"
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-1">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              activeModelObj?.available || activeModelObj?.installed
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                : 'bg-zinc-500'
            }`}
          />
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-xs text-white truncate">
              {currentDisplayName}
            </span>
            <span className="text-[9.5px] text-zinc-400 truncate mt-0.5 font-mono">
              {currentSubtitle}
            </span>
          </div>
        </div>
        <HugeiconsIcon
          icon={ChevronDown}
          size={16}
          className={`text-zinc-400 shrink-0 transition-transform ${
            modelDropdownOpen ? 'rotate-180 text-[#F5C542]' : 'group-hover:text-white'
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {modelDropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute left-3 right-3 top-[76px] bg-[#16171B]/95 backdrop-blur-xl border border-white/[0.12] rounded-xl p-1.5 shadow-2xl z-50 space-y-1 max-h-64 overflow-y-auto overflow-x-hidden scrollbar-none"
        >
          <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06] text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">
            <span>Available AI 3D Models</span>
            <span className="font-mono text-[#F5C542] font-bold">{effectiveModels.length}</span>
          </div>
          {effectiveModels.map((m) => {
            const isSelected = m.id === currentModelId;
            const displayName = getModelDisplayName(m.id, m.label);
            const subtitle = getModelSubtitle(m.id, m.vram_required_mb);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelectModel(m.id);
                  setModelDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#F5C542] text-black font-black shadow-sm'
                    : 'text-zinc-200 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                <div className="flex flex-col min-w-0 pr-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isSelected
                          ? 'bg-black'
                          : m.available || m.installed
                          ? 'bg-emerald-400'
                          : 'bg-zinc-500'
                      }`}
                    />
                    <span className="text-xs font-bold truncate">{displayName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 pl-3.5">
                    <span
                      className={`text-[9.5px] font-mono ${
                        isSelected ? 'text-black/80 font-bold' : 'text-zinc-400'
                      }`}
                    >
                      {subtitle}
                    </span>
                    <span className={isSelected ? 'text-black/60' : 'text-zinc-600'}>•</span>
                    <span
                      className={`text-[8.5px] px-1.5 py-0.5 rounded font-semibold ${
                        isSelected
                          ? 'bg-black/20 text-black'
                          : m.supports_texture
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-zinc-500/15 text-zinc-400'
                      }`}
                    >
                      {m.supports_texture ? 'PBR Texture' : 'Raw Mesh'}
                    </span>
                    {!(m.available || m.installed) && (
                      <>
                        <span className={isSelected ? 'text-black/60' : 'text-zinc-600'}>•</span>
                        <span
                          className={`text-[8.5px] px-1.5 py-0.5 rounded font-semibold ${
                            isSelected ? 'bg-black/20 text-black' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {m.status === 'gpu_unavailable' ? 'CUDA Req' : 'Weights Missing'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <HugeiconsIcon
                    icon={CheckIcon}
                    size={16}
                    className="text-black shrink-0 stroke-[2.5]"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Prominent Low VRAM Mode Card (≤15GB Indicator mapped to low_vram) */}
      <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 flex items-center justify-between gap-2 transition-colors">
        <div className="flex flex-col min-w-0 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <HugeiconsIcon
              icon={ZapIcon}
              size={14}
              className={lowVram ? 'text-[#F5C542]' : 'text-zinc-500'}
            />
            <span className="text-[11px] font-bold text-white leading-tight">
              Low VRAM Mode (≤ 15GB)
            </span>
            <span
              className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border font-bold ${
                lowVram
                  ? 'border-[#F5C542]/40 bg-[#F5C542]/15 text-[#F5C542]'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400'
              }`}
            >
              {lowVram ? 'ON · ≤15GB' : 'OFF · 24GB'}
            </span>
          </div>
          <span className="text-[9px] text-zinc-400 mt-0.5 leading-snug">
            {lowVram
              ? 'Sequential offload enabled · Fits 12–16GB GPUs (RTX 3060/4060/T4)'
              : 'Full 24GB VRAM pipeline cached · Maximum generation throughput'}
          </span>
        </div>

        {/* iOS-Style Toggle Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={lowVram}
          aria-label="Toggle Low VRAM mode"
          onClick={onToggleLowVram}
          className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            lowVram ? 'bg-[#F5C542]' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform shadow-md ${
              lowVram ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-200'
            }`}
          />
        </button>
      </div>

      {/* Textured Generation Toggle & Atlas Selector */}
      {showTextureToggle && (
        <div className="space-y-2 pt-1 border-t border-white/[0.06]">
          <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0 pr-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-white leading-tight">
                  Textured Generation
                </span>
                {isPostprocessOff && (
                  <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                    BLOCKED
                  </span>
                )}
              </div>
              <span className="text-[9px] text-zinc-400">
                {isPostprocessOff
                  ? 'Bypassed (Post-Processing is OFF)'
                  : generateTexture
                  ? `${textureAtlasSize} PBR UV Atlas`
                  : 'Raw untextured geometry'}
              </span>
            </div>

            {/* iOS-Style Switch */}
            <button
              type="button"
              role="switch"
              disabled={isPostprocessOff}
              aria-checked={generateTexture}
              aria-label="Toggle textured generation"
              onClick={onToggleGenerateTexture}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                isPostprocessOff
                  ? 'bg-zinc-800 opacity-40 cursor-not-allowed'
                  : generateTexture
                  ? 'bg-[#F5C542] cursor-pointer'
                  : 'bg-zinc-700 cursor-pointer'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform shadow-md ${
                  isPostprocessOff
                    ? 'left-0.5 bg-zinc-600'
                    : generateTexture
                    ? 'left-4.5 bg-black'
                    : 'left-0.5 bg-zinc-200'
                }`}
              />
            </button>
          </div>

          {/* Atlas Resolution Preset Selector */}
          {!isPostprocessOff && generateTexture && (
            <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-bold text-zinc-300 uppercase tracking-wider">
                  UV Atlas Resolution
                </span>
                <span className="text-[10px] font-mono text-[#F5C542] font-bold">
                  {textureAtlasSize}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['1K', '2K', '4K', '8K'] as const).map((size) => {
                  const isSelected = textureAtlasSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onChangeTextureAtlasSize(size)}
                      className={`py-1 rounded-lg text-xs font-mono font-bold transition-all text-center cursor-pointer ${
                        isSelected
                          ? 'bg-[#F5C542] text-black font-black shadow-sm'
                          : 'bg-[#1D1F26] text-zinc-400 hover:text-white border border-white/[0.06]'
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {(textureAtlasSize === '4K' || textureAtlasSize === '8K') && (
                <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[9.5px] leading-relaxed">
                  <HugeiconsIcon icon={TriangleAlertIcon} size={13} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>High Resource:</strong> {textureAtlasSize} baking takes longer and requires &gt;16GB VRAM.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ModelSelectorBento.displayName = 'ModelSelectorBento';
