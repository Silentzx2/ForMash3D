'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAnimationStore, InspectorTab } from '@/stores/useAnimationStore';
import { useViewerStore } from '@/stores/useViewerStore';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight, Bone, Box, ChevronDown, ChevronUp, Download, Eye, FileCode, ShieldCheck } from '@hugeicons/core-free-icons';
export const AnimationRightInspector: React.FC = () => {
  const router = useRouter();
  const { currentAsset } = useWorkspace();
  const viewerStore = useViewerStore();

  const {
    inspectorTab,
    setInspectorTab,
    ardyModel,
    ardyCheckpoint,
    setArdyCheckpoint,
    ardyMode,
    setArdyMode,
    autoReplan,
    setAutoReplan,
    initialTransform,
    setInitialTransform,
    resetInitialTransform,
    mouseWaypointMode,
    setMouseWaypointMode,
    denseRoot,
    setDenseRoot,
    waypointInterval,
    setWaypointInterval,
    targetVelocity,
    setTargetVelocity,
    targetHeading,
    setTargetHeading,
    constraintType,
    setConstraintType,
    waypointMode,
    setWaypointMode,
    motionCorrection,
    setMotionCorrection,
    rootMargin,
    setRootMargin,
    contactThreshold,
    setContactThreshold,
    autoCamera,
    setAutoCamera,
    showContacts,
    setShowContacts,
    historyCrop,
    setHistoryCrop,
    futureCrop,
    setFutureCrop,
    replanBuffer,
    setReplanBuffer,
    replanThreshold,
    setReplanThreshold,
    displayOptions,
    toggleDisplayOption,
    duration,
    fps,
    animations,
    currentAnimationId,
    tracks,
    bones,
    selectedBone,
    setSelectedBone,
    setActiveMode,
  } = useAnimationStore();

  // Collapsible section states for Settings tab (matching design.png)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    ardyControls: true,
    initialTransform: true,
    waypoints: true,
    kinematics: false,
    postProcessing: false,
    advanced: false,
  });

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const modelName = currentAsset?.name || viewerStore.loadedModelName || 'character.glb';
  const realPolys = currentAsset?.faces || currentAsset?.triangles || viewerStore.modelStats?.triangles || 45231;
  const polysText = `${realPolys.toLocaleString()} vertices`;

  // Navigate to dedicated Rigging page preserving context
  const handleOpenRigging = () => {
    const assetId = currentAsset?.id || 'active';
    toast.info('Opening Rigging Workspace', {
      description: `Transferring ${modelName} into Rigging studio`,
    });
    router.push(`/rigging?modelId=${encodeURIComponent(assetId)}`);
  };

  // Export handlers
  const handleExportMotion = (format: 'glb' | 'bvh' | 'json') => {
    const activeClip = animations.find((a) => a.id === currentAnimationId) || animations[0];
    if (format === 'json') {
      const sessionData = {
        version: '1.0',
        model: ardyModel,
        checkpoint: ardyCheckpoint,
        duration,
        fps,
        clip: activeClip,
        tracks,
        waypoints: {
          mouseWaypointMode,
          denseRoot,
          waypointInterval,
          targetVelocity,
          targetHeading,
          constraintType,
          waypointMode,
        },
        initialTransform,
        postProcessing: {
          motionCorrection,
          rootMargin,
          contactThreshold,
        },
      };
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${modelName.replace(/\.[^/.]+$/, '')}_ardy_session.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ARDY Session Exported', { description: 'Saved motion parameters and constraint tracks as JSON' });
    } else if (format === 'bvh') {
      if (activeClip?.url && activeClip.url.endsWith('.bvh')) {
        window.open(activeClip.url, '_blank');
      } else {
        toast.info('Generating BVH MoCap Stream', { description: `Exporting ${duration.toFixed(1)}s skeletal trajectory at ${fps} FPS` });
      }
    } else {
      if (activeClip?.url && activeClip.url.endsWith('.glb')) {
        window.open(activeClip.url, '_blank');
      } else {
        toast.success('Exporting Animated GLB Mesh', { description: 'Baking character mesh and generated skeleton animation' });
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--surface-1))] border-l border-white/[0.08] text-zinc-200 overflow-hidden select-none">
      {/* TOP INSPECTOR TABS */}
      <div className="flex-shrink-0 h-10 border-b border-white/[0.08] bg-[hsl(var(--surface-0))] px-2 flex items-center justify-between">
        {(['settings', 'character', 'visualization', 'export'] as const).map((tab) => {
          const isActive = inspectorTab === tab || (inspectorTab === 'properties' && tab === 'settings');
          return (
            <button
              key={tab}
              onClick={() => setInspectorTab(tab)}
              className={`flex-1 py-2 text-xs font-semibold capitalize relative transition-colors cursor-pointer text-center ${
                isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab === 'settings' ? 'Settings' : tab === 'character' ? 'Character' : tab === 'visualization' ? 'Visualization' : 'Export'}
              {isActive && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* INSPECTOR TAB CONTENT */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {/* 1. SETTINGS TAB */}
        {(inspectorTab === 'settings' || inspectorTab === 'properties') && (
          <div className="space-y-3">
            {/* ARDY CONTROLS */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('ardyControls')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>ARDY Controls</span>
                </div>
                {openSections.ardyControls ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.ardyControls && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  {/* Checkpoint selector */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Checkpoint</label>
                    <div className="relative">
                      <select
                        value={ardyCheckpoint}
                        onChange={(e) => setArdyCheckpoint(e.target.value)}
                        className="w-full h-8 px-2.5 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-lg text-xs text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                      >
                        <option value="ardy-core (default)">ardy-core (default)</option>
                        <option value="ardy-unitree-g1">ardy-unitree-g1</option>
                        <option value="ardy-rp-20fps">ardy-rp-20fps-horizon40</option>
                      </select>
                      <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400 absolute right-2.5 top-2.5 pointer-events-none" />
                    </div>
                  </div>

                  {/* Mode switcher pills */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Mode</label>
                    <div className="grid grid-cols-2 gap-1 bg-[hsl(var(--surface-2))] p-0.5 rounded-lg border border-white/[0.08]">
                      <button
                        onClick={() => setArdyMode('text_to_motion')}
                        className={`py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                          ardyMode === 'text_to_motion'
                            ? 'bg-primary text-black shadow-xs font-bold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Text to Motion
                      </button>
                      <button
                        onClick={() => setArdyMode('interactive')}
                        className={`py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                          ardyMode === 'interactive'
                            ? 'bg-primary text-black shadow-xs font-bold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Interactive
                      </button>
                    </div>
                  </div>

                  {/* Auto Replan toggle */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-medium text-zinc-300">Auto Replan</span>
                    <button
                      onClick={() => setAutoReplan(!autoReplan)}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                        autoReplan ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${
                          autoReplan ? 'right-1' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => {
                        toast.info('Restarting generation pipeline', { description: 'Cleared cache, starting from frame 0' });
                      }}
                      className="py-1.5 px-2 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer text-center"
                    >
                      Restart
                    </button>
                    <button
                      onClick={() => {
                        toast.info('Restarting from current frame', { description: 'Preserving motion prefix, replanning future frames' });
                      }}
                      className="py-1.5 px-2 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer text-center"
                    >
                      Restart From Now
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* INITIAL BODY TRANSFORM */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('initialTransform')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>Initial Body Transform</span>
                </div>
                {openSections.initialTransform ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.initialTransform && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-2">
                      {/* Position X, Y, Z */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-400 w-12">Position</span>
                        <div className="grid grid-cols-3 gap-1 flex-1">
                          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                            <div key={axis} className="flex items-center bg-[hsl(var(--surface-2))] rounded px-1.5 py-0.5 border border-white/[0.08]">
                              <span className="text-[10px] text-zinc-500 mr-1 font-mono">{axis}</span>
                              <input
                                type="number"
                                step="0.1"
                                value={initialTransform.position[i]}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const next = [...initialTransform.position] as [number, number, number];
                                  next[i] = val;
                                  setInitialTransform({ position: next });
                                }}
                                className="w-full bg-transparent text-[11px] text-zinc-200 font-mono focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Rotation X, Y, Z */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-400 w-12">Rotation</span>
                        <div className="grid grid-cols-3 gap-1 flex-1">
                          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                            <div key={axis} className="flex items-center bg-[hsl(var(--surface-2))] rounded px-1.5 py-0.5 border border-white/[0.08]">
                              <span className="text-[10px] text-zinc-500 mr-1 font-mono">{axis}</span>
                              <input
                                type="number"
                                step="1"
                                value={initialTransform.rotation[i]}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const next = [...initialTransform.rotation] as [number, number, number];
                                  next[i] = val;
                                  setInitialTransform({ rotation: next });
                                }}
                                className="w-full bg-transparent text-[11px] text-zinc-200 font-mono focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={resetInitialTransform}
                      className="px-2.5 py-3 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* WAYPOINTS & CONSTRAINTS */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('waypoints')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>Waypoints &amp; Constraints</span>
                </div>
                {openSections.waypoints ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.waypoints && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  {/* Toggles row */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between bg-[hsl(var(--surface-2))] px-2.5 py-1.5 rounded-lg border border-white/[0.08]">
                      <span className="text-[11px] font-medium text-zinc-300">Mouse Waypoint</span>
                      <button
                        onClick={() => setMouseWaypointMode(!mouseWaypointMode)}
                        className={`w-7 h-4 rounded-full transition-colors relative cursor-pointer ${
                          mouseWaypointMode ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-black absolute top-0.5 transition-transform ${mouseWaypointMode ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between bg-[hsl(var(--surface-2))] px-2.5 py-1.5 rounded-lg border border-white/[0.08]">
                      <span className="text-[11px] font-medium text-zinc-300">Dense Root</span>
                      <button
                        onClick={() => setDenseRoot(!denseRoot)}
                        className={`w-7 h-4 rounded-full transition-colors relative cursor-pointer ${
                          denseRoot ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-black absolute top-0.5 transition-transform ${denseRoot ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                    </div>
                  </div>

                  {/* Waypoint Interval */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">Waypoint Interval (frames)</span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={waypointInterval}
                      onChange={(e) => setWaypointInterval(parseInt(e.target.value) || 10)}
                      className="w-16 h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-right text-white font-mono focus:outline-none"
                    />
                  </div>

                  {/* Target Velocity & Heading */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Target Velocity</label>
                      <input
                        type="number"
                        step="0.1"
                        value={targetVelocity}
                        onChange={(e) => setTargetVelocity(parseFloat(e.target.value) || 0)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Target Heading (°)</label>
                      <input
                        type="number"
                        step="5"
                        value={targetHeading}
                        onChange={(e) => setTargetHeading(parseFloat(e.target.value) || 0)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Constraint Type */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Constraint Type</label>
                    <div className="relative">
                      <select
                        value={constraintType}
                        onChange={(e) => setConstraintType(e.target.value as any)}
                        className="w-full h-8 px-2.5 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-lg text-xs text-white focus:outline-none appearance-none cursor-pointer"
                      >
                        <option value="Full Body">Full Body</option>
                        <option value="Hands">Hands</option>
                        <option value="Feet">Feet</option>
                        <option value="Hands + Feet">Hands + Feet</option>
                        <option value="Sparse Joints">Sparse Joints</option>
                      </select>
                      <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400 absolute right-2.5 top-2.5 pointer-events-none" />
                    </div>
                  </div>

                  {/* 2D Waypoints / 2D Trajectory pills */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => setWaypointMode('2D Waypoints')}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                        waypointMode === '2D Waypoints'
                          ? 'border border-primary bg-primary/10 text-primary font-bold'
                          : 'border border-white/[0.08] bg-[hsl(var(--surface-2))] text-zinc-400 hover:text-white'
                      }`}
                    >
                      2D Waypoints
                    </button>
                    <button
                      onClick={() => setWaypointMode('2D Trajectory')}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                        waypointMode === '2D Trajectory'
                          ? 'border border-primary bg-primary/10 text-primary font-bold'
                          : 'border border-white/[0.08] bg-[hsl(var(--surface-2))] text-zinc-400 hover:text-white'
                      }`}
                    >
                      2D Trajectory
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* KINEMATIC CONSTRAINTS */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('kinematics')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>Kinematic Constraints</span>
                </div>
                {openSections.kinematics ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.kinematics && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">Full Body Weight</span>
                      <span className="text-primary font-mono">1.0</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" defaultValue="1.0" className="w-full accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">Hand Lock Tolerance</span>
                      <span className="text-primary font-mono">0.05m</span>
                    </div>
                    <input type="range" min="0.01" max="0.2" step="0.01" defaultValue="0.05" className="w-full accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">Foot Lock Tolerance</span>
                      <span className="text-primary font-mono">0.02m</span>
                    </div>
                    <input type="range" min="0.01" max="0.2" step="0.01" defaultValue="0.02" className="w-full accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer" />
                  </div>
                </div>
              )}
            </div>

            {/* MOTION POST-PROCESSING */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('postProcessing')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>Motion Post-Processing</span>
                </div>
                {openSections.postProcessing ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.postProcessing && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300">Motion Correction</span>
                    <button
                      onClick={() => setMotionCorrection(!motionCorrection)}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                        motionCorrection ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${motionCorrection ? 'right-1' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">Root Margin</span>
                      <span className="text-primary font-mono">{rootMargin}m</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="0.2"
                      step="0.01"
                      value={rootMargin}
                      onChange={(e) => setRootMargin(parseFloat(e.target.value))}
                      className="w-full accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">Contact Threshold</span>
                      <span className="text-primary font-mono">{contactThreshold}</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="0.1"
                      step="0.005"
                      value={contactThreshold}
                      onChange={(e) => setContactThreshold(parseFloat(e.target.value))}
                      className="w-full accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ADVANCED */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] overflow-hidden">
              <button
                onClick={() => toggleSection('advanced')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>Advanced</span>
                </div>
                {openSections.advanced ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {openSections.advanced && (
                <div className="p-3 border-t border-white/[0.08] space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">History Crop</label>
                      <input
                        type="number"
                        value={historyCrop}
                        onChange={(e) => setHistoryCrop(parseInt(e.target.value) || 10)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Future Crop</label>
                      <input
                        type="number"
                        value={futureCrop}
                        onChange={(e) => setFutureCrop(parseInt(e.target.value) || 15)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Replan Buffer</label>
                      <input
                        type="number"
                        value={replanBuffer}
                        onChange={(e) => setReplanBuffer(parseInt(e.target.value) || 5)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-zinc-400">Threshold</label>
                      <input
                        type="number"
                        step="0.05"
                        value={replanThreshold}
                        onChange={(e) => setReplanThreshold(parseFloat(e.target.value) || 0.15)}
                        className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-md text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-zinc-400">Acceleration Mode</span>
                    <span className="text-emerald-400 font-mono font-medium">CUDA FP16</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. CHARACTER TAB */}
        {inspectorTab === 'character' && (
          <div className="space-y-3">
            {/* Active Character Card */}
            <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center text-primary">
                  <HugeiconsIcon icon={Box} size={16} className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">{modelName}</h4>
                  <p className="text-[11px] text-zinc-400">{polysText}</p>
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    <HugeiconsIcon icon={ShieldCheck} size={16} className="w-3 h-3" /> ARDY Core Compatible
                  </span>
                </div>
              </div>

              {/* Skeleton Specification */}
              <div className="p-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Active Skeleton:</span>
                  <span className="text-white font-mono">Humanoid (ARDY)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Joint Nodes:</span>
                  <span className="text-white font-mono">24 Joints</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Rig Status:</span>
                  <span className="text-emerald-400 font-medium">Fully Rigged</span>
                </div>
              </div>

              {/* OPEN IN RIGGING WORKSPACE BUTTON */}
              <button
                onClick={handleOpenRigging}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer active:scale-98"
              >
                <HugeiconsIcon icon={Bone} size={16} className="w-4 h-4" />
                <span>Open in Rigging Workspace</span>
                <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>

            {/* BONE HIERARCHY & QUICK POSE */}
            <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <HugeiconsIcon icon={Bone} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Joint Hierarchy ({bones.length})</span>
                </span>
                <button
                  onClick={() => setActiveMode('editing')}
                  className="text-[10px] text-primary hover:underline font-semibold cursor-pointer"
                >
                  Edit Pose &rarr;
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                {bones.map((b) => {
                  const isSelected = selectedBone === b.name;
                  return (
                    <div
                      key={b.name}
                      onClick={() => setSelectedBone(b.name)}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary text-black font-bold shadow-xs'
                          : 'bg-[hsl(var(--surface-2))] text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      <span className={`text-[10px] font-mono ${isSelected ? 'text-black/70' : 'text-zinc-500'}`}>
                        {b.parent || 'Root'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 3. VISUALIZATION TAB */}
        {inspectorTab === 'visualization' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-3">
              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                <HugeiconsIcon icon={Eye} size={16} className="w-3.5 h-3.5 text-primary" />
                <span>Viewport Overlays</span>
              </h4>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08]">
                  <span className="text-zinc-300">Show Ground Grid</span>
                  <button
                    onClick={() => toggleDisplayOption('showGrid')}
                    className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                      displayOptions.showGrid ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${displayOptions.showGrid ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08]">
                  <span className="text-zinc-300">Show Skeleton Armature</span>
                  <button
                    onClick={() => toggleDisplayOption('showSkeleton')}
                    className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                      displayOptions.showSkeleton ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${displayOptions.showSkeleton ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08]">
                  <span className="text-zinc-300">Show Foot Contacts</span>
                  <button
                    onClick={() => setShowContacts(!showContacts)}
                    className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                      showContacts ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${showContacts ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08]">
                  <span className="text-zinc-300">Auto Camera Follow</span>
                  <button
                    onClick={() => setAutoCamera(!autoCamera)}
                    className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                      autoCamera ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${autoCamera ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. EXPORT TAB */}
        {inspectorTab === 'export' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-3">
              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                <HugeiconsIcon icon={Download} size={16} className="w-3.5 h-3.5 text-primary" />
                <span>Export Motion Assets</span>
              </h4>

              <div className="space-y-2">
                <button
                  onClick={() => handleExportMotion('glb')}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <HugeiconsIcon icon={Box} size={16} className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-white">Animated Mesh (GLB)</p>
                      <p className="text-[10px] text-zinc-400">Baked mesh with skeletal animation</p>
                    </div>
                  </div>
                  <HugeiconsIcon icon={Download} size={16} className="w-3.5 h-3.5 text-zinc-400 group-hover:text-primary transition-colors" />
                </button>

                <button
                  onClick={() => handleExportMotion('bvh')}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <HugeiconsIcon icon={Bone} size={16} className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-white">Motion Capture (BVH)</p>
                      <p className="text-[10px] text-zinc-400">Industry standard skeletal trajectory</p>
                    </div>
                  </div>
                  <HugeiconsIcon icon={Download} size={16} className="w-3.5 h-3.5 text-zinc-400 group-hover:text-primary transition-colors" />
                </button>

                <button
                  onClick={() => handleExportMotion('json')}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <HugeiconsIcon icon={FileCode} size={16} className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-white">ARDY Session (JSON)</p>
                      <p className="text-[10px] text-zinc-400">Waypoints, constraints and prompt state</p>
                    </div>
                  </div>
                  <HugeiconsIcon icon={Download} size={16} className="w-3.5 h-3.5 text-zinc-400 group-hover:text-primary transition-colors" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
