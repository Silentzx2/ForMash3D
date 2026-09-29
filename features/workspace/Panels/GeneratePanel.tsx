import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Upload,
  Image as ImageIcon,
  RefreshCw,
  Info,
  X,
  Loader2,
  Box,
  AlertTriangle,
  Plus,
  ChevronDown,
  Check,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import type { PhysicsSettings } from '../types';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { getModelDefinition, isMeshGenerationModel } from '@/constants/models';

export interface MeshQualityPreset {
  id: 'low' | 'medium' | 'high' | 'ultra';
  label: string;
  subLabel: string;
  tagline: string;
  grid: string;
  steps: number;
  polyEstimate: string;
  badge: string;
  tooltip: string;
}

export const MESH_QUALITY_OPTIONS: MeshQualityPreset[] = [
  {
    id: 'low',
    label: 'Low',
    subLabel: '256³ / 20s',
    tagline: 'Fast preview',
    grid: '256',
    steps: 20,
    polyEstimate: '~15k tris',
    badge: '256³ • 20 steps (Fast)',
    tooltip: 'Low: Fast preview (256³ grid • 20 steps • ~15k tris)',
  },
  {
    id: 'medium',
    label: 'Medium',
    subLabel: '384³ / 35s',
    tagline: 'Balanced workflow',
    grid: '384',
    steps: 35,
    polyEstimate: '~30k tris',
    badge: '384³ • 35 steps (Balanced)',
    tooltip: 'Medium: Balanced workflow (384³ grid • 35 steps • ~30k tris)',
  },
  {
    id: 'high',
    label: 'High',
    subLabel: '512³ / 50s',
    tagline: 'Detailed production',
    grid: '512',
    steps: 50,
    polyEstimate: '~60k tris',
    badge: '512³ • 50 steps (Detailed)',
    tooltip: 'High: Detailed production (512³ grid • 50 steps • ~60k tris)',
  },
  {
    id: 'ultra',
    label: 'Ultra',
    subLabel: '640³ / 75s',
    tagline: 'Maximum fidelity',
    grid: '640',
    steps: 75,
    polyEstimate: '~100k tris',
    badge: '640³ • 75 steps (Maximum)',
    tooltip: 'Ultra: Maximum fidelity (640³ grid • 75 steps • ~100k tris)',
  },
  // 'raw' quality removed: text-to-raw-mesh has no registered backend model
];

interface DiscoveredModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  low_vram_supported: boolean;
  low_vram_required_mb?: number;
  supports_texture: boolean;
  supports: { texture_generation: boolean };
  shape_vram_mb: number;
  texture_vram_mb: number;
  supports_flashvdm?: boolean;
}

function formatGenerateModel(id: string, isAvailable = true): DiscoveredModel {
  const def = getModelDefinition(id);
  const isTextured = def?.supportsTexture ?? id.includes('textured');
  const vram = def?.vramMb || 11776;
  const isTrellis = id.includes('trellis');
  const isHunyuan = id.includes('hunyuan');
  const supportsFlashVDM = def?.supportsFlashVDM ?? id.includes('dit_v2_mini_turbo');

  let cleanLabel = def?.name || id;
  if (id === 'trellis_image_to_textured_mesh') cleanLabel = 'TRELLIS (PBR Textured Mesh)';
  else if (id === 'trellis_text_to_textured_mesh') cleanLabel = 'TRELLIS (Text-to-3D Textured)';
  else if (id === 'triposr_image_to_raw_mesh') cleanLabel = 'TripoSR (Ultra-Fast Geometry)';
  else if (id === 'triposg_image_to_raw_mesh') cleanLabel = 'TripoSG (Fast Feed-Forward Geometry)';
  else if (id === 'triposf_image_to_raw_mesh') cleanLabel = 'TripoSF (High-Density Neural Raw Mesh)';
  else if (id === 'hunyuan3d_shape_v21_image_to_raw_mesh') cleanLabel = 'Hunyuan3D-Shape-v2-1 (Raw Geometry)';
  else if (id === 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh') cleanLabel = 'Hunyuan3D-DiT-v2-mini-Turbo (Low-VRAM Geometry)';
  else if (id === 'trellis2_image_to_textured_mesh') cleanLabel = 'TRELLIS 2 (Next-Gen 4B)';
  else if (id === 'partpacker_image_to_raw_mesh') cleanLabel = 'PartPacker (Modular Mesh)';
  else if (id === 'ultrashape_image_to_raw_mesh') cleanLabel = 'UltraShape (High-Poly Geometry)';

  return {
    id,
    label: cleanLabel,
    available: isAvailable,
    installed: isAvailable,
    status: isAvailable ? 'ready' : 'uninstalled',
    vram_required_mb: vram,
    low_vram_supported: def?.lowVramSupported ?? (isTrellis || isHunyuan),
    low_vram_required_mb: def?.lowVramMb ?? ((isTrellis || isHunyuan) ? 6144 : undefined),
    supports_texture: isTextured,
    supports: { texture_generation: isTextured },
    shape_vram_mb: Math.round(vram * 0.6),
    texture_vram_mb: vram,
    supports_flashvdm: supportsFlashVDM,
  };
}

export const GeneratePanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    generate3DModel,
    generationSettings,
    setGenerationSettings
  } = useWorkspace();

  const currentMode = generationSettings.mode || 'image-to-3d';
  const [modelRegistry, setModelRegistry] = useState<Record<string, string[]> | null>(null);
  const [weightsStatus, setWeightsStatus] = useState<Record<string, boolean>>({});
  const [optionsLoading, setOptionsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    getApiClient().getAvailableModels().then(data => {
      if (active) {
        if (data?.available_models) {
          setModelRegistry(data.available_models);
        }
        if ((data as any)?.weights_status) {
          setWeightsStatus((data as any).weights_status);
        }
      }
    }).catch(err => {
      console.warn('Failed to load available models:', err);
    }).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => { active = false; };
  }, []);

  const relevantModelIds = useMemo(() => {
    let ids: string[] = [];
    if (currentMode === 'text-to-3d') {
      const textModels = (modelRegistry?.['text_to_textured_mesh'] || []).filter(isMeshGenerationModel);
      ids = textModels.length > 0 ? textModels : ['trellis_text_to_textured_mesh'];
    } else {
      const textured = (modelRegistry?.['image_to_textured_mesh'] || []).filter(isMeshGenerationModel);
      const raw = (modelRegistry?.['image_to_raw_mesh'] || []).filter(isMeshGenerationModel);
      const combined = Array.from(new Set([...textured, ...raw]));
      const defaults = [
        'trellis_image_to_textured_mesh',
        'triposr_image_to_raw_mesh',
        'triposg_image_to_raw_mesh',
        'hunyuan3d_shape_v21_image_to_raw_mesh',
        'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
        'triposf_image_to_raw_mesh',
      ];
      ids = combined.length > 0 ? combined : defaults;
    }

    // Only show models whose weights are verified available on disk or on-demand downloadable
    if (weightsStatus && Object.keys(weightsStatus).length > 0) {
      const availableOnly = ids.filter(id => weightsStatus[id] === true);
      if (availableOnly.length > 0) return availableOnly;
    }
    return ids;
  }, [modelRegistry, currentMode, weightsStatus]);

  const meshCapableModels = useMemo(() => {
    return relevantModelIds.map(id => formatGenerateModel(id, weightsStatus[id] !== false));
  }, [relevantModelIds, weightsStatus]);

  const gpuAvailable = true;
  const freeVramMb = 24 * 1024;
  const providersList = meshCapableModels;

  // Auto-correct selected model if it does not belong to the current mode / mesh generation
  useEffect(() => {
    if (providersList.length === 0) return;
    const isCurrentModelValid = providersList.some(m => m.id === generationSettings.aiModel);
    if (!isCurrentModelValid) {
      setGenerationSettings(prev => ({
        ...prev,
        aiModel: providersList[0].id,
      }));
    }
  }, [providersList, generationSettings.aiModel, setGenerationSettings]);

  // Status pill logic — shows what's wrong with the selected model
  const getStatusInfo = () => {
    const selected = providersList.find(m => m.id === generationSettings.aiModel);
    if (!selected) {
      if (providersList.length === 0) return { label: 'No models installed', tone: 'warn' as const };
      return null;
    }
    if (selected.available) return null; // ready → no pill
    if (selected.status === 'weights_missing') return { label: 'Weights missing', tone: 'warn' as const };
    if (!selected.installed) return { label: 'Model not installed', tone: 'warn' as const };
    if (selected.status) return { label: selected.status, tone: 'warn' as const };
    return { label: 'Not ready', tone: 'warn' as const };
  };

  const statusInfo = getStatusInfo();

  // Keep the user's model selection. Only repair an invalid selection after
  // the available-model list changes; never rank or silently replace models.

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelDropdownOpen]);

  const [subAction, setSubAction] = useState<'upload' | 'crop'>('upload');
  const [activeMvSlot, setActiveMvSlot] = useState<'front' | 'back' | 'left' | 'right'>('front');
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { progress: uploadProgress, startUpload, updateProgress, finishUpload, failUpload } = useUploadProgress();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeModelId = generationSettings.aiModel || providersList[0]?.id || '';
  const activeModelObj = providersList.find(m => m.id === activeModelId) || providersList[0];
  const isFlashVDMModel = activeModelObj?.id?.includes('dit_v2_mini_turbo') || false;

  const physics = generationSettings.physics ?? {
    bodyType: 'auto' as const,
    massMode: 'auto' as const,
    massKg: 1,
    densityMode: 'auto' as const,
    densityKgM3: 500,
    friction: 0.5,
    restitution: 0.1,
    linearDamping: 0.05,
    angularDamping: 0.05,
    gravityEnabled: true,
    collisionQuality: 'balanced' as const,
    deformation: 'off' as const,
  };

  const updatePhysics = (updates: Partial<PhysicsSettings>) => {
    setGenerationSettings(prev => {
      const current = prev.physics || physics;
      return {
        ...prev,
        physics: {
          ...current,
          ...updates,
        },
      };
    });
  };

  const springTransition = { type: 'spring' as const, stiffness: 400, damping: 25 };

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const processImageFile = async (file: File) => {
    setUploadError(null);

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Invalid file type. Use JPG, PNG, or WEBP.');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError('File too large. Maximum size is 20MB.');
      return;
    }

    try {
      startUpload(file.name, file.size);
      const formData = new FormData();
      formData.append('file', file);
      const res = await getApiClient().post<{ file_id: string; filename?: string }>(
        '/api/v1/file-upload/image',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (progressEvent) => updateProgress(Math.round((progressEvent.loaded / (progressEvent.total || 1)) * 100)) }
      );
      finishUpload();
      if (!res.file_id) throw new Error('Backend did not return a file ID for the uploaded image.');
      const previewUrl = URL.createObjectURL(file);
      const cleanPrompt = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setGenerationSettings(prev => ({
        ...prev,
        image: previewUrl,
        imageFileId: res.file_id,
        prompt: cleanPrompt,
        imageName: cleanPrompt,
      }));
    } catch (err) {
      failUpload();
      setUploadError('Failed to upload image.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processImageFileForSlot = async (file: File, slot: 'front' | 'back' | 'left' | 'right') => {
    setUploadError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Invalid file type. Use JPG, PNG, or WEBP.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError('File too large. Maximum size is 20MB.');
      return;
    }
    try {
      startUpload(file.name, file.size);
      const formData = new FormData();
      formData.append('file', file);
      const res = await getApiClient().post<{ file_id: string }>(
        '/api/v1/file-upload/image',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (progressEvent) => updateProgress(Math.round((progressEvent.loaded / (progressEvent.total || 1)) * 100)) }
      );
      finishUpload();
      if (!res.file_id) throw new Error('Backend did not return a file ID for the uploaded image.');
      const previewUrl = URL.createObjectURL(file);
      const cleanPrompt = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setGenerationSettings(prev => ({
        ...prev,
        multiviewImages: {
          ...(prev.multiviewImages || {}),
          [slot]: previewUrl,
        },
        image: slot === 'front' || !prev.image ? previewUrl : prev.image,
        imageFileId: slot === 'front' || !prev.imageFileId ? res.file_id : prev.imageFileId,
        imageName: slot === 'front' || !prev.imageName ? cleanPrompt : prev.imageName,
        mode: 'image-to-3d',
      }));
    } catch (err) {
      failUpload();
      setUploadError('Failed to upload multiview image.');
    }
  };

  const handleMultiFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFileForSlot(file, activeMvSlot);
    if (multiFileInputRef.current) multiFileInputRef.current.value = '';
  };

  const SAMPLE_MULTIVIEW = {
    front: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%2318191D"/><polygon points="100,30 150,70 140,160 60,160 50,70" fill="%232e3440" stroke="%23F9CF00" stroke-width="3"/><circle cx="100" cy="85" r="22" fill="%23F9CF00"/><circle cx="100" cy="85" r="10" fill="%23111"/><text x="100" y="185" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="10" font-weight="bold">FRONT VIEW</text></svg>',
    back: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%2318191D"/><polygon points="100,30 150,70 140,160 60,160 50,70" fill="%23232731" stroke="%2364748b" stroke-width="3"/><rect x="80" y="70" width="40" height="40" rx="4" fill="%23334155"/><text x="100" y="185" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="10" font-weight="bold">BACK VIEW</text></svg>',
    left: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%2318191D"/><polygon points="80,30 130,50 120,160 70,160" fill="%232a303c" stroke="%2338bdf8" stroke-width="3"/><circle cx="115" cy="85" r="8" fill="%23F9CF00"/><text x="100" y="185" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="10" font-weight="bold">LEFT PROFILE</text></svg>',
    right: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%2318191D"/><polygon points="120,30 70,50 80,160 130,160" fill="%232a303c" stroke="%2338bdf8" stroke-width="3"/><circle cx="85" cy="85" r="8" fill="%23F9CF00"/><text x="100" y="185" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="10" font-weight="bold">RIGHT PROFILE</text></svg>',
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

  const handleImageTo3DTabClick = () => {
    setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
  };

  const handleModelSelect = (model: any) => {
    setGenerationSettings(prev => ({
      ...prev,
      aiModel: model.id,
      lowVram: model.low_vram_supported ? prev.lowVram : false,
    }));
  };

  const SAMPLE_PRESETS = [
    {
      id: 'mech-sentinel',
      name: 'Mech Sentinel',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%231a1c23"/><polygon points="150,40 230,100 210,240 90,240 70,100" fill="%232e3440" stroke="%23F9CF00" stroke-width="4"/><circle cx="150" cy="120" r="35" fill="%23F9CF00"/><circle cx="150" cy="120" r="15" fill="%23111"/><rect x="110" y="180" width="80" height="40" rx="8" fill="%23434c5e" stroke="%23d8dee9" stroke-width="2"/><text x="150" y="270" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="12" font-weight="bold">MECH SENTINEL</text></svg>',
    },
    {
      id: 'cyber-drone',
      name: 'Cyber Drone',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%231a1c23"/><circle cx="150" cy="140" r="70" fill="%232b303c" stroke="%2338bdf8" stroke-width="4"/><path d="M120,130 Q150,110 180,130" stroke="%2338bdf8" stroke-width="8" stroke-linecap="round" fill="none"/><circle cx="130" cy="155" r="8" fill="%23F9CF00"/><circle cx="170" cy="155" r="8" fill="%23F9CF00"/><text x="150" y="260" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="12" font-weight="bold">CYBER DROID</text></svg>',
    },
    {
      id: 'sci-fi-helmet',
      name: 'Sci-Fi Helmet',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%231a1c23"/><path d="M90,80 Q150,30 210,80 Q240,160 210,230 Q150,260 90,230 Q60,160 90,80 Z" fill="%232e3440" stroke="%23a855f7" stroke-width="4"/><path d="M100,120 Q150,90 200,120 Q210,160 195,180 Q150,200 105,180 Z" fill="%23F9CF00"/><text x="150" y="270" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="12" font-weight="bold">HELMET MK-IV</text></svg>',
    },
    {
      id: 'obsidian-blade',
      name: 'Obsidian Blade',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%231a1c23"/><path d="M150,30 L175,170 L150,190 L125,170 Z" fill="%233b4252" stroke="%2310b981" stroke-width="3"/><rect x="110" y="190" width="80" height="12" rx="4" fill="%234c566a"/><rect x="142" y="202" width="16" height="60" rx="3" fill="%232e3440" stroke="%23F9CF00" stroke-width="2"/><circle cx="150" cy="272" r="10" fill="%23F9CF00"/><text x="150" y="292" text-anchor="middle" fill="%23eceff4" font-family="sans-serif" font-size="11" font-weight="bold">OBSIDIAN BLADE</text></svg>',
    },
  ];

  const handleGenerate = () => {
    const hasImage = Boolean(
      generationSettings.image ||
      generationSettings.multiviewImages?.front ||
      (generationSettings.multiviewImages && Object.values(generationSettings.multiviewImages).some(Boolean))
    );
    if (!hasImage) {
      setNoticeMessage('Please upload a reference image or select a multiview set.');
      setTimeout(() => setNoticeMessage(null), 4000);
      return;
    }
    // Guarantee top quality settings automatically
    setGenerationSettings(prev => ({
      ...prev,
      generateTexture: prev.generateTexture !== false,
      removeBackground: true,
      autoOptimize: true,
      autoOptimizeSettings: {
        ...prev.autoOptimizeSettings,
        targetPolycount: prev.autoOptimizeSettings?.targetPolycount || 60000,
        fixUVs: true,
        preserveDetails: 85,
      },
    }));
    generate3DModel('image-to-3d');
  };

  return (
    <div id="panel-generate-model" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-x-hidden overflow-y-hidden">
      {/* Panel Header */}
      <div className="px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-xs text-white flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>Generate 3D Model</span>
        </span>
        {statusInfo && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
            <AlertTriangle className="w-3 h-3" />
            {statusInfo.label}
          </span>
        )}
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2.5 space-y-2.5 scrollbar-none pr-1.5">
        {/* Notice Message Toast/Banner */}
        <AnimatePresence>
          {noticeMessage && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-2 rounded-xl bg-primary/15 border border-primary/40 text-primary text-[10.5px] flex items-center justify-between gap-1.5 overflow-hidden"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Info className="w-4 h-4 flex-shrink-0" />
                <span className="leading-tight font-medium">{noticeMessage}</span>
              </div>
              <button 
                onClick={() => setNoticeMessage(null)}
                className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified Studio Generation Pipeline */}
        <div className="space-y-2.5">
          {/* Input Mode Selector Bar */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="relative grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
                {[
                  {
                    id: 'upload',
                    domId: 'subaction-btn-upload',
                    label: 'Single Image',
                    tooltip: 'Single Image to 3D Mesh',
                    icon: ImageIcon,
                    onClick: () => {
                      setSubAction('upload');
                      setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
                      fileInputRef.current?.click();
                    },
                  },
                  {
                    id: 'crop',
                    domId: 'subaction-btn-crop',
                    label: 'Multiview Set',
                    tooltip: 'Multiview Perspective Angles (Front, Right, Back, Left)',
                    icon: Box,
                    onClick: () => {
                      setSubAction('crop');
                      setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
                    },
                  },
                ].map((tab) => {
                  const active = subAction === tab.id;
                  const Icon = tab.icon;
                  return (
                    <SimpleTooltip key={tab.id} label={tab.tooltip}>
                      <button
                        id={tab.domId}
                        type="button"
                        onClick={tab.onClick}
                        className={`relative w-full py-1 px-1 rounded-md text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer active:scale-95 z-10 ${
                          active ? 'text-primary font-bold' : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="subActionActiveTab"
                            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                            className="absolute inset-0 rounded-md bg-[hsl(var(--surface-2))] border border-primary/50 shadow-[0_0_10px_rgba(255,204,0,0.2)] -z-10"
                          />
                        )}
                        <Icon className="w-3.5 h-3.5" />
                        <span className="truncate">{tab.label}</span>
                      </button>
                    </SimpleTooltip>
                  );
                })}
              </div>

              {/* Mode 1: Single Image Upload */}
              {subAction === 'upload' && (
                <>
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept="image/jpeg,image/png,image/webp" 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                  
                  <motion.div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    animate={{ 
                      scale: isDragOver ? 1.02 : 1,
                      borderColor: isDragOver ? 'hsl(var(--primary))' : uploadError ? '#ef4444' : 'rgba(255,255,255,0.08)',
                    }}
                    transition={springTransition}
                    className="relative w-full h-24 rounded-lg border border-dashed border-white/[0.12] cursor-pointer overflow-hidden flex flex-col items-center justify-center p-2 group/dropzone bg-[hsl(var(--surface-1))]/50 hover:bg-[hsl(var(--surface-1))]"
                  >
                    {uploadProgress.active ? (
                      <div className="text-center space-y-1.5 w-full px-2 z-10">
                        <Loader2 className="w-5 h-5 mx-auto animate-spin text-primary" />
                        <div className="font-bold text-[10px] text-white">Uploading...</div>
                        <div className="w-full bg-[hsl(var(--surface-2))] rounded-full h-1.5 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress.percent}%` }}
                            className="bg-primary h-full rounded-full"
                          />
                        </div>
                      </div>
                    ) : generationSettings.image ? (
                      <div className="relative w-full h-full group z-10">
                        <img
                          src={generationSettings.image}
                          alt="Source reference"
                          className="w-full h-full object-contain border-0 bg-transparent rounded-none"
                        />
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          className="absolute bottom-1.5 right-1.5 bg-black/80 hover:bg-black border border-white/20 text-primary px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer z-20 transition-all opacity-0 group-hover:opacity-100 shadow-md"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Replace</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center space-y-1.5 z-10">
                        <div className={`w-8 h-8 mx-auto rounded-full bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center transition-all ${
                          isDragOver ? 'text-primary border-primary' : 'text-zinc-400 group-hover/dropzone:text-primary'
                        }`}>
                          <Upload className="w-4 h-4" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="font-bold text-xs text-zinc-100">
                            Drop Reference Image
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            JPG, PNG, WEBP ≤ 20MB
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>

                  {/* Quick Presets / Clear image */}
                  <div className="flex items-center justify-between text-[10px] pt-0.5">
                    <span className="text-zinc-400 font-medium">{generationSettings.image ? 'Loaded' : 'Sample:'}</span>
                    <div className="flex items-center gap-1.5">
                      {generationSettings.image ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGenerationSettings(prev => ({ ...prev, image: null, imageName: undefined, mode: 'image-to-3d' }));
                          }}
                          className="text-rose-400 hover:underline cursor-pointer font-medium"
                        >
                          Clear Image
                        </button>
                      ) : (
                        SAMPLE_PRESETS.slice(0, 3).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGenerationSettings(prev => ({
                                ...prev,
                                image: preset.url,
                                prompt: preset.name,
                                imageName: preset.name,
                                mode: 'image-to-3d',
                              }));
                            }}
                            className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] text-[9.5px] font-medium cursor-pointer transition-colors"
                          >
                            {preset.name.split(' ')[0]}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Mode 2: Multi-View Grid */}
              {subAction === 'crop' && (
                <>
                  <input
                    ref={multiFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleMultiFileUpload}
                  />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                        <Box className="w-3.5 h-3.5 text-primary" />
                        <span>Multiview Perspective Angles</span>
                      </span>
                      <span className="text-[9px] text-zinc-400 font-mono">
                        {Object.values(generationSettings.multiviewImages || {}).filter(Boolean).length}/4 loaded
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        { key: 'front', label: 'Front', req: true },
                        { key: 'right', label: 'Right', req: false },
                        { key: 'back', label: 'Back', req: false },
                        { key: 'left', label: 'Left', req: false },
                      ] as const).map(({ key, label, req }) => {
                        const imgUrl = generationSettings.multiviewImages?.[key];
                        return (
                          <div
                            key={key}
                            onClick={() => {
                              setActiveMvSlot(key);
                              multiFileInputRef.current?.click();
                            }}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const f = e.dataTransfer.files?.[0];
                              if (f) processImageFileForSlot(f, key);
                            }}
                            className={`relative h-20 rounded-lg border flex flex-col items-center justify-center p-1 cursor-pointer transition-all overflow-hidden group ${
                              imgUrl
                                ? 'border-primary/50 bg-[hsl(var(--surface-2))] shadow-sm'
                                : 'border-dashed border-white/[0.14] bg-[hsl(var(--surface-1))]/60 hover:bg-[hsl(var(--surface-1))] hover:border-primary/50'
                            }`}
                          >
                            {imgUrl ? (
                              <>
                                <img src={imgUrl} alt={`${label} view`} className="w-full h-full object-contain" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <span className="text-[8px] font-bold text-white bg-black/80 px-1.5 py-0.5 rounded">Change</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setGenerationSettings(prev => {
                                      const nextMv = { ...(prev.multiviewImages || {}) };
                                      delete nextMv[key];
                                      return {
                                        ...prev,
                                        multiviewImages: nextMv,
                                        image: key === 'front' ? (nextMv.right || nextMv.back || nextMv.left || null) : prev.image,
                                      };
                                    });
                                  }}
                                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                                  title={`Remove ${label} view`}
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </>
                            ) : (
                              <div className="text-center space-y-0.5">
                                <Plus className="w-4 h-4 mx-auto text-zinc-500 group-hover:text-primary transition-colors" />
                                <span className="text-[8px] text-zinc-400 font-medium block">{label}</span>
                              </div>
                            )}
                            <div className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded text-[7px] font-bold bg-black/70 text-zinc-300">
                              {label}{req ? ' *' : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[9.5px] pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setGenerationSettings(prev => ({
                            ...prev,
                            multiviewImages: SAMPLE_MULTIVIEW,
                            image: SAMPLE_MULTIVIEW.front,
                            imageName: 'Sample Multiview Set',
                            mode: 'image-to-3d',
                          }));
                        }}
                        className="text-primary hover:underline font-medium cursor-pointer"
                      >
                        Load 4-View Sample &gt;
                      </button>
                      {Boolean(generationSettings.multiviewImages && Object.values(generationSettings.multiviewImages).some(Boolean)) && (
                        <button
                          type="button"
                          onClick={() => {
                            setGenerationSettings(prev => ({
                              ...prev,
                              multiviewImages: undefined,
                              image: null,
                              imageName: undefined,
                            }));
                          }}
                          className="text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear All Views
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* AI 3D Model Engine Selector (Clean Dropdown + Low VRAM & Texture Toggles) */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>AI 3D Engine</span>
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25 font-bold">
                  {activeModelObj?.supports_texture ? 'PBR Textured' : 'Geometry'}
                </span>
              </div>

              {/* Model Trigger Button */}
              <button
                id="btn-select-ai-model"
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] hover:border-white/[0.22] hover:bg-[hsl(var(--surface-2))] transition-all text-left cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-1">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    (activeModelObj?.available || activeModelObj?.installed)
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                      : 'bg-zinc-500'
                  }`} />
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[12px] text-white truncate">
                      {activeModelObj?.label || activeModelId || 'Select Model'}
                    </span>
                    <span className="text-[10px] text-zinc-400 truncate mt-0.5">
                      {activeModelObj?.vram_required_mb ? `${Math.round(activeModelObj.vram_required_mb / 1024)}GB VRAM · ` : ''}
                      {activeModelObj?.supports_texture ? 'Full PBR Output' : 'High-Density Mesh'}
                    </span>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
              </button>

              {/* Clean Dropdown Menu */}
              {modelDropdownOpen && (
                <div 
                  ref={modelDropdownRef}
                  className="absolute left-0 right-0 top-full mt-1.5 bg-[hsl(var(--surface-1))]/95 backdrop-blur-xl border border-white/[0.16] rounded-xl p-1.5 shadow-2xl z-50 space-y-1 max-h-60 overflow-y-auto overflow-x-hidden scrollbar-none"
                >
                  <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    <span>Available AI Engines</span>
                    <span className="font-mono text-primary font-bold">{providersList.length}</span>
                  </div>
                  {providersList.map((m) => {
                    const isSelected = m.id === (activeModelObj?.id || activeModelId);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setGenerationSettings(prev => ({
                            ...prev,
                            aiModel: m.id,
                            generateTexture: m.supports_texture ? (prev.generateTexture !== false) : false,
                          }));
                          setModelDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-primary text-black font-black shadow-sm'
                            : 'text-zinc-200 hover:text-white hover:bg-white/[0.08]'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? 'bg-black' : (m.available || m.installed) ? 'bg-emerald-400' : 'bg-zinc-500'
                            }`} />
                            <span className="text-xs font-bold truncate">{m.label}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 pl-3.5">
                            <span className={`text-[10px] font-mono ${isSelected ? 'text-black/80 font-bold' : 'text-zinc-400'}`}>
                              {m.vram_required_mb ? `${Math.round(m.vram_required_mb / 1024)}GB VRAM` : 'Standard'}
                            </span>
                            <span className={isSelected ? 'text-black/60' : 'text-zinc-600'}>•</span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                              isSelected
                                ? 'bg-black/20 text-black'
                                : m.supports_texture
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-zinc-500/15 text-zinc-400'
                            }`}>
                              {m.supports_texture ? 'PBR Texture' : 'Raw Mesh'}
                            </span>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-black flex-shrink-0 stroke-[2.5]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Engine Feature Toggles: PBR Texture & Low VRAM */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
                {/* PBR Texture Toggle */}
                <button
                  type="button"
                  onClick={() => setGenerationSettings(prev => ({
                    ...prev,
                    generateTexture: prev.generateTexture === false,
                  }))}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-all cursor-pointer ${
                    generationSettings.generateTexture !== false
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                      : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400'
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="text-[11px] font-bold text-white leading-tight">PBR Texture</span>
                    <span className="text-[9px] text-zinc-400">
                      {generationSettings.generateTexture !== false ? 'Color Maps' : 'Disabled'}
                    </span>
                  </div>
                  <div className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${
                    generationSettings.generateTexture !== false ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}>
                    <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${
                      generationSettings.generateTexture !== false ? 'left-4' : 'left-0.5 bg-zinc-300'
                    }`} />
                  </div>
                </button>

                {/* FlashVDM Toggle - only visible for FlashVDM-compatible models */}
                {isFlashVDMModel && (
                  <button
                    type="button"
                    onClick={() => setGenerationSettings(prev => ({
                      ...prev,
                      enableFlashVDM: !prev.enableFlashVDM,
                    }))}
                    className={`p-2 rounded-lg border text-left flex items-center justify-between transition-all cursor-pointer ${
                      Boolean(generationSettings.enableFlashVDM)
                        ? 'bg-amber-500/10 border-amber-500/30 text-white'
                        : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="text-[11px] font-bold text-white leading-tight">FlashVDM</span>
                      <span className="text-[9px] text-zinc-400">
                        {Boolean(generationSettings.enableFlashVDM) ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${
                      Boolean(generationSettings.enableFlashVDM) ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}>
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${
                        Boolean(generationSettings.enableFlashVDM) ? 'left-4' : 'left-0.5 bg-zinc-300'
                      }`} />
                    </div>
                  </button>
                )}

                {/* Low VRAM Toggle */}
                <button
                  type="button"
                  onClick={() => setGenerationSettings(prev => ({
                    ...prev,
                    lowVram: !prev.lowVram,
                  }))}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-all cursor-pointer ${
                    Boolean(generationSettings.lowVram)
                      ? 'bg-primary/10 border-primary/30 text-white'
                      : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400'
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="text-[11px] font-bold text-white leading-tight">Low VRAM</span>
                    <span className="text-[9px] text-zinc-400">
                      {Boolean(generationSettings.lowVram) ? 'Active (<12G)' : 'Full Speed'}
                    </span>
                  </div>
                  <div className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${
                    Boolean(generationSettings.lowVram) ? 'bg-primary' : 'bg-zinc-700'
                  }`}>
                    <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${
                      Boolean(generationSettings.lowVram) ? 'left-4' : 'left-0.5 bg-zinc-300'
                    }`} />
                  </div>
                </button>
              </div>
            </div>


            {/* Physics Preparation */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span>Physics Preparation</span>
                </div>
                <span className="text-[9px] text-zinc-500">Post-process · no extra AI model</span>
              </div>

              <button type="button"
                onClick={() => setGenerationSettings(prev => ({ ...prev, generateCollision: !Boolean(prev.generateCollision) }))}
                className={generationSettings.generateCollision ? 'w-full p-2 rounded-lg border border-primary/40 bg-primary/10 text-left text-white' : 'w-full p-2 rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] text-left text-zinc-400'}
              >
                <span className="text-[11px] font-bold">Physics Ready Asset</span>
                <span className="block text-[9px] text-zinc-400 mt-0.5">
                  {generationSettings.generateCollision ? 'Collision + physical metadata will be generated' : 'Keep generation mesh-only'}
                </span>
              </button>

              {generationSettings.generateCollision && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">Body Behaviour</span>
                    <select value={physics.bodyType} onChange={e => updatePhysics({ bodyType: e.target.value as PhysicsSettings['bodyType'] })} className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200">
                      <option value="auto">Auto</option>
                      <option value="dynamic">Dynamic</option>
                      <option value="static">Static</option>
                      <option value="kinematic">Kinematic</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">Collision Quality</span>
                    <select value={physics.collisionQuality} onChange={e => updatePhysics({ collisionQuality: e.target.value as PhysicsSettings['collisionQuality'] })} className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200">
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="precise">Precise</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">Density</span>
                    <select value={physics.densityMode} onChange={e => updatePhysics({ densityMode: e.target.value as PhysicsSettings['densityMode'] })} className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200">
                      <option value="auto">Auto default</option>
                      <option value="manual">Manual kg/m³</option>
                    </select>
                    {physics.densityMode === 'manual' && (
                      <input type="number" min={0.01} max={20000} step={10} value={physics.densityKgM3}
                        onChange={e => updatePhysics({ densityKgM3: Number(e.target.value) || 1 })}
                        className="w-full mt-1 rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200" />
                    )}
                  </label>

                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">Mass</span>
                    <select value={physics.massMode} onChange={e => updatePhysics({ massMode: e.target.value as PhysicsSettings['massMode'] })} className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200">
                      <option value="auto">Auto estimate</option>
                      <option value="manual">Manual kg</option>
                    </select>
                    {physics.massMode === 'manual' && (
                      <input type="number" min={0.01} max={100000} step={0.1} value={physics.massKg}
                        onChange={e => updatePhysics({ massKg: Number(e.target.value) || 0.01 })}
                        className="w-full mt-1 rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200" />
                    )}
                  </label>

                  {[
                    ['friction', 'Friction', 0, 2, 0.05],
                    ['restitution', 'Bounce', 0, 1, 0.05],
                    ['linearDamping', 'Linear Damp', 0, 1, 0.01],
                    ['angularDamping', 'Angular Damp', 0, 1, 0.01],
                  ].map(([key, label, min, max, step]) => (
                    <label key={String(key)} className="space-y-1">
                      <div className="flex justify-between text-[9px] text-zinc-400">
                        <span>{String(label)}</span>
                        <span className="font-mono text-primary">{Number(physics[key as keyof PhysicsSettings]).toFixed(2)}</span>
                      </div>
                      <input type="range" min={Number(min)} max={Number(max)} step={Number(step)}
                        value={Number(physics[key as keyof PhysicsSettings])}
                        onChange={e => updatePhysics({ [key]: Number(e.target.value) } as Partial<PhysicsSettings>)}
                        className="w-full accent-[hsl(var(--primary))]" />
                    </label>
                  ))}

                  <button type="button"
                    onClick={() => updatePhysics({ gravityEnabled: !physics.gravityEnabled })}
                    className="col-span-2 px-2 py-1.5 rounded-md border border-white/[0.06] bg-[hsl(var(--surface-1))] text-[9px] font-semibold text-left text-zinc-300"
                  >
                    Gravity {physics.gravityEnabled ? 'enabled' : 'disabled'}
                  </button>

                  <div className="col-span-2 flex items-center justify-between rounded-md border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5">
                    <span className="text-[9px] text-zinc-400">Jiggle / deformation</span>
                    <span className="text-[9px] font-semibold text-zinc-500">Capability-gated</span>
                  </div>
                </div>
              )}
            </div>

            {/* Streamlined Mesh Settings Card (Target Polycount + Triangle / Quad Topology ONLY) */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <Box className="w-3.5 h-3.5 text-primary" />
                  <span>Mesh Settings</span>
                </div>
                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Studio Quality
                </span>
              </div>

              {/* 1. Target Polycount Budget */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium">Target Polycount</span>
                  <span className="font-mono text-primary font-bold text-xs bg-primary/10 px-2 py-0.5 rounded border border-primary/25">
                    {((generationSettings.autoOptimizeSettings?.targetPolycount || 60000)).toLocaleString()} tris
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { label: '15K', val: 15000, desc: 'Mobile' },
                    { label: '35K', val: 35000, desc: 'Game' },
                    { label: '60K', val: 60000, desc: 'Studio' },
                    { label: '100K', val: 100000, desc: 'Ultra' },
                  ].map((preset) => {
                    const isSelected = (generationSettings.autoOptimizeSettings?.targetPolycount || 60000) === preset.val;
                    return (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() => {
                          setGenerationSettings(prev => ({
                            ...prev,
                            autoOptimize: true,
                            autoOptimizeSettings: {
                              ...prev.autoOptimizeSettings,
                              targetPolycount: preset.val,
                              preserveDetails: 85,
                              fixUVs: true,
                            },
                          }));
                        }}
                        className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                          isSelected
                            ? 'bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-black font-black shadow-[0_0_8px_rgba(255,204,0,0.35)]'
                            : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06]'
                        }`}
                      >
                        <span className="text-[11px] font-black leading-tight">{preset.label}</span>
                        <span className={`text-[8px] ${isSelected ? 'text-black/75 font-bold' : 'text-zinc-500'}`}>{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Smooth Slider */}
                <input
                  type="range"
                  min={5000}
                  max={120000}
                  step={5000}
                  value={generationSettings.autoOptimizeSettings?.targetPolycount || 60000}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setGenerationSettings(prev => ({
                      ...prev,
                      autoOptimize: true,
                      autoOptimizeSettings: {
                        ...prev.autoOptimizeSettings,
                        targetPolycount: val,
                        preserveDetails: 85,
                        fixUVs: true,
                      },
                    }));
                  }}
                  className="w-full h-1.5 rounded-full appearance-none bg-[hsl(var(--surface-2))] accent-primary cursor-pointer"
                />
              </div>

              {/* 2. Topology Selection: Triangles vs Quads */}
              <div className="space-y-1 pt-1 border-t border-white/[0.04]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium">Topology Target</span>
                  <span className="text-[10px] text-zinc-400 font-mono uppercase">
                    {(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'Quads (post-process)' : 'Triangles'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setGenerationSettings(prev => ({
                        ...prev,
                        topologyMode: 'triangle',
                        quadTopology: false,
                      }));
                    }}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
                      generationSettings.topologyMode !== 'quad' && !generationSettings.quadTopology
                        ? 'bg-primary text-black font-black shadow-sm'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.08]'
                    }`}
                  >
                    <span>▲ Triangles</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGenerationSettings(prev => ({
                        ...prev,
                        topologyMode: 'quad',
                        quadTopology: true,
                      }));
                    }}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
                      generationSettings.topologyMode === 'quad' || generationSettings.quadTopology
                        ? 'bg-primary text-black font-black shadow-sm'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.08]'
                    }`}
                  >
                    <span>■ Quads (post-process)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Bottom Sticky Action Footer */}
      <div className="p-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] relative z-20 flex-shrink-0 space-y-2 overflow-x-hidden">
        {/* Smart Pre-flight Configuration Summary Bar */}
        <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-400 px-0.5 pb-0.5">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-200 font-semibold truncate max-w-[140px]">
              {activeModelObj?.label || activeModelObj?.id || 'Trellis'}
            </span>
            <span>•</span>
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase flex-shrink-0">
              {Math.round((generationSettings.autoOptimizeSettings?.targetPolycount || 60000) / 1000)}K {(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'QUADS' : 'TRIS'}
            </span>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border flex-shrink-0 ${
            generationSettings.generateTexture !== false
              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
              : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
          }`}>
            {generationSettings.generateTexture !== false ? 'PBR TEXTURED' : 'GEOMETRY ONLY'}
          </span>
        </div>

        {/* Bottom Sticky Action Button */}
        <ShimmerButton
          id="btn-generate-model-action"
          onClick={handleGenerate}
          disabled={isExecuting}
          shimmerColor="hsl(var(--neon-amber))"
          shimmerSize="0.1em"
          shimmerDuration="2.5s"
          borderRadius="12px"
          background={
            isExecuting
              ? "hsl(var(--surface-2))"
              : "linear-gradient(135deg, #FFE066 0%, #FFCC00 50%, #E09800 100%)"
          }
          className={`w-full h-10 font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed btn-lighting-shine ${
            isExecuting 
              ? 'text-primary border border-primary/30 is-executing' 
              : 'text-[#080808] shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,204,0,0.45)] active:scale-[0.98]'
          }`}
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <span className="tracking-wide">{executionStep || 'Generating 3D Model...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="tracking-wider">GENERATE 3D MODEL</span>
            </>
          )}
        </ShimmerButton>
        {isExecuting && (
          <div className="relative mt-1 p-1.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] overflow-hidden space-y-1">
            <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 px-0.5">
              <span>{executionStep || 'Processing'}</span>
              <span className="text-primary font-bold">{Math.round(executionProgress || 0)}%</span>
            </div>
            <div className="w-full bg-[hsl(var(--surface-2))] h-1 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${executionProgress || 0}%` }}
                className="bg-primary h-full rounded-full"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
