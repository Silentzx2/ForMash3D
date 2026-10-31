import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ToolType,
  MainNavRoute,
  ShadingMode,
  ModelAsset,
  MaterialConfig,
  SystemStats,
  GenerationSettings,
  RemeshSettings,
  TextureSettings,
  SculptSettings,
  PaintBrushSettings,
  ActiveTask,
  EnvironmentSettings,
  normalizeModelAsset,
} from '../types';
import type { BatchQueueItem } from '@/types';
import { apiClient } from '../lib/api';
import { getApiClient, normalizeBackendAssetUrl } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import { useViewerStore, loadModelInViewer } from '@/stores/useViewerStore';
import { prefetchGLB } from '../lib/glbCache';
import { shadingModeToPreset, presetToShadingMode } from '@/lib/storeAdapter';
import { diagnoseJobError } from '@/lib/jobDiagnostics';
import { useRouter, usePathname } from 'next/navigation';
import {
  buildGenerationParameters,
  resolveGenerationModelCapabilities,
  resolveGenerationModelChoice,
} from '../utils/buildGenerationParameters';
import { buildTextureGenerationParameters } from '../utils/buildTextureGenerationParameters';
import { DEFAULT_PHYSICS_SETTINGS } from '../utils/physicsSettings';
import { taskPersistence } from '@/services/taskPersistence';

interface ComparisonGroup {
  id: string;
  name: string;
  sourceImage: string | null;
  sourceImageName: string | null;
  modelIds: string[];
  prompts: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt: number | null;
  results: Record<string, ActiveTask | null>; // modelId -> task
  selectedModelId: string | null;
}

interface WorkspaceContextType {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  mainNav: MainNavRoute;
  setMainNav: (nav: MainNavRoute) => void;
  assets: ModelAsset[];
  isAssetsLoading?: boolean;
  selectedAssetId: string | null;
  currentAsset: ModelAsset | null;
  selectAsset: (id: string) => void;
  updateAssetProperties: (id: string, updates: Partial<ModelAsset>) => void;
  updateMaterialConfig: (updates: Partial<MaterialConfig>) => void;
  deleteAsset: (id: string) => void;
  addAsset: (asset: ModelAsset) => void;
  shadingMode: ShadingMode;
  setShadingMode: (mode: ShadingMode) => void;
  showWireframe: boolean;
  setShowWireframe: (show: boolean) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showBones: boolean;
  setShowBones: (show: boolean) => void;
  isTurntable: boolean;
  setIsTurntable: (turntable: boolean) => void;
  activeTransformTool: 'select' | 'rotate' | 'pan' | 'frame';
  setActiveTransformTool: (tool: 'select' | 'rotate' | 'pan' | 'frame') => void;
  viewportResetTrigger: number;
  resetCamera: () => void;
  fitToScreen: () => void;
  activeRightTab: 'assets' | 'property' | 'properties' | 'prompt';
  setActiveRightTab: (tab: 'assets' | 'property' | 'properties' | 'prompt') => void;
  rightPanelMode: 'assets' | 'property' | 'properties' | 'prompt';
  setRightPanelMode: (mode: 'assets' | 'property' | 'properties' | 'prompt') => void;
  isLeftPanelOpen: boolean;
  setIsLeftPanelOpen: (open: boolean) => void;
  toolPanelOpen: boolean;
  setToolPanelOpen: (open: boolean) => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  environmentSettings: EnvironmentSettings;
  setEnvironmentSettings: React.Dispatch<React.SetStateAction<EnvironmentSettings>>;
  setCurrentAsset: (asset: ModelAsset | null) => void;
  assetFilter: string;
  setAssetFilter: (filter: string) => void;
  duplicateAsset: (id: string) => void;
  systemStats: SystemStats;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isExportModalOpen: boolean;
  setIsExportModalOpen: (open: boolean) => void;
  isDccBridgeOpen: boolean;
  setIsDccBridgeOpen: (open: boolean) => void;
  refreshSystemStats: () => Promise<void>;
  leftPanelWidth: number;
  setLeftPanelWidth: (width: number) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (width: number) => void;
  activeTask: ActiveTask | null;
  jobsById: Record<string, ActiveTask>;
  dismissActiveTask: () => void;
  isExecuting: boolean;
  executionProgress: number;
  executionStep: string;
  cancelExecution: () => Promise<void>;
  generationSettings: GenerationSettings;
  setGenerationSettings: React.Dispatch<React.SetStateAction<GenerationSettings>>;
  remeshSettings: RemeshSettings;
  setRemeshSettings: React.Dispatch<React.SetStateAction<RemeshSettings>>;
  textureSettings: TextureSettings;
  setTextureSettings: React.Dispatch<React.SetStateAction<TextureSettings>>;
  sculptSettings: SculptSettings;
  setSculptSettings: React.Dispatch<React.SetStateAction<SculptSettings>>;
  paintBrushSettings: PaintBrushSettings;
  setPaintBrushSettings: React.Dispatch<React.SetStateAction<PaintBrushSettings>>;
  generate3DModel: () => Promise<void>;
  runModelGeneration: () => Promise<void>;
  runRemeshGeneration: () => Promise<void>;
  runTextureGeneration: () => Promise<void>;
  runUVUnwrapGeneration: (customSettings?: { distortionThreshold?: number; packMethod?: string; outputFormat?: string; saveIndividualParts?: boolean; modelParameters?: Record<string, any> }) => Promise<void>;
  runSegmentation: (customSettings?: { numParts?: number; method?: string; hierarchical?: boolean; outputFormat?: string; modelParameters?: Record<string, any>; modelPreference?: string } | number) => Promise<void>;
  runMeshEditing: (customSettings?: { sourcePrompt?: string; targetPrompt?: string; resolution?: number; bbox?: any; outputFormat?: string; mode?: 'text' | 'image'; targetImageFileId?: string; targetImageBase64?: string; strength?: number }) => Promise<void>;
  refineMesh: (opts?: { meshPath?: string; imagePath?: string; resolution?: number }) => Promise<void>;
  processBatchQueue: () => Promise<void>;
  cancelBatchProcessing: () => Promise<void>;
  retryFailedBatchItems: () => Promise<void>;
  dismissJob: (jobId: string) => void;
  selectJobToView: (jobId: string) => void;
  queueGenerationJob: (customSettings?: Partial<GenerationSettings>) => Promise<string | null>;
  navigateToTool: (tool: ToolType) => void;
  navigateToMain: (nav: MainNavRoute) => void;
  navigateToMainNav: (nav: MainNavRoute) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const TOOL_TO_ROUTE: Record<ToolType, string> = {
  tools: '/workspace/tools',
  model: '/workspace/generate',
  remesh: '/workspace/remesh',
  texture: '/workspace/texture',
  uv: '/workspace/uv',
  segment: '/workspace/segment',
  edit: '/workspace/edit',
  pbr: '/workspace/tools',
  environment: '/workspace/generate',
  animation: '/workspace/animation',
  rigging: '/workspace/rigging',
};

async function parseApiData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (payload?.success === false) {
    throw new Error(payload?.message || 'Backend request failed');
  }
  return (payload?.data ?? payload) as T;
}

async function parseApiError(response: Response): Promise<Error> {
  try {
    const payload = await response.json();
    return new Error(payload?.detail || payload?.message || `Backend returned HTTP ${response.status}`);
  } catch {
    return new Error(`Backend returned HTTP ${response.status}`);
  }
}

// ── Real backend (3DAIGC-API) job contract ────────────────────────────────
// Submit: POST /api/v1/mesh-generation/{text,image}-to-{raw,textured}-mesh
//   → { job_id, status, message }
// Status: GET /api/v1/system/jobs/{job_id}
//   → { job_id, status: queued|processing|completed|failed|cancelled,
//       progress: 0..1 fraction, result: { mesh_url, thumbnail_url, ... },
//       error: string|null }
// Backend result URLs may be absolute or relative; rewrite them to the
// same-origin /api/v1 proxy path so the browser can always reach them.
const toProxyUrl = normalizeBackendAssetUrl;


interface BackendJobPayload {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  stage?: string;
  message?: string;
  logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
  metadata?: { logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[] };
  result?: Record<string, any>;
  error?: string | null;
  error_code?: string;
}

function previewSourceUrl(result?: Record<string, any>): string | undefined {
  const source = result?.source_model_url || result?.high_fidelity_url || result?.artifacts?.source;
  return typeof source === 'string' ? source : (typeof source?.url === 'string' ? source.url : undefined);
}

function isNativeRawPreview(result?: Record<string, any>): boolean {
  const target = Number(result?.target_polycount ?? result?.requested_target_polycount);
  return Boolean(result && Number.isFinite(target) && target <= 0 && previewSourceUrl(result));
}

function preferredGenerationPreviewUrl(result?: Record<string, any>): string | undefined {
  if (isNativeRawPreview(result)) return previewSourceUrl(result);
  return result?.active_model_url || result?.textured_model_url || result?.model_url || result?.mesh_url || result?.url;
}

function preferredPreviewStats(result?: Record<string, any>): Record<string, any> {
  return isNativeRawPreview(result)
    ? (result?.quality_trace?.source || {})
    : (result?.quality_trace?.game_ready || {});
}

function normalizeBackendJob(raw: BackendJobPayload) {
  const rawProgress = Number(raw.progress ?? 0);
  const normalizedProgress = rawProgress <= 1 ? rawProgress * 100 : rawProgress;
  // Prefer the canonical game-ready GLB URL; mesh_url is the legacy raw path
  const modelUrl = toProxyUrl(raw.result?.model_url ?? raw.result?.mesh_url);
  const activeModelUrl = toProxyUrl(
    raw.result?.active_model_url ?? raw.result?.textured_model_url ?? raw.result?.model_url ?? raw.result?.mesh_url
  );
  const texturedModelUrl = raw.result?.textured_model_url
    ? toProxyUrl(raw.result.textured_model_url)
    : undefined;
  const sourceModelUrl = previewSourceUrl(raw.result)
    ? toProxyUrl(previewSourceUrl(raw.result)!)
    : undefined;
  return {
    status: raw.status,
    progress: Math.max(0, Math.min(100, Math.round(normalizedProgress))),
    stage: raw.stage || raw.status,
    message: raw.message || (raw.status === 'processing' ? 'Processing' : raw.status === 'queued' ? 'Queued' : undefined),
    error_message: typeof raw.error === 'string' ? raw.error : undefined,
    error_code: raw.error_code,
    logs: Array.isArray(raw.logs)
      ? raw.logs
      : Array.isArray(raw.metadata?.logs)
        ? raw.metadata.logs
        : undefined,
    result: raw.result ? {
      ...raw.result,
      ...(modelUrl ? { model_url: modelUrl } : {}),
      ...(activeModelUrl ? { active_model_url: activeModelUrl } : {}),
      ...(texturedModelUrl ? { textured_model_url: texturedModelUrl } : {}),
      ...(sourceModelUrl ? { source_model_url: sourceModelUrl, high_fidelity_url: sourceModelUrl } : {}),
      ...(raw.result.thumbnail_url ? { thumbnail_url: toProxyUrl(raw.result.thumbnail_url) } : {}),
    } : undefined,
  } as {
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    stage: string;
    message?: string;
    error_message?: string;
    logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
    result?: (Record<string, any> & {
      model_url?: string;
      active_model_url?: string;
      textured_model_url?: string;
      thumbnail_url?: string;
    }) | undefined;
  };
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const appStore = useAppStore();
  const updateBatchItem = useAppStore((state) => state.updateBatchItem);
  const viewerStore = useViewerStore();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTool, setActiveToolState] = useState<ToolType>('model');
  const [mainNav, setMainNavState] = useState<MainNavRoute>('workspace');
  const [activeRightTab, setActiveRightTab] = useState<'assets' | 'property' | 'properties' | 'prompt'>('properties');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [assetFilter, setAssetFilter] = useState<string>('all');
   const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(() => new Set());
   const batchJobIdMap = useRef<Record<string, string>>({}); // Maps jobId to batchQueueItemId
   const batchPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
   
   // React Query for System Stats
  const { data: polledSystemStats, refetch: queryRefetchSystemStats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: async () => {
      const stats = await apiClient.getSystemStats();
      return stats as unknown as SystemStats;
    },
    refetchInterval: 5000, // Refresh resource telemetry every 5s
    staleTime: 10000,
  });

  const refreshSystemStats = useCallback(async () => {
    await queryRefetchSystemStats();
  }, [queryRefetchSystemStats]);

  const [localAssets, setLocalAssets] = useState<ModelAsset[]>([]);

  // React Query for History
  const { data: historyAssets, isLoading: isHistoryLoading } = useQuery({
    queryKey: ['history-assets'],
    queryFn: async () => {
      const history = await apiClient.getHistory() as Record<string, any>;
      return Object.entries(history).filter(([, h]) => h.status?.completed).map(([id, h], i) => {
        const rawPrompt = (h.prompt?.[1] as string)?.trim();
        const promptName = rawPrompt && !rawPrompt.startsWith('workflow:') && rawPrompt !== 'generate'
          ? (rawPrompt.charAt(0).toUpperCase() + rawPrompt.slice(1)).slice(0, 40)
          : null;
        const name = promptName || `Model_${id.slice(0, 8)}`;
        const outputs = (h.outputs || {}) as Record<string, any>;
        const outputUrl = toProxyUrl(preferredGenerationPreviewUrl(outputs) || (outputs.glb as string) || (outputs.model_url as string) || (outputs.download_url as string) || `/api/v1/system/jobs/${id}/download?artifact_format=glb`);
        return normalizeModelAsset({
          id: id || `hist-${i}`,
          name,
          category: 'generation',
          thumbnail: (outputs.thumbnail as string) || (outputs.thumbnail_url as string) || '',
          source: { filename: `${id}.glb`, subfolder: 'generated', type: 'output', viewUrl: outputUrl, fileId: `job-${id}` },
          meshType: 'custom',
          polygon_count: outputs.polygon_count,
          vertex_count: outputs.vertex_count,
          faces: outputs.polygon_count ?? outputs.faces,
          vertices: outputs.vertex_count ?? outputs.vertices,
          triangles: outputs.polygon_count ?? outputs.triangles,
          statsAvailable: outputs.statsAvailable ?? ((outputs.polygon_count ?? 0) > 0 || (outputs.vertex_count ?? 0) > 0),
          topology: outputs.topology || 'Triangle',
          format: outputs.format || 'GLB',
          dimensions: outputs.dimensions,
          boundingBox: outputs.bounding_box || outputs.boundingBox,
          objectCount: outputs.object_count ?? outputs.objectCount,
          componentCount: outputs.component_count ?? outputs.componentCount,
          materialCount: outputs.material_count ?? outputs.materialCount,
          meshDetails: outputs.mesh_details || outputs.meshDetails,
           postprocessStatus: outputs.production_status || outputs.postprocess_status || 'unknown',
          dateCreated: '',
          tags: ['AI Generated'],
          materials: [],
          model_url: outputUrl,
          game_ready_url: (outputs.game_ready_url as string) || outputUrl,
          source_model_url: (outputs.source_model_url as string) || (outputs.source as string) || undefined,
          collision_url: outputs.collision_url,
          physics_url: outputs.physics_url,
          physics_ready: outputs.physics_ready,
          physics: outputs.physics,
          pbr_maps: outputs.pbr_maps,
          game_ready_formats: outputs.game_ready_formats,
          zip_url: outputs.zip_url,
          qa_report: outputs.qa_report,
          quality_trace: outputs.quality_trace,
          artifacts: outputs.artifacts,
        });
      }) as ModelAsset[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // React Query for Uploaded Assets
  const { data: uploadedAssets, isLoading: isUploadedLoading } = useQuery({
    queryKey: ['uploaded-assets'],
    queryFn: async () => {
      const res = await fetch('/api/v1/file-upload/list');
      if (!res.ok) return [];
      const data = await res.json();
      const files = data?.files || [];
      return files.map((m: any) => {
        const cleanName = m.filename?.replace(/\.[^.]+$/, '') || '3D Model';
        const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        const ext = m.filename?.split('.').pop()?.toUpperCase() || (m.file_type === 'mesh' ? 'GLB' : 'GLB');
        const viewUrl = m.file_id ? `/api/v1/file-upload/download/${m.file_id}` : '';
        const thumbUrl = m.thumbnail_url || (m.file_id ? `/api/v1/file-upload/thumbnail/${m.file_id}` : '');
        return normalizeModelAsset({
          id: m.file_id || m.filename,
          fileId: m.file_id,
          name: formattedName,
          category: 'mesh',
          meshType: 'custom',
          thumbnail: thumbUrl,
          polygon_count: 0,
          vertex_count: 0,
          faces: 0,
          vertices: 0,
          triangles: 0,
          statsAvailable: false,
          source: { filename: m.filename, subfolder: '', type: 'upload', viewUrl },
          topology: 'Triangle',
          format: ext,
          dateCreated: m.upload_time || '',
          tags: ['Uploaded', 'Model'],
        });
      }) as ModelAsset[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const [assets, setAssets] = useState<ModelAsset[]>([]);

  // Merge assets
  useEffect(() => {
    const history = historyAssets || [];
    const uploaded = uploadedAssets || [];
    const local = localAssets;

    setAssets(prevAssets => {
      // Prioritize local session assets, then uploaded, then history
      // When merging, preserve authoritative metadata from prevAssets if incoming has statsAvailable: false
      const prevMap = new Map((prevAssets || []).map(a => [a.id, a]));
      const all = [...local, ...uploaded, ...history].map(rawItem => {
        const a = normalizeModelAsset(rawItem);
        // Add prefix to IDs to prevent collisions (MED-002)
        if (local.includes(rawItem as any)) {
          a.id = `local_${a.id}`;
        } else if (uploaded.includes(rawItem as any)) {
          a.id = `upload_${a.id}`;
        } else if (history.includes(rawItem as any)) {
          a.id = `hist_${a.id}`;
        }
        a.sourceType = local.includes(rawItem as any) ? 'local' : (uploaded.includes(rawItem as any) ? 'upload' : 'history');
        const existing = prevMap.get(a.id);
        if (existing && existing.statsAvailable && !a.statsAvailable) {
          return {
            ...a,
            faces: existing.faces,
            vertices: existing.vertices,
            triangles: existing.triangles,
            statsAvailable: true,
            dimensions: existing.dimensions || a.dimensions,
            boundingBox: existing.boundingBox || a.boundingBox,
            objectCount: existing.objectCount ?? a.objectCount,
            componentCount: existing.componentCount ?? a.componentCount,
            materialCount: existing.materialCount ?? a.materialCount,
            topology: existing.topology || a.topology,
            meshDetails: existing.meshDetails || a.meshDetails,
          };
        }
        return a;
      });
      const seenIds = new Set<string>();
      const seenFilenames = new Set<string>();
      const seenUrls = new Set<string>();

      const filtered = all.filter(a => {
        if (!a || !a.id) return false;
        if (deletedAssetIds.has(a.id)) return false;
        if (seenIds.has(a.id)) return false;

        const fn = a.source?.filename?.trim();
        if (fn && fn !== 'model.glb' && seenFilenames.has(fn)) return false;

        const rawUrl = a.source?.viewUrl || a.source?.localUrl;
        const normUrl = rawUrl?.replace(/^\/+/, '')?.toLowerCase();
        if (normUrl && seenUrls.has(normUrl)) return false;

        seenIds.add(a.id);
        if (fn && fn !== 'model.glb') seenFilenames.add(fn);
        if (normUrl) seenUrls.add(normUrl);
        return true;
      });

      let currentSelected = selectedAssetIdRef.current;
      
      // If the selected ID is raw but the asset now has a prefix, update the selected ID to the prefixed one.
      if (currentSelected && !filtered.some(a => a.id === currentSelected)) {
        const matchingPrefixed = filtered.find(a => a.id.replace(/^(hist_|local_|upload_)/, '') === currentSelected);
        if (matchingPrefixed) {
          currentSelected = matchingPrefixed.id;
          setSelectedAssetId(currentSelected);
        }
      }

      if ((!currentSelected || !filtered.some(a => a.id === currentSelected)) && filtered.length > 0) {
        setSelectedAssetId(filtered[0].id);
      } else if (filtered.length === 0) {
        setSelectedAssetId(null);
      }
      return filtered;
    });
  }, [historyAssets, uploadedAssets, localAssets, deletedAssetIds]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/workspace/')) {
        const parts = path.replace('/workspace/', '').split('/');
        if (parts.length > 1 && parts[1]) {
           return parts[1];
        }
      }
    }
    return null;
  });
  const selectedAssetIdRef = useRef(selectedAssetId);
  const mainNavRef = useRef(mainNav);
  const activeToolRef = useRef(activeTool);

  const [shadingMode, setShadingModeState] = useState<ShadingMode>('textured');
  const [showWireframe, setShowWireframeState] = useState(false);
  const [showGrid, setShowGridState] = useState(false);
  const [showBones, setShowBonesState] = useState(false);
  const [isTurntable, setIsTurntableState] = useState(appStore.viewer?.autoRotate ?? false);
  const [activeTransformTool, setActiveTransformTool] = useState<'select' | 'rotate' | 'pan' | 'frame'>('select');
  const [viewportResetTrigger, setViewportResetTrigger] = useState(0);

  const systemStats = useMemo(() => polledSystemStats || ({
    status: 'offline' as const, host: '/api/v1', gpu: 'Unavailable',
    vramUsedGb: null, vramTotalGb: null, ramUsedGb: null, ramTotalGb: null,
    torchVramUsedGb: null, torchVramTotalGb: null, gpuType: null, gpuIndex: null,
    pythonVersion: null, torchVersion: null, apiVersion: null,
    queueRunning: 0, queuePending: 0, activePromptId: null, activeNode: null, lastPingMs: 0,
  } as SystemStats), [polledSystemStats]);
  const systemStatsStatusRef = useRef(systemStats.status);

  useEffect(() => {
    if (polledSystemStats?.status === 'offline' && systemStatsStatusRef.current !== 'offline') {
      toast.warning('Backend is offline', {
        description: 'Unable to sync with the generation engine. Check your connection.',
      });
    }
    systemStatsStatusRef.current = systemStats.status;
  }, [polledSystemStats, systemStats.status]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isDccBridgeOpen, setIsDccBridgeOpen] = useState(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionStep, setExecutionStep] = useState('');
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [jobsById, setJobsById] = useState<Record<string, ActiveTask>>({});
  const [comparisonGroups, setComparisonGroups] = useState<Record<string, ComparisonGroup>>({});
  const [activeComparisonGroup, setActiveComparisonGroup] = useState<string | null>(null);
  const [nextComparisonGroupId, setNextComparisonGroupId] = useState(1);
  const jobsByIdRef = useRef(jobsById);
  jobsByIdRef.current = jobsById;
  const activeTaskRef = useRef<ActiveTask | null>(activeTask);
  activeTaskRef.current = activeTask;

  const dismissActiveTask = useCallback(() => setActiveTask(null), []);

    const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(() => ({
      mode: 'image-to-3d',
      image: null,
      aiModel: '',
      textureQuality: 'high',
      quadTopology: false, topologyMode: 'triangle', seed: Math.floor(Math.random() * 900000) + 100000, removeBackground: false,
      autoOptimizeSettings: { targetPolycount: 0 },
      highResolutionNormalBaking: true,
      generateTexture: true,
      generateCollision: true,
      generateLOD: false,
      lodPreset: "high",
      lodCount: 4,
      intent: undefined,
      preprocessingArtifactId: null,
      preprocessingReviewOverride: false,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
      enhancementEnabled: false,
      enablePrintabilityCheck: false,
      enableAutoRepair: false,
      enableAutoRig: false,
      autoRigMode: 'full',
      enablePostprocess: true,
      candidateCount: 1,
      partCountRange: '1',
      rigType: 'none',
      exportFormats: ['glb'],
      slicerHandoff: false,
      physics: { ...DEFAULT_PHYSICS_SETTINGS },
    }));
 
   const [comparisonGroupId, setComparisonGroupId] = useState<string | null>(null);
 
   const [remeshSettings, setRemeshSettings] = useState<RemeshSettings>({
    tab: 'auto', variant: 'V4K', polyType: 'quad', targetPolycount: 50000,
  });

  const [textureSettings, setTextureSettings] = useState<TextureSettings>({
    workflow: 'texture', mode: 'ai', style: 'realistic', resolution: '4K',
    paintResolution: 512,
    referenceImage: null,
    prompt: '',
    modelId: '',
    maps: { albedo: true, normal: true, roughness: true, metallic: true, ao: true, height: false },
  });

  const [sculptSettings, setSculptSettings] = useState<SculptSettings>({
    brush: 'standard',
    radius: 0.15,
    strength: 0.50,
    hardness: 0.50,
    spacing: 0.10,
    direction: 1,
    frontOnly: true,
    symmetry: { x: true, y: false, z: false },
    steadyStroke: 0.20,
    autoSmooth: 0.10,
  });

  const [paintBrushSettings, setPaintBrushSettings] = useState<PaintBrushSettings>({
    color: '#FFCC00',
    size: 24,
    opacity: 1.0,
    flow: 0.8,
    hardness: 0.8,
    shape: 'round',
    blendMode: 'normal',
  });

  const [environmentSettings, setEnvironmentSettings] = useState<EnvironmentSettings>({
    ambientIntensity: 2.5,
    keyLightIntensity: 3.5,
    fillLightIntensity: 3.0,
    rimLightIntensity: 2.0,
    exposure: 2.0,
    gridVisible: false,
    gridColor: '#222222',
    backgroundColor: '#0a0a0a',
    autoRotate: false,
    showAxes: false,
    showStats: true,
  });

   const [modelDetails, setModelDetails] = useState<Record<string, any>>({});

  useEffect(() => {
    getApiClient().getAvailableModels().then(data => {
      if ((data as any)?.model_details) {
        setModelDetails((data as any).model_details);
      }
    }).catch(err => {
      console.warn('Failed to load model details:', err);
    });
  }, []);

  const currentAsset = useMemo(
    () => selectedAssetId ? (assets.find(a => a.id === selectedAssetId) ?? null) : null,
    [assets, selectedAssetId]
  );
  const currentAssetRef = useRef(currentAsset);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
    currentAssetRef.current = currentAsset;
    mainNavRef.current = mainNav;
    activeToolRef.current = activeTool;
    systemStatsStatusRef.current = systemStats.status;
  }, [selectedAssetId, currentAsset, mainNav, activeTool, systemStats.status]);

  // Hydrate job from URL /workspace/[tool]/[job_id] if present so failed or running status is never lost
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    if (!path.startsWith('/workspace/')) return;
    const parts = path.replace('/workspace/', '').split('/');
    if (parts.length < 2 || !parts[1]) return;
    const routeJobId = parts[1];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeJobId);
    if (!isUuid) return;

    if (!jobsByIdRef.current[routeJobId] && !activeTaskRef.current) {
      let cancelled = false;
      fetch(`/api/v1/system/jobs/${encodeURIComponent(routeJobId)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(payload => {
          if (cancelled || !payload) return;
          const raw = payload?.data ?? payload;
          if (!raw) return;
          const data = normalizeBackendJob(raw);
          const nextStatus: ActiveTask['status'] = data.status === 'completed' ? 'completed'
            : data.status === 'failed' ? 'failed'
            : data.status === 'cancelled' ? 'interrupted'
            : data.status === 'queued' ? 'queued'
            : 'running';
          const currentMessage = data.message || (data.status === 'processing' ? 'Processing...' : data.status === 'failed' ? 'Process failed' : 'Queued on backend');
          const diagnostic = (data.status === 'failed' || data.status === 'cancelled') ? diagnoseJobError({
            id: routeJobId,
            status: data.status,
            error: data.error_message,
            error_message: data.error_message,
            model_id: (raw as any)?.model_id || (raw as any)?.model_preference,
            provider: (raw as any)?.model_id || (raw as any)?.model_preference,
          } as any) : undefined;

          const hydratedTask: ActiveTask = {
            id: routeJobId,
            isLocal: false,
            type: 'image-to-3d',
            title: (raw as any)?.metadata?.asset_name || (raw as any)?.inputs?.asset_name || `Job_${routeJobId.slice(0, 6)}`,
            startedAt: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
            status: nextStatus,
            progress: data.progress,
            stage: data.stage,
            currentStep: currentMessage,
            provider: (raw as any)?.model_id || (raw as any)?.model_preference,
            errorMessage: data.error_message,
            errorCode: (data as any).error_code,
            diagnostic,
            logs: data.logs,
            result: data.result,
          };

          setJobsById(prev => ({ ...prev, [routeJobId]: hydratedTask }));
          setActiveTask(hydratedTask);
          if (nextStatus === 'running' || nextStatus === 'queued') {
            setIsExecuting(true);
            setExecutionProgress(data.progress);
            setExecutionStep(currentMessage);
          } else {
            setIsExecuting(false);
          }
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }
  }, []);

  useEffect(() => {
    if (activeTool === 'remesh') setShowWireframeState(true);
  }, [activeTool]);

  const setActiveTool = useCallback((tool: ToolType) => {
    setActiveToolState(tool);
  }, []);

  const setMainNav = useCallback((nav: MainNavRoute) => {
    setMainNavState(nav);
  }, []);

  const setShadingMode = useCallback((mode: ShadingMode) => {
    setShadingModeState(mode);
    viewerStore.setShadingMode(shadingModeToPreset(mode));
  }, [viewerStore]);

  const setShowWireframe = useCallback((show: boolean) => {
    setShowWireframeState(show);
    useViewerStore.setState({ wireframeOverlay: show });
  }, []);

  const setShowGrid = useCallback((show: boolean) => {
    setShowGridState(show);
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, showGrid: show } }));
  }, []);

  const setShowBones = useCallback((show: boolean) => setShowBonesState(show), []);

  const setIsTurntable = useCallback((val: boolean) => {
    setIsTurntableState(val);
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, autoRotate: val } }));
  }, []);

  useEffect(() => {
    const onProgress = (data: unknown) => {
      const d = data as { value?: number; max?: number; node?: string };
      const progress = (d.max && d.max > 0) ? Math.min(100, Math.round(((d.value ?? 0) / d.max) * 100)) : 0;
      setExecutionProgress(progress);
      setActiveTask(prev => prev ? { ...prev, status: 'running', progress, activeNode: d.node ?? prev.activeNode, currentStep: d.node ? `Executing ${d.node}` : prev.currentStep } : prev);
    };
    const onExecuting = (data: unknown) => {
      const d = data as { node?: string };
      setIsExecuting(!!d.node);
      setExecutionStep(d.node ? `Executing ${d.node}` : '');
    };
    const onExecuted = () => {
      setIsExecuting(false);
      setExecutionProgress(100);
      setExecutionStep('Completed');
      setActiveTask(prev => prev ? { ...prev, status: 'completed', progress: 100, currentStep: 'Completed' } : prev);
      toast.success('Process completed successfully', {
        description: activeTaskRef.current?.title || '3D Asset Generation finished',
      });
    };
    const onError = (data: unknown) => {
      const d = data as { exception_message?: string; message?: string };
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep(d.exception_message || d.message || 'Error');
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: d.exception_message || 'Error' } : prev);
      toast.error('Process failed', {
        description: d.exception_message || d.message || 'An error occurred during execution',
      });
    };
     const off1 = apiClient.on('progress', onProgress);
     const off2 = apiClient.on('executing', onExecuting);
     const off3 = apiClient.on('executed', onExecuted);
     const off4 = apiClient.on('execution_error', onError);
     return () => { off1(); off2(); off3(); off4(); };
   }, []);
    // Poll batch job statuses periodically
    useEffect(() => {
      const { batchQueue } = appStore;
     
     // Check if we have any batch jobs that need monitoring
     const hasBatchJobs = batchQueue.some(item => 
       item.status === 'running' && item.jobId
     );
     
     if (!hasBatchJobs) {
       // Clean up any existing polling interval
       if (batchPollingIntervalRef.current) {
         clearInterval(batchPollingIntervalRef.current);
         batchPollingIntervalRef.current = null;
       }
       return;
     }
     
     // Set up polling interval if not already set
     if (!batchPollingIntervalRef.current) {
       batchPollingIntervalRef.current = setInterval(async () => {
         try {
           // Get all unique job IDs from batch queue items that are running
             const jobIds = Array.from(new Set(
               batchQueue
                 .filter(item => item.status === 'running' && item.jobId)
                 .map(item => item.jobId)
                 .filter((id): id is string => id !== null && id !== undefined)
             ));
             
             // For each job ID, check its status
             for (const jobId of jobIds) {
               try {
                 const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(jobId)}`);
                 if (!res.ok) {
                   // If we can't fetch the job, it might have been cleaned up
                   // Find and remove any batch queue items referencing this job ID
                   batchQueue.forEach(item => {
                     if (item.jobId === jobId) {
                       updateBatchItem(item.id, {
                         status: 'failed',
                         error: 'Job tracking lost',
                         completedAt: new Date(),
                       });
                       // Clean up the job ID map
                       delete batchJobIdMap.current[jobId];
                     }
                   });
                   continue;
                 }
                 
                 const payload = await res.json();
                 const raw = payload?.data ?? payload;
                 if (!raw) continue;
                 
                 const data = normalizeBackendJob(raw);
                 
                 // Find the batch queue item associated with this job
                 const batchQueueItemId = batchJobIdMap.current[jobId];
                 if (!batchQueueItemId) continue;
                 
                 // Prepare updates for the batch queue item
                 const batchUpdates: Partial<BatchQueueItem> = {
                   progress: data.progress,
                 };
                 
                 // Update status based on job status
                 if (data.status === 'completed') {
                   batchUpdates.status = 'completed';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'failed') {
                   batchUpdates.status = 'failed';
                   batchUpdates.error = data.error_message || 'Unknown error';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'cancelled') {
                   batchUpdates.status = 'cancelled';
                   batchUpdates.error = 'Job cancelled';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'processing' || data.status === 'queued') {
                   batchUpdates.status = 'running';
                 }
                 
                 // Update the batch queue item
                 updateBatchItem(batchQueueItemId, batchUpdates);
                 
                 // Clean up completed/failed/cancelled jobs from tracking
                 if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                   delete batchJobIdMap.current[jobId];
                 }
               } catch (err) {
                 console.error('Error polling batch job status:', err);
                 // Continue with other jobs
               }
             }
         } catch (err) {
           console.error('Error in batch job polling loop:', err);
         }
       }, 5000); // Poll every 5 seconds
     }
     
     // Cleanup function
     return () => {
       if (batchPollingIntervalRef.current) {
         clearInterval(batchPollingIntervalRef.current);
         batchPollingIntervalRef.current = null;
       }
        // Clear the job ID map
        batchJobIdMap.current = {};
      };
    }, [useAppStore]);
    const addAsset = useCallback((asset: ModelAsset) => {
    setLocalAssets(prev => {
      const idx = prev.findIndex(a =>
        a.id === asset.id ||
        (asset.source?.filename && a.source?.filename && asset.source.filename !== 'model.glb' && a.source.filename === asset.source.filename) ||
        (asset.source?.viewUrl && a.source?.viewUrl && asset.source.viewUrl === a.source.viewUrl)
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...asset };
        return copy;
      }
      return [asset, ...prev];
    });
    setAssets(prev => {
      const idx = prev.findIndex(a =>
        a.id === asset.id ||
        (asset.source?.filename && a.source?.filename && asset.source.filename !== 'model.glb' && a.source.filename === asset.source.filename) ||
        (asset.source?.viewUrl && a.source?.viewUrl && asset.source.viewUrl === a.source.viewUrl)
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...asset };
        return copy;
      }
      return [asset, ...prev];
    });
    setSelectedAssetId(asset.id);
    setViewportResetTrigger(prev => prev + 1);
  }, []);

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

  // Poll all active jobs in jobsById from backend so each queued/running job updates in real time
  useEffect(() => {
    const activeJobEntries = Object.entries(jobsById).filter(([id, task]) => {
      const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted';
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      return !isTerminal && isUuid && !task.isLocal;
    });

    if (activeJobEntries.length === 0) {
      return;
    }

    let stopped = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        await Promise.all(
          activeJobEntries.map(async ([jobId, task]) => {
            try {
              const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(jobId)}`);
              if (!res.ok) return;
              const payload = await res.json();
              const raw = payload?.data ?? payload;
              if (!raw || stopped) return;

              const data = normalizeBackendJob(raw);
              const progress = data.progress;
              const currentMessage = data.message || (data.status === 'processing' ? 'Processing...' : 'Queued on backend');

              const nextStatus = data.status === 'completed' ? 'completed'
                : data.status === 'failed' ? 'failed'
                : data.status === 'cancelled' ? 'interrupted'
                : 'running';

              setJobsById(prev => {
                const existing = prev[jobId];
                if (!existing) return prev;
                return {
                  ...prev,
                  [jobId]: {
                    ...existing,
                    status: nextStatus,
                    progress,
                    stage: data.stage || existing.stage,
                    currentStep: currentMessage,
                    errorMessage: data.error_message || existing.errorMessage,
                    errorCode: (data as any).error_code || existing.errorCode,
                    logs: data.logs || existing.logs,
                    result: data.result || existing.result,
                  }
                };
              });

              if (activeTaskRef.current?.id === jobId) {
                setExecutionProgress(progress);
                setExecutionStep(currentMessage);
                const diagnostic = (nextStatus === 'failed' || nextStatus === 'interrupted') ? diagnoseJobError({
                  id: jobId,
                  status: data.status,
                  error: data.error_message,
                  error_message: data.error_message,
                  model_id: (task as any)?.provider || (data as any)?.model_id,
                  provider: (task as any)?.provider || (data as any)?.model_id,
                } as any) : undefined;
                setActiveTask(prev => prev && prev.id === jobId ? {
                  ...prev,
                  status: nextStatus,
                  progress,
                  stage: data.stage,
                  currentStep: currentMessage,
                  errorMessage: data.error_message || prev.errorMessage,
                  errorCode: (data as any).error_code || prev.errorCode,
                  diagnostic: diagnostic || prev.diagnostic,
                  logs: data.logs || prev.logs,
                  result: data.result || prev.result,
                } : prev);
              }

               if (data.status === 'completed' && task.status !== 'completed') {
                 const result = data.result || {};
                 const productionStatus = result.production_status || (result.postprocess_status === 'degraded' ? 'degraded' : 'ready');
                 const degradedReasons = result.degraded_reasons || (result.texture_stage?.status === 'failed' ? ['texture_generation_failed'] : []);
                 let description = task.title || '3D Asset ready';
                 if (productionStatus === 'ready') {
                   toast.success('Generation complete', { description });
                 } else if (productionStatus === 'degraded') {
                   const reasons = degradedReasons.length > 0 ? degradedReasons.join(', ') : 'quality or texture issue';
                   toast.warning('Generation completed with issues', {
                     description: `${description} (${reasons})`,
                   });
                 } else if (productionStatus === 'failed') {
                   toast.error('Generation failed', {
                     description: task.title || '3D Asset failed',
                   });
                 }

                 taskPersistence.addNotification({
                   title: task.title ? `${task.title} Completed` : '3D Generation Completed',
                   description,
                   status: productionStatus === 'failed' ? 'failed' : 'completed',
                   jobId,
                   assetId: jobId,
                 });

                if (result?.model_url || result?.active_model_url || result?.textured_model_url || result?.source_model_url) {
                  const modelUrl = preferredGenerationPreviewUrl(result) as string;
                  const previewStats = preferredPreviewStats(result);
                  const promptTitle = task.title;
                  const cleanName = promptTitle && promptTitle !== 'generate' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
                  void prefetchGLB(modelUrl);
                  const outputAsset = normalizeModelAsset({
                    id: jobId,
                    name: cleanName,
                    category: 'generation',
                    thumbnail: result.thumbnail_url || task.inputImage || '',
                    source: { filename: `${cleanName}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl, fileId: `job-${jobId}` },
                    polygon_count: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
                    vertex_count: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
                    faces: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
                    vertices: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
                    triangles: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
                    statsAvailable: Boolean(previewStats.faces || result.polygon_count || previewStats.vertices || result.vertex_count),
                    topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
                    format: 'GLB',
                    postprocessStatus: productionStatus === 'degraded' ? 'degraded' : (result.production_status || result.postprocess_status || 'completed'),
                    productionStatus,
                    degradedReasons,
                    game_ready_url: (result.game_ready_url as string) || modelUrl,
                    source_model_url: (result.source_model_url as string) || (result.high_fidelity_url as string) || undefined,
                    tags: ['AI Generated'],
                    collision_url: result.collision_url,
                    physics_url: result.physics_url,
                    physics_ready: result.physics_ready,
                    physics: result.physics,
                    pbr_maps: result.pbr_maps,
                    game_ready_formats: result.game_ready_formats,
                    zip_url: result.zip_url,
                    qa_report: result.qa_report,
                    quality_trace: result.quality_trace,
                    artifacts: result.artifacts,
                    candidates: result.candidates,
                  });
                  addAsset(outputAsset);
                  if (!activeTaskRef.current || activeTaskRef.current.id === jobId || !selectedAssetId) {
                    setSelectedAssetId(outputAsset.id);
                    setViewportResetTrigger(prev => prev + 1);
                    loadModelInViewer(modelUrl, cleanName, outputAsset as any);
                  }
                }
              } else if ((data.status === 'failed' || data.status === 'cancelled') && task.status !== 'failed' && task.status !== 'interrupted') {
                const errMsg = data.error_message || 'The job encountered an error during execution';
                toast.error('Process failed', { description: errMsg });
                taskPersistence.addNotification({
                  title: task.title ? `${task.title} Failed` : 'Job Failed',
                  description: errMsg,
                  status: 'failed',
                  jobId,
                });
              }
            } catch (jobErr) {
              // ignore single job polling error
            }
          })
        );

        // Update overall isExecuting
        const hasRemainingActive = Object.values(jobsByIdRef.current).some(
          j => j.status === 'queued' || j.status === 'running'
        );
        if (!hasRemainingActive) {
          setIsExecuting(false);
        }

        if (!stopped) {
          timerId = setTimeout(poll, document.visibilityState === 'hidden' ? 3000 : 1200);
        }
      } catch (err) {
        if (!stopped) {
          timerId = setTimeout(poll, 3000);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [jobsById, addAsset]);

  const dismissJob = useCallback((jobId: string) => {
    setJobsById(prev => {
      const copy = { ...prev };
      delete copy[jobId];
      return copy;
    });
    if (activeTaskRef.current?.id === jobId) {
      setActiveTask(null);
      setIsExecuting(false);
      setExecutionStep('');
    }
  }, []);

  const selectJobToView = useCallback((jobId: string) => {
    const job = jobsByIdRef.current[jobId] || (activeTaskRef.current?.id === jobId ? activeTaskRef.current : null);
    if (!job) return;

    if (typeof window !== 'undefined') {
      const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${jobId}`);
    }

    const result = (job.result || {}) as Record<string, any>;
    const modelUrl = preferredGenerationPreviewUrl(result);
    const previewStats = preferredPreviewStats(result);
    if (modelUrl) {
      const promptTitle = job.title;
      const cleanName = promptTitle && promptTitle !== 'generate' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
      void prefetchGLB(modelUrl);
      const outputAsset = normalizeModelAsset({
        id: jobId,
        name: cleanName,
        category: 'generation',
        thumbnail: result.thumbnail_url || job.inputImage || '',
        source: { filename: `${cleanName}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl, fileId: `job-${jobId}` },
        polygon_count: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertex_count: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        faces: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertices: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        triangles: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        statsAvailable: Boolean(previewStats.faces || result.polygon_count || previewStats.vertices || result.vertex_count),
        topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
        format: 'GLB',
        postprocessStatus: result.production_status === 'degraded' ? 'degraded' : (result.production_status || result.postprocess_status || 'completed'),
        productionStatus: result.production_status || (result.postprocess_status === 'degraded' ? 'degraded' : 'ready'),
        degradedReasons: result.degraded_reasons,
        game_ready_url: (result.game_ready_url as string) || modelUrl,
        source_model_url: (result.source_model_url as string) || (result.high_fidelity_url as string) || undefined,
        tags: ['AI Generated'],
        candidates: result.candidates,
      });
      addAsset(outputAsset);
      setSelectedAssetId(outputAsset.id);
      setViewportResetTrigger(prev => prev + 1);
      loadModelInViewer(modelUrl, cleanName, outputAsset as any);
      toast.success('Loaded model in viewport', { description: cleanName });
    } else {
      toast.info('Model is still generating or has no output URL yet.');
    }
  }, [addAsset]);

  const selectAsset = useCallback((id: string) => {
    setSelectedAssetId(id);

    if (typeof window !== 'undefined') {
      // Must use the live activeTool (ref) — a stale closure here would rewrite
      // the URL to the wrong tool route and bounce the user to the Generate panel.
      const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${id}`);
    }

    // Increment viewport trigger to force MeshViewer reload
    setViewportResetTrigger(prev => prev + 1);
  }, [assets]);

  const setCurrentAsset = useCallback((asset: ModelAsset | null) => {
    if (!asset) {
      setSelectedAssetId(null);
      return;
    }
    addAsset(asset);
    selectAsset(asset.id);
  }, [addAsset, selectAsset]);

  const duplicateAsset = useCallback((id: string) => {
    const existing = assets.find(a => a.id === id);
    if (!existing) return;
    const dup: ModelAsset = { ...existing, id: `asset-${Date.now()}`, name: `${existing.name}_copy`, dateCreated: new Date().toISOString().split('T')[0] };
    setLocalAssets(prev => [dup, ...prev]);
    setAssets(prev => [dup, ...prev]);
    setSelectedAssetId(dup.id);
  }, [assets]);

  const updateAssetProperties = useCallback((id: string, updates: Partial<ModelAsset>) => {
    setLocalAssets(prev => {
      const idx = prev.findIndex(a => a.id === id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...updates };
        return copy;
      }
      return prev;
    });
    setAssets(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...updates } : a);
      const found = updated.find(a => a.id === id);
      if (found) {
        setLocalAssets(loc => {
          if (!loc.some(l => l.id === id)) {
            return [found, ...loc];
          }
          return loc.map(l => l.id === id ? found : l);
        });
      }
      return updated;
    });
  }, []);

  const updateMaterialConfig = useCallback((updates: Partial<MaterialConfig>) => {
    const asset = currentAssetRef.current;
    if (!asset) return;
    const cur = asset.materialConfig || { roughness: 0.5, metalness: 0.5, color: 'hsl(0, 0%, 50%)', wireframe: false, wireframeColor: 'hsl(0, 0%, 10%)', normalScale: 1.0, aoIntensity: 0.8, style: 'realistic' };
    updateAssetProperties(asset.id, { materialConfig: { ...cur, ...updates } });
  }, [updateAssetProperties]);

  const deleteAsset = useCallback(async (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    // Immediately mark as deleted locally so UI updates instantly
    setDeletedAssetIds(prev => new Set(prev).add(id));
    setLocalAssets(prev => prev.filter(a => a.id !== id));
    setAssets(prev => {
      const next = prev.filter(a => a.id !== id);
      if (id === selectedAssetIdRef.current) {
        setSelectedAssetId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });

    const isJob = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      asset.category === 'generation' ||
      asset.tags?.includes('AI Generated');

    try {
      if (isJob) {
        await fetch(`/api/v1/system/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
      if (asset.source?.fileId) {
        await fetch(`/api/v1/file-upload/${encodeURIComponent(asset.source.fileId)}`, { method: 'DELETE' });
      }
    } catch (err) {
      console.warn('Backend delete request failed:', err);
    }

    // Invalidate React Query caches so refetch does not bring back stale entries
    queryClient.invalidateQueries({ queryKey: ['uploaded-assets'] });
    queryClient.invalidateQueries({ queryKey: ['history-assets'] });
  }, [assets, queryClient]);

  const resetCamera = useCallback(() => {
    setViewportResetTrigger(prev => prev + 1);
  }, []);

  const fitToScreen = useCallback(() => setViewportResetTrigger(prev => prev + 1), []);

  const cancelExecution = useCallback(async () => {
    const jobId = activeTask?.id;
    if (!jobId) return;

    if (jobId.startsWith('local_') || activeTask?.isLocal) {
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep('Execution cancelled');
      setActiveTask(null);
      setJobsById(prev => {
        const next = { ...prev };
        delete next[jobId];
        jobsByIdRef.current = next;
        return next;
      });
      return;
    }

    try {
      const data = await getApiClient().cancelGenerationJob(jobId);
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep('Execution cancelled');
      setActiveTask(prev => prev ? {
        ...prev,
        status: 'interrupted',
        currentStep: 'Execution cancelled',
        stage: 'cancelled',
      } : null);
      setJobsById(prev => {
        const existing = prev[jobId] || activeTaskRef.current;
        if (!existing) return prev;
        const updated: ActiveTask = {
          ...existing,
          status: 'interrupted',
          currentStep: 'Execution cancelled',
          stage: 'cancelled',
        };
        const next = { ...prev, [jobId]: updated };
        jobsByIdRef.current = next;
        return next;
      });
      if (data.cancelled || data.status === 'cancelled') {
        toast.success('Generation job cancelled');
      } else {
        const message = data.message || 'Job stop requested.';
        toast.info('Job cancelled', { description: message });
      }
    } catch (error) {
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep('Execution cancelled');
      setActiveTask(prev => prev ? {
        ...prev,
        status: 'interrupted',
        currentStep: 'Execution cancelled',
        stage: 'cancelled',
      } : null);
      setJobsById(prev => {
        const existing = prev[jobId] || activeTaskRef.current;
        if (!existing) return prev;
        const updated: ActiveTask = {
          ...existing,
          status: 'interrupted',
          currentStep: 'Execution cancelled',
          stage: 'cancelled',
        };
        const next = { ...prev, [jobId]: updated };
        jobsByIdRef.current = next;
        return next;
      });
      toast.info('Cancelled locally', { description: 'Cancellation request sent to server' });
    }
  }, [activeTask?.id, activeTask?.isLocal]);

  const startTask = useCallback((type: ActiveTask['type'], title: string, promptId?: string, provider?: string, inputImage?: string, inputImageName?: string, comparisonGroupId?: string) => {
    const isLocal = !promptId;
    const taskId = promptId ?? `local_${crypto.randomUUID()}`;
    const task: ActiveTask = {
      id: taskId,
      isLocal,
      type,
      title,
      startedAt: Date.now(),
      status: 'queued',
      progress: 0,
      currentStep: 'Queued',
      provider,
      inputImage,
      inputImageName,
      comparisonGroupId
    };
    setIsExecuting(true);
    setExecutionProgress(0);
    setExecutionStep('Queued');
    setActiveTask(task);

    if (typeof window !== 'undefined') {
      const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${taskId}`);
    }
    setJobsById(prev => ({ ...prev, [taskId]: task }));
    return taskId;
  }, []);

  const bindBackendJob = useCallback((localTaskId: string, jobId: string, updates: Partial<ActiveTask> = {}) => {
    setJobsById(prev => {
      const task = prev[localTaskId] || activeTaskRef.current;
      if (!task) return prev;
      const next: ActiveTask = { ...task, ...updates, id: jobId, isLocal: false };
      const copy = { ...prev };
      delete copy[localTaskId];
      copy[jobId] = next;
      return copy;
    });
    setActiveTask(prev => prev && prev.id === localTaskId ? { ...prev, ...updates, id: jobId, isLocal: false } : prev);
  }, []);

  const queueGenerationJob = useCallback(async (customSettings?: Partial<GenerationSettings>) => {
    const effective = { ...generationSettings, ...(customSettings || {}) };
    let effectiveFileId = effective.imageFileId;
    const imageInput = effective.image;

    if (!effectiveFileId && imageInput && imageInput.startsWith('data:')) {
      try {
        const file = dataURLtoFile(imageInput, effective.imageName || 'image.jpg');
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await getApiClient().post<{ file_id: string }>(
          '/api/v1/file-upload/image',
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        if (uploadRes?.file_id) {
          effectiveFileId = uploadRes.file_id;
          setGenerationSettings(prev => ({ ...prev, imageFileId: uploadRes.file_id }));
        }
      } catch (uploadErr) {
        console.error('Failed to upload image before queueing:', uploadErr);
      }
    }

    if (!effectiveFileId && !imageInput) {
      toast.error('Image required', { description: 'Please upload or select an image to queue.' });
      return null;
    }

    const localTaskId = `queue_${crypto.randomUUID()}`;
    const queueIndex = Object.keys(jobsByIdRef.current).length + 1;
    const jobTitle = effective.imageName || `Queue #${queueIndex}`;
    const inputThumbnail = imageInput || (effectiveFileId ? `/api/v1/file-upload/download/${effectiveFileId}` : undefined);

    const newTask: ActiveTask = {
      id: localTaskId,
      isLocal: true,
      type: 'image-to-3d',
      title: jobTitle,
      inputImage: inputThumbnail,
      inputImageName: effective.imageName,
      startedAt: Date.now(),
      status: 'queued',
      progress: 0,
      currentStep: 'Queueing on backend...',
      provider: effective.aiModel || 'auto',
    };

    setJobsById(prev => ({ ...prev, [localTaskId]: newTask }));
    setIsExecuting(true);

    try {
      let resolvedModelId = effective.aiModel || '';
      let finalSettings = { ...effective, imageFileId: effectiveFileId };
      if (effective.intent) {
        try {
          const resolved = await getApiClient().resolveSmartIntent(
            effective.intent,
            effective.aiModel || undefined,
          );
          resolvedModelId = resolveGenerationModelChoice(effective.aiModel, resolved.model_id);
          if (!effective.aiModel) {
            finalSettings = {
              ...finalSettings,
              aiModel: resolvedModelId,
            };
          }
        } catch {
          // fallback
        }
      }

      const selectedCapabilities = modelDetails[resolvedModelId]?.capabilities || {};
      const modelCapabilities = resolveGenerationModelCapabilities(resolvedModelId, selectedCapabilities);
      const { endpoint, body } = buildGenerationParameters(finalSettings, modelCapabilities);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const backendJobId = data.job_id ?? data.id;
      if (!backendJobId) throw new Error('Backend did not return a job ID');

      bindBackendJob(localTaskId, backendJobId, {
        status: 'queued',
        currentStep: 'Queued on backend',
        provider: resolvedModelId,
        inputImage: inputThumbnail,
      });

      toast.success('Job Queued in Background', {
        description: `${jobTitle} (${resolvedModelId || 'Default'})`,
      });

      return backendJobId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to queue job';
      setJobsById(prev => {
        if (!prev[localTaskId]) return prev;
        return {
          ...prev,
          [localTaskId]: {
            ...prev[localTaskId],
            status: 'failed',
            currentStep: errMsg,
            errorMessage: errMsg,
          }
        };
      });
      toast.error('Queue submission failed', { description: errMsg });
      return null;
    }
  }, [
    generationSettings,
    modelDetails,
    bindBackendJob,
    parseApiError,
    parseApiData,
  ]);

  const startComparisonGroup = useCallback((name: string, sourceImage: string | null, sourceImageName: string | null, modelIds: string[], prompts: string[]) => {
    const groupId = `comp_${nextComparisonGroupId}`;
    const group: ComparisonGroup = {
      id: groupId,
      name,
      sourceImage,
      sourceImageName,
      modelIds,
      prompts,
      status: 'pending',
      createdAt: Date.now(),
      completedAt: null,
      results: {},
      selectedModelId: null
    };
    
    // Initialize results for each model
    const initialResults: Record<string, ActiveTask | null> = {};
    modelIds.forEach(modelId => {
      initialResults[modelId] = null;
    });
    
    setComparisonGroups(prev => ({
      ...prev,
      [groupId]: { ...group, results: initialResults }
    }));
    setNextComparisonGroupId(prev => prev + 1);
    setActiveComparisonGroup(groupId);
    return groupId;
  }, [nextComparisonGroupId]);

  const addModelToComparisonGroup = useCallback((groupId: string, modelId: string, prompt: string) => {
    setComparisonGroups(prev => {
      const group = prev[groupId];
      if (!group) return prev;
      
      const updatedResults = { ...group.results, [modelId]: null };
      const updatedModelIds = [...group.modelIds, modelId];
      const updatedPrompts = [...group.prompts, prompt];
      
      return {
        ...prev,
        [groupId]: {
          ...group,
          modelIds: updatedModelIds,
          prompts: updatedPrompts,
          results: updatedResults
        }
      };
    });
  }, []);

  const updateComparisonGroupStatus = useCallback((groupId: string, status: ComparisonGroup['status']) => {
    setComparisonGroups(prev => {
      const group = prev[groupId];
      if (!group) return prev;
      
      return {
        ...prev,
        [groupId]: {
          ...group,
          status,
          completedAt: status === 'completed' || status === 'failed' ? Date.now() : null
        }
      };
    });
  }, []);

  const setComparisonGroupSelectedModel = useCallback((groupId: string, modelId: string) => {
    setComparisonGroups(prev => {
      const group = prev[groupId];
      if (!group) return prev;
      
      return {
        ...prev,
        [groupId]: {
          ...group,
          selectedModelId: modelId
        }
      };
    });
  }, []);

  const getComparisonGroupResults = useCallback((groupId: string) => {
    return comparisonGroups[groupId]?.results ?? {};
  }, [comparisonGroups]);


  const generate3DModel = useCallback(async () => {
    // Project is Image-to-3D only - no text-to-3D mode
    const imageInput = generationSettings.image;
    const imageFileId = generationSettings.imageFileId;
    const modelId = generationSettings.aiModel || '';
    
    if (!imageInput && !imageFileId) {
      setExecutionStep('Please upload or select an image first');
      toast.error('Image required', { description: 'Please upload an image to generate a 3D model.' });
      return;
    }
    if (generationSettings.enhancementEnabled && !generationSettings.preprocessingArtifactId) {
      setExecutionStep('Enhancement preview must be approved before generation');
      toast.error('Enhancement approval required', {
        description: 'Accept the Generation Preview or disable enhancement before generating.',
      });
      return;
    }

     const localTaskId = startTask(
       'image-to-3d',
       generationSettings.imageName || 'asset',
       undefined,
       generationSettings.aiModel || undefined,
       undefined,
       undefined,
        comparisonGroupId ?? undefined
      );

    try {
      let effectiveSettings = generationSettings;
      let effectiveModelId = modelId;
      if (generationSettings.intent) {
        // The intent resolve is advisory: the backend re-resolves the intent and
        // owns model readiness and resource admission, so a resolve failure must
        // not block generation. Keep the user's explicit model in that case.
        try {
          const resolved = await getApiClient().resolveSmartIntent(
            generationSettings.intent,
            generationSettings.aiModel || undefined,
          );
          effectiveModelId = resolveGenerationModelChoice(modelId, resolved.model_id);
          if (!modelId) {
            effectiveSettings = {
              ...generationSettings,
              aiModel: effectiveModelId,
            };
          }
        } catch (intentError) {
          console.warn('Failed to resolve smart intent, using the selected model directly:', intentError);
        }
      }

      // Route from the selected model's declared capabilities instead of forcing raw-mesh output.
      const selectedCapabilities = modelDetails[effectiveModelId]?.capabilities || {};
      const modelCapabilities = resolveGenerationModelCapabilities(effectiveModelId, selectedCapabilities);
      const { endpoint, body } = buildGenerationParameters(effectiveSettings, modelCapabilities);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; status?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a generation job ID');
      bindBackendJob(localTaskId, jobId, {
        status: 'queued',
        currentStep: 'Queued on backend',
        provider: effectiveModelId,
      });
      setExecutionStep('Generation queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      const diagnostic = diagnoseJobError({
        id: 'submit-error',
        status: 'failed',
        error: message,
        error_message: message,
        provider: generationSettings.aiModel || '',
      } as any);
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message, diagnostic } : null);
      toast.error('Generation failed', { description: message });
    }
  }, [
    generationSettings,
    modelDetails,
    startTask,
    bindBackendJob,
    parseApiError,
    parseApiData,
    setIsExecuting,
    setExecutionStep,
  ]);

function resolveMeshReference(asset?: ModelAsset | null): { mesh_file_id?: string; mesh_path?: string } {
  if (!asset) {
    throw new Error('No model selected. Generate or import a model first.');
  }
  const explicitFileId = asset.source?.fileId || asset.fileId;
  if (explicitFileId) {
    return { mesh_file_id: explicitFileId };
  }
  const rawUrl = asset.source?.localUrl || asset.source?.viewUrl || '';
  if (!rawUrl) {
    throw new Error('This model has no backend file reference. Re-import it via Assets to run this tool.');
  }
  const matchFileId = rawUrl.match(/\/api\/v1\/file-upload\/download\/([^/?#]+)/i);
  if (matchFileId) {
    return { mesh_file_id: matchFileId[1] };
  }
  if (!rawUrl.startsWith('blob:')) {
    return { mesh_path: rawUrl };
  }
  throw new Error('This model is only loaded locally in browser. Upload or re-import it via Assets to run this tool.');
}

    const runRemeshGeneration = useCallback(async () => {
      const localTaskId = startTask('remesh', 'Remesh / topology optimization', undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshRef = resolveMeshReference(currentAsset);

      const body: Record<string, unknown> = {
        output_format: 'glb',
        model_preference: remeshSettings.variant === 'V4K'
          ? 'fastmesh_v4k_retopology'
          : 'fastmesh_v1k_retopology',
        poly_type: remeshSettings.polyType,
        target_polycount: remeshSettings.targetPolycount,
        ...meshRef,
      };

      const res = await fetch('/api/v1/mesh-retopology/retopologize-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a remesh job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' });
      setExecutionStep('Remesh queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Remesh submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message } : null);
      toast.error('Remesh failed', { description: message });
    }
  }, [remeshSettings, currentAsset, startTask]);

    const runTextureGeneration = useCallback(async () => {
      const modelPreference = textureSettings.resolution === '4K' || textureSettings.resolution === '8K'
        ? 'hunyuan3d_paint_v21_image_mesh_painting'
        : 'paint3d';

      const localTaskId = startTask('texture', 'Texture generation', undefined, modelPreference, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshRef = resolveMeshReference(currentAsset);
      const originalRefImage = currentAsset?.referenceImage || currentAsset?.inputImage || (currentAsset?.category === 'generation' ? currentAsset?.thumbnail : undefined);
      const { endpoint, body } = buildTextureGenerationParameters(
        textureSettings,
        meshRef,
        {
          url: originalRefImage,
          fileId: currentAsset?.referenceImageFileId || (currentAsset as any)?.fileId,
        },
      );

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a texture job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' });
      setExecutionStep('Texture generation queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Texture generation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      const diagnostic = diagnoseJobError({
        id: 'submit-error',
        status: 'failed',
        error: message,
        error_message: message,
        provider: textureSettings.modelId || '',
      } as any);
       setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message, diagnostic } : null);
       toast.error('Texture generation failed', { description: message });
     }
    }, [textureSettings, currentAsset, startTask]);

    const runUVUnwrapGeneration = useCallback(async (customSettings?: {
     distortionThreshold?: number;
     packMethod?: string;
     outputFormat?: string;
     saveIndividualParts?: boolean;
     modelParameters?: Record<string, any>;
   }) => {
      const localTaskId = startTask('uv', 'UV Unwrapping (PartUV)', undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshRef = resolveMeshReference(currentAsset);

      const body: Record<string, unknown> = {
        distortion_threshold: customSettings?.distortionThreshold ?? 1.25,
        pack_method: customSettings?.packMethod || 'blender',
        save_individual_parts: customSettings?.saveIndividualParts ?? true,
        save_visuals: false,
        output_format: customSettings?.outputFormat || 'obj',
        model_preference: 'partuv_uv_unwrapping',
        ...meshRef,
      };
      if (customSettings?.modelParameters) {
        body.model_parameters = customSettings.modelParameters;
      }

      const res = await fetch('/api/v1/mesh-uv-unwrapping/unwrap-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a UV unwrapping job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' });
      setExecutionStep('UV unwrapping queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UV unwrapping submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message } : null);
      toast.error('UV unwrapping failed', { description: message });
    }
  }, [currentAsset, startTask]);

  const runSegmentation = useCallback(async (customSettings?: {
    numParts?: number;
    method?: string;
    hierarchical?: boolean;
    outputFormat?: string;
    modelParameters?: Record<string, any>;
    modelPreference?: string;
  } | number) => {
    const pref = (typeof customSettings === 'object' && customSettings?.modelPreference) || '';
     const localTaskId = startTask('segment', `Mesh Segmentation`, undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshRef = resolveMeshReference(currentAsset);

      const numParts = typeof customSettings === 'number' ? customSettings : (customSettings?.numParts ?? 8);
      const outputFormat = typeof customSettings === 'object' ? (customSettings.outputFormat ?? 'glb') : 'glb';

      const body: Record<string, unknown> = {
        num_parts: numParts,
        output_format: outputFormat,
        model_preference: pref,
        ...meshRef,
      };
      if (typeof customSettings === 'object' && customSettings?.modelParameters) {
        body.model_parameters = customSettings.modelParameters;
      }

      const res = await fetch('/api/v1/mesh-segmentation/segment-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a segmentation job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' });
      setExecutionStep('Mesh segmentation queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Segmentation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message } : null);
      toast.error('Segmentation failed', { description: message });
    }
  }, [currentAsset, startTask]);

  const runMeshEditing = useCallback(async (customSettings?: {
    sourcePrompt?: string;
    targetPrompt?: string;
    resolution?: number;
    bbox?: any;
    outputFormat?: string;
    mode?: 'text' | 'image';
    targetImageFileId?: string;
    targetImageBase64?: string;
    strength?: number;
  }) => {
     const localTaskId = startTask('edit', customSettings?.mode === 'image' ? 'Mesh Editing (Image)' : 'Mesh Editing (Text)', undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshRef = resolveMeshReference(currentAsset);

      const isImage = customSettings?.mode === 'image';
      const endpoint = isImage ? '/api/v1/mesh-editing/image-mesh-editing' : '/api/v1/mesh-editing/text-mesh-editing';

      const body: Record<string, unknown> = {
        num_views: 150,
        resolution: customSettings?.resolution || 512,
        output_format: customSettings?.outputFormat || 'glb',
        mask_bbox: customSettings?.bbox || {
          center: [0.0, 0.45, -0.15],
          dimensions: [0.42, 0.36, 0.50],
        },
        ...meshRef,
      };

      if (isImage) {
        const defaultPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        if (customSettings?.targetImageFileId) {
          body.target_image_file_id = customSettings.targetImageFileId;
        } else {
          body.target_image_base64 = customSettings?.targetImageBase64 || defaultPngBase64;
        }
        body.source_image_base64 = defaultPngBase64;
        body.mask_image_base64 = defaultPngBase64;
        if (customSettings?.targetPrompt) {
          body.target_prompt = customSettings.targetPrompt;
        }
      } else {
        body.source_prompt = customSettings?.sourcePrompt || '3D mesh model';
        body.target_prompt = customSettings?.targetPrompt || 'Add high-resolution surface details';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return an editing job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' });
      setExecutionStep('Mesh editing queued on backend');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mesh editing submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message } : null);
      toast.error('Mesh editing failed', { description: message });
    }
  }, [currentAsset, startTask]);

  const refineMesh = useCallback(async (opts: { meshPath?: string; imagePath?: string; resolution?: number } = {}) => {
    const asset = currentAsset;
    if (!asset) {
      toast.error('Refine failed', { description: 'No mesh loaded.' });
      return;
    }
    const meshPath = opts.meshPath ?? asset.source?.viewUrl ?? asset.artifacts?.gameReady ?? asset.artifacts?.source ?? asset.thumbnail;
    if (!meshPath) {
      toast.error('Refine failed', { description: 'This mesh has no backend URL to refine.' });
      return;
    }

    const localTaskId = startTask('refine', 'Refine with Hi3D');

    try {
      const data = await getApiClient().refineMesh({
        jobId: asset.id,
        meshPath,
        imagePath: opts.imagePath ?? asset.referenceImage ?? asset.inputImage,
        resolution: opts.resolution,
      });
      bindBackendJob(localTaskId, data.refinement_job_id, {
        status: 'queued',
        currentStep: 'Refining geometry with Hi3D...',
      });
      setExecutionStep('Refining geometry with Hi3D...');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refine submission failed';
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep(message);
      setActiveTask(prev => (prev ? { ...prev, status: 'failed', currentStep: message, errorMessage: message } : null));
      toast.error('Refine failed', { description: message });
    }
  }, [currentAsset, startTask, bindBackendJob]);

   // Batch processing function
    const processBatchQueue = useCallback(async () => {
      const appStore = useAppStore.getState();
      const { batchGenerationEnabled, batchQueue } = appStore;
     
     if (!batchGenerationEnabled) {
       toast.error('Batch generation disabled', { description: 'Enable batch generation in settings to process the queue.' });
       return;
     }

     // Find queued batch queue items that haven't been processed yet
     const queuedItems = batchQueue.filter(item => 
       item.status === 'queued' && !item.jobId
     );

     if (queuedItems.length === 0) {
       toast.info('No items to process', { description: 'The batch queue is empty or all items have been processed.' });
       return;
     }

     // Process each queued item
     for (const batchItem of queuedItems) {
       try {
         // Validate that we have the necessary information
         if (!batchItem.imageFileId) {
           throw new Error('Missing image file ID for batch item');
         }

         // Create a temporary GenerationSettings object from the batch item
         const batchTexQuality = batchItem.textureQuality as string | undefined;
         const batchTexRes: '1K' | '2K' | '4K' | '8K' =
           batchItem.texture_resolution ??
           batchItem.textureResolution ??
           (batchTexQuality === '8k' ? '8K' : batchTexQuality === 'ultra' ? '4K' : batchTexQuality === 'high' ? '2K' : '1K');
         const batchSettings: GenerationSettings = {
           mode: 'image-to-3d',
           image: null, // We'll use imageFileId instead
           imageFileId: batchItem.imageFileId,
           aiModel: batchItem.aiModel,
           textureQuality: (batchItem.textureQuality as any) ?? 'high',
           texture_resolution: batchTexRes,
           textureResolution: batchTexRes,
           quadTopology: batchItem.quadTopology ?? false,
           topologyMode: batchItem.topologyMode ?? 'triangle',
            seed: batchItem.seed ?? (Math.floor(Math.random() * 900000) + 100000),
            removeBackground: batchItem.removeBackground ?? true,
            autoOptimizeSettings: batchItem.autoOptimizeSettings ?? { targetPolycount: 0 },
            generateTexture: batchItem.generateTexture ?? true,
            highResolutionNormalBaking: batchItem.highResolutionNormalBaking ?? true,
            generateLOD: batchItem.generateLOD ?? false,
            lodPreset: batchItem.lodPreset ?? 'high',
            lodCount: batchItem.lodCount ?? 4,
            candidateCount: batchItem.candidateCount ?? 1,
            partCountRange: batchItem.partCountRange ?? '1',
            rigType: batchItem.rigType ?? 'none',
            exportFormats: batchItem.exportFormats ?? ['glb'],
            slicerHandoff: batchItem.slicerHandoff ?? false,
            generateCollision: batchItem.generateCollision ?? true,
            intent: batchItem.intent,
            preprocessingArtifactId: batchItem.preprocessingArtifactId,
            preprocessingReviewOverride: batchItem.preprocessingReviewOverride ?? false,
            preprocessingPreviewUrl: null,
            preprocessingMetadata: batchItem.preprocessingMetadata,
            enhancementEnabled: batchItem.enhancementEnabled ?? false,
            enablePrintabilityCheck: batchItem.enablePrintabilityCheck ?? false,
            enableAutoRepair: batchItem.enableAutoRepair ?? false,
            enableAutoRig: batchItem.enableAutoRig ?? false,
            autoRigMode: batchItem.autoRigMode ?? 'full',
            enablePostprocess: batchItem.enablePostprocess ?? true,
            physics: batchItem.physics ?? { ...DEFAULT_PHYSICS_SETTINGS },
         };

          // Create a local task for tracking
          const localTaskId = startTask(
            'image-to-3d',
            `Batch Item ${batchItem.id.slice(-6)}`,
            undefined,
             batchItem.aiModel || '',
             undefined,
             undefined,
             comparisonGroupId ?? undefined
           );

         // Resolve smart intent if applicable
         let effectiveSettings = batchSettings;
         if (batchSettings.intent) {
           try {
              const resolved = await getApiClient().resolveSmartIntent(
                batchSettings.intent,
                batchSettings.aiModel || undefined,
              );
              const effectiveModelId = resolveGenerationModelChoice(batchSettings.aiModel, resolved.model_id);
              if (!batchSettings.aiModel) {
                effectiveSettings = {
                  ...batchSettings,
                  aiModel: effectiveModelId,
                };
              }
           } catch (intentError) {
             console.warn('Failed to resolve smart intent, using model directly:', intentError);
             // Continue with original settings
           }
         }

          // Batch and single submissions use the same manifest-declared model capabilities.
          const effectiveModelId = effectiveSettings.aiModel || '';
          const selectedCapabilities = modelDetails[effectiveModelId]?.capabilities || {};
          const modelCapabilities = resolveGenerationModelCapabilities(effectiveModelId, selectedCapabilities);
          const { endpoint, body } = buildGenerationParameters(effectiveSettings, modelCapabilities);

         // Submit the job to the backend
         const res = await fetch(endpoint, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(body),
         });
         if (!res.ok) throw await parseApiError(res);
         const data = await parseApiData<{ job_id?: string; id?: string; status?: string }>(res);
         const jobId = data.job_id ?? data.id;
         if (!jobId) throw new Error('Backend did not return a generation job ID');

         // Store the mapping from jobId to batchQueueItemId for polling
         batchJobIdMap.current[jobId] = batchItem.id;

         // Update the batch queue item with the job ID and mark as submitted/running
         updateBatchItem(batchItem.id, {
           jobId,
           status: 'running',
           progress: 0,
           startedAt: new Date(),
         });

         // Bind the backend job to our local task for tracking
         bindBackendJob(localTaskId, jobId, {
           status: 'queued',
           currentStep: 'Queued on backend',
           provider: effectiveSettings.aiModel || '',
         });
         
       } catch (error) {
         const message = error instanceof Error ? error.message : 'Batch item processing failed';
         console.error('Failed to process batch item:', error);
         
         // Update the batch queue item to reflect the failure
         updateBatchItem(batchItem.id, {
           status: 'failed',
           error: message,
           completedAt: new Date(),
         });
         
         // Show toast for the error but continue processing other items
         toast.error(`Batch item failed: ${message}`);
       }
     }

      // Show completion toast
      toast.success('Batch processing started', { description: `${queuedItems.length} items submitted for processing.` });
    }, [modelDetails, startTask, bindBackendJob, getApiClient, parseApiError, parseApiData, buildGenerationParameters, toast]);

   // Cancel batch processing function
   const cancelBatchProcessing = useCallback(async () => {
     const appStore = useAppStore.getState();
     const { batchQueue, updateBatchItem } = appStore;
     
     // Get all batch queue items that are currently running or queued
     const itemsToCancel = batchQueue.filter(item => 
       item.status === 'running' || item.status === 'queued'
     );
     
     if (itemsToCancel.length === 0) {
       toast.info('No items to cancel', { description: 'There are no running or queued batch items to cancel.' });
       return;
     }
     
     // Cancel each item's job if it has a jobId
     for (const item of itemsToCancel) {
       if (item.jobId) {
         const bJobId = item.jobId;
         try {
           await getApiClient().cancelGenerationJob(bJobId);
         } catch (err) {
           try {
             await fetch(`/api/v1/system/jobs/${encodeURIComponent(bJobId)}`, {
               method: 'DELETE',
             });
           } catch (delErr) {
             console.warn('Failed to cancel job via backend:', delErr);
           }
         }
         
         // Update the batch queue item to cancelled
         updateBatchItem(item.id, {
           status: 'cancelled',
           completedAt: new Date(),
         });
         
         // Clean up the job ID map
         delete batchJobIdMap.current[bJobId];

         // Synchronize jobsById so the background poller does not revive cancelled batch jobs
         setJobsById(prev => {
           const existing = prev[bJobId];
           if (!existing) return prev;
           const updated: ActiveTask = {
             ...existing,
             status: 'interrupted',
             currentStep: 'Batch execution cancelled',
             stage: 'cancelled',
           };
           const next = { ...prev, [bJobId]: updated };
           jobsByIdRef.current = next;
           return next;
         });

         // If this batch item was the active foreground task, clear executing state
         if (activeTaskRef.current?.id === bJobId) {
           setIsExecuting(false);
           setExecutionProgress(0);
           setExecutionStep('Batch execution cancelled');
           setActiveTask(prev => prev && prev.id === bJobId ? {
             ...prev,
             status: 'interrupted',
             currentStep: 'Batch execution cancelled',
             stage: 'cancelled',
           } : null);
         }
       } else {
         // If the item doesn't have a jobId, it's probably still queued and hasn't been processed yet
         updateBatchItem(item.id, {
           status: 'cancelled',
         });
       }
     }
     
      toast.success('Batch processing cancelled', { description: `${itemsToCancel.length} items cancelled.` });
    }, [useAppStore]);

    // Retry failed batch items function
    const retryFailedBatchItems = useCallback(async () => {
      const appStore = useAppStore.getState();
      const { batchQueue, updateBatchItem } = appStore;
     
     // Get all batch queue items that have failed
     const failedItems = batchQueue.filter(item => 
       item.status === 'failed'
     );
     
     if (failedItems.length === 0) {
       toast.info('No failed items to retry', { description: 'There are no failed batch items to retry.' });
       return;
     }
     
       // Reset each failed item to queued status so it can be processed again
       for (const item of failedItems) {
         updateBatchItem(item.id, {
           status: 'queued',
           progress: 0,
           jobId: undefined, // Clear the job ID so it gets a new one when processed
           error: undefined,
           startedAt: undefined,
           completedAt: undefined,
           // Clear stored generation settings so they get current values when re-queued
           textureQuality: undefined,
           quadTopology: undefined,
           topologyMode: undefined,
           seed: undefined,
           removeBackground: undefined,
           autoOptimizeSettings: undefined,
           generateTexture: undefined,
           texture_resolution: undefined,
           textureResolution: undefined,
           highResolutionNormalBaking: undefined,
           generateLOD: undefined,
           lodPreset: undefined,
           lodCount: undefined,
           candidateCount: undefined,
           physics: undefined,
           preprocessingReviewOverride: undefined,
           enhancementEnabled: undefined,
           generateCollision: undefined,
           enablePrintabilityCheck: undefined,
           enableAutoRepair: undefined,
           enableAutoRig: undefined,
           autoRigMode: undefined,
         });
         
         // Clean up the job ID map for this item
         if (item.jobId) {
           delete batchJobIdMap.current[item.jobId];
         }
       }
     
      toast.success('Failed items reset for retry', { description: `${failedItems.length} failed items reset to queued status.` });
    }, []);

  const isWorkspaceShellActive = useCallback((path?: string | null) => {
    if (!path) return false;
    return (
      path.startsWith('/workspace') ||
      path === '/animation' ||
      path.startsWith('/animation') ||
      path === '/rigging' ||
      path.startsWith('/rigging') ||
      path === '/dashboard' ||
      path === '/outputs' ||
      path === '/system' ||
      path === '/jobs'
    );
  }, []);

  const navigateToTool = useCallback((tool: ToolType) => {
    setActiveTool(tool);
    setMainNav('workspace');
    mainNavRef.current = 'workspace';
    setIsLeftPanelOpen(true);
    const route = TOOL_TO_ROUTE[tool] || '/workspace/generate';
    if (!isWorkspaceShellActive(pathname)) {
      router.push(route);
      return;
    }
    if (pathname !== route) {
      // Use replaceState instead of router.push to avoid full page remount.
      // This keeps the MeshViewer and 3D WebGL context continuously mounted.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', route);
      }
    }
  }, [pathname, router, setMainNav, setActiveTool, setIsLeftPanelOpen, isWorkspaceShellActive]);

  const navigateToMain = useCallback((nav: MainNavRoute) => {
    setMainNav(nav);
    mainNavRef.current = nav;
    if (nav === 'settings') {
      router.push('/admin?tab=settings');
      return;
    }
    if (nav === 'models') {
      router.push('/admin?tab=models');
      return;
    }

    const routeMap: Record<string, string> = {
      dashboard: '/workspace/overview',
      assets: '/workspace/assets',
      system: '/workspace/system',
      jobs: '/workspace/jobs',
      workspace: '/workspace',
    };
    const targetRoute = routeMap[nav];
    if (targetRoute) {
      if (typeof window !== 'undefined' && isWorkspaceShellActive(pathname)) {
        // Use replaceState instead of router.push to avoid full page remount.
        // This keeps the MeshViewer and 3D stage alive while switching overlay views.
        window.history.replaceState(null, '', targetRoute);
      } else {
        router.push(targetRoute);
      }
    }
  }, [pathname, router, setMainNav, isWorkspaceShellActive]);

  // Split context value into smaller memos to reduce re-render scope.
  // Each memo only recalculates when its specific dependencies change.
  const viewportValue = useMemo(() => ({
    shadingMode, setShadingMode, showWireframe, setShowWireframe,
    showGrid, setShowGrid, showBones, setShowBones,
    isTurntable, setIsTurntable,
    activeTransformTool, setActiveTransformTool,
    viewportResetTrigger, resetCamera, fitToScreen,
  }), [shadingMode, setShadingMode, showWireframe, setShowWireframe,
    showGrid, setShowGrid, showBones, setShowBones,
    isTurntable, setIsTurntable,
    activeTransformTool, setActiveTransformTool,
    viewportResetTrigger, resetCamera, fitToScreen]);

  const toolValue = useMemo(() => ({
    activeTool, setActiveTool, mainNav, setMainNav,
    activeRightTab, setActiveRightTab,
    rightPanelMode: activeRightTab, setRightPanelMode: setActiveRightTab,
    isLeftPanelOpen, setIsLeftPanelOpen,
    leftPanelWidth, setLeftPanelWidth,
    rightPanelWidth, setRightPanelWidth,
    toolPanelOpen: isLeftPanelOpen, setToolPanelOpen: setIsLeftPanelOpen,
    isRightPanelOpen, setIsRightPanelOpen,
    rightPanelOpen: isRightPanelOpen, setRightPanelOpen: setIsRightPanelOpen,
    navigateToTool, navigateToMain, navigateToMainNav: navigateToMain,
  }), [activeTool, setActiveTool, mainNav, setMainNav,
    activeRightTab, setActiveRightTab,
    isLeftPanelOpen, setIsLeftPanelOpen,
    leftPanelWidth, setLeftPanelWidth,
    rightPanelWidth, setRightPanelWidth,
    isRightPanelOpen, setIsRightPanelOpen,
    navigateToTool, navigateToMain]);

  const isAssetsLoading = (isHistoryLoading || isUploadedLoading) && assets.length === 0;

  const assetValue = useMemo(() => ({
    assets, isAssetsLoading, selectedAssetId, currentAsset,
    selectAsset, updateAssetProperties, updateMaterialConfig,
    deleteAsset, addAsset, setCurrentAsset,
    assetFilter, setAssetFilter, duplicateAsset,
  }), [assets, isAssetsLoading, selectedAssetId, currentAsset,
    selectAsset, updateAssetProperties, updateMaterialConfig,
    deleteAsset, addAsset, setCurrentAsset,
    assetFilter, setAssetFilter, duplicateAsset]);

  const systemValue = useMemo(() => ({
    systemStats, isSettingsOpen, setIsSettingsOpen,
    isExportModalOpen, setIsExportModalOpen,
    isDccBridgeOpen, setIsDccBridgeOpen,
    refreshSystemStats,
  }), [systemStats, isSettingsOpen, setIsSettingsOpen,
    isExportModalOpen, setIsExportModalOpen,
    isDccBridgeOpen, setIsDccBridgeOpen,
    refreshSystemStats]);

  const executionValue = useMemo(() => ({
    activeTask, jobsById, dismissActiveTask,
    isExecuting, executionProgress, executionStep, cancelExecution,
    dismissJob, selectJobToView, queueGenerationJob,
  }), [activeTask, jobsById, dismissActiveTask,
    isExecuting, executionProgress, executionStep, cancelExecution,
    dismissJob, selectJobToView, queueGenerationJob]);

  const generationSettingsValue = useMemo(() => ({
    generationSettings, setGenerationSettings,
    remeshSettings, setRemeshSettings,
    textureSettings, setTextureSettings,
    sculptSettings, setSculptSettings,
    paintBrushSettings, setPaintBrushSettings,
    environmentSettings, setEnvironmentSettings,
  }), [generationSettings, setGenerationSettings,
    remeshSettings, setRemeshSettings,
    textureSettings, setTextureSettings,
    sculptSettings, setSculptSettings,
    paintBrushSettings, setPaintBrushSettings,
    environmentSettings, setEnvironmentSettings]);

    const generationActionsValue = useMemo(() => ({
      generate3DModel,
      runModelGeneration: generate3DModel,
      runRemeshGeneration, runTextureGeneration,
      runUVUnwrapGeneration, runSegmentation,
      runMeshEditing,
      refineMesh,
      processBatchQueue,
      cancelBatchProcessing,
      retryFailedBatchItems,
    }), [generate3DModel,
      runRemeshGeneration, runTextureGeneration,
      runUVUnwrapGeneration, runSegmentation,
      runMeshEditing,
      refineMesh,
      processBatchQueue,
      cancelBatchProcessing,
      retryFailedBatchItems]);

  const value = React.useMemo(() => ({
    ...viewportValue, ...toolValue, ...assetValue, ...systemValue,
    ...executionValue, ...generationSettingsValue,
    ...generationActionsValue,
  }), [viewportValue, toolValue, assetValue, systemValue,
    executionValue, generationSettingsValue,
    generationActionsValue]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
