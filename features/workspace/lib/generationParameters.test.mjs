import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationParameters } from '../utils/buildGenerationParameters.ts';

test('buildGenerationParameters configures Hunyuan3D-DiT-v2-mini-Turbo with 380 octree and 80k chunks (hyphenated id)', () => {
  const settings = {
    imageFileId: 'file-test-hunyuan-mini-123',
    aiModel: 'hunyuan3d-dit-v2-mini-turbo',
    meshQuality: 'high',
    generateTexture: false,
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });

  assert.equal(result.modelParameters.octree_resolution, 380);
  assert.equal(result.modelParameters.num_inference_steps, 5);
  assert.equal(result.modelParameters.num_chunks, 80000);
});

test('buildGenerationParameters configures Hunyuan3D-DiT-v2-mini-Turbo with 380 octree and 80k chunks (underscored id)', () => {
  const settings = {
    imageFileId: 'file-test-hunyuan-mini-456',
    aiModel: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
    meshQuality: 'high',
    generateTexture: false,
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });

  assert.equal(result.modelParameters.octree_resolution, 380);
  assert.equal(result.modelParameters.num_inference_steps, 5);
  assert.equal(result.modelParameters.num_chunks, 80000);
});
