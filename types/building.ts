export interface BuildingPoint {
  x: number;
  y: number;
}

export interface BuildingPolygon {
  id: string;
  points: BuildingPoint[];
  height?: number;
  storeys?: number;
}

export interface BuildingStyleConfig {
  style: string;
  roofType: 'flat' | 'hip' | 'gabled' | 'mansard';
  facadeTexture: string;
  wallTexture: string;
}

export interface BuildingNode {
  id: string;
  type: 'footprint' | 'mass' | 'facade' | 'roof' | 'output' | string;
  props: Record<string, unknown>;
}

export interface BuildingEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface BuildingDoc {
  nodes: BuildingNode[];
  edges: BuildingEdge[];
  metadata?: Record<string, unknown>;
}
