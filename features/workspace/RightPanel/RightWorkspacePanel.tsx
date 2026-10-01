import React, { useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';


import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpen, PanelRightClose, SlidersHorizontal } from '@hugeicons/core-free-icons';
// Import panels
import { RightPropertyPanel } from './RightPropertyPanel';
import { RightAssetsPanel } from './RightAssetsPanel';
import { LiveExecutionPanel } from './LiveExecutionPanel';
import { UVInspector } from './UVInspector';
import { SegmentInspector } from './SegmentInspector';
import { MeshEditInspector } from './MeshEditInspector';

export const RightWorkspacePanel: React.FC = () => {
  const {
    rightPanelMode,
    setRightPanelMode,
    setIsRightPanelOpen,
    isExecuting,
    activeTask,
    activeTool,
  } = useWorkspace();

  const isRunning = isExecuting || activeTask?.status === 'running' || activeTask?.status === 'queued';

  // Context-aware auto-switching:
  // When generation starts running -> switch to live execution
  useEffect(() => {
    if (isRunning) {
      if (rightPanelMode !== 'prompt') {
        setRightPanelMode('prompt');
      }
    }
  }, [isRunning, rightPanelMode, setRightPanelMode]);

  // When task completes -> switch to properties inspector so user can immediately inspect geometry & export
  useEffect(() => {
    if (activeTask?.status === 'completed') {
      setRightPanelMode('properties');
    }
  }, [activeTask?.status, setRightPanelMode]);

  const currentActiveTab =
    rightPanelMode === 'prompt'
      ? 'prompt'
      : rightPanelMode === 'assets'
      ? 'assets'
      : 'properties';

  return (
    <div id="right-workspace-panel" className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
      {/* Top Segmented Header (Clean Technical Inspector Navigation) */}
      <div className="h-10 px-2.5 flex items-center justify-between border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex gap-1 p-0.5 bg-[hsl(var(--surface-0))] border border-white/[0.06] rounded-lg">
            {([
              { id: 'assets', label: 'Assets', icon: (props: any) => <HugeiconsIcon icon={FolderOpen} size={16} {...props} /> },
                { id: 'properties', label: 'Properties', icon: (props: any) => <HugeiconsIcon icon={SlidersHorizontal} size={16} {...props} /> },
              ] as Array<{ id: string; label: string; icon: any }>).map((tab) => {
                const Icon = tab.icon;
                const isActive = currentActiveTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRightPanelMode(tab.id as any)}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      isActive ? 'bg-[hsl(var(--surface-2))] text-white font-bold' : 'text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
              {isRunning && (
                <button
                  type="button"
                  onClick={() => setRightPanelMode('prompt')}
                  className={`relative flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    rightPanelMode === 'prompt'
                      ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                      : 'text-zinc-400 hover:text-emerald-300'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Running</span>
                </button>
              )}
            </div>
          </div>

        {/* Collapse Panel Button */}
        <SimpleTooltip label="Collapse panel (maximize 3D viewer)" side="left">
          <button
            type="button"
            id="btn-collapse-right-panel"
            onClick={() => setIsRightPanelOpen(false)}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))] transition-colors cursor-pointer flex-shrink-0"
          >
            <HugeiconsIcon icon={PanelRightClose} size={16} className="w-3.5 h-3.5" />
          </button>
        </SimpleTooltip>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 overflow-hidden bg-[hsl(var(--surface-1))]">
        {rightPanelMode === 'prompt' ? (
          <LiveExecutionPanel />
        ) : rightPanelMode === 'assets' ? (
          <RightAssetsPanel />
        ) : activeTool === 'uv' ? (
          <UVInspector />
        ) : activeTool === 'segment' ? (
          <SegmentInspector />
        ) : activeTool === 'edit' ? (
          <MeshEditInspector />
        ) : (
          <RightPropertyPanel />
        )}
      </div>
    </div>
  );
};
