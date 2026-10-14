'use client';

import React, { useState } from 'react';
import { useAnimationStore, BoneItem } from '@/stores/useAnimationStore';
import { useRiggingStore } from '@/stores/useRiggingStore';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BoneIcon,
  BrushIcon,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2,
} from '@hugeicons/core-free-icons';

export const RiggingRightInspector: React.FC = () => {
  const { navigateToTool } = useWorkspace();
  const {
    bones,
    selectedBone,
    setSelectedBone,
    updateBonePosition,
    updateBoneName,
    addBone,
    deleteBone,
    xMirrorEnabled,
  } = useAnimationStore();

  const {
    applyAndSaveRig,
    brushRadius,
    setBrushRadius,
    brushStrength,
    setBrushStrength,
    brushFalloff,
    setBrushFalloff,
  } = useRiggingStore();

  const [activeTab, setActiveTab] = useState<'skeleton' | 'weights' | 'properties'>('skeleton');
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

  const activeBoneData = bones.find((b) => b.name === selectedBone) || bones[0];

  const filteredBones = bones.filter((b) =>
    b.name.toLowerCase().includes(boneSearchQuery.toLowerCase())
  );

  const handleApplyAndContinue = async () => {
    try {
      await applyAndSaveRig();
      toast.success('Rig applied successfully', { description: 'Opening Animation Studio' });
      navigateToTool('animation');
    } catch {
      toast.error('Failed to save rig');
    }
  };

  return (
    <div id="rigging-right-inspector" className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
      {/* Sub-tab Navigation */}
      <div className="h-10 border-b border-white/[0.08] bg-[hsl(var(--surface-0))] px-2 flex items-center justify-between flex-shrink-0">
        {(['skeleton', 'weights', 'properties'] as const).map((tab) => {
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

      {/* SKELETON HIERARCHY TAB */}
      {activeTab === 'skeleton' && (
        <div className="flex-1 flex flex-col overflow-hidden p-2.5 space-y-2.5">
          {/* Search */}
          <div className="space-y-1 flex-shrink-0">
            <div className="flex items-center justify-between text-[11px] font-bold text-zinc-300">
              <span>Armature Hierarchy</span>
              <span className="text-primary font-mono">{bones.length} Bones</span>
            </div>
            <div className="relative">
              <HugeiconsIcon icon={SearchIcon} size={14} className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search bone..."
                value={boneSearchQuery}
                onChange={(e) => setBoneSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-2.5 bg-[hsl(var(--surface-0))] border border-white/[0.08] rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {/* Bone List */}
          <div className="flex-1 overflow-y-auto border border-white/[0.08] rounded-xl bg-[hsl(var(--surface-0))] p-1.5 custom-scrollbar text-xs font-mono space-y-0.5">
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
                      bone.parent === null ? 8 : bone.parent === 'Hips' ? 16 : 24
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
                        className="p-0.5 hover:text-white"
                      >
                        <HugeiconsIcon
                          icon={isExpanded ? ChevronDown : ChevronRight}
                          size={12}
                          className="w-3 h-3 text-zinc-400"
                        />
                      </button>
                    ) : (
                      <span className="w-3" />
                    )}
                    <span className="truncate">{bone.name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {bone.position[1].toFixed(1)}m
                  </span>
                </div>
              );
            })}
          </div>

          {/* Bone Actions */}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => {
                const parent = selectedBone || 'Hips';
                const newName = `Bone_${bones.length + 1}`;
                addBone({
                  name: newName,
                  parent,
                  position: [0, 1.2, 0],
                  rotation: [0, 0, 0],
                });
                toast.success(`Added bone: ${newName}`);
              }}
              className="flex-1 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-[11px] font-semibold text-zinc-200 flex items-center justify-center gap-1 cursor-pointer"
            >
              <HugeiconsIcon icon={Plus} size={14} className="w-3.5 h-3.5 text-primary" />
              <span>Add Child Bone</span>
            </button>
            {selectedBone && selectedBone !== 'Hips' && (
              <button
                onClick={() => {
                  deleteBone(selectedBone);
                  toast.info(`Deleted ${selectedBone}`);
                }}
                className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 cursor-pointer"
                title="Delete Selected Bone"
              >
                <HugeiconsIcon icon={Trash2} size={14} className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* WEIGHT PAINTING TAB */}
      {activeTab === 'weights' && (
        <div className="flex-1 flex flex-col overflow-y-auto p-3 space-y-3.5 custom-scrollbar">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wide">Skinning Brush</span>
            <p className="text-[10px] text-zinc-400">Interactive vertex weight smoothing and painting</p>
          </div>

          <div className="p-2.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Brush Radius</span>
                <span className="font-mono text-primary font-bold">{brushRadius.toFixed(2)}m</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.5"
                step="0.05"
                value={brushRadius}
                onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
                className="w-full accent-primary h-1 bg-white/20 rounded cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Brush Strength</span>
                <span className="font-mono text-primary font-bold">{(brushStrength * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={brushStrength}
                onChange={(e) => setBrushStrength(parseFloat(e.target.value))}
                className="w-full accent-primary h-1 bg-white/20 rounded cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Falloff</span>
                <span className="font-mono text-zinc-300 capitalize">{brushFalloff}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['smooth', 'linear', 'sphere'] as const).map((fo) => (
                  <button
                    key={fo}
                    onClick={() => setBrushFalloff(fo)}
                    className={`py-1 rounded text-[10px] font-semibold capitalize border ${
                      brushFalloff === fo
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/[0.08] bg-[hsl(var(--surface-1))] text-zinc-400'
                    }`}
                  >
                    {fo}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROPERTIES TAB */}
      {activeTab === 'properties' && activeBoneData && (
        <div className="flex-1 flex flex-col overflow-y-auto p-3 space-y-3 custom-scrollbar">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wide">Bone Transform</span>
            <div className="p-2.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] space-y-2">
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400">Bone Name</span>
                <input
                  type="text"
                  value={activeBoneData.name}
                  onChange={(e) => updateBoneName(activeBoneData.name, e.target.value)}
                  className="w-full h-7 px-2 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded text-xs text-white"
                />
              </div>

              <div className="space-y-1 font-mono text-xs pt-1">
                <span className="text-[10px] text-zinc-400 font-sans block">Position (m)</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center px-1.5 py-1 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08]">
                      <span className={`text-[10px] font-bold mr-1 ${i === 0 ? 'text-red-400' : i === 1 ? 'text-emerald-400' : 'text-sky-400'}`}>{axis}</span>
                      <input
                        type="number"
                        step="0.05"
                        value={activeBoneData.position[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const nextPos: [number, number, number] = [...activeBoneData.position];
                          nextPos[i] = val;
                          updateBonePosition(activeBoneData.name, nextPos);
                        }}
                        className="w-full bg-transparent text-white outline-none text-[11px]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Save & Continue */}
      <div className="p-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-0))]">
        <button
          onClick={handleApplyAndContinue}
          className="w-full py-2 rounded-xl bg-primary text-black font-black text-xs flex items-center justify-center gap-1.5 shadow-md hover:bg-primary/90 transition-all cursor-pointer"
        >
          <HugeiconsIcon icon={CheckIcon} size={14} className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Save Rig &amp; Animate</span>
        </button>
      </div>
    </div>
  );
};
