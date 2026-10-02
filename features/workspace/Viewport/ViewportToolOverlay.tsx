'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, CameraIcon, CheckIcon, GridIcon, LayersIcon, Maximize02Icon, MoveIcon, RotateCcwIcon } from '@hugeicons/core-free-icons';
export const ViewportToolOverlay: React.FC = () => {
  const {
    activeTool,
    currentAsset,
    shadingMode,
    setShadingMode,
    showWireframe,
    setShowWireframe,
    navigateToTool,
  } = useWorkspace();

  // Bottom gallery tab states
  const [uvGalleryTab, setUvGalleryTab] = useState<'Preview' | 'Part View' | 'Island View' | '3D / UV Split'>('Preview');
  const [segmentGalleryTab, setSegmentGalleryTab] = useState<'Preview' | 'Part Hierarchy' | 'Statistics' | 'Logs'>('Preview');
  const [segmentIsolatedPart, setSegmentIsolatedPart] = useState('Head');
  const [cameraPreset, setCameraPreset] = useState<'Perspective' | 'Front' | 'Side' | 'Top'>('Perspective');

  if (activeTool !== 'uv' && activeTool !== 'segment' && activeTool !== 'edit') {
    return null;
  }

  const handleUseResultChaining = (targetTool: any) => {
    toast.success(`Asset chained to ${targetTool} workflow`);
    navigateToTool(targetTool);
  };

  return (
    <div id="viewport-tool-overlay" className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-4 overflow-hidden">
      {/* TOP HEADER CONTROLS */}
      <div className="flex items-start justify-between w-full">
        {/* Top Left: CameraIcon Pills or Stats */}
        <div className="pointer-events-auto flex items-center gap-2">
          {activeTool === 'uv' ? (
            /* UV stats card overlay */
            <div className="px-3 py-2 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.08] text-[11px] font-mono space-y-1 shadow-xl">
              <div className="flex gap-4 justify-between"><span className="text-zinc-400">Vertices</span><span className="text-white font-bold">{currentAsset?.vertices?.toLocaleString() || '125,432'}</span></div>
              <div className="flex gap-4 justify-between"><span className="text-zinc-400">Faces</span><span className="text-white font-bold">{currentAsset?.faces?.toLocaleString() || '248,864'}</span></div>
              <div className="flex gap-4 justify-between"><span className="text-zinc-400">Materials</span><span className="text-white font-bold">8</span></div>
              <div className="flex gap-4 justify-between"><span className="text-zinc-400">Size</span><span className="text-white font-bold">{currentAsset?.fileSize || '12.4 MB'}</span></div>
              <div className="flex gap-4 justify-between"><span className="text-zinc-400">Format</span><span className="text-primary font-bold">{currentAsset?.format || 'GLB'}</span></div>
            </div>
          ) : (
            /* Perspective / Front / Side / Top Pills for Segment and Edit */
            <div className="flex gap-1 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md rounded-xl border border-white/[0.08] shadow-xl">
              {(['Perspective', 'Front', 'Side', 'Top'] as const).map((cam) => (
                <button
                  key={cam}
                  type="button"
                  onClick={() => {
                    setCameraPreset(cam);
                    toast.info(`CameraIcon aligned to ${cam}`);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    cameraPreset === cam
                      ? 'bg-primary text-black font-extrabold shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {cam}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top Right: Shading / Material / Wireframe Pills */}
        <div className="pointer-events-auto flex items-center gap-1.5 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md rounded-xl border border-white/[0.08] shadow-xl text-xs">
          <button
            type="button"
            onClick={() => {
              setShadingMode('clay');
              setShowWireframe(false);
            }}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
              shadingMode === 'clay' && !showWireframe
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            Solid
          </button>
          <button
            type="button"
            onClick={() => setShowWireframe(!showWireframe)}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
              showWireframe
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            Wireframe
          </button>
          <button
            type="button"
            onClick={() => {
              setShadingMode('textured');
              setShowWireframe(false);
            }}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
              shadingMode === 'textured' && !showWireframe
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            Material
          </button>
        </div>
      </div>

      {/* FLOATING VERTICAL TOOLBARS (Left for Edit) */}
      {activeTool === 'edit' && (
        <div className="pointer-events-auto absolute left-4 top-20 flex flex-col gap-1 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md rounded-xl border border-white/[0.08] shadow-xl">
          <button type="button" title="Select Tool" className="p-2 rounded-lg bg-primary text-black shadow-sm cursor-pointer">
            <span className="text-xs font-bold">▲</span>
          </button>
          <button type="button" title="MoveIcon Manipulator" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer">
            <HugeiconsIcon icon={MoveIcon} size={16} className="w-4 h-4" />
          </button>
          <button type="button" title="Rotate Selection" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer">
            <HugeiconsIcon icon={RotateCcwIcon} size={16} className="w-4 h-4" />
          </button>
          <button type="button" title="Scale Selection" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer">
            <HugeiconsIcon icon={Maximize02Icon} size={16} className="w-4 h-4" />
          </button>
          <button type="button" title="Toggle GridIcon" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer">
            <HugeiconsIcon icon={GridIcon} size={16} className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* BOTTOM GALLERY & COMPARISON OVERLAYS */}
      <div className="pointer-events-auto flex flex-col items-center gap-2 w-full max-w-4xl mx-auto mb-1">
        {/* UV BOTTOM GALLERY */}
        {activeTool === 'uv' && (
          <div className="w-full bg-[hsl(var(--surface-1))]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-3 shadow-2xl space-y-2.5">
            {/* Gallery Tabs */}
            <div className="flex gap-1 border-b border-white/[0.06] pb-2">
              {(['Preview', 'Part View', 'Island View', '3D / UV Split'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setUvGalleryTab(tab)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    uvGalleryTab === tab
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 4 Preview Cards */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-zinc-500 group-hover:text-white">
                  <HugeiconsIcon icon={Box} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">Original Mesh</div>
                <div className="text-[9px] text-zinc-400 font-mono">248,864 faces</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-primary">
                  <HugeiconsIcon icon={LayersIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">Part Visualization</div>
                <div className="text-[9px] text-zinc-400 font-mono">8 parts</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-zinc-400 group-hover:text-white">
                  <HugeiconsIcon icon={GridIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">UV Checker</div>
                <div className="text-[9px] text-zinc-400 font-mono">2048 resolution</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-emerald-400">
                  <HugeiconsIcon icon={CheckIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">UV Wireframe</div>
                <div className="text-[9px] text-zinc-400 font-mono">Clean topology</div>
              </div>
            </div>
          </div>
        )}

        {/* MESH SEGMENTATION BOTTOM GALLERY */}
        {activeTool === 'segment' && (
          <div className="w-full bg-[hsl(var(--surface-1))]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-3 shadow-2xl space-y-2.5">
            {/* Gallery Tabs */}
            <div className="flex gap-1 border-b border-white/[0.06] pb-2">
              {(['Preview', 'Part Hierarchy', 'Statistics', 'Logs'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSegmentGalleryTab(tab)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    segmentGalleryTab === tab
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 4 Multi-angle Views and Part Isolation Card */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-zinc-400 group-hover:text-white">
                  <HugeiconsIcon icon={CameraIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">Front View</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-zinc-400 group-hover:text-white">
                  <HugeiconsIcon icon={CameraIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">Side View</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="h-16 rounded-lg bg-[hsl(var(--surface-2))] mb-1.5 flex items-center justify-center text-zinc-400 group-hover:text-white">
                  <HugeiconsIcon icon={CameraIcon} size={16} className="w-6 h-6" />
                </div>
                <div className="text-[11px] font-bold text-white">Back View</div>
              </div>

              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.06] hover:border-primary/50 transition-all cursor-pointer text-center group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-zinc-400 font-semibold">Part Isolation</span>
                  <select
                    value={segmentIsolatedPart}
                    onChange={(e) => setSegmentIsolatedPart(e.target.value)}
                    className="bg-[hsl(var(--surface-2))] text-white text-[10px] rounded px-1.5 py-0.5 border border-white/[0.1] focus:outline-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="Head">Head</option>
                    <option value="Torso">Torso</option>
                    <option value="Left Arm">Left Arm</option>
                    <option value="Right Arm">Right Arm</option>
                  </select>
                </div>
                <div className="h-12 rounded-lg bg-[hsl(var(--surface-2))] flex items-center justify-center text-emerald-400 font-bold text-xs">
                  {segmentIsolatedPart} Isolated
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ponytail: Removed static MESH EDIT COMPARISON BOTTOM CARD — hardcoded dummy data
           that permanently blocked the viewport bottom HUD (camera/shading/export).
           If a real comparison UI is needed later, render it conditionally after an edit completes. */}
      </div>
    </div>
  );
};
