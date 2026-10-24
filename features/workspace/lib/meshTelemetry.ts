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

  // High-performance typed array direct access: eliminates millions of Vector3 GC allocations
  const posArray = pos.array as Float32Array;
  const indexArray = index ? (index.array as Uint16Array | Uint32Array) : null;

  for (let i = 0; i < triCount; i++) {
    const i3 = i * 3;
    const a = indexArray ? indexArray[i3] : i3;
    const b = indexArray ? indexArray[i3 + 1] : i3 + 1;
    const c = indexArray ? indexArray[i3 + 2] : i3 + 2;

    const a3 = a * 3;
    const b3 = b * 3;
    const c3 = c * 3;

    const ax = posArray[a3], ay = posArray[a3 + 1], az = posArray[a3 + 2];
    const bx = posArray[b3], by = posArray[b3 + 1], bz = posArray[b3 + 2];
    const cx = posArray[c3], cy = posArray[c3 + 1], cz = posArray[c3 + 2];

    // cb = C - B
    const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
    // ab = A - B
    const abx = ax - bx, aby = ay - by, abz = az - bz;

    // cross = cb x ab
    const crossX = cby * abz - cbz * aby;
    const crossY = cbz * abx - cbx * abz;
    const crossZ = cbx * aby - cby * abx;

    totalArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) * 0.5;
    signedVolume += (ax * crossX + ay * crossY + az * crossZ) / 6.0;
  }

  let nonManifoldEdges = 0;
  let boundaryEdges = 0;

  // Topological edge evaluation:
  // For interactive 60fps responsiveness, execute on meshes <= 50,000 triangles.
  // Beyond 50k, dense meshes avoid massive string/map heap allocations on the UI thread.
  if (triCount <= 50000) {
    const isSmallIndex = pos.count < 65536;
    const edgeMap = new Map<number | string, number>();

    for (let i = 0; i < triCount; i++) {
      const i3 = i * 3;
      const a = indexArray ? indexArray[i3] : i3;
      const b = indexArray ? indexArray[i3 + 1] : i3 + 1;
      const c = indexArray ? indexArray[i3 + 2] : i3 + 2;

      const e1 = isSmallIndex ? (a < b ? a * 65536 + b : b * 65536 + a) : (a < b ? `${a}_${b}` : `${b}_${a}`);
      const e2 = isSmallIndex ? (b < c ? b * 65536 + c : c * 65536 + b) : (b < c ? `${b}_${c}` : `${c}_${b}`);
      const e3 = isSmallIndex ? (c < a ? c * 65536 + a : a * 65536 + c) : (c < a ? `${c}_${a}` : `${a}_${c}`);

      edgeMap.set(e1, (edgeMap.get(e1) || 0) + 1);
      edgeMap.set(e2, (edgeMap.get(e2) || 0) + 1);
      edgeMap.set(e3, (edgeMap.get(e3) || 0) + 1);
    }

    for (const count of edgeMap.values()) {
      if (count > 2) nonManifoldEdges++;
      else if (count === 1) boundaryEdges++;
    }
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
  // Performance safeguard for dense high-poly meshes (>25k triangles)
  if (triCount > 25000) return 1;

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

  const position = geom.attributes.position;
  const normal = geom.attributes.normal;
  let normalsAreInvalid = (
    !normal
    || normal.count !== position.count
    || normal.itemSize < 3
  );

  if (!normalsAreInvalid && normal) {
    const values = normal.array as ArrayLike<number>;
    const stride = normal.itemSize;
    for (let i = 0; i < normal.count; i++) {
      const x = Number(values[i * stride]);
      const y = Number(values[i * stride + 1]);
      const z = Number(values[i * stride + 2]);
      if (
        !Number.isFinite(x)
        || !Number.isFinite(y)
        || !Number.isFinite(z)
        || x * x + y * y + z * z < 1e-12
      ) {
        normalsAreInvalid = true;
        break;
      }
    }
  }

  if (normalsAreInvalid) {
    geom.deleteAttribute('normal');
    geom.computeVertexNormals();
  }

  // Only run computeTangents on client if explicitly needed and mesh is within reasonable complexity (<= 60,000 vertices)
  // Very dense meshes cause UI freeze if tangents are computed synchronously on the CPU; Three.js computes tangent space on GPU via derivatives automatically.
  if (geom.attributes.uv && !geom.attributes.tangent && (geom.attributes.position.count || 0) <= 60000) {
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
