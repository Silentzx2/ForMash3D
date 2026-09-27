import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Upload,
  ChevronDown,
  Palette,
  Check,
  AlertCircle,
  Loader2,
  Package,
  AlertTriangle,
  Gauge,
  Box,
  Layers,
  Sliders,
  X,
  Image as ImageIcon
} from 'lucide-react';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { getModelDefinition, isTexturePaintingModel } from '@/constants/models';

interface DiscoveredTextureModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  low_vram_supported: boolean;
}

function formatTextureModel(id: string): DiscoveredTextureModel {
  const def = getModelDefinition(id);
  const isTrellis = id.includes('trellis');
  const isHunyuan = id.includes('hunyuan');

  return {
    id,
    label: def?.name || id,
    available: true,
    installed: true,
    status: 'ready',
    vram_required_mb: def?.vramMb || 11776,
    low_vram_supported: def?.lowVramSupported ?? (isTrellis || isHunyuan),
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
  } = useWorkspace();

  // Tab State: 'texture' (essential primary view) | 'maps' (PBR channels & resolution) | 'settings' (advanced & reference)
  const [panelTab, setPanelTab] = useState<'texture' | 'maps' | 'settings'>('texture');

  const [modelRegistry, setModelRegistry] = useState<Record<string, string[]> | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    getApiClient().getAvailableModels().then(data => {
      if (active && data?.available_models) {
        setModelRegistry(data.available_models);
      }
    }).catch(err => {
      console.warn('Failed to load available models for texturing:', err);
    }).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => { active = false; };
  }, []);

  const textureCapableModels = useMemo(() => {
    const textModels = (modelRegistry?.['text_mesh_painting'] || []).filter(isTexturePaintingModel);
    const imageModels = (modelRegistry?.['image_mesh_painting'] || []).filter(isTexturePaintingModel);
    const combined = Array.from(new Set([...textModels, ...imageModels]));
    const defaults = [
      'trellis_image_mesh_painting',
      'trellis2_image_mesh_painting',
      'hunyuan3dv21_image_mesh_painting',
      'trellis_text_mesh_painting',
    ];
    const finalIds = combined.length > 0 ? combined : defaults;
    return finalIds.map(formatTextureModel);
  }, [modelRegistry]);

  const [textureModelDropdownOpen, setTextureModelDropdownOpen] = useState(false);
  const [meshDropdownOpen, setMeshDropdownOpen] = useState(false);

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

  // Auto-select valid texture-capable model when none or invalid selected
  useEffect(() => {
    if (textureCapableModels.length === 0) return;
    const isCurrentModelValid = textureCapableModels.some(m => m.id === textureSettings.modelId);
    if (!isCurrentModelValid) {
      const firstAvailable = textureCapableModels.find(m => m.installed) || textureCapableModels[0];
      setTextureSettings(prev => ({ ...prev, modelId: firstAvailable.id }));
    }
  }, [textureCapableModels, textureSettings.modelId, setTextureSettings]);

  const activeTextureModel = textureCapableModels.find(m => m.id === textureSettings.modelId) || textureCapableModels[0];
  const supportsLowVram = Boolean(activeTextureModel?.low_vram_supported);

  // Status pill logic — shows what's wrong with the selected texture model
  const getTextureStatusInfo = () => {
    const selected = textureCapableModels.find(m => m.id === textureSettings.modelId);
    if (!selected) {
      if (textureCapableModels.length === 0) return { label: 'No texture models', tone: 'warn' as const };
      return null;
    }
    if (selected.available) return null;
    if (selected.status === 'weights_missing') return { label: 'Weights missing', tone: 'warn' as const };
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
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>Texture Studio</span>
          </span>
          {textureStatusInfo && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
              <AlertTriangle className="w-2.5 h-2.5" />
              {textureStatusInfo.label}
            </span>
          )}
        </div>

        {/* 3-Tab Segmented Header */}
        <div className="grid grid-cols-3 p-1 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setPanelTab('texture')}
            className={`py-1.5 px-1 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              panelTab === 'texture'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Palette className="w-3 h-3" />
            <span>Texture</span>
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('maps')}
            className={`py-1.5 px-1 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              panelTab === 'maps'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Maps</span>
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('settings')}
            className={`py-1.5 px-1 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              panelTab === 'settings'
                ? 'bg-primary text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Sliders className="w-3 h-3" />
            <span>Settings</span>
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
            {/* Target 3D Mesh Compact Selector */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-300 flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5 text-primary" />
                  <span>Target Mesh</span>
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

            {/* Mode: AI Texture | Manual Paint */}
            <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setTextureSettings(prev => ({ ...prev, mode: 'ai' }))}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-bold text-[10px] transition-all cursor-pointer ${
                  textureSettings.mode === 'ai'
                    ? 'bg-primary text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3 stroke-[2.2]" />
                <span>AI Texture</span>
              </button>
              <button
                type="button"
                onClick={() => setTextureSettings(prev => ({ ...prev, mode: 'manual' }))}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-bold text-[10px] transition-all cursor-pointer ${
                  textureSettings.mode === 'manual'
                    ? 'bg-primary text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Palette className="w-3 h-3 stroke-[2.2]" />
                <span>Manual Paint</span>
              </button>
            </div>

            {/* AI Texture Model Selector + Dropdown */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1 relative">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">AI Texture Model</span>
                <button
                  type="button"
                  onClick={() => router.push('/admin?tab=models')}
                  className="text-[9px] text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                >
                  <Package className="w-2.5 h-2.5" />
                  <span>Manage</span>
                </button>
              </div>

              <button
                id="btn-select-texture-model"
                type="button"
                onClick={() => setTextureModelDropdownOpen(!textureModelDropdownOpen)}
                className="w-full flex items-center justify-between p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-white/[0.16] hover:bg-[hsl(var(--surface-2))] transition-all text-left cursor-pointer"
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
                    {activeTextureModel?.available
                      ? 'Ready'
                      : activeTextureModel?.installed
                        ? 'Installed · ready'
                        : 'Not installed'}
                  </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${textureModelDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
              </button>

              {textureModelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-[hsl(var(--surface-1))] border border-white/[0.12] rounded-xl p-1.5 shadow-2xl z-50 space-y-1 max-h-48 overflow-y-auto">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 px-1.5 py-0.5">
                    Texture Models ({textureCapableModels.length})
                  </div>
                  {textureCapableModels.length === 0 ? (
                    <div className="px-2 py-2 text-[10px] text-zinc-400 text-center">
                      No texture models configured.
                    </div>
                  ) : (
                    textureCapableModels.map((m) => {
                      const isSelected = m.id === (activeTextureModel?.id || textureSettings.modelId);
                      const isReady = m.available === true;
                      const isInstalled = m.installed === true || isReady;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setTextureSettings(prev => ({
                              ...prev,
                              modelId: m.id,
                              lowVram: m.low_vram_supported ? prev.lowVram : false,
                            }));
                            setTextureModelDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-1.5 rounded-lg text-left transition-all ${
                            isSelected
                              ? 'bg-primary text-black font-bold'
                              : isInstalled
                                ? 'text-white hover:bg-[hsl(var(--surface-2))]'
                                : 'text-zinc-400 opacity-80 hover:bg-[hsl(var(--surface-2))]'
                          }`}
                        >
                          <div className="flex flex-col min-w-0 pr-1">
                            <span className="text-[10px] font-bold truncate">{m.label}</span>
                            <span className={`text-[8px] truncate ${isSelected ? 'text-black/80' : 'text-zinc-400'}`}>
                              {m.low_vram_supported ? 'Low VRAM supported' : `${Math.round((m.vram_required_mb || 0) / 1024)}GB VRAM`}
                            </span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-black flex-shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Essential Quick Toggle: Low VRAM Mode */}
            {supportsLowVram && (
              <div className="p-2 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between">
                <span className="text-zinc-300 flex items-center gap-1.5 text-[10px] font-semibold">
                  <Gauge className="w-3.5 h-3.5 text-primary" />
                  <span>Low VRAM Mode (&lt;8GB)</span>
                </span>
                <button
                  id="btn-texture-toggle-low-vram"
                  type="button"
                  role="switch"
                  aria-checked={Boolean(textureSettings.lowVram)}
                  onClick={() => setTextureSettings(prev => ({ ...prev, lowVram: !prev.lowVram }))}
                  className={`w-7 h-3.5 rounded-full p-0.5 transition-colors relative cursor-pointer ${
                    textureSettings.lowVram ? 'bg-primary' : 'bg-[hsl(var(--surface-2))]'
                  }`}
                >
                  <div
                    className={`w-2.5 h-2.5 rounded-full bg-black transition-transform ${
                      textureSettings.lowVram ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )}

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
                      className={`py-1.5 rounded-lg font-bold text-[10px] transition-all text-center cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-black shadow-sm font-black'
                          : 'bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.06]'
                      }`}
                    >
                      {style.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Guidance Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[10px] uppercase tracking-wider">Prompt Guidance</span>
                {textureSettings.referenceImage && (
                  <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                    <ImageIcon className="w-2.5 h-2.5" />
                    <span>Image Attached</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g., weathered copper armor, cinematic..."
                  value={textureSettings.prompt}
                  onChange={(e) => setTextureSettings(prev => ({ ...prev, prompt: e.target.value }))}
                  className="w-full py-1.5 px-2.5 pr-8 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] focus:border-primary text-[10px] text-white placeholder-zinc-500 focus:outline-none transition-colors"
                />
                {textureSettings.prompt && (
                  <button
                    type="button"
                    onClick={() => setTextureSettings(prev => ({ ...prev, prompt: '' }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Reference Image Quick Status or Upload Row */}
            {textureSettings.referenceImage ? (
              <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={textureSettings.referenceImage}
                    alt="Ref"
                    className="w-7 h-7 object-cover rounded border border-white/[0.1]"
                  />
                  <span className="text-[9px] text-zinc-300 font-medium truncate">Reference Image Active</span>
                </div>
                <button
                  type="button"
                  onClick={clearReference}
                  className="text-[9px] text-zinc-400 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-white/[0.04] transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-1 px-2 rounded-lg bg-[hsl(var(--surface-0))] border border-dashed border-white/[0.12] hover:border-primary/50 text-zinc-400 hover:text-zinc-200 text-[9px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3 h-3 text-primary" />
                  <span>Upload Reference Image (Optional)</span>
                </button>
              </div>
            )}

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
              <button
                id="btn-action-generate-texture"
                type="button"
                onClick={runTextureGeneration}
                disabled={isExecuting || (!textureSettings.referenceImage && !currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl)}
                className={`w-full h-10 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black tracking-wider text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.38)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer btn-lighting-shine ${isExecuting ? 'is-executing' : ''}`}
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                    <span>Baking PBR Textures...</span>
                  </>
                ) : !currentAsset && !textureSettings.referenceImage ? (
                  <span>SELECT A MODEL FIRST</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 stroke-[2.5]" />
                    <span>GENERATE TEXTURE</span>
                  </>
                )}
              </button>
              {!currentAsset && (
                <p className="text-[8px] text-amber-400/80 text-center mt-1">
                  Target mesh required. Select or generate a model above.
                </p>
              )}
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
                    onClick={() => setTextureSettings(prev => ({ ...prev, resolution: res }))}
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
                      className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        checked
                          ? 'bg-[hsl(var(--surface-1))] border-primary text-white'
                          : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400 hover:text-white'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-colors ${
                        checked ? 'bg-primary border-primary text-black' : 'border-white/[0.15]'
                      }`}>
                        {checked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
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
        {/* TAB 3: SETTINGS & REFERENCE IMAGE                                        */}
        {/* ========================================================================= */}
        {panelTab === 'settings' && (
          <div className="space-y-3">
            {/* Reference Image Dropzone */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[10px] uppercase tracking-wider">Reference Image</span>
                {textureSettings.referenceImage && (
                  <button
                    type="button"
                    onClick={clearReference}
                    className="text-[9px] text-red-400 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
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
                    : textureSettings.referenceImage
                    ? 'border-primary/40'
                    : 'border-white/[0.12] hover:border-white/[0.24]'
                }`}
              >
                {uploadProgress.active ? (
                  <div className="flex flex-col items-center justify-center space-y-2 w-full px-2">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
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
                ) : textureSettings.referenceImage ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <img
                      src={textureSettings.referenceImage}
                      alt="Reference"
                      className="max-h-full max-w-full object-contain rounded-md"
                    />
                  </div>
                ) : (
                  <>
                    <Upload className={`w-5 h-5 mb-1 ${isDragOver ? 'text-primary' : 'text-zinc-400'}`} />
                    <span className="text-white font-bold text-[10px]">
                      {isDragOver ? 'Drop image here' : 'Drop or browse reference'}
                    </span>
                    <span className="text-[8px] text-zinc-400 mt-0.5">JPG, PNG, WebP up to 10MB</span>
                  </>
                )}
              </motion.div>

              {referenceError && (
                <div className="flex items-center gap-1 text-[9px] text-red-400">
                  <AlertCircle className="w-2.5 h-2.5" />
                  <span>{referenceError}</span>
                </div>
              )}
            </div>

            {/* Model Weights Link */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-primary" />
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
