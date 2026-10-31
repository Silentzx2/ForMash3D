import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

const noticeTimeoutsRef = { current: [] as ReturnType<typeof setTimeout>[] };
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import type { GenerationSettings, PhysicsSettings, ModelAsset } from '../types';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { getApiClient } from '@/services/apiClient';
import { requireUploadFileId, resolveUploadedImageName } from '../lib/uploadResponse';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { getModelDefinition, isMeshGenerationModel } from '@/constants/models';
import { SMART_PRESET_FALLBACK } from '@/constants/smartPresets';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_PHYSICS_SETTINGS, PHYSICS_LIMITS } from '../utils/physicsSettings';
import { getModelFromSearch, getPresetIntentFromSearch, getPromptFromSearch } from '../lib/presetIntent';

import { HugeiconsIcon } from '@hugeicons/react';
import { Box, Cancel, CheckIcon, ChevronDown, ChevronUp, ImageIcon, InfoIcon, LayersIcon, LoaderCircle, Plus, RefreshCw, Settings2, SparklesIcon, TriangleAlertIcon, UploadIcon, ZapIcon } from '@hugeicons/core-free-icons';
import { ToolContextHelp } from '@/features/wiki/components/ToolContextHelp';
import { toast } from 'sonner';
import { loadModelInViewer } from '@/stores/useViewerStore';

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

function formatValidationDetails(validation: unknown): string | null {
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

export const PHYSICS_MATERIAL_PRESETS = [
  { label: 'Default', friction: DEFAULT_PHYSICS_SETTINGS.friction, restitution: DEFAULT_PHYSICS_SETTINGS.restitution },
  { label: 'Rubber', friction: 0.8, restitution: 0.8 },
  { label: 'Stone', friction: 0.6, restitution: 0.1 },
  { label: 'Wood', friction: 0.4, restitution: 0.2 },
  { label: 'Ice', friction: 0.05, restitution: 0.05 },
  { label: 'Metal', friction: 0.3, restitution: 0.15 },
] as const;

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
      style: 'bg-primary/15 text-primary border-primary/30 shadow-[0_0_8px_hsl(var(--primary)/0.15)]',
      dotStyle: 'bg-primary',
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
          <span className="font-mono text-primary font-bold">{retentionDisplay}</span>
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

interface DiscoveredModel {
  id: string;
  label: string;
  available: boolean;
  installed: boolean;
  status: string;
  vram_required_mb: number;
  supports_texture: boolean;
  supports: { texture_generation: boolean };
  shape_vram_mb: number;
  texture_vram_mb: number;
  capabilities?: Record<string, any>;
}

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
  else if (id === 'hi3d_image_to_raw_mesh') cleanLabel = 'Hi3D [Experimental] (High-Res Geometry)';
  else if (id === 'hi3d_image_to_textured_mesh') cleanLabel = 'Hi3D [Experimental] (Refined Mesh)';

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

export const GeneratePanel: React.FC = () => {
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

  const handlePreviewCandidate = (cand: { candidate_id: number; model_url?: string; seed: number }) => {
    if (!currentAsset) return;
    const viewUrl = cand.model_url || `/api/v1/system/jobs/${currentAsset.id}/candidates/${cand.candidate_id}/download`;
    loadModelInViewer(viewUrl, `${currentAsset.name} (Var #${cand.candidate_id + 1})`, currentAsset as any);
    toast.info(`Previewing candidate #${cand.candidate_id + 1} (Seed: ${cand.seed}) in viewport`);
  };

  const handleSelectCandidate = async (candidateId: number) => {
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
  };
  
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
  const searchParams = useSearchParams();
  const routeSearch = searchParams.toString();

  const currentMode = 'image-to-3d';
  const [modelRegistry, setModelRegistry] = useState<Record<string, string[]> | null>(null);
  const [weightsStatus, setWeightsStatus] = useState<Record<string, boolean>>({});
  const [modelDetails, setModelDetails] = useState<Record<string, any>>({});
  const [optionsLoading, setOptionsLoading] = useState(false);
  const pendingGenerateRef = useRef(false);
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
        if (active) {
          const intents = data?.intents;
          if (intents && Object.keys(intents).length > 0) {
            setSmartPresets(intents);
          } else {
            console.warn('Smart presets response empty; using fallback presets:', intents);
            setSmartPresets(SMART_PRESET_FALLBACK);
          }
        }
      }).catch(err => {
        console.warn('Failed to load smart-generation presets:', err);
        setSmartPresets(SMART_PRESET_FALLBACK);
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
      'trellis2_image_to_raw_mesh',
      'trellis_image_to_textured_mesh',
      'triposg_image_to_raw_mesh',
      'hunyuan3d_shape_v21_image_to_raw_mesh',
      'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
      'unique3d_image_to_raw_mesh',
      'hi3d_image_to_raw_mesh',
    ];
    ids = combined.length > 0 ? combined : defaults;

    // Prioritize ready / installed models at the top, while keeping all supported models
    // visible in the selector so users can see available engines and their readiness status.
    const readyIds = ids.filter(id => memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true);
    const otherIds = ids.filter(id => !readyIds.includes(id));
    return [...readyIds, ...otherIds];
  }, [modelRegistry, weightsStatus, memoizedModelDetails]);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

  // Clean up all notice timeouts on unmount
  useEffect(() => {
    return () => {
      noticeTimeoutsRef.current.forEach((id) => clearTimeout(id));
      noticeTimeoutsRef.current = [];
    };
  }, []);

  // Close model dropdown when clicking outside
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(target)) {
        const trigger = document.getElementById('btn-select-ai-model');
        if (trigger && trigger.contains(target)) return;
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelDropdownOpen]);
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
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'verifying' | 'saved' | 'error'>('idle');
  const [approvalStatus, setApprovalStatus] = useState<'approved' | 'needs_review' | 'failed' | null>(null);
  const [approvalWarning, setApprovalWarning] = useState<string | null>(null);
  const [approvalValidation, setApprovalValidation] = useState<unknown>(null);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const preprocessingApprovalStatus = generationSettings.preprocessingMetadata?.approval_status ?? null;

  const meshCapableModels = useMemo(() => {
    return relevantModelIds.map(id => {
      const isReady = memoizedModelDetails[id]?.status === 'ready' || weightsStatus[id] === true;
      return formatGenerateModel(id, isReady, memoizedModelDetails[id]);
    });
  }, [relevantModelIds, weightsStatus, memoizedModelDetails]);

  const providersList = meshCapableModels;
  const statusInfo = getStatusInfo();
  const appliedRouteModel = useRef<string | null>(null);
  useEffect(() => {
    const model = getModelFromSearch(routeSearch, providersList.map(provider => provider.id));
    if (!model || appliedRouteModel.current === model) return;
    appliedRouteModel.current = model;
    setGenerationSettings(prev => ({ ...prev, aiModel: model }));
  }, [providersList, routeSearch, setGenerationSettings]);

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
  // Master post-processing bypass flag
  const isPostprocessOff = generationSettings.enablePostprocess === false;

  // Centralized Textured Generation toggle: visible for every supported geometry model
  const showTextureToggle = true;
  const textureAtlasSize: '1K' | '2K' | '4K' | '8K' =
    generationSettings.texture_resolution ||
    generationSettings.textureResolution ||
    (generationSettings.textureQuality === 'low' ? '1K' :
     generationSettings.textureQuality === 'medium' ? '1K' :
     generationSettings.textureQuality === '8k' ? '8K' : '2K');

  const physics = generationSettings.physics ?? DEFAULT_PHYSICS_SETTINGS;

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

  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-png', 'image/jpg'];
  const ACCEPTED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'];

  const isAcceptedImage = (file: File) => {
    if (file.type && ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      return true;
    }
    const name = (file.name || '').toLowerCase();
    return ACCEPTED_IMAGE_EXTS.some(ext => name.endsWith(ext));
  };

  const uploadReferenceImage = async (file: File) => {
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
  };

  const processImageFiles = async (files: File[]) => {
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || []);
    if (files.length > 0) void processImageFiles(files);
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
    
    void processImageFiles(Array.from(files));
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
        void processImageFiles([file]);
      }
    }
  };

  // Check for pending board image from Board-to-Generate bridge (T-10)
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
  }, []);

  const handleImageTo3DTabClick = () => {
    setGenerationSettings(prev => ({ ...prev, mode: 'image-to-3d' }));
    navigateToTool('model');
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

  const handleSampleSelection = async (preset: (typeof SAMPLE_PRESETS)[number]) => {
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
  };

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

    // The backend preset definition is the single source of truth for the recipe.
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
      // Let the chosen intent preset drive the matching production controls so the
      // UI recipe matches the backend preset exactly (quad topology, segmentation,
      // rig type, export formats and slicer handoff).
      ...(presetData.quad_topology !== undefined
        ? { topologyMode: presetData.quad_topology ? 'quad' : 'triangle', quadTopology: Boolean(presetData.quad_topology) }
        : {}),
      ...(presetData.part_count_range !== undefined ? { partCountRange: presetData.part_count_range } : {}),
      ...(presetData.rig_type !== undefined ? { rigType: presetData.rig_type } : {}),
      ...(presetData.export_formats !== undefined ? { exportFormats: [...presetData.export_formats] } : {}),
      ...(presetData.slicer_handoff !== undefined ? { slicerHandoff: Boolean(presetData.slicer_handoff) } : {}),
    }))
  }, [setGenerationSettings, smartPresets]);

  const appliedRouteIntent = useRef<string | null>(null);
  useEffect(() => {
    const intent = getPresetIntentFromSearch(routeSearch, SMART_PRESET_FALLBACK);
    if (!intent || appliedRouteIntent.current === intent) return;
    appliedRouteIntent.current = intent;
    selectOutputPreset(intent as 'mobile' | 'game_ready' | 'cinematic' | 'animation' | '3d_print' | 'native' | 'game_ready_quad' | 'multi_variant');
  }, [routeSearch, selectOutputPreset]);

  const appliedRoutePrompt = useRef<string | null>(null);
  useEffect(() => {
    const prompt = getPromptFromSearch(routeSearch);
    if (!prompt || appliedRoutePrompt.current === prompt) return;
    appliedRoutePrompt.current = prompt;
    setGenerationSettings(prev => ({ ...prev, prompt, imageName: prompt }));
  }, [routeSearch, setGenerationSettings]);

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
  };

  const disableEnhancement = () => {
    setGenerationSettings(prev => ({
      ...prev,
      enhancementEnabled: false,
      preprocessingReviewOverride: false,
      preprocessingArtifactId: null,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
    }));
    setEnhancementError(null);
  };

  const handleGenerate = async () => {
    const hasImage = Boolean(generationSettings.image);
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
    if (generationSettings.preprocessingArtifactId && !generationSettings.enhancementEnabled) {
      setNoticeMessage('Choose the validated preview, confirm its review warning, or disable enhancement to use the original image.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (generationSettings.enhancementEnabled && preprocessingApprovalStatus === 'failed') {
      setNoticeMessage('Preprocessing failed. Disable enhancement to use the original image.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (
      generationSettings.enhancementEnabled &&
      preprocessingApprovalStatus === 'needs_review' &&
      !generationSettings.preprocessingReviewOverride
    ) {
      setNoticeMessage('Review the preprocessing warning and confirm it before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    if (generationSettings.enhancementEnabled && !generationSettings.preprocessingArtifactId) {
      setNoticeMessage('Approve the Generation Preview or disable enhancement before generating.');
      const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
      noticeTimeoutsRef.current.push(timeoutId);
      return;
    }
    // If batch generation is enabled, add current image to batch queue instead of generating immediately
    if (batchGenerationEnabled) {
      if (generationSettings.image && !generationSettings.imageFileId) {
        const imageBlob = dataURLtoFile(generationSettings.image, 'image.jpg');
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
      } else if (generationSettings.imageFileId) {
        // Image already uploaded, add to batch queue
        addToBatchQueue([generationSettings.imageFileId]);
        setNoticeMessage('Image added to batch queue.');
        const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
        noticeTimeoutsRef.current.push(timeoutId);
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
            : 0,
        },
      }));
    }
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
        <div className="flex items-center gap-1.5">
          {statusInfo && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
              <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-3 h-3" />
              {statusInfo.label}
            </span>
          )}
          <ToolContextHelp tool="model" label="Generate 3D Help" />
        </div>
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
                type="button"
                onClick={() => setNoticeMessage(null)}
                aria-label="Dismiss notice"
                className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel} size={16} className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* T-06: Candidate Comparison Grid */}
        {currentAsset?.candidates && currentAsset.candidates.length > 1 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={SparklesIcon} size={14} className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-bold text-white">Candidate Variations ({currentAsset.candidates.length})</span>
              </div>
              <span className="text-[8px] font-mono text-primary font-bold px-1.5 py-0.5 rounded bg-primary/10 border border-primary/25">
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
                        ? 'bg-primary/15 border-primary shadow-sm ring-1 ring-primary/40'
                        : 'bg-[hsl(var(--surface-1))] border-white/[0.08] hover:border-white/[0.2]'
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
                            ? 'bg-primary/20 text-primary border border-primary/30 cursor-default'
                            : 'bg-primary text-black hover:brightness-110'
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
          <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center text-primary shrink-0 overflow-hidden">
                  {currentAsset.thumbnail ? (
                    <img src={currentAsset.thumbnail} alt={currentAsset.name} className="w-full h-full object-cover" />
                  ) : (
                    <HugeiconsIcon icon={Box} size={16} className="w-4 h-4 text-primary" />
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
                <HugeiconsIcon icon={Box} size={14} className="w-3 h-3 text-primary" />
                <span>Focus in Viewport</span>
              </button>
              <button
                type="button"
                onClick={() => navigateToTool('edit')}
                className="py-1 px-2.5 rounded-lg text-[9.5px] font-bold bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 transition-colors cursor-pointer"
              >
                Inspect & Edit
              </button>
            </div>
          </div>
        )}

        {/* Unified Studio Generation Pipeline */}
        <div className="space-y-2.5">
          <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              {/* Mode 1: Single Image UploadIcon */}
              {(
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
                    {uploadStatus === 'uploading' || uploadStatus === 'verifying' ? (
                      <div className="text-center space-y-1.5 w-full px-2 z-10">
                        <HugeiconsIcon icon={LoaderCircle} size={16} className="w-5 h-5 mx-auto animate-spin text-primary" />
                        <div className="font-bold text-[10px] text-white">{uploadStatus === 'verifying' ? 'Verifying upload...' : 'Uploading...'}</div>
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

                  {uploadStatus === 'saved' && (
                    <div role="status" className="text-[10px] text-emerald-300">Image upload saved.</div>
                  )}
                  {uploadError && (
                    <div role="alert" className="text-[10px] leading-relaxed text-rose-300">{uploadError}</div>
                  )}
                  {(approvalStatus || approvalWarning || approvalValidation) && (
                    <div
                      role={approvalStatus === 'failed' ? 'alert' : 'status'}
                      className={`space-y-1 rounded-lg border px-2 py-1.5 text-[10px] leading-relaxed ${approvalStatus === 'failed' ? 'border-rose-500/25 bg-rose-500/[0.06] text-rose-300' : approvalStatus === 'needs_review' ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200' : 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-200'}`}
                    >
                      <div className="font-semibold">
                        {approvalStatus === 'approved' ? 'Backend approval: approved' : approvalStatus === 'needs_review' ? 'Backend approval: review required' : approvalStatus === 'failed' ? 'Backend approval: failed' : 'Backend validation notice'}
                      </div>
                      {approvalWarning && <div>{approvalWarning}</div>}
                      {formatValidationDetails(approvalValidation) && <div>{formatValidationDetails(approvalValidation)}</div>}
                      {approvalStatus === 'needs_review' && (
                        <label className="flex items-start gap-1.5 pt-0.5">
                          <input
                            type="checkbox"
                            checked={approvalAcknowledged}
                            onChange={event => setApprovalAcknowledged(event.target.checked)}
                            className="mt-0.5 accent-amber-400"
                          />
                          <span>I reviewed this warning and want to continue.</span>
                        </label>
                      )}
                      {approvalStatus === 'failed' && <div>Choose a different image; generation is blocked.</div>}
                    </div>
                  )}

                  {/* Quick Presets / Clear image */}
                  <div className="flex items-center justify-between text-[10px] pt-0.5">
                    <span className="text-zinc-400 font-medium">{generationSettings.image ? 'Loaded' : 'Sample:'}</span>
                    <div className="flex items-center gap-1.5">
                      {generationSettings.image ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
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
                            disabled={sampleLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSampleSelection(preset);
                            }}
                            className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] text-[9.5px] font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
                          >
                            {sampleLoading ? 'Loading…' : preset.name.split(' ')[0]}
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
                    <span className={generationSettings.enhancementEnabled ? 'text-[9px] font-bold text-emerald-300' : preprocessingApprovalStatus === 'failed' || preprocessingApprovalStatus === 'needs_review' ? 'text-[9px] font-bold text-amber-300' : 'text-[9px] text-zinc-500'}>
                      {generationSettings.enhancementEnabled
                        ? preprocessingApprovalStatus === 'needs_review' ? 'Review override active' : 'Approved'
                        : preprocessingApprovalStatus === 'approved' ? 'Validated preview'
                          : preprocessingApprovalStatus === 'needs_review' ? 'Review required'
                            : preprocessingApprovalStatus === 'failed' ? 'Preprocessing failed' : 'Original'}
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
                  {preprocessingApprovalStatus === 'needs_review' && (
                    <label className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1.5 text-[9px] leading-relaxed text-amber-200">
                      <input
                        type="checkbox"
                        checked={Boolean(generationSettings.preprocessingReviewOverride)}
                        onChange={event => setGenerationSettings(prev => ({
                          ...prev,
                          preprocessingReviewOverride: event.target.checked,
                        }))}
                        className="mt-0.5 accent-amber-400"
                      />
                      <span>I reviewed the foreground warning and want to use this preview.</span>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => void previewEnhancement()} disabled={enhancementLoading}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[9px] font-bold text-primary disabled:opacity-50">
                      {enhancementLoading ? 'Preparing Preview…' : generationSettings.preprocessingArtifactId ? 'Regenerate Preview' : 'Create Generation Preview'}
                    </button>
                    {generationSettings.preprocessingArtifactId ? (
                      <button
                        type="button"
                        disabled={
                          preprocessingApprovalStatus === 'failed' ||
                          (preprocessingApprovalStatus === 'needs_review' && !generationSettings.preprocessingReviewOverride) ||
                          !['approved', 'needs_review'].includes(preprocessingApprovalStatus)
                        }
                        onClick={() => setGenerationSettings(prev => ({ ...prev, enhancementEnabled: true }))}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[9px] font-bold text-emerald-300 disabled:opacity-40">
                        {preprocessingApprovalStatus === 'needs_review' ? 'Use Reviewed Preview' : 'Use Validated Preview'}
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

            </div>

            {/* AI 3D Model Engine Selector + Textured Output Controls */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>AI 3D Engine</span>
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                  isPostprocessOff
                    ? 'text-zinc-400 bg-zinc-800/80 border-white/[0.08]'
                    : generationSettings.generateTexture !== false
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                    : 'text-zinc-300 bg-white/[0.06] border-white/[0.1]'
                }`}>
                  {isPostprocessOff ? 'Raw Geometry (Postprocess OFF)' : generationSettings.generateTexture !== false ? `Textured (${textureAtlasSize})` : 'Raw Geometry'}
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
                      {isPostprocessOff
                        ? 'Raw Source Geometry (Postprocess OFF)'
                        : generationSettings.generateTexture !== false
                        ? `${textureAtlasSize} PBR Output`
                        : 'Raw Geometry Mesh'}
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
                              setUploadStatus('idle');
                              setUploadError(null);
                              setApprovalStatus(null);
                              setApprovalWarning(null);
                              setApprovalValidation(null);
                              setApprovalAcknowledged(false);
                          setGenerationSettings(prev => ({
                            ...prev,
                            aiModel: m.id,
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

              {/* Textured Generation Toggle */}
              {showTextureToggle && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    disabled={isPostprocessOff}
                    onClick={() => {
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
                    }}
                    className={`w-full p-2 rounded-lg border text-left flex items-center justify-between transition-all ${
                      isPostprocessOff
                        ? 'bg-[hsl(var(--surface-1))] border-white/[0.04] text-zinc-500 cursor-not-allowed opacity-50'
                        : generationSettings.generateTexture !== false
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-white cursor-pointer hover:border-emerald-500/50'
                        : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400 cursor-pointer hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-white leading-tight">Textured Generation</span>
                        {isPostprocessOff && (
                          <span className="text-[7.5px] font-mono px-1 py-0.2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                            BLOCKED
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] text-zinc-400">
                        {isPostprocessOff
                          ? 'Requires Post-Processing'
                          : generationSettings.generateTexture !== false
                          ? `${textureAtlasSize} Atlas`
                          : 'Raw Mesh'}
                      </span>
                    </div>
                    <div className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${
                      isPostprocessOff
                        ? 'bg-zinc-800'
                        : generationSettings.generateTexture !== false
                        ? 'bg-emerald-500'
                        : 'bg-zinc-700'
                    }`}>
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform ${
                        isPostprocessOff
                          ? 'left-0.5 bg-zinc-600'
                          : generationSettings.generateTexture !== false
                          ? 'left-4 bg-black'
                          : 'left-0.5 bg-zinc-300'
                      }`} />
                    </div>
                  </button>
                </div>
              )}

              {/* Output Atlas Size Selector when Textured Generation is ON */}
              {isPostprocessOff ? (
                <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.04] space-y-1 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>Output Atlas Size</span>
                    </span>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold uppercase">
                      Bypassed
                    </span>
                  </div>
                  <p className="text-[9px] text-zinc-500 leading-tight">
                    Texture baking and UV unwrapping are post-processing stages and are blocked when Post-Processing is OFF.
                  </p>
                </div>
              ) : generationSettings.generateTexture !== false ? (
                <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-2 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Output Atlas Size</span>
                    <span className="text-[10px] font-mono text-primary font-bold">{textureAtlasSize}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['1K', '2K', '4K', '8K'] as const).map(size => {
                      const isSelected = textureAtlasSize === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setGenerationSettings(prev => {
                            const currentSize = prev.texture_resolution || prev.textureResolution ||
                              (prev.textureQuality === 'low' || prev.textureQuality === 'medium' ? '1K' :
                                prev.textureQuality === '8k' ? '8K' : '2K');
                            return {
                              ...prev,
                              // A manual atlas change creates a custom recipe instead of leaving a stale preset selected.
                              intent: currentSize === size ? prev.intent : undefined,
                              texture_resolution: size,
                              textureResolution: size,
                              textureQuality: size === '1K' ? 'low' : size === '2K' ? 'high' : size === '4K' ? 'high' : '8k',
                            };
                          })}
                          className={`py-1.5 rounded-lg text-xs font-mono font-bold transition-all text-center cursor-pointer ${
                            isSelected
                              ? 'bg-primary text-black font-black shadow-sm'
                              : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                          }`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                  {(textureAtlasSize === '4K' || textureAtlasSize === '8K') && (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10px] leading-relaxed">
                      <HugeiconsIcon icon={TriangleAlertIcon} size={14} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>High Resource Notice:</strong> {textureAtlasSize} atlas generation takes longer and requires high GPU VRAM (&gt;16GB). The high-quality texture engine will bake an enhanced {textureAtlasSize} UV atlas.
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Post-Processing Pipeline Master Toggle */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${generationSettings.enablePostprocess !== false ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary))] animate-pulse' : 'bg-zinc-600'}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-white flex items-center gap-1.5 flex-wrap">
                      <span>Post-Processing</span>
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border font-semibold ${generationSettings.enablePostprocess !== false ? 'bg-primary/10 text-primary border-primary/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                        {generationSettings.enablePostprocess !== false ? 'ON · Full Pipeline' : 'OFF · Fast Raw Mesh'}
                      </span>
                    </div>
                    <div className="text-[9px] text-zinc-400 truncate">
                      {generationSettings.enablePostprocess !== false
                        ? 'AutoRetopo, UV unwrap, PBR baking & decimation'
                        : 'Bypasses post-processing; outputs raw generated mesh instantly'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Toggle post-processing"
                  aria-checked={generationSettings.enablePostprocess !== false}
                  onClick={() => setGenerationSettings(prev => {
                    const enabling = prev.enablePostprocess === false;
                    const target = prev.autoOptimizeSettings?.targetPolycount ?? 0;
                    return {
                      ...prev,
                      enablePostprocess: enabling,
                      // Native/Raw is target=0 plus processing off. Re-enabling the pipeline
                      // must restore a visible production target.
                      ...(enabling && target <= 0 ? {
                        intent: undefined,
                        autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: 50000 },
                      } : {}),
                    };
                  })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${generationSettings.enablePostprocess !== false ? 'bg-primary' : 'bg-zinc-700'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${generationSettings.enablePostprocess !== false ? 'translate-x-4' : 'translate-x-0 bg-zinc-300'}`}
                  />
                </button>
              </div>
              {generationSettings.enablePostprocess === false && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[8.5px] text-amber-300 flex items-center gap-1.5">
                  <span className="font-bold">⚡ Fast Mode:</span>
                  <span>Post-processing will not run after mesh generation. Raw geometry is returned immediately.</span>
                </div>
              )}
            </div>

            {/* Target Polycount & Output Presets */}
            <div className={`rounded-xl border p-2.5 space-y-2.5 transition-all ${
              isPostprocessOff
                ? 'border-white/[0.06] bg-[hsl(var(--surface-0))] opacity-60'
                : 'border-primary/20 bg-primary/5'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                    <span>Target & Output Preset</span>
                    {isPostprocessOff && (
                      <span className="text-[7.5px] font-mono px-1.5 py-0.2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                        BLOCKED
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-zinc-400">
                    {isPostprocessOff
                      ? 'Post-processing is OFF: downstream decimation, remesh & LOD stages are blocked'
                      : 'Output recipes configure production budgets; press Generate to run'}
                  </div>
                </div>
                <span className="font-mono text-xs font-black text-primary">
                  {isPostprocessOff
                    ? 'Bypassed (Raw Mesh)'
                    : (generationSettings.autoOptimizeSettings?.targetPolycount ?? 0) <= 0
                      ? 'Native / Raw'
                      : `${(generationSettings.autoOptimizeSettings?.targetPolycount ?? 0).toLocaleString()} tris`}
                </span>
              </div>

              {/* Canonical presets (mirrors backend/intents in smart_presets.yaml) */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'mobile', label: 'Mobile' },
                  { id: 'game_ready', label: 'Game Ready' },
                  { id: 'game_ready_quad', label: 'Game Ready (Quad)' },
                  { id: 'cinematic', label: 'Cinematic' },
                  { id: 'animation', label: 'Animation' },
                  { id: '3d_print', label: '3D Print' },
                  { id: 'multi_variant', label: 'Multi-Variant' },
                  { id: 'native', label: 'Native' },
                ].map(({ id, label }) => {
                  const presetData = smartPresets[id] ?? SMART_PRESET_FALLBACK[id];
                  const desc = id === 'native'
                    ? 'Raw geometry'
                    : formatPresetSummary(presetData);
                  const isSelected = id === 'native'
                    ? (isPostprocessOff || ((generationSettings.autoOptimizeSettings?.targetPolycount ?? 0) <= 0 && !generationSettings.intent))
                    : generationSettings.intent === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={isPostprocessOff && id !== 'native'}
                      onClick={() => selectOutputPreset(id as any)}
                      className={`min-h-11 rounded-lg border text-left px-2 py-1.5 transition-all flex flex-col justify-between ${
                        isPostprocessOff && id !== 'native'
                          ? 'opacity-40 cursor-not-allowed bg-[hsl(var(--surface-1))] border-white/[0.04] text-zinc-600'
                          : isSelected
                            ? 'bg-primary text-black border-primary font-bold shadow-sm cursor-pointer'
                            : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-300 hover:border-primary/30 hover:text-white cursor-pointer'
                      }`}
                    >
                      <span className="block text-[10px] font-black leading-tight truncate">{label}</span>
                      <span className={`block text-[7.5px] mt-0.5 leading-tight ${isSelected ? 'text-black/80 font-bold' : 'text-zinc-500'}`}>{desc}</span>
                    </button>
                  );
                })}
              </div>

              {/* Polycount Slider */}
              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[9px] text-zinc-400">
                  <span>Fine-tune triangle budget</span>
                  <span>{isPostprocessOff ? 'Blocked' : '5K - 200K'}</span>
                </div>
                <input
                  aria-label="Production polycount"
                  type="range"
                  disabled={isPostprocessOff}
                  min={5000}
                  max={200000}
                  step={5000}
                  value={(generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000) > 0 ? generationSettings.autoOptimizeSettings!.targetPolycount : 50000}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setGenerationSettings(prev => ({
                      ...prev,
                      intent: undefined,
                      autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: val },
                    }));
                  }}
                  className={`w-full h-1.5 rounded-full appearance-none bg-[hsl(var(--surface-2))] accent-primary ${isPostprocessOff ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                />
              </div>
              {isPostprocessOff && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[8.5px] text-amber-300/80 flex items-center gap-1.5">
                  <span>🔒 Target polycount & decimation stages are blocked when Post-Processing is OFF.</span>
                </div>
              )}
            </div>
            {/* Advanced generation controls are opt-in so the main workflow stays compact. */}
            <button
              type="button"
              onClick={() => setAdvancedSettingsOpen(true)}
              className="w-full rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 text-left hover:border-primary/40 hover:bg-[hsl(var(--surface-2))] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                    isPostprocessOff ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-primary/10 border-primary/20 text-primary'
                  }`}>
                    <HugeiconsIcon icon={Settings2} size={16} className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                      <span>Advanced Generation</span>
                      {isPostprocessOff && (
                        <span className="text-[7.5px] font-mono px-1.5 py-0.2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                          POSTPROCESS OFF
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-zinc-400 truncate">
                      {isPostprocessOff
                        ? 'Post-Processing Bypassed · Raw Source Geometry Only'
                        : `${(generationSettings.autoOptimizeSettings?.targetPolycount ?? 0) <= 0 ? 'Native / Raw' : `${Math.round(Number(generationSettings.autoOptimizeSettings?.targetPolycount) / 1000)}K tris`} · ${(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'quads' : 'triangles'} · ${generationSettings.generateCollision ? 'physics on' : 'physics off'}`
                      }
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
            {/* Candidate Variations */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                    <HugeiconsIcon icon={LayersIcon} size={14} className="w-3.5 h-3.5 text-primary" />
                    <span>Candidate Variations</span>
                  </div>
                  <div className="text-[9px] text-zinc-400">
                    Generate variations in one pass by stepping seeds
                  </div>
                </div>
                <span className="text-[9.5px] font-mono text-primary font-bold px-1.5 py-0.5 rounded bg-primary/10 border border-primary/25">
                  {(generationSettings.candidateCount || 1) === 1 ? '1 Variation' : `${generationSettings.candidateCount} Variations`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { count: 1, label: '1', sub: 'Single' },
                  { count: 2, label: '2', sub: 'Pair' },
                  { count: 3, label: '3', sub: 'Trio' },
                  { count: 4, label: '4', sub: 'Pick 4' },
                ].map(({ count, label, sub }) => {
                  const isSel = (generationSettings.candidateCount || 1) === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setGenerationSettings(prev => ({ ...prev, candidateCount: count }))}
                      className={`py-1.5 rounded-lg text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                        isSel
                          ? 'bg-primary text-black font-black shadow-sm'
                          : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'
                      }`}
                    >
                      <span className="text-[11px] font-mono font-bold leading-tight">{label}</span>
                      <span className={`text-[7.5px] ${isSel ? 'text-black/80 font-bold' : 'text-zinc-500'}`}>{sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

             {/* Topology & Normal-Map Baking */}
            <div className={`rounded-xl border bg-[hsl(var(--surface-0))] p-2.5 space-y-2.5 transition-all ${
              isPostprocessOff ? 'border-white/[0.06] opacity-60' : 'border-white/[0.1]'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={Box} size={16} className={`w-3.5 h-3.5 ${isPostprocessOff ? 'text-zinc-600' : 'text-primary'}`} />
                  <span>Topology & Normal Baking</span>
                </div>
                <span className="text-[9px] text-zinc-500">
                  {isPostprocessOff ? 'Blocked in Fast Mode' : (generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'Quads' : 'Triangles'}
                </span>
              </div>

              {/* Topology: Triangles vs Quads */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 text-[10.5px] font-medium">Topology Target</span>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase">
                    {(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'Quad dominant' : 'Triangles'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isPostprocessOff}
                    onClick={() => {
                      if (isPostprocessOff) return;
                      setGenerationSettings(prev => ({
                        ...prev,
                        topologyMode: 'triangle',
                        quadTopology: false,
                      }));
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
                      isPostprocessOff
                        ? 'bg-[hsl(var(--surface-1))] text-zinc-600 border border-white/[0.04] opacity-40 cursor-not-allowed'
                        : generationSettings.topologyMode !== 'quad' && !generationSettings.quadTopology
                        ? 'bg-primary text-black font-black shadow-sm cursor-pointer'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer'
                    }`}
                  >
                    <span>▲ Triangles</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPostprocessOff}
                    onClick={() => {
                      if (isPostprocessOff) return;
                      setGenerationSettings(prev => ({
                        ...prev,
                        topologyMode: 'quad',
                        quadTopology: true,
                      }));
                    }}
                    title="Convert to quad-dominant topology in post-processing"
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
                      isPostprocessOff
                        ? 'bg-[hsl(var(--surface-1))] text-zinc-600 border border-white/[0.04] opacity-40 cursor-not-allowed'
                        : (generationSettings.topologyMode === 'quad' || generationSettings.quadTopology)
                        ? 'bg-primary text-black font-black shadow-sm cursor-pointer'
                        : 'bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer'
                    }`}
                  >
                    <span>■ Quads</span>
                  </button>
                </div>
              </div>

              {/* Normal-Map Baking Toggle */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06] pt-1.5">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Bake Normal Maps</span>
                  <span className="text-[9.5px] text-zinc-500 block">Bakes high-frequency micro-relief into tangent-space normal maps</span>
                </div>
                <button
                  type="button"
                  disabled={isPostprocessOff}
                  onClick={() => {
                    if (isPostprocessOff) return;
                    setGenerationSettings(p => ({
                      ...p,
                      highResolutionNormalBaking: p.highResolutionNormalBaking === false ? true : false,
                    }));
                  }}
                  className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                    (generationSettings.highResolutionNormalBaking ?? true) ? 'bg-primary' : 'bg-zinc-700'
                  } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${
                    (generationSettings.highResolutionNormalBaking ?? true) ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            </div>

            {/* Part Segmentation, Rig Type & Export Formats */}
            <div className={`rounded-xl border bg-[hsl(var(--surface-0))] p-2.5 space-y-2.5 transition-all ${isPostprocessOff ? 'border-white/[0.06] opacity-60' : 'border-white/[0.1]'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={LayersIcon} size={16} className={`w-3.5 h-3.5 ${isPostprocessOff ? 'text-zinc-600' : 'text-primary'}`} />
                  <span>Part Segmentation &amp; Export</span>
                </div>
                <span className="text-[9px] text-zinc-500">{isPostprocessOff ? 'Blocked in Fast Mode' : 'Preset-driven, overridable'}</span>
              </div>

              {/* Part count range (segmentation presets) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 text-[10.5px] font-medium">Target Part Count</span>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase">{generationSettings.partCountRange || '1'}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { value: '1', label: '1', sub: 'Single' },
                    { value: '3-6', label: '3-6', sub: 'Sub-assembly' },
                    { value: '6-15', label: '6-15', sub: 'Detailed' },
                    { value: '15+', label: '15+', sub: 'Complex' },
                  ].map(({ value, label, sub }) => {
                    const isSel = generationSettings.partCountRange === value;
                    return (
                      <button key={value} type="button" disabled={isPostprocessOff} onClick={() => { if (isPostprocessOff) return; setGenerationSettings(prev => ({ ...prev, partCountRange: value as '1' | '3-6' | '6-15' | '15+' })) }} className={`py-1.5 rounded-lg text-center transition-all flex flex-col items-center justify-center cursor-pointer ${isSel ? 'bg-primary text-black font-black shadow-sm' : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'}`}>
                        <span className="text-[10px] font-mono font-bold leading-tight">{label}</span>
                        <span className={`text-[7.5px] ${isSel ? 'text-black/80 font-bold' : 'text-zinc-500'}`}>{sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Rig type */}
              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 text-[10.5px] font-medium">Rig Type</span>
                  <span className="text-[9px] text-zinc-400 font-mono capitalize">{generationSettings.rigType || 'none'}</span>
                </div>
                <select value={generationSettings.rigType || 'none'} onChange={e => setGenerationSettings(prev => ({ ...prev, rigType: e.target.value as GenerationSettings['rigType'] }))} disabled={isPostprocessOff} className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200 cursor-pointer">
                  <option value="none">None</option>
                  <option value="generic">Generic</option>
                  <option value="humanoid">Humanoid</option>
                  <option value="quadruped">Quadruped</option>
                  <option value="bird">Bird</option>
                  <option value="insect">Insect</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Export formats */}
              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 text-[10.5px] font-medium">Export Formats</span>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase">{generationSettings.exportFormats?.join(', ') || 'glb'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['glb', 'fbx', 'obj', 'stl', '3mf'] as const).map(fmt => {
                    const isSel = (generationSettings.exportFormats || []).includes(fmt);
                    return (
                      <button key={fmt} type="button" disabled={isPostprocessOff} onClick={() => { if (isPostprocessOff) return; setGenerationSettings(prev => { const cur = prev.exportFormats || []; const next = isSel ? cur.filter(f => f !== fmt) : [...cur, fmt]; return { ...prev, exportFormats: next }; }) }} className={`py-1.5 rounded-lg text-center transition-all flex flex-col items-center justify-center cursor-pointer ${isSel ? 'bg-primary text-black font-black shadow-sm' : 'bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white border border-white/[0.06]'}`}>
                        <span className="text-[9.5px] font-mono font-bold leading-tight">{fmt.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Slicer handoff toggle */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06] pt-1.5">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Slicer Handoff</span>
                  <span className="text-[9.5px] text-zinc-500 block">Hand the print-ready mesh to a slicer (STL/3MF)</span>
                </div>
                <button type="button" disabled={isPostprocessOff} onClick={() => { if (isPostprocessOff) return; setGenerationSettings(p => ({ ...p, slicerHandoff: !p.slicerHandoff })) }} className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${generationSettings.slicerHandoff ? 'bg-primary' : 'bg-zinc-700'} ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${generationSettings.slicerHandoff ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            {/* Level of Detail (LOD) */}
            <div className={`rounded-xl border bg-[hsl(var(--surface-0))] p-2.5 space-y-2 transition-all ${
              isPostprocessOff ? 'border-white/[0.06] opacity-60' : 'border-white/[0.1]'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={LayersIcon} size={16} className={`w-3.5 h-3.5 ${isPostprocessOff ? 'text-zinc-600' : 'text-primary'}`} />
                  <span>Level of Detail (LOD)</span>
                </div>
                <span className="text-[9px] text-zinc-500">
                  {isPostprocessOff ? 'Blocked in Fast Mode' : generationSettings.generateLOD !== false ? `${generationSettings.lodCount || 4} Levels` : 'Disabled'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Generate LOD Hierarchy</span>
                  <span className="text-[9.5px] text-zinc-500 block">Generates decimation chain for game engines</span>
                </div>
                <button
                  type="button"
                  disabled={isPostprocessOff}
                  onClick={() => {
                    if (isPostprocessOff) return;
                    setGenerationSettings(p => ({
                      ...p,
                      generateLOD: p.generateLOD === false ? true : false,
                    }));
                  }}
                  className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                    generationSettings.generateLOD !== false ? 'bg-primary' : 'bg-zinc-700'
                  } ${isPostprocessOff ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-black transition-transform ${
                    generationSettings.generateLOD !== false ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>

              {generationSettings.generateLOD !== false && !isPostprocessOff && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">LOD Preset</span>
                    <select
                      value={generationSettings.lodPreset || 'high'}
                      onChange={e => setGenerationSettings(p => ({ ...p, lodPreset: e.target.value as any }))}
                      className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200"
                    >
                      <option value="mobile">Mobile (aggressive)</option>
                      <option value="low">Low (lightweight)</option>
                      <option value="medium">Medium (balanced)</option>
                      <option value="high">High (standard)</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-semibold text-zinc-400">LOD Count</span>
                    <select
                      value={generationSettings.lodCount || 4}
                      onChange={e => setGenerationSettings(p => ({ ...p, lodCount: Number(e.target.value) }))}
                      className="w-full rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200"
                    >
                      <option value={2}>2 Levels (LOD0-1)</option>
                      <option value={3}>3 Levels (LOD0-2)</option>
                      <option value={4}>4 Levels (LOD0-3)</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            <div className={`rounded-xl border bg-[hsl(var(--surface-0))] p-2.5 space-y-2 transition-all ${
              isPostprocessOff ? 'border-white/[0.06] opacity-60' : 'border-white/[0.1]'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                    <span>Production QA</span>
                    {isPostprocessOff && (
                      <span className="text-[7.5px] font-mono px-1.5 py-0.2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                        BLOCKED
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    {isPostprocessOff ? 'QA and Auto-Rig stages require post-processing pipeline' : 'Uses the shared post-processing path; no duplicate pipeline.'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button"
                  disabled={isPostprocessOff}
                  onClick={() => {
                    if (isPostprocessOff) return;
                    setGenerationSettings(prev => ({
                      ...prev,
                      enablePrintabilityCheck: !Boolean(prev.enablePrintabilityCheck),
                      enableAutoRepair: !Boolean(prev.enablePrintabilityCheck) ? prev.enableAutoRepair : false,
                    }));
                  }}
                  className={isPostprocessOff
                    ? 'rounded-lg border border-white/[0.04] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-600 opacity-40 cursor-not-allowed'
                    : generationSettings.enablePrintabilityCheck
                      ? 'rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-left text-primary cursor-pointer'
                      : 'rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400 cursor-pointer'}>
                  <span className="block text-[10px] font-bold">Printability</span>
                  <span className="block text-[8px]">{isPostprocessOff ? 'Blocked' : generationSettings.enablePrintabilityCheck ? 'Checking topology' : 'Off'}</span>
                </button>
                <button type="button"
                  disabled={isPostprocessOff || !generationSettings.enablePrintabilityCheck}
                  onClick={() => {
                    if (isPostprocessOff) return;
                    setGenerationSettings(prev => ({ ...prev, enableAutoRepair: !Boolean(prev.enableAutoRepair) }));
                  }}
                  className={isPostprocessOff || !generationSettings.enablePrintabilityCheck
                    ? 'rounded-lg border border-white/[0.04] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-600 opacity-40 cursor-not-allowed'
                    : generationSettings.enableAutoRepair
                      ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-left text-emerald-300 cursor-pointer'
                      : 'rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400 cursor-pointer'}>
                  <span className="block text-[10px] font-bold">Auto-Repair</span>
                  <span className="block text-[8px]">{isPostprocessOff ? 'Blocked' : generationSettings.enableAutoRepair ? 'Repair + recheck' : 'No mutation'}</span>
                </button>
              </div>
              <button type="button"
                disabled={isPostprocessOff}
                onClick={() => {
                  if (isPostprocessOff) return;
                  setGenerationSettings(prev => ({ ...prev, enableAutoRig: !Boolean(prev.enableAutoRig) }));
                }}
                className={isPostprocessOff
                  ? 'w-full rounded-lg border border-white/[0.04] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-600 opacity-40 cursor-not-allowed'
                  : generationSettings.enableAutoRig
                    ? 'w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-left text-violet-200 cursor-pointer'
                    : 'w-full rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-left text-zinc-400 cursor-pointer'}>
                <span className="text-[10px] font-bold">Auto-Rig Game-Ready Mesh</span>
                <span className="block text-[8px] opacity-75">{isPostprocessOff ? 'Blocked (Post-processing OFF)' : generationSettings.enableAutoRig ? 'Runs UniRig after production processing' : 'Disabled'}</span>
              </button>
              {generationSettings.enableAutoRig && !isPostprocessOff && (
                <select value={generationSettings.autoRigMode || 'full'}
                  onChange={e => setGenerationSettings(prev => ({ ...prev, autoRigMode: e.target.value as GenerationSettings['autoRigMode'] }))}
                  className="w-full rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[9px] text-zinc-200">
                  <option value="full">Full — skeleton + skin</option>
                  <option value="skeleton">Skeleton only</option>
                  <option value="skin">Skinning</option>
                </select>
              )}
              {isPostprocessOff && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[8.5px] text-amber-300/80 flex items-center gap-1.5">
                  <span>🔒 Production QA and Auto-Rig are bypassed when Post-Processing is OFF.</span>
                </div>
              )}
            </div>

            {/* Physics Preparation */}
            <div className={`rounded-xl border bg-[hsl(var(--surface-0))] p-2.5 space-y-2 transition-all ${
              isPostprocessOff ? 'border-white/[0.06] opacity-60' : 'border-white/[0.1]'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <HugeiconsIcon icon={ZapIcon} size={16} className={`w-3.5 h-3.5 ${isPostprocessOff ? 'text-zinc-600' : 'text-primary'}`} />
                  <span>Physics Preparation</span>
                  {isPostprocessOff && (
                    <span className="text-[7.5px] font-mono px-1.5 py-0.2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">
                      BLOCKED
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-zinc-500">{isPostprocessOff ? 'Blocked in Fast Mode' : 'Post-process · no extra AI model'}</span>
              </div>

              <button type="button"
                disabled={isPostprocessOff}
                onClick={() => {
                  if (isPostprocessOff) return;
                  setGenerationSettings(prev => ({ ...prev, generateCollision: !Boolean(prev.generateCollision) }));
                }}
                className={isPostprocessOff
                  ? 'w-full p-2 rounded-lg border border-white/[0.04] bg-[hsl(var(--surface-1))] text-left text-zinc-600 opacity-40 cursor-not-allowed'
                  : generationSettings.generateCollision
                    ? 'w-full p-2 rounded-lg border border-primary/40 bg-primary/10 text-left text-white cursor-pointer'
                    : 'w-full p-2 rounded-lg border border-white/[0.06] bg-[hsl(var(--surface-1))] text-left text-zinc-400 cursor-pointer'}
              >
                <span className="text-[11px] font-bold">Physics Ready Asset</span>
                <span className="block text-[9px] text-zinc-400 mt-0.5">
                  {isPostprocessOff
                    ? 'Blocked (Requires Post-Processing pipeline)'
                    : generationSettings.generateCollision
                    ? 'Physics metadata + selected collision quality will be generated'
                    : 'No Physics metadata; normal collision remains available'}
                </span>
              </button>

              {generationSettings.generateCollision && !isPostprocessOff && (
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
                      <input type="number" min={PHYSICS_LIMITS.densityKgM3.min} max={PHYSICS_LIMITS.densityKgM3.max} step={10} value={physics.densityKgM3}
                        onChange={e => updatePhysics({ densityKgM3: Number(e.target.value) || PHYSICS_LIMITS.densityKgM3.min })}
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
                      <input type="number" min={PHYSICS_LIMITS.massKg.min} max={PHYSICS_LIMITS.massKg.max} step={0.1} value={physics.massKg}
                        onChange={e => updatePhysics({ massKg: Number(e.target.value) || PHYSICS_LIMITS.massKg.min })}
                        className="w-full mt-1 rounded-md bg-[hsl(var(--surface-1))] border border-white/[0.08] px-2 py-1.5 text-[10px] text-zinc-200" />
                    )}
                  </label>

                  <div className="col-span-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[9px] text-zinc-400">
                      <span className="font-semibold">Quick Material Presets</span>
                      <span className="text-[8px] text-zinc-500">Sets friction &amp; bounce</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {PHYSICS_MATERIAL_PRESETS.map((preset) => {
                        const isActive =
                          Math.abs(Number(physics.friction) - preset.friction) < 0.01 &&
                          Math.abs(Number(physics.restitution) - preset.restitution) < 0.01;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => updatePhysics({ friction: preset.friction, restitution: preset.restitution })}
                            className={`px-2 py-1.5 rounded-md text-[9px] font-medium transition-colors border text-center cursor-pointer ${
                              isActive
                                ? 'bg-primary/20 border-primary text-primary font-bold shadow-sm'
                                : 'bg-[hsl(var(--surface-1))] border-white/[0.08] text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

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

                </div>
              )}
              {isPostprocessOff && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[8.5px] text-amber-300/80 flex items-center gap-1.5">
                  <span>🔒 Collision hull generation is a post-processing stage and is blocked.</span>
                </div>
              )}
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
          <span className={`px-1.5 py-0.5 rounded font-semibold uppercase flex-shrink-0 ${
            isPostprocessOff
              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
              : 'bg-primary/10 text-primary'
          }`}>
            {isPostprocessOff
              ? 'RAW NATIVE GEOMETRY'
              : `${(generationSettings.autoOptimizeSettings?.targetPolycount ?? 0) <= 0 ? 'NATIVE / RAW' : `${Math.round(Number(generationSettings.autoOptimizeSettings?.targetPolycount) / 1000)}K`} ${(generationSettings.topologyMode === 'quad' || generationSettings.quadTopology) ? 'QUADS' : 'TRIS'}`
            }
          </span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border flex-shrink-0 ${
          isPostprocessOff
            ? 'bg-zinc-800/80 text-zinc-400 border-white/[0.08]'
            : generationSettings.generateTexture !== false
            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
            : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
        }`}>
          {isPostprocessOff ? 'POSTPROCESS: OFF (RAW)' : generationSettings.generateTexture !== false ? 'PBR TEXTURED' : 'GEOMETRY ONLY'}
        </span>
      </div>

        {/* Bottom Sticky Action Button */}
        <div className="flex items-center gap-1.5 w-full">
          <ShimmerButton
            id="btn-generate-model-action"
            onClick={handleGenerate}
            shimmerColor="hsl(var(--neon-amber))"
            shimmerSize="0.1em"
            shimmerDuration="2.5s"
            borderRadius="12px"
            background={
              isExecuting
                ? "hsl(var(--surface-2))"
                : "linear-gradient(135deg, #FFE066 0%, #FFCC00 50%, #E09800 100%)"
            }
            className={`flex-1 h-10 font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed btn-lighting-shine ${
              isExecuting 
                ? 'text-primary border border-primary/30 is-executing' 
                : 'text-[#080808] shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,204,0,0.45)] active:scale-[0.98]'
            }`}
          >
            {isExecuting ? (
              <>
                <HugeiconsIcon icon={LoaderCircle} size={16} className="w-3.5 h-3.5 animate-spin text-primary" />
                <span className="tracking-wide truncate max-w-[170px]">{executionStep || 'Generating 3D Model...'}</span>
              </>
            ) : (
              <>
                <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="tracking-wider">GENERATE 3D MODEL</span>
              </>
            )}
          </ShimmerButton>

          {isExecuting && (
            <SimpleTooltip label="Queue next model in background or execute on secondary GPU" side="top">
              <button
                type="button"
                onClick={async () => {
                  const hasImage = Boolean(generationSettings.image || generationSettings.imageFileId);
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
                  } catch (err) {
                    setNoticeMessage('Failed to queue job.');
                  }
                  const timeoutId = setTimeout(() => setNoticeMessage(null), 5000);
                  noticeTimeoutsRef.current.push(timeoutId);
                }}
                className="h-10 px-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-primary/20 border border-primary/40 hover:border-primary text-primary font-bold text-[11px] flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
              >
                <HugeiconsIcon icon={Plus} size={14} className="w-3.5 h-3.5" />
                <span>Queue Next</span>
              </button>
            </SimpleTooltip>
          )}
        </div>
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
