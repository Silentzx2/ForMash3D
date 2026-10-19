'use client';

import React, { useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useRiggingStore } from '@/stores/useRiggingStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { toast } from 'sonner';
import { withRiggedModel } from '../types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BoneIcon,
  ChevronDown,
  ChevronUp,
  FolderOpenIcon,
  LoaderCircle,
  SparklesIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';

export const RiggingLeftPanel: React.FC = () => {
  const { currentAsset, navigateToTool, addAsset, setCurrentAsset, updateAssetProperties } = useWorkspace();
  const {
    setCharacterInfo,
    riggingMethod,
    setRiggingMethod,
    riggingMethod,
    symmetry,
    setSymmetry,
    advancedOptionsOpen,
    setAdvancedOptionsOpen,
    isGenerating,
    generationProgress,
    generationStatus,
    generationError,
    generateRig,
    jobId,
    cancelRigPolling,
    resumeRigPolling,
    riggedFbxUrl,
  } = useRiggingStore();

  const { setXMirrorEnabled } = useAnimationStore();

  useEffect(() => () => cancelRigPolling(), [cancelRigPolling]);
  useEffect(() => {
    if (jobId && generationStatus === 'paused') void resumeRigPolling();
  }, [jobId, generationStatus, resumeRigPolling]);

  const handleGenerate = async () => {
    if (riggingMethod === 'manual_rig') {
      toast.info('Manual armature mode does not run UniRig. Use the Rigging Studio editor to place bones and save the armature.');
      return;
    }
    const meshFileId = currentAsset?.source?.fileId ?? currentAsset?.fileId;
    if (!meshFileId) {
      toast.error('Select or upload a mesh first');
      return;
    }
    const success = await generateRig(undefined, meshFileId);
    if (!success) return;
    const { riggedModelUrl: riggedUrl, riggedFbxUrl: fbxUrl } = useRiggingStore.getState();
    if (currentAsset && riggedUrl) {
      const riggedAsset = withRiggedModel(currentAsset, riggedUrl, fbxUrl || undefined);
      updateAssetProperties(currentAsset.id, { format: riggedAsset.format, source: riggedAsset.source, artifacts: riggedAsset.artifacts });
      addAsset(riggedAsset);
      setCurrentAsset(riggedAsset);
      setCharacterInfo({
        name: currentAsset.name,
        vertices: currentAsset.statsAvailable ? currentAsset.vertices : 0,
        sizeMb: currentAsset.fileSize ? Number.parseFloat(currentAsset.fileSize) || 0 : 0,
        meshUrl: riggedUrl,
      });
      useAnimationStore.getState().setRigStatus('rigged');
    }
  };

  const displayName = currentAsset?.name || 'No mesh selected';
  const meshFileId = currentAsset?.source?.fileId ?? currentAsset?.fileId;
  const displayVertices = currentAsset?.statsAvailable ? currentAsset.vertices : 0;
  const displaySize = currentAsset?.fileSize || '—';

  return (
    <div id="rigging-left-panel" className="flex flex-col h-full overflow-y-auto p-3 space-y-3.5 text-xs select-none bg-[hsl(var(--surface-1))] custom-scrollbar">
      {/* Panel Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.08] flex-shrink-0">
        <span className="font-bold text-xs text-white flex items-center gap-1.5">
          <HugeiconsIcon icon={BoneIcon} size={16} className="w-3.5 h-3.5 text-primary" />
          <span>Auto Rigging</span>
        </span>
        <ToolContextHelp tool="rigging" label="Auto Rig Help" />
      </div>

      {/* Target Character Card */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wide">Target Character</label>
        <div className="p-2.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center text-primary flex-shrink-0">
              <HugeiconsIcon icon={UserIcon} size={16} className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{displayName}</p>
              <p className="text-[10px] text-zinc-400 font-mono">
                {displaySize} • {displayVertices > 0 ? displayVertices.toLocaleString() : '—'} verts
              </p>
            </div>
          </div>

          <button
            onClick={() => navigateToTool('model')}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] rounded-lg text-[11px] font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={14} className="w-3.5 h-3.5 text-zinc-400" />
            <span>Select Different Model</span>
          </button>
        </div>
      </div>

      {/* Rigging Method */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wide">Rigging Pipeline</label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setRiggingMethod('auto_rig')}
            className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
              riggingMethod === 'auto_rig'
                ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <HugeiconsIcon icon={SparklesIcon} size={14} className="w-3.5 h-3.5 text-primary" />
              <span className="font-bold text-[11px] text-white">UniRig AI</span>
            </div>
            <p className="text-[9px] text-zinc-400 leading-tight">Neural automatic skeletal fitting</p>
          </button>

          <button
            onClick={() => setRiggingMethod('manual_rig')}
            className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
              riggingMethod === 'manual_rig'
                ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <HugeiconsIcon icon={BoneIcon} size={14} className="w-3.5 h-3.5 text-primary" />
              <span className="font-bold text-[11px] text-white">Manual Armature</span>
            </div>
            <p className="text-[9px] text-zinc-400 leading-tight">Freehand interactive bone editing</p>
          </button>
        </div>
      </div>

      <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] text-[10px] text-zinc-400 leading-relaxed">
        UniRig uses its native biped topology and model-default weights. Custom skeleton presets, IK generation, and weight overrides are not supported by this adapter.
      </div>

      {/* Advanced Options Accordion */}
      <div className="border border-white/[0.08] rounded-xl bg-[hsl(var(--surface-0))] overflow-hidden">
        <button
          onClick={() => setAdvancedOptionsOpen(!advancedOptionsOpen)}
          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-bold text-zinc-300 hover:text-white cursor-pointer"
        >
          <span>Advanced Rigging Options</span>
          <HugeiconsIcon icon={advancedOptionsOpen ? ChevronUp : ChevronDown} size={14} className="w-3.5 h-3.5 text-zinc-400" />
        </button>

        {advancedOptionsOpen && (
          <div className="p-3 border-t border-white/[0.08] space-y-2 text-[11px]">
            <label className="flex items-center justify-between text-zinc-300 cursor-pointer">
              <span>Bilateral Symmetry (-X Mirror)</span>
              <input
                type="checkbox"
                checked={symmetry}
                onChange={(e) => {
                  setSymmetry(e.target.checked);
                  setXMirrorEnabled(e.target.checked);
                }}
                className="rounded border-white/[0.1] bg-[hsl(var(--surface-1))] text-primary focus:ring-0 cursor-pointer"
              />
            </label>
          </div>
        )}
      </div>

      {/* Action: Generate Rig Button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !meshFileId || riggingMethod === 'manual_rig'}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.35)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isGenerating ? (
          <>
            <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin text-black" />
            <span>Calculating Armature ({generationProgress}%)...</span>
          </>
        ) : (
          <>
            <HugeiconsIcon icon={BoneIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
            <span>{riggingMethod === 'manual_rig' ? 'MANUAL ARMATURE MODE' : 'GENERATE RIG WITH UNIRIG'}</span>
          </>
        )}
      </button>

      {!meshFileId && <p className="text-[10px] text-amber-300">Select or upload a mesh first.</p>}

      {/* Progress or Error Status */}
      {isGenerating && (
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
          <p className="text-[10px] text-zinc-400 text-center font-mono">{generationStatus}</p>
        </div>
      )}
      {generationError && (
        <p className="text-[10px] text-red-400 font-mono bg-red-500/10 p-2 rounded-lg border border-red-500/20">
          {generationError}
        </p>
      )}
    </div>
  );
};
