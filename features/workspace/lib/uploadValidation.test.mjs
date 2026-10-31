import assert from 'node:assert/strict';
import test from 'node:test';
import { validate3DFile } from './fileValidation.ts';
import { requireUploadFileId } from './uploadResponse.ts';
import { getUploadPercent } from './uploadProgress.ts';

test('requires a non-empty backend file ID', () => {
  assert.equal(requireUploadFileId(' mesh-123 ', 'mesh'), 'mesh-123');
  assert.throws(() => requireUploadFileId('  ', 'mesh'), /did not return a file ID/);
  assert.throws(() => requireUploadFileId(null, 'image'), /did not return a file ID/);
});

test('calculates upload percentage from byte totals and leaves unknown totals unknown', () => {
  assert.equal(getUploadPercent(20 * 1024 * 1024, 40 * 1024 * 1024), 50);
  assert.equal(getUploadPercent(45, 40), 100);
  assert.equal(getUploadPercent(120, null), null);
  assert.equal(getUploadPercent(120, 0), null);
});

test('rejects GLTF files with external resources and identifies the missing files', async () => {
  const file = new File([JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'scene.bin', byteLength: 4 }],
    images: [{ uri: 'textures/albedo.png' }],
  })], 'scene.gltf', { type: 'model/gltf+json' });

  const result = await validate3DFile(file, 'upload');
  assert.equal(result.valid, false);
  assert.match(result.error, /scene\.bin, textures\/albedo\.png/);
  assert.match(result.error, /self-contained GLB/);
});

test('rejects GLTF resources that are declared but missing a URI or buffer view', async () => {
  const file = new File([JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: 4 }],
    images: [{}],
  })], 'scene.gltf', { type: 'model/gltf+json' });

  const result = await validate3DFile(file, 'upload');
  assert.equal(result.valid, false);
  assert.match(result.error, /buffer 1, image 1/);
});

test('accepts a self-contained GLTF with embedded resources', async () => {
  const file = new File([JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }],
    images: [{ uri: 'data:image/png;base64,AAAA' }],
  })], 'scene.gltf', { type: 'model/gltf+json' });

  const result = await validate3DFile(file, 'upload');
  assert.equal(result.valid, true);
});

test('rejects empty or malformed embedded GLTF data URIs', async () => {
  const file = new File([JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'data:application/octet-stream;base64,', byteLength: 0 }],
  })], 'empty.gltf', { type: 'model/gltf+json' });

  const result = await validate3DFile(file, 'upload');
  assert.equal(result.valid, false);
  assert.match(result.error, /external or invalid embedded resources/);
});

test('accepts FBX files and validates within 200MB limit', async () => {
  const validFbx = new File([new Uint8Array(1024)], 'model.fbx', { type: 'application/octet-stream' });
  const result = await validate3DFile(validFbx, 'upload');
  assert.equal(result.valid, true);

  // Exceeding 200MB
  const overLimit = {
    name: 'giant.fbx',
    size: 201 * 1024 * 1024,
    type: 'application/octet-stream',
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }),
  };
  const overResult = await validate3DFile(overLimit, 'upload');
  assert.equal(overResult.valid, false);
  assert.match(overResult.error, /File too large/);
  assert.match(overResult.error, /200MB/);
});