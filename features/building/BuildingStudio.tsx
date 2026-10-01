'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Building2,
  Download,
  Grid,
  Layers,
  Palette,
  Eye,
  Sliders,
  Sparkles,
  Undo2,
  Redo2,
  Square,
  FileCode,
} from 'lucide-react';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import BuildingViewport from './components/BuildingViewport';
import BuildingPlanEditor from './components/BuildingPlanEditor';
import BuildingInspector from './components/BuildingInspector';
import BuildingStylePanel from './components/BuildingStylePanel';
import BuildingPalette from './components/BuildingPalette';
import BuildingTextures from './components/BuildingTextures';

import useBuildingDocument from './hooks/useBuildingDocument';
import useBuildingCompile from './hooks/useBuildingCompile';
import { ensureStarterGraph } from './utils/building/edits';
import './pages/BuildingGenPage.css';

export const BuildingStudio: React.FC = () => {
  const { navigateToTool } = useWorkspace();

  const [tab, setTab] = useState<'preview' | 'plan'>('preview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orthographic, setOrthographic] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const [rightTab, setRightTab] = useState<'inspector' | 'style' | 'textures'>('inspector');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const onError = useCallback((text: string) => setErrorMessage(text), []);

  const {
    doc,
    name,
    setName,
    commit,
    history,
    dirty,
  } = useBuildingDocument({ onError });

  const compiled = useBuildingCompile(doc);

  const canUndo = history?.past?.length > 0;
  const canRedo = history?.future?.length > 0;

  return (
    <div className="w-full h-full flex flex-col bg-[#080808] text-neutral-100 select-none overflow-hidden relative font-sans">
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
            <Building2 className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm tracking-wide text-neutral-100">Building Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
              PROCEDURAL
            </span>
          </div>
        </div>

        {/* Center Tab Toggle (3D Preview vs 2D Plan) */}
        <div className="flex items-center bg-[#161616] p-0.5 rounded-lg border border-white/[0.08]">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              tab === 'preview' ? 'bg-primary text-black' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            3D Preview
          </button>
          <button
            onClick={() => setTab('plan')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              tab === 'plan' ? 'bg-primary text-black' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            2D Footprint Plan
          </button>
        </div>

        {/* Undo / Redo / Grid / Action Controls */}
        <div className="flex items-center gap-2">
          <SimpleTooltip label="Undo">
            <button
              onClick={() => history?.undo?.()}
              disabled={!canUndo}
              className="p-1.5 rounded-lg bg-[#181818] border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Redo">
            <button
              onClick={() => history?.redo?.()}
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
        {/* Left Side: Grammar / Component Palette */}
        <aside className="w-64 border-r border-white/[0.08] bg-[#0e0e0e] flex flex-col z-10 flex-shrink-0">
          <div className="px-3.5 py-2.5 border-b border-white/[0.08] bg-[#121212] flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider text-neutral-400">Node Palette</span>
            <span className="text-[11px] font-mono text-primary">{doc?.nodes?.length || 0} nodes</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-neutral-300">
            <BuildingPalette
              doc={doc}
              selectedId={selectedId}
              onSelectNode={setSelectedId}
              onCommit={commit}
            />
          </div>
        </aside>

        {/* Center: Stage (3D Viewport or 2D Plan Editor) */}
        <main className="flex-1 relative h-full bg-[#080808] overflow-hidden">
          {tab === 'preview' ? (
            <BuildingViewport
              ir={compiled?.ir || null}
              selectedId={selectedId}
              onSelect={setSelectedId}
              orthographic={orthographic}
              showGrid={showGrid}
              frameKey={frameKey}
            />
          ) : (
            <BuildingPlanEditor
              doc={doc}
              selectedId={selectedId}
              onCommit={commit}
            />
          )}

          {/* Compilation Status Overlay */}
          <div className="absolute bottom-3 left-3 bg-[#121212]/80 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-1.5 text-[11px] font-mono text-neutral-400 pointer-events-none flex items-center gap-4">
            <div>
              Status:{' '}
              <span className={compiled?.ir ? 'text-emerald-400' : 'text-amber-400'}>
                {compiled?.ir ? 'Compiled Geometry' : 'Drafting...'}
              </span>
            </div>
            {compiled?.diagnostics?.length > 0 && (
              <div className="text-amber-400">
                {compiled.diagnostics.length} diagnostic{compiled.diagnostics.length > 1 ? 's' : ''}
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="absolute top-3 inset-x-12 mx-auto max-w-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="text-neutral-400 hover:text-white">✕</button>
            </div>
          )}
        </main>

        {/* Right Side: Inspector & Style Tabs */}
        <aside className="w-80 border-r border-white/[0.08] bg-[#0e0e0e] flex flex-col z-10 flex-shrink-0">
          <div className="flex items-center border-b border-white/[0.08] bg-[#121212]">
            <button
              onClick={() => setRightTab('inspector')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                rightTab === 'inspector' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Inspector
            </button>
            <button
              onClick={() => setRightTab('style')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                rightTab === 'style' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              Stylepack
            </button>
            <button
              onClick={() => setRightTab('textures')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                rightTab === 'textures' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Textures
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 text-neutral-300">
            {rightTab === 'inspector' && (
              <BuildingInspector
                doc={doc}
                selectedId={selectedId}
                onCommit={commit}
              />
            )}
            {rightTab === 'style' && (
              <BuildingStylePanel
                doc={doc}
                onCommit={commit}
              />
            )}
            {rightTab === 'textures' && (
              <BuildingTextures
                doc={doc}
                onCommit={commit}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
export default BuildingStudio;
