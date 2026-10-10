import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerationConfig, GenerationJob, GenerationMode, QualityPreset, ViewerState, ViewerMode, LogEntry, RecentPrompt, UploadedImage, InstallProgress, AdminJob, ProjectAsset, ProjectLayer, BatchQueueItem, GenerationResult } from '@/types';
import type { GenerationSettings } from '@/features/workspace/types';
import { getApiClient } from '@/services/apiClient';

export interface AppState {
  // ── Generation ──
  mode: GenerationMode;
  quality: QualityPreset;
  generateTexture: boolean;
  autoRig: boolean;
  lowVram: boolean;
  uploadedImage: UploadedImage | null;
  stylePreset: string;
  selectedModel: string;
  steps: number;
  cfgScale: number;
  seed: string;
  currentJob: GenerationJob | null;
  jobHistory: GenerationJob[];
  recentPrompts: RecentPrompt[];
  isLoadingHistory: boolean;
  loadingError: string | null;
  retryCount: number;
  generationSettings: GenerationSettings;
  loadHistory: () => Promise<void>;

  // ── Multi-View & References ──
  hdMode: 'hd' | 'smart';
  multiViewImages: {
    front: UploadedImage | null;
    left: UploadedImage | null;
    right: UploadedImage | null;
    back: UploadedImage | null;
  };
  referenceModel: { file: File | null; name: string; url: string; preview?: string; progress?: number } | null;

  // ── Batch Generation ──
  batchGenerationEnabled: boolean;
  batchQueue: BatchQueueItem[];

  // ── UI ──
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  mobileMenuOpen: boolean;
  mobileLeftSidebarOpen: boolean;
  mobileRightSidebarOpen: boolean;
  viewer: ViewerState;
  inspectorTab: string;
  bottomDockTab: string;
  creativeLayoutMode: boolean;
  capabilities: Record<string, boolean>;

  // ── Tasks ──
  tasks: Record<string, {
    id: string;
    type: 'generation' | 'download' | 'install' | 'render' | 'texture';
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    label: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, unknown>;
  }>;

  // ── Downloads ──
  downloads: Record<string, {
    id: string;
    name: string;
    type: string;
    size: number;
    downloaded: number;
    speed: number;
    status: 'downloading' | 'paused' | 'completed' | 'error' | 'queued';
    eta: number;
    priority: 'high' | 'normal' | 'low';
  }>;

  // ── Install Progress ──
  installProgress: Record<string, InstallProgress>;

  // ── Project ──
  currentProject: ProjectAsset | null;
  activeLayerId: string | null;
  isDirty: boolean;

  setProject: (project: ProjectAsset) => void;
  clearProject: () => void;
  addLayer: (layer: ProjectLayer) => void;
  removeLayer: (layerId: string) => void;
  toggleLayerEnabled: (layerId: string) => void;
  toggleLayerVisible: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<ProjectLayer>) => void;
  setActiveLayer: (layerId: string | null) => void;
  getEnabledLayers: () => ProjectLayer[];
  getVisibleLayers: () => ProjectLayer[];
  getLayerByType: (type: ProjectLayer['type']) => ProjectLayer | undefined;
  reorderLayers: (fromId: string, toId: string) => void;

  // ── Filters & Tabs ──
  activeSettingsSection: string;
  modelSearchQuery: string;
  modelCategoryFilter: string;
  jobFilter: string;

  // ── Actions ──
  setMode: (mode: GenerationMode) => void;
  setQuality: (quality: QualityPreset) => void;
  setGenerateTexture: (v: boolean) => void;
  setAutoRig: (v: boolean) => void;
  setLowVram: (v: boolean) => void;
  setUploadedImage: (img: UploadedImage | null) => void;
  setStylePreset: (s: string) => void;
  setSelectedModel: (m: string) => void;
  setSteps: (s: number) => void;
  setCfgScale: (c: number) => void;
  setSeed: (s: string) => void;
  setCurrentJob: (job: GenerationJob | null) => void;
  updateJobProgress: (jobId: string, progress: number, status: string) => void;
  addLogEntry: (jobId: string, message: string, level: LogEntry['level']) => void;
  cancelJob: () => void;
  addRecentPrompt: (prompt: RecentPrompt) => void;
  setJobHistory: (jobs: GenerationJob[]) => void;
  setIsLoadingHistory: (v: boolean) => void;
  setLoadingError: (error: string | null) => void;
  resetGeneration: () => void;

  setHDMode: (mode: 'hd' | 'smart') => void;
  setMultiViewImage: (view: 'front' | 'left' | 'right' | 'back', img: UploadedImage | null) => void;
  setReferenceModel: (model: AppState['referenceModel']) => void;

    // ── Batch Generation Actions ──
    setBatchGenerationEnabled: (batchGenerationEnabled) => void;
    setBatchQueue: (batchBatchQueue) => void;
    addToBatchQueue: (imageFileIds: string[]) => void;
    removeFromBatchQueue: (id: string) => void;
    clearBatchQueue: () => void;
    updateBatchItem: (id: string, updates: Partial<BatchQueueItem>) => void;

  setLeftSidebarCollapsed: (v: boolean) => void;
  setRightSidebarCollapsed: (v: boolean) => void;
  setBottomPanelCollapsed: (v: boolean) => void;
  setMobileMenuOpen: (v: boolean) => void;
  setMobileLeftSidebarOpen: (v: boolean) => void;
  setMobileRightSidebarOpen: (v: boolean) => void;
  setViewerMode: (mode: ViewerMode) => void;
  toggleAutoRotate: () => void;
  toggleGrid: () => void;
  toggleWireframe: () => void;
  toggleFullscreen: () => void;
  toggleStats: () => void;
  setInspectorTab: (tab: string) => void;
  setBottomDockTab: (tab: string) => void;
  toggleCreativeLayoutMode: () => void;
  setCapability: (cap: string, enabled: boolean) => void;

  setTask: (task: AppState['tasks'][string]) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;

  setDownload: (download: AppState['downloads'][string]) => void;
  removeDownload: (downloadId: string) => void;
  clearCompletedDownloads: () => void;

  setInstallProgress: (modelId: string, progress: InstallProgress) => void;
  clearInstallProgress: (modelId: string) => void;

  setActiveSettingsSection: (section: string) => void;
  setModelSearchQuery: (query: string) => void;
  setModelCategoryFilter: (category: string) => void;
  setJobFilter: (filter: string) => void;
}

type ActionKeys = {
  [K in keyof AppState]: AppState[K] extends (...args: any[]) => any ? K : never;
}[keyof AppState];
type AppStateData = Omit<AppState, ActionKeys>;

const DEFAULT_STATE: AppStateData = {
  mode: 'image-to-3d',
  quality: 'standard',
  generateTexture: true,
  autoRig: false,
  lowVram: false,
  uploadedImage: null,
  stylePreset: 'Realistic',
  selectedModel: '',
  steps: 30,
  cfgScale: 7.5,
  seed: '',
  currentJob: null,
  jobHistory: [],
  recentPrompts: [],
  isLoadingHistory: false,
  loadingError: null,
  retryCount: 0,
  generationSettings: {
    mode: 'image-to-3d' as const,
    image: null,
    imageFileId: null,
    aiModel: '',
    meshQuality: 'high',
    textureQuality: 'high',
    quadTopology: false,
    topologyMode: 'triangle',
    seed: 42891,
    guidanceScale: 7.5,
    removeBackground: true,
    lowVram: false,
    vramMode: 'auto',
    autoOptimizeSettings: { targetPolycount: 50000 },
    generateTexture: true,
    gameReady: false,
    targetPlatform: 'generic',
    generateLOD: false,
    lodPreset: 'high',
    lodCount: 4,
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
    generatePBR: true,
    bakeNormalMaps: false,
    bakeHighToLow: false,
    prompt: '',
    imageName: '',
    negativePrompt: '',
    multiviewImages: {
      front: null,
      right: null,
      back: null,
      left: null,
    },
    multiviewSourceFileId: null,
    multiviewJobId: null,
    multiviewAssetId: null,
    multiviewStatus: 'idle',
    multiviewViews: [],
    multiviewManifest: null,
    multiviewZipUrl: null,
    multiviewError: null,
    multiviewInputMode: 'upload',
    multiviewAdvanced: {
      inferenceSteps: 12,
      seed: 42891,
      saveContactSheet: false,
      transparentBackground: false,
      generateMasks: false,
      generateNormals: false,
      includeManifest: false,
    },
    enableFlashVDM: false,
    lowVramMode: 'auto',
    maxNumView: 6,
    resolution: 1024,
    paintResolution: 512,
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
  },

  hdMode: 'hd',
  multiViewImages: {
    front: null,
    left: null,
    right: null,
    back: null,
  },
  referenceModel: null,

  batchGenerationEnabled: false,
  batchQueue: [],

  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  bottomPanelCollapsed: false,
  mobileMenuOpen: false,
  mobileLeftSidebarOpen: false,
  mobileRightSidebarOpen: false,
  viewer: { mode: 'solid', autoRotate: false, showGrid: false, showWireframe: false, fullscreen: false, showStats: false },
  inspectorTab: 'scene',
  bottomDockTab: 'recent',
  creativeLayoutMode: true,
  capabilities: { threeDGen: true, remesh: true, textureGen: true },

  tasks: {},
  downloads: {},
  installProgress: {},

  activeSettingsSection: 'general',
  modelSearchQuery: '',
  modelCategoryFilter: 'All',
  jobFilter: 'all',

  // ── Project ──
  currentProject: null,
  activeLayerId: null,
  isDirty: false,
};

const PERSISTENCE_VERSION = 1;
const PERSISTENCE_KEY = 'ai3d:app-state';

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      // ── Generation Actions ──
      setMode: (mode) => set({ mode }),
      setQuality: (quality) => set({ quality }),
      setGenerateTexture: (generateTexture) => set({ generateTexture }),
      setAutoRig: (autoRig) => set({ autoRig }),
      setLowVram: (lowVram) => set({ lowVram }),
      setUploadedImage: (uploadedImage) => set({ uploadedImage }),
      setStylePreset: (stylePreset) => set({ stylePreset }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setSteps: (steps) => set({ steps }),
      setCfgScale: (cfgScale) => set({ cfgScale }),
      setSeed: (seed) => set({ seed }),
      setCurrentJob: (currentJob) => set({ currentJob }),
      updateJobProgress: (jobId, progress, status) =>
        set((s) => {
          if (!s.currentJob || s.currentJob.id !== jobId) return {};
          return { currentJob: { ...s.currentJob, progress, status: status as GenerationJob['status'], updatedAt: new Date() } };
        }),
      addLogEntry: (jobId, message, level) =>
        set((s) => {
          if (!s.currentJob || s.currentJob.id !== jobId) return {};
          const entry: LogEntry = { id: Math.random().toString(36).slice(2), timestamp: new Date(), level, message };
          return { currentJob: { ...s.currentJob, logs: [...s.currentJob.logs, entry] } };
        }),
      cancelJob: () =>
        set((s) => {
          if (!s.currentJob) return {};
          return { currentJob: { ...s.currentJob, status: 'cancelled', updatedAt: new Date() } };
        }),
      addRecentPrompt: (prompt) =>
        set((s) => ({ recentPrompts: [prompt, ...s.recentPrompts].slice(0, 10) })),
      setJobHistory: (jobHistory) => set({ jobHistory }),
      setIsLoadingHistory: (isLoadingHistory) => set({ isLoadingHistory }),
      setLoadingError: (loadingError) => set({ loadingError }),
      loadHistory: async () => {
        set({ isLoadingHistory: true, loadingError: null });
        try {
          const data = await getApiClient().get<{ jobs?: Array<Record<string, unknown>> }>('/api/v1/system/jobs/history?limit=50');
          const jobs: GenerationJob[] = (data.jobs ?? []).map((j) => ({
            id: (j.id ?? j.job_id ?? '') as string,
            status: (j.status ?? 'unknown') as GenerationJob['status'],
            config: (j.config ?? {}) as GenerationConfig,
            progress: (j.progress ?? 0) as number,
            estimatedSeconds: (j.estimated_seconds ?? 0) as number,
            elapsedSeconds: (j.elapsed_seconds ?? 0) as number,
            logs: (j.logs ?? []) as LogEntry[],
            result: (j.result_urls ?? j.result ?? {}) as GenerationResult | undefined,
            createdAt: (j.created_at ?? j.created ?? new Date()) as unknown as Date,
            updatedAt: (j.updated_at ?? j.updated ?? new Date()) as unknown as Date,
          }));
          set({ jobHistory: jobs, isLoadingHistory: false });
        } catch (err) {
          set({ loadingError: err instanceof Error ? err.message : 'Failed to load history', isLoadingHistory: false });
        }
      },
      resetGeneration: () =>
        set({
          mode: 'image-to-3d',
          quality: 'standard',
          generateTexture: true,
          autoRig: false,
          lowVram: false,
          uploadedImage: null,
          stylePreset: 'Realistic',
          selectedModel: '',
          steps: 30,
          cfgScale: 7.5,
          seed: '',
          currentJob: null,
        }),

      setHDMode: (hdMode) => set({ hdMode }),
      setMultiViewImage: (view, img) =>
        set((s) => ({
          multiViewImages: { ...s.multiViewImages, [view]: img },
        })),
      setReferenceModel: (referenceModel) => set({ referenceModel }),

      // ── Batch Generation Actions ──
      setBatchGenerationEnabled: (batchGenerationEnabled) => set({ batchGenerationEnabled }),
      setBatchQueue: (batchQueue) => set({ batchQueue }),
       addToBatchQueue: (imageFileIds) =>
         set((s) => {
           const newItems: BatchQueueItem[] = imageFileIds
             .filter((id) => id !== undefined && id !== null && id !== '')
             .map((imageFileId) => ({
               id: 'batch-' + Math.random().toString(36).slice(2, 9),
               imageFileId: imageFileId,
               preprocessingArtifactId: s.generationSettings.preprocessingArtifactId,
               preprocessingMetadata: s.generationSettings.preprocessingMetadata,
               aiModel: s.generationSettings.aiModel,
               intent: s.generationSettings.intent,
               status: 'queued',
               progress: 0,
               jobId: undefined,
               // Store the current generation settings
               meshQuality: s.generationSettings.meshQuality,
               textureQuality: s.generationSettings.textureQuality,
               quadTopology: s.generationSettings.quadTopology,
               topologyMode: s.generationSettings.topologyMode,
               seed: s.generationSettings.seed,
               guidanceScale: s.generationSettings.guidanceScale,
               removeBackground: s.generationSettings.removeBackground,
               lowVram: s.generationSettings.lowVram,
               vramMode: s.generationSettings.vramMode,
               autoOptimizeSettings: s.generationSettings.autoOptimizeSettings,
               generateTexture: s.generationSettings.generateTexture,
               enableFlashVDM: s.generationSettings.enableFlashVDM,
               lowVramMode: s.generationSettings.lowVramMode,
               maxNumView: s.generationSettings.maxNumView,
               resolution: s.generationSettings.resolution,
               generateCollision: s.generationSettings.generateCollision,
               enableRealESRGAN: s.generationSettings.enableRealESRGAN,
               enablePrintabilityCheck: s.generationSettings.enablePrintabilityCheck,
               enableAutoRepair: s.generationSettings.enableAutoRepair,
               enableAutoRig: s.generationSettings.enableAutoRig,
               autoRigMode: s.generationSettings.autoRigMode,
               createdAt: new Date(),
             }));
           return { batchQueue: [...s.batchQueue, ...newItems] };
         }),
      removeFromBatchQueue: (id) =>
        set((s) => ({
          batchQueue: s.batchQueue.filter((item) => item.id !== id),
        })),
      clearBatchQueue: () => set({ batchQueue: [] }),
      updateBatchItem: (id, updates) =>
        set((s) => ({
          batchQueue: s.batchQueue.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        })),

      // ── UI Actions ──
      setLeftSidebarCollapsed: (leftSidebarCollapsed) => set({ leftSidebarCollapsed }),
      setRightSidebarCollapsed: (rightSidebarCollapsed) => set({ rightSidebarCollapsed }),
      setBottomPanelCollapsed: (bottomPanelCollapsed) => set({ bottomPanelCollapsed }),
      setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
      setMobileLeftSidebarOpen: (mobileLeftSidebarOpen) => set({ mobileLeftSidebarOpen }),
      setMobileRightSidebarOpen: (mobileRightSidebarOpen) => set({ mobileRightSidebarOpen }),
      setViewerMode: (mode) => set((s) => ({ viewer: { ...s.viewer, mode } })),
      toggleAutoRotate: () => set((s) => ({ viewer: { ...s.viewer, autoRotate: !s.viewer.autoRotate } })),
      toggleGrid: () => set((s) => ({ viewer: { ...s.viewer, showGrid: !s.viewer.showGrid } })),
      toggleWireframe: () => set((s) => ({ viewer: { ...s.viewer, showWireframe: !s.viewer.showWireframe } })),
      toggleFullscreen: () => set((s) => ({ viewer: { ...s.viewer, fullscreen: !s.viewer.fullscreen } })),
      toggleStats: () => set((s) => ({ viewer: { ...s.viewer, showStats: !s.viewer.showStats } })),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setBottomDockTab: (bottomDockTab) => set({ bottomDockTab }),
      toggleCreativeLayoutMode: () => set((s) => ({ creativeLayoutMode: !s.creativeLayoutMode })),
      setCapability: (cap, enabled) =>
        set((s) => ({ capabilities: { ...s.capabilities, [cap]: enabled } })),

      // ── Task Actions ──
      setTask: (task) =>
        set((s) => ({ tasks: { ...s.tasks, [task.id]: task } })),
      removeTask: (taskId) =>
        set((s) => {
          const { [taskId]: _, ...rest } = s.tasks;
          return { tasks: rest };
        }),
      clearCompletedTasks: () =>
        set((s) => {
          const cleaned: AppState['tasks'] = {};
          for (const [id, task] of Object.entries(s.tasks)) {
            if (task.status !== 'completed' && task.status !== 'cancelled') {
              cleaned[id] = task;
            }
          }
          return { tasks: cleaned };
        }),

      // ── Download Actions ──
      setDownload: (download) =>
        set((s) => ({ downloads: { ...s.downloads, [download.id]: download } })),
      removeDownload: (downloadId) =>
        set((s) => {
          const { [downloadId]: _, ...rest } = s.downloads;
          return { downloads: rest };
        }),
      clearCompletedDownloads: () =>
        set((s) => {
          const cleaned: AppState['downloads'] = {};
          for (const [id, d] of Object.entries(s.downloads)) {
            if (d.status !== 'completed' && d.status !== 'error') {
              cleaned[id] = d;
            }
          }
          return { downloads: cleaned };
        }),

      // ── Install Progress Actions ──
      setInstallProgress: (modelId, progress) =>
        set((s) => ({ installProgress: { ...s.installProgress, [modelId]: progress } })),
      clearInstallProgress: (modelId) =>
        set((s) => {
          const { [modelId]: _, ...rest } = s.installProgress;
          return { installProgress: rest };
        }),

      // ── Filter & Tab Actions ──
      setActiveSettingsSection: (activeSettingsSection) => set({ activeSettingsSection }),
      setModelSearchQuery: (modelSearchQuery) => set({ modelSearchQuery }),
      setModelCategoryFilter: (modelCategoryFilter) => set({ modelCategoryFilter }),
      setJobFilter: (jobFilter) => set({ jobFilter }),

      // ── Project Actions ──
      setProject: (project) => set({ currentProject: project, isDirty: false, activeLayerId: null }),
      clearProject: () => set({ currentProject: null, activeLayerId: null, isDirty: false }),
      addLayer: (layer) =>
        set((s) => {
          if (!s.currentProject) return {};
          const existing = s.currentProject.layers.find(
            (l) => l.type === layer.type && l.sourceTab === layer.sourceTab
          );
          if (existing) {
            const updatedLayers = s.currentProject.layers.map((l) =>
              l.id === existing.id ? { ...layer, id: existing.id, timestamp: new Date() } : l
            );
            return {
              currentProject: { ...s.currentProject, layers: updatedLayers },
              isDirty: true,
            };
          }
          return {
            currentProject: {
              ...s.currentProject,
              layers: [...s.currentProject.layers, { ...layer, id: layer.id || Math.random().toString(36).slice(2, 10), timestamp: new Date() }],
            },
            isDirty: true,
          };
        }),
      removeLayer: (layerId) =>
        set((s) => {
          if (!s.currentProject) return {};
          return {
            currentProject: {
              ...s.currentProject,
              layers: s.currentProject.layers.filter((l) => l.id !== layerId),
            },
            isDirty: true,
            activeLayerId: s.activeLayerId === layerId ? null : s.activeLayerId,
          };
        }),
      toggleLayerEnabled: (layerId) =>
        set((s) => {
          if (!s.currentProject) return {};
          return {
            currentProject: {
              ...s.currentProject,
              layers: s.currentProject.layers.map((l) =>
                l.id === layerId ? { ...l, enabled: !l.enabled } : l
              ),
            },
            isDirty: true,
          };
        }),
      toggleLayerVisible: (layerId) =>
        set((s) => {
          if (!s.currentProject) return {};
          return {
            currentProject: {
              ...s.currentProject,
              layers: s.currentProject.layers.map((l) =>
                l.id === layerId ? { ...l, visible: !l.visible } : l
              ),
            },
            isDirty: true,
          };
        }),
      updateLayer: (layerId, updates) =>
        set((s) => {
          if (!s.currentProject) return {};
          return {
            currentProject: {
              ...s.currentProject,
              layers: s.currentProject.layers.map((l) =>
                l.id === layerId ? { ...l, ...updates } : l
              ),
            },
            isDirty: true,
          };
        }),
      setActiveLayer: (activeLayerId) => set({ activeLayerId }),
      getEnabledLayers: () => {
        const s = get();
        return s.currentProject?.layers.filter((l) => l.enabled) ?? [];
      },
      getVisibleLayers: () => {
        const s = get();
        return s.currentProject?.layers.filter((l) => l.visible) ?? [];
      },
      getLayerByType: (type) => {
        const s = get();
        return s.currentProject?.layers.find((l) => l.type === type);
      },
      reorderLayers: (fromId, toId) =>
        set((s) => {
          if (!s.currentProject) return {};
          const layers = [...s.currentProject.layers];
          const fromIdx = layers.findIndex((l) => l.id === fromId);
          const toIdx = layers.findIndex((l) => l.id === toId);
          if (fromIdx === -1 || toIdx === -1) return {};
          const [moved] = layers.splice(fromIdx, 1);
          layers.splice(toIdx, 0, moved);
          return { currentProject: { ...s.currentProject, layers }, isDirty: true };
        }),
    }),
    {
      name: PERSISTENCE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: PERSISTENCE_VERSION,
      partialize: (state) => ({
        // Generation state
        mode: state.mode,
        quality: state.quality,
        generateTexture: state.generateTexture,
        autoRig: state.autoRig,
        lowVram: state.lowVram,
        stylePreset: state.stylePreset,
        selectedModel: state.selectedModel,
        steps: state.steps,
        cfgScale: state.cfgScale,
        seed: state.seed,
        // Job history and runtime state are backend/in-memory concerns. Persist only
        // lightweight preferences so localStorage stays bounded and synchronous.
        recentPrompts: state.recentPrompts,
        // UI state
        leftSidebarCollapsed: state.leftSidebarCollapsed,
        rightSidebarCollapsed: state.rightSidebarCollapsed,
        bottomPanelCollapsed: state.bottomPanelCollapsed,
        viewer: state.viewer,
        inspectorTab: state.inspectorTab,
        bottomDockTab: state.bottomDockTab,
        creativeLayoutMode: state.creativeLayoutMode,
        capabilities: state.capabilities,
        // Tasks
        tasks: state.tasks,
        // Downloads
        downloads: state.downloads,
        // Install progress
        installProgress: state.installProgress,
        // Filters
        activeSettingsSection: state.activeSettingsSection,
        modelSearchQuery: state.modelSearchQuery,
        modelCategoryFilter: state.modelCategoryFilter,
        jobFilter: state.jobFilter,
        // Project
        currentProject: state.currentProject,
        activeLayerId: state.activeLayerId,
        isDirty: state.isDirty,
      }),
      migrate: (persisted: unknown, currentVersion) => {
        const defaults = { ...DEFAULT_STATE };
        if (typeof persisted !== 'object' || persisted === null) return defaults;
        const p = persisted as Record<string, unknown>;
        return {
          ...defaults,
          ...p,
          viewer: { ...defaults.viewer, ...(p.viewer as Record<string, unknown> ?? {}) },
          capabilities: { ...defaults.capabilities, ...(p.capabilities as Record<string, unknown> ?? {}) },
          tasks: (p.tasks as Record<string, unknown>) ?? {},
          downloads: (p.downloads as Record<string, unknown>) ?? {},
          installProgress: (p.installProgress as Record<string, unknown>) ?? {},
          currentProject: (p.currentProject as ProjectAsset | null) ?? null,
          activeLayerId: (p.activeLayerId as string | null) ?? null,
          isDirty: (p.isDirty as boolean) ?? false,
        } as AppState;
      },
    }
  )
);