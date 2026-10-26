import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import type { GenerationSettings, ModelAsset } from '../types';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { requireUploadFileId, resolveUploadedImageName } from '../lib/uploadResponse';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { getModelDefinition, isMeshGenerationModel } from '@/constants/models';
import { SMART_PRESET_FALLBACK } from '@/constants/smartPresets';
import { useSearchParams } from 'next/navigation';
import { getModelFromSearch, getPresetIntentFromSearch, getPromptFromSearch } from '../lib/presetIntent';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  Cancel,
  CheckIcon,
  InfoIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from '@hugeicons/core-free-icons';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';
import { toast } from 'sonner';
import { loadModelInViewer } from '@/stores/useViewerStore';

// Decomposed Modular Sub-components
import { PromptAndImageDropzone, type SamplePreset } from './generate/PromptAndImageDropzone';
import { ModelSelectorBento, type DiscoveredModel } from './generate/ModelSelectorBento';
import { ProductionOptionsSection } from './generate/ProductionOptionsSection';
import { AdvancedGenerationDrawer, PHYSICS_MATERIAL_PRESETS } from './generate/AdvancedGenerationDrawer';
import { GenerateActionFooter } from './generate/GenerateActionFooter';

export { PHYSICS_MATERIAL_PRESETS };

const noticeTimeoutsRef = { current: [] as ReturnType<typeof setTimeout>[] };

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

export function formatValidationDetails(validation: unknown): string | null {
  if (typeof validation === 'string') return validation;
  if (Array.isArray(validation)) return validation.map(String).join(' · ');
  if (!validation || typeof validation !== 'object') return null;

  const details = validation as Record<string, unknown>;
  const messages = [details.message, details.error, details.detail]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  for (const key of ['errors', 'warnings']) {
    const values = details[key];
    if (Array.isArray(values)) messages.push(...values.map(String));
  }
  return messages.length > 0 ? messages.join(' · ') : JSON.stringify(validation);
}

export interface QualityMetrics {
  triangles: number;
  nonManifoldEdges: number;
  holes: number;
  featureEdgeRetention: number | null;
  warnings: string[];
  passedGate: boolean;
  status: 'Sharp' | 'Clean' | 'Needs Review';
}

export function computeQualityMetrics(
  asset?: ModelAsset | null,
  rawResult?: Record<string, any> | null
): QualityMetrics {
  const qaReport = (
    asset?.artifacts?.qaReport ||
    (asset as any)?.qa_report ||
    (asset as any)?.quality_trace?.game_ready?.qa ||
    rawResult?.qa_report ||
    rawResult?.quality_report ||
    rawResult?.artifacts?.qaReport
  ) as Record<string, any> | undefined;

  const afterMetrics = qaReport?.after_postprocess?.metrics || qaReport?.metrics || rawResult?.metrics || {};
  const masterToDeriv = qaReport?.master_to_derivative || rawResult?.master_to_derivative || {};
  const meshDetails = ((asset?.meshDetails || rawResult?.mesh_details) || {}) as Record<string, any>;

  const triangles = Number(
    asset?.triangles ||
    asset?.faces ||
    afterMetrics.triangle_count ||
    afterMetrics.triangles ||
    meshDetails.triangle_count ||
    meshDetails.triangles ||
    rawResult?.triangle_count ||
    0
  );

  const nonManifoldEdges = Number(
    asset?.nonManifoldEdges ??
    afterMetrics.non_manifold_edges ??
    meshDetails.non_manifold_edges ??
    rawResult?.non_manifold_edges ??
    (asset?.isManifold === false ? 1 : 0)
  );

  const holes = Number(
    afterMetrics.hole_count ??
    afterMetrics.holes ??
    meshDetails.hole_count ??
    meshDetails.holes ??
    rawResult?.hole_count ??
    0
  );

  const rawRetention =
    masterToDeriv.feature_edge_retention ??
    afterMetrics.feature_edge_retention ??
    qaReport?.feature_edge_retention ??
    meshDetails.feature_edge_retention ??
    rawResult?.feature_edge_retention;

  const featureEdgeRetention = (rawRetention !== undefined && rawRetention !== null && !isNaN(Number(rawRetention)))
    ? Number(rawRetention)
    : null;

  const warnings: string[] = [];
  if (Array.isArray(asset?.qaWarnings)) warnings.push(...asset!.qaWarnings);
  if (Array.isArray(asset?.degradedReasons)) warnings.push(...asset!.degradedReasons);
  if (Array.isArray(qaReport?.warnings)) warnings.push(...qaReport!.warnings);
  if (Array.isArray(rawResult?.warnings)) warnings.push(...rawResult!.warnings);
  if (Array.isArray(rawResult?.degraded_reasons)) warnings.push(...rawResult!.degraded_reasons);

  const topoGate = qaReport?.topology_gate || rawResult?.topology_gate;
  const qualGate = qaReport?.quality_gate || masterToDeriv.quality_gate || rawResult?.quality_gate;
  const gateFailed = (topoGate && topoGate.passed_clean === false) || (qualGate && qualGate.passed === false);
  const passedGate = !gateFailed && asset?.qaStatus !== 'fail';

  let status: 'Sharp' | 'Clean' | 'Needs Review';
  const backendTier = asset?.qualityTier || rawResult?.quality_tier || qaReport?.quality_tier || (rawResult?.quality_trace as any)?.quality_tier;
  if (backendTier && (String(backendTier).toLowerCase() === 'sharp' || String(backendTier).toLowerCase() === 'clean')) {
    status = String(backendTier).toLowerCase() === 'sharp' ? 'Sharp' : 'Clean';
  } else if (
    asset?.productionStatus === 'degraded' ||
    asset?.qaStatus === 'fail' ||
    asset?.qaStatus === 'warn' ||
    warnings.length > 0 ||
    gateFailed ||
    nonManifoldEdges > 0 ||
    holes > 0
  ) {
    status = 'Needs Review';
  } else if (featureEdgeRetention !== null && featureEdgeRetention >= 0.85) {
    status = 'Sharp';
  } else {
    status = 'Clean';
  }

  return {
    triangles,
    nonManifoldEdges,
    holes,
    featureEdgeRetention,
    warnings,
    passedGate,
    status,
  };
}

export interface QualityBadgeProps {
  asset?: ModelAsset | null;
  rawResult?: Record<string, any> | null;
  metrics?: Partial<QualityMetrics>;
  className?: string;
  size?: 'sm' | 'md';
}

export const QualityBadge: React.FC<QualityBadgeProps> = React.memo(({
  asset,
  rawResult,
  metrics: customMetrics,
  className = '',
  size = 'md',
}) => {
  const computed = useMemo(() => {
    const base = computeQualityMetrics(asset, rawResult);
    return { ...base, ...customMetrics };
  }, [asset, rawResult, customMetrics]);

  const { status, triangles, nonManifoldEdges, holes, featureEdgeRetention, warnings } = computed;

  const badgeConfig = {
    Sharp: {
      label: 'Sharp',
      icon: SparklesIcon,
      style: 'bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30 shadow-[0_0_8px_rgba(245,197,66,0.15)]',
      dotStyle: 'bg-[#F5C542]',
    },
    Clean: {
      label: 'Clean',
      icon: CheckIcon,
      style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.15)]',
      dotStyle: 'bg-emerald-400',
    },
    'Needs Review': {
      label: 'Needs Review',
      icon: TriangleAlertIcon,
      style: 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_8px_rgba(251,191,36,0.15)]',
      dotStyle: 'bg-amber-400',
    },
  }[status];

  const retentionDisplay = featureEdgeRetention !== null
    ? `${(featureEdgeRetention <= 1 ? featureEdgeRetention * 100 : featureEdgeRetention).toFixed(1)}%`
    : '100.0%';

  const tooltipContent = (
    <div className="space-y-1.5 text-left py-1 px-0.5 text-[9.5px]">
      <div className="font-bold border-b border-white/10 pb-1 flex items-center justify-between gap-3">
        <span className="text-white">Mesh Quality Report</span>
        <span className={`px-1.5 py-0.2 rounded text-[8px] font-mono font-bold ${badgeConfig.style}`}>
          {status}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Triangles</span>
          <span className="font-mono text-white font-bold">{triangles.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Non-Manifold Edges</span>
          <span className={`font-mono font-bold ${nonManifoldEdges > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {nonManifoldEdges}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Holes</span>
          <span className={`font-mono font-bold ${holes > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {holes}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Feature Edge Retention</span>
          <span className="font-mono text-[#F5C542] font-bold">{retentionDisplay}</span>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="pt-1 border-t border-white/10 text-[8px] text-amber-300/90 leading-tight">
          ⚠ {warnings[0]}
        </div>
      )}
    </div>
  );

  return (
    <SimpleTooltip label={tooltipContent} side="top">
      <span
        data-testid="quality-badge"
        className={`inline-flex items-center gap-1 font-bold rounded-md border tracking-wider transition-all cursor-help ${
          size === 'sm' ? 'px-1.5 py-0.2 text-[8px]' : 'px-2 py-0.5 text-[9.5px]'
        } ${badgeConfig.style} ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${badgeConfig.dotStyle}`} />
        <HugeiconsIcon icon={badgeConfig.icon} size={size === 'sm' ? 11 : 13} className="stroke-[2.5]" />
        <span>{badgeConfig.label}</span>
      </span>
    </SimpleTooltip>
  );
});

QualityBadge.displayName = 'QualityBadge';

/** Map a backend texture-atlas size to the UI atlas token; null means "no texture stage". */
const textureResolutionPreset = (size: number): '1K' | '2K' | '4K' | '8K' | null => {
  if (size >= 8192) return '8K';
  if (size >= 4096) return '4K';
  if (size >= 2048) return '2K';
  if (size >= 1024) return '1K';
  return null;
};

/** Summarize a backend output preset for the compact preset chip. */
const formatPresetSummary = (preset: Record<string, any> | undefined): string => {
  if (!preset) return 'Raw geometry';
  const target = Number(preset.target_polycount ?? 0);
  const atlas = textureResolutionPreset(Number(preset.texture_resolution ?? 0));
  const parts: string[] = [target > 0 ? `${Math.round(target / 1000)}K` : 'Raw'];
  if (atlas) parts.push(`${atlas} PBR`);
  if (preset.generate_lod) parts.push('LOD');
  if (preset.collision) parts.push('Col');
  if (preset.enable_auto_rig) parts.push('Rig');
  if (preset.enable_printability_check) parts.push('QA');
  if (preset.enable_auto_repair) parts.push('Repair');
  return parts.join(' · ');
};

function formatGenerateModel(
  id: string,
  isAvailable = true,
  detail?: { status?: string; vram_requirement?: number; capabilities?: Record<string, any> }
): DiscoveredModel {
  const def = getModelDefinition(id);
  const isTextured = def?.supportsTexture ?? id.includes('textured');
  const vram = detail?.vram_requirement ?? def?.vramMb ?? 11776;

  let cleanLabel = def?.name || id;
  if (id === 'trellis_image_to_textured_mesh') cleanLabel = 'TRELLIS (PBR Textured Mesh)';
  else if (id === 'triposg_image_to_raw_mesh') cleanLabel = 'TripoSG (Fast Feed-Forward Geometry)';
  else if (id === 'hunyuan3d_shape_v21_image_to_raw_mesh') cleanLabel = 'Hunyuan3D-Shape-v2-1 (Raw Geometry)';
  else if (id === 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh') cleanLabel = 'Hunyuan3D-DiT-v2-mini-Turbo (Low-VRAM Geometry)';
  else if (id === 'trellis2_image_to_raw_mesh' || id === 'trellis2_image_to_textured_mesh') cleanLabel = 'TRELLIS 2 (Next-Gen 4B)';
  else if (id === 'trellis_image_to_raw_mesh') cleanLabel = 'TRELLIS (Raw Geometry)';
  else if (id === 'unique3d_image_to_raw_mesh') cleanLabel = 'Unique3D (High-Fidelity Diffusion)';

  return {
    id,
    label: cleanLabel,
    available: isAvailable,
    installed: isAvailable,
    status: detail?.status || (isAvailable ? 'ready' : 'uninstalled'),
    vram_required_mb: vram,
    supports_texture: detail?.capabilities?.texture_generation ?? isTextured,
    supports: { texture_generation: detail?.capabilities?.texture_generation ?? isTextured },
    shape_vram_mb: Math.round(vram * 0.6),
    texture_vram_mb: vram,
    capabilities: detail?.capabilities || {},
  };
}

const SAMPLE_PRESETS: SamplePreset[] = [
  { id: 'mech-sentinel', name: 'Mech Sentinel', url: '/samples/mech-sentinel.svg' },
  { id: 'cyber-drone', name: 'Cyber Drone', url: '/samples/cyber-drone.svg' },
  { id: 'sci-fi-helmet', name: 'Sci-Fi Helmet', url: '/samples/sci-fi-helmet.svg' },
  { id: 'obsidian-blade', name: 'Obsidian Blade', url: '/samples/obsidian-blade.svg' },
];

export const GeneratePanel: React.FC = React.memo(() => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    generate3DModel,
    queueGenerationJob,
    generationSettings,
    setGenerationSettings,
    navigateToTool,
    currentAsset,
    updateAssetProperties,
  } = useWorkspace();

  const [promotingCandId, setPromotingCandId] = useState<number | null>(null);

  const handlePreviewCandidate = useCallback((cand: { candidate_id: number; model_url?: string; seed: number }) => {
    if (!currentAsset) return;
    const viewUrl = cand.model_url || `/api/v1/system/jobs/${currentAsset.id}/candidates/${cand.candidate_id}/download`;
    loadModelInViewer(viewUrl, `${currentAsset.name} (Var #${cand.candidate_id + 1})`, currentAsset as any);
    toast.info(`Previewing candidate #${cand.candidate_id + 1} (Seed: ${cand.seed}) in viewport`);
  }, [currentAsset]);

  const handleSelectCandidate = useCallback(async (candidateId: number) => {
    if (!currentAsset) return;
    try {
      setPromotingCandId(candidateId);
      const res = await fetch(`/api/v1/system/jobs/${currentAsset.id}/candidates/${candidateId}/select`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`Failed to promote candidate: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.candidates) {
        updateAssetProperties(currentAsset.id, {
          candidates: data.candidates,
        });
      }
      const promotedUrl = `/api/v1/system/jobs/${currentAsset.id}/candidates/${candidateId}/download?v=${Date.now()}`;
      loadModelInViewer(promotedUrl, currentAsset.name, currentAsset as any);
      toast.success(`Promoted candidate #${candidateId + 1} to master!`);
    } catch (err) {
      toast.error('Failed to select candidate', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPromotingCandId(null);
    }
  }, [currentAsset, updateAssetProperties]);

  const {
    batchGenerationEnabled,
    addToBatchQueue,
  } = useAppStore();

  const searchParams = useSearchParams();
  const routeSearch = searchParams.toString();

  const [modelRegistry, setModelRegistry] = useState<Record<string, string[]> | null>(null);
  const [weightsStatus, setWeightsStatus] = useState<Record<string, boolean>>({});
  const [modelDetails, setModelDetails] = useState<Record<string, any>>({});
  const pendingGenerateRef = useRef(false);
  const generationSettingsRef = useRef(generationSettings);
  generationSettingsRef.current = generationSettings;
  const [smartPresets, setSmartPresets] = useState<Record<string, any>>({});
  const [enhancementLoading, setEnhancementLoading] = useState(false);
  const [enhancementError, setEnhancementError] = useState<string | null>(null);

  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

  // Clean up all notice timeouts on unmount
  useEffect(() => {
    return () => {
      noticeTimeoutsRef.current.forEach((id) => clearTimeout(id));
      noticeTimeoutsRef.current = [];
    };
  }, []);

  // Execution submit effect when generationSettings snapshot commits
  useEffect(() => {
    if (!pendingGenerateRef.current) return;
    pendingGenerateRef.current = false;
    void generate3DModel();
  }, [generationSettings, generate3DModel]);

  // Load Smart Presets SSOT
  useEffect(() => {
    let active = true;
    getApiClient().getSmartPresets().then(data => {
      if (active) {
        const intents = data?.intents;
        if (intents && Object.keys(intents).length > 0) {
          setSmartPresets(intents);
        } else {
          setSmartPresets(SMART_PRESET_FALLBACK);
        }
      }
    }).catch(err => {
      console.warn('Failed to load smart-generation presets:', err);
      setSmartPresets(SMART_PRESET_FALLBACK);
    });
    return () => { active = false; };
  }, []);

  // Load Available Models
  useEffect(() => {
    let active = true;
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
    });
    return () => { active = false; };
  }, []);

  const memoizedModelDetails = useMemo(() => {
    if (!modelRegistry) return {};
    const details: Record<string, any> = {};
    for (const [, ids] of Object.entries(modelRegistry)) {
      for (const id of ids) {
        if (modelDetails[id]) {
          details[id] = modelDetails[id];
        }
      }
    }
    return details;
  }, [modelRegistry, modelDetails]);

  const relevantModelIds = useMemo(() => {
    const textured = (modelRegistry?.['image_to_textured_mesh'] || []).filter(isMeshGenerationModel);
    const raw = (modelRegistry?.['image_to_raw_mesh'] || []).filter(isMeshGenerationModel);
    const combined = Array.from(new Set([...textured, ...raw]));
    const defaults = [
      'trellis2_image_to_raw_mesh',
      'trellis_image_to_textured_mesh',
      'triposg_image_to_raw_mesh',
      'hunyuan3d_shape_v21_image_to_raw_mesh',
      'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
      'unique3d_image_to_raw_mesh',
    ];
    const ids = combined.length > 0 ? combined : defaults;
    const readyIds = ids.filter(id => memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true);
    const otherIds = ids.filter(id => !readyIds.includes(id));
    return [...readyIds, ...otherIds];
  }, [modelRegistry, weightsStatus, memoizedModelDetails]);

  const meshCapableModels = useMemo(() => {
    return relevantModelIds.map(id => {
      const isReady = memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true;
      return formatGenerateModel(id, isReady, memoizedModelDetails[id]);
    });
  }, [relevantModelIds, weightsStatus, memoizedModelDetails]);

  const providersList = meshCapableModels;

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'verifying' | 'saved' | 'error'>('idle');
  const [approvalStatus, setApprovalStatus] = useState<'approved' | 'needs_review' | 'failed' | null>(null);
  const [approvalWarning, setApprovalWarning] = useState<string | null>(null);
  const [approvalValidation, setApprovalValidation] = useState<unknown>(null);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const preprocessingApprovalStatus = generationSettings.preprocessingMetadata?.approval_status ?? null;

  const appliedRouteModel = useRef<string | null>(null);
  useEffect(() => {
    const model = getModelFromSearch(routeSearch, providersList.map(provider => provider.id));
    if (!model || appliedRouteModel.current === model) return;
    appliedRouteModel.current = model;
    setGenerationSettings(prev => ({ ...prev, aiModel: model }));
  }, [providersList, routeSearch, setGenerationSettings]);

  // Auto-correct selected model if invalid
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
  }, [providersList, generationSettings.aiModel, generationSettings.intent, setGenerationSettings]);

  const { progress: uploadProgress, startUpload, updateProgress, finishUpload, failUpload } = useUploadProgress();

  const activeModelId = generationSettings.aiModel || providersList[0]?.id || '';
  const activeModelObj = useMemo(
    () => providersList.find(m => m.id === activeModelId) || providersList[0],
    [providersList, activeModelId]
  );
  const isPostprocessOff = generationSettings.enablePostprocess === false;

  const textureAtlasSize: '1K' | '2K' | '4K' | '8K' = useMemo(() => {
    return (
      generationSettings.texture_resolution ||
      generationSettings.textureResolution ||
      (generationSettings.textureQuality === 'low' ? '1K' :
       generationSettings.textureQuality === 'medium' ? '1K' :
       generationSettings.textureQuality === '8k' ? '8K' : '2K')
    );
  }, [
    generationSettings.texture_resolution,
    generationSettings.textureResolution,
    generationSettings.textureQuality,
  ]);

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-png', 'image/jpg'];
  const ACCEPTED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'];

  const isAcceptedImage = (file: File) => {
    if (file.type && ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase())) return true;
    const name = (file.name || '').toLowerCase();
    return ACCEPTED_IMAGE_EXTS.some(ext => name.endsWith(ext));
  };

  const uploadReferenceImage = useCallback(async (file: File) => {
    setUploadError(null);
    setUploadStatus('uploading');
    startUpload(file.name, file.size);
    try {
      const res = await getApiClient().uploadImageFile(file, updateProgress);
      setUploadStatus('verifying');
      const fileId = requireUploadFileId(res?.file_id, 'image');
      finishUpload();
      setUploadStatus('saved');
      return { file, fileId, url: `/api/v1/file-upload/download/${encodeURIComponent(fileId)}`, response: res };
    } catch (error) {
      failUpload();
      setUploadStatus('error');
      setUploadError(error instanceof Error ? error.message : 'Failed to upload image.');
      return null;
    }
  }, [startUpload, updateProgress, finishUpload, failUpload]);

  const processImageFiles = useCallback(async (files: File[]) => {
    setUploadError(null);
    const validFiles = files.filter(isAcceptedImage);
    if (validFiles.length === 0) {
      setUploadError('No valid image files selected. Use JPG, PNG, or WEBP.');
      setUploadStatus('error');
      return;
    }

    if (validFiles.some(file => file.size > MAX_IMAGE_SIZE)) {
      setUploadError('One or more files are too large. Maximum size is 20MB per file.');
      setUploadStatus('error');
      return;
    }

    const uploaded: Array<Exclude<Awaited<ReturnType<typeof uploadReferenceImage>>, null>> = [];
    let failedCount = 0;
    for (const file of validFiles) {
      const result = await uploadReferenceImage(file);
      if (result) uploaded.push(result);
      else failedCount += 1;
    }

    if (uploaded.length > 0) {
      const primary = uploaded[0];
      const cleanPrompt = primary.file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setGenerationSettings(prev => ({
        ...prev,
        image: primary.url,
        imageFileId: primary.fileId,
        preprocessingArtifactId: null,
        preprocessingReviewOverride: false,
        preprocessingPreviewUrl: null,
        preprocessingMetadata: null,
        enhancementEnabled: false,
        prompt: cleanPrompt,
        imageName: resolveUploadedImageName(prev.imageName, cleanPrompt),
        mode: 'image-to-3d',
      }));
      setApprovalStatus(primary.response.approval_status ?? null);
      setApprovalWarning(primary.response.warning || null);
      setApprovalValidation(primary.response.validation ?? null);
      setApprovalAcknowledged(false);
      setUploadStatus('saved');

      const batchable = uploaded.slice(1).filter(item =>
        item.response.approval_status !== 'failed' && item.response.approval_status !== 'needs_review'
      );
      if (batchable.length > 0) {
        addToBatchQueue(batchable.map(item => item.fileId));
      }
      const heldCount = uploaded.length - 1 - batchable.length;
      if (batchable.length > 0 || heldCount > 0) {
        const queuedText = batchable.length > 0
          ? `${batchable.length} additional image${batchable.length === 1 ? '' : 's'} added to batch queue.`
          : '';
        const heldText = heldCount > 0
          ? `${heldCount} additional image${heldCount === 1 ? '' : 's'} held for backend review.`
          : '';
        setNoticeMessage([queuedText, heldText].filter(Boolean).join(' '));
        const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
        noticeTimeoutsRef.current.push(timeoutId);
      }
    }

    if (failedCount > 0) {
      setUploadError(`${failedCount} image${failedCount === 1 ? '' : 's'} failed to upload.`);
    }
    if (uploaded.length === 0) setUploadStatus('error');
  }, [uploadReferenceImage, setGenerationSettings, addToBatchQueue]);

  // Board-to-Generate bridge handling
  useEffect(() => {
    let pendingFile = useAppStore.getState().pendingBoardImage;
    if (!pendingFile && typeof window !== 'undefined') {
      const cachedDataUrl = sessionStorage.getItem('formash_pending_board_image');
      const cachedName = sessionStorage.getItem('formash_pending_board_image_name') || 'board-drawing.png';
      if (cachedDataUrl) {
        sessionStorage.removeItem('formash_pending_board_image');
        sessionStorage.removeItem('formash_pending_board_image_name');
        try {
          const [meta, b64] = String(cachedDataUrl).split(',');
          const mime = /data:(.*?)(;|$)/.exec(meta)?.[1] || 'image/png';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          pendingFile = new File([bytes], cachedName, { type: mime });
        } catch (e) {
          console.error('Failed to parse cached board image', e);
        }
      }
    } else if (pendingFile) {
      useAppStore.getState().setPendingBoardImage(null);
    }

    if (pendingFile) {
      void processImageFiles([pendingFile]);
    }
  }, [processImageFiles]);

  const handleSampleSelection = useCallback(async (preset: SamplePreset) => {
    setSampleLoading(true);
    setUploadError(null);
    try {
      const response = await fetch(preset.url);
      if (!response.ok) throw new Error(`Failed to load sample image (${response.status}).`);

      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare sample image.');
        context.drawImage(image, 0, 0);
        const png = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare sample image.')), 'image/png');
        });
        await processImageFiles([new File([png], `${preset.name}.png`, { type: 'image/png' })]);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to prepare sample image.');
      setUploadStatus('error');
    } finally {
      setSampleLoading(false);
    }
  }, [processImageFiles]);

  const selectOutputPreset = useCallback((presetId: 'mobile' | 'game_ready' | 'cinematic' | 'animation' | '3d_print' | 'native' | 'game_ready_quad' | 'multi_variant') => {
    if (presetId === 'native') {
      setGenerationSettings(prev => ({
        ...prev,
        intent: undefined,
        enablePostprocess: false,
        generateTexture: false,
        texture_enabled: false,
        generateLOD: false,
        generateCollision: false,
        enablePrintabilityCheck: false,
        enableAutoRepair: false,
        enableAutoRig: false,
        autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: 0 },
      }));
      return;
    }

    const presetData = smartPresets[presetId] ?? SMART_PRESET_FALLBACK[presetId] ?? {};
    const texResPreset = textureResolutionPreset(Number(presetData.texture_resolution ?? 0));
    const lodEnabled = presetData.generate_lod !== false;

    setGenerationSettings(prev => ({
      ...prev,
      intent: presetId,
      enablePostprocess: true,
      generateTexture: texResPreset !== null,
      texture_enabled: texResPreset !== null,
      texture_resolution: texResPreset ?? undefined,
      textureResolution: texResPreset ?? undefined,
      textureQuality: texResPreset === '1K' ? 'medium' : 'high',
      generateLOD: lodEnabled,
      lodPreset: (presetData.lod_preset ?? 'high') as GenerationSettings['lodPreset'],
      lodCount: Math.max(2, Math.min(4, Number(presetData.lod_count ?? 4) || 4)),
      generateCollision: presetData.collision === true,
      enablePrintabilityCheck: presetData.enable_printability_check === true,
      enableAutoRepair: presetData.enable_auto_repair === true,
      enableAutoRig: presetData.enable_auto_rig === true,
      autoOptimizeSettings: {
        ...prev.autoOptimizeSettings,
        targetPolycount: Number(presetData.target_polycount ?? 0),
      },
      ...(presetData.quad_topology !== undefined
        ? { topologyMode: presetData.quad_topology ? 'quad' : 'triangle', quadTopology: Boolean(presetData.quad_topology) }
        : {}),
      ...(presetData.part_count_range !== undefined ? { partCountRange: presetData.part_count_range } : {}),
      ...(presetData.rig_type !== undefined ? { rigType: presetData.rig_type } : {}),
      ...(presetData.export_formats !== undefined ? { exportFormats: [...presetData.export_formats] } : {}),
      ...(presetData.slicer_handoff !== undefined ? { slicerHandoff: Boolean(presetData.slicer_handoff) } : {}),
    }));
  }, [setGenerationSettings, smartPresets]);

  const appliedRouteIntent = useRef<string | null>(null);
  useEffect(() => {
    const intent = getPresetIntentFromSearch(routeSearch, SMART_PRESET_FALLBACK);
    if (!intent || appliedRouteIntent.current === intent) return;
    appliedRouteIntent.current = intent;
    selectOutputPreset(intent as any);
  }, [routeSearch, selectOutputPreset]);

  const appliedRoutePrompt = useRef<string | null>(null);
  useEffect(() => {
    const prompt = getPromptFromSearch(routeSearch);
    if (!prompt || appliedRoutePrompt.current === prompt) return;
    appliedRoutePrompt.current = prompt;
    setGenerationSettings(prev => ({ ...prev, prompt, imageName: prompt }));
  }, [routeSearch, setGenerationSettings]);

  const previewEnhancement = useCallback(async () => {
    const currentFileId = generationSettingsRef.current.imageFileId;
    if (!currentFileId) {
      setEnhancementError('Upload the source image first. Preview enhancement requires an uploaded file.');
      return;
    }
    setEnhancementLoading(true);
    setEnhancementError(null);
    try {
      const result = await getApiClient().previewImageEnhancement({
        image_file_id: currentFileId,
        remove_background: true,
        auto_crop: true,
        upscale: true,
        sharpen: false,
      });
      setGenerationSettings(prev => ({
        ...prev,
        enhancementEnabled: false,
        preprocessingArtifactId: result.artifact_id,
        preprocessingReviewOverride: false,
        preprocessingPreviewUrl: result.preview_url,
        preprocessingMetadata: result.metadata || null,
      }));
      if (result.approval_status !== 'approved') {
        setEnhancementError(String(result.warning || 'Review the preprocessing result before using it for generation.'));
      } else if (result.warning) {
        setEnhancementError(String(result.warning));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image enhancement failed';
      setEnhancementError(message);
      setGenerationSettings(prev => ({
        ...prev,
        enhancementEnabled: false,
        preprocessingArtifactId: null,
        preprocessingReviewOverride: false,
        preprocessingPreviewUrl: null,
        preprocessingMetadata: null,
      }));
    } finally {
      setEnhancementLoading(false);
    }
  }, [setGenerationSettings]);

  const disableEnhancement = useCallback(() => {
    setGenerationSettings(prev => ({
      ...prev,
      enhancementEnabled: false,
      preprocessingReviewOverride: false,
      preprocessingArtifactId: null,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
    }));
    setEnhancementError(null);
  }, [setGenerationSettings]);

  const handleClearImage = useCallback(() => {
    setUploadStatus('idle');
    setUploadError(null);
    setApprovalStatus(null);
    setApprovalWarning(null);
    setApprovalValidation(null);
    setApprovalAcknowledged(false);
    setGenerationSettings(prev => ({
      ...prev,
      image: null,
      imageFileId: null,
      imageName: undefined,
      preprocessingArtifactId: null,
      preprocessingReviewOverride: false,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
      enhancementEnabled: false,
      mode: 'image-to-3d',
    }));
  }, [setGenerationSettings]);

  const handleSelectModel = useCallback((modelId: string) => {
    setUploadStatus('idle');
    setUploadError(null);
    setApprovalStatus(null);
    setApprovalWarning(null);
    setApprovalValidation(null);
    setApprovalAcknowledged(false);
    setGenerationSettings(prev => ({
      ...prev,
      aiModel: modelId,
    }));
  }, [setGenerationSettings]);

  const handleToggleLowVram = useCallback(() => {
    setGenerationSettings(prev => ({
      ...prev,
      low_vram: !(prev.low_vram ?? prev.lowVram ?? true),
      lowVram: !(prev.low_vram ?? prev.lowVram ?? true),
    }));
  }, [setGenerationSettings]);

  const handleToggleGenerateTexture = useCallback(() => {
    if (isPostprocessOff) return;
    setGenerationSettings(prev => {
      const nextVal = prev.generateTexture === false;
      return {
        ...prev,
        generateTexture: nextVal,
        texture_enabled: nextVal,
        texture_resolution: prev.texture_resolution || prev.textureResolution || '2K',
      };
    });
  }, [isPostprocessOff, setGenerationSettings]);

  const handleChangeTextureAtlasSize = useCallback((size: '1K' | '2K' | '4K' | '8K') => {
    setGenerationSettings(prev => ({
      ...prev,
      texture_resolution: size,
      textureResolution: size,
      textureQuality: size === '1K' ? 'low' : size === '2K' ? 'high' : size === '4K' ? 'high' : '8k',
    }));
  }, [setGenerationSettings]);

  const handleTogglePostprocess = useCallback(() => {
    setGenerationSettings(prev => {
      const enabling = prev.enablePostprocess === false;
      const target = prev.autoOptimizeSettings?.targetPolycount ?? 0;
      return {
        ...prev,
        enablePostprocess: enabling,
        ...(enabling && target <= 0 ? {
          intent: undefined,
          autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: 50000 },
        } : {}),
      };
    });
  }, [setGenerationSettings]);

  const handleChangeTargetPolycount = useCallback((count: number) => {
    setGenerationSettings(prev => ({
      ...prev,
      intent: undefined,
      autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: count },
    }));
  }, [setGenerationSettings]);

  const handleChangePartCountRange = useCallback((range: '1' | '3-6' | '6-15' | '15+') => {
    setGenerationSettings(prev => ({
      ...prev,
      partCountRange: range,
    }));
  }, [setGenerationSettings]);

  const handleToggleAutoRig = useCallback(() => {
    setGenerationSettings(prev => ({
      ...prev,
      enableAutoRig: !Boolean(prev.enableAutoRig),
    }));
  }, [setGenerationSettings]);

  const handleChangeAutoRigMode = useCallback((mode: 'full' | 'skeleton' | 'skin') => {
    setGenerationSettings(prev => ({
      ...prev,
      autoRigMode: mode,
    }));
  }, [setGenerationSettings]);

  const handleGenerate = useCallback(async () => {
    const settings = generationSettingsRef.current;
    const hasImage = Boolean(settings.image);
    if (!hasImage) {
      setNoticeMessage('Please upload a reference image first.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 4000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (approvalStatus === 'failed') {
      setNoticeMessage(approvalWarning || 'Backend validation failed. Choose another image before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (approvalStatus === 'needs_review' && !approvalAcknowledged) {
      setNoticeMessage('Review the backend upload warning and confirm it before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (settings.preprocessingArtifactId && !settings.enhancementEnabled) {
      setNoticeMessage('Choose the validated preview, confirm its review warning, or disable enhancement to use the original image.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (settings.enhancementEnabled && preprocessingApprovalStatus === 'failed') {
      setNoticeMessage('Preprocessing failed. Disable enhancement to use the original image.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (
      settings.enhancementEnabled &&
      preprocessingApprovalStatus === 'needs_review' &&
      !settings.preprocessingReviewOverride
    ) {
      setNoticeMessage('Review the preprocessing warning and confirm it before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (settings.enhancementEnabled && !settings.preprocessingArtifactId) {
      setNoticeMessage('Approve the Generation Preview or disable enhancement before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }

    if (batchGenerationEnabled) {
      if (settings.image && !settings.imageFileId) {
        const imageBlob = dataURLtoFile(settings.image, 'image.jpg');
        const uploaded = await uploadReferenceImage(imageBlob);
        if (!uploaded) {
          setNoticeMessage('The image could not be uploaded, so it was not queued.');
          const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
          noticeTimeoutsRef.current.push(timeoutId);
          return;
        }
        setGenerationSettings(prev => ({ ...prev, imageFileId: uploaded.fileId, image: uploaded.url }));
        setApprovalStatus(uploaded.response.approval_status ?? null);
        setApprovalWarning(uploaded.response.warning || null);
        setApprovalValidation(uploaded.response.validation ?? null);
        setApprovalAcknowledged(false);
        if (uploaded.response.approval_status === 'failed' || uploaded.response.approval_status === 'needs_review') {
          setNoticeMessage(uploaded.response.approval_status === 'failed'
            ? uploaded.response.warning || 'Backend validation failed. The image was not queued.'
            : 'Review the backend upload warning, confirm it, then click Generate to queue this image.');
          const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
          noticeTimeoutsRef.current.push(timeoutId);
          return;
        }
        addToBatchQueue([uploaded.fileId]);
        setNoticeMessage('Image added to batch queue.');
        const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
        noticeTimeoutsRef.current.push(timeoutId);
      } else if (settings.imageFileId) {
        addToBatchQueue([settings.imageFileId]);
        setNoticeMessage('Image added to batch queue.');
        const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
        noticeTimeoutsRef.current.push(timeoutId);
      }
    } else {
      pendingGenerateRef.current = true;
      setGenerationSettings(prev => ({
        ...prev,
        generateTexture: prev.generateTexture !== false,
        removeBackground: true,
        autoOptimizeSettings: {
          ...prev.autoOptimizeSettings,
          targetPolycount: prev.autoOptimizeSettings?.targetPolycount !== undefined
            ? prev.autoOptimizeSettings.targetPolycount
            : 0,
        },
      }));
    }
  }, [
    approvalStatus,
    approvalAcknowledged,
    approvalWarning,
    preprocessingApprovalStatus,
    batchGenerationEnabled,
    uploadReferenceImage,
    setGenerationSettings,
    addToBatchQueue,
  ]);

  const handleQueueNext = useCallback(async () => {
    const settings = generationSettingsRef.current;
    const hasImage = Boolean(settings.image || settings.imageFileId);
    if (!hasImage) {
      setNoticeMessage('Upload or select an image to queue.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 4000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (approvalStatus === 'failed' || (approvalStatus === 'needs_review' && !approvalAcknowledged)) {
      setNoticeMessage(approvalStatus === 'failed'
        ? approvalWarning || 'Backend validation failed. Choose another image before queuing.'
        : 'Review and confirm the backend upload warning before queuing.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    setNoticeMessage('Submitting next generation job to background queue...');
    try {
      const qId = await queueGenerationJob();
      if (qId) {
        setNoticeMessage('Job queued successfully! Monitoring progress in viewport.');
      }
    } catch {
      setNoticeMessage('Failed to queue job.');
    }
    const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
    noticeTimeoutsRef.current.push(timeoutId);
  }, [approvalStatus, approvalAcknowledged, approvalWarning, queueGenerationJob]);

  const handleOpenAdvanced = useCallback(() => setAdvancedSettingsOpen(true), []);
  const handleCloseAdvanced = useCallback(() => setAdvancedSettingsOpen(false), []);

  return (
    <div
      id="panel-generate-model"
      className="relative flex flex-col h-full bg-[#16171B] text-xs select-none overflow-x-hidden overflow-y-hidden"
    >
      {/* Panel Header */}
      <div className="px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-xs text-white flex items-center gap-1.5">
          <HugeiconsIcon icon={SparklesIcon} size={16} className="text-[#F5C542]" />
          <span>Generate 3D Model</span>
        </span>
        <div className="flex items-center gap-1.5">
          <ToolContextHelp tool="model" label="Generate 3D Help" />
        </div>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2.5 space-y-2.5 scrollbar-none pr-1.5">
        {/* Notice Message Toast/Banner */}
        <AnimatePresence>
          {noticeMessage && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-2.5 rounded-xl bg-[#F5C542]/15 border border-[#F5C542]/40 text-[#F5C542] text-[10.5px] flex items-center justify-between gap-1.5 overflow-hidden"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <HugeiconsIcon icon={InfoIcon} size={16} className="shrink-0" />
                <span className="leading-tight font-medium">{noticeMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setNoticeMessage(null)}
                aria-label="Dismiss notice"
                className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel} size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* T-06: Candidate Comparison Grid */}
        {currentAsset?.candidates && currentAsset.candidates.length > 1 && (
          <div className="rounded-xl border border-[#F5C542]/30 bg-[#F5C542]/5 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={SparklesIcon} size={14} className="text-[#F5C542]" />
                <span className="text-[11px] font-bold text-white">
                  Candidate Variations ({currentAsset.candidates.length})
                </span>
              </div>
              <span className="text-[8px] font-mono text-[#F5C542] font-bold px-1.5 py-0.5 rounded bg-[#F5C542]/10 border border-[#F5C542]/25">
                Pick-Best-of-N
              </span>
            </div>
            <p className="text-[9px] text-zinc-400 leading-tight">
              Click a candidate to inspect in the 3D viewport. Click <strong>Use this one</strong> to promote it to master; unselected variations will be cleaned up.
            </p>
            <div className={`grid gap-1.5 ${currentAsset.candidates.length === 2 ? 'grid-cols-2' : currentAsset.candidates.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {currentAsset.candidates.map((cand) => {
                const isSelected = Boolean(cand.selected);
                return (
                  <div
                    key={cand.candidate_id}
                    className={`p-2 rounded-lg border flex flex-col justify-between transition-all ${
                      isSelected
                        ? 'bg-[#F5C542]/15 border-[#F5C542] shadow-sm ring-1 ring-[#F5C542]/40'
                        : 'bg-[#1D1F26] border-white/[0.08] hover:border-white/[0.2]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-white">Var #{cand.candidate_id + 1}</span>
                        {isSelected && (
                          <span className="text-[7.5px] font-bold px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            MASTER
                          </span>
                        )}
                      </div>
                      <div className="text-[8px] font-mono text-zinc-400 truncate">
                        Seed: {cand.seed}
                      </div>
                    </div>

                    <div className="mt-2 space-y-1">
                      <button
                        type="button"
                        onClick={() => handlePreviewCandidate(cand)}
                        className="w-full py-1 rounded text-[8.5px] font-bold bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 transition-colors cursor-pointer"
                      >
                        Inspect 3D
                      </button>
                      <button
                        type="button"
                        disabled={isSelected || promotingCandId !== null}
                        onClick={() => void handleSelectCandidate(cand.candidate_id)}
                        className={`w-full py-1 rounded text-[8.5px] font-black transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#F5C542]/20 text-[#F5C542] border border-[#F5C542]/30 cursor-default'
                            : 'bg-[#F5C542] text-black hover:brightness-110'
                        }`}
                      >
                        {isSelected ? 'Active' : promotingCandId === cand.candidate_id ? 'Promoting...' : 'Use this one'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Completed Asset Card / Viewer Panel */}
        {currentAsset && (
          <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#16171B] border border-white/[0.08] flex items-center justify-center text-[#F5C542] shrink-0 overflow-hidden">
                  {currentAsset.thumbnail ? (
                    <img src={currentAsset.thumbnail} alt={currentAsset.name} className="w-full h-full object-cover" />
                  ) : (
                    <HugeiconsIcon icon={Box} size={16} className="text-[#F5C542]" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white truncate flex items-center gap-1.5">
                    <span className="truncate">{currentAsset.name}</span>
                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-white/[0.06] text-zinc-300">
                      {currentAsset.format || 'GLB'}
                    </span>
                  </div>
                  <div className="text-[9px] text-zinc-400 font-mono truncate">
                    {currentAsset.triangles ? `${currentAsset.triangles.toLocaleString()} tris` : currentAsset.faces ? `${currentAsset.faces.toLocaleString()} faces` : 'Ready in Viewport'}
                  </div>
                </div>
              </div>
              <QualityBadge asset={currentAsset} size="md" />
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  const url = currentAsset.artifacts?.gameReady || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
                  if (url) loadModelInViewer(url, currentAsset.name, currentAsset as any);
                }}
                className="flex-1 py-1 px-2 rounded-lg text-[9.5px] font-bold bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 transition-colors cursor-pointer flex items-center justify-center gap-1"
              >
                <HugeiconsIcon icon={Box} size={14} className="text-[#F5C542]" />
                <span>Focus in Viewport</span>
              </button>
              <button
                type="button"
                onClick={() => navigateToTool('edit')}
                className="py-1 px-2.5 rounded-lg text-[9.5px] font-bold bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 transition-colors cursor-pointer"
              >
                Inspect &amp; Edit
              </button>
            </div>
          </div>
        )}

        {/* 1. Prompt and Image Dropzone Sub-module */}
        <PromptAndImageDropzone
          generationSettings={generationSettings}
          setGenerationSettings={setGenerationSettings}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
          uploadProgress={uploadProgress}
          processImageFiles={processImageFiles}
          onClearImage={handleClearImage}
          approvalStatus={approvalStatus}
          approvalWarning={approvalWarning}
          approvalValidation={approvalValidation}
          approvalAcknowledged={approvalAcknowledged}
          setApprovalAcknowledged={setApprovalAcknowledged}
          sampleLoading={sampleLoading}
          onSelectSample={handleSampleSelection}
          samplePresets={SAMPLE_PRESETS}
          previewEnhancement={previewEnhancement}
          disableEnhancement={disableEnhancement}
          enhancementLoading={enhancementLoading}
          enhancementError={enhancementError}
          navigateToTool={navigateToTool}
          formatValidationDetails={formatValidationDetails}
        />

        {/* 2. Model Selector Bento Sub-module */}
        <ModelSelectorBento
          activeModelId={activeModelId}
          activeModelObj={activeModelObj}
          providersList={providersList}
          onSelectModel={handleSelectModel}
          lowVram={Boolean(generationSettings.low_vram ?? generationSettings.lowVram ?? true)}
          onToggleLowVram={handleToggleLowVram}
          isPostprocessOff={isPostprocessOff}
          generateTexture={generationSettings.generateTexture !== false}
          onToggleGenerateTexture={handleToggleGenerateTexture}
          textureAtlasSize={textureAtlasSize}
          onChangeTextureAtlasSize={handleChangeTextureAtlasSize}
        />

        {/* 3. Production Options Section Sub-module */}
        <ProductionOptionsSection
          isPostprocessOff={isPostprocessOff}
          onTogglePostprocess={handleTogglePostprocess}
          intent={generationSettings.intent}
          onSelectPreset={selectOutputPreset}
          smartPresets={smartPresets}
          targetPolycount={generationSettings.autoOptimizeSettings?.targetPolycount ?? 0}
          onChangeTargetPolycount={handleChangeTargetPolycount}
          partCountRange={generationSettings.partCountRange}
          onChangePartCountRange={handleChangePartCountRange}
          enableAutoRig={Boolean(generationSettings.enableAutoRig)}
          onToggleAutoRig={handleToggleAutoRig}
          autoRigMode={generationSettings.autoRigMode}
          onChangeAutoRigMode={handleChangeAutoRigMode}
          generatePBR={Boolean(generationSettings.generateTexture !== false)}
          onTogglePBR={handleToggleGenerateTexture}
          onOpenAdvanced={handleOpenAdvanced}
          topologyMode={generationSettings.topologyMode}
          quadTopology={generationSettings.quadTopology}
          generateCollision={Boolean(generationSettings.generateCollision)}
          formatPresetSummary={formatPresetSummary}
        />

        {/* 4. Advanced Generation Drawer Sub-module */}
        <AdvancedGenerationDrawer
          isOpen={advancedSettingsOpen}
          onClose={handleCloseAdvanced}
          generationSettings={generationSettings}
          setGenerationSettings={setGenerationSettings}
          isPostprocessOff={isPostprocessOff}
        />
      </div>

      {/* 5. Sticky Action Footer Sub-module */}
      <GenerateActionFooter
        isExecuting={isExecuting}
        executionProgress={executionProgress}
        executionStep={executionStep}
        onGenerate={handleGenerate}
        onQueueNext={handleQueueNext}
        activeModelLabel={activeModelObj?.label || activeModelId || 'Trellis'}
        isPostprocessOff={isPostprocessOff}
        targetPolycount={generationSettings.autoOptimizeSettings?.targetPolycount ?? 0}
        isQuad={Boolean(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology)}
        generateTexture={Boolean(generationSettings.generateTexture !== false)}
      />
    </div>
  );
});

GeneratePanel.displayName = 'GeneratePanel';
