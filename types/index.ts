export type GenerationMode = 'image-to-3d';
export type QualityPreset = 'low-poly' | 'standard' | 'high-poly' | 'ultra' | 'draft';
export type GenerationStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'generating' | 'texturing' | 'completed' | 'failed' | 'cancelled';
export type ExportFormat = 'glb' | 'fbx' | 'obj' | 'stl';
export type ViewerMode = 'solid' | 'wireframe' | 'texture' | 'material';

export type WorkspaceType =
  | 'mesh-generation'
  | 'texture-generation'
  | 'remesh'
  | 'post-processing';

export interface GenerationConfig {
  mode: GenerationMode;
  prompt: string;
  referenceImage?: string;
  quality: QualityPreset;
  generateTexture: boolean;
  autoRig: boolean;
  negativePrompt?: string;
  stylePreset?: string;
  model?: string;
  steps?: number;
  cfgScale?: number;
  seed?: string;
  workspace?: WorkspaceType;
  low_vram?: boolean;
}

export interface GenerationResult {
  modelUrl: string;
  thumbnailUrl: string;
  polygonCount: number;
  vertexCount: number;
  textureResolution?: string;
  hasRig: boolean;
  downloadUrls: Partial<Record<ExportFormat, string>>;
  fileSize: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface GenerationJob {
  id: string;
  status: GenerationStatus;
  config: GenerationConfig;
  progress: number;
  estimatedSeconds: number;
  elapsedSeconds: number;
  logs: LogEntry[];
  result?: GenerationResult;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecentPrompt {
  id: string;
  text: string;
  mode: GenerationMode;
  thumbnailUrl?: string;
  createdAt: Date;
}

export interface BatchQueueItem {
  id: string;
  prompt: string;
  negativePrompt?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result?: GenerationResult;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ViewerState {
  mode: ViewerMode;
  autoRotate: boolean;
  showGrid: boolean;
  showWireframe: boolean;
  fullscreen: boolean;
  showStats: boolean;
}

export interface UploadedImage {
  file: File;
  preview: string;
  width: number;
  height: number;
  url?: string;
}

export interface Feature {
  title: string;
  description: string;
  icon: string;
  gradient: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success?: boolean;
}

export interface ProviderOption {
  id: string;
  label: string;
  available: boolean;
  vramMb?: number;
  description?: string;
  vram_required_mb?: number;
  supports_text_to_3d?: boolean;
  supports_image_to_3d?: boolean;
  low_vram_supported?: boolean;
  low_vram_required_mb?: number;
  workspace_compatibility?: WorkspaceType[];
  colab_incompatible?: boolean;
  colab_skip_reason?: string | null;
}

export interface RuntimeOptions {
  three_d_models: ProviderOption[];
  texture_models: ProviderOption[];
  render_qualities: ProviderOption[];
  resolutions: ProviderOption[];
  texture_resolutions?: ProviderOption[];
  output_formats: ProviderOption[];
  vram_limits: number[];
  gpu_options: ProviderOption[];
  active_provider: string;
  colab_detected?: boolean;
  colab_detected_vram_mb?: number;
  colab_preparation_limit_mb?: number | null;
}

export interface GpuInfo {
  index: number;
  name: string;
  vram_mb: number;
  vram_used_mb: number;
  utilization: number;
  temperature: number;
}

export interface RuntimeStatus {
  engine_initialized: boolean;
  cuda_available: boolean;
  cuda_version: string;
  driver_version: string;
  gpu_name: string;
  gpu_utilization: number;
  gpu_temp: number;
  vram_used_mb: number;
  vram_total_mb: number;
  cpu_usage: number;
  cpu_name: string;
  cpu_cores?: number;
  cpu_threads?: number;
  ram_usage: number;
  ram_total: number;
  os: string;
  network_in: number;
  network_out: number;
  storage_used_gb: number;
  storage_total_gb: number;
  blender_available: boolean;
  blender_version: string;
  repos_installed: number;
  repos_total: number;
  weights_downloaded: boolean;
  scheduler_running: boolean;
  workers: number;
  loaded_providers: string[];
  gpus: GpuInfo[];
}

export interface SystemVerification {
  cuda_available: boolean;
  gpu_detected: boolean;
  blender_available: boolean;
  repos_installed: boolean;
  weights_downloaded: boolean;
  issues: string[];
}

export interface AdminOverview {
  status: string;
  uptime: string;
  active_jobs: number;
  queued_jobs: number;
  completed_today: number;
  failed_today: number;
  success_rate: number;
  gpu_utilization: number;
  vram_used_mb: number;
  vram_total_mb: number;
  cpu_usage: number;
  cpu_name: string;
  cpu_cores?: number;
  cpu_threads?: number;
  ram_usage: number;
  ram_total: number;
  storage_used_gb: number;
  storage_total_gb: number;
  queue_running: boolean;
  gpu_temp?: number;
  cuda_available?: boolean;
}

export interface AdminLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  source: string;
}

export interface AdminJob {
  id: string;
  status: string;
  type: string;
  progress: number;
  created_at: string;
  completed_at?: string;
  error?: string;
  mode?: string;
  error_message?: string;
  provider?: string;
}

export interface AdminModel {
  id: string;
  label: string;
  name: string;
  category: string;
  type: string;
  installed: boolean;
  available: boolean;
  loaded: boolean;
  active: boolean;
  status: 'installed' | 'not-installed' | 'downloading' | 'error';
  size_estimate_gb?: number;
  size_mb: number;
  vram_required_mb?: number;
  supports_text_to_3d?: boolean;
  supports_image_to_3d?: boolean;
  supports_texture?: boolean;
  weight_path?: string;
  repo_path?: string;
  repo_ready?: boolean;
  venv_ready?: boolean;
  weights_ready?: boolean;
  colab_preparable?: boolean;
  install_block_reason?: string | null;
  hf_repo?: string;
  version?: string;
  download_progress?: InstallProgress;
  native_build?: {
    state: 'not_required' | 'pending' | 'running' | 'complete' | 'failed';
    task_id?: string;
    detail?: string;
    current_step?: string;
    output?: string;
  };
  auxiliary_weights?: Array<{
    name: string;
    repo: string;
    required: boolean;
    size_estimate_gb?: number;
    description?: string;
    state: 'ok' | 'missing';
    path?: string | null;
  }>;
}

export interface QueueStatus {
  active: number;
  queued: number;
  reserved: number;
  workers: number;
  scheduler_running: boolean;
}


export interface InstallProgress {
  model_id: string;
  phase: string;
  progress: number;
  percent: number;
  speed_mbps: number;
  speed_bps?: number;
  downloaded_mb: number;
  bytes_downloaded?: number;
  total_mb: number;
  bytes_total?: number;
  eta_seconds: number;
  status: 'idle' | 'starting' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'failed' | 'error';
  log?: string;
  error?: string;
}

export interface ProjectLayer {
  id: string;
  type: 'texture' | 'lod' | 'remesh' | 'part_separation';
  name: string;
  enabled: boolean;
  visible: boolean;
  data: any;
  sourceTab: string;
  timestamp: Date;
}

export interface ProjectAsset {
  id: string;
  name: string;
  modelUrl: string | null;
  modelData: any;
  layers: ProjectLayer[];
  metadata: {
    prompt: string;
    model: string;
    quality: string;
    createdAt: Date;
    thumbnailUrl?: string | null;
  };
}
