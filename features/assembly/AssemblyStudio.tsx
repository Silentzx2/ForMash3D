'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Shirt,
  Sparkles,
  Download,
  Grid,
  Layers,
  MapPin,
  Move,
  Scissors,
  Sliders,
  Undo2,
  Redo2,
  Plus,
} from 'lucide-react';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import AssemblyViewport from './components/AssemblyViewport';
import AssemblyPieceList from './components/AssemblyPieceList';
import AssemblyTransformPanel from './components/AssemblyTransformPanel';
import AssemblyFitPanel from './components/AssemblyFitPanel';
import AssemblyLandmarkPanel from './components/AssemblyLandmarkPanel';

import useAssemblyDocument from './hooks/useAssemblyDocument';
import useAssemblyScene from './hooks/useAssemblyScene';
import useAssemblyFitRun from './hooks/useAssemblyFitRun';
import useAssemblyPicking from './hooks/useAssemblyPicking';

import { getBasePiece, getGarmentPieces, getVisiblePieces } from './utils/assemblyHelpers';
import './pages/AssemblyPage.css';

export const AssemblyStudio: React.FC = () => {
  const { navigateToTool } = useWorkspace();

  const [activeTab, setActiveTab] = useState<'fit' | 'transform' | 'landmarks'>('fit');
  const [showGrid, setShowGrid] = useState(true);
  const [orthographic, setOrthographic] = useState(false);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<any>(null);
  const gizmoDraggingRef = useRef(false);

  const {
    doc,
    ready,
    loading,
    canUndo,
    canRedo,
    undo,
    redo,
    addPieces,
    patchPiece,
    removePiece,
    setBase,
    patchSettings,
  } = useAssemblyDocument({ assemblyId: null });

  const {
    entries,
    loadedPieceIds,
    getEntry,
    getVisibleBounds,
  } = useAssemblyScene(doc);

  const sculptHistoryRef = useRef<any>(null);
  const notifyPreviewReplaced = useCallback((preview: any) => {
    sculptHistoryRef.current?.(preview);
  }, []);

  const fit = useAssemblyFitRun({
    assemblyId: null,
    doc,
    entries,
    getEntry,
    patchPiece,
    gizmoDraggingRef,
    onPreviewReplaced: notifyPreviewReplaced,
  });

  const { handleSelectPointerDown } = useAssemblyPicking({
    shellRef,
    cameraRef,
    entries,
    doc,
    gizmoDraggingRef,
    previews: fit.previews,
    showFitted: fit.showFitted,
  });

  const base = getBasePiece(doc);
  const garments = getGarmentPieces(doc);
  const visiblePieces = getVisiblePieces(doc);
  const selectedPiece = doc?.pieces?.find((p: any) => p.id === doc?.settings?.selectedPieceId) || null;
  const selectedEntry = selectedPiece ? getEntry(selectedPiece.id) : null;

  return (
    <div
      ref={shellRef}
      className="w-full h-full flex flex-col bg-[#080808] text-neutral-100 select-none overflow-hidden relative font-sans"
    >
      {/* Top Header Bar */}
      <header className="h-12 border-b border-white/[0.08] bg-[#0c0c0c] px-4 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <SimpleTooltip label="Back to 3D Workspace">
            <button
              onClick={() => navigateToTool('model')}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </SimpleTooltip>
          <div className="flex items-center gap-2">
            <Shirt className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm tracking-wide text-neutral-100">Assembly &amp; Garment Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
              CONFORMAL FIT
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <SimpleTooltip label="Undo">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-1.5 rounded-lg bg-[#181818] border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Redo">
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-1.5 rounded-lg bg-[#181818] border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </SimpleTooltip>

          <button
            onClick={() => setShowGrid(prev => !prev)}
            className={`p-1.5 rounded-lg border transition-colors ${
              showGrid ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-[#181818] border-white/[0.08] text-neutral-400'
            }`}
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Side: Piece Inventory */}
        <aside className="w-72 border-r border-white/[0.08] bg-[#0e0e0e] flex flex-col z-10 flex-shrink-0">
          <div className="px-3.5 py-2.5 border-b border-white/[0.08] bg-[#121212] flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider text-neutral-400">Assembly Pieces</span>
            <span className="text-[11px] font-mono text-primary">{doc?.pieces?.length || 0} pieces</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 text-neutral-300">
            <AssemblyPieceList
              doc={doc}
              entries={entries}
              selectedPieceId={doc?.settings?.selectedPieceId}
              onSelectPiece={(id: string) => patchSettings({ selectedPieceId: id })}
              onPatchPiece={patchPiece}
              onRemovePiece={removePiece}
              onSetBase={setBase}
            />
          </div>
        </aside>

        {/* Center: 3D Viewport */}
        <main
          className="flex-1 relative h-full bg-[#080808] overflow-hidden"
          onPointerDown={handleSelectPointerDown}
        >
          <AssemblyViewport
            doc={doc}
            entries={entries}
            previews={fit.previews}
            showFitted={fit.showFitted}
            selectedPieceId={doc?.settings?.selectedPieceId}
            onSelectPiece={(id: string) => patchSettings({ selectedPieceId: id })}
            onPatchPiece={patchPiece}
            gizmoDraggingRef={gizmoDraggingRef}
            orthographic={orthographic}
            showGrid={showGrid}
          />

          {/* Telemetry Overlay */}
          <div className="absolute bottom-3 left-3 bg-[#121212]/80 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-1.5 text-[11px] font-mono text-neutral-400 pointer-events-none flex items-center gap-4">
            <div>
              Base Avatar: <span className="text-primary">{base?.name || 'None selected'}</span>
            </div>
            <div>
              Garments: <span className="text-neutral-200">{garments?.length || 0}</span>
            </div>
            <div>
              Fitted:{' '}
              <span className={fit.showFitted ? 'text-emerald-400' : 'text-neutral-400'}>
                {fit.showFitted ? 'Active' : 'Unfitted'}
              </span>
            </div>
          </div>
        </main>

        {/* Right Side: Conformal Fit & Controls */}
        <aside className="w-80 border-r border-white/[0.08] bg-[#0e0e0e] flex flex-col z-10 flex-shrink-0">
          <div className="flex items-center border-b border-white/[0.08] bg-[#121212]">
            <button
              onClick={() => setActiveTab('fit')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'fit' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              Conformal Fit
            </button>
            <button
              onClick={() => setActiveTab('transform')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'transform' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              Transform
            </button>
            <button
              onClick={() => setActiveTab('landmarks')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'landmarks' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Landmarks
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 text-neutral-300">
            {activeTab === 'fit' && (
              <AssemblyFitPanel
                doc={doc}
                fit={fit}
                selectedPiece={selectedPiece}
                onPatchPiece={patchPiece}
                onPatchSettings={patchSettings}
              />
            )}
            {activeTab === 'transform' && (
              <AssemblyTransformPanel
                selectedPiece={selectedPiece}
                onPatchPiece={patchPiece}
              />
            )}
            {activeTab === 'landmarks' && (
              <AssemblyLandmarkPanel
                doc={doc}
                basePiece={base}
                onPatchPiece={patchPiece}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
export default AssemblyStudio;
