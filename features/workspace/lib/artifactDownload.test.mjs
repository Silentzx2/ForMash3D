import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadArtifact } from './artifactDownload.ts';

function response(body, status, contentType, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, ...headers },
  });
}

test('downloads only a successful artifact response and preserves its filename', async () => {
  let saved;
  await downloadArtifact('/artifact', 'mesh.fbx', 'fbx', {
    fetcher: async (_url, options) => {
      assert.equal(options.credentials, 'same-origin');
      return response('Kaydara FBX Binary', 200, 'model/fbx', {
        'content-disposition': 'attachment; filename="server-mesh.fbx"',
      });
    },
    save: (blob, filename) => { saved = { blob, filename }; },
  });

  assert.equal(saved.filename, 'server-mesh.fbx');
  assert.equal(await saved.blob.text(), 'Kaydara FBX Binary');
});

test('surfaces backend error details without saving an error payload', async () => {
  let saveCalled = false;
  await assert.rejects(
    downloadArtifact('/artifact', 'mesh.fbx', 'fbx', {
      fetcher: async () => response(JSON.stringify({ detail: 'FBX export requires rigging (UniRig).' }), 422, 'application/json'),
      save: () => { saveCalled = true; },
    }),
    /Download failed \(HTTP 422\): FBX export requires rigging \(UniRig\)/,
  );
  assert.equal(saveCalled, false);
});

test('rejects unexpected content types and JSON error payloads returned as files', async () => {
  let saveCalled = false;
  for (const artifact of [
    response('{"detail":"missing"}', 200, 'application/json'),
    response('<html>not found</html>', 200, 'application/octet-stream'),
  ]) {
    await assert.rejects(
      downloadArtifact('/artifact', 'mesh.glb', 'glb', {
        fetcher: async () => artifact,
        save: () => { saveCalled = true; },
      }),
    );
  }
  assert.equal(saveCalled, false);
});

test('rejects an error body mislabeled as FBX', async () => {
  let saveCalled = false;
  await assert.rejects(
    downloadArtifact('/artifact', 'mesh.fbx', 'fbx', {
      fetcher: async () => response('File not found', 200, 'model/fbx'),
      save: () => { saveCalled = true; },
    }),
    /not a valid FBX file/,
  );
  assert.equal(saveCalled, false);
});

test('rejects a network failure without creating a download', async () => {
  let saveCalled = false;
  await assert.rejects(
    downloadArtifact('/artifact', 'mesh.zip', 'zip', {
      fetcher: async () => { throw new Error('offline'); },
      save: () => { saveCalled = true; },
    }),
    /Could not reach the artifact download endpoint.*offline/,
  );
  assert.equal(saveCalled, false);
});