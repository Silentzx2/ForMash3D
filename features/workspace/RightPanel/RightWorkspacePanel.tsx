import React, { useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpenIcon, PanelRightClose, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';

// Import panels
import { RightPropertyPanel } from './RightPropertyPanel';
import { RightAssetsPanel } from './RightAssetsPanel';
import { LiveExecutionPanel } from './LiveExecutionPanel';
import { UVInspector } from './UVInspector';
import { SegmentInspector } from './SegmentInspector';
import { MeshEditInspector } from './MeshEditInspector';
import { AnimationRightInspector } from '../Animation/AnimationRightInspector';
import { RiggingRightInspector } from '../Rigging/RiggingRightInspector';

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
  const prevIsRunning = React.useRef(isRunning);
  useEffect(() => {
    if (isRunning && !prevIsRunning.current) {
      setRightPanelMode('prompt');
    }
    prevIsRunning.current = isRunning;
  }, [isRunning, setRightPanelMode]);

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
    <div id="right-workspace-panel" className="flex flex-col h-full w-full bg-[#16171B] text-xs select-none overflow-hidden">
      {/* Top Segmented Header (Clean Technical Inspector Navigation) */}
      <div className="h-10 px-2.5 flex items-center justify-between border-b border-white/[0.06] bg-[#16171B] flex-shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-1 p-1 bg-[#1C1D22] border border-white/[0.06] rounded-full studio-pill-track">
            {([
              { id: 'assets', label: 'Assets', icon: (props: any) => <HugeiconsIcon icon={FolderOpenIcon} size={16} {...props} /> },
              { id: 'properties', label: 'Properties', icon: (props: any) => <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} {...props} /> },
            ] as Array<{ id: string; label: string; icon: any }>).map((tab) => {
              const Icon = tab.icon;
              const isActive = currentActiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightPanelMode(tab.id as any)}
                  className={`relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    isActive ? 'bg-[#272930] text-white font-bold shadow-xs' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
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
                className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  rightPanelMode === 'prompt'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
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
            className="p-1.5 rounded-lg text-zinc-400 hover:text-[#F5C542] hover:bg-white/[0.06] transition-colors cursor-pointer flex-shrink-0"
          >
            <HugeiconsIcon icon={PanelRightClose} size={16} className="w-3.5 h-3.5" />
          </button>
        </SimpleTooltip>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 overflow-hidden bg-[#16171B]">
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
        ) : activeTool === 'animation' ? (
          <AnimationRightInspector />
        ) : activeTool === 'rigging' ? (
          <RiggingRightInspector />
        ) : (
          <RightPropertyPanel />
        )}
      </div>
    </div>
  );
};
