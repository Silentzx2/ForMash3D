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
import { apiClient } from '../lib/api';
import { getApiClient } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import { useViewerStore, loadModelInViewer } from '@/stores/useViewerStore';
import { prefetchGLB } from '../lib/glbCache';
import { shadingModeToPreset, presetToShadingMode } from '@/lib/storeAdapter';
import { diagnoseJobError } from '@/lib/jobDiagnostics';
import { useRouter, usePathname } from 'next/navigation';

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
  generate3DModel: (forcedMode?: 'image-to-3d' | 'text-to-3d') => Promise<void>;
  generateImageTo3D: (customImage?: string) => Promise<void>;
  runModelGeneration: () => Promise<void>;
  runRemeshGeneration: () => Promise<void>;
  runTextureGeneration: () => Promise<void>;
  runUVUnwrapGeneration: (customSettings?: { distortionThreshold?: number; packMethod?: string; outputFormat?: string; saveIndividualParts?: boolean; modelParameters?: Record<string, any> }) => Promise<void>;
  runSegmentation: (customSettings?: { numParts?: number; method?: string; hierarchical?: boolean; outputFormat?: string; modelParameters?: Record<string, any>; modelPreference?: string } | number) => Promise<void>;
  runMeshEditing: (customSettings?: { sourcePrompt?: string; targetPrompt?: string; resolution?: number; bbox?: any; outputFormat?: string; mode?: 'text' | 'image'; targetImageFileId?: string; targetImageBase64?: string; strength?: number }) => Promise<void>;
  queueWorkflow: (workflow: Record<string, unknown>, type: ActiveTask['type'], title: string) => Promise<void>;
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
  vfx: '/vfx',
  tree: '/trees',
  building: '/buildings',
  assembly: '/assembly',
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
// Backend result URLs are absolute backend addresses; rewrite them to the
// same-origin /api/v1 proxy path so the browser can always reach them.
function toProxyUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  return url.replace(/^https?:\/\/[^/]+/, '');
}

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
  const modelUrl = toProxyUrl(raw.result?.mesh_url ?? raw.result?.model_url);
  return {
    status: raw.status,
    progress: Math.max(0, Math.min(100, Math.round(Number(raw.progress ?? 0) * 100))),
    stage: raw.stage || raw.status,
    message: raw.message || (raw.status === 'processing' ? 'Processing' : raw.status === 'queued' ? 'Queued' : undefined),
    error_message: typeof raw.error === 'string' ? raw.error : undefined,
    error_code: raw.error_code,
    logs: Array.isArray(raw.logs)
      ? raw.logs
      : Array.isArray(raw.metadata?.logs)
        ? raw.metadata.logs
        : undefined,
    result: modelUrl ? {
      ...raw.result,
      model_url: modelUrl,
      active_model_url: modelUrl,
      thumbnail_url: toProxyUrl(raw.result?.thumbnail_url),
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

  // React Query for System Stats
  const { data: polledSystemStats, refetch: queryRefetchSystemStats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: async () => {
      const stats = await apiClient.getSystemStats();
      return stats as unknown as SystemStats;
    },
    refetchInterval: 20000, // Poll every 20s
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
      const history = await apiClient.getHistory();
      return Object.entries(history).filter(([, h]) => h.status?.completed).map(([id, h], i) => {
        const rawPrompt = (h.prompt?.[1] as string)?.trim();
        const promptName = rawPrompt && !rawPrompt.startsWith('workflow:') && rawPrompt !== 'generate'
          ? (rawPrompt.charAt(0).toUpperCase() + rawPrompt.slice(1)).slice(0, 40)
          : null;
        const name = promptName || `Model_${id.slice(0, 8)}`;
        const outputs = (h.outputs || {}) as Record<string, any>;
        const outputUrl = (outputs.glb as string) || (outputs.model_url as string) || `/static/models/${id}/model.glb`;
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
        return normalizeModelAsset({
          id: m.file_id || m.filename,
          name: formattedName,
          category: 'mesh',
          meshType: 'custom',
          thumbnail: '',
          polygon_count: 0,
          vertex_count: 0,
          faces: 0,
          vertices: 0,
          triangles: 0,
          statsAvailable: false,
          source: { filename: m.filename, subfolder: '', type: 'upload', viewUrl: '' },
          topology: 'Triangle',
          format: m.file_type?.toUpperCase() || 'FILE',
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

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
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
  const jobsByIdRef = useRef(jobsById);
  jobsByIdRef.current = jobsById;
  const activeTaskRef = useRef<ActiveTask | null>(activeTask);
  activeTaskRef.current = activeTask;

  const dismissActiveTask = useCallback(() => setActiveTask(null), []);

  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>({
    mode: 'image-to-3d',
    image: null,
    aiModel: '', meshQuality: 'high', textureQuality: 'high',
    quadTopology: false, topologyMode: 'triangle', seed: 42891, guidanceScale: 7.5, removeBackground: true,
    lowVram: false,
    vramMode: 'auto',
    autoOptimizeSettings: { targetPolycount: 60000 },
    generateTexture: true,
    enableFlashVDM: false,
    lowVramMode: 'auto',
    maxNumView: 6,
    resolution: 1024,
    generateCollision: false,
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

  const [remeshSettings, setRemeshSettings] = useState<RemeshSettings>({
    tab: 'auto', variant: 'V4K', polyType: 'quad',
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

  const selectAsset = useCallback((id: string) => {
    setSelectedAssetId(id);
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
  }, [activeTask?.id]);

  const startTask = useCallback((type: ActiveTask['type'], title: string, promptId?: string, provider?: string, inputImage?: string, inputImageName?: string) => {
    const taskId = promptId ?? crypto.randomUUID();
    const task: ActiveTask = {
      id: taskId,
      type,
      title,
      startedAt: Date.now(),
      status: 'queued',
      progress: 0,
      currentStep: 'Queued',
      provider,
      inputImage,
      inputImageName,
    };
    setIsExecuting(true);
    setExecutionProgress(0);
    setExecutionStep('Queued');
    setActiveTask(task);
    setJobsById(prev => ({ ...prev, [taskId]: task }));
    return taskId;
  }, []);

  const bindBackendJob = useCallback((localTaskId: string, jobId: string, updates: Partial<ActiveTask> = {}) => {
    setJobsById(prev => {
      const task = prev[localTaskId] || activeTaskRef.current;
      if (!task) return prev;
      const next = { ...task, ...updates, id: jobId };
      const copy = { ...prev };
      delete copy[localTaskId];
      copy[jobId] = next;
      return copy;
    });
    setActiveTask(prev => prev && prev.id === localTaskId ? { ...prev, ...updates, id: jobId } : prev);
  }, []);

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
    const localTaskId = startTask('image-to-3d', modelPrompt, undefined, generationSettings.aiModel, imageToUse, imageFileName);

    const currentQuality = generationSettings.meshQuality || 'high';
    // Studio Ultra-HD pipeline: auto-tune to high-resolution voxel grid and diffusion steps
    const octreeRes =
      currentQuality === 'ultra' || currentQuality === 'high' ? 512 :
      currentQuality === 'medium' ? 384 : 256;
    const infSteps = currentQuality === 'ultra' ? 75 : 50;
    const infGuidance = generationSettings.guidanceScale ?? 7.5;

    try {
      // Route dynamically: raw models (Hunyuan3D Raw, PartPacker, UltraShape) must go to image-to-raw-mesh
      const selectedModel = modelDetails[generationSettings.aiModel || ''];
      const capabilities = selectedModel?.capabilities || {};
      const isRawModel = capabilities.raw_mesh === true;
      const isTextured = !isRawModel && generationSettings.generateTexture !== false;
      const isPaintModel = capabilities.paint_autochain === true;
      const endpoint = isTextured
        ? '/api/v1/mesh-generation/image-to-textured-mesh'
        : '/api/v1/mesh-generation/image-to-raw-mesh';

      // Resolve image input: prefer file_id from upload, fall back to base64 data URL
      const imageInput: Record<string, unknown> = {};
      if (generationSettings.imageFileId) {
        imageInput.image_file_id = generationSettings.imageFileId;
      } else if (typeof imageToUse === 'string' && imageToUse.startsWith('data:')) {
        imageInput.image_base64 = imageToUse;
      } else {
        throw new Error('No usable image input. Please upload an image first.');
      }

      const targetPoly = generationSettings.autoOptimizeSettings?.targetPolycount ?? 60000;
      const modelParameters: Record<string, unknown> = {
        octree_resolution: octreeRes,
        num_inference_steps: infSteps,
        guidance_scale: infGuidance,
        seed: generationSettings.seed ?? undefined,
        low_vram: Boolean(generationSettings.lowVram),
        enable_flashvdm: generationSettings.enableFlashVDM ?? false,
        low_vram_mode: generationSettings.lowVramMode ?? 'auto',
        auto_optimize: false,
        target_polycount: targetPoly,
        negative_prompt: generationSettings.negativePrompt || undefined,
      };

      // Model-specific extraction settings: keep generation high-resolution while reserving
      // decimation/retopology for post-processing. Values are conservative for the configured GPU budget.
      const extractionResolution = currentQuality === 'ultra' ? 512 : currentQuality === 'high' ? 384 : 256;
      if ((generationSettings.aiModel || '').includes('triposr')) {
        modelParameters.mc_resolution = extractionResolution;
      } else if ((generationSettings.aiModel || '').includes('triposf')) {
        modelParameters.resolution = extractionResolution;
      } else if ((generationSettings.aiModel || '').includes('partpacker')) {
        modelParameters.grid_resolution = currentQuality === 'ultra' ? 512 : currentQuality === 'high' ? 448 : 384;
        modelParameters.num_faces = -1;
      } else if ((generationSettings.aiModel || '').includes('ultrashape')) {
        modelParameters.octree_res = currentQuality === 'ultra' ? 640 : 512;
      } else if ((generationSettings.aiModel || '').includes('trellis2')) {
        modelParameters.decimation_target = -1;
        modelParameters.remesh = false;
      }

      // Pass Paint-v2-1 parameters for shape models to enable auto-chaining
      if (isPaintModel) {
        modelParameters.max_num_view = generationSettings.maxNumView ?? 6;
        modelParameters.resolution = generationSettings.resolution ?? 512;
      }

      const physicsForThisJob =
        Boolean(generationSettings.generateCollision) &&
        !(isPaintModel && generationSettings.generateTexture !== false);

      const body: Record<string, unknown> = {
        ...imageInput,
        output_format: 'glb',
        model_preference: generationSettings.aiModel,
        model_parameters: modelParameters,
        physics_enabled: physicsForThisJob,
        physics_config: generationSettings.physics,
        topology_mode: generationSettings.topologyMode || (generationSettings.quadTopology ? 'quad' : 'triangle'),
        quad_topology: Boolean(generationSettings.quadTopology || generationSettings.topologyMode === 'quad'),
      };

      if (isTextured) {
        body.texture_resolution = currentQuality === 'ultra' ? 4096 : 2048;
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

      // Shape → Paint automatic chaining: after Shape mesh is generated,
      // automatically trigger Paint-v2-1 texturing
      if (isPaintModel && generationSettings.generateTexture !== false) {
        // The Shape model generates a raw mesh; after completion, automatically
        // call image-mesh-painting with the Paint model
        // This is handled by the job system polling for completion
        // and triggering the Paint pipeline automatically
        console.log('Shape → Paint automatic chaining enabled for', generationSettings.aiModel);
      }
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
    generationSettings.image,
    generationSettings.imageFileId,
    generationSettings.negativePrompt,
    generationSettings.multiviewImages,
    generationSettings.aiModel,
    generationSettings.meshQuality,
    generationSettings.topologyMode,
    generationSettings.quadTopology,
    generationSettings.lowVram,
    generationSettings.vramMode,
    generationSettings.autoOptimizeSettings,
    generationSettings.generateTexture,
    generationSettings.gameReady,
    generationSettings.targetPlatform,
    generationSettings.generateLOD,
    generationSettings.lodPreset,
    generationSettings.lodCount,
    generationSettings.generateCollision,
    generationSettings.physics,
    generationSettings.generatePBR,
    generationSettings.seed,
    generationSettings.guidanceScale,
    generationSettings.enableFlashVDM,
    generationSettings.lowVramMode,
    generationSettings.maxNumView,
    generationSettings.resolution,
    generationSettings.paintResolution,
    generationSettings.generatePBR,
    startTask,
  ]);

  const generate3DModel = useCallback(async (forcedMode?: 'image-to-3d' | 'text-to-3d') => {
    const isTextMode = forcedMode === 'text-to-3d' || (!generationSettings.image && Boolean(generationSettings.prompt?.trim()));
    if (isTextMode) {
      const modelPrompt = generationSettings.prompt?.trim();
      if (!modelPrompt) {
        setExecutionStep('Please enter a text prompt first');
        toast.error('Prompt required', { description: 'Please enter a text prompt to generate a 3D model.' });
        return;
      }
      const localTaskId = startTask('text-to-3d', modelPrompt, undefined, generationSettings.aiModel, undefined, modelPrompt);

      const currentQuality = generationSettings.meshQuality || 'high';
      const octreeRes =
      currentQuality === 'ultra' || currentQuality === 'high' ? 512 :
      currentQuality === 'medium' ? 384 : 256;
      const infSteps = currentQuality === 'ultra' ? 75 : 50;
      const infGuidance = generationSettings.guidanceScale ?? 7.5;

      try {
        // ponytail: map UI generation settings to the real 3DAIGC-API contract.
        // POST /api/v1/mesh-generation/text-to-textured-mesh
        //   → { job_id, status, message }
        // text-to-raw-mesh is disabled because no text_to_raw_mesh model is registered.
        const isTextured = generationSettings.generateTexture !== false;
        if (!isTextured) {
          throw new Error('Text-to-raw mesh generation is not available. No text-to-raw model is registered in the backend.');
        }
        const endpoint = '/api/v1/mesh-generation/text-to-textured-mesh';

        const batchItems = appStore.batchGenerationEnabled
          ? appStore.batchQueue.filter(item => item.prompt?.trim())
          : [];

        const targetPoly = generationSettings.autoOptimizeSettings?.targetPolycount ?? 60000;
        const modelParameters: Record<string, unknown> = {
          octree_resolution: octreeRes,
          num_inference_steps: infSteps,
          guidance_scale: infGuidance,
          seed: generationSettings.seed ?? undefined,
          low_vram: Boolean(generationSettings.lowVram),
        enable_flashvdm: generationSettings.enableFlashVDM ?? false,
        low_vram_mode: generationSettings.lowVramMode ?? 'auto',
        auto_optimize: false,
          target_polycount: targetPoly,
          negative_prompt: generationSettings.negativePrompt || undefined,
        };

        if (batchItems.length > 0) {
          const batchResponse = await fetch('/api/v1/mesh-generation/text-to-textured-mesh/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: batchItems.map(item => ({
                text_prompt: item.prompt,
                negative_prompt: item.negativePrompt,
                model_preference: generationSettings.aiModel,
                texture_prompt: item.prompt,
                texture_resolution: currentQuality === 'ultra' ? 4096 : 2048,
                model_parameters: modelParameters,
                topology_mode: generationSettings.topologyMode || (generationSettings.quadTopology ? 'quad' : 'triangle'),
                quad_topology: Boolean(generationSettings.quadTopology || generationSettings.topologyMode === 'quad'),
              })),
              max_parallel: 2,
            }),
          });
          if (!batchResponse.ok) throw await parseApiError(batchResponse);

          const batchData = await parseApiData<{ batch_id: string; job_ids: string[] }>(batchResponse);
          if (!Array.isArray(batchData.job_ids) || batchData.job_ids.length === 0) {
            throw new Error('Backend did not return any batch job IDs');
          }

          const [firstJobId, ...otherJobIds] = batchData.job_ids;
          bindBackendJob(localTaskId, firstJobId, {
            status: 'queued',
            currentStep: 'Batch queued on backend',
          });

          if (otherJobIds.length > 0) {
            setJobsById(prev => {
              const next = { ...prev };
              otherJobIds.forEach((jobId, index) => {
                next[jobId] = {
                  id: jobId,
                  type: 'text-to-3d',
                  title: batchItems[index + 1]?.prompt || ('Batch item ' + (index + 2)),
                  startedAt: Date.now(),
                  status: 'queued',
                  progress: 0,
                  currentStep: 'Batch queued on backend',
                  provider: generationSettings.aiModel,
                };
              });
              return next;
            });
          }

          appStore.clearBatchQueue();
          setExecutionStep('Batch queued: ' + batchData.job_ids.length + ' jobs');
          return;
        }
        const body: Record<string, unknown> = {
          text_prompt: modelPrompt,
          output_format: 'glb',
          model_preference: generationSettings.aiModel,
          model_parameters: modelParameters,
          physics_enabled: Boolean(generationSettings.generateCollision),
          physics_config: generationSettings.physics,
          topology_mode: generationSettings.topologyMode || (generationSettings.quadTopology ? 'quad' : 'triangle'),
          quad_topology: Boolean(generationSettings.quadTopology || generationSettings.topologyMode === 'quad'),
        };

        if (isTextured) {
          body.texture_resolution = currentQuality === 'ultra' ? 4096 : 2048;
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
        setActiveTask(prev => prev ? { ...prev, id: jobId, inputImageName: modelPrompt, status: 'queued', currentStep: 'Queued on backend' } : prev);
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
      return;
    }
    return generateImageTo3D();
  }, [
    generationSettings.prompt,
    generationSettings.negativePrompt,
    generationSettings.multiviewImages,
    generationSettings.image,
    generationSettings.imageFileId,
    generationSettings.aiModel,
    generationSettings.meshQuality,
    generationSettings.topologyMode,
    generationSettings.quadTopology,
    generationSettings.lowVram,
    generationSettings.vramMode,
    generationSettings.autoOptimizeSettings,
    generationSettings.generateTexture,
    generationSettings.gameReady,
    generationSettings.targetPlatform,
    generationSettings.generateLOD,
    generationSettings.lodPreset,
    generationSettings.lodCount,
    generationSettings.generateCollision,
    generationSettings.physics,
    generationSettings.generatePBR,
    generationSettings.seed,
    generationSettings.guidanceScale,
    generationSettings.enableFlashVDM,
    generationSettings.lowVramMode,
    generationSettings.maxNumView,
    generationSettings.resolution,
    modelDetails,
    startTask,
    generateImageTo3D,
    bindBackendJob,
    appStore.batchGenerationEnabled,
    appStore.batchQueue,
    appStore.clearBatchQueue,
  ]);

  const runRemeshGeneration = useCallback(async () => {
    const localTaskId = startTask('remesh', 'Remesh / topology optimization');
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
    const localTaskId = startTask('texture', 'Texture generation', undefined, textureSettings.modelId);
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

   const runPaintAutoChaining = useCallback(async (shapeMeshFileId?: string) => {
     const localTaskId = startTask('texture', 'Paint-v2-1 Texturing', undefined, 'hunyuan3d_paint_v21_image_mesh_painting');
     try {
       if (!shapeMeshFileId) {
         throw new Error('Generated mesh file ID is missing; cannot start Paint-v2-1.');
       }
       const imageInput = generationSettings.imageFileId
         ? { image_file_id: generationSettings.imageFileId }
         : typeof generationSettings.image === 'string' && generationSettings.image.startsWith('data:')
         ? { image_base64: generationSettings.image }
         : null;
       if (!imageInput) {
         throw new Error('Original generation image input is unavailable; cannot start Paint-v2-1.');
       }

       const endpoint = '/api/v1/mesh-generation/image-mesh-painting';
       const body: Record<string, unknown> = {
         ...imageInput,
         mesh_file_id: shapeMeshFileId,
         output_format: 'glb',
         model_preference: 'hunyuan3d_paint_v21_image_mesh_painting',
         model_parameters: {
           max_num_view: textureSettings.maxNumView ?? 6,
           resolution: textureSettings.paintResolution ?? 512,
         },
         physics_enabled: Boolean(generationSettings.generateCollision),
         physics_config: generationSettings.physics,
       };

        if (generationSettings.generatePBR !== false) {
          body.generate_pbr = true;
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
        setExecutionStep('Paint-v2-1 texturing queued on backend');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Paint auto-chaining failed';
        setIsExecuting(false);
        setExecutionStep(message);
        toast.error('Paint auto-chaining failed', { description: message });
      }
    }, [textureSettings.maxNumView, textureSettings.paintResolution, generationSettings.image, generationSettings.imageFileId, generationSettings.generateTexture, generationSettings.generatePBR, generationSettings.generateCollision, generationSettings.physics, startTask]);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    const pollOtherJobs = async () => {
      const activeId = activeTaskRef.current?.id;
      const ids = Object.keys(jobsByIdRef.current).filter((id) => {
        const task = jobsByIdRef.current[id];
        return id !== activeId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
          task.status !== 'completed' &&
          task.status !== 'failed' &&
          task.status !== 'interrupted';
      });
      await Promise.all(ids.map(async (id) => {
        try {
          const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
          if (!res.ok) return;
          const data = normalizeBackendJob(await res.json());
          const status: ActiveTask['status'] =
            data.status === 'processing' ? 'running' :
            data.status === 'completed' ? 'completed' :
            data.status === 'failed' ? 'failed' :
            data.status === 'cancelled' ? 'interrupted' : 'queued';
          setJobsById(prev => {
            const task = prev[id];
            return task ? {
              ...prev,
              [id]: {
                ...task,
                status,
                progress: data.progress,
                currentStep: data.message || data.stage || task.currentStep,
                stage: data.stage || task.stage,
                logs: data.logs || task.logs,
                errorMessage: data.error_message || task.errorMessage,
                errorCode: (data as any).error_code || task.errorCode,
                result: data.result || task.result,
              },
            } : prev;
          });
        } catch {
          // Active-job polling is the authoritative UI path; secondary polling is best-effort.
        }
      }));
      if (!stopped) timer = window.setTimeout(() => void pollOtherJobs(), 1500);
    };

    void pollOtherJobs();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeTask?.id]);

  useEffect(() => {
    const task = activeTaskRef.current;
    if (!task) return;
    const postprocessStatus = (task.result as any)?.postprocess_status;
    const terminalButStillPostprocessing = task.status === 'completed' && (postprocessStatus === 'pending' || postprocessStatus === 'running');
    if ((task.status === 'completed' && !terminalButStillPostprocessing) || task.status === 'failed' || task.status === 'interrupted') return;
    const jobId = task.id;
    const isBackendJob = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
    if (!isBackendJob) return;

    let stopped = false;
    let timerId: number | null = null;

    const scheduleNext = (intervalMs: number) => {
      if (stopped) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => void poll(), intervalMs);
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (!res.ok) throw await parseApiError(res);
        const raw = await parseApiData<BackendJobPayload>(res);
        if (stopped) return;

        // Normalize backend job contract to the UI's expected shape:
        // - backend progress is 0..1 fraction, UI wants 0..100
        // - backend result.mesh_url → UI result.model_url / active_model_url
        // - backend result.thumbnail_url stays as thumbnail_url (rewritten to proxy path)
        // - backend error → UI error_message
        const data = normalizeBackendJob(raw);
        const result = data.result;

        const progress = Math.max(0, Math.min(100, Number(data.progress ?? 0)));
        const startedAt = activeTaskRef.current?.startedAt;
        const elapsedSec = startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
        const etaSec = progress > 1 && progress < 99 && elapsedSec > 2
          ? Math.max(1, Math.round(elapsedSec * ((100 - progress) / progress)))
          : undefined;
        const currentMsg = data.message || data.stage || 'Processing';
        setExecutionProgress(progress);
        setExecutionStep(currentMsg);
        setActiveTask(prev => prev ? {
          ...prev,
          progress,
          currentStep: currentMsg,
          result: data.result || prev.result,
          errorCode: (data as any).error_code || prev.errorCode,
          stage: data.stage || prev.stage,
          estimatedRemainingSec: etaSec,
          logs: data.logs || prev.logs,
        } : null);

        if (data.status === 'completed') {
          const alreadyMarkedCompleted = activeTaskRef.current?.status === 'completed';
          const priorPostprocessStatus = (activeTaskRef.current?.result as any)?.postprocess_status;
          const currentPostprocessStatus = data.result?.postprocess_status;
          const postprocessPending = currentPostprocessStatus === 'pending' || currentPostprocessStatus === 'running';

          if (postprocessPending) {
            setIsExecuting(true);
            const postprocessFrac = Math.min(96, Math.max(progress, 75));
            setExecutionProgress(postprocessFrac);
            setExecutionStep(currentMsg || 'Finishing production post-processing...');
            setActiveTask(prev => prev ? {
              ...prev,
              status: 'running',
              progress: postprocessFrac,
              currentStep: currentMsg || 'Finishing production post-processing...',
              logs: data.logs || prev.logs,
              result: data.result || prev.result,
              stage: data.stage || 'postprocess',
            } : null);
            scheduleNext(document.visibilityState === 'hidden' ? 2500 : 1100);
            return;
          }

          const postprocessFailed =
            currentPostprocessStatus === 'failed' && priorPostprocessStatus !== 'failed';
          const postprocessJustCompleted =
            currentPostprocessStatus === 'completed' && priorPostprocessStatus !== 'completed';
          const shouldHydrateAsset = !alreadyMarkedCompleted || postprocessJustCompleted;

          setIsExecuting(false);
          setExecutionProgress(100);
          setExecutionStep(
            postprocessFailed
              ? 'Production post-processing failed; raw result retained'
              : 'Completed'
          );
          setActiveTask(prev => prev ? {
            ...prev,
            status: 'completed',
            progress: 100,
            currentStep: postprocessFailed
              ? 'Production post-processing failed; raw result retained'
              : 'Completed',
            logs: data.logs || prev.logs,
            result: data.result || prev.result,
            stage: 'completed',
            errorCode: (data as any).error_code || prev.errorCode,
          } : null);

          if (shouldHydrateAsset && (result?.model_url || result?.active_model_url)) {
            const currentLatestTask = activeTaskRef.current || task;
            const modelUrl = (result.active_model_url || result.model_url) as string;
            const promptTitle =
              currentLatestTask.title &&
              currentLatestTask.title !== 'Image-to-3D generation' &&
              currentLatestTask.title !== 'generate'
                ? currentLatestTask.title
                : null;
            const rawName =
              promptTitle ||
              currentLatestTask.inputImageName ||
              (currentLatestTask.inputImage
                ? currentLatestTask.inputImage
                    .split('/')
                    .pop()
                    ?.replace(/\.[^/.]+$/, '')
                    .replace(/[-_]/g, ' ')
                : null) ||
              `Model_${jobId.slice(0, 6)}`;
            const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

            void prefetchGLB(modelUrl);

            const qaReport = (result as any).qa_report;
            const qaScore =
              typeof qaReport?.score === 'number'
                ? Math.round(qaReport.score)
                : typeof qaReport?.game_ready_score === 'number'
                  ? Math.round(qaReport.game_ready_score)
                  : undefined;
            const qaStatus =
              qaReport?.status ??
              (qaScore !== undefined
                ? qaScore >= 80
                  ? 'pass'
                  : qaScore >= 60
                    ? 'warn'
                    : 'fail'
                : undefined);
            const qaWarnings =
              qaReport?.warnings ??
              (Array.isArray(qaReport?.checks)
                ? qaReport.checks
                    .filter((check: any) => check?.status === 'warn' || check?.status === 'fail')
                    .map((check: any) => check?.detail || check?.label)
                    .filter(Boolean)
                : []);

            const outputAsset = normalizeModelAsset({
              id: jobId,
              name: cleanName,
              category: 'generation',
              thumbnail: result.thumbnail_url || '',
              polygon_count: result.polygon_count,
              vertex_count: result.vertex_count,
              faces: result.polygon_count ?? 0,
              vertices: result.vertex_count ?? 0,
              triangles: result.polygon_count ?? 0,
              statsAvailable: ((result.polygon_count ?? 0) > 0 || (result.vertex_count ?? 0) > 0),
              source: { filename: `${cleanName || jobId}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl },
              topology: (result.topology as any) || 'Triangle',
              format: 'GLB',
              dimensions: result.dimensions,
              boundingBox: result.bounding_box,
              objectCount: result.object_count,
              componentCount: result.component_count,
              materialCount: result.material_count,
              meshDetails: (result.mesh_details || result.segmentation_info)
                ? {
                    ...(result.mesh_details || {}),
                    ...(result.segmentation_info
                      ? { segmentation_info: result.segmentation_info }
                      : {}),
                  }
                : undefined,
              postprocessStatus: result.postprocess_status || data.status,
              dateCreated: new Date().toISOString().split('T')[0],
              tags: ['AI Generated'],
              meshType: 'custom',
              artifacts: {
                source: (result as any).source_model_url,
                gameReady: (result as any).game_ready_url,
                lods: (result as any).lod_urls,
                collision: (result as any).collision_url,
                qaReport,
                pbrMaps: (result as any).pbr_maps,
                gameReadyFormats: (result as any).game_ready_formats,
                zipUrl: (result as any).zip_url,
                physicsUrl: (result as any).physics_url,
                physicsReady: Boolean((result as any).physics_ready),
                physics: (result as any).physics,
              },
              qaScore,
              qaStatus,
              qaWarnings,
            });
            addAsset(outputAsset);
            setSelectedAssetId(outputAsset.id);
            setViewportResetTrigger(prev => prev + 1);
            loadModelInViewer(modelUrl, cleanName, outputAsset as any);
          }

          if (!alreadyMarkedCompleted) {
            if (postprocessFailed) {
              toast.error(
                'Production post-processing failed',
                {
                  description:
                    (result as any)?.postprocess_error ||
                    'The raw generated model is retained; production artifacts were not completed.',
                }
              );
            } else {
              toast.success(
              'Generation complete',
              {
                description: postprocessPending
                  ? 'The raw 3D model is ready; production processing is finishing in the background.'
                  : 'The 3D model is ready and loaded in the viewer.',
              }
            );

            const latestTask = activeTaskRef.current || task;
              if (
                modelDetails[latestTask?.provider || '']?.capabilities?.paint_autochain === true &&
                generationSettings.generateTexture !== false
              ) {
                void runPaintAutoChaining(
                  typeof data.result?.file_id === 'string'
                    ? data.result.file_id
                    : undefined
                );
              }
            }
          }

          return;
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          const currentLatestTask = activeTaskRef.current || task;
          const message = data.error_message || data.message || (data.status === 'cancelled' ? 'Generation cancelled' : 'Generation failed');
          setIsExecuting(false);
          setExecutionStep(message);
          const diagnostic = data.status === 'failed' ? diagnoseJobError({
            id: jobId,
            status: 'failed',
            error: message,
            error_message: message,
            provider: currentLatestTask.provider || '',
          } as any) : null;
          setActiveTask(prev => prev ? {
            ...prev,
            status: data.status === 'cancelled' ? 'interrupted' : 'failed',
            currentStep: message,
            errorMessage: message,
            diagnostic,
            progress,
            logs: data.logs || prev.logs,
          } : null);
          if (data.status === 'failed') toast.error('Generation failed', { description: message });
          return;
        }

        // Keep telemetry responsive without creating a polling storm; pause aggressively while the tab is hidden.
        if (document.visibilityState === 'hidden') {
          scheduleNext(2500);
        } else {
          const fastStage = data.stage === 'generating' || data.stage === 'texturing';
          const postStage = data.stage === 'postprocess' || data.stage === 'repair' || data.stage === 'optimize' ||
            data.stage === 'uv' || data.stage === 'game_ready' || data.stage === 'lod' ||
            data.stage === 'collision' || data.stage === 'qa';
          const nextInterval = fastStage ? 700 : postStage ? 1100 : progress > 0 ? 1600 : 2200;
          scheduleNext(nextInterval);
        }
      } catch (error) {
        if (stopped) return;
        if (error instanceof Error) setExecutionStep(`Syncing job status… ${error.message}`);
        scheduleNext(document.visibilityState === 'hidden' ? 3000 : 1800);
      }
    };

    const handleVisibilityChange = () => {
      if (!stopped && document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      if (timerId) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTask?.id, activeTask?.status, addAsset, runPaintAutoChaining, generationSettings.generateTexture]);

   const runUVUnwrapGeneration = useCallback(async (customSettings?: {
    distortionThreshold?: number;
    packMethod?: string;
    outputFormat?: string;
    saveIndividualParts?: boolean;
    modelParameters?: Record<string, any>;
  }) => {
    const localTaskId = startTask('uv', 'UV Unwrapping (PartUV)');
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
    const localTaskId = startTask('segment', `Mesh Segmentation (${pref.includes('p3sam') ? 'P3-SAM' : 'PartField'})`);
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
    const localTaskId = startTask('edit', customSettings?.mode === 'image' ? 'Mesh Editing (VoxHammer Image)' : 'Mesh Editing (VoxHammer Text)');
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
    else if (nav === 'settings') router.push('/admin?tab=settings');
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
  }), [activeTask, jobsById, dismissActiveTask,
    isExecuting, executionProgress, executionStep, cancelExecution]);

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
  }), [generate3DModel, generateImageTo3D,
    runRemeshGeneration, runTextureGeneration,
    runUVUnwrapGeneration, runSegmentation,
    runMeshEditing,
    queueWorkflow]);

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
