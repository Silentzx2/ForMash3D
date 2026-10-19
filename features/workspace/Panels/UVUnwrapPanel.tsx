import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import { MeshUploadStatus } from './MeshUploadStatus';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, Cancel, FolderOpenIcon, SparklesIcon, UploadIcon, ZapIcon } from '@hugeicons/core-free-icons';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';
export const UVUnwrapPanel: React.FC = () => {
  const {
    currentAsset,
    setCurrentAsset,
    assets,
    isExecuting,
    activeTask,
    runUVUnwrapGeneration,
  } = useWorkspace();

  const [outputFormat, setOutputFormat] = useState('glb');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const uploadActive = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

  const isRunning = isExecuting && activeTask?.type === 'uv';

  const handleStartUnwrap = async () => {
    await runUVUnwrapGeneration({
      distortionThreshold: 1.25,
      packMethod: 'blender',
      outputFormat,
      saveIndividualParts: false,
    });
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const handleUploadNew = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadMesh(file);
    e.currentTarget.value = '';
  };

  return (
    <div id="panel-uv-unwrap" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none">
      {/* Top Header */}
      <div className="px-3 py-2.5 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-xs text-white flex items-center gap-1.5">
          <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
          <span>Smart UV Unwrapping</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">
            PartUV UV Pipeline
          </span>
          <ToolContextHelp tool="uv" label="Auto UV Help" />
        </div>
      </div>

      <div className="p-3 space-y-4 flex-1">
        <MeshUploadStatus state={meshUploadState} />
        <div className="space-y-4">
            {/* Step 1: Select Input Mesh */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  1
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Select Input Mesh</div>
                  <div className="text-[10px] text-zinc-400">Choose a mesh from your assets or upload a new one</div>
                </div>
              </div>

              {currentAsset ? (
                <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] relative group">
                  <button
                    type="button"
                    onClick={() => setCurrentAsset(null as any)}
                    className="absolute top-2 right-2 p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                    title="Remove selected mesh"
                  >
                    <HugeiconsIcon icon={Cancel} size={16} className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <HugeiconsIcon icon={Box} size={16} className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 pr-6">
                      <div className="text-xs font-bold text-white truncate">{currentAsset.name}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {currentAsset.format} · {currentAsset.fileSize || '—'} · {currentAsset.faces > 0 ? `${Math.round(currentAsset.faces / 1000)}K` : '—'} faces
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-white/[0.15] bg-[hsl(var(--surface-0))] text-center space-y-1">
                  <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 text-zinc-500 mx-auto" />
                  <div className="text-xs font-semibold text-zinc-300">No mesh selected</div>
                  <div className="text-[10px] text-zinc-500">Pick from assets below or upload a GLB/OBJ</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssetPicker(!showAssetPicker)}
                  className="py-2 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>From Assets</span>
                </button>
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
                  className="py-2 px-2.5 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  <HugeiconsIcon icon={UploadIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Upload New</span>
                </button>
              </div>

              {showAssetPicker && (
                <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.1] max-h-40 overflow-y-auto space-y-1">
                  <div className="text-[10px] font-bold text-zinc-400 px-1">Recent 3D Assets</div>
                  {assets.filter(a => a.category === 'mesh' || a.source?.viewUrl || a.source?.localUrl).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setCurrentAsset(a);
                        setShowAssetPicker(false);
                      }}
                      className="w-full text-left p-1.5 rounded-lg hover:bg-[hsl(var(--surface-2))] flex items-center justify-between text-xs text-zinc-300 hover:text-white cursor-pointer"
                    >
                      <span className="truncate max-w-[160px]">{a.name}</span>
                      <span className="text-[9px] font-mono text-zinc-500">{a.faces ? `${Math.round(a.faces / 1000)}k` : '3D'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: Smart Auto Settings */}
            <div className="space-y-3 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-black font-black text-[11px] flex items-center justify-center">
                  2
                </span>
                <div>
                  <div className="text-xs font-bold text-white">Smart UV & Texture Target</div>
                  <div className="text-[10px] text-zinc-400">Automatic conformal seam cutting & packed atlas</div>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20 text-[10px] text-zinc-400 leading-relaxed">
                PartUV generates the UV layout and packs the islands. Texture resolution is selected later by texture generation or baking; it is not an input to this UV operation.
              </div>



              {/* Output Format */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-300">Export Format</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'glb', label: 'GLB (Binary)', desc: 'Embedded UV coordinates' },
                    { id: 'obj', label: 'OBJ (Wavefront)', desc: 'With MTL UV map' },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setOutputFormat(fmt.id)}
                      className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                        outputFormat === fmt.id
                          ? 'bg-[hsl(var(--surface-2))] border-primary text-white'
                          : 'bg-[hsl(var(--surface-0))] border-white/[0.08] text-zinc-400 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold">{fmt.label}</div>
                      <div className="text-[9px] text-zinc-500 mt-0.5">{fmt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Pipeline Details Badge */}
              <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20 space-y-1">
                <div className="flex items-center gap-1.5 text-primary text-[11px] font-bold">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5" />
                  <span>Automatic Studio Packing Pipeline</span>
                </div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  The generated UV mesh is marked complete only after the requested Blender packing produces its output file. Inspect the result before relying on it for final texture baking.
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                id="btn-start-uv-unwrap"
                onClick={handleStartUnwrap}
                disabled={isExecuting || (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl && !currentAsset?.source?.fileId && !currentAsset?.fileId)}
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-black/40 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 fill-current" />
                <span>{isRunning ? 'Unwrapping & Packing Mesh...' : isExecuting ? 'Another Task Is Running...' : 'Start Smart UV Unwrap'}</span>
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};
