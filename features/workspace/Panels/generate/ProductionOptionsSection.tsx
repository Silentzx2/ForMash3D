import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  ChevronDown,
  LayersIcon,
  Settings2,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

export interface ProductionOptionsSectionProps {
  isPostprocessOff: boolean;
  onTogglePostprocess: () => void;
  intent?: string;
  onSelectPreset: (
    presetId: 'mobile' | 'game_ready' | 'cinematic' | 'animation' | '3d_print' | 'native' | 'game_ready_quad' | 'multi_variant'
  ) => void;
  smartPresets: Record<string, any>;
  targetPolycount: number;
  onChangeTargetPolycount: (count: number) => void;
  partCountRange?: '1' | '3-6' | '6-15' | '15+';
  onChangePartCountRange: (range: '1' | '3-6' | '6-15' | '15+') => void;
  enableAutoRig: boolean;
  onToggleAutoRig: () => void;
  autoRigMode?: 'full' | 'skeleton' | 'skin';
  onChangeAutoRigMode: (mode: 'full' | 'skeleton' | 'skin') => void;
  generatePBR: boolean;
  onTogglePBR: () => void;
  onOpenAdvanced: () => void;
  topologyMode?: 'triangle' | 'quad';
  quadTopology?: boolean;
  generateCollision?: boolean;
  formatPresetSummary: (preset: Record<string, any> | undefined) => string;
}

const POLYCOUNT_CHIPS = [
  { label: '5k', value: 5000 },
  { label: '20k', value: 20000 },
  { label: '50k', value: 50000 },
  { label: '100k', value: 100000 },
  { label: 'Raw', value: 0 },
] as const;

export const ProductionOptionsSection: React.FC<ProductionOptionsSectionProps> = React.memo(({
  isPostprocessOff,
  onTogglePostprocess,
  intent,
  onSelectPreset,
  smartPresets,
  targetPolycount,
  onChangeTargetPolycount,
  partCountRange = '1',
  onChangePartCountRange,
  enableAutoRig,
  onToggleAutoRig,
  autoRigMode = 'full',
  onChangeAutoRigMode,
  generatePBR,
  onTogglePBR,
  onOpenAdvanced,
  topologyMode = 'triangle',
  quadTopology = false,
  generateCollision = false,
  formatPresetSummary,
}) => {
  const isPartsActive = partCountRange !== '1' && Boolean(partCountRange);

  return (
    <div className="space-y-2.5">
      {/* Master Post-Processing Pipeline Card */}
      <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                !isPostprocessOff
                  ? 'bg-[#F5C542] shadow-[0_0_8px_#F5C542]'
                  : 'bg-zinc-600'
              }`}
            />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-white flex items-center gap-1.5 flex-wrap">
                <span>Production Pipeline</span>
                <span
                  className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border font-bold ${
                    !isPostprocessOff
                      ? 'bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {!isPostprocessOff ? 'ON · Full Pipeline' : 'OFF · Fast Raw Mesh'}
                </span>
              </div>
              <div className="text-[9px] text-zinc-400 truncate">
                {!isPostprocessOff
                  ? 'AutoRetopo, UV unwrap, PBR baking & decimation'
                  : 'Bypasses post-processing; outputs raw generated mesh instantly'}
              </div>
            </div>
          </div>

          {/* iOS-Style Master Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={!isPostprocessOff}
            aria-label="Toggle post-processing"
            onClick={onTogglePostprocess}
            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
              !isPostprocessOff ? 'bg-[#F5C542]' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                !isPostprocessOff ? 'left-4.5' : 'left-0.5 bg-zinc-200'
              }`}
            />
          </button>
        </div>

        {isPostprocessOff && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[8.5px] text-amber-300 flex items-center gap-1.5">
            <span className="font-bold">⚡ Fast Mode:</span>
            <span>Downstream production stages (retopo, texturing, rigging) are bypassed.</span>
          </div>
        )}
      </div>

      {/* Target Polycount Budget & Canonical Presets Card */}
      <div
        className={`rounded-xl border p-3 space-y-3 transition-all ${
          isPostprocessOff
            ? 'border-white/[0.04] bg-[#1D1F26] opacity-60'
            : 'border-white/[0.06] bg-[#1D1F26]'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
              <span>Target Polycount Budget</span>
              {isPostprocessOff && (
                <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                  BLOCKED
                </span>
              )}
            </div>
            <div className="text-[9px] text-zinc-400">
              {isPostprocessOff
                ? 'Decimation and topology optimization are blocked'
                : 'Target triangle density allocated for output asset'}
            </div>
          </div>
          <span className="font-mono text-xs font-black text-[#F5C542]">
            {isPostprocessOff
              ? 'Raw Geometry'
              : targetPolycount <= 0
              ? 'Native / Raw'
              : `${targetPolycount.toLocaleString()} tris`}
          </span>
        </div>

        {/* Segmented Chips for Target Polycount Budget: 5k, 20k, 50k, 100k, Raw */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
            <span>Budget Presets</span>
            <span className="text-[8.5px] font-mono text-zinc-500">Segmented Chips</span>
          </div>
          <div className="grid grid-cols-5 gap-1 bg-[#16171B] p-1 rounded-xl border border-white/[0.06]">
            {POLYCOUNT_CHIPS.map((chip) => {
              const isSelected =
                !isPostprocessOff &&
                (chip.value === 0 ? targetPolycount <= 0 : targetPolycount === chip.value);
              return (
                <button
                  key={chip.label}
                  type="button"
                  disabled={isPostprocessOff}
                  onClick={() => onChangeTargetPolycount(chip.value)}
                  className={`py-1.5 rounded-lg text-center font-mono text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#F5C542] text-black font-black shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Canonical Output Presets */}
        <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
          <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
            Production Recipes
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { id: 'mobile', label: 'Mobile' },
              { id: 'game_ready', label: 'Game Ready' },
              { id: 'game_ready_quad', label: 'Game Ready (Quad)' },
              { id: 'cinematic', label: 'Cinematic' },
              { id: 'animation', label: 'Animation' },
              { id: '3d_print', label: '3D Print' },
              { id: 'multi_variant', label: 'Multi-Variant' },
              { id: 'native', label: 'Native' },
            ].map(({ id, label }) => {
              const presetData = smartPresets[id];
              const desc = id === 'native' ? 'Raw geometry' : formatPresetSummary(presetData);
              const isSelected =
                id === 'native'
                  ? isPostprocessOff || (targetPolycount <= 0 && !intent)
                  : intent === id;

              return (
                <button
                  key={id}
                  type="button"
                  disabled={isPostprocessOff && id !== 'native'}
                  onClick={() => onSelectPreset(id as any)}
                  className={`min-h-11 rounded-lg border text-left px-2 py-1.5 transition-all flex flex-col justify-between ${
                    isPostprocessOff && id !== 'native'
                      ? 'opacity-40 cursor-not-allowed bg-[#16171B] border-white/[0.04] text-zinc-600'
                      : isSelected
                      ? 'bg-[#F5C542] text-black border-[#F5C542] font-bold shadow-sm cursor-pointer'
                      : 'bg-[#16171B] border-white/[0.06] text-zinc-300 hover:border-[#F5C542]/30 hover:text-white cursor-pointer'
                  }`}
                >
                  <span className="block text-[10px] font-black leading-tight truncate">
                    {label}
                  </span>
                  <span
                    className={`block text-[7.5px] mt-0.5 leading-tight ${
                      isSelected ? 'text-black/80 font-bold' : 'text-zinc-500'
                    }`}
                  >
                    {desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fine-Tune Slider */}
        <div className="space-y-1 pt-1 border-t border-white/[0.06]">
          <div className="flex items-center justify-between text-[9px] text-zinc-400">
            <span>Fine-tune triangle budget</span>
            <span className="font-mono text-zinc-300">
              {isPostprocessOff ? 'Blocked' : '5K - 200K'}
            </span>
          </div>
          <input
            aria-label="Production polycount slider"
            type="range"
            disabled={isPostprocessOff}
            min={5000}
            max={200000}
            step={5000}
            value={targetPolycount > 0 ? targetPolycount : 50000}
            onChange={(e) => onChangeTargetPolycount(parseInt(e.target.value, 10))}
            className={`w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] ${
              isPostprocessOff ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
            }`}
          />
        </div>
      </div>

      {/* Production Options Bento: Generate in Parts, PBR, Auto-Rig */}
      <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] p-3 space-y-2.5">
        <div className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider flex items-center justify-between">
          <span>Asset Production Pipeline</span>
          <span className="text-[8.5px] font-mono text-zinc-500">ForMash3D Stages</span>
        </div>

        {/* 1. Generate in Parts (part_count_range) */}
        <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0 pr-1">
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={LayersIcon} size={14} className="text-[#F5C542]" />
                <span className="text-[11px] font-bold text-white leading-tight">
                  Generate in Parts
                </span>
                <span
                  className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border font-bold ${
                    isPartsActive && !isPostprocessOff
                      ? 'bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {isPartsActive && !isPostprocessOff ? `${partCountRange} Parts` : 'Single'}
                </span>
              </div>
              <span className="text-[9px] text-zinc-400 mt-0.5">
                Subdivides into functional semantic parts for animation or printing
              </span>
            </div>

            {/* iOS-Style Toggle Switch */}
            <button
              type="button"
              role="switch"
              disabled={isPostprocessOff}
              aria-checked={isPartsActive}
              aria-label="Toggle generate in parts"
              onClick={() => {
                if (isPostprocessOff) return;
                const next = isPartsActive ? '1' : '3-6';
                onChangePartCountRange(next);
              }}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                isPostprocessOff
                  ? 'bg-zinc-800 opacity-40 cursor-not-allowed'
                  : isPartsActive
                  ? 'bg-[#F5C542] cursor-pointer'
                  : 'bg-zinc-700 cursor-pointer'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                  isPostprocessOff
                    ? 'left-0.5 bg-zinc-600'
                    : isPartsActive
                    ? 'left-4.5'
                    : 'left-0.5 bg-zinc-200'
                }`}
              />
            </button>
          </div>

          {/* Segmented Chips for Part Count: 1, 3-6, 6-15, 15+ */}
          <div className="grid grid-cols-4 gap-1.5 pt-0.5">
            {[
              { value: '1', label: '1', sub: 'Single' },
              { value: '3-6', label: '3-6', sub: 'Parts' },
              { value: '6-15', label: '6-15', sub: 'Assembly' },
              { value: '15+', label: '15+', sub: 'Complex' },
            ].map(({ value, label, sub }) => {
              const isSel = (partCountRange || '1') === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={isPostprocessOff}
                  onClick={() => onChangePartCountRange(value as any)}
                  className={`py-1.5 rounded-lg text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                    isSel
                      ? 'bg-[#F5C542] text-black font-black shadow-sm'
                      : 'bg-[#1D1F26] text-zinc-400 hover:text-white border border-white/[0.06]'
                  } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <span className="text-[10px] font-mono font-bold leading-tight">{label}</span>
                  <span
                    className={`text-[7.5px] ${
                      isSel ? 'text-black/80 font-bold' : 'text-zinc-500'
                    }`}
                  >
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. PBR Texture Generation (Paint3D) */}
        <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon icon={SparklesIcon} size={14} className="text-[#F5C542]" />
              <span className="text-[11px] font-bold text-white leading-tight">
                PBR Texture Synthesis (Paint3D)
              </span>
              <span
                className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border font-bold ${
                  generatePBR && !isPostprocessOff
                    ? 'bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {generatePBR && !isPostprocessOff ? 'ON' : 'OFF'}
              </span>
            </div>
            <span className="text-[9px] text-zinc-400 mt-0.5">
              Bakes Albedo, Normal, Roughness &amp; Metallic maps via Paint3D
            </span>
          </div>

          <button
            type="button"
            role="switch"
            disabled={isPostprocessOff}
            aria-checked={generatePBR}
            aria-label="Toggle PBR texture generation"
            onClick={onTogglePBR}
            className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
              isPostprocessOff
                ? 'bg-zinc-800 opacity-40 cursor-not-allowed'
                : generatePBR
                ? 'bg-[#F5C542] cursor-pointer'
                : 'bg-zinc-700 cursor-pointer'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                isPostprocessOff
                  ? 'left-0.5 bg-zinc-600'
                  : generatePBR
                  ? 'left-4.5'
                  : 'left-0.5 bg-zinc-200'
              }`}
            />
          </button>
        </div>

        {/* 3. Auto-Rigging (UniRig) */}
        <div className="rounded-xl bg-[#16171B] border border-white/[0.06] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0 pr-1">
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={Box} size={14} className="text-[#F5C542]" />
                <span className="text-[11px] font-bold text-white leading-tight">
                  Auto-Rigging (UniRig)
                </span>
                <span
                  className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border font-bold ${
                    enableAutoRig && !isPostprocessOff
                      ? 'bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {enableAutoRig && !isPostprocessOff ? 'ON' : 'OFF'}
                </span>
              </div>
              <span className="text-[9px] text-zinc-400 mt-0.5">
                Binds skeleton bones and generates skinned weights for animation
              </span>
            </div>

            <button
              type="button"
              role="switch"
              disabled={isPostprocessOff}
              aria-checked={enableAutoRig}
              aria-label="Toggle auto rigging"
              onClick={onToggleAutoRig}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                isPostprocessOff
                  ? 'bg-zinc-800 opacity-40 cursor-not-allowed'
                  : enableAutoRig
                  ? 'bg-[#F5C542] cursor-pointer'
                  : 'bg-zinc-700 cursor-pointer'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                  isPostprocessOff
                    ? 'left-0.5 bg-zinc-600'
                    : enableAutoRig
                    ? 'left-4.5'
                    : 'left-0.5 bg-zinc-200'
                }`}
              />
            </button>
          </div>

          {enableAutoRig && !isPostprocessOff && (
            <div className="pt-1 border-t border-white/[0.06]">
              <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-1">
                <span>Rigging Mode</span>
                <span className="font-mono text-[#F5C542] font-bold uppercase">{autoRigMode}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['full', 'skeleton', 'skin'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeAutoRigMode(mode)}
                    className={`py-1 rounded text-[9px] font-bold uppercase transition-all cursor-pointer ${
                      autoRigMode === mode
                        ? 'bg-[#F5C542] text-black font-black shadow-sm'
                        : 'bg-[#1D1F26] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Drawer Trigger Bento */}
      <button
        type="button"
        onClick={onOpenAdvanced}
        className="w-full rounded-xl border border-white/[0.06] bg-[#1D1F26] hover:bg-[#242732] p-3 text-left transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-[#16171B] flex items-center justify-center text-[#F5C542] shrink-0">
              <HugeiconsIcon icon={Settings2} size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <span>Advanced Generation Settings</span>
                {isPostprocessOff && (
                  <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                    FAST MODE
                  </span>
                )}
              </div>
              <div className="text-[9px] text-zinc-400 truncate">
                {isPostprocessOff
                  ? 'Raw Source Geometry · Post-Processing Bypassed'
                  : `Seed, LODs, Slicer, ${
                      topologyMode === 'quad' || quadTopology ? 'Quads' : 'Triangles'
                    }, ${generateCollision ? 'Physics ON' : 'Physics OFF'}`}
              </div>
            </div>
          </div>
          <HugeiconsIcon
            icon={ChevronDown}
            size={16}
            className="text-zinc-400 group-hover:text-white transition-colors shrink-0"
          />
        </div>
      </button>
    </div>
  );
});

ProductionOptionsSection.displayName = 'ProductionOptionsSection';
