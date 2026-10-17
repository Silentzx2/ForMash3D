'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useUIStore } from '@/stores/useUIStore';
import { useViewerStore } from '@/stores/useViewerStore';
import { taskPersistence, WorkspaceSnapshot } from '@/services/taskPersistence';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Bookmark02Icon,
  Cancel,
  CheckIcon,
  Delete02Icon,
  LayersIcon,
  Plus,
  RotateCcwIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { ModelAsset } from '../types';

export const SnapshotMenu: React.FC = () => {
  const { currentAsset, activeTool, navigateToTool, selectAsset, assets = [] } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadList = () => {
    setSnapshots(taskPersistence.loadSnapshots());
  };

  useEffect(() => {
    loadList();
  }, []);

  // Listen for quick-save event from keyboard shortcut (Ctrl/Cmd + S)
  useEffect(() => {
    const handlePrompt = () => {
      setIsOpen(true);
      setIsCreating(true);
      setSnapshotName(`Snapshot ${snapshots.length + 1}`);
      setTimeout(() => inputRef.current?.select(), 50);
    };

    window.addEventListener('saveWorkspaceSnapshotPrompt', handlePrompt);
    return () => window.removeEventListener('saveWorkspaceSnapshotPrompt', handlePrompt);
  }, [snapshots.length]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setIsCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSaveSnapshot = () => {
    const finalName = snapshotName.trim() || `Snapshot ${snapshots.length + 1}`;
    const viewport = useViewerStore.getState().viewport;
    const rightPanelSections = useUIStore.getState().rightPanelSections;

    const saved = taskPersistence.saveSnapshot({
      name: finalName,
      assetId: currentAsset?.id ?? null,
      activeTool: activeTool || 'model',
      rightPanelSections: rightPanelSections || {},
      cameraPosition: viewport?.cameraPosition ?? [0, 1.5, 3],
      cameraTarget: viewport?.target ?? [0, 0.4, 0],
    });

    loadList();
    setIsCreating(false);
    setSnapshotName('');
    toast.success(`Saved snapshot "${saved.name}"`);
  };

  const handleRestore = (snapshot: WorkspaceSnapshot) => {
    // 1. Re-select asset if it still exists in the library
    if (snapshot.assetId) {
      const foundAsset = assets.find((a: ModelAsset) => a.id === snapshot.assetId);
      if (foundAsset) {
        selectAsset(foundAsset.id);
      } else {
        toast.info('Associated model was deleted or unavailable; restored layout, tool & camera.');
      }
    }

    // 2. Open active tool panel
    if (snapshot.activeTool) {
      navigateToTool(snapshot.activeTool as any);
    }

    // 3. Reapply section collapsed states
    if (snapshot.rightPanelSections) {
      useUIStore.getState().setRightPanelSections(snapshot.rightPanelSections);
    }

    // 4. Reframe camera
    if (snapshot.cameraPosition && snapshot.cameraTarget) {
      window.dispatchEvent(
        new CustomEvent('restoreCameraState', {
          detail: {
            cameraPosition: snapshot.cameraPosition,
            cameraTarget: snapshot.cameraTarget,
          },
        })
      );
    }

    setIsOpen(false);
    toast.success(`Restored session "${snapshot.name}"`);
  };

  const handleDelete = (id: string, name: string) => {
    taskPersistence.deleteSnapshot(id);
    loadList();
    toast.success(`Deleted snapshot "${name}"`);
  };

  return (
    <div className="relative" ref={menuRef}>
      <SimpleTooltip label="Workspace Snapshots • Save & Restore session states" side="bottom">
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen) loadList();
          }}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-all shadow-sm cursor-pointer ${
            isOpen
              ? 'bg-primary text-black border-primary'
              : 'bg-[hsl(var(--surface-1))] border-white/[0.08] hover:bg-[hsl(var(--surface-2))] text-zinc-300 hover:text-white'
          }`}
          aria-label="Workspace snapshots"
        >
          <HugeiconsIcon icon={Bookmark02Icon} size={14} className={isOpen ? 'text-black' : 'text-primary'} />
          <span className="hidden md:inline">Snapshots</span>
          {snapshots.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                isOpen ? 'bg-black text-white' : 'bg-[hsl(var(--surface-3))] text-zinc-300'
              }`}
            >
              {snapshots.length}
            </span>
          )}
        </button>
      </SimpleTooltip>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl bg-[#111111]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl p-3 z-50 text-xs text-foreground space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div>
              <span className="font-bold text-xs text-white block">Workspace Snapshots</span>
              <span className="text-[10px] text-zinc-400">Save layout, active mesh & camera angles</span>
            </div>

            {!isCreating && (
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  setSnapshotName(`Snapshot ${snapshots.length + 1}`);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary hover:bg-[#FFE066] text-black font-semibold text-[11px] transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Plus} size={12} />
                <span>Save</span>
              </button>
            )}
          </div>

          {/* New Snapshot Input Box */}
          {isCreating && (
            <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
              <span className="text-[11px] font-semibold text-zinc-300 block">Name your snapshot:</span>
              <input
                ref={inputRef}
                type="text"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSnapshot();
                  if (e.key === 'Escape') setIsCreating(false);
                }}
                placeholder="e.g. Hero Character Framing"
                className="w-full px-2.5 py-1 text-xs rounded bg-[hsl(var(--surface-0))] border border-white/[0.1] text-white outline-none focus:border-primary transition-colors font-mono"
              />
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-2 py-1 rounded text-[10px] text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSnapshot}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-black font-bold text-[10px] hover:bg-[#FFE066] transition-colors"
                >
                  <HugeiconsIcon icon={CheckIcon} size={12} />
                  <span>Confirm Save</span>
                </button>
              </div>
            </div>
          )}

          {/* Snapshots List */}
          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 no-scrollbar">
            {snapshots.length === 0 ? (
              <div className="py-6 text-center text-zinc-500">
                <HugeiconsIcon icon={Bookmark02Icon} size={20} className="mx-auto mb-1 opacity-40 text-primary" />
                <span className="text-xs">No saved snapshots yet.</span>
                <span className="text-[10px] block mt-0.5">Click &ldquo;Save&rdquo; to capture the current state.</span>
              </div>
            ) : (
              snapshots.map((snap) => {
                const dateStr = new Date(snap.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={snap.id}
                    className="p-2 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.06] flex items-center justify-between gap-2 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-white truncate">{snap.name}</div>
                      <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-0.5 font-mono">
                        <span>{dateStr}</span>
                        <span>•</span>
                        <span className="uppercase text-primary">{snap.activeTool}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleRestore(snap)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[hsl(var(--surface-0))] hover:bg-primary hover:text-black text-zinc-300 transition-colors text-[10px] font-bold"
                        title="Restore this session state"
                      >
                        <HugeiconsIcon icon={RotateCcwIcon} size={12} />
                        <span>Restore</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(snap.id, snap.name)}
                        className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete snapshot"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
