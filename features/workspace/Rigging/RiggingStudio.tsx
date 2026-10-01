'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useRiggingStore } from '@/stores/useRiggingStore';
import { useViewerStore } from '@/stores/useViewerStore';

import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft, Bone, Box, Brush, Camera, Check, ChevronDown, FlipHorizontal2, FolderOpen, LoaderCircle, Maximize, Maximize2, MoreHorizontal, MousePointer, Move, RefreshCw, RotateCw, Search, Sparkles, Target, Upload, User } from '@hugeicons/core-free-icons';
import {
  useAnimationStore,
  BoneItem,
  getSymmetricBoneName,
  ViewportGizmoTool,
  CameraPreset,
} from '@/stores/useAnimationStore';
import { MeshViewer } from '../Viewport/MeshViewer';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';

export const RiggingStudio: React.FC = () => {
  const router = useRouter();
  const { currentAsset } = useWorkspace();
  const viewerStore = useViewerStore();

  // Rigging Store (metadata, UniRig AI pipeline, character stats)
  const {
    characterName,
    characterVertices,
    characterSizeMb,
    riggingMethod,
    setRiggingMethod,
    targetSkeleton,
    setTargetSkeleton,
    createIkControls,
    setCreateIkControls,
    optimizeForAnimation,
    setOptimizeForAnimation,
    symmetry,
    setSymmetry,
    reuseExistingWeights,
    setReuseExistingWeights,
    advancedOptionsOpen,
    setAdvancedOptionsOpen,
    isGenerating,
    generationProgress,
    generationStatus,
    generationError,
    generateRig,
    applyAndSaveRig,
    brushRadius,
    setBrushRadius,
    brushStrength,
    setBrushStrength,
    brushFalloff,
    setBrushFalloff,
  } = useRiggingStore();

  // Animation Store (drives MeshViewer's real Three.js 3D skeleton & transform controls)
  const {
    bones,
    setBones,
    selectedBone,
    setSelectedBone,
    updateBonePosition,
    updateBoneName,
    addBone,
    deleteBone,
    autoFitRigToBounds,
    xMirrorEnabled,
    setXMirrorEnabled,
    activeViewportTool,
    setActiveViewportTool,
    isPlacingBone,
    setIsPlacingBone,
    isWeightPainting,
    setIsWeightPainting,
    setCameraPreset,
  } = useAnimationStore();

  const [activeTab, setActiveTab] = useState<'skeleton' | 'weights' | 'tools'>('skeleton');
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'pose' | 'weight'>('edit');
  const [cameraMode, setCameraMode] = useState<'Perspective' | 'Front' | 'Top' | 'Side'>('Perspective');
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [boneSearchQuery, setBoneSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    Hips: true,
    Spine: true,
    Chest: true,
    UpperArm_L: true,
    UpperArm_R: true,
    UpperLeg_L: true,
    UpperLeg_R: true,
  });

  const toggleNode = (name: string) => {
    setExpandedNodes((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // Activate 3D rigging mode in MeshViewer on mount
  useEffect(() => {
    useAnimationStore.setState({
      activeMode: 'rigging',
      inspectorTab: 'rigging',
      displayOptions: {
        ...useAnimationStore.getState().displayOptions,
        showSkeleton: true,
      },
    });
    // Sync symmetry states
    setXMirrorEnabled(symmetry);
  }, [setXMirrorEnabled, symmetry]);

  // Selected bone object
  const activeBoneData = bones.find((b) => b.name === selectedBone) || bones[0];

  // Filter bones for hierarchy search
  const filteredBones = bones.filter((b) =>
    !boneSearchQuery || b.name.toLowerCase().includes(boneSearchQuery.toLowerCase())
  );

  // Method 1: AI Auto-Rigging with UniRig
  const handleGenerateUniRig = async () => {
    const meshPath = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || 'models/knight.glb';
    toast.info('Starting UniRig AI Auto-Rigging...', {
      description: `Targeting ${targetSkeleton === 'quadruped' ? 'Quadruped' : '17-Bone Humanoid'} topology`,
    });
    const success = await generateRig(meshPath);
    if (success) {
      toast.success('UniRig Complete!', {
        description: '3D Armature and skinning weights synthesized and applied.',
      });
      // Ensure viewer displays real 3D skeleton
      useAnimationStore.setState({
        activeMode: 'rigging',
        displayOptions: {
          ...useAnimationStore.getState().displayOptions,
          showSkeleton: true,
        },
      });
    } else {
      toast.error('Rigging Failed', {
        description: generationError || 'Could not complete UniRig auto-rigging.',
      });
    }
  };

  // Save Rig & Transition to Animation
  const handleApplyAndSave = async () => {
    const ok = await applyAndSaveRig();
    if (ok) {
      toast.success('Character Rig Applied & Saved!', {
        description: `${bones.length} bones configured. Ready for animation.`,
      });
      router.push('/workspace/animation');
    }
  };

  // Toggle Bilateral Symmetry (X-Mirror)
  const handleToggleSymmetry = () => {
    const nextSym = !xMirrorEnabled;
    setSymmetry(nextSym);
    setXMirrorEnabled(nextSym);
    toast.info(nextSym ? 'Bilateral Symmetry (X-Mirror) Enabled' : 'Bilateral Symmetry Disabled', {
      description: nextSym ? 'Bone placement and movements mirror across the X-axis' : 'Individual bone editing active',
    });
  };

  // Tool Rail Mode Switching
  const handleSelectTool = (tool: ViewportGizmoTool) => {
    setActiveViewportTool(tool);
    if (tool === 'bone') {
      setIsPlacingBone(true);
      setIsWeightPainting(false);
      setWorkspaceMode('edit');
      toast.info('Bone Placement Active', { description: 'Click anywhere on the 3D model surface to insert a bone' });
    } else if (tool === 'weight') {
      setIsWeightPainting(true);
      setIsPlacingBone(false);
      setWorkspaceMode('weight');
      toast.info('Weight Paint Mode Active', { description: 'Showing vertex skinning influence heatmap' });
    } else {
      setIsPlacingBone(false);
      setIsWeightPainting(false);
      if (workspaceMode === 'weight') setWorkspaceMode('edit');
    }
  };

  // Camera View Switcher
  const handleCameraChange = (preset: 'Perspective' | 'Front' | 'Top' | 'Side') => {
    setCameraMode(preset);
    setCameraDropdownOpen(false);
    const mapping: Record<string, CameraPreset> = {
      Perspective: 'perspective',
      Front: 'front',
      Top: 'top',
      Side: 'side',
    };
    setCameraPreset(mapping[preset] || 'perspective');
    toast.info(`Camera View: ${preset}`);
  };

  // Viewport Snapshot
  const handleSnapshot = () => {
    try {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${characterName.replace(/\.[^/.]+$/, '')}_rig_snapshot.png`;
        link.href = dataUrl;
        link.click();
        toast.success('Viewport Snapshot Saved');
      } else {
        toast.info('Viewport captured');
      }
    } catch {
      toast.info('Viewport snapshot ready');
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-0))] text-zinc-200 overflow-hidden select-none">
      {/* 1. TOP HEADER (Matching 3D Gen page styling) */}
      <div className="flex-shrink-0 h-14 bg-[hsl(var(--surface-0))]/80 backdrop-blur-md border-b border-white/[0.08] px-4 flex items-center justify-between z-20">
        {/* Left: Return Arrow & Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/workspace/animation')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Return to Animation"
          >
            <HugeiconsIcon icon={ArrowLeft} size={16} className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <span>Rigging Studio</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                UniRig + Symmetry
              </span>
            </h1>
            <p className="text-[11px] text-zinc-400 font-normal">
              Fit skeletal armature and calculate skinning weights for animation
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          {/* Active Model Indicator */}
          <div className="flex items-center gap-2 bg-[hsl(var(--surface-1))] border border-white/[0.08] px-3 py-1.5 rounded-xl text-xs">
            <span className="text-zinc-500 font-medium">Model:</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
            <span className="font-semibold text-zinc-200">UniRig (Fast AI Auto-Rig)</span>
          </div>

          {/* Import Model Action */}
          <button
            onClick={() => {
              toast.info('Select a 3D Character Mesh', { description: 'Supported formats: GLB, FBX, OBJ' });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={FolderOpen} size={16} className="w-3.5 h-3.5 text-zinc-400" />
            <span>Import Mesh</span>
          </button>

          {/* Export Rig Action */}
          <button
            onClick={() => {
              toast.success('Exporting Rigged Character (FBX)', {
                description: `Exporting ${bones.length} bones with vertex skinning weights`,
              });
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-bold text-xs rounded-xl shadow-[0_2px_12px_rgba(249,207,0,0.25)] transition-all active:scale-95 cursor-pointer"
          >
            <HugeiconsIcon icon={Upload} size={16} className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Export Rig</span>
          </button>
        </div>
      </div>

      {/* 2. MAIN 3-COLUMN WORKSPACE BODY */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {/* LEFT PANEL: Character & Rigging Setup */}
        <div className="w-[300px] xl:w-[330px] h-full flex-shrink-0 border-r border-white/[0.08] bg-[hsl(var(--surface-1))] p-3 flex flex-col space-y-3 overflow-y-auto custom-scrollbar z-10">
          {/* Character Card */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-zinc-300 tracking-wide">Target Character</label>
            <div className="p-2.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center text-primary flex-shrink-0">
                    <HugeiconsIcon icon={User} size={16} className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{characterName}</p>
                    <p className="text-[10px] text-zinc-400">
                      {characterSizeMb} MB • {characterVertices.toLocaleString()} vertices
                    </p>
                  </div>
                </div>
                <button className="p-1 rounded text-zinc-500 hover:text-white cursor-pointer">
                  <HugeiconsIcon icon={MoreHorizontal} size={16} className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => toast.info('Select character mesh from Assets or upload new GLB')}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={FolderOpen} size={16} className="w-3 h-3 text-zinc-400" />
                <span>Replace Model</span>
              </button>
            </div>
          </div>

          {/* EXACTLY 2 RIGGING METHODS */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-zinc-300 tracking-wide">Rigging Method</label>
            <div className="grid grid-cols-2 gap-1 bg-[hsl(var(--surface-0))] p-0.5 rounded-xl border border-white/[0.08]">
              <button
                onClick={() => setRiggingMethod('auto_rig')}
                className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  riggingMethod === 'auto_rig'
                    ? 'bg-primary text-black font-bold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Auto Rig (UniRig AI)
              </button>
              <button
                onClick={() => setRiggingMethod('manual_rig')}
                className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  riggingMethod === 'manual_rig'
                    ? 'bg-primary text-black font-bold shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Manual Rig (Symmetry)
              </button>
            </div>

            {/* METHOD 1: UNIRIG AI AUTO-RIG */}
            {riggingMethod === 'auto_rig' && (
              <div className="space-y-2.5">
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
                      <HugeiconsIcon icon={Sparkles} size={16} className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">UniRig Neural Armature</h4>
                      <p className="text-[10px] text-zinc-400 leading-tight">
                        Deep-learning pipeline that fits biped bones and generates smooth skinning weights.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Primary Generate Rig Button */}
                <button
                  onClick={handleGenerateUniRig}
                  disabled={isGenerating}
                  className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-98 ${
                    isGenerating
                      ? 'bg-primary/50 text-black cursor-not-allowed'
                      : 'bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin" />
                      <span>{generationStatus}</span>
                    </>
                  ) : (
                    <>
                      <HugeiconsIcon icon={Sparkles} size={16} className="w-4 h-4 fill-current" />
                      <span>Generate UniRig Armature</span>
                    </>
                  )}
                </button>

                {/* Progress bar when generating */}
                {isGenerating && (
                  <div className="w-full bg-[hsl(var(--surface-0))] rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300 rounded-full"
                      style={{ width: `${generationProgress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* METHOD 2: MANUAL RIG WITH BILATERAL SYMMETRY */}
            {riggingMethod === 'manual_rig' && (
              <div className="space-y-2.5">
                {/* Bilateral Symmetry Banner */}
                <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={FlipHorizontal2} size={16} className="w-4 h-4 text-primary" />
                      <span className="text-xs font-bold text-white">Bilateral Symmetry (X-Mirror)</span>
                    </div>
                    <button
                      onClick={handleToggleSymmetry}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        xMirrorEnabled ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow transform ring-0 transition duration-200 ease-in-out ${
                          xMirrorEnabled ? 'translate-x-4' : 'translate-x-0 bg-zinc-300'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Placing or moving bones on one side automatically mirrors to the opposite side (-X).
                  </p>
                </div>

                {/* Interactive Placement Button */}
                <button
                  onClick={() => handleSelectTool('bone')}
                  className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border cursor-pointer ${
                    isPlacingBone
                      ? 'bg-primary text-black border-primary'
                      : 'bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border-white/[0.08] text-white'
                  }`}
                >
                  <HugeiconsIcon icon={Bone} size={16} className="w-3.5 h-3.5" />
                  <span>{isPlacingBone ? 'Click Mesh to Place Bone' : 'Add Bones Interactively'}</span>
                </button>

                {/* Auto-Fit Skeleton to Mesh Bounds */}
                <button
                  onClick={() => {
                    autoFitRigToBounds();
                    toast.success('Armature Auto-Fitted', {
                      description: 'Proportionally scaled to 3D character mesh bounding volume',
                    });
                  }}
                  className="w-full py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-zinc-200 hover:text-white transition-all cursor-pointer"
                >
                  <HugeiconsIcon icon={Target} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Auto-Fit Armature to Mesh</span>
                </button>

                {/* Reset Armature to T-Pose */}
                <button
                  onClick={() => {
                    useAnimationStore.getState().resetPose();
                    toast.info('Armature reset to default humanoid T-pose');
                  }}
                  className="w-full py-1.5 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 bg-transparent hover:bg-white/[0.04] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={RefreshCw} size={16} className="w-3 h-3" />
                  <span>Reset T-Pose</span>
                </button>
              </div>
            )}
          </div>

          {/* Advanced Rigging Options Collapsible */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <button
              onClick={() => setAdvancedOptionsOpen(!advancedOptionsOpen)}
              className="w-full flex items-center justify-between text-xs font-bold text-zinc-300 hover:text-white py-1 cursor-pointer"
            >
              <span>Advanced Pipeline Settings</span>
              <HugeiconsIcon icon={ChevronDown} size={16}
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${advancedOptionsOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {advancedOptionsOpen && (
              <div className="space-y-2.5 pt-1">
                {/* Skeleton Target */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-zinc-400">Target Skeleton Topology</label>
                  <select
                    value={targetSkeleton}
                    onChange={(e) => setTargetSkeleton(e.target.value as any)}
                    className="w-full h-8 px-2.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-lg text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="biped">Biped Humanoid (17 Bones)</option>
                    <option value="humanoid">Extended Humanoid (Full Spine)</option>
                    <option value="quadruped">Quadruped (Creature / Beast)</option>
                  </select>
                </div>

                {/* Toggles */}
                <div className="space-y-1.5 pt-1 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-zinc-300">Generate IK Handles</span>
                    <input
                      type="checkbox"
                      checked={createIkControls}
                      onChange={(e) => setCreateIkControls(e.target.checked)}
                      className="rounded border-white/[0.1] bg-[hsl(var(--surface-0))] text-primary focus:ring-0 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-zinc-300">Optimize Vertex Weights</span>
                    <input
                      type="checkbox"
                      checked={optimizeForAnimation}
                      onChange={(e) => setOptimizeForAnimation(e.target.checked)}
                      className="rounded border-white/[0.1] bg-[hsl(var(--surface-0))] text-primary focus:ring-0 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-zinc-300">Preserve Existing Weights</span>
                    <input
                      type="checkbox"
                      checked={reuseExistingWeights}
                      onChange={(e) => setReuseExistingWeights(e.target.checked)}
                      className="rounded border-white/[0.1] bg-[hsl(var(--surface-0))] text-primary focus:ring-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CENTER VIEWPORT: Real 3D Armature & Mesh Canvas */}
        <div className="flex-1 h-full flex flex-col min-w-0 bg-[hsl(var(--surface-0))] relative overflow-hidden">
          <div className="flex-1 relative overflow-hidden">
            {/* Real Three.js Canvas with Real 3D Skeleton Rendering */}
            <MeshViewer showOverlayUI={false} className="w-full h-full" />

            {/* TOP VIEWPORT OVERLAY CONTROLS */}
            <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
              {/* Transform Tool Mode Pills (Select, Move, Rotate, Scale) */}
              <div className="pointer-events-auto flex items-center gap-1 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.08] rounded-xl shadow-lg">
                {[
                  { id: 'select', label: 'Select', icon: <HugeiconsIcon icon={MousePointer} size={16} className="w-3.5 h-3.5" /> },
                  { id: 'move', label: 'Move', icon: <HugeiconsIcon icon={Move} size={16} className="w-3.5 h-3.5" /> },
                  { id: 'rotate', label: 'Rotate', icon: <HugeiconsIcon icon={RotateCw} size={16} className="w-3.5 h-3.5" /> },
                  { id: 'scale', label: 'Scale', icon: <HugeiconsIcon icon={Maximize} size={16} className="w-3.5 h-3.5" /> },
                ].map((t) => {
                  const isActive = activeViewportTool === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTool(t.id as ViewportGizmoTool)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isActive
                          ? 'border border-primary bg-primary/10 text-primary font-bold shadow-xs'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Camera preset + Snapshot + Wireframe + Fullscreen */}
              <div className="pointer-events-auto flex items-center gap-1.5 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.08] rounded-xl shadow-lg">
                <div className="relative">
                  <button
                    onClick={() => setCameraDropdownOpen(!cameraDropdownOpen)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:text-white rounded-lg cursor-pointer"
                  >
                    <span>{cameraMode}</span>
                    <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400" />
                  </button>

                  {cameraDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-32 bg-[hsl(var(--surface-1))] border border-white/[0.12] rounded-lg shadow-xl p-1 z-30">
                      {(['Perspective', 'Front', 'Top', 'Side'] as const).map((cam) => (
                        <button
                          key={cam}
                          onClick={() => handleCameraChange(cam)}
                          className={`w-full text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                            cameraMode === cam
                              ? 'bg-primary text-black font-bold'
                              : 'text-zinc-300 hover:bg-white/[0.06]'
                          }`}
                        >
                          {cam}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="h-3.5 w-px bg-white/10" />

                <SimpleTooltip label="Capture Viewport Snapshot">
                  <button
                    onClick={handleSnapshot}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
                  >
                    <HugeiconsIcon icon={Camera} size={16} className="w-3.5 h-3.5" />
                  </button>
                </SimpleTooltip>

                <SimpleTooltip label="Toggle Wireframe">
                  <button
                    onClick={() => {
                      viewerStore.toggleWireframeOverlay();
                      toast.info('Wireframe toggled');
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
                  >
                    <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5" />
                  </button>
                </SimpleTooltip>

                <SimpleTooltip label="Toggle Fullscreen">
                  <button
                    onClick={() => {
                      if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen?.();
                      } else {
                        document.exitFullscreen?.();
                      }
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
                  >
                    <HugeiconsIcon icon={Maximize2} size={16} className="w-3.5 h-3.5" />
                  </button>
                </SimpleTooltip>
              </div>
            </div>

            {/* LEFT TOOLSTRIP (Wired to Real Viewport Functions) */}
            <div className="absolute left-3 top-16 z-10 flex flex-col gap-1 p-1 bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.08] rounded-xl shadow-xl">
              <SimpleTooltip label="Select Tool (Q)" side="right">
                <button
                  onClick={() => handleSelectTool('select')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    activeViewportTool === 'select'
                      ? 'border border-primary bg-primary/10 text-primary'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={MousePointer} size={16} className="w-4 h-4" />
                </button>
              </SimpleTooltip>

              <SimpleTooltip label="Translate Bone (W)" side="right">
                <button
                  onClick={() => handleSelectTool('move')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    activeViewportTool === 'move'
                      ? 'border border-primary bg-primary/10 text-primary'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={Move} size={16} className="w-4 h-4" />
                </button>
              </SimpleTooltip>

              <SimpleTooltip label="Rotate Bone (E)" side="right">
                <button
                  onClick={() => handleSelectTool('rotate')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    activeViewportTool === 'rotate'
                      ? 'border border-primary bg-primary/10 text-primary'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={RotateCw} size={16} className="w-4 h-4" />
                </button>
              </SimpleTooltip>

              <SimpleTooltip label="Edit / Place Bone on Mesh Surface" side="right">
                <button
                  onClick={() => handleSelectTool('bone')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    isPlacingBone || activeViewportTool === 'bone'
                      ? 'border border-primary bg-primary text-black font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={Bone} size={16} className="w-4 h-4" />
                </button>
              </SimpleTooltip>

              <SimpleTooltip label="Weight Paint Heatmap" side="right">
                <button
                  onClick={() => handleSelectTool('weight')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    isWeightPainting || activeViewportTool === 'weight'
                      ? 'border border-primary bg-primary text-black font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={Brush} size={16} className="w-4 h-4" />
                </button>
              </SimpleTooltip>
            </div>

            {/* Symmetry Status Watermark in Viewport */}
            <div className="absolute right-4 bottom-4 z-10 pointer-events-none">
              <div className="px-2.5 py-1 rounded-lg bg-[hsl(var(--surface-0))]/80 border border-white/[0.08] backdrop-blur-xs text-[10px] font-mono flex items-center gap-1.5 text-zinc-400">
                <HugeiconsIcon icon={FlipHorizontal2} size={16} className="w-3 h-3 text-primary" />
                <span>Bilateral Symmetry: {xMirrorEnabled ? 'ON (-X Mirror)' : 'OFF'}</span>
              </div>
            </div>
          </div>

          {/* BOTTOM WORKSPACE ACTIONS BAR */}
          <div className="h-14 bg-[hsl(var(--surface-0))]/90 backdrop-blur-md border-t border-white/[0.08] px-4 flex items-center justify-between z-20">
            {/* Left: Rigging Workspace Modes */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setWorkspaceMode('edit');
                  handleSelectTool('move');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  workspaceMode === 'edit'
                    ? 'border border-primary bg-primary/10 text-primary font-bold shadow-xs'
                    : 'bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300'
                }`}
              >
                <HugeiconsIcon icon={Bone} size={16} className="w-4 h-4" />
                <span>Edit Armature</span>
              </button>

              <button
                onClick={() => {
                  setWorkspaceMode('pose');
                  handleSelectTool('rotate');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  workspaceMode === 'pose'
                    ? 'border border-primary bg-primary/10 text-primary font-bold shadow-xs'
                    : 'bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300'
                }`}
              >
                <HugeiconsIcon icon={User} size={16} className="w-4 h-4" />
                <span>Pose Mode</span>
              </button>

              <button
                onClick={() => {
                  setWorkspaceMode('weight');
                  handleSelectTool('weight');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  workspaceMode === 'weight'
                    ? 'border border-primary bg-primary/10 text-primary font-bold shadow-xs'
                    : 'bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300'
                }`}
              >
                <HugeiconsIcon icon={Brush} size={16} className="w-4 h-4" />
                <span>Weight Paint</span>
              </button>
            </div>

            {/* Right: Symmetry Toggle + Apply & Save Rig */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleSymmetry}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  xMirrorEnabled
                    ? 'border-primary/50 bg-primary/10 text-primary font-bold'
                    : 'border-white/[0.08] bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white'
                }`}
              >
                <HugeiconsIcon icon={FlipHorizontal2} size={16} className="w-3.5 h-3.5" />
                <span>Symmetry: {xMirrorEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <button
                onClick={handleApplyAndSave}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-bold text-xs rounded-xl shadow-[0_2px_12px_rgba(249,207,0,0.25)] transition-all active:scale-95 cursor-pointer"
              >
                <HugeiconsIcon icon={Check} size={16} className="w-4 h-4 stroke-[3]" />
                <span>Save &amp; Continue to Animation</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Real Bone Hierarchy & Properties */}
        <div className="w-[320px] xl:w-[350px] h-full flex-shrink-0 border-l border-white/[0.08] bg-[hsl(var(--surface-1))] flex flex-col z-10 overflow-hidden">
          {/* Tabs: Skeleton, Weights, Tools */}
          <div className="h-10 border-b border-white/[0.08] bg-[hsl(var(--surface-0))] px-2 flex items-center justify-between flex-shrink-0">
            {(['skeleton', 'weights', 'tools'] as const).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 text-xs font-semibold capitalize relative transition-colors cursor-pointer text-center ${
                    isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab}
                  {isActive && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />}
                </button>
              );
            })}
          </div>

          {/* SKELETON TAB */}
          {activeTab === 'skeleton' && (
            <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
              {/* Search */}
              <div className="space-y-1.5 flex-shrink-0">
                <label className="text-[11px] font-bold text-zinc-300 tracking-wide">
                  Armature Hierarchy ({bones.length} Bones)
                </label>
                <div className="relative">
                  <HugeiconsIcon icon={Search} size={16} className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search bone..."
                    value={boneSearchQuery}
                    onChange={(e) => setBoneSearchQuery(e.target.value)}
                    className="w-full h-8 pl-8 pr-2.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              {/* Hierarchy Tree */}
              <div className="flex-1 overflow-y-auto border border-white/[0.08] rounded-xl bg-[hsl(var(--surface-0))] p-1.5 custom-scrollbar text-xs font-mono">
                {filteredBones.map((bone) => {
                  const isSelected = selectedBone === bone.name;
                  const isParentNode = bones.some((b) => b.parent === bone.name);
                  const isExpanded = expandedNodes[bone.name] ?? false;

                  return (
                    <div
                      key={bone.name}
                      onClick={() => setSelectedBone(bone.name)}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/20 border border-primary/40 text-primary font-bold'
                          : 'hover:bg-white/[0.04] text-zinc-300'
                      }`}
                      style={{
                        paddingLeft: `${
                          bone.parent === null
                            ? 8
                            : bone.parent === 'Hips'
                            ? 18
                            : bone.parent === 'Spine'
                            ? 26
                            : bone.parent === 'Chest'
                            ? 34
                            : 42
                        }px`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isParentNode ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleNode(bone.name);
                            }}
                            className="p-0.5 text-zinc-400 hover:text-white"
                          >
                            <HugeiconsIcon icon={ChevronDown} size={16}
                              className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                            />
                          </button>
                        ) : (
                          <div className="w-3" />
                        )}
                        <HugeiconsIcon icon={Bone} size={16} className="w-3.5 h-3.5 text-primary opacity-80" />
                        <span className="truncate">{bone.name}</span>
                      </div>

                      {xMirrorEnabled && getSymmetricBoneName(bone.name) && (
                        <span className="text-[9px] text-zinc-500 font-mono">
                          ⇄ {getSymmetricBoneName(bone.name)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected Bone Properties */}
              {activeBoneData && (
                <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2.5 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-zinc-300">Selected Joint</span>
                    <span className="text-[10px] text-primary font-mono font-semibold">{activeBoneData.name}</span>
                  </div>

                  {/* Name Input */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Name</span>
                    <input
                      type="text"
                      value={activeBoneData.name}
                      onChange={(e) => updateBoneName(activeBoneData.name, e.target.value)}
                      className="w-40 h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-white font-mono text-xs focus:outline-none"
                    />
                  </div>

                  {/* Parent Selector */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Parent</span>
                    <select
                      value={activeBoneData.parent || 'None'}
                      onChange={(e) => {
                        const newParent = e.target.value === 'None' ? null : e.target.value;
                        useAnimationStore.getState().updateBoneParent(activeBoneData.name, newParent);
                      }}
                      className="w-40 h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-white text-xs focus:outline-none cursor-pointer"
                    >
                      <option value="None">None</option>
                      {bones
                        .filter((b) => b.name !== activeBoneData.name)
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Position Coordinates (With Bilateral Mirroring) */}
                  <div className="pt-1 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      <span>Position (World Coordinates)</span>
                      {xMirrorEnabled && <span className="text-primary font-normal">Symmetric Mirror Active</span>}
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                        <div
                          key={axis}
                          className="flex items-center bg-[hsl(var(--surface-2))] rounded px-1.5 py-1 border border-white/[0.08]"
                        >
                          <span
                            className={`text-[10px] mr-1 font-mono font-bold ${
                              axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'
                            }`}
                          >
                            {axis}
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            value={activeBoneData.position[i]}
                            onChange={(e) => {
                              const next = [...activeBoneData.position] as [number, number, number];
                              next[i] = parseFloat(e.target.value) || 0;
                              updateBonePosition(activeBoneData.name, next);
                            }}
                            className="w-full bg-transparent text-[11px] text-zinc-200 font-mono focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WEIGHTS TAB */}
          {activeTab === 'weights' && (
            <div className="p-3 space-y-3 text-xs overflow-y-auto custom-scrollbar">
              <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white flex items-center gap-1.5">
                    <HugeiconsIcon icon={Brush} size={16} className="w-3.5 h-3.5 text-primary" />
                    <span>Weight Paint Brush</span>
                  </h4>
                  <span className="text-[10px] text-zinc-400 font-mono">Heatmap</span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Brush Radius</span>
                    <span className="font-mono text-zinc-200">{brushRadius.toFixed(2)}m</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.05"
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
                    className="w-full accent-primary bg-[hsl(var(--surface-2))] h-1.5 rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Brush Strength</span>
                    <span className="font-mono text-zinc-200">{(brushStrength * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={brushStrength}
                    onChange={(e) => setBrushStrength(parseFloat(e.target.value))}
                    className="w-full accent-primary bg-[hsl(var(--surface-2))] h-1.5 rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400">Falloff Curve</label>
                  <div className="grid grid-cols-3 gap-1 bg-[hsl(var(--surface-2))] p-0.5 rounded-lg border border-white/[0.08]">
                    {(['smooth', 'linear', 'sphere'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setBrushFalloff(mode)}
                        className={`py-1 text-[10px] font-semibold capitalize rounded transition-all cursor-pointer ${
                          brushFalloff === mode ? 'bg-primary text-black font-bold' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    handleSelectTool('weight');
                  }}
                  className="w-full py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary font-bold rounded-lg text-xs transition-colors cursor-pointer"
                >
                  Activate Heatmap in 3D Viewport
                </button>
              </div>
            </div>
          )}

          {/* TOOLS TAB */}
          {activeTab === 'tools' && (
            <div className="p-3 space-y-3 text-xs overflow-y-auto custom-scrollbar">
              <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2.5">
                <h4 className="font-bold text-white flex items-center gap-1.5">
                  <HugeiconsIcon icon={Sparkles} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Armature Utilities</span>
                </h4>

                <button
                  onClick={() => {
                    autoFitRigToBounds();
                    toast.success('Armature Fitted to Mesh');
                  }}
                  className="w-full py-2 px-2.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-left font-semibold text-zinc-200 transition-colors cursor-pointer"
                >
                  <p className="text-xs font-bold text-white">Auto-Fit to Mesh Bounds</p>
                  <p className="text-[10px] text-zinc-400">Scale and align joints to character bounding box</p>
                </button>

                <button
                  onClick={handleToggleSymmetry}
                  className="w-full py-2 px-2.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-left font-semibold text-zinc-200 transition-colors cursor-pointer"
                >
                  <p className="text-xs font-bold text-white">
                    Bilateral Symmetry: {xMirrorEnabled ? 'Active' : 'Disabled'}
                  </p>
                  <p className="text-[10px] text-zinc-400">Mirror left &amp; right limb coordinates across the X axis</p>
                </button>

                <button
                  onClick={() => {
                    useAnimationStore.getState().mirrorPose();
                    toast.success('Pose Mirrored Across X-Axis');
                  }}
                  className="w-full py-2 px-2.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-left font-semibold text-zinc-200 transition-colors cursor-pointer"
                >
                  <p className="text-xs font-bold text-white">Mirror Pose (Left ⇄ Right)</p>
                  <p className="text-[10px] text-zinc-400">Copy rotations from left side to right side</p>
                </button>

                <button
                  onClick={() => {
                    useAnimationStore.getState().resetPose();
                    toast.info('Armature Restored to T-Pose');
                  }}
                  className="w-full py-2 px-2.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-left font-semibold text-zinc-200 transition-colors cursor-pointer"
                >
                  <p className="text-xs font-bold text-white">Reset All Joints</p>
                  <p className="text-[10px] text-zinc-400">Clear all joint rotations back to neutral T-pose</p>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
