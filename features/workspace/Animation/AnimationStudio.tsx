'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  BookOpen,
  Sliders,
  Sparkles,
  Layers,
  Film,
  Edit3,
  GitBranch,
  FolderOpen,
  X,
  Box,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MOTION_FAST } from '@/lib/motion';
import { useAnimationStore, AnimationStudioMode } from '@/stores/useAnimationStore';
import { useWorkspace } from '../store/WorkspaceContext';
import { AnimationLeftPanel } from './AnimationLeftPanel';
import { AnimationViewportStage } from './AnimationViewportStage';
import { AnimationRightInspector } from './AnimationRightInspector';
import { MotionLibraryDrawer } from './MotionLibraryDrawer';
import { toast } from 'sonner';

export const AnimationStudio: React.FC = () => {
  const { navigateToTool } = useWorkspace();
  const {
    activeMode,
    setActiveMode,
    ardyModel,
    setArdyModel,
    isMotionLibraryOpen,
    setIsMotionLibraryOpen,
    setMotionAiPrompt,
  } = useAnimationStore();

  const [mobilePanel, setMobilePanel] = useState<'none' | 'left' | 'right'>('none');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [presetsDropdownOpen, setPresetsDropdownOpen] = useState(false);

  // Available Presets
  const presets = [
    { label: 'Walk Forward & Jump', prompt: 'A character walks forward with confident strides, pauses, then jumps high and lands cleanly.' },
    { label: 'Athletic Run Cycle', prompt: 'A character performs a dynamic athletic sprint forward with natural arm swings.' },
    { label: 'Combat Ready Idle', prompt: 'A warrior in a grounded combat stance shifts weight smoothly, breathing steadily.' },
    { label: 'Friendly Wave & Greet', prompt: 'A character stops in place, smiles, raises right hand and waves enthusiastically.' },
    { label: 'Sneak & Turn Corner', prompt: 'A character sneaks slowly, checking left and right, then turns 90 degrees around a corner.' },
  ];

  const handleSelectPreset = (p: typeof presets[0]) => {
    setMotionAiPrompt(p.prompt);
    setPresetsDropdownOpen(false);
    toast.success(`Preset loaded: "${p.label}"`);
  };

  const modePills = [
    { id: 'text_to_motion', label: 'Text to Motion' },
    { id: 'editing', label: 'Motion Editing' },
    { id: 'retarget', label: 'Retarget / Apply' },
    { id: 'library', label: 'Motion Library' },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-0))] text-zinc-200 overflow-hidden select-none">
      {/* 1. TOP HEADER (Matching design system) */}
      <div className="flex-shrink-0 h-14 bg-[hsl(var(--surface-0))]/80 backdrop-blur-md border-b border-white/[0.08] px-4 flex items-center justify-between z-20 shadow-xs">
        {/* Left: Branding & Page Title + Subtitle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToTool('model')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Back to 3D Generation"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <span>Animation</span>
            </h1>
            <p className="text-[11px] text-zinc-400 font-normal">
              Create realistic character animations with ARDY
            </p>
          </div>
        </div>

        {/* Right: Model Selector + Presets + Docs */}
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <div className="relative">
            <div className="flex items-center gap-2 bg-[hsl(var(--surface-1))] border border-white/[0.08] px-3 py-1.5 rounded-xl text-xs shadow-xs">
              <span className="text-zinc-400 font-medium">Model</span>
              <button
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 font-semibold text-zinc-100 hover:text-white cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                <span>ARDY (NVIDIA)</span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>

            {modelDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-xl shadow-2xl p-1.5 z-30 space-y-1">
                <button
                  onClick={() => {
                    setArdyModel('ardy_motion_generation');
                    setModelDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs bg-primary/10 text-primary font-semibold"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>ARDY (NVIDIA)</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono">Active</span>
                </button>
                <div className="px-2.5 py-1 text-[10px] text-zinc-400 border-t border-white/[0.08] pt-1">
                  GPU: 8GB VRAM • FP16 CUDA
                </div>
              </div>
            )}
          </div>

          {/* Presets Dropdown */}
          <div className="relative">
            <button
              onClick={() => setPresetsDropdownOpen(!presetsDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer shadow-xs"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-400" />
              <span>Presets</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {presetsDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-xl shadow-2xl p-1.5 z-30 space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  ARDY Motion Presets
                </div>
                {presets.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectPreset(p)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/[0.06] transition-colors cursor-pointer text-zinc-200"
                  >
                    <p className="font-semibold text-white">{p.label}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{p.prompt}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Docs Button */}
          <button
            onClick={() => {
              window.open('https://github.com/nv-tlabs/ardy', '_blank');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer shadow-xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>Docs</span>
          </button>
        </div>
      </div>

      {/* 2. MODE SWITCHER PILLS */}
      <div className="flex-shrink-0 h-11 bg-[hsl(var(--surface-0))]/90 border-b border-white/[0.08] px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {modePills.map((mode) => {
            const isActive =
              activeMode === mode.id ||
              (mode.id === 'text_to_motion' && (activeMode === 'animate' || activeMode === 'motion_ai'));
            return (
              <button
                key={mode.id}
                onClick={() => {
                  if (mode.id === 'library') {
                    setIsMotionLibraryOpen(true);
                  } else {
                    setActiveMode(mode.id as AnimationStudioMode);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-primary text-black font-bold shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Mobile Panel Toggles (< 1024px) */}
        <div className="flex items-center gap-1 lg:hidden">
          <button
            onClick={() => setMobilePanel(mobilePanel === 'left' ? 'none' : 'left')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              mobilePanel === 'left' ? 'bg-primary text-black font-bold' : 'bg-[hsl(var(--surface-2))] text-zinc-200'
            }`}
          >
            Generation
          </button>
          <button
            onClick={() => setMobilePanel(mobilePanel === 'right' ? 'none' : 'right')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              mobilePanel === 'right' ? 'bg-primary text-black font-bold' : 'bg-[hsl(var(--surface-2))] text-zinc-200'
            }`}
          >
            Inspector
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE BODY */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {/* Left Generation Panel (Desktop) */}
        <div className="hidden lg:block w-[320px] xl:w-[360px] h-full flex-shrink-0 border-r border-white/[0.08] bg-[hsl(var(--surface-1))] z-10 overflow-hidden">
          <AnimationLeftPanel />
        </div>

        {/* Center Viewport & Compact Timeline Stage */}
        <div className="flex-1 h-full flex flex-col min-w-0 bg-[hsl(var(--surface-0))] relative overflow-hidden">
          <AnimationViewportStage />
        </div>

        {/* Right ARDY Inspector Panel (Desktop) */}
        <div className="hidden lg:block w-[320px] xl:w-[360px] h-full flex-shrink-0 border-l border-white/[0.08] bg-[hsl(var(--surface-1))] z-10 overflow-hidden">
          <AnimationRightInspector />
        </div>

        {/* Mobile Slide-over Sheets */}
        <AnimatePresence>
          {mobilePanel === 'left' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={MOTION_FAST}
              className="lg:hidden absolute inset-y-0 left-0 w-80 max-w-[85vw] z-30 bg-[hsl(var(--surface-1))] border-r border-white/[0.12] shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-[hsl(var(--surface-0))]">
                <span className="font-bold text-xs text-white">Motion Generation</span>
                <button
                  onClick={() => setMobilePanel('none')}
                  className="p-1 rounded text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AnimationLeftPanel />
              </div>
            </motion.div>
          )}

          {mobilePanel === 'right' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={MOTION_FAST}
              className="lg:hidden absolute inset-y-0 right-0 w-80 max-w-[85vw] z-30 bg-[hsl(var(--surface-1))] border-l border-white/[0.12] shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-[hsl(var(--surface-0))]">
                <span className="font-bold text-xs text-white">ARDY Inspector</span>
                <button
                  onClick={() => setMobilePanel('none')}
                  className="p-1 rounded text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AnimationRightInspector />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Motion Library Drawer */}
      <MotionLibraryDrawer />
    </div>
  );
};
