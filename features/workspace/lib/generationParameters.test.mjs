import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationParameters } from '../utils/buildGenerationParameters.ts';

test('buildGenerationParameters applies the Mini Turbo stress-test profile (hyphenated id)', () => {
  const settings = {
    imageFileId: 'file-test-hunyuan-mini-123',
    aiModel: 'hunyuan3d-dit-v2-mini-turbo',
    meshQuality: 'high',
    generateTexture: false,
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });

  assert.equal(result.modelParameters.octree_resolution, 768);
  assert.equal(result.modelParameters.num_inference_steps, 20);
  assert.equal(result.modelParameters.num_chunks, 80000);
});

test('buildGenerationParameters applies the Mini Turbo stress-test profile (underscored id)', () => {
  const settings = {
    imageFileId: 'file-test-hunyuan-mini-456',
    aiModel: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
    meshQuality: 'high',
    generateTexture: false,
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });

  assert.equal(result.modelParameters.octree_resolution, 768);
  assert.equal(result.modelParameters.num_inference_steps, 20);
  assert.equal(result.modelParameters.num_chunks, 80000);
});

test('preset overrides win after the model profile and reach the outgoing request', () => {
  const settings = {
    imageFileId: 'file-test-generation-preset',
    aiModel: 'hunyuan3d-shape-v21',
    meshQuality: 'high',
    seed: 123,
    guidanceScale: 7.5,
    modelParameterOverrides: {
      seed: 98765,
      guidance_scale: 8.25,
      octree_resolution: 1536,
      num_inference_steps: 177,
      sampler_overrides: { shape: { steps: 111, guidance_strength: 9.25 } },
    },
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });
  assert.equal(result.modelParameters.seed, 98765);
  assert.equal(result.modelParameters.guidance_scale, 8.25);
  assert.equal(result.modelParameters.octree_resolution, 1536);
  assert.equal(result.modelParameters.num_inference_steps, 177);
  assert.deepEqual(result.body.model_parameters, result.modelParameters);
  assert.deepEqual(result.body.model_parameters.sampler_overrides, {
    shape: { steps: 111, guidance_strength: 9.25 },
  });
});

test('parameter overrides reject invalid roots and unsafe nested keys', () => {
  assert.throws(() => buildGenerationParameters({
    imageFileId: 'file-test-invalid-overrides',
    modelParameterOverrides: ['not', 'an', 'object'],
  }, { raw_mesh: true }), /safe JSON object/);
  const unsafe = JSON.parse('{"sampler":{"__proto__":{"polluted":true}}}');
  assert.throws(() => buildGenerationParameters({
    imageFileId: 'file-test-unsafe-overrides',
    modelParameterOverrides: unsafe,
  }, { raw_mesh: true }), /safe JSON object/);
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

test('buildGenerationParameters attaches default quality, mesh_style, object_type, and symmetry', () => {
  const settings = {
    imageFileId: 'file-test-defaults',
    enablePostprocess: false,
  };
  const res = buildGenerationParameters(settings, { raw_mesh: true });
  assert.equal(res.body.quality, 'balanced');
  assert.equal(res.body.requested_quality, 'balanced');
  assert.equal(res.body.mesh_style, 'auto');
  assert.equal(res.body.object_type, 'general');
  assert.equal(res.body.symmetry, 'none');

  assert.equal(res.modelParameters.quality, 'balanced');
  assert.equal(res.modelParameters.requested_quality, 'balanced');
  assert.equal(res.modelParameters.mesh_style, 'auto');
  assert.equal(res.modelParameters.object_type, 'general');
  assert.equal(res.modelParameters.symmetry, 'none');
});

test('buildGenerationParameters attaches explicit quality, mesh_style, object_type, and symmetry', () => {
  const settings = {
    imageFileId: 'file-test-explicit',
    quality: 'high',
    meshStyle: 'clean',
    objectType: 'mechanical',
    symmetry: 'bilateral',
    enablePostprocess: false,
  };
  const res = buildGenerationParameters(settings, { raw_mesh: true });
  assert.equal(res.body.quality, 'high');
  assert.equal(res.body.requested_quality, 'high');
  assert.equal(res.body.mesh_style, 'clean');
  assert.equal(res.body.object_type, 'mechanical');
  assert.equal(res.body.symmetry, 'bilateral');

  assert.equal(res.modelParameters.quality, 'high');
  assert.equal(res.modelParameters.mesh_style, 'clean');
  assert.equal(res.modelParameters.object_type, 'mechanical');
  assert.equal(res.modelParameters.symmetry, 'bilateral');
});
