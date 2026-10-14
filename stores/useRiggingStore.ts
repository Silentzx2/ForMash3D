import { create } from 'zustand';
import { getApiClient } from '@/services/apiClient';
import { getSymmetricBoneName } from '@/stores/useAnimationStore';

export interface RigBoneNode {
  name: string;
  parent: string | null;
  type: 'Root' | 'Deform' | 'IK' | 'Control';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible?: boolean;
}

export const DEFAULT_RIG_BONES: RigBoneNode[] = [
  { name: 'Root', parent: null, type: 'Root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Hips', parent: 'Root', type: 'Root', position: [0, 1.0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Spine', parent: 'Hips', type: 'Deform', position: [0, 1.15, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Spine1', parent: 'Spine', type: 'Deform', position: [0, 1.3, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Spine2', parent: 'Spine1', type: 'Deform', position: [0, 1.45, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Chest', parent: 'Spine2', type: 'Deform', position: [0, 1.55, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Neck', parent: 'Chest', type: 'Deform', position: [0, 1.68, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'Head', parent: 'Neck', type: 'Deform', position: [0, 1.82, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftShoulder', parent: 'Chest', type: 'Deform', position: [0.18, 1.52, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftArm', parent: 'LeftShoulder', type: 'Deform', position: [0.38, 1.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftForeArm', parent: 'LeftArm', type: 'Deform', position: [0.65, 1.48, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftHand', parent: 'LeftForeArm', type: 'Deform', position: [0.88, 1.45, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightShoulder', parent: 'Chest', type: 'Deform', position: [-0.18, 1.52, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightArm', parent: 'RightShoulder', type: 'Deform', position: [-0.38, 1.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightForeArm', parent: 'RightArm', type: 'Deform', position: [-0.65, 1.48, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightHand', parent: 'RightForeArm', type: 'Deform', position: [-0.88, 1.45, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftUpLeg', parent: 'Hips', type: 'Deform', position: [0.15, 0.95, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftLeg', parent: 'LeftUpLeg', type: 'Deform', position: [0.15, 0.52, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'LeftFoot', parent: 'LeftLeg', type: 'Deform', position: [0.15, 0.08, 0.12], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightUpLeg', parent: 'Hips', type: 'Deform', position: [-0.15, 0.95, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightLeg', parent: 'RightUpLeg', type: 'Deform', position: [-0.15, 0.52, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
  { name: 'RightFoot', parent: 'RightLeg', type: 'Deform', position: [-0.15, 0.08, 0.12], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
];

export type RiggingMethod = 'auto_rig' | 'manual_rig';
export type TargetSkeleton = 'biped' | 'humanoid' | 'quadruped';
export type RiggingWorkspaceAction = 'pose' | 'edit_bones' | 'weight_paint' | 'preview_animation';
export type RiggingViewportTool = 'select' | 'move' | 'rotate' | 'scale';

interface RiggingState {
  // Character information
  characterName: string;
  characterVertices: number;
  characterSizeMb: number;
  characterMeshUrl: string | null;
  setCharacterInfo: (info: { name?: string; vertices?: number; sizeMb?: number; meshUrl?: string }) => void;

  // Rigging options & method (UniRig AI or Manual with Symmetry)
  riggingMethod: RiggingMethod;
  setRiggingMethod: (m: RiggingMethod) => void;
  autoRigProvider: 'unirig_auto_rig';
  setAutoRigProvider: (p: 'unirig_auto_rig') => void;
  targetSkeleton: TargetSkeleton;
  setTargetSkeleton: (s: TargetSkeleton) => void;

  // Options switches
  createIkControls: boolean;
  setCreateIkControls: (val: boolean) => void;
  optimizeForAnimation: boolean;
  setOptimizeForAnimation: (val: boolean) => void;
  symmetry: boolean;
  setSymmetry: (val: boolean) => void;
  reuseExistingWeights: boolean;
  setReuseExistingWeights: (val: boolean) => void;

  // Advanced options
  advancedOptionsOpen: boolean;
  setAdvancedOptionsOpen: (val: boolean) => void;
  rigMode: 'skeleton' | 'skin' | 'full';
  setRigMode: (mode: 'skeleton' | 'skin' | 'full') => void;

  // Generation status
  isGenerating: boolean;
  generationProgress: number;
  generationStatus: string;
  generationError: string | null;
  jobId: string | null;
  riggedModelUrl: string | null;
  riggedFbxUrl: string | null;

  // Workspace modes
  workspaceAction: RiggingWorkspaceAction;
  setWorkspaceAction: (action: RiggingWorkspaceAction) => void;
  viewportTool: RiggingViewportTool;
  setViewportTool: (tool: RiggingViewportTool) => void;

  // Bone hierarchy & selection
  bones: RigBoneNode[];
  setBones: (bones: RigBoneNode[]) => void;
  selectedBone: string | null;
  setSelectedBone: (name: string | null) => void;
  updateBoneProperty: (name: string, props: Partial<RigBoneNode>) => void;
  toggleBoneVisibility: (name: string) => void;
  boneSearchQuery: string;
  setBoneSearchQuery: (q: string) => void;

  // Weight paint settings
  brushRadius: number;
  setBrushRadius: (r: number) => void;
  brushStrength: number;
  setBrushStrength: (s: number) => void;
  brushFalloff: 'linear' | 'smooth' | 'sphere';
  setBrushFalloff: (f: 'linear' | 'smooth' | 'sphere') => void;

  // Actions
  generateRig: (meshPath?: string, meshFileId?: string) => Promise<boolean>;
  resumeRigPolling: () => Promise<boolean>;
  cancelRigPolling: () => void;
  applyAndSaveRig: (snapshot?: {
    bones: Pick<RigBoneNode, 'name' | 'parent' | 'position' | 'rotation'>[];
    riggedModelUrl: string | null;
  }) => Promise<boolean>;
  resetRigState: () => void;
}

let rigPollTimer: ReturnType<typeof setTimeout> | null = null;
let rigPollPaused = false;
let rigPollGeneration = 0;
let rigPollWake: ((cancelled: boolean) => void) | null = null;

function waitForRigPoll(ms: number): Promise<boolean> {
  if (rigPollPaused) return Promise.resolve(true);
  return new Promise((resolve) => {
    rigPollWake = resolve;
    rigPollTimer = setTimeout(() => {
      rigPollTimer = null;
      const wake = rigPollWake;
      rigPollWake = null;
      wake?.(false);
    }, ms);
  });
}

function cancelRigPollWait() {
  rigPollPaused = true;
  rigPollGeneration += 1;
  if (rigPollTimer) clearTimeout(rigPollTimer);
  rigPollTimer = null;
  const wake = rigPollWake;
  rigPollWake = null;
  wake?.(true);
}

export const useRiggingStore = create<RiggingState>((set, get) => {
  const pollRigJob = async (jobId: string): Promise<boolean> => {
    const generation = ++rigPollGeneration;
    const client = getApiClient();
    while (get().jobId === jobId && generation === rigPollGeneration) {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (await waitForRigPoll(hidden ? 3000 : 1200)) return false;

      let statusRes;
      try {
        statusRes = await client.getJobStatus(jobId);
      } catch {
        set({ generationStatus: 'Connection interrupted; retrying job status…' });
        continue;
      }
      if (get().jobId !== jobId || generation !== rigPollGeneration) return false;

      if (statusRes.status === 'processing' || statusRes.status === 'queued') {
        set({
          generationProgress: Math.min(90, get().generationProgress + (statusRes.status === 'processing' ? 2 : 1)),
          generationStatus: statusRes.status === 'queued' ? 'Waiting for GPU scheduler…' : 'Fitting skeleton & skinning weights…',
        });
      } else if (statusRes.status === 'completed') {
        set({
          isGenerating: false,
          generationProgress: 100,
          generationStatus: 'Rig generated successfully!',
          riggedModelUrl: `/api/v1/system/jobs/${encodeURIComponent(jobId)}/download`,
          riggedFbxUrl: `/api/v1/system/jobs/${encodeURIComponent(jobId)}/download?artifact_format=fbx`,
        });
        return true;
      } else if (statusRes.status === 'failed' || statusRes.status === 'cancelled') {
        throw new Error((statusRes as any).error_message || `Auto-rigging job ${statusRes.status}`);
      }
    }
    return false;
  };

  const failRigJob = (err: unknown) => {
    set({
      isGenerating: false,
      generationProgress: 0,
      generationStatus: 'failed',
      generationError: err instanceof Error ? err.message : 'Auto-rigging failed',
    });
    return false;
  };

  return ({
  characterName: 'Character Mesh',
  characterVertices: 0,
  characterSizeMb: 0,
  characterMeshUrl: null,
  setCharacterInfo: (info) =>
    set((s) => ({
      characterName: info.name ?? s.characterName,
      characterVertices: info.vertices ?? s.characterVertices,
      characterSizeMb: info.sizeMb ?? s.characterSizeMb,
      characterMeshUrl: info.meshUrl ?? s.characterMeshUrl,
    })),

  riggingMethod: 'auto_rig',
  setRiggingMethod: (riggingMethod) => set({ riggingMethod }),
  autoRigProvider: 'unirig_auto_rig',
  setAutoRigProvider: (autoRigProvider) => set({ autoRigProvider }),
  targetSkeleton: 'biped',
  setTargetSkeleton: (targetSkeleton) => set({ targetSkeleton }),

  createIkControls: true,
  setCreateIkControls: (createIkControls) => set({ createIkControls }),
  optimizeForAnimation: true,
  setOptimizeForAnimation: (optimizeForAnimation) => set({ optimizeForAnimation }),
  symmetry: true,
  setSymmetry: (symmetry) => set({ symmetry }),
  reuseExistingWeights: false,
  setReuseExistingWeights: (reuseExistingWeights) => set({ reuseExistingWeights }),

  advancedOptionsOpen: false,
  setAdvancedOptionsOpen: (advancedOptionsOpen) => set({ advancedOptionsOpen }),
  rigMode: 'full',
  setRigMode: (rigMode) => set({ rigMode }),

  isGenerating: false,
  generationProgress: 0,
  generationStatus: 'idle',
  generationError: null,
  jobId: null,
  riggedModelUrl: null,
  riggedFbxUrl: null,

  workspaceAction: 'pose',
  setWorkspaceAction: (workspaceAction) => set({ workspaceAction }),
  viewportTool: 'select',
  setViewportTool: (viewportTool) => set({ viewportTool }),

  bones: DEFAULT_RIG_BONES,
  setBones: (bones) => set({ bones }),
  selectedBone: 'Hips',
  setSelectedBone: (selectedBone) => set({ selectedBone }),
  updateBoneProperty: (name, props) =>
    set((s) => {
      let updated = s.bones.map((b) => (b.name === name ? { ...b, ...props } : b));
      if (s.symmetry && props.position) {
        const counterpartName = getSymmetricBoneName(name);
        if (counterpartName && s.bones.some((b) => b.name === counterpartName)) {
          const mirroredPos: [number, number, number] = [-props.position[0], props.position[1], props.position[2]];
          updated = updated.map((b) => (b.name === counterpartName ? { ...b, position: mirroredPos } : b));
        }
      }
      return { bones: updated };
    }),
  toggleBoneVisibility: (name) =>
    set((s) => ({
      bones: s.bones.map((b) => (b.name === name ? { ...b, visible: !(b.visible ?? true) } : b)),
    })),
  boneSearchQuery: '',
  setBoneSearchQuery: (boneSearchQuery) => set({ boneSearchQuery }),

  brushRadius: 0.25,
  setBrushRadius: (brushRadius) => set({ brushRadius }),
  brushStrength: 0.8,
  setBrushStrength: (brushStrength) => set({ brushStrength }),
  brushFalloff: 'smooth',
  setBrushFalloff: (brushFalloff) => set({ brushFalloff }),

  // Real backend call to /api/v1/auto-rigging/generate-rig
  generateRig: async (meshPath?: string, meshFileId?: string) => {
    rigPollPaused = false;
    const { autoRigProvider, rigMode, targetSkeleton } = get();
    if (!meshFileId && !meshPath) {
      set({ generationError: 'Select or upload a mesh first' });
      return false;
    }
    set({
      isGenerating: true,
      generationProgress: 10,
      generationStatus: 'Initializing auto-rigging pipeline...',
      generationError: null,
      riggedModelUrl: null,
      riggedFbxUrl: null,
    });

    try {
      const client = getApiClient();
      const payload: Record<string, unknown> = {
        rig_mode: rigMode,
        output_format: 'fbx',
        model_preference: autoRigProvider,
        model_parameters: {
          target_skeleton: targetSkeleton,
          optimize_weights: get().optimizeForAnimation,
          create_ik: get().createIkControls,
          symmetry: get().symmetry,
        },
      };
      if (meshFileId) payload.mesh_file_id = meshFileId;
      else if (meshPath) payload.mesh_path = meshPath;

      const response = await client.generateRig(payload);
      if (!response.job_id) throw new Error('Backend did not return a job ID');
      set({ jobId: response.job_id, generationProgress: 25, generationStatus: 'Queued on GPU...' });
      return await pollRigJob(response.job_id);
    } catch (err) {
      return failRigJob(err);
    }
  },

  resumeRigPolling: async () => {
    rigPollPaused = false;
    const jobId = get().jobId;
    if (!jobId || get().generationStatus !== 'paused') return false;
    set({ isGenerating: true, generationStatus: 'Reconnecting to rig job…', generationError: null });
    try {
      return await pollRigJob(jobId);
    } catch (err) {
      return failRigJob(err);
    }
  },

  cancelRigPolling: () => {
    cancelRigPollWait();
    if (get().jobId && get().isGenerating) {
      set({ isGenerating: false, generationStatus: 'paused' });
    }
  },

  applyAndSaveRig: async (snapshot) => {
    try {
      const { characterName, bones, riggedModelUrl } = get();
      const rigSnapshot = {
        version: 1,
        savedAt: new Date().toISOString(),
        characterName,
        riggedModelUrl: snapshot ? snapshot.riggedModelUrl : riggedModelUrl,
        bones: snapshot?.bones ?? bones,
        skeleton: 'Editor Armature Snapshot',
      };
      localStorage.setItem('formash-3d-rigging-asset', JSON.stringify(rigSnapshot));
      return true;
    } catch (err) {
      console.error('Failed to save rig:', err);
      return false;
    }
  },

  resetRigState: () => {
    cancelRigPollWait();
    set({
      bones: DEFAULT_RIG_BONES,
      selectedBone: 'Hips',
      isGenerating: false,
      generationProgress: 0,
      generationStatus: 'idle',
      generationError: null,
      jobId: null,
      riggedModelUrl: null,
      riggedFbxUrl: null,
    });
  },
});
