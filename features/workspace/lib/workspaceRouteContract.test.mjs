import test from 'node:test';
import assert from 'node:assert/strict';
import { isKnownWorkspaceRoute } from './workspaceRouteContract.ts';

const jobId = '00000000-0000-4000-8000-000000000001';

test('workspace tool routes are explicitly allow-listed', () => {
  for (const tool of [
    'generate', 'model', '3d-gen', 'remesh', 'texture', 'textures', 'uv',
    'segment', 'edit', 'upscale', 'pbr', 'animation', 'animate', 'rigging', 'tools',
  ]) {
    assert.equal(isKnownWorkspaceRoute([tool]), true, `expected /workspace/${tool} to be mounted`);
    assert.equal(isKnownWorkspaceRoute([tool, jobId]), true, `expected deep-linked /workspace/${tool}/${jobId} to be mounted`);
  }
});

test('workspace shell view aliases remain routable', () => {
  for (const view of ['overview', 'dashboard', 'assets', 'outputs', 'system', 'jobs', 'models']) {
    assert.equal(isKnownWorkspaceRoute([view]), true, `expected /workspace/${view} to be mounted`);
  }
  assert.equal(isKnownWorkspaceRoute(['jobs', jobId]), true);
});

test('unknown tools and malformed nested routes are rejected', () => {
  assert.equal(isKnownWorkspaceRoute(['made-up-tool']), false);
  assert.equal(isKnownWorkspaceRoute(['texture', 'unknown']), false);
  assert.equal(isKnownWorkspaceRoute(['jobs', jobId, 'extra']), false);
  assert.equal(isKnownWorkspaceRoute([]), false);
});
