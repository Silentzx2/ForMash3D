import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircle, Box, BrushIcon, Cancel, CheckIcon, ChevronDown, DownloadIcon, ImageIcon, LayersIcon, LoaderCircle, PackageIcon, PaletteIcon, SlidersHorizontalIcon, SparklesIcon, TriangleAlertIcon, UploadIcon } from '@hugeicons/core-free-icons';
import {
  PaintBrushToolIcon,
  AirbrushIcon,
  EraserToolIcon,
  EyedropperToolIcon,
  PaintBucketIcon,
} from '@/components/icons/BrushIcons';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { getModelDefinition, isTexturePaintingModel, supportsTextInput, supportsImageInput, MATERIAL_PRESETS } from '@/constants/models';
import { toast } from 'sonner';
import type { AvailableModels } from '@/types/api';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';

interface DiscoveredTextureModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  supports_flashvdm?: boolean;
}

function formatTextureModel(id: string, modelData: AvailableModels | null): DiscoveredTextureModel {
   const def = getModelDefinition(id);
   // Authoritative model runtime details from backend /system/models
   const modelDetails = modelData?.model_details?.[id];
   const isRegistered = Boolean(modelDetails);
   const weightsAvailable = Boolean(modelDetails?.weights_available);
   const isReady = modelDetails?.status === 'ready';
   const status = modelDetails?.status || (isRegistered ? (weightsAvailable ? 'ready' : 'weights_missing') : 'unavailable');

   const vramRequiredMb = modelDetails?.vram_requirement ?? (def?.vramMb || 11776);
   const supportsFlashVdm = def?.supportsFlashVDM ?? id.includes('dit_v2_mini_turbo');

   return {
     id,
     label: def?.name || (id === 'paint3d' ? 'Paint3D (1K/2K PBR Texture)' : id),
     available: isReady,
     installed: weightsAvailable,
     status,
     vram_required_mb: vramRequiredMb,
      supports_flashvdm: supportsFlashVdm,
   };
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
    paintBrushSettings,
    setPaintBrushSettings,
  } = useWorkspace();

  // Tab State: 'texture' (essential primary view) | 'maps' (PBR channels) | 'paint' (interactive 3D surface paint) | 'settings' (advanced & reference)
  const [panelTab, setPanelTab] = useState<'texture' | 'maps' | 'paint' | 'settings'>('texture');

  // Interactive 3D Surface Paint States synced with WorkspaceContext
  const [paintMode, setPaintMode] = useState<'draw' | 'airbrush' | 'erase'>('draw');
  const paintBrushSize = paintBrushSettings.size;
  const setPaintBrushSize = (size: number) => setPaintBrushSettings(prev => ({ ...prev, size }));
  const paintOpacity = paintBrushSettings.opacity;
  const setPaintOpacity = (opacity: number) => setPaintBrushSettings(prev => ({ ...prev, opacity }));
  const paintFlow = paintBrushSettings.flow;
  const setPaintFlow = (flow: number) => setPaintBrushSettings(prev => ({ ...prev, flow }));
  const paintHardness = paintBrushSettings.hardness;
  const setPaintHardness = (hardness: number) => setPaintBrushSettings(prev => ({ ...prev, hardness }));
  const paintColor = paintBrushSettings.color;
  const setPaintColor = (color: string) => setPaintBrushSettings(prev => ({ ...prev, color }));
  const paintBlendMode = paintBrushSettings.blendMode as any;
  const setPaintBlendMode = (blendMode: any) => setPaintBrushSettings(prev => ({ ...prev, blendMode }));
  const [paintBrushShape, setPaintBrushShape] = useState<'round-soft' | 'round-hard' | 'noise' | 'chalk'>('round-soft');

  // T-07: Spot Retexture / Region Mask state
  const [paintSubTool, setPaintSubTool] = useState<'surface' | 'spot_mask'>('surface');
  const [spotPrompt, setSpotPrompt] = useState('');
  const [capturedMaskUrl, setCapturedMaskUrl] = useState<string | null>(null);
  const [isBakeInProgress, setIsBakeInProgress] = useState(false);

  useEffect(() => {
    const handleMaskReady = (e: any) => {
      const url = e.detail?.maskDataUrl;
      if (url) {
        setCapturedMaskUrl(url);
        setTextureSettings(prev => ({ ...prev, maskImage: url }));
        toast.success('UV Mask captured aligned to xatlas UV layout');
      } else {
        toast.error('No active UV paint canvas found. Paint on the mesh surface first.');
      }
    };
    const handlePaintExportResult = (e: Event) => {
      const detail = (e as CustomEvent<{ ok?: boolean; filename?: string; error?: string }>).detail || {};
      setIsBakeInProgress(false);
      if (detail.ok) {
        toast.success('Painted mesh exported', { description: `${detail.filename || 'GLB'} includes the live material texture.` });
      } else {
        toast.error('Painted mesh export failed', { description: detail.error || 'The viewport could not export the painted mesh.' });
      }
    };
    window.addEventListener('formash:uv_mask_ready', handleMaskReady);
    window.addEventListener('formash:paint_export_result', handlePaintExportResult);
    return () => {
      window.removeEventListener('formash:uv_mask_ready', handleMaskReady);
      window.removeEventListener('formash:paint_export_result', handlePaintExportResult);
      window.dispatchEvent(new CustomEvent('formash:set_mask_paint_mode', { detail: { enabled: false, erase: false } }));
    };
  }, [setTextureSettings]);

  useEffect(() => {
    const enabled = panelTab === 'paint' && paintSubTool === 'spot_mask';
    window.dispatchEvent(new CustomEvent('formash:set_mask_paint_mode', {
      detail: { enabled, erase: enabled && paintMode === 'erase' }
    }));
  }, [panelTab, paintSubTool, paintMode]);

  const handleSelectSpotMaskTool = () => {
    setPaintSubTool('spot_mask');
    setPaintMode('draw');
    setPaintColor('#FFFFFF');
    setPaintOpacity(1.0);
    setPaintHardness(0.9);
  };

  const handleDownloadMask = () => {
    if (!capturedMaskUrl) return;
    const cleanName = (currentAsset?.name || 'asset')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^A-Za-z0-9_-]/g, '_');
    const a = document.createElement('a');
    a.href = capturedMaskUrl;
    a.download = `${cleanName}_uv_mask.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Downloaded UV mask: ${cleanName}_uv_mask.png`);
  };

  const handleClearPaint = () => {
    window.dispatchEvent(new CustomEvent('formash:clear_paint_canvas'));
    setCapturedMaskUrl(null);
    setTextureSettings(prev => ({ ...prev, maskImage: null, maskImageFileId: null }));
    toast.info('Cleared active 3D paint / mask strokes');
  };

  const handleCaptureUVMask = () => {
    window.dispatchEvent(new CustomEvent('formash:capture_uv_mask'));
  };

  const [modelData, setModelData] = useState<AvailableModels | null>(null);
   const [optionsLoading, setOptionsLoading] = useState(false);

   useEffect(() => {
     let active = true;
     setOptionsLoading(true);
     getApiClient().getAvailableModels().then(data => {
       if (active && data) {
         setModelData(data);
       }
     }).catch(err => {
       console.warn('Failed to load available models for texturing:', err);
     }).finally(() => {
       if (active) setOptionsLoading(false);
     });
     return () => { active = false; };
   }, []);

   const textureCapableModels = useMemo(() => {
     if (!modelData) return [];
     const textModels = (modelData.available_models['text_mesh_painting'] || []).filter(isTexturePaintingModel);
     const imageModels = (modelData.available_models['image_mesh_painting'] || []).filter(isTexturePaintingModel);
     // Exclude legacy TRELLIS geometry-generation textured variants from standard texture flow
     const combined = Array.from(new Set([...textModels, ...imageModels])).filter(id => !id.includes('trellis'));
     return combined.map(id => formatTextureModel(id, modelData));
   }, [modelData]);

  const [meshDropdownOpen, setMeshDropdownOpen] = useState(false);

  // Mesh original source reference image (from generation or asset metadata)
  const meshOriginalImage = useMemo(() => {
    if (!currentAsset) return null;
    return (
      currentAsset.referenceImage ||
      currentAsset.inputImage ||
      (currentAsset.category === 'generation' ? currentAsset.thumbnail : null) ||
      null
    );
  }, [currentAsset]);

  // Auto-select first asset if none currently selected
  useEffect(() => {
    if (!currentAsset && assets.length > 0) {
      selectAsset(assets[0].id);
    }
  }, [currentAsset, assets, selectAsset]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const { progress: uploadProgress, readFileWithProgress } = useUploadProgress();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const springTransition = { type: 'spring' as const, stiffness: 400, damping: 25 };

  // Auto-route texture model based on requested atlas resolution (1K/2K -> Paint3D, 4K/8K -> Hunyuan3D-Paint)
  useEffect(() => {
    const targetModelId = (textureSettings.resolution === '4K' || textureSettings.resolution === '8K')
      ? 'hunyuan3d_paint_v21_image_mesh_painting'
      : 'paint3d';
    if (textureSettings.modelId !== targetModelId) {
      setTextureSettings(prev => ({ ...prev, modelId: targetModelId }));
    }
  }, [textureSettings.resolution, textureSettings.modelId, setTextureSettings]);

  // Resolution routing is authoritative: do not replace a required engine with a different
  // available model, or the UI can display one provider while submitting another.
  const activeTextureModel = textureCapableModels.find(m => m.id === textureSettings.modelId);
  const isHighResolutionTexture = textureSettings.resolution === '4K' || textureSettings.resolution === '8K';

  // VRAM eligibility check
  const getVRAMStatus = () => {
    const selected = textureCapableModels.find(m => m.id === textureSettings.modelId);
    if (!selected) return null;
    const vramRequired = selected.vram_required_mb || 0;
    const vramAvailable = systemStats.vramTotalGb ? systemStats.vramTotalGb * 1024 : null;
    if (vramAvailable && vramRequired > 0) {
      return {
        sufficient: vramAvailable >= vramRequired,
        required_mb: vramRequired,
        available_mb: vramAvailable,
        label: vramAvailable >= vramRequired ? 'VRAM OK' : 'Insufficient VRAM',
        tone: vramAvailable >= vramRequired ? 'ok' as const : 'warn' as const,
      };
    }
    return null;
  };
  const vramStatus = getVRAMStatus();

  // Status pill logic — shows what's wrong with the selected texture model
  const getTextureStatusInfo = () => {
    const selected = textureCapableModels.find(m => m.id === textureSettings.modelId);
    if (!selected) {
      if (textureCapableModels.length === 0) return { label: 'No texture models', tone: 'warn' as const };
      return { label: 'Required engine unavailable', tone: 'warn' as const };
    }
    if (selected.available) return null;
    if (selected.status === 'weights_missing') return { label: 'Weights missing', tone: 'warn' as const };
    if (selected.status === 'gpu_unavailable') return { label: 'CUDA/GPU unavailable', tone: 'warn' as const };
    if (!selected.installed) return { label: 'Model not installed', tone: 'warn' as const };
    if (selected.status) return { label: selected.status, tone: 'warn' as const };
    return { label: 'Not ready', tone: 'warn' as const };
  };

  const textureStatusInfo = getTextureStatusInfo();

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const processImageFile = useCallback(async (file: File) => {
    setReferenceError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setReferenceError('Invalid file type. Use JPG, PNG, or WEBP.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setReferenceError('File too large. Maximum size is 10MB.');
      return;
    }

    try {
      const dataUrl = await readFileWithProgress(file);
      setTextureSettings(prev => ({
        ...prev,
        referenceImage: dataUrl
      }));
    } catch (err) {
      setReferenceError('Failed to read file.');
    }
  }, [setTextureSettings, readFileWithProgress]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const clearReference = () => {
    setTextureSettings(prev => ({ ...prev, referenceImage: null }));
    setReferenceError(null);
  };

  const styles = [
    { id: 'realistic', label: 'Realistic' },
    { id: 'game', label: 'Game' },
    { id: 'stylized', label: 'Stylized' },
    { id: 'anime', label: 'Anime' }
  ] as const;

  const mapTypes = [
    { key: 'albedo', label: 'Albedo (Base Color)' },
    { key: 'normal', label: 'Normal (Tangent)' },
    { key: 'roughness', label: 'Roughness' },
    { key: 'metallic', label: 'Metallic' },
    { key: 'ao', label: 'Ambient Occlusion' },
    { key: 'height', label: 'Height / Displacement' }
  ] as const;

  const toggleMap = (key: keyof typeof textureSettings.maps) => {
    setTextureSettings(prev => ({
      ...prev,
      maps: {
        ...prev.maps,
        [key]: !prev.maps[key]
      }
    }));
  };

  return (
    <div id="panel-texture" className="flex flex-col h-full overflow-hidden bg-[hsl(var(--surface-1))] text-xs select-none">
      {/* Panel Header with Segmented Navigation Bar */}
      <div className="px-2.5 pt-2.5 pb-2 border-b border-white/[0.08] flex-shrink-0 space-y-2 bg-[#17181B]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-white flex items-center gap-1.5">
            <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
            <span>Texture Studio</span>
          </span>
          <div className="flex items-center gap-1.5">
            {textureStatusInfo && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
                <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-2.5 h-2.5" />
                {textureStatusInfo.label}
              </span>
            )}
            {vramStatus && !vramStatus.sufficient && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[9px] font-bold">
                <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-2.5 h-2.5" />
                {vramStatus.label} ({Math.round(vramStatus.required_mb / 1024)}GB needed)
              </span>
            )}
            {vramStatus && vramStatus.sufficient && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">
                <HugeiconsIcon icon={CheckIcon} size={16} className="w-2.5 h-2.5" />
                VRAM OK ({Math.round(vramStatus.available_mb / 1024)}GB)
              </span>
            )}
            <ToolContextHelp tool="texture" label="Texturing Help" />
          </div>
        </div>

        {/* 4-Tab Segmented Header */}
        <div className="grid grid-cols-4 p-1 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setPanelTab('texture')}
            className={`py-1.5 px-0.5 rounded-lg font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'texture'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={PaletteIcon} size={16} className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">Texture</span>
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('maps')}
            className={`py-1.5 px-0.5 rounded-lg font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'maps'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">Maps</span>
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('paint')}
            className={`py-1.5 px-0.5 rounded-lg font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'paint'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={BrushIcon} size={16} className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">3D Paint</span>
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('settings')}
            className={`py-1.5 px-0.5 rounded-lg font-bold text-[9.5px] flex items-center justify-center gap-1 transition-all cursor-pointer truncate ${
              panelTab === 'settings'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">Settings</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 pb-2 space-y-2 scrollbar-none pr-1">
        
        {/* ========================================================================= */}
        {/* TAB 1: TEXTURE (Zero-scroll, essential controls only)                    */}
        {/* ========================================================================= */}
        {panelTab === 'texture' && (
          <div className="space-y-2.5">
            {/* 3D Mesh Compact Selector */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
               <div className="flex items-center justify-between">
                 <span className="text-[10px] font-bold text-zinc-300 flex items-center gap-1.5">
                   <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary" />
                   <span>Mesh</span>
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
                    id="btn-texture-mesh-select"
                    type="button"
                    onClick={() => setMeshDropdownOpen(!meshDropdownOpen)}
                    className="w-full flex items-center justify-between p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-white/[0.16] hover:bg-[hsl(var(--surface-2))] transition-all text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-1">
                      <div className="w-6 h-6 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                        <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary" />
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
                    <HugeiconsIcon icon={ChevronDown} size={16} className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${meshDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
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
                            {isSel && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3 h-3 text-black flex-shrink-0" />}
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

             {/* Mode: AI Texture | Manual Paint */}
             <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08]">
               <button
                 type="button"
                 onClick={() => setTextureSettings(prev => ({ ...prev, mode: 'ai' }))}
                 disabled
                 title="Mode selection does not affect the texture generation request"
                 className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-bold text-[10px] transition-all cursor-not-allowed ${
                   textureSettings.mode === 'ai'
                     ? 'bg-primary text-black shadow-sm opacity-50'
                     : 'text-zinc-400/50'
                 }`}
               >
                 <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3 h-3 stroke-[2.2]" />
                 <span>AI Texture</span>
               </button>
               <button
                 type="button"
                 onClick={() => {
                   setTextureSettings(prev => ({ ...prev, mode: 'manual' }));
                   setPanelTab('paint');
                 }}
                 disabled
                 title="Mode selection does not affect the texture generation request"
                 className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-bold text-[10px] transition-all cursor-not-allowed ${
                   textureSettings.mode === 'manual'
                     ? 'bg-primary text-black shadow-sm opacity-50'
                     : 'text-zinc-400/50'
                 }`}
               >
                 <HugeiconsIcon icon={PaletteIcon} size={16} className="w-3 h-3 stroke-[2.2]" />
                 <span>Manual Paint</span>
               </button>
             </div>

             {/* Output Atlas Resolution & Auto-routed Texture Engine */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Atlas Resolution</span>
                <span className="text-[9px] font-mono text-primary font-bold">{textureSettings.resolution}</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['1K', '2K', '4K', '8K'] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => {
                      const routed = (res === '4K' || res === '8K')
                        ? 'hunyuan3d_paint_v21_image_mesh_painting'
                        : 'paint3d';
                      setTextureSettings(prev => ({
                        ...prev,
                        resolution: res,
                        modelId: routed,
                      }));
                    }}
                    className={`py-1.5 rounded-lg font-mono font-bold text-[10px] transition-all cursor-pointer ${
                      textureSettings.resolution === res
                        ? 'bg-primary text-black shadow-sm font-black'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>

               {/* High VRAM Warning for 4K / 8K */}
              {(textureSettings.resolution === '4K' || textureSettings.resolution === '8K') && (
                <div className="flex items-start gap-1.5 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[8.5px] leading-tight">
                  <span>{textureSettings.resolution} atlas uses Hunyuan3D-Paint and can require substantially more GPU memory and processing time.</span>
                </div>
              )}

              {/* Routed Engine Selector & Status */}
              <div className="pt-1 border-t border-white/[0.06] space-y-1 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wider">AI Texture Engine</span>
                  <span className="text-[8px] text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                    Auto-routed
                  </span>
                </div>

                <div
                  id="texture-engine-auto-route"
                  className="w-full flex items-center justify-between p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-left"
                >
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="font-bold text-[10px] text-white flex items-center gap-1.5 truncate">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        (activeTextureModel?.available || activeTextureModel?.installed)
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                          : 'bg-zinc-500'
                      }`} />
                      <span className="truncate">{activeTextureModel?.label || 'No texture model'}</span>
                    </span>
                    <span className="text-[8px] text-zinc-400 truncate mt-0.5">
                      {textureSettings.modelId === 'paint3d'
                        ? 'Paint3D (Standard for 1K/2K textures)'
                        : 'Hunyuan3D-Paint v2.1 (Ultra-resolution for 4K/8K)'}
                    </span>
                  </div>
                </div>

              </div>
            </div>

              {/* Style Selector Chips */}
             <div className="space-y-1">
               <div className="flex items-center justify-between">
                 <span className="font-bold text-white text-[10px] uppercase tracking-wider">Style</span>
                 <span className="text-[9px] text-primary capitalize font-bold">{textureSettings.style}</span>
               </div>
               <div className="grid grid-cols-4 gap-1">
                 {styles.map((style) => {
                   const isSelected = textureSettings.style === style.id;
                   return (
                     <button
                       key={style.id}
                       type="button"
                       onClick={() => setTextureSettings(prev => ({ ...prev, style: style.id }))}
                       disabled
                       title="Style presets are not supported by the current backend"
                       className={`py-1.5 rounded-lg font-bold text-[10px] transition-all text-center cursor-not-allowed ${
                         isSelected
                           ? 'bg-primary text-black shadow-sm font-black opacity-50'
                           : 'bg-[hsl(var(--surface-0))] text-zinc-400/50'
                       }`}
                     >
                       {style.label}
                     </button>
                   );
                 })}
               </div>
             </div>

            {/* Reference Image & Guidance (Supports original mesh reference or custom upload) */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[10px] uppercase tracking-wider">Reference Image</span>
                {textureSettings.referenceImage ? (
                  <button
                    type="button"
                    onClick={clearReference}
                    className="text-[9px] text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    {meshOriginalImage ? 'Revert to Mesh Image' : 'Clear'}
                  </button>
                ) : meshOriginalImage ? (
                  <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-medium">
                    <HugeiconsIcon icon={CheckIcon} size={12} className="w-2.5 h-2.5 stroke-[3]" />
                    <span>Mesh Source Bound</span>
                  </span>
                ) : null}
              </div>

              {textureSettings.referenceImage ? (
                <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={textureSettings.referenceImage}
                      alt="Custom Reference"
                      className="w-10 h-10 object-cover rounded-lg border border-white/[0.1] flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-white truncate">Custom Reference Image</div>
                      <div className="text-[8px] text-zinc-400">User uploaded image</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 text-[9px] font-semibold transition-colors cursor-pointer"
                  >
                    Replace
                  </button>
                </div>
              ) : meshOriginalImage ? (
                <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={meshOriginalImage}
                      alt="Mesh Reference"
                      className="w-10 h-10 object-cover rounded-lg border border-white/[0.1] flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-white truncate">Original Mesh Image</div>
                      <div className="text-[8px] text-emerald-400 font-medium">Linked from 3D model source</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 text-[9px] font-semibold transition-colors cursor-pointer"
                  >
                    Custom
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-2 rounded-lg bg-[hsl(var(--surface-1))] border border-dashed border-white/[0.12] hover:border-primary/50 text-zinc-400 hover:text-zinc-200 text-[9.5px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={UploadIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Upload Reference Image (Required)</span>
                </button>
              )}

               {/* Quick Material Preset Swatches (T-08) */}
               <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
                 <div className="flex items-center justify-between">
                   <span className="text-[9px] text-zinc-400 font-medium">Material Presets</span>
                    <span className="text-[8px] text-zinc-500">
                      {isHighResolutionTexture ? 'Paint3D 1K/2K only' : 'Click to pre-fill prompt'}
                    </span>
                 </div>
                 <div className="grid grid-cols-4 gap-1">
                   {MATERIAL_PRESETS.map((preset) => {
                     const isSelected = textureSettings.prompt === preset.prompt;
                     return (
                       <button
                          key={preset.id}
                          type="button"
                          onClick={() => setTextureSettings(prev => ({ ...prev, prompt: preset.prompt }))}
                          disabled={isHighResolutionTexture}
                          title={isHighResolutionTexture ? 'Material prompts are supported by Paint3D at 1K/2K only' : `${preset.name}: ${preset.description}`}
                          className={`group flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-left transition-all ${isHighResolutionTexture ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${
                           isSelected
                             ? 'border-primary bg-primary/10 text-white shadow-[0_0_8px_rgba(255,204,0,0.2)]'
                             : 'border-white/[0.08] bg-[hsl(var(--surface-1))] hover:border-white/20 hover:bg-white/[0.04] text-zinc-300'
                         }`}
                       >
                         <span
                           className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm"
                           style={preset.cssStyle}
                         />
                         <span className="text-[8.5px] font-medium truncate">{preset.name}</span>
                       </button>
                     );
                   })}
                 </div>
               </div>

               {/* Text Guidance / Material Prompt */}
               <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                 <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-400 font-medium">
                      Text Guidance / Material Prompt {isHighResolutionTexture ? '(Paint3D 1K/2K only)' : ''}
                    </span>
                   {textureSettings.prompt && (
                     <span className="text-[8px] text-primary font-mono">{textureSettings.prompt.length} chars</span>
                   )}
                 </div>
                 <div className="relative">
                   <input
                     type="text"
                      placeholder="Describe materials or details (e.g. brushed metal, worn leather)..."
                      value={textureSettings.prompt}
                      onChange={(e) => setTextureSettings(prev => ({ ...prev, prompt: e.target.value }))}
                      disabled={isHighResolutionTexture}
                      title={isHighResolutionTexture ? 'Text guidance is supported by Paint3D at 1K/2K only' : undefined}
                      className="w-full py-1.5 px-2.5 pr-8 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] focus:border-primary text-[10px] text-white placeholder-zinc-500 focus:outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                   />
                   {textureSettings.prompt && (
                     <button
                       type="button"
                       onClick={() => setTextureSettings(prev => ({ ...prev, prompt: '' }))}
                       title="Clear prompt"
                       className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-0.5 cursor-pointer"
                     >
                       <HugeiconsIcon icon={Cancel} size={16} className="w-3 h-3" />
                     </button>
                   )}
                 </div>
               </div>
            </div>

            {/* Quick jump links to other sections */}
            <div className="flex items-center justify-between pt-1 border-t border-white/[0.06] text-[9px] text-zinc-400 font-medium">
              <button
                type="button"
                onClick={() => setPanelTab('maps')}
                className="hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span>PBR Maps &amp; Res ({textureSettings.resolution})</span>
                <span>&rarr;</span>
              </button>
              <button
                type="button"
                onClick={() => setPanelTab('settings')}
                className="hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span>Settings</span>
                <span>&rarr;</span>
              </button>
            </div>

            {/* Sticky Action Button */}
            <div className="pt-2 border-t border-white/[0.08]">
              {(() => {
                const hasValidReferenceImage = Boolean(textureSettings.referenceImage || meshOriginalImage);
                const isModelReady = activeTextureModel ? activeTextureModel.available : false;
                const canGenerate = Boolean(currentAsset && hasValidReferenceImage && !isExecuting && isModelReady);

                return (
                  <>
                    <button
                      id="btn-action-generate-texture"
                      type="button"
                      onClick={runTextureGeneration}
                      disabled={!canGenerate}
                      className={`w-full h-10 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black tracking-wider text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.38)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer btn-lighting-shine ${isExecuting ? 'is-executing' : ''}`}
                    >
                      {isExecuting ? (
                        <>
                          <HugeiconsIcon icon={LoaderCircle} size={16} className="w-4 h-4 animate-spin text-black" />
                          <span>Baking PBR Textures...</span>
                        </>
                      ) : !currentAsset ? (
                        <span>SELECT A TARGET MESH</span>
                      ) : !hasValidReferenceImage ? (
                        <span>UPLOAD REFERENCE IMAGE</span>
                      ) : !activeTextureModel ? (
                        <span>{textureCapableModels.length === 0 ? 'NO TEXTURE MODEL AVAILABLE' : 'REQUIRED TEXTURE ENGINE UNAVAILABLE'}</span>
                      ) : !isModelReady ? (
                        <span>MODEL NOT READY ({activeTextureModel.status?.toUpperCase() || 'UNKNOWN'})</span>
                      ) : (
                        <>
                          <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4 stroke-[2.5]" />
                          <span>GENERATE TEXTURE ({textureSettings.resolution})</span>
                        </>
                      )}
                    </button>
                    {!currentAsset ? (
                      <p className="text-[8px] text-amber-400/80 text-center mt-1">
                        Target mesh required. Select or generate a model above.
                      </p>
                    ) : !hasValidReferenceImage ? (
                      <p className="text-[8px] text-amber-400/80 text-center mt-1">
                        Reference image required for texturing.
                      </p>
                    ) : !activeTextureModel ? (
                      <p className="text-[8px] text-amber-400/80 text-center mt-1">
                        {textureCapableModels.length === 0
                          ? 'No texture painting models are registered on the server.'
                          : `The required engine (${textureSettings.modelId}) is not registered. Change atlas resolution or configure that provider.`}
                      </p>
                    ) : !isModelReady ? (
                      <p className="text-[8px] text-amber-400/80 text-center mt-1">
                        {activeTextureModel.label} is unavailable ({activeTextureModel.status}). Check server weights and runtime.
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: MAPS (PBR Workflow & Channels)                                    */}
        {/* ========================================================================= */}
        {panelTab === 'maps' && (
          <div className="space-y-3">
            {/* Workflow Mode: Texture | PBR */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <span className="font-bold uppercase tracking-wider text-[10px] text-white">Pipeline Workflow</span>
              <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setTextureSettings(prev => ({ ...prev, workflow: 'texture' }))}
                  className={`py-1 rounded-md font-bold text-[10px] transition-all cursor-pointer ${
                    textureSettings.workflow === 'texture'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Texture
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTextureSettings(prev => ({ ...prev, workflow: 'pbr' }));
                    router.push('/workspace/pbr');
                  }}
                  className={`py-1 rounded-md font-bold text-[10px] transition-all cursor-pointer ${
                    textureSettings.workflow === 'pbr'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  PBR Studio
                </button>
              </div>
            </div>

            {/* Resolution Chips */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Texture Resolution</span>
                <span className="text-[9px] font-mono text-primary font-bold">{textureSettings.resolution}</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['1K', '2K', '4K', '8K'] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => {
                      const routed = (res === '4K' || res === '8K')
                        ? 'hunyuan3d_paint_v21_image_mesh_painting'
                        : 'paint3d';
                      setTextureSettings(prev => ({ ...prev, resolution: res, modelId: routed }));
                    }}
                    className={`py-1.5 rounded-lg font-mono font-bold text-[10px] transition-all cursor-pointer ${
                      textureSettings.resolution === res
                        ? 'bg-primary text-black shadow-sm font-black'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* PBR Map Channels Toggle List */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Active Map Channels</span>
                <span className="text-[9px] text-zinc-400">
                  {Object.values(textureSettings.maps).filter(Boolean).length} / 6 selected
                </span>
              </div>

               <div className="grid grid-cols-2 gap-1.5">
                 {mapTypes.map(({ key, label }) => {
                   const checked = textureSettings.maps[key];
                   return (
                     <button
                       key={key}
                       type="button"
                       onClick={() => toggleMap(key)}
                       disabled
                       title="PBR map toggles are not supported by the current backend"
                       className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors cursor-not-allowed ${
                         checked
                           ? 'bg-[hsl(var(--surface-1))] border-primary text-white opacity-50'
                           : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400/50'
                       }`}
                     >
                       <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-colors ${
                         checked ? 'bg-primary border-primary text-black' : 'border-white/[0.15]'
                       }`}>
                         {checked && <HugeiconsIcon icon={CheckIcon} size={16} className="w-2.5 h-2.5 stroke-[3]" />}
                       </div>
                       <span className="font-bold text-[10px] truncate">{label}</span>
                     </button>
                   );
                 })}
               </div>
            </div>

            {/* Back to Texture Tab Button */}
            <button
              type="button"
              onClick={() => setPanelTab('texture')}
              className="w-full py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white font-bold text-[10px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>&larr; Back to Texture Generator</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: 3D SURFACE PAINT (Interactive Viewport Painting & Baking)          */}
        {/* ========================================================================= */}
        {panelTab === 'paint' && (
          <div className="space-y-3">
            {/* 3D Mesh & Canvas Status */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
               <div className="flex items-center justify-between">
                 <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                   <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary" />
                   <span>Painting Mesh</span>
                 </span>
                 <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                   {currentAsset ? 'Mesh Ready' : 'No Mesh'}
                 </span>
               </div>
              <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="font-semibold text-white truncate max-w-[170px]">
                  {currentAsset?.name || 'Default Viewport Model'}
                </span>
                <span className="text-[9px] text-zinc-400 font-mono">
                  {textureSettings.resolution}x{textureSettings.resolution} UV
                </span>
              </div>
            </div>

            {/* T-07: Sub-Tool Mode Switch: Surface Paint vs Spot Retexture Mask */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setPaintSubTool('surface')}
                className={`py-1.5 px-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paintSubTool === 'surface'
                    ? 'bg-primary text-black font-black shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <HugeiconsIcon icon={PaletteIcon} size={14} className="w-3.5 h-3.5" />
                <span>Surface Paint</span>
              </button>
              <button
                type="button"
                onClick={handleSelectSpotMaskTool}
                className={`py-1.5 px-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paintSubTool === 'spot_mask'
                    ? 'bg-cyan-400 text-black font-black shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <HugeiconsIcon icon={SparklesIcon} size={14} className="w-3.5 h-3.5" />
                <span>Spot Retexture Mask</span>
              </button>
            </div>

            {paintSubTool === 'spot_mask' ? (
              <div className="space-y-2.5">
                {/* Description */}
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 text-[10px] leading-relaxed">
                  <span className="font-bold text-white block">T-07 Spot Retexture / UV Region Mask</span>
                  Paint mask strokes directly on the 3D surface. The mask is captured in UV space aligned to the mesh&apos;s existing xatlas layout without re-unwrapping.
                </div>

                {/* Spot Region Prompt */}
                <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Spot Region Prompt</span>
                    <span className="text-[8.5px] font-mono text-cyan-400">Localized</span>
                  </div>
                  <textarea
                    rows={2}
                    value={spotPrompt}
                    onChange={(e) => {
                      setSpotPrompt(e.target.value);
                      setTextureSettings(prev => ({ ...prev, prompt: e.target.value }));
                    }}
                    placeholder="e.g. Scratched rusted iron with weathered edges, gold filigree trim..."
                    className="w-full py-1.5 px-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-[10px] text-white focus:outline-none focus:border-cyan-400 resize-none"
                  />
                </div>

                {/* Mask Brush Controls */}
                <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Mask Brush</span>
                    <span className="text-[9px] font-mono text-cyan-400 font-bold uppercase">{paintMode}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPaintMode('draw');
                        setPaintColor('#FFFFFF');
                        setPaintHardness(0.8);
                        setPaintOpacity(1.0);
                      }}
                      className={`py-1.5 px-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        paintMode === 'draw'
                          ? 'bg-cyan-400 text-black font-black shadow-sm'
                          : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                      }`}
                    >
                      <PaintBrushToolIcon className="w-3.5 h-3.5" />
                      <span>Paint Mask (White)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaintMode('erase')}
                      className={`py-1.5 px-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        paintMode === 'erase'
                          ? 'bg-rose-500 text-white font-black shadow-sm'
                          : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                      }`}
                    >
                      <EraserToolIcon className="w-3.5 h-3.5" />
                      <span>Erase Mask</span>
                    </button>
                  </div>

                  {/* Size and Feathering */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-zinc-400">Mask Brush Size</span>
                      <span className="font-mono text-cyan-400 font-bold">{paintBrushSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={128}
                      step={1}
                      value={paintBrushSize}
                      onChange={(e) => setPaintBrushSize(parseInt(e.target.value, 10))}
                      className="w-full accent-cyan-400 h-1 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-zinc-400">Edge Feathering (Hardness)</span>
                      <span className="font-mono text-cyan-400 font-bold">{Math.round(paintHardness * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1.0}
                      step={0.05}
                      value={paintHardness}
                      onChange={(e) => setPaintHardness(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 h-1 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Mask Capture & Download Actions */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleCaptureUVMask}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-black font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(34,211,238,0.3)] hover:shadow-[0_6px_20px_rgba(34,211,238,0.4)] transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5" />
                    <span>CAPTURE &amp; SERIALIZE UV MASK</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClearPaint}
                    className="w-full py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white text-[10px] font-semibold transition-colors cursor-pointer"
                  >
                    Clear Active Mask
                  </button>
                </div>

                {/* Captured Mask Preview & Versioned Target */}
                {capturedMaskUrl && (
                  <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-cyan-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-white flex items-center gap-1.5">
                        <HugeiconsIcon icon={CheckIcon} size={14} className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Serialized UV Mask (xatlas aligned)</span>
                      </span>
                      <span className="text-[8px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                        Ready
                      </span>
                    </div>

                    <div className="w-full h-28 rounded-lg bg-black/80 border border-white/[0.08] p-1 flex items-center justify-center overflow-hidden">
                      <img src={capturedMaskUrl} alt="Serialized UV Mask" className="max-w-full max-h-full object-contain" />
                    </div>

                    <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06] space-y-0.5">
                      <div className="text-[8px] text-zinc-500 uppercase font-mono">Non-Destructive Target</div>
                      <div className="text-[9.5px] font-mono text-cyan-300 font-bold truncate">
                        textures/{(currentAsset?.name || 'asset').replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_')}_textured_v2.glb
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleDownloadMask}
                      className="w-full py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white text-[9.5px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={DownloadIcon} size={14} className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Export UV Mask (PNG)</span>
                    </button>
                  </div>
                )}

                {/* Honest Backend Limitation Banner */}
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[9.5px] leading-relaxed space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <HugeiconsIcon icon={TriangleAlertIcon} size={14} className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Backend Adapter Limitation Notice</span>
                  </div>
                  <p>
                    The UV mask can be captured in the existing UV layout, but Paint3D and Hunyuan3D-Paint do not apply this user mask during inference. Mask-based retexturing is disabled to prevent an advertised spot edit from silently retexturing the whole mesh.
                  </p>
                </div>

                {/* Trigger Retexture with Mask */}
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Localized mask inference is not supported by the selected texture adapters."
                  className="w-full py-2.5 rounded-xl bg-[hsl(var(--surface-2))] text-zinc-400 font-bold text-xs flex items-center justify-center gap-2 border border-white/[0.08] opacity-60 cursor-not-allowed"
                >
                  <HugeiconsIcon icon={SparklesIcon} size={15} />
                  <span>Mask-Based Retexture Unavailable</span>
                </button>
              </div>
            ) : (
              <>
            {/* Paint Mode Switch: Draw, Airbrush, Erase */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Paint Tool</span>
                <span className="text-[9px] font-mono text-primary font-bold uppercase">{paintMode}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setPaintMode('draw');
                    setPaintHardness(0.7);
                    setPaintOpacity(1.0);
                  }}
                  className={`py-2 px-1.5 rounded-xl font-bold text-[10px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                    paintMode === 'draw'
                      ? 'bg-primary text-black shadow-[0_2px_10px_rgba(255,204,0,0.3)] font-black'
                      : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  <PaintBrushToolIcon className="w-4 h-4" />
                  <span>Brush</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaintMode('airbrush');
                    setPaintHardness(0.05);
                    setPaintOpacity(0.4);
                  }}
                  className={`py-2 px-1.5 rounded-xl font-bold text-[10px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                    paintMode === 'airbrush'
                      ? 'bg-cyan-400 text-black shadow-[0_2px_10px_rgba(34,211,238,0.3)] font-black'
                      : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  <AirbrushIcon className="w-4 h-4" />
                  <span>Airbrush</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaintMode('erase')}
                  className={`py-2 px-1.5 rounded-xl font-bold text-[10px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                    paintMode === 'erase'
                      ? 'bg-rose-500 text-white shadow-[0_2px_10px_rgba(244,63,94,0.3)] font-black'
                      : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  <EraserToolIcon className="w-4 h-4" />
                  <span>Eraser</span>
                </button>
              </div>
            </div>

            {/* Color Palette & Preset Swatches */}
            {paintMode === 'draw' && (
              <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Color Palette</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: paintColor }} />
                    <span className="text-[9px] font-mono text-zinc-300 font-bold uppercase">{paintColor}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={paintColor}
                    onChange={(e) => setPaintColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border border-white/[0.12] bg-transparent cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={paintColor}
                    onChange={(e) => setPaintColor(e.target.value)}
                    className="flex-1 py-1 px-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-[10px] font-mono text-white focus:outline-none focus:border-primary"
                    placeholder="#FFCC00"
                  />
                </div>

                {/* Quick Swatches */}
                <div className="grid grid-cols-8 gap-1 pt-1 border-t border-white/[0.06]">
                  {[
                    '#FFCC00', '#FFFFFF', '#080808', '#EF4444',
                    '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'
                  ].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setPaintColor(hex)}
                      className={`w-6 h-6 rounded-md border transition-transform hover:scale-110 cursor-pointer ${
                        paintColor.toLowerCase() === hex.toLowerCase()
                          ? 'border-white ring-2 ring-primary ring-offset-1 ring-offset-black scale-105'
                          : 'border-white/20'
                      }`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>

                {/* Flood Fill Action */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('formash:fill_paint_canvas', { detail: { color: paintColor } }));
                      toast.success(`Flooded texture canvas with ${paintColor}`);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[9.5px] font-bold text-zinc-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <PaintBucketIcon className="w-3.5 h-3.5 text-primary" />
                    <span>Flood Fill Texture with Color</span>
                  </button>
                </div>
              </div>
            )}

            {/* Brush Dynamics */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Brush Dynamics</span>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Brush Size (Radius)</span>
                  <span className="font-mono text-primary font-bold">{paintBrushSize}px</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={128}
                  step={1}
                  value={paintBrushSize}
                  onChange={(e) => setPaintBrushSize(parseInt(e.target.value, 10))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Opacity</span>
                  <span className="font-mono text-primary font-bold">{Math.round(paintOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={paintOpacity}
                  onChange={(e) => setPaintOpacity(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Flow (Pressure)</span>
                  <span className="font-mono text-primary font-bold">{Math.round(paintFlow * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={paintFlow}
                  onChange={(e) => setPaintFlow(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Hardness (Feathering)</span>
                  <span className="font-mono text-primary font-bold">{Math.round(paintHardness * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={paintHardness}
                  onChange={(e) => setPaintHardness(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>
            </div>

            {/* Tip Shape & Blend Mode */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-2">
              <span className="text-zinc-200 font-bold uppercase text-[10px] tracking-wider">Tip &amp; Blending</span>

              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Brush Tip Profile</span>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { id: 'round-soft', label: 'Soft Round' },
                    { id: 'round-hard', label: 'Hard Edge' },
                    { id: 'noise', label: 'Noise Texture' },
                    { id: 'chalk', label: 'Chalk Stipple' },
                  ].map((tip) => (
                    <button
                      key={tip.id}
                      type="button"
                      onClick={() => setPaintBrushShape(tip.id as any)}
                      className={`py-1 px-1.5 rounded text-[9.5px] font-bold transition-colors cursor-pointer ${
                        paintBrushShape === tip.id
                          ? 'bg-primary text-black'
                          : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {tip.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400">Layer Blend Mode</span>
                  <span className="font-mono text-primary font-bold uppercase">{paintBlendMode}</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(['normal', 'multiply', 'screen', 'overlay'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPaintBlendMode(mode)}
                      className={`py-1 rounded text-[9px] font-bold uppercase transition-colors cursor-pointer ${
                        paintBlendMode === mode
                          ? 'bg-primary text-black'
                          : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bake & Action Controls */}
            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                disabled={isBakeInProgress}
                onClick={() => {
                  setIsBakeInProgress(true);
                  window.dispatchEvent(new CustomEvent('formash:export_painted_mesh', {
                    detail: { assetName: currentAsset?.name || 'mesh' }
                  }));
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-black font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,204,0,0.45)] transition-all cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
              >
                <HugeiconsIcon icon={PaletteIcon} size={16} className="w-3.5 h-3.5" />
                <span>{isBakeInProgress ? 'Exporting Painted GLB…' : 'EXPORT PAINTED MESH (GLB)'}</span>
              </button>

                <button
                  type="button"
                  onClick={handleClearPaint}
                  className="w-full py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white text-[10px] font-semibold transition-colors cursor-pointer"
                >
                  Clear Paint Layer
                </button>
              </div>
            </>
          )}
        </div>
      )}

        {/* ========================================================================= */}
        {/* TAB 3: SETTINGS & REFERENCE IMAGE                                        */}
        {/* ========================================================================= */}
        {panelTab === 'settings' && (
          <div className="space-y-3">
            {/* Reference Image Dropzone */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[10px] uppercase tracking-wider">Reference Image</span>
                {textureSettings.referenceImage ? (
                  <button
                    type="button"
                    onClick={clearReference}
                    className="text-[9px] text-red-400 hover:underline cursor-pointer"
                  >
                    {meshOriginalImage ? 'Revert to Mesh Image' : 'Remove'}
                  </button>
                ) : meshOriginalImage ? (
                  <span className="text-[9px] text-emerald-400 font-medium">Using mesh source</span>
                ) : null}
              </div>

              <motion.div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                animate={{
                  scale: isDragOver ? 1.01 : 1,
                  borderColor: isDragOver ? 'hsl(var(--primary))' : '#2f333e'
                }}
                transition={springTransition}
                className={`flex flex-col items-center justify-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-colors p-2 text-center bg-[hsl(var(--surface-1))] ${
                  isDragOver
                    ? 'bg-primary/10 border-primary'
                    : (textureSettings.referenceImage || meshOriginalImage)
                    ? 'border-primary/40'
                    : 'border-white/[0.12] hover:border-white/[0.24]'
                }`}
              >
                {uploadProgress.active ? (
                  <div className="flex flex-col items-center justify-center space-y-2 w-full px-2">
                    <HugeiconsIcon icon={LoaderCircle} size={16} className="w-5 h-5 animate-spin text-primary" />
                    <div className="w-full bg-[hsl(var(--surface-3))] rounded-full h-1 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadProgress.percent}%` }}
                        className="bg-primary h-full rounded-full"
                      />
                    </div>
                    <span className="text-[9px] text-zinc-400 font-mono">
                      {uploadProgress.percent}%
                    </span>
                  </div>
                ) : (textureSettings.referenceImage || meshOriginalImage) ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center">
                    <img
                      src={textureSettings.referenceImage || meshOriginalImage!}
                      alt="Reference"
                      className="max-h-20 max-w-full object-contain rounded-md"
                    />
                    <span className="text-[8px] text-zinc-400 mt-1">
                      {textureSettings.referenceImage ? 'Custom Reference Image (Click to change)' : 'Original Mesh Image (Click to replace)'}
                    </span>
                  </div>
                ) : (
                  <>
                    <HugeiconsIcon icon={UploadIcon} size={16} className={`w-5 h-5 mb-1 ${isDragOver ? 'text-primary' : 'text-zinc-400'}`} />
                    <span className="text-white font-bold text-[10px]">
                      {isDragOver ? 'Drop image here' : 'Drop or browse reference'}
                    </span>
                    <span className="text-[8px] text-zinc-400 mt-0.5">JPG, PNG, WebP up to 10MB</span>
                  </>
                )}
              </motion.div>

              {referenceError && (
                <div className="flex items-center gap-1 text-[9px] text-red-400">
                  <HugeiconsIcon icon={AlertCircle} size={16} className="w-2.5 h-2.5" />
                  <span>{referenceError}</span>
                </div>
              )}
            </div>

            {/* Model Weights Link */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={PackageIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] text-zinc-300 font-medium">Model Weights &amp; Cache</span>
              </div>
              <button
                type="button"
                onClick={() => router.push('/admin?tab=models')}
                className="px-2 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary font-bold text-[9px] transition-colors cursor-pointer"
              >
                Manage
              </button>
            </div>

            {/* Back Button */}
            <button
              type="button"
              onClick={() => setPanelTab('texture')}
              className="w-full py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white font-bold text-[10px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>&larr; Back to Texture Generator</span>
            </button>
          </div>
        )}

      </div>

      {/* Hidden File Input for Reference Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};
