import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTextureGenerationParameters } from '../utils/buildTextureGenerationParameters.ts';

test('Paint3D texture requests serialize only supported production inputs', () => {
  const result = buildTextureGenerationParameters(
    {
      resolution: '2K',
      prompt: 'brushed metal',
      referenceImageFileId: 'image-123',
    },
    { mesh_file_id: 'mesh-456' },
  );

  assert.equal(result.endpoint, '/api/v1/mesh-generation/image-mesh-painting');
  assert.equal(result.modelPreference, 'paint3d');
  assert.equal(result.body.texture_resolution, 2048);
  assert.equal(result.body.image_file_id, 'image-123');
  assert.equal(result.body.mesh_file_id, 'mesh-456');
  assert.equal(result.body.text_prompt, 'brushed metal');
  assert.equal(result.body.model_parameters, undefined);
  assert.equal(result.body.generate_pbr, undefined);
  assert.equal(result.body.quad_topology, undefined);
  assert.equal(result.body.topology_mode, undefined);
});

test('Hunyuan texture requests use the reference image and do not send Paint3D guidance or adapter overrides', () => {
  const result = buildTextureGenerationParameters(
    {
      resolution: '4K',
      prompt: 'ignored by the reference-image adapter',
      referenceImage: 'data:image/png;base64,QUJD',
    },
    { mesh_path: 'mesh.glb' },
  );

  assert.equal(result.modelPreference, 'hunyuan3d_paint_v21_image_mesh_painting');
  assert.equal(result.body.texture_resolution, 4096);
  assert.equal(result.body.image_base64, 'QUJD');
  assert.equal(result.body.text_prompt, undefined);
  assert.equal(result.body.model_parameters, undefined);
  assert.equal(result.body.generate_pbr, undefined);
});

test('texture serialization requires a reference image', () => {
  assert.throws(
    () => buildTextureGenerationParameters({ resolution: '2K' }, { mesh_file_id: 'mesh-123' }),
    /No texture reference image provided/,
  );
});
