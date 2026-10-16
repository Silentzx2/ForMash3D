/**
 * Build generation parameters for model inference.
 * Pure function - no React dependencies, fully testable.
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

export function buildGenerationParameters(
  settings: GenerationSettings,
  modelCapabilities: ModelCapabilities,
  paramDefaults: Record<string, any> = {}
): BuildParamsResult {
  const modelId = settings.aiModel || '';
  const currentQuality = settings.meshQuality || 'high';
  
  // Determine model capabilities
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
  
  // Build model parameters
  const modelParameters: Record<string, unknown> = {
    octree_resolution: Number(paramDefaults.octree_resolution ?? 512), // octree_resolution: 512
    num_inference_steps: getInferenceSteps(modelId, paramDefaults),
    guidance_scale: Number(paramDefaults.guidance_scale ?? settings.guidanceScale ?? 7.5),
    seed: settings.seed ?? undefined,
    low_vram: false,
    enable_flashvdm: settings.enableFlashVDM ?? false,
    low_vram_mode: 'normal',
    auto_optimize: enablePostprocess && shouldAutoOptimize(settings.autoOptimizeSettings?.targetPolycount),
    target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 0,
    generateLOD: enablePostprocess && (settings.generateLOD !== false),
    lodPreset: settings.lodPreset || 'high',
    lodCount: enablePostprocess ? (settings.lodCount || 4) : 0,
    negative_prompt: settings.negativePrompt || undefined,
    source_quality: 'max',
    texture_enabled: textureEnabled,
    generate_texture: textureEnabled,
    enable_postprocess: enablePostprocess,
  };
  
  // Model-specific parameters
  applyModelSpecificParams(modelParameters, modelId, currentQuality, settings, paramDefaults);
  
  // Determine endpoint and body
  let endpoint: string;
  let body: Record<string, unknown>;
  
  const imageInput: Record<string, unknown> = {};
    if (settings.imageFileId) {
      imageInput.image_file_id = settings.imageFileId;
    } else if (typeof settings.image === 'string' && settings.image.startsWith('data:')) {
      imageInput.image_base64 = settings.image;
    }
    if (Object.keys(imageInput).length === 0) {
      // The backend rejects a request with no image field at all (400 "No image
      // input provided"). Fail here with an actionable message instead.
      throw new Error('No usable image input. Upload an image or pick a sample first.');
    }

    const cleanStem = (settings.imageName || settings.prompt || 'asset')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'asset';
    
    // Geometry adapters always produce raw mesh; optional texturing runs in post-processing.
    endpoint = '/api/v1/mesh-generation/image-to-raw-mesh';
    
    body = {
      ...imageInput,
      asset_name: cleanStem,
      image_name: cleanStem,
      output_format: 'glb',
      model_preference: settings.aiModel || undefined,
      intent: enablePostprocess ? settings.intent : undefined,
      preprocessing_artifact_id: settings.preprocessingArtifactId || undefined,
      preprocessing_review_override: Boolean(settings.preprocessingReviewOverride),
      enhancement_enabled: Boolean(settings.enhancementEnabled),
      enable_printability_check: enablePostprocess && Boolean(settings.enablePrintabilityCheck),
      enable_auto_repair: enablePostprocess && Boolean(settings.enableAutoRepair),
      enable_auto_rig: enablePostprocess && Boolean(settings.enableAutoRig),
      auto_rig_mode: settings.autoRigMode || 'full',
      enable_postprocess: enablePostprocess,
      target_polycount: enablePostprocess ? (settings.autoOptimizeSettings?.targetPolycount ?? 0) : 0,
      model_parameters: modelParameters,
      physics_enabled: enablePostprocess && shouldEnablePhysics(settings.generateCollision ?? false),
      physics_config: settings.physics,
      topology_mode: enablePostprocess ? (settings.topologyMode || (settings.quadTopology ? 'quad' : 'triangle')) : 'triangle',
      quad_topology: enablePostprocess && Boolean(settings.quadTopology || settings.topologyMode === 'quad'),
      bake_normal_maps: enablePostprocess && (settings.highResolutionNormalBaking ?? true),
      sharp_feature_preservation: enablePostprocess && (settings.sharpFeaturePreservation ?? true),
      angle_crease_threshold: settings.angleCreaseThreshold ?? 45,
      high_resolution_normal_baking: enablePostprocess && (settings.highResolutionNormalBaking ?? true),
      texture_fidelity_preset: settings.textureFidelityPreset || 'high',
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

function getInferenceSteps(modelId: string, paramDefaults: Record<string, any> = {}): number {
  // Model-specific maximum-fidelity source settings; downstream budgets never change these.
  // Prefer backend-provided schema defaults; fall back to known official schedules.
  const normId = (modelId || '').toLowerCase().replace(/-/g, '_');
  const schemaSteps = Number(
    paramDefaults.num_inference_steps ??
    paramDefaults.ss_sampling_steps ??
    -1
  );
  // Ignore schema defaults for models with a fixed maximum-fidelity source profile.
  if (normId.includes('hunyuan3d_dit_v2_mini_turbo')) return 5;
  if (normId.includes('trellis')) return 50;
  if (normId.includes('hunyuan3d_shape_v21') || normId.includes('hunyuan3dv21') ||
      normId.includes('triposg')) return 50;
  if (normId.includes('pixal3d')) return 36; // 12 + 12 + 12
  if (schemaSteps >= 1) return schemaSteps;

  let infSteps = 50;
  if (normId.includes('hunyuan3d_dit_v2_mini_turbo')) {
    infSteps = 5;
  } else if (normId.includes('triposg')) {
    infSteps = 50;
  } else if (normId.includes('hunyuan3d_shape_v21') || normId.includes('hunyuan3dv21')) {
    infSteps = 50;
  } else if (normId.includes('pixal3d')) {
    infSteps = 36;
  }

  return infSteps;
}

function shouldAutoOptimize(targetPolycount: number | undefined): boolean {
  // Missing/zero target means Native/Raw; never infer a production reduction budget.
  return Number.isFinite(targetPolycount) && Number(targetPolycount) > 0;
}

function shouldEnablePhysics(generateCollision: boolean): boolean {
  return Boolean(generateCollision);
}

function applyModelSpecificParams(
  modelParameters: Record<string, unknown>,
  modelId: string,
  currentQuality: string,
  settings: GenerationSettings,
  paramDefaults: Record<string, any> = {}
): void {
  // Source geometry and source textures always use maximum-fidelity generation settings.
  // UI poly/quality budgets apply only to downstream production artifacts.
  // When the backend provides parameter defaults, prefer them over hardcoded values.
  const normId = (modelId || '').toLowerCase().replace(/-/g, '_');
  
  if (normId.includes('triposg')) {
    modelParameters.faces = Number(paramDefaults.faces ?? -1);
    modelParameters.num_inference_steps = Number(paramDefaults.num_inference_steps ?? 50);
    modelParameters.use_flash_decoder = false;
    modelParameters.dense_octree_depth = 9;
    modelParameters.hierarchical_octree_depth = 10;
  } else if (normId.includes('trellis2')) {
    modelParameters.decimation_target = -1;
    modelParameters.remesh = false;
    modelParameters.pipeline_type = '1536_cascade';
    modelParameters.max_num_tokens = 262144;
    modelParameters.sparse_structure_sampler_params = { steps: 50 };
    modelParameters.shape_slat_sampler_params = { steps: 50 };
  } else if (normId.includes('trellis')) {
    modelParameters.simplify = 0.0;
    modelParameters.ss_sampling_steps = 50;
    modelParameters.slat_sampling_steps = 50;
  } else if (normId.includes('hunyuan3d_dit_v2_mini_turbo')) {
    // Official Mini Turbo uses octree_resolution=380; 512 exceeds trained range and degrades quality
    modelParameters.octree_resolution = 380;
    modelParameters.num_inference_steps = 5;
    modelParameters.num_chunks = 80000;
    modelParameters.low_vram_mode = false;
    modelParameters.low_vram = false;
    modelParameters.enable_flashvdm = false;
    modelParameters.mc_algo = 'mc';
  } else if (normId.startsWith('hunyuan3d_shape_v21')) {
    modelParameters.octree_resolution = 512;
    modelParameters.num_inference_steps = 50;
    modelParameters.guidance_scale = 7.5;
    modelParameters.num_chunks = 80000;
    modelParameters.low_vram = false;
    modelParameters.mc_algo = 'mc';
  } else if (normId.includes('hunyuan')) {
    modelParameters.octree_resolution = 512;
    modelParameters.num_inference_steps = 50;
    modelParameters.num_chunks = 80000;
    modelParameters.low_vram = false;
  } else if (normId.includes('pixal3d')) {
    modelParameters.low_vram = false;
    modelParameters.seed = paramDefaults.seed ?? settings.seed ?? 42;
    modelParameters.manual_fov = paramDefaults.manual_fov ?? null;
    modelParameters.resolution = paramDefaults.resolution ?? settings.resolution ?? 1024;
    modelParameters.pipeline_type = paramDefaults.pipeline_type ?? '1024_cascade';
    modelParameters.low_vram_mode = paramDefaults.low_vram ?? settings.lowVram ?? false;
    modelParameters.init_type = paramDefaults.init_type ?? 'std';
    modelParameters.native_pbr = true;
  }
}