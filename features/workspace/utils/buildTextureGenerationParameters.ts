import type { TextureSettings } from '../types';

type TextureResolution = TextureSettings['resolution'];

export interface TextureGenerationRequestInput {
  resolution?: TextureResolution;
  prompt?: string | null;
  referenceImage?: string | null;
  referenceImageFileId?: string | null;
}

export interface TextureMeshReference {
  mesh_file_id?: string;
  mesh_path?: string;
}

export interface TextureGenerationRequest {
  endpoint: string;
  modelPreference: string;
  body: Record<string, unknown>;
}

const TEXTURE_ENDPOINT = '/api/v1/mesh-generation/image-mesh-painting';

function resolutionInPixels(resolution: TextureResolution): number {
  return {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
    '8K': 8192,
  }[resolution];
}

function imageBase64WithoutDataUrl(image: string): string {
  const separator = image.indexOf(',');
  return separator >= 0 ? image.slice(separator + 1) : image;
}

/**
 * Serialize the supported image-mesh-painting contract.
 * Model-native inference settings belong to the backend adapter, not this request.
 */
export function buildTextureGenerationParameters(
  settings: TextureGenerationRequestInput,
  meshReference: TextureMeshReference,
  sourceReference?: { url?: string | null; fileId?: string | null },
): TextureGenerationRequest {
  const resolution = settings.resolution || '2K';
  const isHighResolution = resolution === '4K' || resolution === '8K';
  const modelPreference = isHighResolution
    ? 'hunyuan3d_paint_v21_image_mesh_painting'
    : 'paint3d';
  const referenceImage = settings.referenceImage || sourceReference?.url;
  const referenceFileId = settings.referenceImageFileId || sourceReference?.fileId;

  if (!referenceImage && !referenceFileId) {
    throw new Error('No texture reference image provided. Please supply one.');
  }

  const body: Record<string, unknown> = {
    texture_resolution: resolutionInPixels(resolution),
    texture_resolution_preset: resolution,
    output_format: 'glb',
    model_preference: modelPreference,
    enable_postprocess: false,
    postprocess_mode: 'manual_mesh_tool',
    ...meshReference,
  };

  if (referenceFileId) {
    body.image_file_id = referenceFileId;
  } else if (referenceImage?.startsWith('data:')) {
    body.image_base64 = imageBase64WithoutDataUrl(referenceImage);
  } else if (referenceImage) {
    body.image_path = referenceImage;
  }

  // Paint3D accepts text guidance; Hunyuan3D-Paint is reference-image guided.
  const prompt = settings.prompt?.trim();
  if (prompt && !isHighResolution) {
    body.text_prompt = prompt;
  }

  return { endpoint: TEXTURE_ENDPOINT, modelPreference, body };
}
