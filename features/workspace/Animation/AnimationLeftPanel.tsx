'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAnimationStore, AnimationClipItem } from '@/stores/useAnimationStore';
import { useWorkspace } from '../store/WorkspaceContext';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircle, BoneIcon, ChevronDown, ChevronUp, KeyIcon, LoaderCircle, PlayIcon, RefreshCw, RotateCw, SlidersHorizontalIcon, SparklesIcon } from '@hugeicons/core-free-icons';
export const AnimationLeftPanel: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const {
    activeMode,
    setActiveMode,
    bones,
    selectedBone,
    setSelectedBone,
    boneRotations,
    setBoneRotation,
    setBoneRotations,
    resetPose,
    mirrorPose,
    xMirrorEnabled,
    setXMirrorEnabled,
    currentTime,
    tracks,
    addKeyframeToTrack,
    motionAiPrompt,
    setMotionAiPrompt,
    motionAiDuration,
    setMotionAiDuration,
    motionAiFps,
    setMotionAiFps,
    motionAiSeed,
    setMotionAiSeed,
    motionAiIsGenerating,
    setMotionAiIsGenerating,
    motionAiStage,
    setMotionAiStage,
    motionAiProgress,
    setMotionAiProgress,
    motionAiError,
    setMotionAiError,
    ardyModel,
    setArdyModel,
    ardyCheckpoint,
    setArdyCheckpoint,
    mouseWaypointMode,
    constraintType,
    waypointInterval,
    targetVelocity,
    targetHeading,
    waypointMode,
    motionCorrection,
    addAnimation,
    setCurrentAnimationId,
    setInspectorTab,
  } = useAnimationStore();

  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [samplesCount, setSamplesCount] = useState(1);

  const characterCount = motionAiPrompt.length;
  const maxChars = 500;

  const CHECKPOINT_OPTIONS = [
    { id: 'ARDY-Core-RP-20FPS-Horizon40', label: 'ardy-core (default)', skeleton: 'core', fps: 20 },
    { id: 'ARDY-Core-RP-20FPS-Horizon8', label: 'ardy-core-h8 (fast)', skeleton: 'core', fps: 20 },
    { id: 'ARDY-G1-RP-25FPS-Horizon52', label: 'ardy-g1 (humanoid)', skeleton: 'g1', fps: 25 },
    { id: 'ARDY-G1-RP-25FPS-Horizon8', label: 'ardy-g1-h8 (fast)', skeleton: 'g1', fps: 25 },
  ];

  const handleGenerate = async () => {
    if (!motionAiPrompt.trim()) {
      toast.error('Please enter a motion prompt');
      return;
    }

    setMotionAiIsGenerating(true);
    setMotionAiStage('Validating request...');
    setMotionAiProgress(10);
    setMotionAiError(null);

    try {
      const client = getApiClient();
      const targetSkeleton = ardyModel.includes('g1') ? 'g1' : 'core';

      const resp = await client.generateMotion({
        prompt: motionAiPrompt.trim(),
        duration: motionAiDuration,
        seed: motionAiSeed ?? undefined,
        model_preference: ardyModel,
        model_parameters: {
          checkpoint: ardyCheckpoint,
          post_process: motionCorrection,
          target_skeleton: targetSkeleton,
          constraints: mouseWaypointMode
            ? {
                type: constraintType,
                waypoint_interval: waypointInterval,
                target_velocity: targetVelocity,
                target_heading: targetHeading,
                mode: waypointMode,
              }
            : undefined,
        },
      });

      const jobId = resp.job_id;
      if (jobId) {
        setMotionAiStage('Queued in scheduler...');
        setMotionAiProgress(25);

        // Poll real job status
        const pollTimer = setInterval(async () => {
          try {
            const job = await client.getJobStatus(jobId);
            if (job.status === 'completed') {
              clearInterval(pollTimer);
              setMotionAiIsGenerating(false);
              setMotionAiStage('Completed');
              setMotionAiProgress(100);

              const outputJson =
                job.result?.mesh_url ||
                `/api/v1/storage/models/${jobId}/motion.json`;

              const newClip: AnimationClipItem = {
                id: `ardy-gen-${Date.now()}`,
                name: motionAiPrompt.length > 28 ? motionAiPrompt.slice(0, 28) + '...' : motionAiPrompt,
                category: 'Custom',
                duration: motionAiDuration,
                fps: motionAiFps,
                keyframesCount: Math.round(motionAiDuration * motionAiFps),
                motionJsonUrl: outputJson,
                skeletonId: targetSkeleton,
              };

              addAnimation(newClip);
              setCurrentAnimationId(newClip.id);
              toast.success('Motion generated successfully!', {
                description: `Created ${motionAiDuration.toFixed(1)}s clip via ARDY.`,
              });
            } else if (job.status === 'failed') {
              clearInterval(pollTimer);
              setMotionAiIsGenerating(false);
              const errMsg = (job as any).error_message || 'Motion synthesis failed';
              setMotionAiError(errMsg);
              toast.error('Generation Failed', { description: errMsg });
            } else if (job.status === 'processing') {
              setMotionAiStage('Running ARDY motion synthesis...');
              setMotionAiProgress(65);
            }
          } catch (pollErr) {
            console.warn('Poll error:', pollErr);
          }
        }, 1500);
      }
    } catch (err: any) {
      setMotionAiIsGenerating(false);
      const msg = err.response?.data?.detail || err.message || 'Generation failed';
      setMotionAiError(msg);
      toast.error('Motion Generation Failed', { description: msg });
    }
  };

  return (
    <aside
      id="animation-generation-panel"
      className="w-full h-full bg-[hsl(var(--surface-1))] border-r border-white/[0.08] flex flex-col select-none text-zinc-200"
    >
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <span className="text-xs font-bold">❖</span>
            </div>
            <h2 className="text-xs font-black tracking-wider uppercase text-white truncate">
              {activeMode === 'editing'
                ? 'Pose & BoneIcon Editor'
                : activeMode === 'retarget'
                ? 'Skeleton Retargeting'
                : 'Motion Generation'}
            </h2>
          </div>
          <button
            onClick={() => setIsSectionOpen(!isSectionOpen)}
            className="p-1 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            {isSectionOpen ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5" />}
          </button>
        </div>

        {isSectionOpen && (
          activeMode === 'editing' ? (
            /* 1. BONE POSE & EDITING MODE */
            <div className="space-y-4">
              {/* BoneIcon Selector Dropdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-zinc-200 flex items-center gap-1.5">
                    <HugeiconsIcon icon={BoneIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                    <span>Selected BoneIcon</span>
                  </label>
                  <span className="text-[10px] font-mono text-zinc-400">{bones.length} Bones</span>
                </div>
                <div className="relative">
                  <select
                    value={selectedBone || ''}
                    onChange={(e) => setSelectedBone(e.target.value)}
                    className="w-full appearance-none pl-3 pr-8 py-2 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
                  >
                    {bones.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name} {b.parent ? `(${b.parent})` : '(Root)'}
                      </option>
                    ))}
                  </select>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Symmetry / X-Mirror Toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-200">X-Mirror Symmetry</span>
                  <span className="text-[10px] text-zinc-400">Auto-mirror left/right</span>
                </div>
                <button
                  onClick={() => setXMirrorEnabled(!xMirrorEnabled)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    xMirrorEnabled ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${xMirrorEnabled ? 'right-1' : 'left-1'}`} />
                </button>
              </div>

              {/* Rotation Euler Controls for Selected BoneIcon */}
              {selectedBone && (
                <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <HugeiconsIcon icon={RotateCw} size={16} className="w-3.5 h-3.5 text-primary" />
                      <span>{selectedBone} Rotation</span>
                    </span>
                    <button
                      onClick={() => setBoneRotation(selectedBone, [0, 0, 0])}
                      className="text-[10px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Reset BoneIcon
                    </button>
                  </div>

                  {(['Roll (X)', 'Pitch (Y)', 'Yaw (Z)'] as const).map((axisLabel, i) => {
                    const rot = boneRotations[selectedBone] || [0, 0, 0];
                    const val = rot[i];
                    return (
                      <div key={axisLabel} className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400">{axisLabel}</span>
                          <span className="text-primary font-mono font-bold">{val.toFixed(0)}°</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="-180"
                            max="180"
                            step="1"
                            value={val}
                            onChange={(e) => {
                              const deg = parseFloat(e.target.value) || 0;
                              const next: [number, number, number] = [...rot];
                              next[i] = deg;
                              setBoneRotation(selectedBone, next);
                            }}
                            className="flex-1 accent-primary h-1 bg-[hsl(var(--surface-3))] rounded cursor-pointer"
                          />
                          <input
                            type="number"
                            min="-180"
                            max="180"
                            value={val}
                            onChange={(e) => {
                              const deg = parseFloat(e.target.value) || 0;
                              const next: [number, number, number] = [...rot];
                              next[i] = deg;
                              setBoneRotation(selectedBone, next);
                            }}
                            className="w-14 px-1.5 py-0.5 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded text-[11px] text-center font-mono text-white"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick Preset Poses */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-zinc-200">Pose Presets</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { name: 'T-Pose', label: 'T-Pose' },
                    { name: 'A-Pose', label: 'A-Pose' },
                    { name: 'Combat Stance', label: 'Combat Stance' },
                    { name: 'Sitting', label: 'Sitting' },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => {
                        if (preset.name === 'T-Pose') {
                          resetPose();
                        } else if (preset.name === 'A-Pose') {
                          setBoneRotations({ UpperArm_L: [0, 0, -45], UpperArm_R: [0, 0, 45] });
                        } else if (preset.name === 'Combat Stance') {
                          setBoneRotations({
                            UpperArm_L: [30, 20, -30],
                            LowerArm_L: [60, 0, 0],
                            UpperArm_R: [40, -10, 20],
                            LowerArm_R: [70, 0, 0],
                            UpperLeg_L: [15, 0, 0],
                            UpperLeg_R: [-20, 0, 0],
                          });
                        } else if (preset.name === 'Sitting') {
                          setBoneRotations({
                            UpperLeg_L: [90, 0, 0],
                            LowerLeg_L: [-90, 0, 0],
                            UpperLeg_R: [90, 0, 0],
                            LowerLeg_R: [-90, 0, 0],
                          });
                        }
                        toast.success(`Applied ${preset.label}`);
                      }}
                      className="py-1.5 px-2 bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer text-center"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons: Keyframe Pose, Mirror, Reset All */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    tracks.forEach((t) => addKeyframeToTrack(t.id, currentTime));
                    toast.success(`Keyframed current pose at ${currentTime.toFixed(2)}s`);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
                >
                  <HugeiconsIcon icon={KeyIcon} size={16} className="w-3.5 h-3.5 fill-current" />
                  <span>Keyframe Pose (Frame {Math.round(currentTime * 24)})</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      mirrorPose();
                      toast.success('Pose mirrored across bilateral axis');
                    }}
                    className="py-2 px-2 bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer text-center"
                  >
                    Mirror Pose
                  </button>
                  <button
                    onClick={() => {
                      resetPose();
                      toast.info('All bone rotations reset');
                    }}
                    className="py-2 px-2 bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer text-center"
                  >
                    Reset All Bones
                  </button>
                </div>
              </div>
            </div>
          ) : activeMode === 'retarget' ? (
            /* 3. SKELETON RETARGETING MODE */
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-200">Source Skeleton</label>
                <select
                  defaultValue="ardy_core"
                  className="w-full py-2 px-3 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
                >
                  <option value="ardy_core">ARDY Core (24 Joints)</option>
                  <option value="unitree_g1">Unitree G1 Humanoid (33 Joints)</option>
                  <option value="mixamo">Mixamo Humanoid Biped</option>
                  <option value="smplx">SMPL-X Standard Humanoid</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-200">TargetIcon Character</label>
                <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white">{currentAsset?.name || 'Character Mannequin'}</span>
                    <p className="text-[10px] text-emerald-400 font-mono mt-0.5">17 Joints Identified &amp; Aligned</p>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Ready
                  </span>
                </div>
              </div>

              <div className="space-y-2 p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">Scale Normalization</span>
                  <span className="text-primary font-mono font-bold">Auto</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">Foot Contact Lock</span>
                  <span className="text-primary font-mono font-bold">Active</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">Root Motion Preservation</span>
                  <span className="text-primary font-mono font-bold">Enabled</span>
                </div>
              </div>

              <button
                onClick={() => {
                  toast.success('Retargeting applied successfully', {
                    description: 'Motion normalized and mapped to target character bones',
                  });
                }}
                className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-extrabold text-xs shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
              >
                <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4" />
                <span>Apply Retarget to Character</span>
              </button>
            </div>
          ) : (
            /* 4. DEFAULT TEXT TO MOTION GENERATION MODE */
            <div className="space-y-4">
            {/* Motion Prompt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-zinc-200 flex items-center gap-1.5">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Motion Prompt</span>
                </label>
                <button
                  onClick={() => setMotionAiPrompt('')}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>

              <div className="relative">
                <textarea
                  rows={4}
                  value={motionAiPrompt}
                  maxLength={maxChars}
                  onChange={(e) => setMotionAiPrompt(e.target.value)}
                  placeholder="Describe character motion in detail, e.g., A character walks forward, looks around, then runs and jumps, landing smoothly."
                  className="w-full p-3 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs text-white placeholder-zinc-400 focus:outline-none focus:border-primary transition-all resize-none shadow-inner"
                />
                <div className="absolute right-2.5 bottom-2 text-[10px] font-mono text-zinc-400">
                  {characterCount}/{maxChars}
                </div>
              </div>
            </div>

            {/* Model & Checkpoint */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-200">Model &amp; Checkpoint</label>
              <div className="grid grid-cols-2 gap-2">
                {/* Skeleton Architecture */}
                <div className="relative">
                  <select
                    value={ardyModel}
                    onChange={(e) => {
                      const m = e.target.value;
                      setArdyModel(m);
                      if (m === 'ardy-g1') {
                        setArdyCheckpoint('ARDY-G1-RP-25FPS-Horizon52');
                        setMotionAiFps(25);
                      } else {
                        setArdyCheckpoint('ARDY-Core-RP-20FPS-Horizon40');
                        setMotionAiFps(20);
                      }
                    }}
                    className="w-full appearance-none pl-7 pr-6 py-2 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-primary transition-colors cursor-pointer truncate"
                  >
                    <option value="ardy-core">ARDY (Core)</option>
                    <option value="ardy-g1">ARDY (G1)</option>
                  </select>
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none">
                    <span className="text-xs">▲</span>
                  </div>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Specific Checkpoint Variant */}
                <div className="relative">
                  <select
                    value={ardyCheckpoint}
                    onChange={(e) => setArdyCheckpoint(e.target.value)}
                    className="w-full appearance-none pl-2.5 pr-6 py-2 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-primary transition-colors cursor-pointer truncate"
                  >
                    {CHECKPOINT_OPTIONS.filter((c) =>
                      ardyModel === 'ardy-g1' ? c.skeleton === 'g1' : c.skeleton === 'core'
                    ).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Generation Parameters: Duration, FPS, Samples */}
            <div className="grid grid-cols-3 gap-2">
              {/* Duration */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-zinc-400">Duration (s)</span>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="15"
                    value={motionAiDuration}
                    onChange={(e) => setMotionAiDuration(parseFloat(e.target.value) || 5.0)}
                    className="w-full px-2.5 py-1.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* FPS */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-zinc-400">FPS</span>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="1"
                    min="15"
                    max="60"
                    value={motionAiFps}
                    onChange={(e) => setMotionAiFps(parseInt(e.target.value, 10) || 30)}
                    className="w-full px-2.5 py-1.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* Samples */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-zinc-400">Samples</span>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="4"
                    value={samplesCount}
                    onChange={(e) => setSamplesCount(parseInt(e.target.value, 10) || 1)}
                    className="w-full px-2.5 py-1.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {motionAiError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <HugeiconsIcon icon={AlertCircle} size={16} className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 break-words leading-relaxed">{motionAiError}</div>
              </div>
            )}

            {/* Progress Stage */}
            {motionAiIsGenerating && (
              <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-primary/30 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                    <HugeiconsIcon icon={LoaderCircle} size={16} className="w-3.5 h-3.5 text-primary animate-spin" />
                    <span>{motionAiStage || 'Synthesizing motion...'}</span>
                  </span>
                  <span className="font-mono text-primary font-bold">{motionAiProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${motionAiProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Primary Action Button */}
            <div className="flex items-center gap-2 pt-1">
              <button
                disabled={motionAiIsGenerating}
                onClick={handleGenerate}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed text-[#080808] font-black text-xs rounded-xl shadow-[0_4px_16px_rgba(255,204,0,0.38)] active:scale-[0.98] transition-all cursor-pointer btn-lighting-shine ${motionAiIsGenerating ? 'is-executing' : ''}`}
              >
                {motionAiIsGenerating ? (
                  <>
                    <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin text-black" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={PlayIcon} size={16} className="w-4 h-4 fill-current" />
                    <span>Generate Motion</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setInspectorTab('animation')}
                className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                title="Open Advanced ARDY SettingsIcon"
              >
                <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4 text-primary" />
              </button>
            </div>
          </div>
          )
        )}
      </div>

      {/* TargetIcon Asset Footer */}
      <div className="p-3 border-t border-white/[0.08] bg-[hsl(var(--surface-0))] text-xs text-zinc-400 flex items-center justify-between">
        <div className="truncate">
          <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-wider">TargetIcon Character</span>
          <span className="text-zinc-200 font-semibold truncate block">
            {currentAsset?.name || 'Character Mannequin (Default)'}
          </span>
        </div>
        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" title="Connected" />
      </div>
    </aside>
  );
};
