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
  diagnostic?: JobDiagnostic | null;
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
    artifacts: raw.artifacts,
    qaScore: raw.qaScore,
    qaStatus: raw.qaStatus,
    qaWarnings: raw.qaWarnings,
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
  preset: 'low' | 'medium' | 'high' | 'custom';
  targetFaces: number;
  mode: 'adaptive' | 'uniform';
  preserveShape: boolean;
  preserveSharpEdges: boolean;
  preserveUVs: boolean;
  detailPreservation: number;
  boundaryProtection: number;
  voxelSize: number;
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
}

export interface AutoOptimizeSettings {
  targetPolycount: number;
  fixUVs: boolean;
  preserveDetails: number;
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
  autoOptimize: boolean;
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
  preserveDetails?: number;
  repairUVs?: boolean;
  prompt?: string;
  imageName?: string;
  detailPass?: boolean;
  triposfPass?: boolean;
  meshEnhancementMode?: 'none' | 'detailgen3d' | 'triposf' | 'both';
  detailGuidance?: number;
  negativePrompt?: string;
  multiviewImages?: {
    front?: string | null;
    right?: string | null;
    back?: string | null;
    left?: string | null;
  };
  enableFlashVDM?: boolean;
  lowVramMode?: 'auto' | 'normal' | 'low';
  maxNumView?: number;
  resolution?: number;
  paintResolution?: 512 | 768;
}



export interface CompareSettings {
  syncCamera: boolean;
  leftAssetId: string | null;
  rightAssetId: string | null;
  shadingMode: ShadingMode;
  showWireframe: boolean;
  showGrid: boolean;
}
