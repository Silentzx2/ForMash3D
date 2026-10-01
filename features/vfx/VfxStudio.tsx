'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  Flame,
  Sparkles,
  Download,
  Grid,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Layers,
  HelpCircle,
  X,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

// Import VFX components
import VfxBoard from './components/VfxBoard';
import VfxTimeline from './components/VfxTimeline';
import VfxParamsPanel from './components/VfxParamsPanel';
import VfxPresetsDialog from './components/VfxPresetsDialog';
import VfxSheetDialog from './components/VfxSheetDialog';
import VfxExportDialog from './components/VfxExportDialog';
import VfxShortcuts from './components/VfxShortcuts';
import VfxPreviewHud from './components/VfxPreviewHud';
import VfxViewport from './components/VfxViewport';

// Import hooks & engine
import useVfxDocument from './hooks/useVfxDocument';
import useVfxRuntime from './hooks/useVfxRuntime';
import { compileVfxGraph } from '@/vfx/compile.js';
import { createEmptyVfxDoc } from '@/vfx/doc.js';
import { reset, seekTo } from './utils/vfx/system';

export const VfxStudio: React.FC = () => {
  const { navigateToTool } = useWorkspace();

  // Document & runtime state
  const { doc, setDoc, undo, redo, canUndo, canRedo } = useVfxDocument(null);
  
  // Compile IR from doc
  const compiled = useMemo(() => {
    if (!doc) return { ir: null, diagnostics: [] };
    try {
      return compileVfxGraph(doc);
    } catch (e) {
      console.warn('VFX compile error:', e);
      return { ir: null, diagnostics: [] };
    }
  }, [doc]);

  const { runtime, batches } = useVfxRuntime({ ir: compiled.ir });
  const cameraRef = useRef<any>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);

  // Studio UI state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [timescale, setTimescale] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // Dialog states
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(true);

  // Stats ref for HUD polling
  const statsRef = useRef({ particles: 0, fps: 60, drawCalls: 0 });

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleReset = useCallback(() => {
    if (runtime) {
      reset(runtime);
      setCurrentTime(0);
    }
  }, [runtime]);

  const handleSeek = useCallback((timeSec: number) => {
    if (runtime) {
      seekTo(runtime, timeSec);
      setCurrentTime(timeSec);
    }
  }, [runtime]);

  // Handle selection from node board
  const handleSelectBlock = useCallback((nodeId: string, blockId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedBlockId(blockId);
    if (blockId) {
      setIsParamsOpen(true);
    }
  }, []);

  return (
    <ReactFlowProvider>
      <div className="w-full h-full flex flex-col bg-[hsl(var(--surface-0))] text-zinc-100 select-none overflow-hidden relative">
        {/* Top Control Bar */}
        <header className="h-12 px-3 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex items-center justify-between z-20 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigateToTool('model')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-primary" />
              <span>3D Studio</span>
            </button>

            <div className="h-4 w-px bg-white/[0.1] mx-1" />

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center text-primary">
                <Flame className="w-4 h-4" />
              </div>
              <h1 className="text-xs font-bold text-white tracking-wide">VFX Particle Studio</h1>
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-zinc-400 rounded">
                GPU Emitter Graph
              </span>
            </div>
          </div>

          {/* Center Playback Controls */}
          <div className="flex items-center gap-1.5 bg-[hsl(var(--surface-2))] border border-white/[0.08] px-2 py-0.5 rounded-lg">
            <SimpleTooltip label="Reset Simulation">
              <button
                onClick={handleReset}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
              <button
                onClick={togglePlay}
                className="p-1 px-2 rounded bg-primary text-black font-bold flex items-center gap-1 text-xs hover:bg-primary/90 transition-colors cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
            </SimpleTooltip>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPresetsOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-[hsl(var(--surface-2))] hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Presets</span>
            </button>

            <button
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-[hsl(var(--surface-2))] hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer"
            >
              <Grid className="w-3.5 h-3.5 text-zinc-400" />
              <span>Spritesheet</span>
            </button>

            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-black bg-primary hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <div className="h-4 w-px bg-white/[0.1] mx-0.5" />

            <SimpleTooltip label="Shortcuts">
              <button
                onClick={() => setShortcutsOpen(true)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </SimpleTooltip>
          </div>
        </header>

        {/* Main Studio Body: React Flow Node Board + Right Parameters */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Node Graph Canvas */}
          <div className="flex-1 h-full relative overflow-hidden bg-[hsl(var(--surface-0))]">
            {doc ? (
              <VfxBoard
                doc={doc}
                onChange={setDoc}
                onSelectBlock={handleSelectBlock}
                selectedNodeId={selectedNodeId}
                selectedBlockId={selectedBlockId}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">
                Initializing VFX Graph...
              </div>
            )}

            {/* Floating button to open 3D Preview when closed */}
            {!isPreviewOpen && (
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="absolute bottom-4 right-4 z-20 px-3 py-1.5 rounded-xl bg-primary text-black font-bold text-xs shadow-xl flex items-center gap-1.5 hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Flame className="w-3.5 h-3.5 fill-black" />
                <span>Show 3D Viewport</span>
              </button>
            )}
          </div>

          {/* Live 3D Particle Viewport Dock */}
          {isPreviewOpen && (
            <div className="w-[320px] lg:w-[380px] h-full border-l border-white/[0.08] bg-black relative flex flex-col z-10 flex-shrink-0">
              <div className="px-3 py-1.5 border-b border-white/[0.08] flex items-center justify-between bg-[hsl(var(--surface-0))] z-20">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider">3D Particle Simulation</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="Minimize Viewport"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="flex-1 relative overflow-hidden bg-gradient-to-b from-[#0a0a0a] to-[#040404]">
                <VfxViewport
                  runtime={runtime}
                  batches={batches}
                  playing={isPlaying}
                  timescale={timescale}
                  statsRef={statsRef}
                  showGrid={true}
                  cameraRef={cameraRef}
                />
                <VfxPreviewHud statsRef={statsRef} />
              </div>
            </div>
          )}

          {/* Right Parameters & Inspector Panel */}
          {isParamsOpen && (
            <aside className="w-[340px] h-full border-l border-white/[0.08] bg-[hsl(var(--surface-1))] flex flex-col z-10 flex-shrink-0">
              <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between bg-[hsl(var(--surface-0))]">
                <div className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Parameters</span>
                </div>
                <button
                  onClick={() => setIsParamsOpen(false)}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {selectedBlockId && doc ? (
                  <VfxParamsPanel
                    doc={doc}
                    nodeId={selectedNodeId}
                    blockId={selectedBlockId}
                    onChange={setDoc}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                    <Layers className="w-8 h-8 stroke-[1.5] text-zinc-600 mb-2" />
                    <p className="text-xs font-medium text-zinc-400">No Block Selected</p>
                    <p className="text-[11px] text-zinc-600 mt-1">
                      Click any block inside Spawn, Initialize, or Update nodes to inspect parameters.
                    </p>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Bottom Timeline */}
        <footer className="h-20 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] z-20 flex-shrink-0">
          <VfxTimeline
            playing={isPlaying}
            onTogglePlay={togglePlay}
            currentTime={currentTime}
            onSeek={handleSeek}
            timescale={timescale}
            onChangeTimescale={setTimescale}
            onReset={handleReset}
          />
        </footer>

        {/* Modals & Dialogs */}
        {presetsOpen && (
          <VfxPresetsDialog
            open={presetsOpen}
            onClose={() => setPresetsOpen(false)}
            onSelectPreset={(presetDoc: any) => {
              setDoc(presetDoc);
              setPresetsOpen(false);
            }}
          />
        )}

        {sheetOpen && (
          <VfxSheetDialog
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
          />
        )}

        {exportOpen && doc && (
          <VfxExportDialog
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            doc={doc}
          />
        )}

        {shortcutsOpen && (
          <VfxShortcuts
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
};

export default VfxStudio;
