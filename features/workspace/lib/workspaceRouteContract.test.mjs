import test from 'node:test';
import assert from 'node:assert/strict';
import { isKnownWorkspaceRoute } from './workspaceRouteContract.ts';

test('workspace tool routes are explicitly allow-listed', () => {
  for (const tool of [
    'generate', 'model', '3d-gen', 'remesh', 'texture', 'textures', 'uv',
    'segment', 'edit', 'upscale', 'pbr', 'animation', 'animate', 'rigging',
  ]) {
    assert.equal(isKnownWorkspaceRoute([tool]), true, `expected /workspace/${tool} to be mounted`);
  }
});

test('workspace shell view aliases remain routable', () => {
  for (const view of ['overview', 'dashboard', 'assets', 'outputs', 'system', 'jobs', 'models']) {
    assert.equal(isKnownWorkspaceRoute([view]), true, `expected /workspace/${view} to be mounted`);
  }
  assert.equal(isKnownWorkspaceRoute(['jobs', 'job-123']), true);
});

test('unknown tools and malformed nested routes are rejected', () => {
  assert.equal(isKnownWorkspaceRoute(['made-up-tool']), false);
  assert.equal(isKnownWorkspaceRoute(['texture', 'unknown']), false);
  assert.equal(isKnownWorkspaceRoute(['jobs', 'job-123', 'extra']), false);
  assert.equal(isKnownWorkspaceRoute([]), false);
});
