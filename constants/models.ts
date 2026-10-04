/**
 * Canonical Model Registry & Feature Routing
 * Sourced directly from backend/config/models.yaml (19 registered models)
 */

export type ModelCategory =
  | 'mesh_generation'
  | 'texture_painting'
  | 'mesh_retopology'
  | 'mesh_segmentation'
  | 'uv_unwrapping'
  | 'mesh_editing'
  | 'auto_rig'
  | 'motion_generation';

export interface ModelDefinition {
  id: string;
  name: string;
  category: ModelCategory;
  feature: string;
  featureLabel: string;
  vramMb: number;
  lowVramSupported: boolean;
  lowVramMb?: number;
  supportsTexture: boolean;
  supportsFlashVDM?: boolean;
  supportedInputs: string[];
  supportedOutputs: string[];
  modelPath: string;
  enabled: boolean;
  status: 'available' | 'loaded' | 'offline';
  description: string;
}

export const CANONICAL_MODELS: ModelDefinition[] = [
  // ── MESH GENERATION (Image to 3D Textured) ────────────────────────────────
  {
    id: 'trellis_image_to_textured_mesh',
    name: 'TRELLIS (Image → Textured 3D)',
    category: 'mesh_generation',
    feature: 'image_to_textured_mesh',
    featureLabel: 'Image to Textured 3D',
    vramMb: 11776,
    lowVramSupported: true,
    lowVramMb: 6144,
    supportsTexture: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS',
    enabled: true,
    status: 'available',
    description: 'Balanced single-image to textured 3D mesh reconstruction with fast generation.',
  },
  {
    id: 'trellis2_image_to_textured_mesh',
    name: 'TRELLIS.2 (Image → Textured HQ)',
    category: 'mesh_generation',
    feature: 'image_to_textured_mesh',
    featureLabel: 'Image to Textured 3D',
    vramMb: 23552,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS.2',
    enabled: true,
    status: 'available',
    description: 'Ultra-high-definition image-to-3D pipeline with 2K texture baking and crisp geometry.',
  },
  // ── MESH GENERATION (Image to Raw Geometry) ──────────────────────────
  {
    id: 'hunyuan3d_shape_v21_image_to_raw_mesh',
    name: 'Hunyuan3D-Shape-v2-1 (Image → Raw Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 10240,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/tencent/Hunyuan3D-2.1',
    enabled: true,
    status: 'available',
    description: '3.3B shape model for high-quality single-image to watertight mesh generation.',
  },
  {
    id: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
    name: 'Hunyuan3D-DiT-v2-mini-Turbo (Image → Raw Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 6144,
    lowVramSupported: true,
    lowVramMb: 4096,
    supportsTexture: true,
    supportsFlashVDM: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/tencent/Hunyuan3D-2mini',
    enabled: true,
    status: 'available',
    description: '0.6B step-distilled low-VRAM shape model with Turbo/FlashVDM path for fast, resource-efficient generation.',
  },
  {
    id: 'partpacker_image_to_raw_mesh',
    name: 'PartPacker (Image → Part-based Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 10240,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/PartPacker',
    enabled: true,
    status: 'available',
    description: 'Generates decomposed multi-part geometric structures from complex product images.',
  },
  {
    id: 'ultrashape_image_to_raw_mesh',
    name: 'UltraShape (Image → High-Poly Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 26640,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj', 'ply'],
    modelPath: 'backend/pretrained/UltraShape',
    enabled: true,
    status: 'available',
    description: 'High-poly dual-stage surface reconstruction combining Hunyuan latent priors with UltraShape.',
  },
  {
    id: 'triposr_image_to_raw_mesh',
    name: 'TripoSR (Fast Feedforward Image → 3D)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 6144,
    lowVramSupported: true,
    lowVramMb: 4096,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TripoSR',
    enabled: true,
    status: 'available',
    description: 'Ultra-fast single-image 3D reconstruction generating high-speed 3D meshes.',
  },
  {
    id: 'triposg_image_to_raw_mesh',
    name: 'TripoSG (High-Fidelity Image / Scribble → 3D)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 8192,
    lowVramSupported: true,
    lowVramMb: 6144,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TripoSG',
    enabled: true,
    status: 'available',
    description: 'High-fidelity single-image or sketch/scribble-to-3D mesh reconstruction with RMBG-1.4 matting.',
  },
  {
    id: 'triposf_image_to_raw_mesh',
    name: 'TripoSF (SparseFlex High-Res Arbitrary Topology)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 12288,
    lowVramSupported: true,
    lowVramMb: 8192,
    supportsTexture: false,
    supportedInputs: ['image', 'mesh'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TripoSF',
    enabled: true,
    status: 'available',
    description: 'High-resolution arbitrary-topology 3D mesh modeling and reconstruction up to 1024³ with SparseFlex VAE.',
  },

  // ── TEXTURE STUDIO / MESH PAINTING ───────────────────────────────────────
  {
    id: 'trellis_text_mesh_painting',
    name: 'TRELLIS (Text Prompt Paint)',
    category: 'texture_painting',
    feature: 'text_mesh_painting',
    featureLabel: 'Text Mesh Painting',
    vramMb: 11776,
    lowVramSupported: true,
    supportsTexture: true,
    supportedInputs: ['mesh', 'text'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS',
    enabled: true,
    status: 'available',
    description: 'Applies neural texture projection to an existing mesh guided by a descriptive text prompt.',
  },
  {
    id: 'trellis_image_mesh_painting',
    name: 'TRELLIS (Image Reference Paint)',
    category: 'texture_painting',
    feature: 'image_mesh_painting',
    featureLabel: 'Image Mesh Painting',
    vramMb: 11776,
    lowVramSupported: true,
    supportsTexture: true,
    supportedInputs: ['mesh', 'image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS',
    enabled: true,
    status: 'available',
    description: 'Paints existing 3D geometry using colors, patterns, and materials extracted from a reference image.',
  },
  {
    id: 'trellis2_image_mesh_painting',
    name: 'TRELLIS.2 (Image Reference Paint HQ)',
    category: 'texture_painting',
    feature: 'image_mesh_painting',
    featureLabel: 'Image Mesh Painting',
    vramMb: 23552,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['mesh', 'image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS.2',
    enabled: true,
    status: 'available',
    description: 'High-resolution PBR texture map baking from multi-view image projections.',
  },
  {
    id: 'hunyuan3d_paint_v21_image_mesh_painting',
    name: 'Hunyuan3D-Paint-v2-1 (PBR Texture)',
    category: 'texture_painting',
    feature: 'image_mesh_painting',
    featureLabel: 'Image Mesh Painting',
    vramMb: 21504,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['mesh', 'text', 'image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/tencent/Hunyuan3D-2.1',
    enabled: true,
    status: 'available',
    description: '2B PBR texture checkpoint for multi-view texture generation with native rendering/baking path.',
  },

  // ── RETOPOLOGY / REMESH ──────────────────────────────────────────────────
  {
    id: 'fastmesh_v1k_retopology',
    name: 'FastMesh 1K (Game-Ready Quad Retopo)',
    category: 'mesh_retopology',
    feature: 'mesh_retopology',
    featureLabel: 'Mesh Retopology',
    vramMb: 16384,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['obj', 'glb', 'ply', 'stl'],
    supportedOutputs: ['obj', 'glb', 'ply'],
    modelPath: 'backend/pretrained/FastMesh-V1K',
    enabled: true,
    status: 'available',
    description: 'High-speed quad-dominant retopology producing clean animation loops under 10K polys.',
  },
  {
    id: 'fastmesh_v4k_retopology',
    name: 'FastMesh 4K (Hero-Asset Quad Retopo)',
    category: 'mesh_retopology',
    feature: 'mesh_retopology',
    featureLabel: 'Mesh Retopology',
    vramMb: 24500,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['obj', 'glb', 'ply', 'stl'],
    supportedOutputs: ['obj', 'glb', 'ply'],
    modelPath: 'backend/pretrained/FastMesh-V4K',
    enabled: true,
    status: 'available',
    description: 'Hero-asset retopology generating production-ready quad topology with preserved feature boundaries.',
  },

  // ── UV UNWRAPPING ────────────────────────────────────────────────────────
  {
    id: 'partuv_uv_unwrapping',
    name: 'PartUV (Automated Seam & Atlas Unwrapping)',
    category: 'uv_unwrapping',
    feature: 'uv_unwrapping',
    featureLabel: 'UV Unwrapping',
    vramMb: 7168,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['obj', 'glb'],
    supportedOutputs: ['obj', 'glb'],
    modelPath: 'backend/pretrained/PartField/model_objaverse.ckpt',
    enabled: true,
    status: 'available',
    description: 'Semantic seam generation and packing for distortion-free texture mapping.',
  },

  // ── MESH SEGMENTATION ───────────────────────────────────────────────────
  {
    id: 'partfield_mesh_segmentation',
    name: 'PartField (Semantic Part Segmentation)',
    category: 'mesh_segmentation',
    feature: 'mesh_segmentation',
    featureLabel: 'Mesh Segmentation',
    vramMb: 4096,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['glb', 'obj'],
    supportedOutputs: ['glb'],
    modelPath: 'backend/pretrained/PartField',
    enabled: true,
    status: 'available',
    description: 'Decomposes 3D geometry into functional articulated components (limbs, torso, armor, accessories).',
  },
  {
    id: 'p3sam_mesh_segmentation',
    name: 'P3-SAM (Zero-Shot 3D Segmentation)',
    category: 'mesh_segmentation',
    feature: 'mesh_segmentation',
    featureLabel: 'Mesh Segmentation',
    vramMb: 61440,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['glb', 'obj', 'ply'],
    supportedOutputs: ['glb'],
    modelPath: 'backend/pretrained/P3-SAM/p3sam.safetensors',
    enabled: true,
    status: 'available',
    description: 'Open-vocabulary zero-shot 3D segmentation adapting Segment Anything 3D priors.',
  },

  // ── MESH EDITING ─────────────────────────────────────────────────────────
  {
    id: 'voxhammer_text_mesh_editing',
    name: 'VoxHammer (Text-Guided Mesh Edit)',
    category: 'mesh_editing',
    feature: 'text_mesh_editing',
    featureLabel: 'Mesh Editing',
    vramMb: 40960,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['mesh', 'text'],
    supportedOutputs: ['glb'],
    modelPath: 'backend/pretrained/VoxHammer',
    enabled: true,
    status: 'available',
    description: 'Localized text-guided neural mesh deformation and detail carving with bounding-box masking.',
  },
  {
    id: 'voxhammer_image_mesh_editing',
    name: 'VoxHammer (Image-Guided Mesh Edit)',
    category: 'mesh_editing',
    feature: 'image_mesh_editing',
    featureLabel: 'Mesh Editing',
    vramMb: 40960,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['mesh', 'image'],
    supportedOutputs: ['glb'],
    modelPath: 'backend/pretrained/VoxHammer',
    enabled: true,
    status: 'available',
    description: 'Image-conditioned local geometry modification preserving non-target regions.',
  },

  // ── AUTO RIGGING ─────────────────────────────────────────────────────────
  {
    id: 'unirig_auto_rig',
    name: 'UniRig (Automated Skeletal Rigging)',
    category: 'auto_rig',
    feature: 'auto_rig',
    featureLabel: 'Animation & Rigging',
    vramMb: 9216,
    lowVramSupported: false,
    supportsTexture: false,
    supportedInputs: ['obj', 'glb', 'fbx'],
    supportedOutputs: ['glb', 'fbx'],
    modelPath: 'backend/pretrained/UniRig',
    enabled: true,
    status: 'available',
    description: 'Automatic humanoid and quadruped skeletal joint estimation and skinning weight calculation.',
  },

  // ── MOTION AI / ANIMATION ────────────────────────────────────────────────
  {
    id: 'ardy_motion_generation',
    name: 'NVIDIA ARDY (Interactive Motion Synthesis)',
    category: 'motion_generation',
    feature: 'motion_generation',
    featureLabel: 'Motion AI & Animation',
    vramMb: 8192,
    lowVramSupported: true,
    lowVramMb: 6144,
    supportsTexture: false,
    supportedInputs: ['text'],
    supportedOutputs: ['json', 'npz'],
    modelPath: 'backend/pretrained/ardy',
    enabled: true,
    status: 'available',
    description: 'Autoregressive interactive text-to-motion generation with trajectory, waypoint, and kinematic constraint support.',
  },
];

const MODEL_MAP = new Map<string, ModelDefinition>(
  CANONICAL_MODELS.map((m) => [m.id, m])
);

export function getModelDefinition(id: string): ModelDefinition | undefined {
  return MODEL_MAP.get(id);
}

export function getModelsByCategory(category: ModelCategory): ModelDefinition[] {
  return CANONICAL_MODELS.filter((m) => m.category === category);
}

export function getModelsByFeature(feature: string): ModelDefinition[] {
  return CANONICAL_MODELS.filter((m) => m.feature === feature);
}

export function isMeshGenerationModel(id: string): boolean {
  const model = MODEL_MAP.get(id);
  return model?.category === 'mesh_generation';
}

export function isTexturePaintingModel(id: string): boolean {
  const model = MODEL_MAP.get(id);
  return model?.category === 'texture_painting';
}

export function isRawMeshModel(id: string): boolean {
  const model = MODEL_MAP.get(id);
  return model?.feature === 'image_to_raw_mesh';
}

export function isMotionGenerationModel(id: string): boolean {
  const model = MODEL_MAP.get(id);
  return model?.category === 'motion_generation';
}

export function getSupportedInputs(id: string): string[] {
  const model = MODEL_MAP.get(id);
  return model?.supportedInputs ?? [];
}

export function supportsTextInput(id: string): boolean {
  return getSupportedInputs(id).includes('text');
}

export function supportsImageInput(id: string): boolean {
  return getSupportedInputs(id).includes('image');
}
