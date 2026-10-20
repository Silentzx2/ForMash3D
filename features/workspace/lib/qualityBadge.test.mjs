import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQualityMetrics } from '../Panels/GeneratePanel.tsx';

test('computeQualityMetrics assigns "Sharp" for high feature edge retention (>= 0.85)', () => {
  const asset = {
    id: 'asset-sharp',
    name: 'Sharp Model',
    triangles: 50000,
    faces: 50000,
    nonManifoldEdges: 0,
    artifacts: {
      qaReport: {
        topology_gate: { passed_clean: true },
        master_to_derivative: { feature_edge_retention: 0.94 },
      },
    },
  };

  const metrics = computeQualityMetrics(asset);
  assert.equal(metrics.status, 'Sharp');
  assert.equal(metrics.triangles, 50000);
  assert.equal(metrics.nonManifoldEdges, 0);
  assert.equal(metrics.holes, 0);
  assert.equal(metrics.featureEdgeRetention, 0.94);
});

test('computeQualityMetrics assigns "Clean" when gate is passed without high sharpness', () => {
  const asset = {
    id: 'asset-clean',
    name: 'Clean Model',
    triangles: 30000,
    faces: 30000,
    nonManifoldEdges: 0,
    artifacts: {
      qaReport: {
        topology_gate: { passed_clean: true },
        master_to_derivative: { feature_edge_retention: 0.72 },
      },
    },
  };

  const metrics = computeQualityMetrics(asset);
  assert.equal(metrics.status, 'Clean');
  assert.equal(metrics.triangles, 30000);
  assert.equal(metrics.nonManifoldEdges, 0);
  assert.equal(metrics.holes, 0);
  assert.equal(metrics.featureEdgeRetention, 0.72);
});

test('computeQualityMetrics assigns "Needs Review" on violations or warnings', () => {
  const assetWithWarnings = {
    id: 'asset-warnings',
    name: 'Warning Model',
    triangles: 25000,
    faces: 25000,
    nonManifoldEdges: 2,
    qaWarnings: ['Non-manifold edge detected'],
    artifacts: {
      qaReport: {
        topology_gate: { passed_clean: false },
        warnings: ['Degraded edge'],
      },
    },
  };

  const metrics = computeQualityMetrics(assetWithWarnings);
  assert.equal(metrics.status, 'Needs Review');
  assert.equal(metrics.triangles, 25000);
  assert.equal(metrics.nonManifoldEdges, 2);
  assert.ok(metrics.warnings.length > 0);
});

test('computeQualityMetrics extracts metrics from rawResult HUD job', () => {
  const rawResult = {
    triangle_count: 42000,
    non_manifold_edges: 0,
    hole_count: 0,
    feature_edge_retention: 0.91,
    topology_gate: { passed_clean: true },
  };

  const metrics = computeQualityMetrics(null, rawResult);
  assert.equal(metrics.status, 'Sharp');
  assert.equal(metrics.triangles, 42000);
  assert.equal(metrics.nonManifoldEdges, 0);
  assert.equal(metrics.holes, 0);
  assert.equal(metrics.featureEdgeRetention, 0.91);
});
