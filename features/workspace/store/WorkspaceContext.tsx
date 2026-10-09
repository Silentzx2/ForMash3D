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
import { buildGenerationParameters } from '../utils/buildGenerationParameters';

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
  setCurrentAsset: (asset: ModelAsset) => void;
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
  generateImageTo3D: (customImage?: string) => Promise<void>;
  runModelGeneration: () => Promise<void>;
  runRemeshGeneration: () => Promise<void>;
  runTextureGeneration: () => Promise<void>;
  runUVUnwrapGeneration: (customSettings?: { distortionThreshold?: number; packMethod?: string; outputFormat?: string; saveIndividualParts?: boolean; modelParameters?: Record<string, any> }) => Promise<void>;
  runSegmentation: (customSettings?: { numParts?: number; method?: string; hierarchical?: boolean; outputFormat?: string; modelParameters?: Record<string, any>; modelPreference?: string } | number) => Promise<void>;
  runMeshEditing: (customSettings?: { sourcePrompt?: string; targetPrompt?: string; resolution?: number; bbox?: any; outputFormat?: string; mode?: 'text' | 'image'; targetImageFileId?: string; targetImageBase64?: string; strength?: number }) => Promise<void>;
  queueWorkflow: (workflow: Record<string, unknown>, type: ActiveTask['type'], title: string) => Promise<void>;
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
  model: '/workspace/generate',
  remesh: '/workspace/remesh',
  texture: '/workspace/texture',
  uv: '/workspace/uv',
  segment: '/workspace/segment',
  edit: '/workspace/edit',
  upscale: '/workspace/upscale',
  pbr: '/workspace/pbr',
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

function normalizeBackendJob(raw: BackendJobPayload) {
  const rawProgress = Number(raw.progress ?? 0);
  const normalizedProgress = rawProgress <= 1 ? rawProgress * 100 : rawProgress;
  const modelUrl = toProxyUrl(raw.result?.mesh_url ?? raw.result?.model_url);
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
      ...(modelUrl ? { model_url: modelUrl, active_model_url: modelUrl } : {}),
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
        const outputUrl = (outputs.glb as string) || (outputs.model_url as string) || (outputs.download_url as string) || `/api/v1/system/jobs/${id}/download?artifact_format=glb`;
        return normalizeModelAsset({
          id: id || `hist-${i}`,
          name,
          category: 'generation',
          thumbnail: (outputs.thumbnail as string) || (outputs.thumbnail_url as string) || '',
          source: { filename: `${id}.glb`, subfolder: 'generated', type: 'output', viewUrl: outputUrl },
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
          postprocessStatus: outputs.postprocess_status,
          dateCreated: '',
          tags: ['AI Generated'],
          materials: [],
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

      if ((!selectedAssetIdRef.current || !filtered.some(a => a.id === selectedAssetIdRef.current)) && filtered.length > 0) {
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

    const [generationSettings, setGenerationSettings] = useState<GenerationSettings>({
      mode: 'image-to-3d',
      image: null,
      aiModel: '', meshQuality: 'high', textureQuality: 'high',
      quadTopology: false, topologyMode: 'triangle', seed: 42891, guidanceScale: 7.5, removeBackground: false,
      lowVram: false,
      vramMode: 'auto',
      autoOptimizeSettings: { targetPolycount: 50000 },
      generateTexture: true,
      enableFlashVDM: false,
      lowVramMode: 'auto',
      maxNumView: 6,
      resolution: 1024,
      generateCollision: true,
      enableRealESRGAN: true,
      intent: undefined,
      preprocessingArtifactId: null,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
      enhancementEnabled: false,
      enablePrintabilityCheck: false,
      enableAutoRepair: false,
      enableAutoRig: false,
      autoRigMode: 'full',
      physics: {
        bodyType: 'auto',
        massMode: 'auto',
        massKg: 1,
        densityMode: 'auto',
        densityKgM3: 500,
        friction: 0.5,
        restitution: 0.1,
        linearDamping: 0.05,
        angularDamping: 0.05,
        gravityEnabled: true,
        collisionQuality: 'balanced',
        deformation: 'off',
      },
    });
 
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
    maxNumView: 6,
    generatePBR: true,
    enableRealESRGAN: true,
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
   const [modelParameterDefaults, setModelParameterDefaults] = useState<Record<string, Record<string, any>>>({});

  useEffect(() => {
    getApiClient().getAvailableModels().then(data => {
      if ((data as any)?.model_details) {
        setModelDetails((data as any).model_details);
      }
    }).catch(err => {
      console.warn('Failed to load model details:', err);
    });
  }, []);

  // Fetch parameter defaults for the currently selected model (LOW-001)
  useEffect(() => {
    const modelId = generationSettings.aiModel;
    if (!modelId) return;
    if (modelParameterDefaults[modelId]) return; // already cached

    let cancelled = false;
    getApiClient().getModelParameters(modelId).then(data => {
      if (cancelled) return;
      setModelParameterDefaults(prev => ({
        ...prev,
        [modelId]: data.schema?.parameters || {},
      }));
    }).catch(err => {
      console.warn(`Failed to load model parameters for ${modelId}:`, err);
    });

    return () => { cancelled = true; };
  }, [generationSettings.aiModel, modelParameterDefaults]);

  const currentAsset = useMemo(
    () => selectedAssetId ? (assets.find(a => a.id === selectedAssetId) ?? null) : null,
    [assets, selectedAssetId]
  );
  const currentAssetRef = useRef(currentAsset);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
    currentAssetRef.current = currentAsset;
    mainNavRef.current = mainNav;
    systemStatsStatusRef.current = systemStats.status;
  }, [selectedAssetId, currentAsset, mainNav, systemStats.status]);

  useEffect(() => {
    try {
      const savedLowVram = localStorage.getItem('lowVramMode');
      if (savedLowVram !== null) {
        const isLow = JSON.parse(savedLowVram);
        setGenerationSettings(prev => ({ ...prev, lowVram: isLow }));
      }
    } catch { /* ignore */ }
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
                setActiveTask(prev => prev && prev.id === jobId ? {
                  ...prev,
                  status: nextStatus,
                  progress,
                  stage: data.stage,
                  currentStep: currentMessage,
                  errorMessage: data.error_message || prev.errorMessage,
                  errorCode: (data as any).error_code || prev.errorCode,
                  logs: data.logs || prev.logs,
                  result: data.result || prev.result,
                } : prev);
              }

              if (data.status === 'completed' && task.status !== 'completed') {
                toast.success('Generation complete', {
                  description: task.title || '3D Asset ready',
                });

                const result = data.result;
                if (result?.model_url || result?.active_model_url) {
                  const modelUrl = (result.active_model_url || result.model_url) as string;
                  const promptTitle = task.title;
                  const cleanName = promptTitle && promptTitle !== 'generate' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
                  void prefetchGLB(modelUrl);
                  const outputAsset = normalizeModelAsset({
                    id: jobId,
                    name: cleanName,
                    category: 'generation',
                    thumbnail: result.thumbnail_url || task.inputImage || '',
                    source: { filename: `${cleanName}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl },
                    polygon_count: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
                    vertex_count: result.vertex_count ?? result.quality_trace?.game_ready?.vertices,
                    faces: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
                    vertices: result.vertex_count ?? result.quality_trace?.game_ready?.vertices,
                    triangles: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
                    statsAvailable: Boolean(result.polygon_count || result.quality_trace?.game_ready?.faces),
                    topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
                    format: 'GLB',
                    postprocessStatus: result.postprocess_status || 'completed',
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
                  });
                  addAsset(outputAsset);
                  if (activeTaskRef.current?.id === jobId) {
                    setSelectedAssetId(outputAsset.id);
                    setViewportResetTrigger(prev => prev + 1);
                    loadModelInViewer(modelUrl, cleanName, outputAsset as any);
                  }
                }
              } else if ((data.status === 'failed' || data.status === 'cancelled') && task.status !== 'failed' && task.status !== 'interrupted') {
                const errMsg = data.error_message || 'The job encountered an error during execution';
                toast.error('Process failed', { description: errMsg });
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
      const toolRoute = TOOL_TO_ROUTE[activeTool] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${jobId}`);
    }

    const result = (job.result || {}) as Record<string, any>;
    const modelUrl = (result?.active_model_url || result?.model_url || result?.url) as string | undefined;
    if (modelUrl) {
      const promptTitle = job.title;
      const cleanName = promptTitle && promptTitle !== 'generate' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
      void prefetchGLB(modelUrl);
      const outputAsset = normalizeModelAsset({
        id: jobId,
        name: cleanName,
        category: 'generation',
        thumbnail: result.thumbnail_url || job.inputImage || '',
        source: { filename: `${cleanName}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl },
        polygon_count: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
        vertex_count: result.vertex_count ?? result.quality_trace?.game_ready?.vertices,
        faces: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
        vertices: result.vertex_count ?? result.quality_trace?.game_ready?.vertices,
        triangles: result.polygon_count ?? result.quality_trace?.game_ready?.faces,
        statsAvailable: Boolean(result.polygon_count || result.quality_trace?.game_ready?.faces),
        topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
        format: 'GLB',
        postprocessStatus: result.postprocess_status || 'completed',
        tags: ['AI Generated'],
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
      const toolRoute = TOOL_TO_ROUTE[activeTool] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${id}`);
    }

    // Increment viewport trigger to force MeshViewer reload
    setViewportResetTrigger(prev => prev + 1);
  }, [assets]);

  const setCurrentAsset = useCallback((asset: ModelAsset) => selectAsset(asset.id), [selectAsset]);

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
      return;
    }

    try {
      const data = await getApiClient().cancelGenerationJob(jobId);
      if (data.cancelled || data.status === 'cancelled') {
        setIsExecuting(false);
        setExecutionProgress(0);
        setExecutionStep('Execution cancelled');
        setActiveTask(prev => prev ? {
          ...prev,
          status: 'interrupted',
          currentStep: 'Execution cancelled',
          stage: 'cancelled',
        } : null);
      } else {
        const message = data.message || 'Job is already running and cannot be cancelled safely.';
        setExecutionStep(message);
        toast.info('Generation is already running', { description: message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel generation job';
      setExecutionStep(message);
      toast.error('Cancel failed', { description: message });
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
      const toolRoute = TOOL_TO_ROUTE[activeTool] || '/workspace/generate';
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
          resolvedModelId = resolved.model_id;
          finalSettings = {
            ...finalSettings,
            aiModel: resolvedModelId,
          };
        } catch {
          // fallback
        }
      }

      const selectedCapabilities = modelDetails[resolvedModelId]?.capabilities || {};
      const isRawModel = selectedCapabilities.raw_mesh === true || resolvedModelId.endsWith('_image_to_raw_mesh');
      const { endpoint, body } = buildGenerationParameters(
        finalSettings,
        {
          raw_mesh: isRawModel,
          paint_autochain: selectedCapabilities.paint_autochain === true,
          multiview: selectedCapabilities.multiview === true,
          supports_texture: selectedCapabilities.texture_generation ?? !isRawModel,
        },
        modelParameterDefaults[resolvedModelId] || {},
      );

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
    modelParameterDefaults,
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

  const generateImageTo3D = useCallback(async (customImage?: string) => {
    const imageToUse = customImage ?? generationSettings.image;
    if (!imageToUse) {
      setExecutionStep('Please select or upload an image first');
      toast.error('Image required', { description: 'Select or upload a reference image to generate a 3D model.' });
      return;
    }
    const modelPrompt = generationSettings.prompt || generationSettings.imageName || '3D Model';
    // ponytail: derive a human-readable name from the reference image filename so
    // the saved model is labelled by its source image, not "Model_<uuid>".
    const imageFileName = generationSettings.imageName
      || (imageToUse ? decodeURIComponent(imageToUse.split('/').pop()?.replace(/\?.*$/, '') || '') : '')
       || modelPrompt;
     const localTaskId = startTask('image-to-3d', modelPrompt, undefined, generationSettings.aiModel, imageToUse ?? undefined, imageFileName, comparisonGroupId ?? undefined);

    const currentQuality = generationSettings.meshQuality || 'high';
    const textureResolutionByQuality: Record<string, number> = {
      low: 512,
      medium: 1024,
      high: 2048,
      ultra: 4096,
      '8k': 4096,
    };
    const requestedTextureResolution =
      textureResolutionByQuality[generationSettings.textureQuality] || 2048;
    // Source geometry follows the selected model's official/tuned inference schedule.
    const sourceQuality = 'ultra' as const;
    let modelId = generationSettings.aiModel || '';
    if (generationSettings.enhancementEnabled && !generationSettings.preprocessingArtifactId) {
      setExecutionStep('Enhancement preview must be approved before generation');
      toast.error('Enhancement approval required', {
        description: 'Accept the Generation Preview or disable enhancement before generating.',
      });
      return;
    }
    if (generationSettings.intent) {
      const resolved = await getApiClient().resolveSmartIntent(
        generationSettings.intent,
        generationSettings.aiModel || undefined,
      );
      modelId = resolved.model_id;
    }
    const paramDefaults = modelParameterDefaults[modelId] || {};

    // Use backend-provided parameter defaults when available; fall back to
    // model-specific inference schedules only if the schema has not loaded yet.
    const infSteps = Number(
      paramDefaults.num_inference_steps ??
      paramDefaults.ss_sampling_steps ??
      50
    );
    let infGuidance = Number(
      paramDefaults.guidance_scale ??
      generationSettings.guidanceScale ??
      7.5
    );

    if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
      infGuidance = infGuidance || 5.0;
    } else if (modelId.includes('triposg')) {
      infGuidance = infGuidance || 7.0;
    } else if (modelId.includes('trellis')) {
      infGuidance = infGuidance || 7.5;
    } else if (modelId.includes('hunyuan3d_shape_v21') || modelId.includes('hunyuan3dv21')) {
      infGuidance = infGuidance || 5.0;
    }

    try {
      // Route dynamically: raw models (Hunyuan3D Raw, PartPacker, UltraShape) must go to image-to-raw-mesh
      const selectedModel = modelDetails[generationSettings.aiModel || ''];
      const capabilities = selectedModel?.capabilities || {};
      const isRawModel = capabilities.raw_mesh === true;
      const isTextured = !isRawModel && generationSettings.generateTexture !== false;
      const isPaintModel = capabilities.paint_autochain === true;
      const isMultiviewCapable = Boolean(capabilities.multiview_input);
      const hasMvViews = Boolean(
        generationSettings.multiviewAssetId ||
        (generationSettings.multiviewViews && generationSettings.multiviewViews.length > 0)
      );
      const useMultiviewReconstruction = isMultiviewCapable && hasMvViews;

      const endpoint = useMultiviewReconstruction
        ? '/api/v1/multiview/reconstruct-3d'
        : (isTextured
          ? '/api/v1/mesh-generation/image-to-textured-mesh'
          : '/api/v1/mesh-generation/image-to-raw-mesh');

      // Resolve image input: prefer file_id from upload, fall back to base64 data URL
      const imageInput: Record<string, unknown> = {};
      if (generationSettings.imageFileId) {
        imageInput.image_file_id = generationSettings.imageFileId;
      } else if (typeof imageToUse === 'string' && imageToUse.startsWith('data:')) {
        imageInput.image_base64 = imageToUse;
      } else if (!useMultiviewReconstruction) {
        throw new Error('No usable image input. Please upload an image first.');
      }

      const targetPoly = generationSettings.autoOptimizeSettings?.targetPolycount ?? 50000;
      const modelParameters: Record<string, unknown> = {
        octree_resolution: Number(paramDefaults.octree_resolution ?? 512),
        num_inference_steps: infSteps,
        guidance_scale: infGuidance,
        seed: generationSettings.seed ?? undefined,
        low_vram: Boolean(generationSettings.lowVram),
        enable_flashvdm: generationSettings.enableFlashVDM ?? false,
        low_vram_mode: generationSettings.lowVramMode ?? 'auto',
        auto_optimize: targetPoly === 0 || (targetPoly > 0 && targetPoly < 200000),
        target_polycount: targetPoly,
        generateLOD: generationSettings.generateLOD !== false,
        lodPreset: generationSettings.lodPreset || 'high',
        lodCount: generationSettings.lodCount || 4,
        negative_prompt: generationSettings.negativePrompt || undefined,
        source_quality: 'max',
        quality: currentQuality,
      };

      // Source geometry and source textures always use maximum-fidelity generation settings.
      // UI poly/quality budgets apply only to downstream production artifacts.
      if (sourceQuality === 'ultra' && modelId.includes('triposr')) {
        modelParameters.mc_resolution = 320;
      } else if (sourceQuality === 'ultra' && (generationSettings.aiModel || '').includes('triposg')) {
        modelParameters.faces = -1;
        modelParameters.num_inference_steps = 50;
      } else if (sourceQuality === 'ultra' && modelId.includes('triposf')) {
        modelParameters.resolution = 1024;
        modelParameters.sample_points_num = 1638400;
      } else if (sourceQuality === 'ultra' && (generationSettings.aiModel || '').includes('partpacker')) {
        modelParameters.grid_resolution = 512;
        modelParameters.num_faces = -1;
      } else if (sourceQuality === 'ultra' && (generationSettings.aiModel || '').includes('ultrashape')) {
        modelParameters.octree_res = 1024;
        modelParameters.num_latents = 32768;
      } else if ((generationSettings.aiModel || '').includes('trellis2')) {
        modelParameters.decimation_target = -1;
        modelParameters.remesh = false;
        modelParameters.texture_size = 4096;
      } else if (modelId.includes('trellis')) {
        modelParameters.simplify = 0.0;
        modelParameters.ss_sampling_steps = modelId.includes('text_to_') ? 25 : 12;
        modelParameters.slat_sampling_steps = modelId.includes('text_to_') ? 25 : 12;
        modelParameters.texture_resolution = 2048;
      } else if (modelId.includes('hunyuan')) {
        modelParameters.octree_resolution = 512;
        modelParameters.enable_realesrgan = generationSettings.enableRealESRGAN !== false;
      }

      if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
        modelParameters.enable_flashvdm = true;
      }

      // Pass Paint-v2-1 parameters for shape models to enable auto-chaining
      if (isPaintModel) {
        modelParameters.max_num_view = generationSettings.maxNumView ?? 6;
        modelParameters.resolution = generationSettings.resolution ?? 512;
        modelParameters.auto_paint = true;
        modelParameters.paint_model_preference = 'hunyuan3d_paint_v21_image_mesh_painting';
        modelParameters.paint_resolution = generationSettings.resolution ?? 512;
      }

      const physicsForThisJob =
        Boolean(generationSettings.generateCollision) &&
        !(isPaintModel && generationSettings.generateTexture !== false);

      const cleanStem = (imageFileName || modelPrompt || 'asset')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'asset';

      const body: Record<string, unknown> = useMultiviewReconstruction
        ? {
            asset_id: generationSettings.multiviewAssetId || undefined,
            images: generationSettings.multiviewViews || undefined,
            model_preference: modelId || undefined,
            intent: generationSettings.intent,
            output_format: 'glb',
            model_parameters: modelParameters,
            quality: currentQuality,
            target_polycount: targetPoly,
            generateLOD: generationSettings.generateLOD !== false,
            lodPreset: generationSettings.lodPreset || 'high',
            lodCount: generationSettings.lodCount || 4,
            texture_resolution: isTextured ? requestedTextureResolution : undefined,
            physics_enabled: physicsForThisJob,
            physics_config: generationSettings.physics,
          }
        : {
            ...imageInput,
            asset_name: cleanStem,
            image_name: cleanStem,
            output_format: 'glb',
            model_preference: modelId || undefined,
            intent: generationSettings.intent,
            preprocessing_artifact_id: generationSettings.preprocessingArtifactId || undefined,
            enhancement_enabled: Boolean(generationSettings.enhancementEnabled),
            enable_printability_check: Boolean(generationSettings.enablePrintabilityCheck),
            enable_auto_repair: Boolean(generationSettings.enableAutoRepair),
            enable_auto_rig: Boolean(generationSettings.enableAutoRig),
            auto_rig_mode: generationSettings.autoRigMode || 'full',
            model_parameters: modelParameters,
            physics_enabled: physicsForThisJob,
            physics_config: generationSettings.physics,
            topology_mode: generationSettings.topologyMode || (generationSettings.quadTopology ? 'quad' : 'triangle'),
            quad_topology: Boolean(generationSettings.quadTopology || generationSettings.topologyMode === 'quad'),
            bake_normal_maps: generationSettings.bakeNormalMaps !== false,
          };

      if (!useMultiviewReconstruction && isTextured) {
        body.texture_resolution = requestedTextureResolution;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; status?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a generation job ID');
      bindBackendJob(localTaskId, jobId, { inputImage: imageToUse, inputImageName: modelPrompt, status: 'queued', currentStep: 'Queued on backend' });
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
        const resolved = await getApiClient().resolveSmartIntent(
          generationSettings.intent,
          generationSettings.aiModel || undefined,
        );
        effectiveModelId = resolved.model_id;
        effectiveSettings = {
          ...generationSettings,
          aiModel: effectiveModelId,
        };
      }

      // Route from the selected model's declared capabilities instead of forcing raw-mesh output.
      const selectedCapabilities = modelDetails[effectiveModelId]?.capabilities || {};
      const isRawModel = selectedCapabilities.raw_mesh === true || effectiveModelId.endsWith('_image_to_raw_mesh');
      const { endpoint, body } = buildGenerationParameters(
        effectiveSettings,
        {
          raw_mesh: isRawModel,
          paint_autochain: selectedCapabilities.paint_autochain === true,
          multiview: selectedCapabilities.multiview === true,
          supports_texture: selectedCapabilities.texture_generation ?? !isRawModel,
        },
        modelParameterDefaults[effectiveModelId] || {},
      );

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

    const runRemeshGeneration = useCallback(async () => {
      const localTaskId = startTask('remesh', 'Remesh / topology optimization', undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshFileId = currentAsset?.source?.fileId;
      const sourceMeshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || undefined;
      if (!sourceMeshUrl && !meshFileId) {
        throw new Error('No source mesh available for remeshing. Generate or import a model first.');
      }

      const body: Record<string, unknown> = {
        output_format: 'glb',
        model_preference: remeshSettings.variant === 'V4K'
          ? 'fastmesh_v4k_retopology'
          : 'fastmesh_v1k_retopology',
        poly_type: remeshSettings.polyType,
        target_polycount: remeshSettings.targetPolycount,
      };
      if (meshFileId) {
        body.mesh_file_id = meshFileId;
      } else {
        body.mesh_path = sourceMeshUrl;
      }

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
      const localTaskId = startTask('texture', 'Texture generation', undefined, textureSettings.modelId, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshFileId = currentAsset?.source?.fileId;
      const sourceMeshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || undefined;
      if (!sourceMeshUrl && !meshFileId) {
        throw new Error('No source mesh available for texturing. Generate or import a model first.');
      }

      const isTextPaintingModel = textureSettings.modelId === 'trellis_text_mesh_painting';
      const hasTexturePrompt = Boolean(textureSettings.prompt?.trim());
      const endpoint = (isTextPaintingModel || (hasTexturePrompt && !textureSettings.referenceImage))
        ? '/api/v1/mesh-generation/text-mesh-painting'
        : '/api/v1/mesh-generation/image-mesh-painting';

      const fallbackModel = endpoint.includes('text')
        ? 'trellis_text_mesh_painting'
        : 'trellis_image_mesh_painting';

      const isPaintModel = (textureSettings.modelId || fallbackModel).includes('paint_v21');
      const paintResolution = isPaintModel
        ? (textureSettings.paintResolution ?? 512)
        : undefined;

      const body: Record<string, unknown> = {
        texture_resolution: { '1K': 1024, '2K': 2048, '4K': 4096, '8K': 4096 }[textureSettings.resolution || '2K'],
        output_format: 'glb',
        model_preference: textureSettings.modelId || fallbackModel,
      };

      if (isPaintModel) {
        body.model_parameters = {
          max_num_view: textureSettings.maxNumView ?? 6,
          resolution: paintResolution ?? 512,
          enable_realesrgan: textureSettings.enableRealESRGAN !== false,
        };
      }

      if (textureSettings.generatePBR !== false) {
        body.generate_pbr = true;
      }

      if (meshFileId) {
        body.mesh_file_id = meshFileId;
      } else {
        body.mesh_path = sourceMeshUrl;
      }

      if (hasTexturePrompt) {
        body.text_prompt = textureSettings.prompt;
      } else {
        const refImageUrl = textureSettings.referenceImage || undefined;
        if (!refImageUrl) {
          throw new Error('No texture prompt or reference image provided. Please supply one.');
        }
        body.image_path = refImageUrl;
      }

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
      const meshFileId = currentAsset?.source?.fileId;
      const sourceMeshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || undefined;
      if (!sourceMeshUrl && !meshFileId) {
        throw new Error('No source mesh available for UV unwrapping. Generate or import a model first.');
      }

      const body: Record<string, unknown> = {
        distortion_threshold: customSettings?.distortionThreshold ?? 1.25,
        pack_method: customSettings?.packMethod || 'blender',
        save_individual_parts: customSettings?.saveIndividualParts ?? true,
        save_visuals: false,
        output_format: customSettings?.outputFormat || 'obj',
        model_preference: 'partuv_uv_unwrapping',
      };
      if (customSettings?.modelParameters) {
        body.model_parameters = customSettings.modelParameters;
      }

      if (meshFileId) {
        body.mesh_file_id = meshFileId;
      } else {
        body.mesh_path = sourceMeshUrl;
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
    const pref = (typeof customSettings === 'object' && customSettings?.modelPreference) || 'partfield_mesh_segmentation';
     const localTaskId = startTask('segment', `Mesh Segmentation (${pref.includes('p3sam') ? 'P3-SAM' : 'PartField'})`, undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshFileId = currentAsset?.source?.fileId;
      const sourceMeshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || undefined;
      if (!sourceMeshUrl && !meshFileId) {
        throw new Error('No source mesh available for segmentation. Generate or import a model first.');
      }

      const numParts = typeof customSettings === 'number' ? customSettings : (customSettings?.numParts ?? 8);
      const outputFormat = typeof customSettings === 'object' ? (customSettings.outputFormat ?? 'glb') : 'glb';

      const body: Record<string, unknown> = {
        num_parts: numParts,
        output_format: outputFormat,
        model_preference: pref,
      };
      if (typeof customSettings === 'object' && customSettings?.modelParameters) {
        body.model_parameters = customSettings.modelParameters;
      }

      if (meshFileId) {
        body.mesh_file_id = meshFileId;
      } else {
        body.mesh_path = sourceMeshUrl;
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
     const localTaskId = startTask('edit', customSettings?.mode === 'image' ? 'Mesh Editing (VoxHammer Image)' : 'Mesh Editing (VoxHammer Text)', undefined, undefined, undefined, undefined, comparisonGroupId ?? undefined);
    try {
      const meshFileId = currentAsset?.source?.fileId;
      const sourceMeshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || undefined;
      if (!sourceMeshUrl && !meshFileId) {
        throw new Error('No source mesh available for mesh editing. Generate or import a model first.');
      }

      const isImage = customSettings?.mode === 'image';
      const endpoint = isImage ? '/api/v1/mesh-editing/image-mesh-editing' : '/api/v1/mesh-editing/text-mesh-editing';

      const body: Record<string, unknown> = {
        num_views: 150,
        resolution: customSettings?.resolution || 512,
        output_format: customSettings?.outputFormat || 'glb',
        model_preference: isImage ? 'voxhammer_image_mesh_editing' : 'voxhammer_text_mesh_editing',
        mask_bbox: customSettings?.bbox || {
          center: [0.0, 0.45, -0.15],
          dimensions: [0.42, 0.36, 0.50],
        },
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

      if (meshFileId) {
        body.mesh_file_id = meshFileId;
      } else {
        body.mesh_path = sourceMeshUrl;
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

   const queueWorkflow = useCallback(async (workflow: Record<string, unknown>, type: ActiveTask['type'], title: string) => {
     startTask(type, title);
     try {
       // ponytail: the current 3DAIGC-API backend does not expose a generic
       // workflow queue endpoint. Surface the limitation honestly instead of
       // silently falling back to the obsolete /api/v1/generation route.
       throw new Error('Workflow queueing is not supported by the current backend. Use the dedicated generation endpoints instead.');
     } catch (e) {
       setExecutionStep(e instanceof Error ? e.message : 'Workflow failed');
       setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: 'Submission failed' } : null);
     }
   }, [startTask]);

   // Batch processing function
    const processBatchQueue = useCallback(async () => {
      const appStore = useAppStore();
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
         const batchSettings: GenerationSettings = {
           mode: 'image-to-3d',
           image: null, // We'll use imageFileId instead
           imageFileId: batchItem.imageFileId,
           aiModel: batchItem.aiModel,
           meshQuality: batchItem.meshQuality ?? 'high',
           textureQuality: batchItem.textureQuality ?? 'high',
           quadTopology: batchItem.quadTopology ?? false,
           topologyMode: batchItem.topologyMode ?? 'triangle',
           seed: batchItem.seed ?? 42891,
           guidanceScale: batchItem.guidanceScale ?? 7.5,
           removeBackground: batchItem.removeBackground ?? true,
           lowVram: batchItem.lowVram ?? false,
           vramMode: batchItem.vramMode ?? 'auto',
           autoOptimizeSettings: batchItem.autoOptimizeSettings ?? { targetPolycount: 50000 },
           generateTexture: batchItem.generateTexture ?? true,
           enableFlashVDM: batchItem.enableFlashVDM ?? false,
           lowVramMode: batchItem.lowVramMode ?? 'auto',
           maxNumView: batchItem.maxNumView ?? 6,
           resolution: batchItem.resolution ?? 1024,
           generateCollision: batchItem.generateCollision ?? true,
           enableRealESRGAN: batchItem.enableRealESRGAN ?? true,
           intent: batchItem.intent,
           preprocessingArtifactId: batchItem.preprocessingArtifactId,
           preprocessingPreviewUrl: null,
           preprocessingMetadata: batchItem.preprocessingMetadata,
           enhancementEnabled: false,
           enablePrintabilityCheck: false,
           enableAutoRepair: false,
           enableAutoRig: false,
           autoRigMode: 'full',
           physics: {
             bodyType: 'auto',
             massMode: 'auto',
             massKg: 1,
             densityMode: 'auto',
             densityKgM3: 500,
             friction: 0.5,
             restitution: 0.1,
             linearDamping: 0.05,
             angularDamping: 0.05,
             gravityEnabled: true,
             collisionQuality: 'balanced',
             deformation: 'off',
           },
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
             effectiveSettings = {
               ...batchSettings,
               aiModel: resolved.model_id,
             };
           } catch (intentError) {
             console.warn('Failed to resolve smart intent, using model directly:', intentError);
             // Continue with original settings
           }
         }

         // Build generation parameters using the existing function
         const modelCapabilities = {
           raw_mesh: false, // Default, would need to be looked up from model details
           paint_autochain: false,
           multiview: false,
           supports_texture: true
         };
         
         // In a real implementation, we would look up the actual model capabilities from modelDetails
         // For now, we'll use defaults and let buildGenerationParameters handle routing
         
         const { endpoint, body } = buildGenerationParameters(
           effectiveSettings,
           modelCapabilities,
           modelParameterDefaults[effectiveSettings.aiModel || ''] || {}
         );

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
    }, [useAppStore, modelDetails, modelParameterDefaults, startTask, bindBackendJob, getApiClient, parseApiError, parseApiData, buildGenerationParameters, toast]);

   // Cancel batch processing function
   const cancelBatchProcessing = useCallback(async () => {
     const appStore = useAppStore();
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
         try {
           // Try to cancel the job via the backend
           await fetch(`/api/v1/system/jobs/${encodeURIComponent(item.jobId)}`, {
             method: 'DELETE',
           });
         } catch (err) {
           // If we can't cancel via backend, we'll still update the item locally
           console.warn('Failed to cancel job via backend:', err);
         }
         
         // Update the batch queue item to cancelled
         updateBatchItem(item.id, {
           status: 'cancelled',
           completedAt: new Date(),
         });
         
         // Clean up the job ID map
         delete batchJobIdMap.current[item.jobId];
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
      const appStore = useAppStore();
      const { batchQueue } = appStore;
     
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
           meshQuality: undefined,
           textureQuality: undefined,
           quadTopology: undefined,
           topologyMode: undefined,
           seed: undefined,
           guidanceScale: undefined,
           removeBackground: undefined,
           lowVram: undefined,
           vramMode: undefined,
           autoOptimizeSettings: undefined,
           generateTexture: undefined,
           enableFlashVDM: undefined,
           lowVramMode: undefined,
           maxNumView: undefined,
           resolution: undefined,
           generateCollision: undefined,
           enableRealESRGAN: undefined,
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
    }, [useAppStore]);

  const navigateToTool = useCallback((tool: ToolType) => {
    setActiveTool(tool);
    setMainNav('workspace');
    mainNavRef.current = 'workspace';
    setIsLeftPanelOpen(true);
    const route = TOOL_TO_ROUTE[tool] || '/workspace/generate';
    if (!pathname?.startsWith('/workspace')) {
      router.push(route);
      return;
    }
    if (pathname !== route) {
      // Use replaceState instead of router.push to avoid full page remount.
      // This keeps the MeshViewer mounted while updating the URL.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', route);
      }
    }
  }, [pathname, router, setMainNav, setActiveTool, setIsLeftPanelOpen]);

  const navigateToMain = useCallback((nav: MainNavRoute) => {
    setMainNav(nav);
    mainNavRef.current = nav;
    if (nav === 'dashboard') router.push('/workspace/overview');
    else if (nav === 'assets') router.push('/workspace/assets');
    else if (nav === 'system') router.push('/workspace/system');
    else if (nav === 'settings') router.push('/settings');
    else if (nav === 'models') router.push('/admin?tab=models');
    else if (nav === 'jobs') router.push('/workspace/jobs');
  }, [router, setMainNav]);

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
     generate3DModel, generateImageTo3D,
     runModelGeneration: generate3DModel,
     runRemeshGeneration, runTextureGeneration,
     runUVUnwrapGeneration, runSegmentation,
     runMeshEditing,
     queueWorkflow,
     processBatchQueue,
     cancelBatchProcessing,
     retryFailedBatchItems,
   }), [generate3DModel, generateImageTo3D,
     runRemeshGeneration, runTextureGeneration,
     runUVUnwrapGeneration, runSegmentation,
     runMeshEditing,
     queueWorkflow,
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
