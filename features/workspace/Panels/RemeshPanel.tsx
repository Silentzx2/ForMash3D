import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import { MeshUploadStatus } from './MeshUploadStatus';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ActivityIcon,
  ArrowUpRightIcon,
  Box,
  CheckIcon,
  CheckmarkCircle02Icon,
  ChevronDown,
  CircleDashedIcon,
  LoaderCircle,
  Shield01Icon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UploadIcon,
} from '@hugeicons/core-free-icons';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';

export const RemeshPanel: React.FC = () => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    showWireframe,
    setShowWireframe,
  } = useWorkspace();

  const [meshDropdownOpen, setMeshDropdownOpen] = useState(false);
  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const uploadActive = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

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

  const handleUploadNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const asset = await uploadMesh(file);
      if (asset) setMeshDropdownOpen(false);
    }
    e.currentTarget.value = '';
  };

  const handleVariantClick = (variant: 'V1K' | 'V4K') => {
    React.startTransition(() => {
      setRemeshSettings(prev => ({ ...prev, variant }));
    });
  };

  const handlePolyTypeClick = (polyType: 'tri' | 'quad') => {
    React.startTransition(() => {
      setRemeshSettings(prev => ({ ...prev, polyType }));
    });
  };

  const polycountPresets = [
    { label: '5k', value: 5000, desc: 'Mobile / VR' },
    { label: '20k', value: 20000, desc: 'Indie Game' },
    { label: '50k', value: 50000, desc: 'Mid-Poly' },
    { label: '100k', value: 100000, desc: 'AAA Hero' },
  ] as const;

  return (
    <div id="panel-remesh" className="flex flex-col h-full overflow-hidden studio-dock text-xs select-none">
      {/* Panel Header with Wireframe preview toggle */}
      <div className="px-3 pt-3 pb-2.5 border-b border-white/[0.06] flex-shrink-0 space-y-2 bg-[#121316]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-white flex items-center gap-1.5">
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-3.5 h-3.5 text-[#F5C542]" />
            <span>Quad Remesh &amp; Retopo</span>
          </span>
          <div className="flex items-center gap-1.5">
            {/* Embedded Wireframe Preview Toggle */}
            <button
              type="button"
              id="btn-toggle-wireframe-header"
              onClick={() => setShowWireframe(!showWireframe)}
              className={`px-2 py-0.5 rounded-lg border text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                showWireframe
                  ? 'bg-[#F5C542] text-black border-[#F5C542] shadow-[0_0_8px_rgba(245,197,66,0.3)] font-black'
                  : 'bg-white/[0.04] text-zinc-400 border-white/[0.08] hover:text-white hover:bg-white/[0.08]'
              }`}
              title="Toggle wireframe topology view in 3D viewport"
            >
              <HugeiconsIcon icon={CircleDashedIcon} size={12} className="w-3 h-3" />
              <span>Wire {showWireframe ? 'ON' : 'OFF'}</span>
            </button>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F5C542]/10 text-[#F5C542] border border-[#F5C542]/30 font-bold">
              {remeshSettings.variant} · {remeshSettings.polyType.toUpperCase()}
            </span>
            <ToolContextHelp tool="remesh" label="Auto Retopo Help" />
          </div>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 pb-3 space-y-2.5 scrollbar-none pr-1.5">
        <div className="space-y-2.5">
          <MeshUploadStatus state={meshUploadState} />

          {/* Target 3D Mesh Selector Card */}
          <div className="studio-card p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-300 flex items-center gap-1.5">
                <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-[#F5C542]" />
                <span>Target 3D Mesh</span>
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf,.obj,.fbx,.stl,.ply"
                  onChange={handleUploadNew}
                  className="hidden"
                  disabled={uploadActive}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadActive}
                  className="px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 text-[9px] font-semibold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <HugeiconsIcon icon={UploadIcon} size={16} className="w-2.5 h-2.5 text-[#F5C542]" />
                  <span>Upload</span>
                </button>
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
            </div>

            {currentAsset ? (
              <div className="relative">
                <button
                  id="btn-remesh-mesh-select"
                  type="button"
                  onClick={() => setMeshDropdownOpen(!meshDropdownOpen)}
                  className="w-full flex items-center justify-between p-1.5 rounded-lg bg-[#16171B] border border-white/[0.06] hover:border-white/[0.16] hover:bg-[#242732] transition-all text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-1">
                    <div className="w-6 h-6 rounded bg-[#1D1F26] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-[#F5C542]" />
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
                  <HugeiconsIcon icon={ChevronDown} size={16} className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${meshDropdownOpen ? 'rotate-180 text-[#F5C542]' : ''}`} />
                </button>

                {meshDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-[#16171B] border border-white/[0.12] rounded-xl p-1.5 shadow-2xl z-50 space-y-1 max-h-44 overflow-y-auto">
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
                            isSel ? 'bg-[#F5C542] text-black font-bold' : 'text-zinc-300 hover:bg-[#1D1F26] hover:text-white'
                          }`}
                        >
                          <span className="truncate">{asset.name}</span>
                          {isSel && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3 h-3 text-black flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-white/[0.02] border border-dashed border-white/[0.1] text-center space-y-1.5">
                <div className="text-[10px] text-zinc-400">Select a model from workspace or upload a 3D mesh</div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-[9px] transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <HugeiconsIcon icon={UploadIcon} size={16} className="w-2.5 h-2.5 text-[#F5C542]" />
                    <span>Upload Mesh</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/workspace/generate')}
                    className="px-2.5 py-1 rounded-md bg-[#F5C542] text-black font-bold text-[9px] hover:bg-[#FFE066] transition-colors cursor-pointer"
                  >
                    Generate New
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* FastMesh Variant Card */}
          <div className="studio-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white uppercase tracking-wider text-[10px]">FastMesh Variant</span>
              <span className="font-mono font-bold text-xs text-[#F5C542]">{remeshSettings.variant}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['V1K', 'V4K'] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => handleVariantClick(variant)}
                  className={`py-1.5 rounded-lg font-bold text-[10px] transition-all cursor-pointer ${
                    remeshSettings.variant === variant
                      ? 'bg-[#F5C542] text-black shadow-sm font-black'
                      : 'bg-[#16171B] text-zinc-400 hover:text-white border border-white/[0.06]'
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

          {/* Interactive Polycount Budget Slider with Preset Chips */}
          <div className="studio-card border-[#F5C542]/20 bg-[#F5C542]/5 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-200">Polycount Budget</div>
                <div className="text-[8px] text-zinc-400">Target budget applied after FastMesh pass</div>
              </div>
              <span className="font-mono font-bold text-xs text-[#F5C542]">
                {remeshSettings.targetPolycount.toLocaleString()} tris
              </span>
            </div>

            {/* Quick preset chips: 5k, 20k, 50k, 100k */}
            <div className="grid grid-cols-4 gap-1">
              {polycountPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    React.startTransition(() => {
                      setRemeshSettings(prev => ({ ...prev, targetPolycount: preset.value }));
                    });
                  }}
                  className={`py-1.5 px-0.5 rounded-lg text-center border transition-all cursor-pointer ${
                    remeshSettings.targetPolycount === preset.value
                      ? 'bg-[#F5C542] text-black border-[#F5C542] font-black shadow-sm'
                      : 'bg-[#16171B] text-zinc-400 border-white/[0.06] hover:text-white hover:border-[#F5C542]/30'
                  }`}
                >
                  <span className="block text-[9.5px] font-bold">{preset.label}</span>
                  <span className="block text-[7px] opacity-70 leading-tight">{preset.desc}</span>
                </button>
              ))}
            </div>

            <input
              aria-label="Final production polycount"
              type="range"
              min={1000}
              max={200000}
              step={1000}
              value={remeshSettings.targetPolycount}
              onChange={(e) => {
                const val = Number(e.target.value);
                React.startTransition(() => {
                  setRemeshSettings(prev => ({ ...prev, targetPolycount: val }));
                });
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
            />
          </div>

          {/* Output Polygon Type Card */}
          <div className="studio-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white uppercase tracking-wider text-[10px]">Output Polygon Type</span>
              <span className="font-mono font-bold text-xs text-[#F5C542]">{remeshSettings.polyType.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['tri', 'quad'] as const).map((polyType) => (
                <button
                  key={polyType}
                  type="button"
                  onClick={() => handlePolyTypeClick(polyType)}
                  className={`py-1.5 rounded-lg font-bold text-[10px] uppercase transition-all cursor-pointer ${
                    remeshSettings.polyType === polyType
                      ? 'bg-[#F5C542] text-black shadow-sm font-black'
                      : 'bg-[#16171B] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  {polyType === 'quad' ? 'Quads (Quad-Dominant)' : 'Triangles (Game Meshes)'}
                </button>
              ))}
            </div>
          </div>

          {/* FastMesh Contract Callout */}
          <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[9.5px] text-zinc-400 flex items-center gap-2">
            <HugeiconsIcon icon={Shield01Icon} size={16} className="w-3.5 h-3.5 text-[#F5C542] flex-shrink-0" />
            <span>Source detail is checked by the production QA pipeline; FastMesh itself uses fixed V1K/V4K variants.</span>
          </div>

          {/* Live Pipeline Tracker when remeshing is active */}
          {isRemeshActive && (
            <div className="studio-card border-[#F5C542]/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white flex items-center gap-1.5">
                  <HugeiconsIcon icon={ActivityIcon} size={16} className="w-3.5 h-3.5 text-[#F5C542] animate-pulse" />
                  <span>Pipeline Running</span>
                </span>
                <span className="text-[10px] font-mono font-bold text-[#F5C542]">
                  {remeshProgress}%
                </span>
              </div>

              <div className="text-[9px] text-zinc-300 font-mono break-words leading-tight bg-black/40 p-2 rounded-lg border border-white/[0.06]">
                {activeTask?.currentStep || 'Executing retopology pipeline...'}
              </div>

              {/* Progress bar */}
              <div className="w-full bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-[#F5C542] transition-all duration-300 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, remeshProgress))}%` }}
                />
              </div>

              {/* Pipeline Step */}
              <div className="space-y-1 pt-0.5">
                {[
                  { id: 1, name: 'Mesh Retopology' },
                ].map((s) => {
                  const st = getRemeshStepState();
                  return (
                    <div key={s.id} className="flex items-center justify-between text-[9px] px-1">
                      <div className="flex items-center gap-1.5">
                        {st === 'completed' && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-2.5 h-2.5 text-emerald-400" />}
                        {st === 'active' && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F5C542] opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F5C542]" />
                          </span>
                        )}
                        {st === 'pending' && <span className="text-zinc-600">○</span>}
                        <span className={st === 'active' ? 'text-[#F5C542] font-bold' : st === 'completed' ? 'text-zinc-300' : 'text-zinc-500'}>
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
                <HugeiconsIcon icon={TerminalIcon} size={16} className="w-3 h-3 text-[#F5C542]" />
                <span>Inspect Live Execution Logs</span>
                <HugeiconsIcon icon={ArrowUpRightIcon} size={16} className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Primary Action Button in Warm Studio Gold */}
          <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
            <button
              id="btn-action-generate-remesh"
              type="button"
              onClick={runRemeshGeneration}
              disabled={isExecuting || (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl && !currentAsset?.source?.fileId && !currentAsset?.fileId)}
              className="w-full h-11 rounded-xl bg-[#F5C542] hover:bg-[#FFE066] text-black font-black tracking-wider text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(245,197,66,0.25)] hover:shadow-[0_6px_20px_rgba(245,197,66,0.35)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExecuting ? (
                <>
                  <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin text-black" />
                  <span>Remeshing Topology...</span>
                </>
              ) : !currentAsset ? (
                <span>SELECT A MODEL FIRST</span>
              ) : (
                <>
                  <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4 stroke-[2.5]" />
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
