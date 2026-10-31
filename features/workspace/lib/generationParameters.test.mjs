import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerationParameters,
  parseModelParameterOverrides,
  resolveGenerationModelCapabilities,
  resolveGenerationModelChoice,
} from '../utils/buildGenerationParameters.ts';

// Rule 1: UI-provided quality, meshQuality, requested_quality, num_inference_steps, guidance_scale,
// octree_resolution, sampler dictionaries and Low-VRAM overrides do not reach model inference.
test('Rule 1: UI inference-quality and parameter overrides do not reach model_parameters or body', () => {
  const settings = {
    imageFileId: 'file-rule-1',
    aiModel: 'hunyuan3d-shape-v21',
    quality: 'high',
    meshQuality: 'ultra',
    requested_quality: 'ultra',
    guidanceScale: 15.0,
    modelParameterOverrides: {
      num_inference_steps: 250,
      guidance_scale: 12.5,
      octree_resolution: 2048,
      low_vram: true,
      sampler_overrides: { shape: { steps: 88 } },
    },
    enablePostprocess: false,
  };

  const result = buildGenerationParameters(settings, { raw_mesh: true });

  assert.equal(result.body.quality, undefined);
  assert.equal(result.body.requested_quality, undefined);
  assert.equal(result.body.mesh_style, undefined);
  assert.equal(result.body.object_type, undefined);
  assert.equal(result.body.symmetry, undefined);

  assert.equal(result.modelParameters.num_inference_steps, undefined);
  assert.equal(result.modelParameters.guidance_scale, undefined);
  assert.equal(result.modelParameters.octree_resolution, undefined);
  assert.equal(result.modelParameters.low_vram, undefined);
  assert.equal(result.modelParameters.sampler_overrides, undefined);
  assert.deepEqual(result.body.model_parameters, {});
});

// Rule 2: The request sends only supported runtime inputs (including a supported seed) as adapter inputs.
test('Rule 2: supported runtime seed is sent to model_parameters', () => {
  const settings = {
    imageFileId: 'file-rule-2',
    aiModel: 'trellis_image_to_textured_mesh',
    seed: 54321,
    enablePostprocess: true,
  };
  const result = buildGenerationParameters(settings);
  assert.equal(result.body.model_parameters.seed, 54321);
  assert.equal(result.modelParameters.seed, 54321);
  assert.deepEqual(Object.keys(result.body.model_parameters), ['seed']);
});

// Rule 3: candidate_count is bounded by the API-supported range and stays a scheduler control.
test('Rule 3: candidate_count is clamped to 1-4 and stays top-level on body', () => {
  const settingsDefault = { imageFileId: 'file-rule-3-def' };
  const resDefault = buildGenerationParameters(settingsDefault);
  assert.equal(resDefault.body.candidate_count, 1);
  assert.equal(resDefault.modelParameters.candidate_count, undefined);

  const settingsFour = { imageFileId: 'file-rule-3-four', candidateCount: 4 };
  const resFour = buildGenerationParameters(settingsFour);
  assert.equal(resFour.body.candidate_count, 4);
  assert.equal(resFour.modelParameters.candidate_count, undefined);

  const settingsClampedHigh = { imageFileId: 'file-rule-3-clamp-high', candidateCount: 99 };
  assert.equal(buildGenerationParameters(settingsClampedHigh).body.candidate_count, 4);

  const settingsClampedLow = { imageFileId: 'file-rule-3-clamp-low', candidateCount: 0 };
  assert.equal(buildGenerationParameters(settingsClampedLow).body.candidate_count, 1);
});

// Rule 4: target_polycount is independent of inference parameters and goes to the production path.
test('Rule 4: target_polycount is an output production budget, not an inference parameter', () => {
  const settings = {
    imageFileId: 'file-rule-4',
    aiModel: 'hunyuan3d_shape_v21_image_to_raw_mesh',
    autoOptimizeSettings: { targetPolycount: 35000 },
    enablePostprocess: true,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });
  assert.equal(result.body.target_polycount, 35000);
  assert.equal(result.modelParameters.target_polycount, undefined);
  assert.equal(result.modelParameters.faces, undefined);
  assert.equal(result.modelParameters.decimation_target, undefined);
});

// Rule 5: A selected intent/preset is sent as the expected backend field without auto-submitting from preset click.
test('Rule 5: intent field propagates to request body', () => {
  const settings = {
    imageFileId: 'file-rule-5',
    intent: 'game_ready',
    autoOptimizeSettings: { targetPolycount: 50000 },
    enablePostprocess: true,
  };
  const result = buildGenerationParameters(settings);
  assert.equal(result.body.intent, 'game_ready');
  assert.equal(result.body.target_polycount, 50000);
});

// Rule 6: Explicit production choices and defaults have predictable precedence.
test('Rule 6: explicit production settings take precedence', () => {
  const settings = {
    imageFileId: 'file-rule-6',
    intent: 'game_ready',
    quadTopology: true,
    topologyMode: 'quad',
    generateCollision: true,
    physics: { bodyType: 'dynamic', friction: 0.8 },
    highResolutionNormalBaking: false,
    enablePrintabilityCheck: true,
    enableAutoRepair: true,
    enableAutoRig: true,
    autoRigMode: 'skeleton',
    autoOptimizeSettings: { targetPolycount: 42000 },
    enablePostprocess: true,
  };
  const result = buildGenerationParameters(settings);
  assert.equal(result.body.topology_mode, 'quad');
  assert.equal(result.body.quad_topology, true);
  assert.equal(result.body.physics_enabled, true);
  assert.deepEqual(result.body.physics_config, { bodyType: 'dynamic', friction: 0.8 });
  assert.equal(result.body.bake_normal_maps, false);
  assert.equal(result.body.enable_printability_check, true);
  assert.equal(result.body.enable_auto_repair, true);
  assert.equal(result.body.enable_auto_rig, true);
  assert.equal(result.body.auto_rig_mode, 'skeleton');
  assert.equal(result.body.target_polycount, 42000);
});

// Rule 7: Raw/post-processing-off mode does not accidentally invoke texture, LOD, collision, repair, printability, normal baking, or rigging.
test('Rule 7: post-processing off disables all downstream production stages', () => {
  const settings = {
    imageFileId: 'file-rule-7',
    intent: 'game_ready',
    generateTexture: true,
    generateLOD: true,
    generateCollision: true,
    enablePrintabilityCheck: true,
    enableAutoRepair: true,
    enableAutoRig: true,
    quadTopology: true,
    highResolutionNormalBaking: true,
    autoOptimizeSettings: { targetPolycount: 50000 },
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(settings, { raw_mesh: true });
  assert.equal(result.body.enable_postprocess, false);
  assert.equal(result.body.target_polycount, 0);
  assert.equal(result.body.texture_enabled, false);
  assert.equal(result.body.generate_texture, false);
  assert.equal(result.body.physics_enabled, false);
  assert.equal(result.body.physics_config, undefined);
  assert.equal(result.body.enable_printability_check, false);
  assert.equal(result.body.enable_auto_repair, false);
  assert.equal(result.body.enable_auto_rig, false);
  assert.equal(result.body.bake_normal_maps, false);
  assert.equal(result.body.quad_topology, false);
  assert.equal(result.body.intent, undefined);
  assert.equal(result.isTextured, false);
});

// Rule 8: Missing/invalid image input produces a clear failure before submission.
test('Rule 8: missing image input throws a clear actionable error', () => {
  assert.throws(
    () => buildGenerationParameters({}),
    /No usable image input/
  );
  assert.throws(
    () => buildGenerationParameters({ image: 'not-a-data-uri' }),
    /No usable image input/
  );
});

test('sample SVG paths are uploaded before becoming generation inputs', () => {
  assert.throws(
    () => buildGenerationParameters({ image: '/samples/mech-sentinel.svg' }),
    /No usable image input/
  );

  const uploadedSample = buildGenerationParameters({
    image: '/api/v1/file-upload/download/sample-file-id',
    imageFileId: 'sample-file-id',
  });
  assert.equal(uploadedSample.body.image_file_id, 'sample-file-id');
  assert.equal(uploadedSample.body.image_base64, undefined);
});

// Rule 9: Legacy saved presets containing old inference override keys cannot reintroduce those values.
test('Rule 9: legacy inference override keys in saved presets are not merged', () => {
  const legacyPreset = {
    imageFileId: 'file-rule-9',
    aiModel: 'hunyuan3d-dit-v2-mini-turbo',
    modelParameterOverrides: {
      octree_resolution: 768,
      num_inference_steps: 20,
      guidance_scale: 5.0,
      low_vram: false,
      mc_algo: 'mc',
    },
    enablePostprocess: false,
  };
  const result = buildGenerationParameters(legacyPreset, { raw_mesh: true });
  assert.deepEqual(result.body.model_parameters, {});
  assert.equal(result.modelParameters.octree_resolution, undefined);
  assert.equal(result.modelParameters.num_inference_steps, undefined);
});

// Rule 10: Primary Generate, batch, retry and saved-preset call sites produce compatible request shapes.
test('Rule 10: primary, batch, and retry requests produce compatible endpoint and body contracts', () => {
  const primarySettings = {
    imageFileId: 'file-primary',
    aiModel: 'trellis2_image_to_textured_mesh',
    seed: 1234,
    autoOptimizeSettings: { targetPolycount: 50000 },
    enablePostprocess: true,
  };
  const primaryRes = buildGenerationParameters(primarySettings);

  const batchSettings = {
    imageFileId: 'file-batch',
    aiModel: 'trellis2_image_to_textured_mesh',
    seed: 5678,
    autoOptimizeSettings: { targetPolycount: 50000 },
    enablePostprocess: true,
  };
  const batchRes = buildGenerationParameters(batchSettings);

  assert.equal(primaryRes.endpoint, batchRes.endpoint);
  assert.equal(typeof primaryRes.body.image_file_id, 'string');
  assert.equal(typeof batchRes.body.image_file_id, 'string');
  assert.equal(primaryRes.body.output_format, batchRes.body.output_format);
  assert.equal(primaryRes.body.model_preference, batchRes.body.model_preference);
  assert.equal(primaryRes.body.enable_postprocess, batchRes.body.enable_postprocess);
  assert.equal(primaryRes.body.target_polycount, batchRes.body.target_polycount);
});

// Rule 11: The LOD controls reach the request as production options and stay within the levels
// the post-processing pipeline can build (LOD0-LOD3).
test('Rule 11: LOD options reach the request body and are clamped to the supported level count', () => {
  const enabled = buildGenerationParameters({
    imageFileId: 'file-rule-11-on',
    generateLOD: true,
    lodPreset: 'mobile',
    lodCount: 3,
    enablePostprocess: true,
  });
  assert.equal(enabled.body.generate_lod, true);
  assert.equal(enabled.body.lod_preset, 'mobile');
  assert.equal(enabled.body.lod_count, 3);
  assert.equal(enabled.modelParameters.generateLOD, undefined);

  const disabled = buildGenerationParameters({
    imageFileId: 'file-rule-11-off',
    generateLOD: false,
    lodPreset: 'mobile',
    lodCount: 4,
    enablePostprocess: true,
  });
  assert.equal(disabled.body.generate_lod, false);
  assert.equal(disabled.body.lod_preset, undefined);
  assert.equal(disabled.body.lod_count, undefined);

  const clamped = buildGenerationParameters({
    imageFileId: 'file-rule-11-clamp',
    generateLOD: true,
    lodCount: 6,
    enablePostprocess: true,
  });
  assert.equal(clamped.body.lod_count, 4);

  const raw = buildGenerationParameters({
    imageFileId: 'file-rule-11-raw',
    generateLOD: true,
    lodCount: 4,
    enablePostprocess: false,
  }, { raw_mesh: true });
  assert.equal(raw.body.generate_lod, false);
  assert.equal(raw.body.lod_preset, undefined);
  assert.equal(raw.body.lod_count, undefined);
});

test('unsupported or contradictory persisted production values are normalized before submission', () => {
  const stale = buildGenerationParameters({
    imageFileId: 'file-stale-controls',
    topologyMode: 'adaptive',
    quadTopology: false,
    lodPreset: 'custom',
    autoRigMode: 'humanoid',
    generateLOD: true,
    enableAutoRig: true,
    enablePostprocess: true,
  });

  assert.equal(stale.body.topology_mode, 'triangle');
  assert.equal(stale.body.quad_topology, false);
  assert.equal(stale.body.lod_preset, 'high');
  assert.equal(stale.body.auto_rig_mode, 'full');

  // A recognized topology mode is authoritative over a stale legacy boolean.
  const triangleWins = buildGenerationParameters({
    imageFileId: 'file-triangle-wins',
    topologyMode: 'triangle',
    quadTopology: true,
    enablePostprocess: true,
  });
  assert.equal(triangleWins.body.topology_mode, 'triangle');
  assert.equal(triangleWins.body.quad_topology, false);

  const valid = buildGenerationParameters({
    imageFileId: 'file-supported-controls',
    topologyMode: 'quad',
    quadTopology: true,
    lodPreset: 'mobile',
    autoRigMode: 'skin',
    generateLOD: true,
    enableAutoRig: true,
    enablePostprocess: true,
  });
  assert.equal(valid.body.topology_mode, 'quad');
  assert.equal(valid.body.quad_topology, true);
  assert.equal(valid.body.lod_preset, 'mobile');
  assert.equal(valid.body.auto_rig_mode, 'skin');
});

test('explicit model selection wins over a preset resolver suggestion; auto mode may use the suggestion', () => {
  assert.equal(resolveGenerationModelChoice('triposg_image_to_raw_mesh', 'hunyuan3d_shape_v21_image_to_raw_mesh'), 'triposg_image_to_raw_mesh');
  assert.equal(resolveGenerationModelChoice('', 'trellis2_image_to_textured_mesh'), 'trellis2_image_to_textured_mesh');
  assert.equal(resolveGenerationModelChoice(undefined, undefined), '');
});

test('model capabilities are derived from manifest metadata for generation paths', () => {
  assert.deepEqual(resolveGenerationModelCapabilities('triposg_image_to_raw_mesh'), {
    raw_mesh: true, paint_autochain: false, supports_texture: false,
  });
  assert.deepEqual(resolveGenerationModelCapabilities('trellis2_image_to_textured_mesh', {
    raw_mesh: false, paint_autochain: true, texture_generation: true,
  }), {
    raw_mesh: false, paint_autochain: true, supports_texture: true,
  });
  assert.deepEqual(resolveGenerationModelCapabilities('example', { texture_generation: false }), {
    raw_mesh: false, paint_autochain: false, supports_texture: false,
  });
});

test('candidate count remains bounded when a malformed non-finite value is supplied', () => {
  assert.equal(buildGenerationParameters({
    imageFileId: 'file-invalid-count', candidateCount: Number.NaN,
  }).body.candidate_count, 1);
});

test('texture generation is controlled by generateTexture, not the legacy generatePBR flag', () => {
  const disabled = buildGenerationParameters({
    imageFileId: 'file-texture-disabled',
    generateTexture: false,
    generatePBR: true,
  });
  assert.equal(disabled.body.texture_enabled, false);
  assert.equal(disabled.body.generate_texture, false);

  const enabled = buildGenerationParameters({
    imageFileId: 'file-texture-enabled',
    generateTexture: true,
    generatePBR: false,
  });
  assert.equal(enabled.body.texture_enabled, true);
  assert.equal(enabled.body.generate_texture, true);
});

test('parseModelParameterOverrides enforces object safety', () => {
  assert.deepEqual(parseModelParameterOverrides(undefined), {});
  assert.deepEqual(parseModelParameterOverrides(null), {});
  assert.deepEqual(parseModelParameterOverrides({ a: 1 }), { a: 1 });
  assert.throws(() => parseModelParameterOverrides('string'), /safe JSON object/);
  assert.throws(() => parseModelParameterOverrides([1, 2]), /safe JSON object/);
  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => parseModelParameterOverrides(unsafe), /safe JSON object/);
});

test('part_count_range, rig_type, export_formats and slicer_handoff reach the request body as production options', () => {
  const settings = {
    imageFileId: 'file-parts',
    enablePostprocess: true,
    partCountRange: '6-15',
    rigType: 'humanoid',
    exportFormats: ['glb', 'stl'],
    slicerHandoff: true,
  };
  const result = buildGenerationParameters(settings);
  assert.equal(result.body.part_count_range, '6-15');
  assert.equal(result.body.rig_type, 'humanoid');
  assert.deepEqual(result.body.export_formats, ['glb', 'stl']);
  assert.equal(result.body.slicer_handoff, true);
  assert.equal(result.modelParameters.part_count_range, undefined);
  assert.equal(result.modelParameters.rig_type, undefined);
  assert.equal(result.modelParameters.export_formats, undefined);
  assert.equal(result.modelParameters.slicer_handoff, undefined);
});

test('production part/rig/export/slicer options are dropped when post-processing is off', () => {
  const settings = {
    imageFileId: 'file-parts-off',
    enablePostprocess: false,
    partCountRange: '6-15',
    rigType: 'humanoid',
    exportFormats: ['glb', 'stl'],
    slicerHandoff: true,
  };
  const result = buildGenerationParameters(settings);
  assert.equal(result.body.part_count_range, undefined);
  assert.equal(result.body.rig_type, undefined);
  assert.equal(result.body.export_formats, undefined);
  assert.equal(result.body.slicer_handoff, undefined);
});

test('low_vram setting is not serialized as an adapter inference override', () => {
  const lowVramOn = buildGenerationParameters({
    imageFileId: 'file-trellis2-low-vram-on',
    aiModel: 'trellis2_image_to_raw_mesh',
    low_vram: true,
  });
  assert.equal(lowVramOn.body.low_vram, undefined);
  assert.equal(lowVramOn.modelParameters.low_vram, undefined);

  const lowVramOff = buildGenerationParameters({
    imageFileId: 'file-trellis2-low-vram-off',
    aiModel: 'trellis2_image_to_raw_mesh',
    low_vram: false,
  });
  assert.equal(lowVramOff.body.low_vram, undefined);
  assert.equal(lowVramOff.modelParameters.low_vram, undefined);
});
