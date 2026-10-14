'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useAnimationStore, AnimationClipItem, mapRetargetBones } from '@/stores/useAnimationStore';
import { useWorkspace } from '../store/WorkspaceContext';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircle, BoneIcon, ChevronDown, ChevronUp, KeyIcon, LoaderCircle, PlayIcon, RefreshCw, RotateCw, SlidersHorizontalIcon, SparklesIcon } from '@hugeicons/core-free-icons';
export const AnimationLeftPanel: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    activeMode,
    setActiveMode,
    bones,
    loadedSkeletonBoneNames,
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
    animations,
    currentAnimationId,
    retargetMapping,
    setRetargetMapping,
    retargetOptions,
    setRetargetOptions,
    addAnimation,
    setCurrentAnimationId,
    setInspectorTab,
  } = useAnimationStore();

  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [samplesCount, setSamplesCount] = useState(1);
  const [sourceSkeleton, setSourceSkeleton] = useState('ardy_core');
  const [sourceJointNames, setSourceJointNames] = useState<string[]>([]);
  const [isApplyingRetarget, setIsApplyingRetarget] = useState(false);
  const hasRig = Boolean(currentAsset?.artifacts?.rigged);
  const activeMotionClip = animations.find((clip) => clip.id === currentAnimationId);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setMotionAiIsGenerating(false);
  }, [setMotionAiIsGenerating]);

  useEffect(() => {
    let cancelled = false;
    setSourceJointNames([]);
    if (activeMode !== 'retarget' || !activeMotionClip?.motionJsonUrl) return () => { cancelled = true; };
    fetch(activeMotionClip.motionJsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Motion metadata request failed (${response.status})`);
        return response.json();
      })
      .then((doc) => {
        if (!cancelled && Array.isArray(doc.joint_names)) {
          setSourceJointNames(doc.joint_names.filter((name: unknown): name is string => typeof name === 'string'));
          setSourceSkeleton(String(doc.skeleton_id || '').toLowerCase().includes('g1') ? 'unitree_g1' : 'ardy_core');
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error('Could not read motion skeleton', { description: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, [activeMode, activeMotionClip?.id, activeMotionClip?.motionJsonUrl]);

  const openRigging = () => router.push(`/rigging?modelId=${encodeURIComponent(currentAsset?.id || 'active')}`);
  const retargetTargetNames = loadedSkeletonBoneNames ?? [];
  const retargetTargetScanned = loadedSkeletonBoneNames !== null;
  const retargetPreview = mapRetargetBones(sourceJointNames, retargetTargetNames, retargetMapping);
  const retargetMatchedCount = Object.keys(retargetPreview).length;
  const retargetIsCompatible = Boolean(
    retargetTargetScanned && retargetTargetNames.length && activeMotionClip?.artifactType === 'motion' &&
    sourceJointNames.length && retargetMatchedCount / sourceJointNames.length >= 0.5
  );

  const handleApplyRetarget = async () => {
    if (!hasRig) {
      toast.info("This model isn't rigged yet — rig it first.");
      openRigging();
      return;
    }
    if (!activeMotionClip?.motionJsonUrl || activeMotionClip.artifactType !== 'motion') {
      toast.error('Generate or select a Motion AI clip first.');
      return;
    }
    setIsApplyingRetarget(true);
    try {
      const response = await fetch(activeMotionClip.motionJsonUrl);
      if (!response.ok) throw new Error(`Motion metadata request failed (${response.status})`);
      const doc = await response.json();
      const jointNames = Array.isArray(doc.joint_names)
        ? doc.joint_names.filter((name: unknown): name is string => typeof name === 'string')
        : [];
      if (!jointNames.length) throw new Error('The selected motion has no joint metadata.');
      const actualSkeleton = String(doc.skeleton_id || activeMotionClip.skeletonId || '').toLowerCase();
      const actualIsG1 = actualSkeleton.includes('g1') || actualSkeleton.includes('unitree');
      if ((sourceSkeleton === 'unitree_g1') !== actualIsG1) {
        throw new Error('The selected source skeleton does not match this motion clip. Select its detected ARDY skeleton and try again.');
      }
      if (!loadedSkeletonBoneNames?.length) {
        throw new Error(loadedSkeletonBoneNames === null
          ? 'The target skeleton is still loading. Try again when the viewport finishes loading.'
          : 'No bones were found on the loaded rigged model. Reload or rig the model again.');
      }
      const mapping = mapRetargetBones(jointNames, loadedSkeletonBoneNames, retargetMapping);
      const matched = Object.keys(mapping).length;
      if (matched / jointNames.length < 0.5) {
        throw new Error(`Target rig is incompatible: only ${matched} of ${jointNames.length} motion joints matched.`);
      }
      setRetargetMapping(mapping);
      setCurrentAnimationId(activeMotionClip.id);
      toast.success('Retarget mapping applied', { description: `${matched}/${jointNames.length} source joints mapped to the target rig.` });
    } catch (error) {
      toast.error('Retargeting failed', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsApplyingRetarget(false);
    }
  };

  const characterCount = motionAiPrompt.length;
  const maxChars = 500;

  const CHECKPOINT_OPTIONS = [
    { id: 'ARDY-Core-RP-20FPS-Horizon40', label: 'ardy-core (default)', skeleton: 'core', fps: 20 },
    { id: 'ARDY-Core-RP-20FPS-Horizon8', label: 'ardy-core-h8 (fast)', skeleton: 'core', fps: 20 },
    { id: 'ARDY-G1-RP-25FPS-Horizon52', label: 'ardy-g1 (humanoid)', skeleton: 'g1', fps: 25 },
    { id: 'ARDY-G1-RP-25FPS-Horizon8', label: 'ardy-g1-h8 (fast)', skeleton: 'g1', fps: 25 },
  ];

  const handleGenerate = async () => {
    if (!hasRig) {
      toast.info("This model isn't rigged yet — rig it first.");
      openRigging();
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
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
      if (!jobId) throw new Error('Backend did not return a motion job ID');
      setMotionAiStage('Queued in scheduler...');
      setMotionAiProgress(25);

      pollRef.current = setInterval(async () => {
        try {
          const job = await client.getJobStatus(jobId);
          if (!pollRef.current) return;
          if (job.status === 'completed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setMotionAiIsGenerating(false);
            setMotionAiStage('Completed');
            setMotionAiProgress(100);

            // The job download route serves the generated JSON; adapter file paths are server-local, not browser URLs.
            const outputJson = `/api/v1/system/jobs/${encodeURIComponent(jobId)}/download`;
            const newClip: AnimationClipItem = {
              id: `ardy-gen-${Date.now()}`,
              name: motionAiPrompt.length > 28 ? motionAiPrompt.slice(0, 28) + '...' : motionAiPrompt,
              category: 'Custom',
              duration: Number(job.result?.duration) || motionAiDuration,
              fps: Number(job.result?.fps) || motionAiFps,
              keyframesCount: Number(job.result?.num_frames) || Math.round(motionAiDuration * motionAiFps),
              url: outputJson,
              motionJsonUrl: outputJson,
              artifactType: 'motion',
              skeletonId: String(job.result?.skeleton_id || targetSkeleton),
              jointNames: Array.isArray(job.result?.joint_names) ? job.result.joint_names.filter((name: unknown): name is string => typeof name === 'string') : undefined,
            };

            addAnimation(newClip);
            setCurrentAnimationId(newClip.id);
            toast.success('Motion generated successfully!', {
              description: `Created ${newClip.duration.toFixed(1)}s clip via ARDY.`,
            });
          } else if (job.status === 'failed' || job.status === 'cancelled') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setMotionAiIsGenerating(false);
            const errMsg = (job as any).error_message || `Motion synthesis ${job.status}`;
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
                ? 'Pose & Bone Editor'
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
              {/* Bone Selector Dropdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-zinc-200 flex items-center gap-1.5">
                    <HugeiconsIcon icon={BoneIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                    <span>Selected Bone</span>
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

              {/* Rotation Euler Controls for Selected Bone */}
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
                      Reset Bone
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
            /* Skeleton retargeting uses the selected motion JSON and active rig */
            <div className="space-y-4">
              {!hasRig ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                  <p className="text-xs text-amber-200">This model isn't rigged yet — rig it first.</p>
                  <button type="button" onClick={openRigging} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-black">Open Rigging</button>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-200">Source Skeleton</label>
                    <select
                      value={sourceSkeleton}
                      onChange={(event) => setSourceSkeleton(event.target.value)}
                      className="w-full py-2 px-3 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
                    >
                      <option value="ardy_core">ARDY Core (27 joints)</option>
                      <option value="unitree_g1">Unitree G1 (34 joints)</option>
                    </select>
                  </div>

                  <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white truncate block">{currentAsset?.name || 'Target character'}</span>
                      <p className="text-[10px] text-zinc-300 font-mono mt-0.5">
                        {!retargetTargetScanned
                          ? 'Loading target skeleton…'
                          : !retargetTargetNames.length
                            ? 'No skeleton bones found on the loaded model.'
                            : activeMotionClip?.motionJsonUrl
                              ? sourceJointNames.length ? `${retargetMatchedCount}/${sourceJointNames.length} source joints matched` : 'Reading motion skeleton…'
                              : 'Select a generated motion clip first.'}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${retargetIsCompatible ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'}`}>
                      {retargetIsCompatible ? 'Mappable' : !retargetTargetScanned ? 'Loading' : !retargetTargetNames.length ? 'No skeleton' : 'Not compatible'}
                    </span>
                  </div>

                  <div className="space-y-2 p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs">
                    {([
                      ['scaleNormalization', 'Scale Normalization'],
                      ['footContactLock', 'Foot Contact Lock'],
                      ['rootMotionPreservation', 'Root Motion Preservation'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 cursor-pointer">
                        <span className="text-zinc-300">{label}</span>
                        <input
                          type="checkbox"
                          checked={retargetOptions[key]}
                          onChange={(event) => setRetargetOptions({ [key]: event.target.checked })}
                          className="accent-[hsl(var(--primary))]"
                        />
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyRetarget}
                    disabled={isApplyingRetarget || !retargetIsCompatible}
                    className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-[hsl(var(--primary)/0.9)] text-black font-extrabold text-xs shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4" />
                    <span>{isApplyingRetarget ? 'Applying…' : 'Apply Retarget to Character'}</span>
                  </button>
                </>
              )}
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

            {!hasRig && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="text-xs text-amber-200">This model isn't rigged yet — rig it first.</p>
                <button type="button" onClick={openRigging} className="text-xs font-bold text-primary hover:underline">Open Rigging</button>
              </div>
            )}

            {/* Primary Action Button */}
            <div className="flex items-center gap-2 pt-1">
              <button
                disabled={motionAiIsGenerating || !hasRig}
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
                title="Open Advanced ARDY Settings"
              >
                <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4 text-primary" />
              </button>
            </div>
          </div>
          )
        )}
      </div>

      {/* Target Asset Footer */}
      <div className="p-3 border-t border-white/[0.08] bg-[hsl(var(--surface-0))] text-xs text-zinc-400 flex items-center justify-between">
        <div className="truncate">
          <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-wider">Target Character</span>
          <span className="text-zinc-200 font-semibold truncate block">
            {currentAsset?.name || 'No model selected'}
          </span>
        </div>
        <div className={`w-2 h-2 rounded-full ${hasRig ? 'bg-emerald-400' : 'bg-amber-400'}`} title={hasRig ? 'Rigged model loaded' : 'Model is not rigged'} />
      </div>
    </aside>
  );
};
