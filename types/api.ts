// Base API Response Types
export interface BaseApiResponse {
  job_id?: string;
  status: JobStatus;
  message: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  detail?: string;
}

// Job Management Types
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobInfo {
  job_id: string;
  status: JobStatus;
  created_at: string;
  completed_at?: string;
  processing_time?: number;
  model_preference?: string;
  progress?: number;
  stage?: string;
  message?: string;
  logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
  error?: string | null;
  result?: {
    output_mesh_path?: string;
    thumbnail_path?: string;
    mesh_url?: string;
    model_url?: string;
    active_model_url?: string;
    thumbnail_url?: string;
    source_model_url?: string;
    high_fidelity_url?: string;
    game_ready_url?: string;
    zip_url?: string;
    asset_root?: string;
    postprocess_status?: string;
    production_status?: 'ready' | 'degraded' | 'failed' | string;
    degraded_reasons?: string[];
    generation_info?: {
      model_used: string;
      parameters: Record<string, any>;
      thumbnail_generated?: boolean;
    };
    quality_mode?: string;
    target_polycount?: number;
    texture_resolution?: number;
    master_to_derivative?: Record<string, any>;
    quality_trace?: Record<string, any>;
    lod_validation?: Record<string, any>;
    artifacts?: Record<string, any>;
    [key: string]: any;
  };
  input_image_url?: string;
  input_image_file_info?: {
    filename: string;
    file_size_bytes: number;
    file_size_mb: number;
    content_type: string;
    file_extension: string;
  };
}

export interface JobResultInfo {
  job_id: string;
  status: JobStatus;
  file_info: {
    file_exists: boolean;
    file_size_mb: number;
    file_extension: string;
    content_type: string;
  };
  generation_info: {
    model_used: string;
    processing_time: number;
  };
  mesh_download_urls: {
    direct_download: string;
    base64_download: string;
  };
  thumbnail_download_urls: {
    direct_download: string;
    base64_download: string;
  };
  result_metadata?: Record<string, any>;
}

// Jobs History Types
export interface HistoricalJob {
  job_id: string;
  status: JobStatus;
  feature: string;
  created_at: string;
  completed_at?: string;
  model_preference?: string;
  processing_time?: number;
  output_mesh_path?: string;
  thumbnail_path?: string;
  mesh_url?: string;
  thumbnail_url?: string;
  production_status?: 'ready' | 'degraded' | 'failed' | string;
  degraded_reasons?: string[];
  high_fidelity_url?: string;
  game_ready_url?: string;
  quality_mode?: string;
  target_polycount?: number;
  texture_resolution?: number;
  input_image_url?: string;
  input_image_file_info?: {
    filename: string;
    file_size_bytes: number;
    file_size_mb: number;
    content_type: string;
    file_extension: string;
  };
}

export interface JobsHistoryPagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface JobsHistoryFilters {
  status?: JobStatus | null;
  feature?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface JobsHistoryResponse {
  jobs: HistoricalJob[];
  pagination: JobsHistoryPagination;
  filters: JobsHistoryFilters;
  timestamp: number;
}

export interface JobsHistoryParams {
  limit?: number;
  offset?: number;
  status?: JobStatus;
  feature?: string;
  start_date?: string;
  end_date?: string;
}

// System Status Types
export interface SystemStatus {
  timestamp: string;
  status?: string;
  system: {
    cpu_usage: number;
    memory: {
      total: number;
      available: number;
      used: number;
      percent: number;
    };
    disk: {
      total: number;
      free: number;
      used: number;
      percent: number;
    };
  };
  gpu: Array<{
    id: number;
    name: string;
    memory_total: number;
    memory_used: number;
    memory_free: number;
    memory_utilization: number;
    gpu_utilization: number;
    temperature: number;
  }>;
  models: {
    loaded: number;
    available: number;
    total_vram_used: number;
  };
  queue: {
    pending_jobs: number;
    processing_jobs: number;
    completed_jobs: number;
  };
  // Flat properties used by admin/runtime components
  gpu_utilization?: number;
  vram_used_mb?: number;
  vram_total_mb?: number;
  cpu_usage?: number;
  cpu_name?: string;
  cpu_cores?: number;
  cpu_threads?: number;
  ram_usage?: number;
  ram_total?: number;
  storage_used_gb?: number;
  storage_total_gb?: number;
  gpu_temp?: number;
  cuda_available?: boolean;
  gpus?: Array<{
    index: number;
    name: string;
    vram_mb: number;
    vram_used_mb: number;
    utilization: number;
    temperature: number;
  }>;
}

export interface SchedulerStatus {
  scheduler: {
    running: boolean;
    queue_status: {
      queued_jobs: number;
      processing_jobs: number;
      completed_jobs: number;
    };
    gpu_status: Array<{
      id: number;
      memory_used: number;
      memory_total: number;
    }>;
    models: Record<string, {
      status: string;
      vram_usage: number;
    }>;
  };
  adapters_registered: number;
  active_jobs: number;
  queued_jobs: number;
  completed_jobs: number;
}

// Available Models Types
export interface ModelRuntimeDetails {
  id: string;
  feature: string;
  status: 'ready' | 'weights_missing' | 'gpu_unavailable' | string;
  weights_available: boolean;
  weights_downloadable: boolean;
  readiness_reason: string;
  cuda_available: boolean;
  vram_requirement?: number | null;
  max_workers?: number | null;
  supported_inputs?: string[];
  supported_outputs?: string[];
  model_path?: string | null;
  capabilities?: Record<string, any>;
}

export interface AvailableModels {
  available_models: Record<string, string[]>;
  weights_status?: Record<string, boolean>;
  model_details?: Record<string, ModelRuntimeDetails>;
  total_features: number;
  total_models: number;
}

export interface FeatureInfo {
  name: string;
  model_count: number;
  models: string[];
}

export interface FeaturesResponse {
  features: FeatureInfo[];
  total_features: number;
}

// File Upload Types - NEW
export interface FileUploadResponse {
  file_id: string;
  filename: string;
  file_type: 'image' | 'mesh';
  file_size_mb: number;
  upload_time: string;
  expires_at: string;
  url?: string;
}

export interface FileMetadata {
  file_id: string;
  filename: string;
  file_type: 'image' | 'mesh';
  file_size_mb: number;
  upload_time: string;
  expires_at: string;
  is_available: boolean;
}

// Mesh Generation Types - UPDATED
export interface ImageToMeshRequest {
  image_path?: string;
  image_base64?: string;
  image_file_id?: string; // preferred method
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
  intent?: 'game_ready' | 'cinematic' | 'animation' | '3d_print' | 'mobile';
  preprocessing_artifact_id?: string;
  enhancement_enabled?: boolean;
  enable_printability_check?: boolean;
  enable_auto_repair?: boolean;
  enable_auto_rig?: boolean;
  auto_rig_mode?: 'skeleton' | 'skin' | 'full';

}

export interface ImageToTexturedMeshRequest {
  image_path?: string;
  image_base64?: string;
  image_file_id?: string; // preferred method
  texture_image_path?: string;
  texture_image_base64?: string;
  texture_image_file_id?: string; //preferred method
  texture_resolution?: number;
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
  intent?: 'game_ready' | 'cinematic' | 'animation' | '3d_print' | 'mobile';
  preprocessing_artifact_id?: string;
  enhancement_enabled?: boolean;
  enable_printability_check?: boolean;
  enable_auto_repair?: boolean;
  enable_auto_rig?: boolean;
  auto_rig_mode?: 'skeleton' | 'skin' | 'full';

}

export interface MeshPaintingRequest {
  text_prompt?: string;
  image_path?: string;
  image_base64?: string;
  image_file_id?: string; // preferred method
  mesh_path?: string;
  mesh_base64?: string;
  mesh_file_id?: string; // preferred method
  texture_resolution?: number;
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

export interface PartCompletionRequest {
  mesh_path?: string;
  mesh_base64?: string;
  mesh_file_id?: string; // preferred method
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

// Mesh Segmentation Types - UPDATED
export interface MeshSegmentationRequest {
  mesh_path?: string;
  mesh_base64?: string;
  mesh_file_id?: string; // preferred method
  // num_parts: number;
  output_format: 'glb' | 'json';
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

// Auto Rigging Types - UPDATED
export interface AutoRiggingRequest {
  mesh_path?: string;
  mesh_file_id?: string; // preferred method
  rig_mode: 'skeleton' | 'skin' | 'full';
  output_format: 'fbx' | 'glb';
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

// Motion Generation Types
export interface MotionGenerationRequest {
  prompt: string;
  duration?: number;
  seed?: number | null;
  output_format?: 'json' | 'bvh';
  model_preference?: string;
  model_parameters?: {
    checkpoint?: string;
    post_process?: boolean;
    num_steps?: number;
    guidance_scale?: number;
    [key: string]: any;
  };
}

export interface MotionCheckpointsResponse {
  checkpoints: string[];
  default: string;
}

export interface MotionAvailableModelsResponse {
  models: Array<{
    id: string;
    name: string;
    description: string;
    vram_requirement_mb: number;
    device_support: string[];
    supported_formats: string[];
  }>;
}

// Mesh Retopology Types
export interface MeshRetopologyRequest {
  mesh_file_id : string; // preferred method
  target_vertex_count?: number;
  poly_type?: 'tri' | 'quad';
  output_format: OutputFormat;
  seed?: number;
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

export interface RetopologyAvailableModels {
  available_models: string[];
  models_details: {
    [key: string]: {
      description: string;
      target_vertices: number;
      recommended_for: string;
    };
  };
}

// Mesh UV Unwrapping Types
export interface MeshUVUnwrappingRequest {
  mesh_file_id : string; // preferred method
  distortion_threshold?: number;
  pack_method?: 'blender';
  save_individual_parts?: boolean;
  save_visuals?: boolean;
  output_format: 'obj' | 'glb';
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

export interface UVUnwrappingAvailableModels {
  available_models: string[];
  models_details: {
    [key: string]: {
      description: string;
      method: string;
      features: string[];
      recommended_for: string;
    };
  };
}

export interface UVPackMethods {
  pack_methods: {
    [key: string]: {
      description: string;
      requirements: string;
      speed: string;
      features?: string[];
    };
  };
}

// Legacy Upload Types (keeping for backward compatibility)
export interface UploadResponse {
  file_id?: string;
  filename?: string;
  file_path?: string;
  original_filename?: string;
  file_type?: string;
  file_size_mb?: number;
  size?: number;
  content_type?: string;
  message?: string;
}

// Supported Formats Types
export interface SupportedFormats {
  input_formats: {
    text?: string[];
    image?: string[];
    mesh?: string[];
    base64?: string[];
  };
  output_formats: {
    mesh?: string[];
    texture?: string[];
  };
  upload_limits?: {
    image_max_size_mb: number;
    mesh_max_size_mb: number;
    image_max_resolution: [number, number];
  };
}

// Common Types
export type OutputFormat = 'glb' | 'obj' | 'fbx' | 'ply';
export type ImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'bmp' | 'tiff';

// Health Check Types
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
}

// File Upload Types
export interface FileUploadOptions {
  accept?: string;
  maxSize?: number;
  multiple?: boolean;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

// API Client Configuration
export interface ApiConfig {
  baseURL: string;
  timeout?: number;
  apiKey?: string;
  retries?: number;
}

// Authentication Types
export interface AuthStatus {
  user_auth_enabled: boolean;
  api_key_required: boolean;
  mode: 'simple' | 'authenticated' | 'api_key';
  description: string;
  features: {
    job_isolation: boolean;
    user_management: boolean;
    role_based_access: boolean;
  };
  timestamp: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    user_id: string;
    username: string;
    email: string;
    role: string;
  };
  message: string;
}

export interface UserInfo {
  user_id: string;
  username: string;
  email: string;
  role: string;
}

// Model Parameters Types
export interface ParameterSchema {
  type: 'integer' | 'number' | 'boolean' | 'string';
  description: string;
  default: any;
  minimum?: number;
  maximum?: number;
  enum?: any[];
  required: boolean;
}

export interface ModelParametersResponse {
  model_id: string;
  feature_type: string;
  vram_requirement: number;
  schema: {
    parameters: Record<string, ParameterSchema>;
  };
  timestamp: string;
}

// Mesh Editing Types
export interface TextMeshEditingRequest {
  mesh_path?: string;
  mesh_base64?: string;
  mesh_file_id?: string;
  mask_bbox?: {
    center: [number, number, number];
    dimensions: [number, number, number];
  };
  mask_ellipsoid?: {
    center: [number, number, number];
    radii: [number, number, number];
  };
  source_prompt: string;
  target_prompt: string;
  num_views?: number;
  resolution?: number;
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

export interface ImageMeshEditingRequest {
  mesh_path?: string;
  mesh_base64?: string;
  mesh_file_id?: string;
  source_image_path?: string;
  source_image_base64?: string;
  source_image_file_id?: string;
  target_image_path?: string;
  target_image_base64?: string;
  target_image_file_id?: string;
  mask_image_path?: string;
  mask_image_base64?: string;
  mask_image_file_id?: string;
  mask_bbox?: {
    center: [number, number, number];
    dimensions: [number, number, number];
  };
  mask_ellipsoid?: {
    center: [number, number, number];
    radii: [number, number, number];
  };
  num_views?: number;
  resolution?: number;
  output_format: OutputFormat;
  model_preference?: string;
  model_parameters?: Record<string, any>;
}

// Queue Stats Types
export interface QueueStats {
  pending_jobs: number;
  processing_jobs: number;
  completed_jobs: number;
  max_queue_size: number | null;
  queue_utilization: number | null;
  timestamp: number;
}

export interface QueueStatsResponse {
  success: boolean;
  data: QueueStats;
}

// ─── Admin / Runtime Types ────────────────────────────────────────

export interface AdminLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

export interface AdminModel {
  id: string;
  name: string;
  type: string;
  status: string;
  progress?: number;
  error?: string;
  native_build?: { status: string; progress?: number };
  [key: string]: any;
}

export interface InstallProgress {
  model_id: string;
  phase: string;
  progress: number;
  percent: number;
  speed_mbps?: number;
  speed_bps?: number;
  downloaded_mb?: number;
  bytes_downloaded?: number;
  total_mb?: number;
  bytes_total?: number;
  eta_seconds?: number;
  status: 'queued' | 'downloading' | 'installing' | 'completed' | 'failed';
  log?: string;
  error?: string;
}

export interface InstallStatus {
  [modelId: string]: {
    components?: {
      native_build?: { status: string; progress?: number };
    };
  };
}

export interface RuntimeConfig {
  cuda_device?: string;
  max_vram_mb?: number;
  cpu_threads?: string;
  render_quality?: string;
  resolution?: string;
  texture_resolution?: string;
  output_format?: string;
  texture_model?: string;
  low_vram?: boolean;
  vram_mode?: string;
}

export interface GenerationSettings {
  default_provider?: string;
  render_quality?: string;
  output_format?: string;
  resolution?: string;
  steps?: number;
  low_vram?: boolean;
  batch_generation_enabled?: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
  label: string;
  available: boolean;
  vramMb: number;
  colab_incompatible: boolean;
  colab_skip_reason: string | null;
}

export interface RuntimeOptions {
  three_d_models: ProviderOption[];
  texture_models: ProviderOption[];
  render_qualities: ProviderOption[];
  resolutions: ProviderOption[];
  texture_resolutions: ProviderOption[];
  output_formats: ProviderOption[];
  gpu_options: ProviderOption[];
  vram_limits: number[];
  active_provider: string;
  colab_detected: boolean;
  colab_detected_vram_mb: number | null;
  colab_preparation_limit_mb: number | null;
}

// System Stats (for ResourceMonitor header component)
export interface SystemStats {
  timestamp: string;
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  gpu_percent: number;
  vram_used_gb: number;
  vram_total_gb: number;
  vram_percent: number;
  gpu_name?: string;
  gpu_temp_c?: number;
}

// Error Types
export interface ApiError extends Error {
  code?: string;
  status?: number;
  response?: ErrorResponse;
} 