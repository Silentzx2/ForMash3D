import * as THREE from 'three';

export interface MeshTelemetryResult {
  triangles: number;
  vertices: number;
  surfaceArea: number; // in m²
  volume: number; // in m³
  isManifold: boolean;
  nonManifoldEdges: number;
  boundaryEdges: number;
  uvCharts: number;
}

/**
 * Computes real-time topology and geometry telemetry for a BufferGeometry.
 * Includes surface area, signed enclosed volume, manifold edge integrity, and UV charts.
 */
export function analyzeGeometryTelemetry(geometry: THREE.BufferGeometry): MeshTelemetryResult {
  const pos = geometry.attributes?.position;
  const index = geometry.index;

  if (!pos || pos.count === 0) {
    return {
      triangles: 0,
      vertices: 0,
      surfaceArea: 0,
      volume: 0,
      isManifold: true,
      nonManifoldEdges: 0,
      boundaryEdges: 0,
      uvCharts: 0,
    };
  }

  const triCount = index ? index.count / 3 : pos.count / 3;
  let totalArea = 0;
  let signedVolume = 0;

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const cross = new THREE.Vector3();

  // Edge count map for manifold check: key -> frequency
  const edgeMap = new Map<string, number>();

  for (let i = 0; i < triCount; i++) {
    const a = index ? index.getX(i * 3) : i * 3;
    const b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const c = index ? index.getX(i * 3 + 2) : i * 3 + 2;

    pA.fromBufferAttribute(pos, a);
    pB.fromBufferAttribute(pos, b);
    pC.fromBufferAttribute(pos, c);

    // Triangle surface area = 0.5 * |(C - B) x (A - B)|
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cross.crossVectors(cb, ab);
    totalArea += cross.length() * 0.5;

    // Signed tetrahedron volume = (A · (B x C)) / 6
    signedVolume += pA.dot(cross) / 6.0;

    // Fast undirected edge recording
    const e1 = a < b ? `${a}_${b}` : `${b}_${a}`;
    const e2 = b < c ? `${b}_${c}` : `${c}_${b}`;
    const e3 = c < a ? `${c}_${a}` : `${a}_${c}`;

    edgeMap.set(e1, (edgeMap.get(e1) || 0) + 1);
    edgeMap.set(e2, (edgeMap.get(e2) || 0) + 1);
    edgeMap.set(e3, (edgeMap.get(e3) || 0) + 1);
  }

  let nonManifoldEdges = 0;
  let boundaryEdges = 0;
  for (const count of edgeMap.values()) {
    if (count > 2) nonManifoldEdges++;
    else if (count === 1) boundaryEdges++;
  }

  const uvCharts = countUVCharts(geometry, triCount);

  return {
    triangles: Math.round(triCount),
    vertices: pos.count,
    surfaceArea: Number(totalArea.toFixed(4)),
    volume: Number(Math.abs(signedVolume).toFixed(4)),
    isManifold: nonManifoldEdges === 0,
    nonManifoldEdges,
    boundaryEdges,
    uvCharts,
  };
}

/**
 * Calculates connected UV islands/charts via disjoint set forest.
 */
export function countUVCharts(geometry: THREE.BufferGeometry, maxTriangles?: number): number {
  const uv = geometry.attributes?.uv;
  const index = geometry.index;
  const pos = geometry.attributes?.position;
  if (!uv || !pos) return 0;

  const triCount = maxTriangles ?? (index ? index.count / 3 : pos.count / 3);
  if (triCount === 0) return 0;
  // Performance safeguard for dense high-poly meshes (>40k triangles)
  if (triCount > 40000) return 1;

  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;

  function find(i: number): number {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const next = parent[curr];
      parent[curr] = root;
      curr = next;
    }
    return root;
  }

  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  const uvKey = (u: number, v: number) => `${Math.round(u * 1000) / 1000}_${Math.round(v * 1000) / 1000}`;
  const uvEdgeMap = new Map<string, number>();

  for (let f = 0; f < triCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;

    const k0 = uvKey(uv.getX(i0), uv.getY(i0));
    const k1 = uvKey(uv.getX(i1), uv.getY(i1));
    const k2 = uvKey(uv.getX(i2), uv.getY(i2));

    const edges = [
      k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`,
      k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`,
      k2 < k0 ? `${k2}|${k0}` : `${k0}|${k2}`,
    ];

    for (const e of edges) {
      const existing = uvEdgeMap.get(e);
      if (existing !== undefined) {
        union(f, existing);
      } else {
        uvEdgeMap.set(e, f);
      }
    }
  }

  const roots = new Set<number>();
  for (let i = 0; i < triCount; i++) roots.add(find(i));
  return roots.size;
}

/**
 * Ensures a mesh has vertex normals, computed tangents (for micro-relief normal mapping),
 * and calibrated shadow receiver settings.
 */
export function prepareMeshTangentsAndNormals(mesh: THREE.Mesh): void {
  const geom = mesh.geometry;
  if (!geom || !geom.attributes?.position) return;

  if (!geom.attributes.normal) {
    geom.computeVertexNormals();
  }

  if (geom.attributes.uv && !geom.attributes.tangent) {
    try {
      if (!geom.index) {
        const count = geom.attributes.position.count;
        const indices = new Uint32Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        geom.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      geom.computeTangents();
    } catch {
      // Degenerate or non-triangular UV attributes are skipped gracefully
    }
  }

  mesh.castShadow = true;
  // Dense meshes: disable self-shadow receiver to prevent GPU fill-rate throttling
  mesh.receiveShadow = (geom.attributes.position.count || 0) < 200000;
}
