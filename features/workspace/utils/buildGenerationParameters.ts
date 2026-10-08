/**
 * Build generation parameters for model inference.
 * Pure function - no React dependencies, fully testable.
 */

import { GenerationSettings } from '../types';

export interface ModelCapabilities {
  raw_mesh?: boolean;
  paint_autochain?: boolean;
  multiview?: boolean;
  supports_texture?: boolean;
}

export interface BuildParamsResult {
  endpoint: string;
  body: Record<string, unknown>;
  modelParameters: Record<string, unknown>;
  isTextured: boolean;
  isRawModel: boolean;
  isPaintModel: boolean;
  isMultiviewCapable: boolean;
  useMultiviewReconstruction: boolean;
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
  const isMultiviewCapable = Boolean(modelCapabilities.multiview);
  
  // Determine if we should use multiview reconstruction
  const hasMvViews = Boolean(
    settings.multiviewAssetId ||
    (settings.multiviewViews && settings.multiviewViews.length > 0)
  );
  const useMultiviewReconstruction = isMultiviewCapable && hasMvViews;
  
  // Determine texture routing for image-to-3D.
  const isTextured = !isRawModel && (settings.generateTexture ?? true);
  
  // Build model parameters
  const modelParameters: Record<string, unknown> = {
    octree_resolution: Number(paramDefaults.octree_resolution ?? 512),
    num_inference_steps: getInferenceSteps(modelId, true, paramDefaults),
    guidance_scale: Number(paramDefaults.guidance_scale ?? settings.guidanceScale ?? 7.5),
    seed: settings.seed ?? undefined,
    low_vram: Boolean(settings.lowVram),
    enable_flashvdm: settings.enableFlashVDM ?? false,
    low_vram_mode: settings.lowVramMode ?? 'auto',
    auto_optimize: shouldAutoOptimize(settings.autoOptimizeSettings?.targetPolycount),
    target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 50000,
    generateLOD: settings.generateLOD !== false,
    lodPreset: settings.lodPreset || 'high',
    lodCount: settings.lodCount || 4,
    negative_prompt: settings.negativePrompt || undefined,
    source_quality: 'max',
    texture_resolution: (
      settings.textureQuality === 'low' ? 512 :
      settings.textureQuality === 'medium' ? 1024 :
      settings.textureQuality === '8k' ? 4096 :
      2048
    ),
  };
  
  // Model-specific parameters
  applyModelSpecificParams(modelParameters, modelId, currentQuality, isPaintModel, settings, paramDefaults);
  
  // Determine endpoint and body
  let endpoint: string;
  let body: Record<string, unknown>;
  
  if (useMultiviewReconstruction) {
    endpoint = '/api/v1/multiview/reconstruct-3d';
    body = {
      asset_id: settings.multiviewAssetId || undefined,
      images: settings.multiviewViews || undefined,
      model_preference: settings.aiModel,
      output_format: 'glb',
      topology_mode: settings.topologyMode || (settings.quadTopology ? 'quad' : 'triangle'),
      quad_topology: Boolean(settings.quadTopology || settings.topologyMode === 'quad'),
      physics_enabled: shouldEnablePhysics(settings.generateCollision ?? false, isPaintModel, settings.generateTexture ?? true),
      model_parameters: modelParameters,
      target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 50000,
      generateLOD: settings.generateLOD !== false,
      lodPreset: settings.lodPreset || 'high',
      lodCount: settings.lodCount || 4,
      quality: settings.meshQuality || 'high',
      texture_resolution: isTextured ? ({ low: 512, medium: 1024, high: 2048, ultra: 4096, '8k': 4096 }[settings.textureQuality || 'high'] || 2048) : undefined,
    };
  } else {
    const imageInput: Record<string, unknown> = {};
    if (settings.imageFileId) {
      imageInput.image_file_id = settings.imageFileId;
    } else if (typeof settings.image === 'string' && settings.image.startsWith('data:')) {
      imageInput.image_base64 = settings.image;
    }
    
    const cleanStem = (settings.imageName || settings.prompt || 'asset')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'asset';
    
    endpoint = isTextured 
      ? '/api/v1/mesh-generation/image-to-textured-mesh'
      : '/api/v1/mesh-generation/image-to-raw-mesh';
    
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
      physics_enabled: shouldEnablePhysics(settings.generateCollision ?? false, isPaintModel, settings.generateTexture ?? true),
      physics_config: settings.physics,
      topology_mode: settings.topologyMode || (settings.quadTopology ? 'quad' : 'triangle'),
      quad_topology: Boolean(settings.quadTopology || settings.topologyMode === 'quad'),
      bake_normal_maps: settings.bakeNormalMaps !== false,
    };
    
    if (isTextured) {
      const textureResolutionByQuality: Record<string, number> = {
        low: 512,
        medium: 1024,
        high: 2048,
        ultra: 4096,
        '8k': 4096,
      };
      body.texture_resolution = textureResolutionByQuality[settings.textureQuality] || 2048;
    }
  }
  
  return {
    endpoint,
    body,
    modelParameters,
    isTextured,
    isRawModel,
    isPaintModel,
    isMultiviewCapable,
    useMultiviewReconstruction,
  };
}

function getInferenceSteps(modelId: string, isImageTo3D: boolean, paramDefaults: Record<string, any> = {}): number {
  // Model-specific inference steps (must match official schedules).
  // Prefer backend-provided schema defaults; fall back to known official schedules.
  const schemaSteps = Number(
    paramDefaults.num_inference_steps ??
    paramDefaults.ss_sampling_steps ??
    -1
  );
  if (schemaSteps >= 1) return schemaSteps;

  if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
    return 5;
  } else if (modelId.includes('triposg')) {
    return 50;
  } else if (modelId.includes('trellis')) {
    // Trellis image-to-3D uses the image-conditioned schedule.
    return isImageTo3D ? 12 : 25;
  } else if (modelId.includes('hunyuan3d_shape_v21') || modelId.includes('hunyuan3dv21')) {
    return 50;
  } else if (modelId.includes('ultrashape')) {
    return 50;
  }
  
  return 50;
}

function shouldAutoOptimize(targetPolycount: number | undefined): boolean {
  if (!targetPolycount) return true;
  return targetPolycount === 0 || (targetPolycount > 0 && targetPolycount < 200000);
}

function shouldEnablePhysics(generateCollision: boolean, isPaintModel: boolean, generateTexture: boolean | undefined): boolean {
  return Boolean(generateCollision) && !(isPaintModel && (generateTexture ?? true));
}

function applyModelSpecificParams(
  modelParameters: Record<string, unknown>,
  modelId: string,
  currentQuality: string,
  isPaintModel: boolean,
  settings: GenerationSettings,
  paramDefaults: Record<string, any> = {}
): void {
  // Source geometry and source textures always use maximum-fidelity generation settings.
  // UI poly/quality budgets apply only to downstream production artifacts.
  // When the backend provides parameter defaults, prefer them over hardcoded values.
  
  if (modelId.includes('triposr')) {
    modelParameters.mc_resolution = Number(paramDefaults.mc_resolution ?? 320);
  } else if (modelId.includes('triposg')) {
    modelParameters.faces = Number(paramDefaults.faces ?? -1);
    modelParameters.num_inference_steps = Number(paramDefaults.num_inference_steps ?? 50);
  } else if (modelId.includes('triposf')) {
    modelParameters.resolution = Number(paramDefaults.resolution ?? 1024);
    modelParameters.sample_points_num = Number(paramDefaults.sample_points_num ?? 1638400);
  } else if (modelId.includes('partpacker')) {
    modelParameters.grid_resolution = Number(paramDefaults.grid_resolution ?? 512);
    modelParameters.num_faces = Number(paramDefaults.num_faces ?? -1);
  } else if (modelId.includes('ultrashape')) {
    modelParameters.octree_res = Number(paramDefaults.octree_res ?? 1024);
    modelParameters.num_latents = Number(paramDefaults.num_latents ?? 32768);
  } else if (modelId.includes('trellis2')) {
    modelParameters.decimation_target = Number(paramDefaults.decimation_target ?? -1);
    modelParameters.remesh = paramDefaults.remesh ?? false;
    modelParameters.texture_size = Number(paramDefaults.texture_size ?? modelParameters.texture_resolution ?? 4096);
  } else if (modelId.includes('trellis')) {
    modelParameters.simplify = Number(paramDefaults.simplify ?? 0.0);
    modelParameters.ss_sampling_steps = Number(paramDefaults.ss_sampling_steps ?? 12);
    modelParameters.slat_sampling_steps = Number(paramDefaults.slat_sampling_steps ?? 12);
    modelParameters.texture_resolution = Number(paramDefaults.texture_resolution ?? modelParameters.texture_resolution ?? 2048);
  } else if (modelId.includes('hunyuan')) {
      modelParameters.octree_resolution = Number(paramDefaults.octree_resolution ?? 512);
      modelParameters.enable_realesrgan = settings.enableRealESRGAN !== false;
    } else if (modelId.includes('unique3d')) {
      // Unique3D model-native parameters (official defaults)
      modelParameters.seed = paramDefaults.seed ?? settings.seed ?? 1145;
      modelParameters.input_processing = paramDefaults.input_processing ?? true;
      modelParameters.do_refine = paramDefaults.do_refine ?? true;
      modelParameters.expansion_weight = Number(paramDefaults.expansion_weight ?? 0.1);
      modelParameters.init_type = paramDefaults.init_type ?? 'std';
    }

    if (modelId.includes('hunyuan3d_dit_v2_mini_turbo')) {
      modelParameters.enable_flashvdm = true;
    }
  
  // Pass Paint-v2-1 parameters for shape models to enable auto-chaining
  if (isPaintModel) {
    modelParameters.max_num_view = settings.maxNumView ?? 6;
    modelParameters.resolution = settings.resolution ?? 512;
    modelParameters.auto_paint = true;
    modelParameters.paint_model_preference = 'hunyuan3d_paint_v21_image_mesh_painting';
    modelParameters.paint_resolution = settings.paintResolution ?? (
      settings.textureQuality === 'low' ? 512 :
      settings.textureQuality === 'medium' ? 512 :
      settings.textureQuality === '8k' ? 768 :
      768
    );
  }
}