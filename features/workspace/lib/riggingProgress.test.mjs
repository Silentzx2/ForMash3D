import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRigProgress, computeRigStatusText } from './riggingProgress.ts';

test('absent progress returns 0 and never synthesizes percentage', () => {
  assert.equal(computeRigProgress({ status: 'queued' }), 0);
  assert.equal(computeRigProgress({ status: 'queued', progress: null }), 0);
  assert.equal(computeRigProgress({ status: 'processing' }), 0);
  assert.equal(computeRigProgress({ status: 'processing', progress: undefined }), 0);
  assert.equal(computeRigProgress({ status: 'processing', progress: Number.NaN }), 0);
});

test('stalled job does not accrue progress across repeated polls', () => {
  const poll1 = { status: 'processing', progress: 0.42 };
  const poll2 = { status: 'processing', progress: 0.42 };
  const poll3 = { status: 'processing', progress: 0.42 };

  const p1 = computeRigProgress(poll1);
  const p2 = computeRigProgress(poll2);
  const p3 = computeRigProgress(poll3);

  assert.equal(p1, 42);
  assert.equal(p2, 42);
  assert.equal(p3, 42);
  assert.equal(p2 - p1, 0, 'stalled job must not accrue progress on poll');
  assert.equal(p3 - p2, 0, 'stalled job must not accrue progress on poll');
});

test('changing progress values update accurately from backend', () => {
  assert.equal(computeRigProgress({ status: 'processing', progress: 0.15 }), 15);
  assert.equal(computeRigProgress({ status: 'processing', progress: 0.6 }), 60);
  assert.equal(computeRigProgress({ status: 'processing', progress: 85 }), 85);
});

test('completed jobs reach 100 only on completion', () => {
  assert.equal(computeRigProgress({ status: 'completed' }), 100);
  assert.equal(computeRigProgress({ status: 'completed', progress: 0.5 }), 100);
});

test('failed and cancelled jobs reset progress to 0', () => {
  assert.equal(computeRigProgress({ status: 'failed', progress: 0.9 }), 0);
  assert.equal(computeRigProgress({ status: 'cancelled', progress: 0.5 }), 0);
});

test('status text reflects real backend stage and queued state honestly', () => {
  assert.equal(computeRigStatusText({ status: 'queued' }), 'Waiting for GPU scheduler…');
  assert.equal(computeRigStatusText({ status: 'queued', message: 'Queued on GPU...' }), 'Queued on GPU...');
  assert.equal(computeRigStatusText({ status: 'processing' }), 'Fitting skeleton & skinning weights…');
  assert.equal(computeRigStatusText({ status: 'processing', stage: 'skeleton' }), 'Fitting skeleton & skinning weights… (skeleton)');
  assert.equal(computeRigStatusText({ status: 'completed' }), 'Rig generated successfully!');
  assert.equal(computeRigStatusText({ status: 'failed' }), 'failed');
  assert.equal(computeRigStatusText({ status: 'cancelled' }), 'cancelled');
});
