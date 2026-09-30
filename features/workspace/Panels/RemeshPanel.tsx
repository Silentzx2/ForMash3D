import React, { useState, useEffect } from 'react';
import {
  Sliders,
  ChevronDown,
  Check,
  Box,
  Loader2,
  Shield,
  Activity,
  CheckCircle2,
  Terminal,
  ArrowUpRight
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';

export const RemeshPanel: React.FC = () => {
  const router = useRouter();
  const {
    remeshSettings,
    setRemeshSettings,
    runRemeshGeneration,
    isExecuting,
    currentAsset,
    assets,
    selectAsset,
    activeTask,
    setRightPanelMode,
  } = useWorkspace();

  const [meshDropdownOpen, setMeshDropdownOpen] = useState(false);

  const remeshProgress = activeTask?.progress ?? 0;
  const isRemeshActive = isExecuting && activeTask?.type === 'remesh';

  const getRemeshStepState = (): 'pending' | 'active' | 'completed' => {
    if (!isRemeshActive) return 'pending';
    if (activeTask?.status === 'completed' || remeshProgress >= 100) return 'completed';
    return 'active';
  };

  // Auto-select first asset if none currently selected
  useEffect(() => {
    if (!currentAsset && assets.length > 0) {
      selectAsset(assets[0].id);
    }
  }, [currentAsset, assets, selectAsset]);

  const handleVariantClick = (variant: 'V1K' | 'V4K') => {
    setRemeshSettings(prev => ({ ...prev, variant }));
  };

  const handlePolyTypeClick = (polyType: 'tri' | 'quad') => {
    setRemeshSettings(prev => ({ ...prev, polyType }));
  };

  return (
    <div id="panel-remesh" className="flex flex-col h-full overflow-hidden bg-[hsl(var(--surface-1))] text-xs select-none">
      {/* Panel Header with Segmented Navigation Bar */}
      <div className="px-2.5 pt-2.5 pb-2 border-b border-white/[0.08] flex-shrink-0 space-y-2 bg-[hsl(var(--surface-2))]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-white flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-primary" />
            <span>Quad Remesh &amp; Retopo</span>
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
            {remeshSettings.variant} · {remeshSettings.polyType.toUpperCase()}
          </span>
        </div>

      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 pb-2 space-y-2 scrollbar-none pr-1">
        <div className="space-y-2">
            {/* Target 3D Mesh Selector Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-300 flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5 text-primary" />
                  <span>Target 3D Mesh</span>
                </span>
                {currentAsset ? (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                    Active
                  </span>
                ) : (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    None
                  </span>
                )}
              </div>

              {currentAsset ? (
                <div className="relative">
                  <button
                    id="btn-remesh-mesh-select"
                    type="button"
                    onClick={() => setMeshDropdownOpen(!meshDropdownOpen)}
                    className="w-full flex items-center justify-between p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-white/[0.16] hover:bg-[hsl(var(--surface-2))] transition-all text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-1">
                      <div className="w-6 h-6 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                        <Box className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold text-white truncate leading-tight">
                          {currentAsset.name || 'Current 3D Model'}
                        </div>
                        <div className="text-[8px] text-zinc-400 flex items-center gap-1 truncate">
                          <span>{currentAsset.triangles ? `${currentAsset.triangles.toLocaleString()} tris` : '3D Geometry'}</span>
                          <span>•</span>
                          <span className="uppercase">{currentAsset.format || currentAsset.source?.filename?.split('.').pop() || 'GLB'}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${meshDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
                  </button>

                  {meshDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-[hsl(var(--surface-1))] border border-white/[0.12] rounded-xl p-1.5 shadow-2xl z-50 space-y-1 max-h-44 overflow-y-auto">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 px-1.5 py-0.5">
                        Workspace Meshes ({assets.length})
                      </div>
                      {assets.map((asset) => {
                        const isSel = asset.id === currentAsset.id;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => {
                              selectAsset(asset.id);
                              setMeshDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-1.5 rounded-lg text-left text-[10px] transition-colors ${
                              isSel ? 'bg-primary text-black font-bold' : 'text-zinc-300 hover:bg-[hsl(var(--surface-2))] hover:text-white'
                            }`}
                          >
                            <span className="truncate">{asset.name}</span>
                            {isSel && <Check className="w-3 h-3 text-black flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-white/[0.02] border border-dashed border-white/[0.1] text-center space-y-1">
                  <div className="text-[10px] text-zinc-400">Generate or upload a model first</div>
                  <button
                    type="button"
                    onClick={() => router.push('/workspace/generate')}
                    className="px-2.5 py-1 rounded-md bg-primary text-black font-bold text-[9px] hover:bg-[hsl(var(--primary)/0.9)] transition-colors cursor-pointer"
                  >
                    Go to Generate 3D Model
                  </button>
                </div>
              )}
            </div>

            {/* FastMesh Variant */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider text-[10px]">FastMesh Variant</span>
                <span className="font-mono font-bold text-xs text-primary">{remeshSettings.variant}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(['V1K', 'V4K'] as const).map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => handleVariantClick(variant)}
                    className={`py-1.5 rounded-lg font-bold text-[10px] transition-all cursor-pointer ${
                      remeshSettings.variant === variant
                        ? 'bg-primary text-black shadow-sm font-black'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {variant} · ~{variant === 'V1K' ? '1K' : '4K'} vertices
                  </button>
                ))}
              </div>
              <p className="text-[8px] text-zinc-500 font-mono">
                FastMesh output is fixed by the selected V1K/V4K variant; arbitrary vertex targets are not supported.
              </p>
            </div>

            {/* Output Polygon Type */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider text-[10px]">Output Polygon Type</span>
                <span className="font-mono font-bold text-xs text-primary">{remeshSettings.polyType.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(['tri', 'quad'] as const).map((polyType) => (
                  <button
                    key={polyType}
                    type="button"
                    onClick={() => handlePolyTypeClick(polyType)}
                    className={`py-1.5 rounded-lg font-bold text-[10px] uppercase transition-all cursor-pointer ${
                      remeshSettings.polyType === polyType
                        ? 'bg-primary text-black shadow-sm font-black'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {polyType === 'quad' ? 'Quads' : 'Triangles'}
                  </button>
                ))}
              </div>
            </div>

            {/* FastMesh Contract */}
            <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[9.5px] text-zinc-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span>Source detail is checked by the production QA pipeline; FastMesh itself uses fixed V1K/V4K variants.</span>
            </div>

            {/* Live OpenX Clay Pipeline Tracker when remeshing is active */}
            {isRemeshActive && (
              <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-primary/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-white flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
                    <span>Pipeline Running</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-primary">
                    {remeshProgress}%
                  </span>
                </div>

                <div className="text-[9px] text-zinc-300 font-mono break-words leading-tight bg-black/40 p-1.5 rounded-lg border border-white/[0.06]">
                  {activeTask?.currentStep || 'Executing retopology pipeline...'}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-white/[0.06] rounded-full h-1 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, remeshProgress))}%` }}
                  />
                </div>

                {/* Retopology Pipeline Step */}
                <div className="space-y-1 pt-0.5">
                  {[
                    { id: 1, name: 'Mesh Retopology' },
                  ].map((s) => {
                    const st = getRemeshStepState();
                    return (
                      <div key={s.id} className="flex items-center justify-between text-[9px] px-1">
                        <div className="flex items-center gap-1.5">
                          {st === 'completed' && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                          {st === 'active' && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                            </span>
                          )}
                          {st === 'pending' && <span className="text-zinc-600">○</span>}
                          <span className={st === 'active' ? 'text-primary font-bold' : st === 'completed' ? 'text-zinc-300' : 'text-zinc-500'}>
                            {s.name}
                          </span>
                        </div>
                        <span className="text-[8px] font-mono uppercase text-zinc-500">{st}</span>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setRightPanelMode('prompt')}
                  className="w-full py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white font-bold text-[9px] flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  <Terminal className="w-3 h-3 text-primary" />
                  <span>Inspect Live Execution Logs</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Primary Action Button */}
            <div className="pt-2 border-t border-white/[0.08] space-y-1">
              <button
                id="btn-action-generate-remesh"
                type="button"
                onClick={runRemeshGeneration}
                disabled={isExecuting || (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl)}
                className="w-full h-10 rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.9)] text-black font-black tracking-wider text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_hsl(var(--primary)/0.25)] hover:shadow-[0_6px_20px_hsl(var(--primary)/0.35)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                    <span>Remeshing Topology...</span>
                  </>
                ) : !currentAsset ? (
                  <span>SELECT A MODEL FIRST</span>
                ) : (
                  <>
                    <Sliders className="w-4 h-4 stroke-[2.5]" />
                    <span>OPTIMIZE &amp; REMESH</span>
                  </>
                )}
              </button>

              <p className="text-center text-[9px] text-zinc-400">
                Output: <span className="text-white font-mono font-medium">{remeshSettings.variant} · {remeshSettings.polyType.toUpperCase()}</span>
                {currentAsset?.triangles ? (
                  <span className="text-zinc-500"> (current: {currentAsset.triangles.toLocaleString()})</span>
                ) : null}
              </p>
              <p className="text-center text-[8px] text-zinc-500 font-mono">
                FastMesh {remeshSettings.variant} · {remeshSettings.polyType === 'quad' ? 'Quad' : 'Triangle'} output
              </p>
              {!currentAsset && (
                <p className="text-[9px] text-amber-400/90 text-center">
                  Target mesh required. Select or generate a model above to remesh.
                </p>
              )}
            </div>
          </div>

      </div>
    </div>
  );
};
