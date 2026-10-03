import type { JobDiagnostic } from '@/lib/jobDiagnostics';

export type ToolType =
  | 'model'
  | 'segment'
  | 'remesh'
  | 'texture'
  | 'edit'
  | 'uv'
  | 'upscale'
  | 'pbr'
  | 'environment'
  | 'animation'
  | 'rigging';

export interface ActiveTask {
  id: string;
  isLocal?: boolean;
  type: 'image-to-3d' | 'text-to-3d' | 'segment' | 'remesh' | 'texture' | 'animation' | 'rigging' | 'uv' | 'edit';
  title: string;
  inputImage?: string;
  inputImageName?: string;
  startedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  progress: number; // 0 to 100
  currentStep: string;
  stage?: string;
  activeNode?: string;
  queuePosition?: number;
  totalPending?: number;
  estimatedRemainingSec?: number;
  provider?: string;
  errorMessage?: string;
  errorCode?: string;
  diagnostic?: JobDiagnostic | null;
  result?: Record<string, unknown>;
  logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
}

export type MainNavRoute = 'workspace' | 'dashboard' | 'assets' | 'system' | 'settings' | 'models' | 'jobs';

export type ShadingMode = 
  | 'textured' 
  | 'clay' 
  | 'matcap-gold' 
  | 'matcap-normal' 
  | 'matcap-chrome' 
  | 'matcap-ceramic' 
  | 'matcap-turquoise'
  | 'wireframe' 
  | 'xray'
  | 'pbr'
  | 'normals'
  | 'matcap';

export type CameraViewPreset = 'perspective' | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'ortho';

export interface ModelAsset {
  id: string;
  fileId?: string;
  name: string;
  category: 'all' | 'mesh' | 'texture' | 'generation';
  thumbnail: string;
  source?: { filename: string; subfolder: string; type: string; viewUrl?: string; mime?: string; localUrl?: string; promptId?: string; nodeId?: string; fileId?: string };
  previewColor?: string;
  meshType: 'goblin' | 'robot' | 'statue' | 'house' | 'dog' | 'table' | 'helmet' | 'car' | 'vase' | 'plant' | 'custom';
  faces: number;
  vertices: number;
  triangles: number;
  statsAvailable?: boolean;
  topology: 'Triangle' | 'Quad' | 'Adaptive';
  format: 'GLB' | 'OBJ' | 'PLY' | 'FBX' | 'STL' | 'IMAGE' | 'FILE';
  fileSize?: string;
  dimensions?: { x: number; y: number; z: number };
  boundingBox?: { min: number[]; max: number[]; extent: number[]; diagonal: number };
  objectCount?: number;
  componentCount?: number;
  materialCount?: number;
  postprocessStatus?: string;
  meshDetails?: Record<string, unknown>;
  dateCreated: string;
  tags: string[];
  isFavorite?: boolean;
  materialConfig?: MaterialConfig;
  materials?: string[];
  createdAt?: string;
  artifacts?: {
    source?: string;
    gameReady?: string;
    lods?: string[];
    collision?: string;
    qaReport?: Record<string, unknown>;
    pbrMaps?: Record<string, string>;
    gameReadyFormats?: Record<string, string>;
    zipUrl?: string;
    physicsUrl?: string;
    physicsReady?: boolean;
    physics?: Record<string, unknown>;
  };
  qaScore?: number;
  qaStatus?: 'pass' | 'warn' | 'fail';
  qaWarnings?: string[];
}

export function normalizeModelAsset(raw: Partial<ModelAsset> & Record<string, any>): ModelAsset {
  const polyCount = raw.polygon_count ?? raw.faces ?? raw.triangles ?? 0;
  const vertCount = raw.vertex_count ?? raw.vertices ?? 0;
  const hasStats = Boolean(
    raw.statsAvailable ||
    (typeof polyCount === 'number' && polyCount > 0) ||
    (typeof vertCount === 'number' && vertCount > 0)
  );

  const rawArtifacts = (raw.artifacts || {}) as Record<string, any>;
  const collisionUrl =
    typeof rawArtifacts.collision === 'string'
      ? rawArtifacts.collision
      : (rawArtifacts.collision?.url || raw.collision_url || raw.collision || undefined);

  const physics = rawArtifacts.physics || raw.physics || undefined;
  const physicsUrl =
    typeof rawArtifacts.physicsUrl === 'string'
      ? rawArtifacts.physicsUrl
      : (raw.physics_url || undefined);

  const physicsReady = Boolean(
    rawArtifacts.physicsReady ??
    raw.physics_ready ??
    (collisionUrl && physics)
  );

  const qaReport = rawArtifacts.qaReport || raw.qa_report || raw.quality_trace?.game_ready?.qa || undefined;
  const sourceUrl = rawArtifacts.source || raw.source_model_url || rawArtifacts.master?.url || undefined;
  const gameReadyUrl = rawArtifacts.gameReady || raw.game_ready_url || raw.model_url || rawArtifacts.game_ready?.glb?.url || undefined;
  const rawLods = rawArtifacts.lods ?? raw.lod_urls ?? (raw.artifacts as any)?.lods;
  const lods: string[] | undefined = Array.isArray(rawLods)
    ? rawLods.map((l: any) => (typeof l === 'string' ? l : l?.url || '')).filter(Boolean)
    : (rawLods && typeof rawLods === 'object')
      ? Object.values(rawLods).map((l: any) => (typeof l === 'string' ? l : l?.url || '')).filter(Boolean)
      : undefined;
  const pbrMaps = rawArtifacts.pbrMaps || raw.pbr_maps || undefined;
  const gameReadyFormats = rawArtifacts.gameReadyFormats || raw.game_ready_formats || (rawArtifacts.game_ready && typeof rawArtifacts.game_ready === 'object' ? Object.fromEntries(Object.entries(rawArtifacts.game_ready).map(([k, v]: [string, any]) => [k, v?.url || v]).filter(([, u]) => Boolean(u))) : undefined);
  const zipUrl = rawArtifacts.zipUrl || raw.zip_url || undefined;

  const hasArtifacts = Boolean(
    raw.artifacts || collisionUrl || physicsReady || physics || qaReport || sourceUrl || gameReadyUrl || lods || pbrMaps || gameReadyFormats || zipUrl
  );

  const artifacts = hasArtifacts ? {
    ...(typeof raw.artifacts === 'object' ? raw.artifacts : {}),
    source: sourceUrl,
    gameReady: gameReadyUrl,
    lods,
    collision: collisionUrl,
    qaReport,
    pbrMaps,
    gameReadyFormats,
    zipUrl,
    physicsUrl,
    physicsReady,
    physics,
  } : undefined;

  return {
    id: String(raw.id || `asset-${Date.now()}`),
    name: String(raw.name || '3D Model'),
    category: raw.category || 'mesh',
    thumbnail: raw.thumbnail || raw.thumbnail_url || '',
    previewColor: raw.previewColor,
    meshType: raw.meshType || 'custom',
    faces: hasStats ? Number(polyCount) : 0,
    vertices: hasStats ? Number(vertCount) : 0,
    triangles: hasStats ? Number(polyCount) : 0,
    statsAvailable: hasStats,
    topology: raw.topology || 'Triangle',
    format: raw.format || 'GLB',
    dimensions: raw.dimensions,
    boundingBox: raw.boundingBox || raw.bounding_box,
    objectCount: raw.objectCount ?? raw.object_count,
    componentCount: raw.componentCount ?? raw.component_count,
    materialCount: raw.materialCount ?? raw.material_count,
    postprocessStatus: raw.postprocessStatus ?? raw.postprocess_status,
    meshDetails: raw.meshDetails || raw.mesh_details,
    dateCreated: raw.dateCreated || raw.created_at || new Date().toISOString().split('T')[0],
    tags: Array.isArray(raw.tags) ? raw.tags : ['Model'],
    isFavorite: Boolean(raw.isFavorite),
    materialConfig: raw.materialConfig,
    materials: Array.isArray(raw.materials) ? raw.materials : [],
    createdAt: raw.createdAt || raw.created_at,
    source: raw.source,
    artifacts,
    qaScore: raw.qaScore ?? qaReport?.game_ready_score ?? qaReport?.score,
    qaStatus: raw.qaStatus ?? qaReport?.status,
    qaWarnings: raw.qaWarnings ?? qaReport?.warnings,
  };
}

export function createUploadedMeshAsset(file: File): ModelAsset {
  const url = URL.createObjectURL(file);
  return normalizeModelAsset({
    id: `asset-upload-${Date.now()}`,
    name: file.name,
    category: 'mesh',
    meshType: 'custom',
    format: (file.name.split('.').pop()?.toUpperCase() || 'GLB') as any,
    fileSize: `${(file.size / 1048576).toFixed(1)} MB`,
    source: { filename: file.name, subfolder: 'uploads', type: 'upload', localUrl: url, viewUrl: url },
    vertices: 0,
    faces: 0,
    statsAvailable: false,
  });
}

export type Asset3D = ModelAsset;

export interface MaterialConfig {
  roughness: number;
  metalness: number;
  color: string;
  wireframe: boolean;
  wireframeColor: string;
  normalScale: number;
  aoIntensity: number;
  style: 'realistic' | 'game' | 'stylized' | 'anime';
}

export interface EnvironmentSettings {
  ambientIntensity: number;
  keyLightIntensity: number;
  fillLightIntensity: number;
  rimLightIntensity: number;
  exposure: number;
  gridVisible: boolean;
  gridColor: string;
  backgroundColor: string;
  autoRotate: boolean;
  showAxes: boolean;
  showStats: boolean;
}

export interface SystemStats {
  status: 'online' | 'offline' | 'connecting' | 'error';
  host: string;
  gpu: string;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
  ramUsedGb: number | null;
  ramTotalGb: number | null;
  torchVramUsedGb: number | null;
  torchVramTotalGb: number | null;
  gpuType: string | null;
  gpuIndex: number | null;
  pythonVersion: string | null;
  torchVersion: string | null;
  apiVersion: string | null;
  queueRunning: number;
  queuePending: number;
  activePromptId: string | null;
  activeNode: string | null;
  lastPingMs: number;
}

export interface SegmentationSettings {
  mode: 'auto' | 'manual';
  target: 'full' | 'character' | 'part';
  selectedPart: string;
  feather: number;
  preserveTextures: boolean;
}

export interface RemeshSettings {
  tab: 'auto' | 'manual';
  variant: 'V1K' | 'V4K';
  polyType: 'tri' | 'quad';
  targetPolycount: number;
}

export interface TextureSettings {
  workflow: 'texture' | 'pbr';
  mode: 'ai' | 'manual';
  style: 'realistic' | 'game' | 'stylized' | 'anime';
  resolution: '1K' | '2K' | '4K' | '8K';
  paintResolution?: 512 | 768;
  referenceImage: string | null;
  prompt: string;
  modelId: string;
  maps: {
    albedo: boolean;
    normal: boolean;
    roughness: boolean;
    metallic: boolean;
    ao: boolean;
    height: boolean;
  };
  lowVram?: boolean;
  maxNumView?: number;
  generatePBR?: boolean;
  enableRealESRGAN?: boolean;
}

export interface AutoOptimizeSettings {
  targetPolycount: number;
}

export interface PhysicsSettings {
  bodyType: 'auto' | 'static' | 'dynamic' | 'kinematic';
  massMode: 'auto' | 'manual';
  massKg: number;
  densityMode: 'auto' | 'manual';
  densityKgM3: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  gravityEnabled: boolean;
  collisionQuality: 'fast' | 'balanced' | 'precise';
  deformation: 'off';
}

export interface GenerationSettings {
  mode: 'image-to-3d' | 'text-to-3d';
  image: string | null;
  imageFileId?: string | null;
  aiModel: string;
  meshQuality: 'low' | 'medium' | 'high' | 'ultra';
  textureQuality: 'low' | 'medium' | 'high' | '8k';
  quadTopology: boolean;
  topologyMode?: 'triangle' | 'quad' | 'adaptive';
  seed: number;
  guidanceScale: number;
  removeBackground: boolean;
  lowVram?: boolean;
  vramMode?: 'auto' | 'normal' | 'low';
  autoOptimizeSettings: AutoOptimizeSettings;
  generateTexture?: boolean;
  gameReady?: boolean;
  targetPlatform?: 'generic' | 'mobile' | 'low' | 'medium' | 'high' | 'cinematic';
  generateLOD?: boolean;
  lodPreset?: 'mobile' | 'low' | 'medium' | 'high' | 'custom';
  lodCount?: number;
  generateCollision?: boolean;
  physics?: PhysicsSettings;
  generatePBR?: boolean;
  bakeNormalMaps?: boolean;
  bakeHighToLow?: boolean;

  prompt?: string;
  imageName?: string;

  negativePrompt?: string;
  multiviewImages?: {
    front?: string | null;
    right?: string | null;
    back?: string | null;
    left?: string | null;
  };
  multiviewSourceFileId?: string | null;
  multiviewJobId?: string | null;
  multiviewAssetId?: string | null;
  multiviewStatus?: 'idle' | 'generating' | 'ready' | 'error';
  multiviewViews?: Array<{
    file: string;
    label: string;
    azimuth_deg?: number;
    elevation_deg?: number;
    url?: string;
    mask_url?: string;
    normal_url?: string;
  }>;
  multiviewManifest?: any;
  multiviewZipUrl?: string | null;
  multiviewError?: string | null;
  multiviewInputMode?: 'generate' | 'upload';
  multiviewAdvanced?: {
    inferenceSteps: number;
    seed: number;
    saveContactSheet: boolean;
    transparentBackground: boolean;
    generateMasks: boolean;
    generateNormals: boolean;
    includeManifest: boolean;
  };
  enableFlashVDM?: boolean;
  lowVramMode?: 'auto' | 'normal' | 'low';
  maxNumView?: number;
  resolution?: number;
  paintResolution?: 512 | 768;
  enableRealESRGAN?: boolean;
}



export interface CompareSettings {
  syncCamera: boolean;
  leftAssetId: string | null;
  rightAssetId: string | null;
  shadingMode: ShadingMode;
  showWireframe: boolean;
  showGrid: boolean;
}

export interface SculptSettings {
  brush: 'standard' | 'clay' | 'inflate' | 'smooth' | 'flatten' | 'pinch' | 'grab';
  radius: number;
  strength: number;
  hardness: number;
  spacing: number;
  direction: 1 | -1;
  frontOnly: boolean;
  symmetry: { x: boolean; y: boolean; z: boolean };
  steadyStroke: number;
  autoSmooth: number;
}

export interface PaintBrushSettings {
  color: string;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  shape: 'round' | 'square' | 'spray' | 'chalk';
  blendMode: string;
}

