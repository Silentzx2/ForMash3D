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

test('buildGenerationParameters propagates candidate_count (clamped between 1 and 4)', () => {
  const settingsDefault = {
    imageFileId: 'file-test-cand-1',
    meshQuality: 'high',
    enablePostprocess: false,
  };
  const resDefault = buildGenerationParameters(settingsDefault, { raw_mesh: true });
  assert.equal(resDefault.body.candidate_count, 1);

  const settingsFour = {
    imageFileId: 'file-test-cand-4',
    candidateCount: 4,
    meshQuality: 'high',
    enablePostprocess: false,
  };
  const resFour = buildGenerationParameters(settingsFour, { raw_mesh: true });
  assert.equal(resFour.body.candidate_count, 4);
  assert.equal(resFour.modelParameters.candidate_count, 4);

  const settingsClamped = {
    imageFileId: 'file-test-cand-clamped',
    candidateCount: 99,
    meshQuality: 'high',
    enablePostprocess: false,
  };
  const resClamped = buildGenerationParameters(settingsClamped, { raw_mesh: true });
  assert.equal(resClamped.body.candidate_count, 4);
});
