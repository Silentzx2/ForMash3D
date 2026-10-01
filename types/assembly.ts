export interface AssemblyTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface AssemblyPiece {
  id: string;
  name: string;
  fileUrl?: string;
  role: 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory' | 'base' | 'piece';
  visible: boolean;
  transform: AssemblyTransform;
  landmarks?: Array<{ id: string; name: string; position: [number, number, number] }>;
  fit?: {
    status: 'idle' | 'running' | 'success' | 'failed';
    message?: string;
    stats?: Record<string, unknown>;
    fittedAt?: string | null;
  };
}

export interface AssemblySettings {
  selectedPieceId?: string | null;
  activeTab?: string;
  collisionAvoidance?: boolean;
}

export interface AssemblyDoc {
  id?: string;
  name?: string;
  basePieceId?: string | null;
  pieces: AssemblyPiece[];
  settings: AssemblySettings;
  merged?: Record<string, unknown>;
}
