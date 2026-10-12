/**
 * Build generation parameters for model inference.
 * Pure function - no React dependencies, fully testable.
 */

import { GenerationSettings } from '../types';

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
  // Determine texture routing for image-to-3D.
  const textureEnabled = Boolean(
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
    auto_optimize: shouldAutoOptimize(settings.autoOptimizeSettings?.targetPolycount),
    target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 0,
    generateLOD: settings.generateLOD !== false,
    lodPreset: settings.lodPreset || 'high',
    lodCount: settings.lodCount || 4,
    negative_prompt: settings.negativePrompt || undefined,
    source_quality: 'max',
    texture_enabled: textureEnabled,
    generate_texture: textureEnabled,
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
      intent: settings.intent,
      preprocessing_artifact_id: settings.preprocessingArtifactId || undefined,
      enhancement_enabled: Boolean(settings.enhancementEnabled),
      enable_printability_check: Boolean(settings.enablePrintabilityCheck),
      enable_auto_repair: Boolean(settings.enableAutoRepair),
      enable_auto_rig: Boolean(settings.enableAutoRig),
      auto_rig_mode: settings.autoRigMode || 'full',
      model_parameters: modelParameters,
      physics_enabled: shouldEnablePhysics(settings.generateCollision ?? false),
      physics_config: settings.physics,
      topology_mode: settings.topologyMode || (settings.quadTopology ? 'quad' : 'triangle'),
      quad_topology: Boolean(settings.quadTopology || settings.topologyMode === 'quad'),
      bake_normal_maps: true,
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
  const schemaSteps = Number(
    paramDefaults.num_inference_steps ??
    paramDefaults.ss_sampling_steps ??
    -1
  );
  // Ignore schema defaults for models with a fixed maximum-fidelity source profile.
  if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) return 5;
  if (modelId.includes('trellis')) return 50;
  if (modelId.includes('hunyuan3d_shape_v21') || modelId.includes('hunyuan3dv21') ||
      modelId.includes('triposg')) return 50;
  if (modelId.includes('pixal3d')) return 36; // 12 + 12 + 12
  if (schemaSteps >= 1) return schemaSteps;

  let infSteps = 50;
  if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
    infSteps = 5;
  } else if (modelId.includes('triposg')) {
    infSteps = 50;
  } else if (modelId.includes('hunyuan3d_shape_v21') || modelId.includes('hunyuan3dv21')) {
    infSteps = 50;
  } else if (modelId.includes('pixal3d')) {
    infSteps = 36;
  }

  return infSteps;
}

function shouldAutoOptimize(targetPolycount: number | undefined): boolean {
  // Missing/zero target means Native/Raw; never infer a production reduction budget.
  return Number.isFinite(targetPolycount) && Number(targetPolycount) > 0 && Number(targetPolycount) < 200000;
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
  
  if (modelId.includes('triposg')) {
    modelParameters.faces = Number(paramDefaults.faces ?? -1);
    modelParameters.num_inference_steps = Number(paramDefaults.num_inference_steps ?? 50);
  } else if (modelId.includes('trellis2')) {
    modelParameters.decimation_target = -1;
    modelParameters.remesh = false;
    modelParameters.pipeline_type = '1536_cascade';
    modelParameters.max_num_tokens = 262144;
    modelParameters.sparse_structure_sampler_params = { steps: 50 };
    modelParameters.shape_slat_sampler_params = { steps: 50 };
  } else if (modelId.includes('trellis')) {
    modelParameters.simplify = 0.0;
    modelParameters.ss_sampling_steps = 50;
    modelParameters.slat_sampling_steps = 50;
  } else if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
    modelParameters.octree_resolution = 512;
    modelParameters.num_inference_steps = 5;
    modelParameters.low_vram_mode = false;
    modelParameters.low_vram = false;
    modelParameters.enable_flashvdm = true;
} else if (modelId.includes('hunyuan')) {
    modelParameters.octree_resolution = 512;
    modelParameters.num_inference_steps = 50;
    modelParameters.low_vram = false;
} else if (modelId.includes('pixal3d')) {
    modelParameters.low_vram = false;
    modelParameters.seed = paramDefaults.seed ?? settings.seed ?? 42;
    modelParameters.manual_fov = paramDefaults.manual_fov ?? settings.manualFov ?? null;
    modelParameters.resolution = paramDefaults.resolution ?? settings.resolution ?? 1024;
    modelParameters.pipeline_type = paramDefaults.pipeline_type ?? settings.pipelineType ?? '1024_cascade';
    modelParameters.low_vram_mode = paramDefaults.low_vram ?? settings.lowVram ?? false;
    modelParameters.init_type = paramDefaults.init_type ?? 'std';
    modelParameters.native_pbr = true;
}
}