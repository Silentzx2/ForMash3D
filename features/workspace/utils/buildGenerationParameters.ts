/**
 * Build generation parameters for model inference.
 * Pure function - no React dependencies, fully testable.
 *
 * Output settings and production budgets are separated from adapter inference.
 * Adapter-owned inference profiles are authoritative.
 */

import type { GenerationSettings } from '../types.ts';

export interface ModelCapabilities {
  raw_mesh?: boolean;
  paint_autochain?: boolean;
  supports_texture?: boolean;
}

export interface BuildParamsResult {
  endpoint: string;
  body: Record<string, unknown>;
  modelParameters: Record<string, unknown>;
  isTextured: boolean;
  isRawModel: boolean;
  isPaintModel: boolean;
}

const FORBIDDEN_PARAMETER_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isJsonParameterValue(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 512 && value.every(item => isJsonParameterValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 512 && entries.every(([key, item]) =>
    key.length <= 200 && !FORBIDDEN_PARAMETER_KEYS.has(key) && isJsonParameterValue(item, depth + 1)
  );
}

/** Validate imported/free-form parameter JSON (kept for backward-compatibility checks). */
export function parseModelParameterOverrides(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || !isJsonParameterValue(value)) {
    throw new Error('Model parameter overrides must be a safe JSON object (finite values, max depth 16).');
  }
  return { ...(value as Record<string, unknown>) };
}

/**
 * Keep the user's explicit model authoritative. Intent resolution may suggest a
 * fallback only when the request does not already name a model.
 */
export function resolveGenerationModelChoice(
  explicitModelId: string | null | undefined,
  presetModelId: string | null | undefined,
): string {
  if (typeof explicitModelId === 'string' && explicitModelId.trim()) return explicitModelId;
  if (typeof presetModelId === 'string' && presetModelId.trim()) return presetModelId;
  return '';
}

/** Derive routing capabilities from selected-model manifest metadata. */
export function resolveGenerationModelCapabilities(
  modelId: string,
  declaredCapabilities: Record<string, unknown> = {},
): ModelCapabilities {
  const rawMesh = declaredCapabilities.raw_mesh === true || modelId.endsWith('_image_to_raw_mesh');
  const textureCapability = declaredCapabilities.texture_generation;
  return {
    raw_mesh: rawMesh,
    paint_autochain: declaredCapabilities.paint_autochain === true,
    supports_texture: typeof textureCapability === 'boolean' ? textureCapability : !rawMesh,
  };
}

export function buildGenerationParameters(
  settings: GenerationSettings,
  modelCapabilities: ModelCapabilities = {}
): BuildParamsResult {
  const isRawModel = modelCapabilities.raw_mesh === true;
  const isPaintModel = modelCapabilities.paint_autochain === true;
  const enablePostprocess = settings.enablePostprocess !== false;

  // Texture generation is a post-processing stage; if post-process is bypassed, texture is disabled.
  const textureEnabled = enablePostprocess && Boolean(
    settings.texture_enabled ??
    settings.textureEnabled ??
    (settings.generateTexture !== false)
  );

  const textureResolutionPreset: '1K' | '2K' | '4K' | '8K' =
    settings.texture_resolution ||
    settings.textureResolution ||
    (
      settings.textureQuality === 'low' ? '1K' :
      settings.textureQuality === 'medium' ? '1K' :
      settings.textureQuality === '8k' ? '8K' :
      '2K'
    );

  const numericTextureResolution = (
    textureResolutionPreset === '1K' ? 1024 :
    textureResolutionPreset === '2K' ? 2048 :
    textureResolutionPreset === '4K' ? 4096 :
    8192
  );

  const isTextured = textureEnabled;

  // Runtime model parameters: only caller-controlled seed reaches adapters.
  // Numeric inference profiles (steps, guidance, octree resolution, samplers) live in adapters.
  const modelParameters: Record<string, unknown> = {};
  if (typeof settings.seed === 'number' && Number.isSafeInteger(settings.seed) && settings.seed >= 0) {
    modelParameters.seed = settings.seed;
  }

  // Determine endpoint and body
  const imageInput: Record<string, unknown> = {};
  if (settings.imageFileId) {
    imageInput.image_file_id = settings.imageFileId;
  } else if (typeof settings.image === 'string' && settings.image.startsWith('data:')) {
    imageInput.image_base64 = settings.image;
  }
  if (Object.keys(imageInput).length === 0) {
    throw new Error('No usable image input. Upload an image or pick a sample first.');
  }

  const cleanStem = (settings.imageName || settings.prompt || 'asset')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'asset';

  const requestedCandidateCount = Number(settings.candidateCount ?? 1);
  const candidateCount = Number.isFinite(requestedCandidateCount)
    ? Math.max(1, Math.min(4, Math.floor(requestedCandidateCount)))
    : 1;

  // LOD production options. The post-processing pipeline builds at most 4 levels
  // (LOD0-LOD3), so the request is clamped to the levels the consumer supports.
  const lodEnabled = enablePostprocess && settings.generateLOD !== false;
  // Treat imported/legacy values as untrusted; the backend supports named LOD profiles only.
  const lodPreset = ['mobile', 'low', 'medium', 'high', 'cinematic'].includes(settings.lodPreset ?? '')
    ? settings.lodPreset!
    : 'high';

  // Keep topology as one canonical choice. Legacy boolean state is only a fallback.
  const requestedTopologyMode = settings.topologyMode;
  const topologyMode: 'triangle' | 'quad' =
    requestedTopologyMode === 'quad' ? 'quad'
      : requestedTopologyMode === 'triangle' ? 'triangle'
        : settings.quadTopology ? 'quad' : 'triangle';

  // Auto-rig accepts only the three modes exposed by the backend contract.
  const autoRigMode = settings.autoRigMode === 'skeleton' || settings.autoRigMode === 'skin'
    ? settings.autoRigMode
    : 'full';
  const lodCount = Math.max(2, Math.min(4, Math.floor(Number(settings.lodCount) || 4)));

  const endpoint = '/api/v1/mesh-generation/image-to-raw-mesh';
  const targetPolycount = enablePostprocess ? (settings.autoOptimizeSettings?.targetPolycount ?? 0) : 0;

  const body: Record<string, unknown> = {
    ...imageInput,
    candidate_count: candidateCount,
    asset_name: cleanStem,
    image_name: cleanStem,
    output_format: 'glb',
    model_preference: settings.aiModel || undefined,
    auto_mode: false,
    intent: enablePostprocess ? settings.intent : undefined,
    preprocessing_artifact_id: settings.preprocessingArtifactId || undefined,
    preprocessing_review_override: Boolean(settings.preprocessingReviewOverride),
    enhancement_enabled: Boolean(settings.enhancementEnabled),
    enable_printability_check: enablePostprocess && Boolean(settings.enablePrintabilityCheck),
    enable_auto_repair: enablePostprocess && Boolean(settings.enableAutoRepair),
    enable_auto_rig: enablePostprocess && Boolean(settings.enableAutoRig),
    auto_rig_mode: autoRigMode,
    enable_postprocess: enablePostprocess,
    target_polycount: targetPolycount,
    generate_lod: lodEnabled,
    lod_preset: lodEnabled ? lodPreset : undefined,
    lod_count: lodEnabled ? lodCount : undefined,
    model_parameters: modelParameters,
    physics_enabled: enablePostprocess && Boolean(settings.generateCollision),
    physics_config: (enablePostprocess && Boolean(settings.generateCollision)) ? settings.physics : undefined,
    topology_mode: enablePostprocess ? topologyMode : 'triangle',
    quad_topology: enablePostprocess && topologyMode === 'quad',
    part_count_range: enablePostprocess ? settings.partCountRange : undefined,
    rig_type: enablePostprocess ? settings.rigType : undefined,
    export_formats: enablePostprocess ? settings.exportFormats : undefined,
    slicer_handoff: enablePostprocess ? Boolean(settings.slicerHandoff) : undefined,
    bake_normal_maps: enablePostprocess && (settings.highResolutionNormalBaking ?? true),
    texture_enabled: textureEnabled,
    generate_texture: textureEnabled,
    ...(textureEnabled ? {
      texture_resolution: numericTextureResolution,
      texture_resolution_preset: textureResolutionPreset,
    } : {}),
  };

  return {
    endpoint,
    body,
    modelParameters,
    isTextured,
    isRawModel,
    isPaintModel,
  };
}
