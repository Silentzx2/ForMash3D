export interface VfxBlock {
  id: string;
  type: string;
  category: 'spawn' | 'initialize' | 'update' | 'output';
  params: Record<string, number | string | boolean | number[]>;
  enabled?: boolean;
}

export interface VfxContextNodeData {
  title: string;
  contextType: 'spawn' | 'initialize' | 'update' | 'output';
  blocks: VfxBlock[];
}

export interface VfxSystem {
  id: string;
  capacity: number;
  contexts: Record<string, VfxBlock[]>;
}

export interface VfxGraphIR {
  version: string;
  metadata: { name: string; author?: string; tags?: string[] };
  systems: VfxSystem[];
}

export interface VfxPreset {
  id: string;
  name: string;
  description?: string;
  category: string;
  thumbnailUrl?: string;
  doc: Record<string, unknown>;
}
