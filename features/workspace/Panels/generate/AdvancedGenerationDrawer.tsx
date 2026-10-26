import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CheckIcon,
  ChevronDown,
  ChevronUp,
  DiceIcon,
  LayersIcon,
  Settings2,
  SparklesIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import type { GenerationSettings, PhysicsSettings } from '../../types';
import { DEFAULT_PHYSICS_SETTINGS } from '../../utils/physicsSettings';

export const PHYSICS_MATERIAL_PRESETS = [
  { label: 'Default', friction: DEFAULT_PHYSICS_SETTINGS.friction, restitution: DEFAULT_PHYSICS_SETTINGS.restitution },
  { label: 'Rubber', friction: 0.8, restitution: 0.8 },
  { label: 'Stone', friction: 0.6, restitution: 0.1 },
  { label: 'Wood', friction: 0.4, restitution: 0.2 },
  { label: 'Ice', friction: 0.05, restitution: 0.05 },
  { label: 'Metal', friction: 0.3, restitution: 0.15 },
] as const;

export interface AdvancedGenerationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  generationSettings: GenerationSettings;
  setGenerationSettings: React.Dispatch<React.SetStateAction<GenerationSettings>>;
  isPostprocessOff: boolean;
}

export const AdvancedGenerationDrawer: React.FC<AdvancedGenerationDrawerProps> = React.memo(({
  isOpen,
  onClose,
  generationSettings,
  setGenerationSettings,
  isPostprocessOff,
}) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    seed: true,
    candidates: true,
    lod: true,
    slicer: true,
    topology: false,
    physics: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const physics = generationSettings.physics ?? DEFAULT_PHYSICS_SETTINGS;

  const updatePhysics = (updates: Partial<PhysicsSettings>) => {
    setGenerationSettings((prev) => {
      const current = prev.physics || physics;
      return {
        ...prev,
        physics: {
          ...current,
          ...updates,
        },
      };
    });
  };

  const handleRandomizeSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647) + 1;
    setGenerationSettings((prev) => ({ ...prev, seed: randomSeed }));
  };

  const handleResetSeed = () => {
    setGenerationSettings((prev) => ({ ...prev, seed: 0 }));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="absolute inset-0 z-40 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className="absolute inset-y-0 right-0 w-full max-w-[380px] bg-[#16171B] border-l border-white/[0.1] shadow-2xl flex flex-col pointer-events-auto"
          >
            {/* Header */}
            <div className="px-3.5 py-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <HugeiconsIcon icon={Settings2} size={16} className="text-[#F5C542] shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white">Advanced Generation Settings</div>
                  <div className="text-[9px] text-zinc-400 truncate">
                    Seed, Candidate Variations, LOD, Slicer &amp; Topology
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer transition-colors"
                aria-label="Close advanced settings"
              >
                <HugeiconsIcon icon={ChevronUp} size={16} />
              </button>
            </div>

            {/* Scrollable Accordion Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2.5 scrollbar-none">
              {/* 1. Accordion Item: Random Seed */}
              <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => toggleSection('seed')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon icon={SparklesIcon} size={14} className="text-[#F5C542] shrink-0" />
                    <span className="text-[11px] font-bold text-white">Random Seed</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-[#F5C542] font-bold px-1.5 py-0.5 rounded bg-[#F5C542]/10 border border-[#F5C542]/20">
                      {generationSettings.seed === 0 ? '0 (Random)' : `Fixed: ${generationSettings.seed}`}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.seed ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.seed && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.04]">
                    <p className="text-[9px] text-zinc-400 leading-tight">
                      Deterministic generation key. Set 0 for unique randomized results every run, or a specific integer to recreate variations.
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={generationSettings.seed ?? 0}
                        onChange={(e) => {
                          const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                          setGenerationSettings((prev) => ({ ...prev, seed: val }));
                        }}
                        placeholder="0 for random"
                        className="flex-1 rounded-lg bg-[#16171B] border border-white/[0.08] px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#F5C542]/60"
                      />
                      <button
                        type="button"
                        title="Roll random seed"
                        onClick={handleRandomizeSeed}
                        className="px-2.5 py-1.5 rounded-lg bg-[#16171B] hover:bg-[#242732] border border-white/[0.08] text-[#F5C542] hover:text-[#FFE066] transition-colors cursor-pointer flex items-center gap-1 shrink-0 text-[10px] font-bold"
                      >
                        <HugeiconsIcon icon={DiceIcon} size={14} />
                        <span>Roll</span>
                      </button>
                      {generationSettings.seed !== 0 && (
                        <button
                          type="button"
                          onClick={handleResetSeed}
                          className="px-2 py-1.5 rounded-lg bg-[#16171B] hover:bg-[#242732] border border-white/[0.08] text-[9.5px] font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          Reset (0)
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Accordion Item: Candidate Count (clamped 1-4 preview variants) */}
              <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => toggleSection('candidates')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon icon={LayersIcon} size={14} className="text-[#F5C542] shrink-0" />
                    <span className="text-[11px] font-bold text-white">Candidate Variations</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-[#F5C542] font-bold px-1.5 py-0.5 rounded bg-[#F5C542]/10 border border-[#F5C542]/20">
                      {Math.min(4, Math.max(1, generationSettings.candidateCount || 1))} Variant{Math.min(4, Math.max(1, generationSettings.candidateCount || 1)) > 1 ? 's' : ''}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.candidates ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.candidates && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.04]">
                    <p className="text-[9px] text-zinc-400 leading-tight">
                      Generate 1 to 4 preview variants in parallel by stepping random seeds. Compare candidates in viewport.
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { count: 1, label: '1', sub: 'Single' },
                        { count: 2, label: '2', sub: 'Pair' },
                        { count: 3, label: '3', sub: 'Trio' },
                        { count: 4, label: '4', sub: 'Quad' },
                      ].map(({ count, label, sub }) => {
                        const clamped = Math.min(4, Math.max(1, generationSettings.candidateCount || 1));
                        const isSel = clamped === count;
                        return (
                          <button
                            key={count}
                            type="button"
                            onClick={() =>
                              setGenerationSettings((prev) => ({
                                ...prev,
                                candidateCount: count,
                              }))
                            }
                            className={`py-1.5 rounded-lg text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                              isSel
                                ? 'bg-[#F5C542] text-black font-black shadow-sm'
                                : 'bg-[#16171B] text-zinc-400 hover:text-white border border-white/[0.06]'
                            }`}
                          >
                            <span className="text-[11px] font-mono font-bold leading-tight">{label}</span>
                            <span className={`text-[7.5px] ${isSel ? 'text-black/80 font-bold' : 'text-zinc-500'}`}>
                              {sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Accordion Item: LOD Chain (Level of Detail toggle) */}
              <div
                className={`rounded-xl border bg-[#1D1F26] overflow-hidden transition-all ${
                  isPostprocessOff ? 'border-white/[0.04] opacity-60' : 'border-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection('lod')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon
                      icon={LayersIcon}
                      size={14}
                      className={isPostprocessOff ? 'text-zinc-600' : 'text-[#F5C542]'}
                    />
                    <span className="text-[11px] font-bold text-white">LOD Chain (Level of Detail)</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                      {isPostprocessOff
                        ? 'Blocked'
                        : generationSettings.generateLOD !== false
                        ? `${generationSettings.lodCount || 4} Levels`
                        : 'Disabled'}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.lod ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.lod && (
                  <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.04]">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#16171B] border border-white/[0.06]">
                      <div className="pr-1">
                        <span className="text-[11px] font-semibold text-white block">
                          Generate LOD Hierarchy
                        </span>
                        <span className="text-[9px] text-zinc-400 block">
                          Hierarchical decimation levels for real-time engines
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        disabled={isPostprocessOff}
                        aria-checked={generationSettings.generateLOD !== false}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((p) => ({
                            ...p,
                            generateLOD: p.generateLOD === false ? true : false,
                          }));
                        }}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                          generationSettings.generateLOD !== false ? 'bg-[#F5C542]' : 'bg-zinc-700'
                        } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                            generationSettings.generateLOD !== false ? 'left-4.5' : 'left-0.5 bg-zinc-200'
                          }`}
                        />
                      </button>
                    </div>

                    {generationSettings.generateLOD !== false && !isPostprocessOff && (
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <label className="space-y-1">
                          <span className="text-[9px] font-semibold text-zinc-400">LOD Preset</span>
                          <select
                            value={generationSettings.lodPreset || 'high'}
                            onChange={(e) =>
                              setGenerationSettings((p) => ({
                                ...p,
                                lodPreset: e.target.value as any,
                              }))
                            }
                            className="w-full rounded-md bg-[#16171B] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200 cursor-pointer"
                          >
                            <option value="mobile">Mobile (aggressive)</option>
                            <option value="low">Low (lightweight)</option>
                            <option value="medium">Medium (balanced)</option>
                            <option value="high">High (standard)</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[9px] font-semibold text-zinc-400">LOD Count</span>
                          <select
                            value={generationSettings.lodCount || 4}
                            onChange={(e) =>
                              setGenerationSettings((p) => ({
                                ...p,
                                lodCount: Number(e.target.value),
                              }))
                            }
                            className="w-full rounded-md bg-[#16171B] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200 cursor-pointer"
                          >
                            <option value={2}>2 Levels (LOD0-1)</option>
                            <option value={3}>3 Levels (LOD0-2)</option>
                            <option value={4}>4 Levels (LOD0-3)</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Accordion Item: Slicer Handoff (3D print export format) */}
              <div
                className={`rounded-xl border bg-[#1D1F26] overflow-hidden transition-all ${
                  isPostprocessOff ? 'border-white/[0.04] opacity-60' : 'border-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection('slicer')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon
                      icon={Box}
                      size={14}
                      className={isPostprocessOff ? 'text-zinc-600' : 'text-[#F5C542]'}
                    />
                    <span className="text-[11px] font-bold text-white">Slicer Handoff &amp; Export Formats</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-[#F5C542] font-bold px-1.5 py-0.5 rounded bg-[#F5C542]/10 border border-[#F5C542]/20">
                      {generationSettings.slicerHandoff ? 'Slicer ON' : (generationSettings.exportFormats?.join(', ') || 'GLB')}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.slicer ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.slicer && (
                  <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.04]">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#16171B] border border-white/[0.06]">
                      <div className="pr-1">
                        <span className="text-[11px] font-semibold text-white block">Slicer Handoff</span>
                        <span className="text-[9px] text-zinc-400 block">
                          Direct export formats for 3D slicing (STL / 3MF)
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        disabled={isPostprocessOff}
                        aria-checked={Boolean(generationSettings.slicerHandoff)}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((p) => ({ ...p, slicerHandoff: !p.slicerHandoff }));
                        }}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                          generationSettings.slicerHandoff ? 'bg-[#F5C542]' : 'bg-zinc-700'
                        } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                            generationSettings.slicerHandoff ? 'left-4.5' : 'left-0.5 bg-zinc-200'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Multi-Format Export Chips */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[9px] text-zinc-400">
                        <span>Target Formats</span>
                        <span className="font-mono text-zinc-500 uppercase">Selected</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {(['glb', 'fbx', 'obj', 'stl', '3mf'] as const).map((fmt) => {
                          const isSel = (generationSettings.exportFormats || []).includes(fmt);
                          return (
                            <button
                              key={fmt}
                              type="button"
                              disabled={isPostprocessOff}
                              onClick={() => {
                                if (isPostprocessOff) return;
                                setGenerationSettings((prev) => {
                                  const cur = prev.exportFormats || [];
                                  const next = isSel ? cur.filter((f) => f !== fmt) : [...cur, fmt];
                                  return { ...prev, exportFormats: next };
                                });
                              }}
                              className={`py-1 rounded text-center transition-all cursor-pointer ${
                                isSel
                                  ? 'bg-[#F5C542] text-black font-black shadow-sm'
                                  : 'bg-[#16171B] text-zinc-400 hover:text-white border border-white/[0.06]'
                              } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                            >
                              <span className="text-[9.5px] font-mono font-bold leading-tight">
                                {fmt.toUpperCase()}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Skeleton Rig Archetype Selection */}
                    <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                      <div className="flex items-center justify-between text-[9px] text-zinc-400">
                        <span>Skeleton Rig Archetype</span>
                        <span className="font-mono text-[#F5C542] capitalize font-bold">
                          {generationSettings.rigType || 'none'}
                        </span>
                      </div>
                      <select
                        value={generationSettings.rigType || 'none'}
                        onChange={(e) =>
                          setGenerationSettings((prev) => ({
                            ...prev,
                            rigType: e.target.value as GenerationSettings['rigType'],
                          }))
                        }
                        disabled={isPostprocessOff}
                        className="w-full rounded-md bg-[#16171B] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200 cursor-pointer"
                      >
                        <option value="none">None</option>
                        <option value="generic">Generic</option>
                        <option value="humanoid">Humanoid</option>
                        <option value="quadruped">Quadruped</option>
                        <option value="bird">Bird</option>
                        <option value="insect">Insect</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Accordion Item: Topology & QA Gates (Concise) */}
              <div
                className={`rounded-xl border bg-[#1D1F26] overflow-hidden transition-all ${
                  isPostprocessOff ? 'border-white/[0.04] opacity-60' : 'border-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection('topology')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon
                      icon={Box}
                      size={14}
                      className={isPostprocessOff ? 'text-zinc-600' : 'text-[#F5C542]'}
                    />
                    <span className="text-[11px] font-bold text-white">Topology &amp; QA Gates</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                      {generationSettings.topologyMode === 'quad' || generationSettings.quadTopology ? 'Quads' : 'Triangles'}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.topology ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.topology && (
                  <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.04]">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={isPostprocessOff}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((prev) => ({
                            ...prev,
                            topologyMode: 'triangle',
                            quadTopology: false,
                          }));
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                          isPostprocessOff
                            ? 'bg-[#16171B] text-zinc-600 opacity-40 cursor-not-allowed'
                            : generationSettings.topologyMode !== 'quad' && !generationSettings.quadTopology
                            ? 'bg-[#F5C542] text-black font-black shadow-sm'
                            : 'bg-[#16171B] text-zinc-300 hover:text-white border border-white/[0.08]'
                        }`}
                      >
                        <span>▲ Triangles</span>
                      </button>

                      <button
                        type="button"
                        disabled={isPostprocessOff}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((prev) => ({
                            ...prev,
                            topologyMode: 'quad',
                            quadTopology: true,
                          }));
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                          isPostprocessOff
                            ? 'bg-[#16171B] text-zinc-600 opacity-40 cursor-not-allowed'
                            : generationSettings.topologyMode === 'quad' || generationSettings.quadTopology
                            ? 'bg-[#F5C542] text-black font-black shadow-sm'
                            : 'bg-[#16171B] text-zinc-300 hover:text-white border border-white/[0.08]'
                        }`}
                      >
                        <span>■ Quads</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#16171B] border border-white/[0.06]">
                      <div>
                        <span className="text-[11px] font-semibold text-white block">Bake Normal Maps</span>
                        <span className="text-[9px] text-zinc-400 block">
                          Bakes tangent-space normal maps from high-poly detail
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        disabled={isPostprocessOff}
                        aria-checked={Boolean(generationSettings.highResolutionNormalBaking ?? true)}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((p) => ({
                            ...p,
                            highResolutionNormalBaking:
                              p.highResolutionNormalBaking === false ? true : false,
                          }));
                        }}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                          (generationSettings.highResolutionNormalBaking ?? true)
                            ? 'bg-[#F5C542]'
                            : 'bg-zinc-700'
                        } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                            (generationSettings.highResolutionNormalBaking ?? true)
                              ? 'left-4.5'
                              : 'left-0.5 bg-zinc-200'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={isPostprocessOff}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((prev) => ({
                            ...prev,
                            enablePrintabilityCheck: !Boolean(prev.enablePrintabilityCheck),
                            enableAutoRepair: !Boolean(prev.enablePrintabilityCheck)
                              ? prev.enableAutoRepair
                              : false,
                          }));
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-left cursor-pointer transition-all ${
                          isPostprocessOff
                            ? 'border-white/[0.04] bg-[#16171B] text-zinc-600 opacity-40 cursor-not-allowed'
                            : generationSettings.enablePrintabilityCheck
                            ? 'border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]'
                            : 'border-white/[0.06] bg-[#16171B] text-zinc-400'
                        }`}
                      >
                        <span className="block text-[10px] font-bold">Printability QA</span>
                        <span className="block text-[8px] text-zinc-400">
                          {generationSettings.enablePrintabilityCheck ? 'Active Check' : 'Disabled'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isPostprocessOff || !generationSettings.enablePrintabilityCheck}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((prev) => ({
                            ...prev,
                            enableAutoRepair: !Boolean(prev.enableAutoRepair),
                          }));
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-left cursor-pointer transition-all ${
                          isPostprocessOff || !generationSettings.enablePrintabilityCheck
                            ? 'border-white/[0.04] bg-[#16171B] text-zinc-600 opacity-40 cursor-not-allowed'
                            : generationSettings.enableAutoRepair
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-white/[0.06] bg-[#16171B] text-zinc-400'
                        }`}
                      >
                        <span className="block text-[10px] font-bold">Auto-Repair</span>
                        <span className="block text-[8px] text-zinc-400">
                          {generationSettings.enableAutoRepair ? 'Repair holes' : 'No mutation'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 6. Accordion Item: Physics Preparation (Rapier3D) (Concise) */}
              <div
                className={`rounded-xl border bg-[#1D1F26] overflow-hidden transition-all ${
                  isPostprocessOff ? 'border-white/[0.04] opacity-60' : 'border-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection('physics')}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HugeiconsIcon
                      icon={ZapIcon}
                      size={14}
                      className={isPostprocessOff ? 'text-zinc-600' : 'text-[#F5C542]'}
                    />
                    <span className="text-[11px] font-bold text-white">Physics Preparation (Rapier3D)</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[8.5px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                      {generationSettings.generateCollision ? 'Active' : 'Disabled'}
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`text-zinc-400 transition-transform ${openSections.physics ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {openSections.physics && (
                  <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.04]">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#16171B] border border-white/[0.06]">
                      <div>
                        <span className="text-[11px] font-semibold text-white block">Physics Collision</span>
                        <span className="text-[9px] text-zinc-400 block">
                          Generates collision mesh &amp; Rapier3D body data
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        disabled={isPostprocessOff}
                        aria-checked={Boolean(generationSettings.generateCollision)}
                        onClick={() => {
                          if (isPostprocessOff) return;
                          setGenerationSettings((prev) => ({
                            ...prev,
                            generateCollision: !Boolean(prev.generateCollision),
                          }));
                        }}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                          generationSettings.generateCollision ? 'bg-[#F5C542]' : 'bg-zinc-700'
                        } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform shadow-md ${
                            generationSettings.generateCollision ? 'left-4.5' : 'left-0.5 bg-zinc-200'
                          }`}
                        />
                      </button>
                    </div>

                    {generationSettings.generateCollision && !isPostprocessOff && (
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-3 gap-1">
                          {PHYSICS_MATERIAL_PRESETS.map((preset) => {
                            const isActive =
                              Math.abs(Number(physics.friction) - preset.friction) < 0.01 &&
                              Math.abs(Number(physics.restitution) - preset.restitution) < 0.01;
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() =>
                                  updatePhysics({
                                    friction: preset.friction,
                                    restitution: preset.restitution,
                                  })
                                }
                                className={`px-2 py-1.5 rounded-md text-[9px] font-medium transition-colors border text-center cursor-pointer ${
                                  isActive
                                    ? 'bg-[#F5C542]/20 border-[#F5C542] text-[#F5C542] font-bold shadow-sm'
                                    : 'bg-[#16171B] border-white/[0.08] text-zinc-300 hover:bg-white/[0.06]'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {[
                            ['friction', 'Friction', 0, 2, 0.05],
                            ['restitution', 'Bounce', 0, 1, 0.05],
                          ].map(([key, label, min, max, step]) => (
                            <label key={String(key)} className="space-y-1">
                              <div className="flex justify-between text-[9px] text-zinc-400">
                                <span>{String(label)}</span>
                                <span className="font-mono text-[#F5C542]">
                                  {Number(physics[key as keyof PhysicsSettings]).toFixed(2)}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={Number(min)}
                                max={Number(max)}
                                step={Number(step)}
                                value={Number(physics[key as keyof PhysicsSettings])}
                                onChange={(e) =>
                                  updatePhysics({ [key]: Number(e.target.value) } as Partial<PhysicsSettings>)
                                }
                                className="w-full accent-[#F5C542]"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Sticky Drawer Action */}
            <div className="p-3 border-t border-white/[0.08] shrink-0 bg-[#16171B]">
              <button
                type="button"
                onClick={onClose}
                className="w-full h-10 rounded-full bg-[#F5C542] hover:bg-[#FFE066] text-black text-xs font-black tracking-wider active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-lg"
              >
                <HugeiconsIcon icon={CheckIcon} size={16} className="stroke-[2.5]" />
                <span>APPLY &amp; CLOSE</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

AdvancedGenerationDrawer.displayName = 'AdvancedGenerationDrawer';
