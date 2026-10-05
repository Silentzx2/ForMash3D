import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import type { GenerationSettings, PhysicsSettings } from '../types';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { getModelDefinition, isMeshGenerationModel } from '@/constants/models';
import { MultiViewWorkspace } from './MultiViewWorkspace';
import { useRouter } from 'next/navigation';

import { HugeiconsIcon } from '@hugeicons/react';
import { Box, Cancel, CheckIcon, ChevronDown, ChevronUp, ImageIcon, InfoIcon, LoaderCircle, Plus, RefreshCw, Settings2, SparklesIcon, TriangleAlertIcon, UploadIcon, ZapIcon } from '@hugeicons/core-free-icons';

function dataURLtoFile(dataURL: string, filename: string): File {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

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
  capabilities?: Record<string, any>;
}

function formatGenerateModel(
  id: string,
  isAvailable = true,
  detail?: { status?: string; vram_requirement?: number; capabilities?: Record<string, any> }
): DiscoveredModel {
  const def = getModelDefinition(id);
  const isTextured = def?.supportsTexture ?? id.includes('textured');
  const vram = detail?.vram_requirement ?? def?.vramMb ?? 11776;
  const isTrellis = id.includes('trellis');
  const isHunyuan = id.includes('hunyuan');
  const supportsFlashVDM = def?.supportsFlashVDM ?? id.includes('dit_v2_mini_turbo');

  let cleanLabel = def?.name || id;
  if (id === 'trellis_image_to_textured_mesh') cleanLabel = 'TRELLIS (PBR Textured Mesh)';
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
    status: detail?.status || (isAvailable ? 'ready' : 'uninstalled'),
    vram_required_mb: vram,
    low_vram_supported: def?.lowVramSupported ?? (isTrellis || isHunyuan),
    low_vram_required_mb: def?.lowVramMb ?? ((isTrellis || isHunyuan) ? 6144 : undefined),
    supports_texture: detail?.capabilities?.texture_generation ?? isTextured,
    supports: { texture_generation: detail?.capabilities?.texture_generation ?? isTextured },
    shape_vram_mb: Math.round(vram * 0.6),
    texture_vram_mb: vram,
    supports_flashvdm: supportsFlashVDM,
    capabilities: detail?.capabilities || {},
  };
}

export const GeneratePanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    generate3DModel,
    generationSettings,
    setGenerationSettings,
    navigateToTool,
  } = useWorkspace();
  
  const {
    batchGenerationEnabled,
    setBatchGenerationEnabled,
    addToBatchQueue,
    removeFromBatchQueue,
    clearBatchQueue,
    updateBatchItem,
    setBatchQueue,
  } = useAppStore();
  
  const router = useRouter();

  const currentMode = 'image-to-3d';
  const [modelRegistry, setModelRegistry] = useState<Record<string, string[]> | null>(null);
  const [weightsStatus, setWeightsStatus] = useState<Record<string, boolean>>({});
  const [modelDetails, setModelDetails] = useState<Record<string, any>>({});
  const [optionsLoading, setOptionsLoading] = useState(false);
  const pendingGenerateRef = useRef(false);
  const ownedBlobUrlsRef = useRef<Set<string>>(new Set());
  const [smartPresets, setSmartPresets] = useState<Record<string, any>>({});
  const [smartResolution, setSmartResolution] = useState<any | null>(null);
  const [enhancementLoading, setEnhancementLoading] = useState(false);
  const [enhancementError, setEnhancementError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingGenerateRef.current) return;
    pendingGenerateRef.current = false;
    void generate3DModel();
  }, [generationSettings, generate3DModel]);

  useEffect(() => {
    let active = true;
    getApiClient().getSmartPresets().then(data => {
      if (active && data?.intents) setSmartPresets(data.intents);
    }).catch(err => {
      console.warn('Failed to load smart-generation presets:', err);
    });
    return () => { active = false; };
  }, []);

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
        if ((data as any)?.model_details) {
          setModelDetails((data as any).model_details);
        }
      }
    }).catch(err => {
      console.warn('Failed to load available models:', err);
    }).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => { active = false; };
  }, []);


  // Keep the user's model selection. Only repair an invalid selection after
  // the available-model list changes; never rank or silently replace models.

  // Memoize modelDetails to prevent infinite re-renders (HIGH-003)
  const memoizedModelDetails = useMemo(() => {
    if (!modelRegistry) return {};
    const details: Record<string, any> = {};
    for (const [feature, ids] of Object.entries(modelRegistry)) {
      for (const id of ids) {
        if (modelDetails[id]) {
          details[id] = modelDetails[id];
        }
      }
    }
    return details;
  }, [modelRegistry, modelDetails]);

  const relevantModelIds = useMemo(() => {
    let ids: string[] = [];
    
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
      'trellis2_image_to_textured_mesh',
      'partpacker_image_to_raw_mesh',
      'ultrashape_image_to_raw_mesh',
    ];
    ids = combined.length > 0 ? combined : defaults;

    // Prioritize ready / installed models at the top, while keeping all supported models
    // visible in the selector so users can see available engines and their readiness status.
    const readyIds = ids.filter(id => memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true);
    const otherIds = ids.filter(id => !readyIds.includes(id));
    return [...readyIds, ...otherIds];
  }, [modelRegistry, weightsStatus, memoizedModelDetails]);
  const [subAction, setSubAction] = useState<'upload' | 'crop'>('upload');
  const [activeMvSlot, setActiveMvSlot] = useState<'front' | 'back' | 'left' | 'right'>('front');
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const getStatusInfo = () => {
    const selected = providersList.find(m => m.id === generationSettings.aiModel);
    if (!selected) {
      if (providersList.length === 0) return { label: 'No models installed', tone: 'warn' as const };
      return null;
    }
    // Check both weightsStatus and modelDetails for readiness (MED-001)
    const details = memoizedModelDetails[selected.id];
    const isReady = weightsStatus[selected.id] === true || details?.status === 'ready';
    if (isReady) return null; // ready → no pill
    if (details?.status === 'weights_missing') return { label: 'Weights missing (download via manager)', tone: 'warn' as const };
    if (details?.status === 'gpu_unavailable') return { label: 'GPU unavailable (requires CUDA)', tone: 'warn' as const };
    if (!selected.installed) return { label: 'Model weights missing', tone: 'warn' as const };
    if (selected.status) return { label: selected.status, tone: 'warn' as const };
    return { label: 'Not ready', tone: 'warn' as const };
  };
  const [uploadError, setUploadError] = useState<string | null>(null);

  const meshCapableModels = useMemo(() => {
    return relevantModelIds.map(id => {
      const isReady = memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true;
      return formatGenerateModel(id, isReady, memoizedModelDetails[id]);
    });
  }, [relevantModelIds, weightsStatus, memoizedModelDetails]);

  const providersList = meshCapableModels;
  const statusInfo = getStatusInfo();

  // Auto-correct selected model: if current selection is invalid, prefer the first ready model, or first available model
  useEffect(() => {
    if (providersList.length === 0 || generationSettings.intent) return;
    const isCurrentModelValid = providersList.some(m => m.id === generationSettings.aiModel);
    if (!isCurrentModelValid) {
      const firstReady = providersList.find(m => m.available || m.installed);
      setGenerationSettings(prev => ({
        ...prev,
        aiModel: firstReady ? firstReady.id : providersList[0].id,
      }));
    }
  }, [providersList, generationSettings.aiModel, setGenerationSettings]);

  // Status pill logic — shows what's wrong with the selected model
  const { progress: uploadProgress, startUpload, updateProgress, finishUpload, failUpload } = useUploadProgress();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeModelId = generationSettings.aiModel || providersList[0]?.id || '';
  const activeModelObj = providersList.find(m => m.id === activeModelId) || providersList[0];
  const isFlashVDMModel = activeModelObj?.id?.includes('dit_v2_mini_turbo') || false;
  const isModelMultiviewCapable = Boolean(activeModelObj?.capabilities?.multiview);
  
  const supportsTextureGeneration = activeModelObj?.supports_texture ?? false;
  const showTextureToggle = supportsTextureGeneration;

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

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

  const ownBlobUrl = useCallback((url: string) => {
    ownedBlobUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeOwnedBlobUrl = useCallback((url?: string | null) => {
    if (!url || !ownedBlobUrlsRef.current.has(url)) return;
    URL.revokeObjectURL(url);
    ownedBlobUrlsRef.current.delete(url);
  }, []);

  useEffect(() => () => {
    for (const url of ownedBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    ownedBlobUrlsRef.current.clear();
  }, []);
  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-png', 'image/jpg'];
  const ACCEPTED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'];

  const isAcceptedImage = (file: File) => {
    if (file.type && ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      return true;
    }
    const name = (file.name || '').toLowerCase();
    return ACCEPTED_IMAGE_EXTS.some(ext => name.endsWith(ext));
  };

  const processImageFile = async (file: File) => {
    setUploadError(null);

    if (!isAcceptedImage(file)) {
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
      const previewUrl = ownBlobUrl(URL.createObjectURL(file));
      const cleanPrompt = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setGenerationSettings(prev => ({
        ...prev,
        image: previewUrl,
        imageFileId: res.file_id,
        preprocessingArtifactId: null,
        preprocessingPreviewUrl: null,
        preprocessingMetadata: null,
        enhancementEnabled: false,
        prompt: cleanPrompt,
        imageName: cleanPrompt,
      }));
    } catch (err) {
      failUpload();
      setUploadError('Failed to upload image.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Process each file
    const validFiles = Array.from(files).filter(isAcceptedImage);
    if (validFiles.length === 0) {
      setUploadError('No valid image files selected. Use JPG, PNG, or WEBP.');
      return;
    }
    
    if (validFiles.some(file => file.size > MAX_IMAGE_SIZE)) {
      setUploadError('One or more files are too large. Maximum size is 20MB per file.');
      return;
    }
    
    // Upload all valid files and collect their file IDs
    const uploadPromises = validFiles.map(file => 
      new Promise<{file: File, fileId: string | null, previewUrl: string | null}>(async (resolve) => {
        try {
          startUpload(file.name, file.size);
          const formData = new FormData();
          formData.append('file', file);
          const res = await getApiClient().post<{ file_id: string }>(
            '/api/v1/file-upload/image',
            formData,
            { 
              headers: { 'Content-Type': 'multipart/form-data' }, 
              onUploadProgress: (progressEvent) => updateProgress(Math.round((progressEvent.loaded / (progressEvent.total || 1)) * 100)) 
            }
          );
          finishUpload();
          const previewUrl = ownBlobUrl(URL.createObjectURL(file));
          resolve({ 
            file, 
            fileId: res.file_id || null, 
            previewUrl: previewUrl || null 
          });
        } catch (err) {
          failUpload();
          resolve({ 
            file, 
            fileId: null, 
            previewUrl: null 
          });
        }
      })
    );
    
    // Wait for all uploads to complete
    Promise.all(uploadPromises).then(results => {
      const successfulUploads = results.filter(r => r.fileId !== null);
      const failedUploads = results.filter(r => r.fileId === null);
      
      if (successfulUploads.length > 0) {
        // Add successfully uploaded images to batch queue
        const imageFileIds = successfulUploads.map(r => r.fileId!);
        addToBatchQueue(imageFileIds);
        
        // Show success message
        setNoticeMessage(`${successfulUploads.length} image${successfulUploads.length === 1 ? '' : 's'} added to batch queue.`);
        setTimeout(() => setNoticeMessage(null), 5000);
      }
      
      if (failedUploads.length > 0) {
        setUploadError(`${failedUploads.length} image${failedUploads.length === 1 ? '' : 's'} failed to upload.`);
      }
      
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  };

  const processImageFileForSlot = async (file: File, slot: 'front' | 'back' | 'left' | 'right') => {
    setUploadError(null);
    if (!isAcceptedImage(file)) {
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
        preprocessingArtifactId: slot === 'front' || !prev.image ? null : prev.preprocessingArtifactId,
        preprocessingPreviewUrl: slot === 'front' || !prev.image ? null : prev.preprocessingPreviewUrl,
        preprocessingMetadata: slot === 'front' || !prev.image ? null : prev.preprocessingMetadata,
        enhancementEnabled: slot === 'front' || !prev.image ? false : prev.enhancementEnabled,
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

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    
    // Process each file
    const validFiles = Array.from(files).filter(isAcceptedImage);
    if (validFiles.length === 0) {
      setUploadError('No valid image files dropped. Use JPG, PNG, or WEBP.');
      return;
    }
    
    if (validFiles.some(file => file.size > MAX_IMAGE_SIZE)) {
      setUploadError('One or more files are too large. Maximum size is 20MB per file.');
      return;
    }
    
    // Upload all valid files and collect their file IDs
    const uploadPromises = validFiles.map(file => 
      new Promise<{file: File, fileId: string | null, previewUrl: string | null}>(async (resolve) => {
        try {
          startUpload(file.name, file.size);
          const formData = new FormData();
          formData.append('file', file);
          const res = await getApiClient().post<{ file_id: string }>(
            '/api/v1/file-upload/image',
            formData,
            { 
              headers: { 'Content-Type': 'multipart/form-data' }, 
              onUploadProgress: (progressEvent) => updateProgress(Math.round((progressEvent.loaded / (progressEvent.total || 1)) * 100)) 
            }
          );
          finishUpload();
          const previewUrl = ownBlobUrl(URL.createObjectURL(file));
          resolve({ 
            file, 
            fileId: res.file_id || null, 
            previewUrl: previewUrl || null 
          });
        } catch (err) {
          failUpload();
          resolve({ 
            file, 
            fileId: null, 
            previewUrl: null 
          });
        }
      })
    );
    
    // Wait for all uploads to complete
    Promise.all(uploadPromises).then(results => {
      const successfulUploads = results.filter(r => r.fileId !== null);
      const failedUploads = results.filter(r => r.fileId === null);
      
      if (successfulUploads.length > 0) {
        // Add successfully uploaded images to batch queue
        const imageFileIds = successfulUploads.map(r => r.fileId!);
        addToBatchQueue(imageFileIds);
        
        // Show success message
        setNoticeMessage(`${successfulUploads.length} image${successfulUploads.length === 1 ? '' : 's'} added to batch queue.`);
        setTimeout(() => setNoticeMessage(null), 5000);
      }
      
      if (failedUploads.length > 0) {
        setUploadError(`${failedUploads.length} image${failedUploads.length === 1 ? '' : 's'} failed to upload.`);
      }
    });
  };

  const handlePanelDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (isAcceptedImage(file)) {
        e.preventDefault();
        e.stopPropagation();
        setSubAction('upload');
        processImageFile(file);
      }
    }
  };

  const handleImageTo3DTabClick = () => {
    setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
    navigateToTool('model');
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
      url: '/samples/mech-sentinel.svg',
    },
    {
      id: 'cyber-drone',
      name: 'Cyber Drone',
      url: '/samples/cyber-drone.svg',
    },
    {
      id: 'sci-fi-helmet',
      name: 'Sci-Fi Helmet',
      url: '/samples/sci-fi-helmet.svg',
    },
    {
      id: 'obsidian-blade',
      name: 'Obsidian Blade',
      url: '/samples/obsidian-blade.svg',
    },
  ];

  const applyIntentPreset = async (intent: string) => {
    const preset = smartPresets[intent];
    if (!preset) return;

    let chosenModel = '';
    let resolved: { model_id?: string } | null = null;
    try {
      resolved = await getApiClient().resolveSmartIntent(intent);
      chosenModel = resolved!.model_id || '';
    } catch (error) {
      setEnhancementError(error instanceof Error ? error.message : 'No ready model satisfies this intent');
      return;
    }

    const textureResolution = Number(preset.texture_resolution || 0);
    const textureQuality: GenerationSettings['textureQuality'] =
      textureResolution <= 512 ? 'low'
        : textureResolution <= 1024 ? 'medium'
          : textureResolution <= 2048 ? 'high'
            : '8k';

    setSmartResolution(resolved!);
    const canAutoGenerate = Boolean(generationSettings.imageFileId)
      && (!generationSettings.enhancementEnabled || Boolean(generationSettings.preprocessingArtifactId))
      && !batchGenerationEnabled;
    if (canAutoGenerate) pendingGenerateRef.current = true;

    setGenerationSettings(prev => ({
      ...prev,
      intent: intent as GenerationSettings['intent'],
      aiModel: chosenModel,
      textureQuality,
      generateTexture: textureResolution > 0,
      generateLOD: Boolean(preset.generate_lod),
      lodPreset: preset.lod_preset || prev.lodPreset,
      lodCount: Number(preset.lod_count || 0),
      generateCollision: Boolean(preset.collision),
      enablePrintabilityCheck: Boolean(preset.enable_printability_check),
      enableAutoRepair: Boolean(preset.enable_auto_repair),
      enableAutoRig: Boolean(preset.enable_auto_rig),
      autoOptimizeSettings: {
        ...prev.autoOptimizeSettings,
        targetPolycount: Number(preset.target_polycount || 0),
      },
    }));
    setEnhancementError(null);
  };

  const previewEnhancement = async () => {
    if (!generationSettings.imageFileId) {
      setEnhancementError('Upload the source image first. Preview enhancement requires an uploaded file.');
      return;
    }
    setEnhancementLoading(true);
    setEnhancementError(null);
    try {
      const result = await getApiClient().previewImageEnhancement({
        image_file_id: generationSettings.imageFileId,
        remove_background: true,
        auto_crop: true,
        upscale: true,
        sharpen: false,
      });
      setGenerationSettings(prev => ({
        ...prev,
        enhancementEnabled: true,
        preprocessingArtifactId: result.artifact_id,
        preprocessingPreviewUrl: result.preview_url,
        preprocessingMetadata: result.metadata || null,
      }));
      if (result.warning) setEnhancementError(String(result.warning));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image enhancement failed';
      setEnhancementError(message);
      setGenerationSettings(prev => ({
        ...prev,
        enhancementEnabled: false,
        preprocessingArtifactId: null,
        preprocessingPreviewUrl: null,
        preprocessingMetadata: null,
      }));
    } finally {
      setEnhancementLoading(false);
    }
  };

  const disableEnhancement = () => {
    setGenerationSettings(prev => ({
      ...prev,
      enhancementEnabled: false,
      preprocessingArtifactId: null,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
    }));
    setEnhancementError(null);
  };

   const handleGenerate = () => {
    const hasImage = Boolean(
      generationSettings.image ||
      generationSettings.multiviewImages?.front ||
      (generationSettings.multiviewImages && Object.values(generationSettings.multiviewImages).some(Boolean))
    );
    if (!hasImage) {
      setNoticeMessage('Please upload a reference image first.');
      setTimeout(() => setNoticeMessage(null), 4000);
      return;
    }
    if (generationSettings.enhancementEnabled && !generationSettings.preprocessingArtifactId) {
      setNoticeMessage('Approve the Generation Preview or disable enhancement before generating.');
      setTimeout(() => setNoticeMessage(null), 5000);
      return;
    }
    if (subAction === 'crop') {
      if (!isModelMultiviewCapable) {
        setNoticeMessage(`The selected model "${activeModelObj?.label || activeModelId}" does not support multi-view reconstruction. Please choose a multi-view enabled 3D engine or use Single Image mode.`);
        setTimeout(() => setNoticeMessage(null), 5000);
        return;
      }
      const hasMvViews = (generationSettings.multiviewViews && generationSettings.multiviewViews.length > 0) ||
        Boolean(generationSettings.multiviewAssetId);
      if (!hasMvViews) {
        setNoticeMessage('Please generate or upload multi-view images before running 3D reconstruction.');
        setTimeout(() => setNoticeMessage(null), 5000);
        return;
      }
    }
    
    // If batch generation is enabled, add current image to batch queue instead of generating immediately
    if (batchGenerationEnabled) {
      // Upload current image if not already uploaded
      if (generationSettings.image && !generationSettings.imageFileId) {
        // Convert base64 image to file and upload
        const imageBlob = dataURLtoFile(generationSettings.image, 'image.jpg');
        const formData = new FormData();
        formData.append('file', imageBlob);
        
        getApiClient().post<{ file_id: string }>(
          '/api/v1/file-upload/image',
          formData,
          { 
            headers: { 'Content-Type': 'multipart/form-data' } 
          }
        ).then(res => {
          const imageFileId = res.file_id;
          if (imageFileId) {
            // Add to batch queue
            addToBatchQueue([imageFileId]);
            setNoticeMessage('Image added to batch queue.');
            setTimeout(() => setNoticeMessage(null), 5000);
          }
        }).catch(err => {
          setNoticeMessage('Failed to upload image for batch.');
          setTimeout(() => setNoticeMessage(null), 5000);
        });
      } else if (generationSettings.imageFileId) {
        // Image already uploaded, add to batch queue
        addToBatchQueue([generationSettings.imageFileId]);
        setNoticeMessage('Image added to batch queue.');
        setTimeout(() => setNoticeMessage(null), 5000);
      }
    } else {
      // Standard single image generation
      // Commit the request settings first; the effect above submits only after React
      // has installed this exact snapshot, avoiding stale-state generation requests.
      pendingGenerateRef.current = true;
      setGenerationSettings(prev => ({
        ...prev,
        generateTexture: prev.generateTexture !== false,
        removeBackground: true,
        autoOptimizeSettings: {
          ...prev.autoOptimizeSettings,
          targetPolycount: prev.autoOptimizeSettings?.targetPolycount !== undefined
            ? prev.autoOptimizeSettings.targetPolycount
            : 50000,
        },
      }));
    }
  };
  const applyWorkflowRecipe = (recipe: 'mobile' | 'game' | 'cinematic' | 'native') => {
    const presets = {
      mobile: { meshQuality: 'medium' as const, targetPolycount: 15000, generateLOD: true, lodPreset: 'mobile', lodCount: 4, generateCollision: true },
      game: { meshQuality: 'high' as const, targetPolycount: 35000, generateLOD: true, lodPreset: 'high', lodCount: 4, generateCollision: true },
      cinematic: { meshQuality: 'ultra' as const, targetPolycount: 100000, generateLOD: true, lodPreset: 'high', lodCount: 4, generateCollision: true },
      native: { meshQuality: 'ultra' as const, targetPolycount: 0, generateLOD: false, lodPreset: 'high', lodCount: 4, generateCollision: true },
    }[recipe];
    setGenerationSettings(prev => ({
      ...prev,
      intent: undefined,
      aiModel: '',
      meshQuality: presets.meshQuality,
      autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: presets.targetPolycount },
      generateLOD: presets.generateLOD,
      lodPreset: presets.lodPreset as 'mobile' | 'low' | 'medium' | 'high' | 'custom' | undefined,
      lodCount: presets.lodCount,
      generateCollision: presets.generateCollision,
    }));
  };

  return (
    <div 
      id="panel-generate-model" 
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
      className="relative flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-x-hidden overflow-y-hidden"
    >
      {/* Panel Header */}
      <div className="px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-xs text-white flex items-center gap-1.5">
          <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4 text-primary" />
          <span>Generate 3D Model</span>
        </span>
        {statusInfo && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
            <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-3 h-3" />
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
                <HugeiconsIcon icon={InfoIcon} size={16} className="w-4 h-4 flex-shrink-0" />
                <span className="leading-tight font-medium">{noticeMessage}</span>
              </div>
              <button 
                onClick={() => setNoticeMessage(null)}
                className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel} size={16} className="w-3.5 h-3.5" />
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
                    icon: (props: any) => <HugeiconsIcon icon={ImageIcon} size={16} {...props} />,
                    onClick: () => {
                      setSubAction('upload');
                      setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
                      fileInputRef.current?.click();
                    },
                  },
                  {
                    id: 'crop',
                    domId: 'subaction-btn-crop',
                    label: 'Multi-View',
                    tooltip: 'Zero123++ Multi-View generation & manual view collections',
                    icon: (props: any) => <HugeiconsIcon icon={Box} size={16} {...props} />,
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
                        disabled={false}
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

              {/* Mode 1: Single Image UploadIcon */}
              {subAction === 'upload' && (
                <>
                   <input 
                     ref={fileInputRef}
                     type="file" 
                     accept="image/jpeg,image/png,image/webp" 
                     multiple
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
                    transition={{ type: 'spring' as const, stiffness: 400, damping: 25 }}
                    className="relative w-full h-24 rounded-lg border border-dashed border-white/[0.12] cursor-pointer overflow-hidden flex flex-col items-center justify-center p-2 group/dropzone bg-[hsl(var(--surface-1))]/50 hover:bg-[hsl(var(--surface-1))]"
                  >
                    {uploadProgress.active ? (
                      <div className="text-center space-y-1.5 w-full px-2 z-10">
                        <HugeiconsIcon icon={LoaderCircle} size={16} className="w-5 h-5 mx-auto animate-spin text-primary" />
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
                          <HugeiconsIcon icon={RefreshCw} size={16} className="w-3 h-3" />
                          <span>Replace</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center space-y-1.5 z-10">
                        <div className={`w-8 h-8 mx-auto rounded-full bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center transition-all ${
                          isDragOver ? 'text-primary border-primary' : 'text-zinc-400 group-hover/dropzone:text-primary'
                        }`}>
                          <HugeiconsIcon icon={UploadIcon} size={16} className="w-4 h-4" />
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
                            revokeOwnedBlobUrl(generationSettings.image);
                            setGenerationSettings(prev => ({
  ...prev,
  image: null,
  imageFileId: null,
  imageName: undefined,
  preprocessingArtifactId: null,
  preprocessingPreviewUrl: null,
  preprocessingMetadata: null,
  enhancementEnabled: false,
  mode: 'image-to-3d',
}));
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

              {generationSettings.image && (
                <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold text-white">Generation Preview</div>
                      <div className="text-[9px] text-zinc-400">Optional adaptive preprocessing before AI generation</div>
                    </div>
                    <span className={generationSettings.enhancementEnabled ? 'text-[9px] font-bold text-emerald-300' : 'text-[9px] text-zinc-500'}>
                      {generationSettings.enhancementEnabled ? 'Approved' : 'Original'}
                    </span>
                  </div>
                  {generationSettings.preprocessingPreviewUrl && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-black/20">
                        <img src={generationSettings.image} alt="Original reference" className="w-full h-20 object-contain" />
                        <div className="px-1.5 py-1 text-[8px] text-zinc-500">Original</div>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-primary/20 bg-black/20">
                        <img src={generationSettings.preprocessingPreviewUrl} alt="Generation preview" className="w-full h-20 object-contain" />
                        <div className="px-1.5 py-1 text-[8px] text-primary">Generation Preview</div>
                      </div>
                    </div>
                  )}
                  {enhancementError && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[9px] text-amber-300">
                      {enhancementError}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => void previewEnhancement()} disabled={enhancementLoading}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[9px] font-bold text-primary disabled:opacity-50">
                      {enhancementLoading ? 'Preparing Preview…' : generationSettings.preprocessingArtifactId ? 'Regenerate Preview' : 'Create Generation Preview'}
                    </button>
                    {generationSettings.preprocessingArtifactId ? (
                      <button type="button" onClick={() => setGenerationSettings(prev => ({ ...prev, enhancementEnabled: true }))}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[9px] font-bold text-emerald-300">
                        Use Approved
                      </button>
                    ) : (
                      <button type="button" onClick={() => navigateToTool('edit')}
                        className="rounded-lg border border-white/[0.08] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-[9px] font-bold text-zinc-300">
                        Edit Manually
                      </button>
                    )}
                  </div>
                  {generationSettings.preprocessingArtifactId && (
                    <button type="button" onClick={disableEnhancement} className="w-full text-[9px] text-zinc-500 hover:text-white">
                      Disable enhancement and use original input
                    </button>
                  )}
                </div>
              )}

              {/* Mode 2: Multi-View Zero123++ & Manual Collections */}
              {subAction === 'crop' && (
                <MultiViewWorkspace
                  fileInputRef={fileInputRef}
                  activeModelObj={activeModelObj}
                  setNoticeMessage={setNoticeMessage}
                />
              )}
            </div>

            {/* AI 3D Model Engine Selector (Clean Dropdown + Low VRAM & Texture Toggles) */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
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
                <HugeiconsIcon icon={ChevronDown} size={16} className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
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
                            generateTexture: m.supports_texture ? true : false,
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
                            {!(m.available || m.installed) && (
                              <>
                                <span className={isSelected ? 'text-black/60' : 'text-zinc-600'}>•</span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                                  isSelected ? 'bg-black/20 text-black' : 'bg-amber-500/15 text-amber-300'
                                }`}>
                                  {m.status === 'gpu_unavailable' ? 'GPU Req' : 'Weights Missing'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {isSelected && <HugeiconsIcon icon={CheckIcon} size={16} className="w-4 h-4 text-black flex-shrink-0 stroke-[2.5]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Engine Feature Toggles: PBR Texture & Low VRAM */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
                {/* PBR Texture Toggle - shown only when the selected model supports texture generation */}
                {showTextureToggle && (
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
                )}

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
                {activeModelObj?.low_vram_supported && (
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
                )}
              </div>
            </div>


            <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white">Smart Intent</div>
                  <div className="text-[9px] text-zinc-400">Backend-owned deterministic production recipe</div>
                </div>
                <span className="text-[9px] font-mono text-primary">{generationSettings.intent || 'Manual'}</span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {[
                  ['game_ready', 'Game'],
                  ['cinematic', 'Cinematic'],
                  ['animation', 'Animation'],
                  ['3d_print', 'Print'],
                  ['mobile', 'Mobile'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!smartPresets[id]}
                    onClick={() => void applyIntentPreset(id)}
                    className={generationSettings.intent === id
                      ? 'min-h-10 rounded-lg border border-primary bg-primary text-black font-bold text-[8px]'
                      : 'min-h-10 rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] text-zinc-300 hover:border-primary/30 disabled:opacity-40 text-[8px]'}
                  >
                    <span className="block font-black">{label}</span>
                    <span className="block mt-0.5 text-[7px] opacity-70">
                      {Number(smartPresets[id]?.target_polycount) > 0
                        ? Math.round(Number(smartPresets[id].target_polycount) / 1000) + 'K'
                        : id === '3d_print' ? 'QA' : 'Preset'}
                    </span>
                  </button>
                ))}
              </div>
              {generationSettings.intent && smartResolution && (
                <div className="rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-[8px] text-zinc-400 space-y-0.5">
                  <div className="flex justify-between gap-2"><span>Selected model</span><span className="font-mono text-white truncate">{smartResolution.model_id}</span></div>
                  <div className="flex justify-between gap-2"><span>Preset</span><span className="font-mono text-white truncate">{smartPresets[generationSettings.intent]?.label || generationSettings.intent}</span></div>
                  <div className="flex justify-between gap-2"><span>Applied</span><span className="font-mono text-zinc-300">{Math.round(Number(generationSettings.autoOptimizeSettings?.targetPolycount || 0) / 1000)}K · {generationSettings.generateLOD ? String(generationSettings.lodCount || 4) + ' LOD' : 'No LOD'} · {generationSettings.generateCollision ? 'Collision' : 'No collision'}</span></div>
                  <div className="flex justify-between gap-2"><span>Eligibility</span><span className="text-emerald-300">Image → 3D · ready · VRAM-fit</span></div>
                  <div className="flex justify-between gap-2"><span>Safety</span><span className="font-mono text-zinc-300">No preflight clamp · scheduler authoritative</span></div>
                </div>
              )}
              {generationSettings.intent && (
                <button type="button"
                  onClick={() => { setSmartResolution(null); setGenerationSettings(prev => ({ ...prev, intent: undefined, aiModel: '' })); }}
                  className="w-full text-[9px] text-zinc-500 hover:text-white">
                  Clear intent and keep manual settings
                </button>
              )}
            </div>

            {/* Unified Production Target & Polycount Budget */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white">Target & Polycount Budget</div>
                  <div className="text-[9px] text-zinc-400">Presets budget, LOD, and collision together; raw AI details stay intact</div>
                </div>
                <span className="font-mono text-xs font-black text-primary">
                  {(generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000) <= 0
                    ? 'Native / Raw'
                    : `${(generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000).toLocaleString()} tris`}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {[
                  ['mobile', 'Mobile', '15K · LOD'],
                  ['game', 'Game Ready', '35K · LOD · FX'],
                  ['cinematic', 'Cinematic', '100K · Ultra'],
                  ['native', 'Native', 'Raw geometry'],
                ].map(([id, label, detail]) => {
                  const targetP = generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000;
                  const isMatch = (
                    (id === 'mobile' && targetP === 15000) ||
                    (id === 'game' && targetP === 35000) ||
                    (id === 'cinematic' && targetP === 100000) ||
                    (id === 'native' && targetP <= 0)
                  );
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyWorkflowRecipe(id as 'mobile' | 'game' | 'cinematic' | 'native')}
                      className={"min-h-11 rounded-lg border text-left px-2 py-1.5 transition-all " + (
                        isMatch
                          ? 'bg-primary text-black border-primary font-bold shadow-sm'
                          : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-300 hover:border-primary/30 hover:text-white'
                      )}
                    >
                      <span className="block text-[9px] font-black leading-tight">{label}</span>
                      <span className={"block text-[7px] mt-0.5 " + (isMatch ? 'text-black/75' : 'text-zinc-500')}>{detail}</span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[9px] text-zinc-400">
                  <span>Fine-tune triangle budget</span>
                  <span>5K - 200K</span>
                </div>
                <input
                  aria-label="Production polycount"
                  type="range"
                  min={5000}
                  max={200000}
                  step={5000}
                  value={(generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000) > 0 ? generationSettings.autoOptimizeSettings!.targetPolycount : 50000}
                  onChange={(e) => setGenerationSettings(prev => ({ ...prev, autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: Number(e.target.value) } }))}
                  className="w-full h-1.5 rounded-full appearance-none bg-[hsl(var(--surface-2))] accent-primary cursor-pointer"
                />
              </div>
            </div>
            {/* Advanced generation controls are opt-in so the main workflow stays compact. */}
            <button
              type="button"
              onClick={() => setAdvancedSettingsOpen(true)}
              className="w-full rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 text-left hover:border-primary/40 hover:bg-[hsl(var(--surface-2))] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                    <HugeiconsIcon icon={Settings2} size={16} className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-white">Advanced Generation</div>
                    <div className="text-[9px] text-zinc-400 truncate">
                      {Math.round((generationSettings.autoOptimizeSettings?.targetPolycount || 50000) / 1000)}K tris · {(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'quads' : 'triangles'} · {generationSettings.generateCollision ? 'physics on' : 'physics off'}
                    </div>
                  </div>
                </div>
                <HugeiconsIcon icon={ChevronDown} size={16} className="w-4 h-4 text-zinc-400 shrink-0" />
              </div>
            </button>
          </div>
        </div>

      <AnimatePresence>
        {advancedSettingsOpen && (
          <motion.div
            className="absolute inset-0 z-40 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              className="absolute inset-y-0 right-0 w-full max-w-[380px] bg-[hsl(var(--surface-1))] border-l border-white/[0.1] shadow-2xl flex flex-col pointer-events-auto"
            >
              <div className="px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <HugeiconsIcon icon={Settings2} size={16} className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">Advanced Generation</div>
                    <div className="text-[9px] text-zinc-500 truncate">Physics, quality budget and topology</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdvancedSettingsOpen(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  aria-label="Close advanced generation settings"
                >
                  <HugeiconsIcon icon={ChevronUp} size={16} className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5 space-y-2.5 scrollbar-none">
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div>
                <div className="text-[11px] font-bold text-white">Production QA</div>
                <div className="text-[9px] text-zinc-500">Uses the shared post-processing path; no duplicate pipeline.</div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button"
                  onClick={() => setGenerationSettings(prev => ({
                    ...prev,
                    enablePrintabilityCheck: !Boolean(prev.enablePrintabilityCheck),
                    enableAutoRepair: !Boolean(prev.enablePrintabilityCheck) ? prev.enableAutoRepair : false,
                  }))}
                  className={generationSettings.enablePrintabilityCheck ? 'rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-left text-primary' : 'rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400'}>
                  <span className="block text-[10px] font-bold">Printability</span>
                  <span className="block text-[8px]">{generationSettings.enablePrintabilityCheck ? 'Checking topology' : 'Off'}</span>
                </button>
                <button type="button" disabled={!generationSettings.enablePrintabilityCheck}
                  onClick={() => setGenerationSettings(prev => ({ ...prev, enableAutoRepair: !Boolean(prev.enableAutoRepair) }))}
                  className={generationSettings.enableAutoRepair ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-left text-emerald-300' : 'rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400'}>
                  <span className="block text-[10px] font-bold">Auto-Repair</span>
                  <span className="block text-[8px]">{generationSettings.enableAutoRepair ? 'Repair + recheck' : 'No mutation'}</span>
                </button>
              </div>
              <button type="button"
                onClick={() => setGenerationSettings(prev => ({ ...prev, enableAutoRig: !Boolean(prev.enableAutoRig) }))}
                className={generationSettings.enableAutoRig ? 'w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-left text-violet-200' : 'w-full rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400'}>
                <span className="text-[10px] font-bold">Auto-Rig Game-Ready Mesh</span>
                <span className="block text-[8px] opacity-75">{generationSettings.enableAutoRig ? 'Runs UniRig after production processing' : 'Disabled'}</span>
              </button>
              {generationSettings.enableAutoRig && (
                <select value={generationSettings.autoRigMode || 'full'}
                  onChange={e => setGenerationSettings(prev => ({ ...prev, autoRigMode: e.target.value as GenerationSettings['autoRigMode'] }))}
                  className="w-full rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[9px] text-zinc-200">
                  <option value="full">Full — skeleton + skin</option>
                  <option value="skeleton">Skeleton only</option>
                  <option value="skin">Skinning</option>
                </select>
              )}
            </div>

            {/* Physics Preparation */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={ZapIcon} size={16} className="w-3.5 h-3.5 text-primary" />
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
                  {generationSettings.generateCollision ? 'Physics metadata + selected collision quality will be generated' : 'No Physics metadata; normal collision remains available'}
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

            {/* Streamlined Mesh SettingsIcon Card (TargetIcon Polycount + Triangle / Quad Topology ONLY) */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Mesh SettingsIcon</span>
                </div>
                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Studio Quality
                </span>
              </div>

              {/* 0. Output Quality Preset (source geometry is always max fidelity) */}
              <div className="space-y-1.5 pb-1 border-b border-white/[0.04]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium">Texture / Output Quality</span>
                  <span className="font-mono text-primary font-bold text-xs bg-primary/10 px-2 py-0.5 rounded border border-primary/25 capitalize">
                    {generationSettings.meshQuality || 'high'}
                  </span>
                </div>
                <p className="text-[10px] leading-4 text-zinc-500">
                  Source geometry is always generated at the selected model's maximum fidelity. This control changes texture/output quality only; polycount is applied downstream.
                </p>
                <div className="grid grid-cols-4 gap-1">
                  {(['low', 'medium', 'high', 'ultra'] as const).map((q) => {
                    const isSelected = (generationSettings.meshQuality || 'high') === q;
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setGenerationSettings(prev => ({ ...prev, meshQuality: q }))}
                        className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer capitalize font-bold text-[10px] ${
                          isSelected
                            ? 'bg-primary text-black shadow-sm font-black'
                            : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06]'
                        }`}
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1. Target Polycount Budget */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium">Target Polycount</span>
                  <span className="font-mono text-primary font-bold text-xs bg-primary/10 px-2 py-0.5 rounded border border-primary/25">
                    {generationSettings.autoOptimizeSettings?.targetPolycount === -1 || (generationSettings.autoOptimizeSettings?.targetPolycount || 50000) <= 0
                      ? 'Native (Raw)'
                      : `${((generationSettings.autoOptimizeSettings?.targetPolycount || 50000)).toLocaleString()} tris`}
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: '15K', val: 15000, desc: 'Mobile' },
                    { label: '35K', val: 35000, desc: 'Game' },
                    { label: '50K', val: 50000, desc: 'Studio' },
                    { label: '100K', val: 100000, desc: 'Cinema' },
                    { label: 'Native', val: 0, desc: 'Raw' },
                  ].map((preset) => {
                    const currentTarget = generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000;
                    const isSelected = currentTarget === preset.val;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setGenerationSettings(prev => ({
                            ...prev,
                            autoOptimizeSettings: {
                              ...prev.autoOptimizeSettings,
                              targetPolycount: preset.val,
                            },
                          }));
                        }}
                        className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                          isSelected
                            ? 'bg-primary text-black font-black shadow-sm'
                            : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06]'
                        }`}
                      >
                        <span className="text-[10px] font-black leading-tight">{preset.label}</span>
                        <span className={`text-[7.5px] ${isSelected ? 'text-black/75 font-bold' : 'text-zinc-500'}`}>{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Smooth Slider */}
                <input
                  type="range"
                  min={5000}
                  max={200000}
                  step={5000}
                  value={generationSettings.autoOptimizeSettings?.targetPolycount && generationSettings.autoOptimizeSettings.targetPolycount > 0 ? generationSettings.autoOptimizeSettings.targetPolycount : 50000}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setGenerationSettings(prev => ({
                      ...prev,
                      autoOptimizeSettings: {
                        ...prev.autoOptimizeSettings,
                        targetPolycount: val,
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
                    {activeModelObj?.supports_texture
                      ? 'Triangles (PBR Native)'
                      : (generationSettings.topologyMode === 'quad' || generationSettings.quadTopology)
                      ? 'Quads (post-process)'
                      : 'Triangles'}
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
                    disabled={Boolean(activeModelObj?.supports_texture && generationSettings.generateTexture !== false)}
                    onClick={() => {
                      setGenerationSettings(prev => ({
                        ...prev,
                        topologyMode: 'quad',
                        quadTopology: true,
                      }));
                    }}
                    title={activeModelObj?.supports_texture && generationSettings.generateTexture !== false ? 'Quads only available on untextured raw meshes' : 'Convert to quad-dominant topology in post-processing'}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
                      activeModelObj?.supports_texture && generationSettings.generateTexture !== false
                        ? 'opacity-40 cursor-not-allowed bg-[hsl(var(--surface-1))] text-zinc-500 border border-white/[0.04]'
                        : (generationSettings.topologyMode === 'quad' || generationSettings.quadTopology)
                        ? 'bg-primary text-black font-black shadow-sm cursor-pointer'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer'
                    }`}
                  >
                    <span>■ Quads (raw only)</span>
                  </button>
                </div>
                {/* 3. Real-ESRGAN 4x Super-Resolution enhancement for Hunyuan3D */}
                {(generationSettings.aiModel?.includes('hunyuan') || generationSettings.aiModel?.includes('paint')) && (
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between mt-2">
                    <span className="text-zinc-300 flex items-center gap-1.5 text-xs font-semibold">
                      <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                      <span>Real-ESRGAN (4x Texture Enhance)</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={generationSettings.enableRealESRGAN !== false}
                      onClick={() => setGenerationSettings(prev => ({ ...prev, enableRealESRGAN: prev.enableRealESRGAN === false ? true : false }))}
                      className={`w-7 h-3.5 rounded-full p-0.5 transition-colors relative cursor-pointer ${
                        generationSettings.enableRealESRGAN !== false ? 'bg-primary' : 'bg-[hsl(var(--surface-2))]'
                      }`}
                    >
                      <div
                        className={`w-2.5 h-2.5 rounded-full bg-black transition-transform ${
                          generationSettings.enableRealESRGAN !== false ? 'translate-x-3.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* 4. High-to-Low Micro-Detail Normal Map Baking */}
                <div className="p-2 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-between mt-2">
                  <div className="flex flex-col pr-2">
                    <span className="text-zinc-300 flex items-center gap-1.5 text-xs font-semibold">
                      <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                      <span>Bake Normal Maps (Micro-Details)</span>
                    </span>
                    <span className="text-[8.5px] text-zinc-500 leading-tight">
                      Projects high-poly sculpt creases & micro-surface details onto game-ready mesh
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={generationSettings.bakeNormalMaps !== false}
                    onClick={() => setGenerationSettings(prev => ({ ...prev, bakeNormalMaps: prev.bakeNormalMaps === false ? true : false }))}
                    className={`w-7 h-3.5 rounded-full p-0.5 transition-colors relative cursor-pointer shrink-0 ${
                      generationSettings.bakeNormalMaps !== false ? 'bg-primary' : 'bg-[hsl(var(--surface-2))]'
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full bg-black transition-transform ${
                        generationSettings.bakeNormalMaps !== false ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
              </div>
              </div>
              <div className="p-2.5 border-t border-white/[0.08] shrink-0 bg-[hsl(var(--surface-1))]">
                <button
                  type="button"
                  onClick={() => setAdvancedSettingsOpen(false)}
                  className="w-full h-9 rounded-xl bg-primary text-black text-[10px] font-black tracking-wide hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5" />
                  APPLY & CLOSE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              {Math.round((generationSettings.autoOptimizeSettings?.targetPolycount || 50000) / 1000)}K {(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'QUADS' : 'TRIS'}
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
          disabled={isExecuting || (subAction === 'crop' && !isModelMultiviewCapable)}
          title={subAction === 'crop' && !isModelMultiviewCapable ? 'Selected 3D model does not support multi-view reconstruction' : undefined}
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
              <HugeiconsIcon icon={LoaderCircle} size={16} className="w-3.5 h-3.5 animate-spin text-primary" />
              <span className="tracking-wide">{executionStep || 'Generating 3D Model...'}</span>
            </>
          ) : (
            <>
              <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="tracking-wider">{isExecuting ? 'GENERATE ANOTHER' : 'GENERATE 3D MODEL'}</span>
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
