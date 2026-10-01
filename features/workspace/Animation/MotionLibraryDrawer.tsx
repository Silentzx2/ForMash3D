'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MOTION_FAST } from '@/lib/motion';
import { useAnimationStore, AnimationClipItem } from '@/stores/useAnimationStore';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { Bone, Cancel, Clock, Download, FolderOpen, GaugeIcon, Pause, Play, Search, Sparkles, Trash2 } from '@hugeicons/core-free-icons';
export const MotionLibraryDrawer: React.FC = () => {
  const { isMotionLibraryOpen, setIsMotionLibraryOpen, animations, currentAnimationId, setCurrentAnimationId, isPlaying, togglePlay, setAnimations } =
    useAnimationStore();
  const { currentAsset } = useWorkspace();

  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');

  const categories = ['All', 'Idle', 'Walk', 'Run', 'Jump', 'Actions', 'Custom'];

  const filtered = animations.filter((clip) => {
    const matchCategory = category === 'All' || clip.category === category;
    const matchSearch = !search || clip.name.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  const handleSelectClip = (clip: AnimationClipItem) => {
    setCurrentAnimationId(clip.id);
    toast.success(`Loaded "${clip.name}"`, {
      description: `${clip.duration.toFixed(1)}s • ${clip.fps} FPS • ${clip.skeletonId || 'core'} skeleton`,
    });
  };

  const handleDeleteClip = (id: string, name: string) => {
    setAnimations(animations.filter((a) => a.id !== id));
    toast.info(`Removed "${name}" from Library`);
  };

  const handleExportClip = (clip: AnimationClipItem) => {
    if (clip.motionJsonUrl) {
      window.open(clip.motionJsonUrl, '_blank');
    } else {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(clip, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `${clip.name.toLowerCase().replace(/\s+/g, '_')}_motion.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success(`Exported ${clip.name}.json`);
    }
  };

  if (!isMotionLibraryOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsMotionLibraryOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        />

        {/* Drawer Container */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={MOTION_FAST}
          className="relative w-full max-w-md bg-[hsl(var(--surface-1))] border-l border-white/[0.08] shadow-2xl flex flex-col h-full z-10 select-none text-zinc-200"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[hsl(var(--surface-0))]">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <HugeiconsIcon icon={FolderOpen} size={16} className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  Motion Library
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300">
                    {animations.length}
                  </span>
                </h2>
                <p className="text-[11px] text-zinc-400">Re-usable generated and preset motion assets</p>
              </div>
            </div>

            <button
              onClick={() => setIsMotionLibraryOpen(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
            </button>
          </div>

          {/* Search & Categories */}
          <div className="p-3 border-b border-white/[0.08] space-y-2.5 bg-[hsl(var(--surface-1))]">
            <div className="relative">
              <HugeiconsIcon icon={Search} size={16} className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search motion assets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-[hsl(var(--surface-2))] border border-white/[0.08] rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                    category === cat
                      ? 'bg-primary text-black font-bold shadow-xs'
                      : 'bg-[hsl(var(--surface-2))] text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Motion List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4">
                <HugeiconsIcon icon={Sparkles} size={16} className="w-8 h-8 text-zinc-600 mb-2" />
                <p className="text-xs font-semibold text-zinc-400">No motions found</p>
                <p className="text-[11px] text-zinc-500 mt-1">Try another category or prompt generation</p>
              </div>
            ) : (
              filtered.map((clip) => {
                const isSelected = clip.id === currentAnimationId;
                return (
                  <div
                    key={clip.id}
                    onClick={() => handleSelectClip(clip)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                      isSelected
                        ? 'bg-primary/5 border-primary/40 shadow-xs'
                        : 'bg-[hsl(var(--surface-2))] border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelected) {
                              togglePlay();
                            } else {
                              handleSelectClip(clip);
                            }
                          }}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-transform active:scale-90 ${
                            isSelected && isPlaying
                              ? 'bg-primary text-black'
                              : 'bg-white/[0.06] text-white hover:bg-primary hover:text-black'
                          }`}
                        >
                          {isSelected && isPlaying ? <HugeiconsIcon icon={Pause} size={16} className="w-3.5 h-3.5" /> : <HugeiconsIcon icon={Play} size={16} className="w-3.5 h-3.5 ml-0.5" />}
                        </button>
                        <div>
                          <h4 className="text-xs font-bold text-white group-hover:text-primary transition-colors">
                            {clip.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400 font-mono">
                            <span className="flex items-center gap-0.5">
                              <HugeiconsIcon icon={Clock} size={16} className="w-3 h-3 text-zinc-500" />
                              {clip.duration.toFixed(1)}s
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-0.5">
                              <HugeiconsIcon icon={GaugeIcon} size={16} className="w-3 h-3 text-zinc-500" />
                              {clip.fps} FPS
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-0.5 text-zinc-400">
                              <HugeiconsIcon icon={Bone} size={16} className="w-3 h-3 text-zinc-500" />
                              {clip.skeletonId || 'core'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportClip(clip);
                          }}
                          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10"
                          title="Export motion.json"
                        >
                          <HugeiconsIcon icon={Download} size={16} className="w-3.5 h-3.5" />
                        </button>
                        {!clip.isBuiltin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClip(clip.id, clip.name);
                            }}
                            className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete motion"
                          >
                            <HugeiconsIcon icon={Trash2} size={16} className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Drawer Footer */}
          <div className="p-3 border-t border-white/[0.08] bg-[hsl(var(--surface-0))] flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">
              Active model: <strong className="text-white">{currentAsset?.name || 'Character Mannequin'}</strong>
            </span>
            <button
              onClick={() => setIsMotionLibraryOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-primary text-black font-bold text-xs hover:bg-primary/90 transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
