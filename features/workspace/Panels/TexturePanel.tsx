import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { getModelDefinition } from '@/constants/models';
import { toast } from 'sonner';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CheckIcon,
  ChevronDown,
  CircleDashedIcon,
  LayersIcon,
  LoaderCircle,
  PaletteIcon,
  Shield01Icon,
  SlidersHorizontalIcon,
  Sun01Icon,
  UploadIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons';

interface DiscoveredTextureModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  low_vram_supported: boolean;
}

export const TexturePanel: React.FC = () => {
  const router = useRouter();
  const {
    textureSettings,
    setTextureSettings,
    runTextureGeneration,
    isExecuting,
    currentAsset,
    assets,
    selectAsset,
    systemStats,
    updateMaterialConfig,
    showWireframe,
    setShowWireframe,
    environmentSettings,
    setEnvironmentSettings,
  } = useWorkspace();

  // Tab State: 'pbr' (PBR Generation) | 'materials' (Material Overrides) | 'environment' (Environment Lighting)
  const [panelTab, setPanelTab] = useState<'pbr' | 'materials' | 'environment'>('pbr');

  // Auto-select first asset if none selected
  useEffect(() => {
    if (!currentAsset && assets.length > 0) {
      selectAsset(assets[0].id);
    }
  }, [currentAsset, assets, selectAsset]);

  // Model discovery from backend API
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredTextureModel[]>([]);
  useEffect(() => {
    let cancelled = false;
    getApiClient().getAvailableModels().then(data => {
      if (cancelled || !data) return;
      const candidates = ['paint3d', 'hunyuan3d_paint_v21_image_mesh_painting'];
      const list: DiscoveredTextureModel[] = candidates.map(id => {
        const def = getModelDefinition(id);
        const details = data.model_details?.[id];
        const isReady = details?.status === 'ready';
        const installed = Boolean(details?.weights_available);
        return {
          id,
          label: def?.name || (id === 'paint3d' ? 'Paint3D (1K/2K PBR)' : 'Hunyuan3D-Paint (4K PBR)'),
          available: isReady,
          installed,
          status: details?.status || 'ready',
          vram_required_mb: details?.vram_requirement || (def?.vramMb || 11776),
          low_vram_supported: def?.lowVramSupported ?? true,
        };
      });
      setDiscoveredModels(list);
    }).catch(() => {
      // Fallback local list
      setDiscoveredModels([
        {
          id: 'paint3d',
          label: 'Paint3D (1K/2K PBR)',
          available: true,
          installed: true,
          status: 'ready',
          vram_required_mb: 8192,
          low_vram_supported: true,
        },
        {
          id: 'hunyuan3d_paint_v21_image_mesh_painting',
          label: 'Hunyuan3D-Paint (4K PBR)',
          available: true,
          installed: true,
          status: 'ready',
          vram_required_mb: 14336,
          low_vram_supported: true,
        },
      ]);
    });
    return () => { cancelled = true; };
  }, []);

  // Reference Image Upload state
  const [meshDropdownOpen, setMeshDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { readFileWithProgress } = useUploadProgress();

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileWithProgress(file);
      setTextureSettings(prev => ({ ...prev, referenceImage: dataUrl }));
      toast.success('Texture reference image loaded');
    } catch {
      toast.error('Failed to read image file');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Polycount preset chips: 5k, 20k, 50k, 100k
  const polycountPresets = [
    { label: '5k', value: 5000, desc: 'Mobile / VR' },
    { label: '20k', value: 20000, desc: 'Indie Game' },
    { label: '50k', value: 50000, desc: 'Mid-Poly' },
    { label: '100k', value: 100000, desc: 'AAA Hero' },
  ] as const;

  // Material Overrides State (synced to current asset's materialConfig)
  const [materialSettings, setMaterialSettings] = useState({
    roughness: currentAsset?.materialConfig?.roughness ?? 0.5,
    metallic: currentAsset?.materialConfig?.metalness ?? 0.1,
    normalScale: currentAsset?.materialConfig?.normalScale ?? 1.0,
  });

  useEffect(() => {
    if (currentAsset?.materialConfig) {
      setMaterialSettings({
        roughness: currentAsset.materialConfig.roughness ?? 0.5,
        metallic: currentAsset.materialConfig.metalness ?? 0.1,
        normalScale: currentAsset.materialConfig.normalScale ?? 1.0,
      });
    }
  }, [currentAsset?.materialConfig]);

  const handleMaterialChange = (updates: Partial<typeof materialSettings>) => {
    setMaterialSettings(prev => {
      const next = { ...prev, ...updates };
      React.startTransition(() => {
        updateMaterialConfig?.({
          roughness: next.roughness,
          metalness: next.metallic,
          normalScale: next.normalScale,
        });
      });
      return next;
    });
  };

  const materialPresets = [
    { name: 'Matte Clay', roughness: 0.90, metallic: 0.05, normalScale: 1.0, preview: 'from-amber-700/60 to-amber-900/80' },
    { name: 'Smooth Plastic', roughness: 0.15, metallic: 0.08, normalScale: 0.8, preview: 'from-blue-500/70 to-indigo-800/80' },
    { name: 'Polished Metal', roughness: 0.05, metallic: 1.00, normalScale: 0.5, preview: 'from-zinc-200/80 to-zinc-600/80' },
    { name: 'Gold Sheen', roughness: 0.20, metallic: 0.95, normalScale: 1.0, preview: 'from-[#F5C542]/80 to-amber-600/80' },
    { name: 'Rough Stone', roughness: 0.85, metallic: 0.00, normalScale: 2.2, preview: 'from-stone-500/80 to-stone-800/80' },
    { name: 'Glass / Ice', roughness: 0.08, metallic: 0.00, normalScale: 0.2, preview: 'from-cyan-300/60 to-sky-700/80' },
  ] as const;

  // Environment Lighting State
  const [envSettings, setEnvSettings] = useState({
    preset: 'studio',
    exposure: environmentSettings?.exposure ?? 1.05,
    keyLight: environmentSettings?.keyLightIntensity ?? 1.8,
    fillLight: environmentSettings?.fillLightIntensity ?? 1.1,
    ambientLight: environmentSettings?.ambientIntensity ?? 0.85,
    backgroundColor: environmentSettings?.backgroundColor ?? '#111215',
  });

  const handleEnvChange = (updates: Partial<typeof envSettings>) => {
    setEnvSettings(prev => {
      const next = { ...prev, ...updates };
      setEnvironmentSettings?.(prevEnv => ({
        ...prevEnv,
        exposure: next.exposure,
        keyLightIntensity: next.keyLight,
        fillLightIntensity: next.fillLight,
        ambientIntensity: next.ambientLight,
        backgroundColor: next.backgroundColor,
      }));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('setEnvironmentSettings', {
          detail: {
            exposure: next.exposure,
            keyLightIntensity: next.keyLight,
            fillLightIntensity: next.fillLight,
            ambientIntensity: next.ambientLight,
            backgroundColor: next.backgroundColor,
          }
        }));
      }
      return next;
    });
  };

  const environmentPresets = [
    { id: 'studio', name: 'Studio Neutral', exposure: 1.05, key: 1.8, fill: 1.1, ambient: 0.85 },
    { id: 'sunset', name: 'Warm Sunset', exposure: 1.10, key: 2.2, fill: 0.8, ambient: 0.90 },
    { id: 'daylight', name: 'Crisp Daylight', exposure: 1.15, key: 2.0, fill: 1.4, ambient: 1.10 },
    { id: 'cyberpunk', name: 'Cyberpunk Neon', exposure: 1.20, key: 2.5, fill: 1.5, ambient: 0.60 },
    { id: 'dramatic', name: 'Dark Dramatic', exposure: 0.95, key: 2.2, fill: 0.4, ambient: 0.40 },
  ] as const;

  return (
    <div id="panel-texture" className="flex flex-col h-full overflow-hidden studio-dock text-xs select-none">
      {/* Panel Header with Clean Segmented Pill Tabs */}
      <div className="px-3 pt-3 pb-2.5 border-b border-white/[0.06] flex-shrink-0 space-y-2 bg-[#121316]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-white flex items-center gap-1.5">
            <HugeiconsIcon icon={LayersIcon} size={16} className="w-3.5 h-3.5 text-[#F5C542]" />
            <span>PBR Texture &amp; Studio Materials</span>
          </span>
          <ToolContextHelp tool="texture" label="PBR Texturing Help" />
        </div>

        {/* 3 Clean Organized Tabs: PBR Generation | Material Overrides | Environment Lighting */}
        <div className="studio-pill-track grid grid-cols-3 gap-1">
          <button
            type="button"
            id="tab-btn-pbr-gen"
            onClick={() => React.startTransition(() => setPanelTab('pbr'))}
            className={`py-1.5 px-1 rounded-full font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'pbr'
                ? 'studio-pill-active text-[#F5C542] border border-[#F5C542]/30 shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={PaletteIcon} size={13} className="w-3 h-3 flex-shrink-0" />
            <span>PBR Gen</span>
          </button>
          <button
            type="button"
            id="tab-btn-material-overrides"
            onClick={() => React.startTransition(() => setPanelTab('materials'))}
            className={`py-1.5 px-1 rounded-full font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'materials'
                ? 'studio-pill-active text-[#F5C542] border border-[#F5C542]/30 shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={13} className="w-3 h-3 flex-shrink-0" />
            <span>Materials</span>
          </button>
          <button
            type="button"
            id="tab-btn-environment-lighting"
            onClick={() => React.startTransition(() => setPanelTab('environment'))}
            className={`py-1.5 px-1 rounded-full font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'environment'
                ? 'studio-pill-active text-[#F5C542] border border-[#F5C542]/30 shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={Sun01Icon} size={13} className="w-3 h-3 flex-shrink-0" />
            <span>Lighting</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 pb-3 space-y-2.5 scrollbar-none pr-1.5">
        {/* ========================================================================= */}
        {/* TAB 1: PBR GENERATION                                                    */}
        {/* ========================================================================= */}
        {panelTab === 'pbr' && (
          <div className="space-y-2.5">
            {/* Target 3D Mesh Selector Card */}
            <div className="studio-card p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-300 flex items-center gap-1.5">
                  <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-[#F5C542]" />
                  <span>Target 3D Mesh</span>
                </span>
                {currentAsset ? (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                    Active
                  </span>
                ) : (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    No Model
                  </span>
                )}
              </div>

              {currentAsset ? (
                <div className="relative">
                  <button
                    id="btn-texture-mesh-select"
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
                          <span className="uppercase">{currentAsset.format || 'GLB'}</span>
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
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-dashed border-white/[0.1] text-center space-y-1.5">
                  <div className="text-[10px] text-zinc-400">Generate or select a 3D model first</div>
                  <button
                    type="button"
                    onClick={() => router.push('/workspace/generate')}
                    className="px-2.5 py-1 rounded-md bg-[#F5C542] text-black font-bold text-[9px] hover:bg-[#FFE066] transition-colors cursor-pointer"
                  >
                    Generate Model
                  </button>
                </div>
              )}
            </div>

            {/* AI Texture Engine Card */}
            <div className="studio-card p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider text-[10px]">PBR Texture Engine</span>
                <span className="font-mono text-[9px] text-[#F5C542] font-bold">{textureSettings.resolution}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'paint3d', label: 'Paint3D (Fast 1K/2K)' },
                  { id: 'hunyuan3d_paint_v21_image_mesh_painting', label: 'Hunyuan3D (Ultra 4K)' },
                ].map((engine) => (
                  <button
                    key={engine.id}
                    type="button"
                    onClick={() => {
                      React.startTransition(() => {
                        setTextureSettings(prev => ({
                          ...prev,
                          modelId: engine.id,
                          resolution: engine.id.includes('hunyuan') ? '4K' : '2K',
                        }));
                      });
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[9.5px] font-bold transition-all cursor-pointer text-center ${
                      textureSettings.modelId === engine.id
                        ? 'bg-[#F5C542] text-black font-black shadow-sm'
                        : 'bg-[#16171B] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {engine.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reference Image Dropzone Card (Image-to-Texture ONLY) */}
            <div className="studio-card p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[10px] uppercase tracking-wider">Image Texture Reference</span>
                {textureSettings.referenceImage && (
                  <button
                    type="button"
                    onClick={() => setTextureSettings(prev => ({ ...prev, referenceImage: null }))}
                    className="text-[9px] text-zinc-400 hover:text-red-400 font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageFileChange}
                className="hidden"
              />

              {textureSettings.referenceImage ? (
                <div className="relative rounded-lg overflow-hidden border border-white/[0.1] h-24 bg-black/40 flex items-center justify-center">
                  <img
                    src={textureSettings.referenceImage}
                    alt="Reference preview"
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-dashed border-white/[0.12] hover:border-[#F5C542]/40 bg-[#16171B] p-3 text-center cursor-pointer transition-colors space-y-1"
                >
                  <HugeiconsIcon icon={UploadIcon} size={16} className="w-4 h-4 text-[#F5C542] mx-auto" />
                  <div className="text-[10px] text-zinc-300 font-medium">Click to upload reference image</div>
                  <div className="text-[8px] text-zinc-500">Supports PNG, JPG, WEBP up to 10MB</div>
                </div>
              )}
            </div>

            {/* PBR Resolution & Map Channels */}
            <div className="studio-card p-2.5 space-y-2">
              <span className="font-bold uppercase tracking-wider text-[10px] text-white">Atlas Resolution</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['1K', '2K', '4K'] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => {
                      React.startTransition(() => {
                        setTextureSettings(prev => ({ ...prev, resolution: res }));
                      });
                    }}
                    className={`py-1.5 rounded-lg text-center font-mono font-bold text-[10px] transition-all cursor-pointer ${
                      textureSettings.resolution === res
                        ? 'bg-[#F5C542] text-black font-black shadow-sm'
                        : 'bg-[#16171B] text-zinc-400 border border-white/[0.06] hover:text-white'
                    }`}
                  >
                    {res} ({res === '1K' ? '1024' : res === '2K' ? '2048' : '4096'})
                  </button>
                ))}
              </div>

              {/* Map channels indicator */}
              <div className="pt-1 border-t border-white/[0.06]">
                <span className="text-[9px] text-zinc-400 block mb-1 font-medium">Generated PBR Channels:</span>
                <div className="flex flex-wrap gap-1">
                  {['Albedo / Diffuse', 'Tangent Normal', 'Roughness', 'Metallic', 'Ambient Occlusion'].map(c => (
                    <span key={c} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-300 border border-white/[0.06]">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Polycount Budget Slider with Preset Chips */}
            <div className="studio-card border-[#F5C542]/20 bg-[#F5C542]/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-200">Polycount Budget</div>
                  <div className="text-[8px] text-zinc-400">Target baking budget for output mesh</div>
                </div>
                <span className="font-mono font-bold text-xs text-[#F5C542]">
                  {textureSettings.targetPolycount ? textureSettings.targetPolycount.toLocaleString() : '20,000'} tris
                </span>
              </div>

              {/* Preset chips: 5k, 20k, 50k, 100k */}
              <div className="grid grid-cols-4 gap-1">
                {polycountPresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      React.startTransition(() => {
                        setTextureSettings(prev => ({ ...prev, targetPolycount: preset.value }));
                      });
                    }}
                    className={`py-1.5 px-0.5 rounded-lg text-center border transition-all cursor-pointer ${
                      (textureSettings.targetPolycount || 20000) === preset.value
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
                aria-label="Target polycount budget"
                type="range"
                min={1000}
                max={200000}
                step={1000}
                value={textureSettings.targetPolycount || 20000}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  React.startTransition(() => {
                    setTextureSettings(prev => ({ ...prev, targetPolycount: val }));
                  });
                }}
                className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
              />
            </div>

            {/* Primary Action Button */}
            <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
              <button
                id="btn-action-generate-texture"
                type="button"
                onClick={runTextureGeneration}
                disabled={isExecuting || !currentAsset}
                className="w-full h-11 rounded-xl bg-[#F5C542] hover:bg-[#FFE066] text-black font-black tracking-wider text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(245,197,66,0.25)] hover:shadow-[0_6px_20px_rgba(245,197,66,0.35)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin text-black" />
                    <span>Synthesizing PBR Textures...</span>
                  </>
                ) : !currentAsset ? (
                  <span>SELECT A 3D MODEL FIRST</span>
                ) : (
                  <>
                    <HugeiconsIcon icon={PaletteIcon} size={16} className="w-4 h-4 stroke-[2.5]" />
                    <span>GENERATE PBR TEXTURES</span>
                  </>
                )}
              </button>
              <p className="text-center text-[8.5px] text-zinc-500 font-mono">
                Bakes diffuse, normal, roughness &amp; metalness maps onto UV layout
              </p>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: MATERIAL OVERRIDES                                                */}
        {/* ========================================================================= */}
        {panelTab === 'materials' && (
          <div className="space-y-2.5">
            {/* Quick Material Presets Card with Visual Swatches */}
            <div className="studio-card p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider text-[10px]">Material Presets</span>
                <span className="text-[8px] text-zinc-500 font-mono">Real-time PBR</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {materialPresets.map((mat) => (
                  <button
                    key={mat.name}
                    type="button"
                    onClick={() => {
                      handleMaterialChange({
                        roughness: mat.roughness,
                        metallic: mat.metallic,
                        normalScale: mat.normalScale,
                      });
                    }}
                    className="p-1.5 rounded-lg border border-white/[0.06] hover:border-[#F5C542]/40 bg-[#16171B] flex flex-col items-center gap-1.5 transition-all cursor-pointer group active:scale-95"
                  >
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-tr ${mat.preview} shadow-inner border border-white/20`} />
                    <span className="text-[9px] font-bold text-zinc-300 group-hover:text-white truncate w-full text-center">
                      {mat.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Real-time Material Property Sliders Card */}
            <div className="studio-card p-2.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider text-[10px]">PBR Surface Properties</span>
                {/* Wireframe toggle */}
                <button
                  type="button"
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`px-2 py-0.5 rounded-lg border text-[9px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    showWireframe
                      ? 'bg-[#F5C542] text-black border-[#F5C542] font-black'
                      : 'bg-white/[0.04] text-zinc-400 border-white/[0.08] hover:text-white'
                  }`}
                >
                  <HugeiconsIcon icon={CircleDashedIcon} size={11} className="w-2.5 h-2.5" />
                  <span>Wire {showWireframe ? 'ON' : 'OFF'}</span>
                </button>
              </div>

              {/* Roughness Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Roughness</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">
                    {materialSettings.roughness.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={materialSettings.roughness}
                  onChange={(e) => handleMaterialChange({ roughness: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>

              {/* Metallic Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Metallic</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">
                    {materialSettings.metallic.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={materialSettings.metallic}
                  onChange={(e) => handleMaterialChange({ metallic: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>

              {/* Normal Intensity Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Normal Map Intensity</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">
                    {materialSettings.normalScale.toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={materialSettings.normalScale}
                  onChange={(e) => handleMaterialChange({ normalScale: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[9px] text-zinc-400">
              Changes applied in real time to current viewport 3D shader and saved to asset material config.
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: ENVIRONMENT LIGHTING                                              */}
        {/* ========================================================================= */}
        {panelTab === 'environment' && (
          <div className="space-y-2.5">
            {/* Environment Presets Card */}
            <div className="studio-card p-2.5 space-y-2">
              <span className="font-bold text-white uppercase tracking-wider text-[10px]">Studio HDRI Lighting</span>
              <div className="grid grid-cols-2 gap-1.5">
                {environmentPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      handleEnvChange({
                        preset: preset.id,
                        exposure: preset.exposure,
                        keyLight: preset.key,
                        fillLight: preset.fill,
                        ambientLight: preset.ambient,
                      });
                    }}
                    className={`p-2 rounded-lg text-left border transition-all cursor-pointer ${
                      envSettings.preset === preset.id
                        ? 'bg-[#F5C542] text-black border-[#F5C542] font-black shadow-sm'
                        : 'bg-[#16171B] text-zinc-300 border-white/[0.06] hover:text-white hover:border-[#F5C542]/30'
                    }`}
                  >
                    <div className="text-[10px] font-bold truncate">{preset.name}</div>
                    <div className="text-[8px] opacity-70 font-mono">Exp: {preset.exposure.toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Fine Lighting Sliders Card */}
            <div className="studio-card p-2.5 space-y-3">
              <span className="font-bold text-white uppercase tracking-wider text-[10px]">Lighting Rig Controls</span>

              {/* Exposure */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Exposure</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">{envSettings.exposure.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={2.5}
                  step={0.05}
                  value={envSettings.exposure}
                  onChange={(e) => handleEnvChange({ exposure: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>

              {/* Key Light */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Key Light</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">{envSettings.keyLight.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3.0}
                  step={0.1}
                  value={envSettings.keyLight}
                  onChange={(e) => handleEnvChange({ keyLight: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>

              {/* Ambient Light */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">Ambient Light</span>
                  <span className="font-mono font-bold text-[10px] text-[#F5C542]">{envSettings.ambientLight.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2.0}
                  step={0.05}
                  value={envSettings.ambientLight}
                  onChange={(e) => handleEnvChange({ ambientLight: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#16171B] accent-[#F5C542] cursor-pointer"
                />
              </div>
            </div>

            {/* Background Canvas Selector Card */}
            <div className="studio-card p-2.5 space-y-2">
              <span className="font-bold text-white uppercase tracking-wider text-[10px]">Viewport Background</span>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: 'Deep', val: '#111215' },
                  { label: 'Studio', val: '#16171B' },
                  { label: 'Vignette', val: '#23262D' },
                  { label: 'Clear', val: 'transparent' },
                ].map((bg) => (
                  <button
                    key={bg.val}
                    type="button"
                    onClick={() => handleEnvChange({ backgroundColor: bg.val })}
                    className={`py-1 rounded-lg text-center font-bold text-[9px] border transition-all cursor-pointer ${
                      envSettings.backgroundColor === bg.val
                        ? 'border-[#F5C542] text-[#F5C542] bg-[#F5C542]/10 font-black'
                        : 'border-white/[0.06] text-zinc-400 bg-[#16171B] hover:text-white'
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TexturePanel;
