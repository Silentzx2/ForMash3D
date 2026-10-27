/**
 * Canonical user-selectable model registry and feature routing.
 * Primary 3D/processing models mirror backend/config/models.yaml.
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
  experimental?: boolean;
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
    lowVramSupported: true,
    lowVramMb: 10240,
    supportsTexture: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS.2',
    enabled: true,
    status: 'available',
    description: 'Ultra-high-definition image-to-3D pipeline with 2K texture baking and crisp geometry.',
  },
  {
    id: 'hi3d_image_to_textured_mesh',
    name: 'Hi3D [Experimental] (Image → Refined 3D)',
    category: 'mesh_generation',
    feature: 'image_to_textured_mesh',
    featureLabel: 'Image to Refined 3D',
    vramMb: 16384,
    lowVramSupported: true,
    lowVramMb: 12288,
    supportsTexture: false,
    supportedInputs: ['image', 'mesh'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Hi3D',
    enabled: true,
    status: 'available',
    experimental: true,
    description: 'Experimental progressive flow refinement pipeline for high-resolution 3D geometry from image conditioning.',
  },
  // ── MESH GENERATION (Image to Raw Geometry) ──────────────────────────
  {
    id: 'trellis2_image_to_raw_mesh',
    name: 'TRELLIS.2 (Image → Raw Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 23552,
    lowVramSupported: true,
    lowVramMb: 10240,
    supportsTexture: false,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/TRELLIS.2',
    enabled: true,
    status: 'available',
    description: 'Next-gen 4B parameter dense voxel geometry pipeline with multi-GPU and low-VRAM support.',
  },
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
    supportsTexture: false,
    supportsFlashVDM: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/tencent/Hunyuan3D-2mini',
    enabled: true,
    status: 'available',
    description: '0.6B step-distilled low-VRAM shape model with Turbo/FlashVDM path for fast, resource-efficient generation.',
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
    id: 'unique3d_image_to_raw_mesh',
    name: 'Unique3D (High-Fidelity Single Image → 3D)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 10240,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Unique3D',
    enabled: true,
    status: 'available',
    description: 'High-fidelity single-image to 3D mesh with multi-view diffusion, normal prediction, and textured reconstruction.',
  },
  {
    id: 'pixal3d_image_to_raw_mesh',
    name: 'Pixal3D (Image → 3D with Textured Geometry)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 18432,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Pixal3D',
    enabled: true,
    status: 'available',
    description: 'High-quality single-image to 3D generation with pixel-aligned projection, MoGe camera estimation, and PBR texture synthesis.',
  },
  {
    id: 'hi3d_image_to_raw_mesh',
    name: 'Hi3D [Experimental] (High-Res Geometry Refinement)',
    category: 'mesh_generation',
    feature: 'image_to_raw_mesh',
    featureLabel: 'Image to Geometry',
    vramMb: 16384,
    lowVramSupported: true,
    lowVramMb: 12288,
    supportsTexture: false,
    supportedInputs: ['image', 'mesh'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Hi3D',
    enabled: true,
    status: 'available',
    experimental: true,
    description: 'Experimental 3-rung progressive sparse-flow geometry refinement (up to 1536^3) using Sparc3D.',
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
  {
    id: 'paint3d_image_mesh_painting',
    name: 'Paint3D (Image Reference Paint)',
    category: 'texture_painting',
    feature: 'image_mesh_painting',
    featureLabel: 'Image Mesh Painting',
    vramMb: 12288,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['mesh', 'image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Paint3D',
    enabled: true,
    status: 'available',
    description: 'Two-stage coarse-to-fine UV texture generation with lighting-less PBR albedo map synthesis (1K/2K resolution).',
  },
  {
    id: 'paint3d',
    name: 'Paint3D',
    category: 'texture_painting',
    feature: 'image_mesh_painting',
    featureLabel: 'Image Mesh Painting',
    vramMb: 12288,
    lowVramSupported: false,
    supportsTexture: true,
    supportedInputs: ['mesh', 'image'],
    supportedOutputs: ['glb', 'obj'],
    modelPath: 'backend/pretrained/Paint3D',
    enabled: true,
    status: 'available',
    description: 'Two-stage coarse-to-fine UV texture generation with lighting-less PBR albedo map synthesis (1K/2K resolution).',
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
    modelPath: 'backend/pretrained/PartUV/model_objaverse.ckpt',
    enabled: true,
    status: 'available',
    description: 'Semantic seam generation and packing for distortion-free texture mapping.',
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

export interface MaterialPreset {
  id: string;
  name: string;
  prompt: string;
  description: string;
  cssStyle: {
    background: string;
    border?: string;
    boxShadow?: string;
  };
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'brushed_metal',
    name: 'Brushed Metal',
    prompt: 'brushed metal, polished aluminum, subtle directional grain, high reflectivity, metallic finish',
    description: 'Anodized aluminum with linear brushing and specular highlights',
    cssStyle: {
      background: 'linear-gradient(135deg, #a1a1aa 0%, #e4e4e7 50%, #71717a 100%)',
      border: '1px solid #d4d4d8',
    },
  },
  {
    id: 'weathered_wood',
    name: 'Weathered Wood',
    prompt: 'weathered wood, aged rustic timber, visible wood grain, matte natural finish, organic cracks',
    description: 'Aged rustic timber with deep organic grain and matte patina',
    cssStyle: {
      background: 'linear-gradient(135deg, #78350f 0%, #92400e 50%, #451a03 100%)',
      border: '1px solid #b45309',
    },
  },
  {
    id: 'matte_plastic',
    name: 'Matte Plastic',
    prompt: 'matte plastic, clean smooth polymer, low specularity, vibrant diffuse color, industrial grade',
    description: 'Smooth injection-molded polymer with even diffuse shading',
    cssStyle: {
      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
      border: '1px solid #60a5fa',
    },
  },
  {
    id: 'rough_stone',
    name: 'Rough Stone',
    prompt: 'rough stone, natural granite rock, porous texture, coarse mineral surface, realistic bump',
    description: 'Coarse granite rock with porous surface and mineral specks',
    cssStyle: {
      background: 'linear-gradient(135deg, #52525b 0%, #71717a 50%, #3f3f46 100%)',
      border: '1px solid #a1a1aa',
    },
  },
  {
    id: 'fabric',
    name: 'Fabric',
    prompt: 'woven fabric, detailed textile cloth, soft cotton linen weave, subtle micro-texture',
    description: 'Tactile woven textile with visible thread cross-hatch',
    cssStyle: {
      background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #0f766e 100%)',
      border: '1px solid #2dd4bf',
    },
  },
  {
    id: 'chrome',
    name: 'Chrome',
    prompt: 'chrome, mirror finish, ultra reflective polished metallic surface, high specularity',
    description: 'Mirror-polished chrome with maximum specular reflection',
    cssStyle: {
      background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 25%, #ffffff 50%, #71717a 75%, #e4e4e7 100%)',
      border: '1px solid #ffffff',
    },
  },
  {
    id: 'carbon_fiber',
    name: 'Carbon Fiber',
    prompt: 'carbon fiber, distinct twill weave pattern, high tech composite, semi-gloss clearcoat',
    description: 'High-tech composite with diagonal twill weave under clearcoat',
    cssStyle: {
      background: 'linear-gradient(135deg, #18181b 0%, #27272a 50%, #09090b 100%)',
      border: '1px solid #3f3f46',
    },
  },
  {
    id: 'gold',
    name: 'Gold',
    prompt: 'pure polished gold, warm metallic specular reflections, luxurious smooth finish',
    description: 'Luxurious 24k polished gold with warm metallic sheen',
    cssStyle: {
      background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
      border: '1px solid #fde68a',
    },
  },
];

