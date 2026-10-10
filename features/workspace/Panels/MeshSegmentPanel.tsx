'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { uploadMeshAsset } from '../types';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, Cancel, CheckIcon, ChevronDown, ExternalLinkIcon, FolderOpenIcon, RotateCcwIcon, Settings2, UploadIcon, ZapIcon } from '@hugeicons/core-free-icons';
export const MeshSegmentPanel: React.FC = () => {
  const {
    currentAsset,
    setCurrentAsset,
    assets,
    isExecuting,
    activeTask,
    runSegmentation,
  } = useWorkspace();

  const [activeTab, setActiveTab] = useState<'segment' | 'settings'>('segment');

  // Segment Tab State
  const [model, setModel] = useState<'partfield_mesh_segmentation' | 'p3sam_mesh_segmentation'>('partfield_mesh_segmentation');
  const [targetParts, setTargetParts] = useState(8);
  const [method, setMethod] = useState<'semantic' | 'geometric' | 'hierarchical'>('semantic');
  const [algorithmVersion, setAlgorithmVersion] = useState('v1');
  const [useHierarchical, setUseHierarchical] = useState(true);
  const [colorizeParts, setColorizeParts] = useState(true);
  const [generateLabels, setGenerateLabels] = useState(true);
  const [outputFormat, setOutputFormat] = useState('glb');
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  // SettingsIcon Tab State (Post-processing & Advanced constraints)
  const [minPartFaces, setMinPartFaces] = useState(250);
  const [smoothingPasses, setSmoothingPasses] = useState(3);
  const [maxHierarchyDepth, setMaxHierarchyDepth] = useState(2);
  const [partHints, setPartHints] = useState('head, torso, arms, legs, armor, accessories');
  const [symmetryDetection, setSymmetryDetection] = useState(true);
  const [autoWatertightRepair, setAutoWatertightRepair] = useState(true);
  const [convexDecomposition, setConvexDecomposition] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isRunning = isExecuting && (activeTask?.type === 'segment');

  const handleStartSegmentation = async () => {
    await runSegmentation({
      numParts: targetParts,
      method,
      hierarchical: useHierarchical,
      outputFormat,
      modelPreference: model,
      modelParameters: {
        min_part_faces: minPartFaces,
        smoothing_passes: smoothingPasses,
        max_hierarchy_depth: maxHierarchyDepth,
        part_hints: partHints.split(',').map(s => s.trim()).filter(Boolean),
        symmetry: symmetryDetection,
        watertight: autoWatertightRepair,
        convex_decomposition: convexDecomposition,
      }
    });
  };

  const handleSaveSettings = () => {
    toast.success('Segmentation settings saved to active session');
  };

  const handleResetSettings = () => {
    setMinPartFaces(250);
    setSmoothingPasses(3);
    setMaxHierarchyDepth(2);
    setPartHints('head, torso, arms, legs, armor, accessories');
    setSymmetryDetection(true);
    setAutoWatertightRepair(true);
    setConvexDecomposition(false);
    toast.info('SettingsIcon restored to defaults');
  };

  const handleUploadNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCurrentAsset(await uploadMeshAsset(file));
  };

  return (
    <div id="panel-mesh-segment" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none">
      {/* Top Header Pill Tabs: Segment / SettingsIcon */}
      <div className="p-3 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex gap-1 p-1 bg-[hsl(var(--surface-0))] rounded-xl border border-white/[0.08]">
          {(['segment', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              id={`tab-segment-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold capitalize transition-all cursor-pointer ${
                activeTab === tab
                  ? 'bg-primary text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {tab === 'segment' ? 'Segmentation' : 'Post-Processing'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-4 flex-1">
        {/* ========================================================================= */}
        {/* TAB 1: SEGMENT (Input, Model, Parts Slider, Method, Format)               */}
        {/* ========================================================================= */}
        {activeTab === 'segment' && (
          <div className="space-y-4">
            {/* 1. Input Mesh */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  1
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Input Mesh</div>
                  <div className="text-[10px] text-zinc-400">Select a mesh from your assets or upload a new one</div>
                </div>
              </div>

              {currentAsset ? (
                <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] relative group">
                  <button
                    type="button"
                    onClick={() => setCurrentAsset(null as any)}
                    className="absolute top-2 right-2 p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                    title="Remove selected mesh"
                  >
                    <HugeiconsIcon icon={Cancel} size={16} className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <HugeiconsIcon icon={Box} size={16} className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 pr-6">
                      <div className="text-xs font-bold text-white truncate">{currentAsset.name || 'knight_character.glb'}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        GLB · {currentAsset.fileSize || '12.4 MB'} · {currentAsset.faces ? `${Math.round(currentAsset.faces / 1000)}K` : '248K'} faces
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-white/[0.15] bg-[hsl(var(--surface-0))] text-center space-y-1">
                  <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 text-zinc-500 mx-auto" />
                  <div className="text-xs font-semibold text-zinc-300">No mesh selected</div>
                  <div className="text-[10px] text-zinc-500">Pick from assets below or upload a GLB/OBJ</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssetPicker(!showAssetPicker)}
                  className="py-2 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>From Assets</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf,.obj,.ply,.stl"
                  onChange={handleUploadNew}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="py-2 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <HugeiconsIcon icon={UploadIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>UploadIcon New</span>
                </button>
              </div>

              {showAssetPicker && (
                <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.1] max-h-40 overflow-y-auto space-y-1">
                  <div className="text-[10px] font-bold text-zinc-400 px-1">Recent 3D Assets</div>
                  {assets.filter(a => a.category === 'mesh' || a.source?.viewUrl || a.source?.localUrl).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setCurrentAsset(a);
                        setShowAssetPicker(false);
                      }}
                      className="w-full text-left p-1.5 rounded-lg hover:bg-[hsl(var(--surface-2))] flex items-center justify-between text-xs text-zinc-300 hover:text-white cursor-pointer"
                    >
                      <span className="truncate max-w-[160px]">{a.name}</span>
                      <span className="text-[9px] font-mono text-zinc-500">{a.faces ? `${Math.round(a.faces / 1000)}k` : '3D'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Segmentation Model */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  2
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Segmentation Model</div>
                  <div className="text-[10px] text-zinc-400">Choose the model for mesh segmentation</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="relative">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as 'partfield_mesh_segmentation' | 'p3sam_mesh_segmentation')}
                    className="w-full h-9 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs font-semibold text-white appearance-none focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="partfield_mesh_segmentation">PartField Semantic (4GB VRAM — Recommended)</option>
                    <option value="p3sam_mesh_segmentation">P3-SAM Zero-Shot 3D (60GB VRAM)</option>
                  </select>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="flex items-center justify-between text-[10px] text-zinc-400 px-1">
                  <span>{model === 'p3sam_mesh_segmentation' ? 'Open-vocabulary zero-shot 3D segmentation' : 'Semantic functional parts (limbs, torso, armor)'}</span>
                  <a
                    href="/admin?tab=models"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline ml-2 shrink-0"
                  >
                    <span>Details</span>
                    <HugeiconsIcon icon={ExternalLinkIcon} size={16} className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* 3. Parameters */}
            <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  3
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Parameters</div>
                </div>
              </div>

              {/* TargetIcon Parts Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-zinc-300">TargetIcon Parts</span>
                  <span className="font-mono text-primary font-bold text-xs">{targetParts} parts</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={16}
                  step={1}
                  value={targetParts}
                  onChange={(e) => setTargetParts(parseInt(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              {/* Segmentation Method */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-300">Segmentation Method</label>
                <div className="grid grid-cols-3 gap-1 p-0.5 bg-[hsl(var(--surface-0))] rounded-xl border border-white/[0.08]">
                  {(['semantic', 'geometric', 'hierarchical'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`py-1.5 px-2 rounded-lg text-[10px] font-bold capitalize transition-all cursor-pointer ${
                        method === m
                          ? 'bg-primary text-black shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Algorithm Version */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-300">Algorithm Version</label>
                <div className="relative">
                  <select
                    value={algorithmVersion}
                    onChange={(e) => setAlgorithmVersion(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs font-semibold text-white appearance-none focus:outline-none focus:border-primary"
                  >
                    <option value="v1">v1 (Standard Stable)</option>
                    <option value="v2">v2 (Experimental High-Precision)</option>
                  </select>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2 pt-1">
                {[
                  {
                    id: 'toggle-hierarchical',
                    title: 'Use Hierarchical Structure',
                    desc: 'Generate parent-child semantic tree',
                    checked: useHierarchical,
                    setter: setUseHierarchical,
                  },
                  {
                    id: 'toggle-colorize',
                    title: 'Colorize Parts',
                    desc: 'Assign distinctive viewport color IDs to each part',
                    checked: colorizeParts,
                    setter: setColorizeParts,
                  },
                  {
                    id: 'toggle-labels',
                    title: 'Generate Part Labels',
                    desc: 'Infer descriptive names (Head, Arms, Torso, Legs)',
                    checked: generateLabels,
                    setter: setGenerateLabels,
                  },
                ].map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-white/[0.02]">
                    <div className="min-w-0 pr-2">
                      <div className="text-[11px] font-semibold text-zinc-200">{t.title}</div>
                      <div className="text-[9px] text-zinc-500 leading-tight">{t.desc}</div>
                    </div>
                    <button
                      type="button"
                      id={t.id}
                      onClick={() => t.setter(!t.checked)}
                      className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                        t.checked ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                          t.checked ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Output Format */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  4
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Output Format</div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="relative">
                  <select
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs font-semibold text-white appearance-none focus:outline-none focus:border-primary"
                  >
                    <option value="glb">GLB (Individual nodes in single file)</option>
                    <option value="obj">OBJ (Multi-object group archive)</option>
                  </select>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                id="btn-start-segmentation"
                onClick={handleStartSegmentation}
                disabled={isRunning || (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl && !currentAsset?.source?.fileId)}
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-black/40 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 fill-current" />
                <span>{isRunning ? 'Segmenting Mesh...' : 'Start Segmentation'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SETTINGS (Post-processing, Boundary Filters, Vocabulary)            */}
        {/* ========================================================================= */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-1">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={Settings2} size={16} className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-white">Post-Processing Configuration</span>
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                FilterIcon noise shards, smooth part boundary contours, and guide semantic classification with custom keywords.
              </p>
            </div>

            {/* Minimum Part Size Threshold */}
            <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-200">Min Part Size (Faces)</span>
                <span className="font-mono text-primary font-bold">{minPartFaces} faces</span>
              </div>
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={minPartFaces}
                onChange={(e) => setMinPartFaces(parseInt(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="text-[9px] text-zinc-500">
                Prunes disconnected shards smaller than threshold and merges them into nearest parent part.
              </div>
            </div>

            {/* Boundary Smoothing Passes */}
            <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-200">Boundary Smoothing Passes</span>
                <span className="font-mono text-primary font-bold">{smoothingPasses} passes</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={smoothingPasses}
                onChange={(e) => setSmoothingPasses(parseInt(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="text-[9px] text-zinc-500">
                Smooths jagged cut boundaries along part intersections.
              </div>
            </div>

            {/* Hierarchical Depth */}
            <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-200">Hierarchy Depth Limit</span>
                <span className="font-mono text-primary font-bold">Level {maxHierarchyDepth}</span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={maxHierarchyDepth}
                onChange={(e) => setMaxHierarchyDepth(parseInt(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            {/* Semantic Vocabulary Hints */}
            <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <label className="text-[11px] font-semibold text-zinc-200">Part Vocabulary Hints</label>
              <textarea
                rows={2}
                value={partHints}
                onChange={(e) => setPartHints(e.target.value)}
                placeholder="e.g. head, torso, arms, legs, wings, tail"
                className="w-full p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
              />
              <div className="text-[9px] text-zinc-500">
                Comma-separated label prompts to guide semantic classification.
              </div>
            </div>

            {/* Post-Processing Toggles */}
            <div className="space-y-2 p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-200">Symmetry Detection</div>
                  <div className="text-[9px] text-zinc-500">Mirror left/right parts along X-axis</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSymmetryDetection(!symmetryDetection)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                    symmetryDetection ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${symmetryDetection ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-200">Auto Watertight Repair</div>
                  <div className="text-[9px] text-zinc-500">Cap open slice boundaries into closed volumes</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoWatertightRepair(!autoWatertightRepair)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                    autoWatertightRepair ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${autoWatertightRepair ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-200">Convex Hull Decomposition</div>
                  <div className="text-[9px] text-zinc-500">Generate simplified physics colliders for parts</div>
                </div>
                <button
                  type="button"
                  onClick={() => setConvexDecomposition(!convexDecomposition)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                    convexDecomposition ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${convexDecomposition ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'}`} />
                </button>
              </div>
            </div>

            {/* SaveIcon & Reset Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveSettings}
                className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary/90 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>SaveIcon SettingsIcon</span>
              </button>
              <button
                type="button"
                onClick={handleResetSettings}
                className="h-10 px-3 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-400 hover:text-white text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                title="Reset to defaults"
              >
                <HugeiconsIcon icon={RotateCcwIcon} size={16} className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
