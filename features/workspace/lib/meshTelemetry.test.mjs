import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  analyzeGeometryTelemetry,
  countUVCharts,
  prepareMeshTangentsAndNormals,
} from './meshTelemetry.ts';

test('analyzeGeometryTelemetry accurately computes box geometry metrics', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const telemetry = analyzeGeometryTelemetry(box);

  assert.equal(telemetry.triangles, 12);
  assert.equal(telemetry.vertices, 24);
  // 6 faces * (2 * 2) = 24 m²
  assert.equal(telemetry.surfaceArea, 24);
  // Volume = 2 * 2 * 2 = 8 m³
  assert.equal(telemetry.volume, 8);
  assert.equal(telemetry.isManifold, true);
  assert.equal(telemetry.nonManifoldEdges, 0);
  assert.ok(telemetry.uvCharts >= 1);
});

test('analyzeGeometryTelemetry handles empty or degenerate geometry gracefully', () => {
  const emptyGeom = new THREE.BufferGeometry();
  const telemetry = analyzeGeometryTelemetry(emptyGeom);

  assert.equal(telemetry.triangles, 0);
  assert.equal(telemetry.vertices, 0);
  assert.equal(telemetry.surfaceArea, 0);
  assert.equal(telemetry.volume, 0);
  assert.equal(telemetry.isManifold, true);
  assert.equal(telemetry.nonManifoldEdges, 0);
});

test('analyzeGeometryTelemetry detects non-manifold edges', () => {
  // Construct a geometry with 3 faces sharing the same edge [0, 1]
  const geom = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 0, // 0
    1, 0, 0, // 1
    0, 1, 0, // 2 (Face 1: 0, 1, 2)
    0, 0, 1, // 3 (Face 2: 0, 1, 3)
    0, -1, 0 // 4 (Face 3: 0, 1, 4)
  ]);
  const indices = new Uint32Array([
    0, 1, 2,
    0, 1, 3,
    0, 1, 4
  ]);
  geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));

  const telemetry = analyzeGeometryTelemetry(geom);
  assert.equal(telemetry.isManifold, false);
  assert.ok(telemetry.nonManifoldEdges > 0);
});

test('prepareMeshTangentsAndNormals computes normals and tangents for mesh', () => {
  const geom = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geom);

  assert.equal(Boolean(mesh.geometry.attributes.tangent), false);
  prepareMeshTangentsAndNormals(mesh);

  assert.ok(mesh.geometry.attributes.normal);
  assert.ok(mesh.geometry.attributes.tangent);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
});


test('recomputes zero and non-finite imported normals before viewport shading', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 0,
    Number.NaN, 0, 0,
    0, 0, 0,
  ], 3));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  prepareMeshTangentsAndNormals(mesh);

  const normals = geometry.getAttribute('normal');
  assert.ok(normals);
  for (let i = 0; i < normals.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    assert.ok(Number.isFinite(normal.x));
    assert.ok(Number.isFinite(normal.y));
    assert.ok(Number.isFinite(normal.z));
    assert.ok(normal.length() > 0.99);
  }

  geometry.dispose();
  mesh.material.dispose();
});
