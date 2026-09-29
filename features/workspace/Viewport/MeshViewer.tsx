import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  Hand,
  Camera,
  Grid as GridIcon,
  RotateCcw,
  RotateCw,
  Printer,
  Download,
  ChevronDown,
  Sparkles,
  Check,
  UploadCloud,
  Search,
  Sun,
  Move,
  Box,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Compass,
  X
} from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';
import { CameraViewPreset, ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { getApiClient } from '@/services/apiClient';
import { useAnimationStore, BoneItem } from '@/stores/useAnimationStore';
import { useViewerStore } from '@/stores/useViewerStore';

import { validate3DFile } from '../lib/fileValidation';
import { createPointCloudFromImage, createFallbackPointCloud, disposePointCloud } from './ImagePointCloud';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getCachedGLB, setCachedGLB, loadGLBWithProgress } from '../lib/glbCache';
import { PhysicsRuntime } from '../physics/PhysicsRuntime';

const disposeMaterial = (material: THREE.Material) => {
  const m = material as any;
  const texProps = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap'
  ];
  for (const prop of texProps) {
    if (m[prop] instanceof THREE.Texture) {
      m[prop].dispose();
    }
  }
  Object.values(material).forEach((v: any) => { if (v instanceof THREE.Texture) v.dispose(); });
  material.dispose();
};

// Reusable loaders to avoid GC churn on frequent model switching
const dracoLoader = new DRACOLoader();
if (typeof window !== 'undefined') {
  try {
    dracoLoader.setDecoderPath('/draco/gltf/');
  } catch {}
}

const sharedGLTFLoader = new GLTFLoader();
sharedGLTFLoader.setDRACOLoader(dracoLoader);
try {
  sharedGLTFLoader.setMeshoptDecoder(MeshoptDecoder);
} catch {}

const sharedOBJLoader = new OBJLoader();
const sharedPLYLoader = new PLYLoader();
const sharedSTLLoader = new STLLoader();

// Shared geometries and materials for zero-allocation, 60fps armature rendering
const sharedJointGeo = new THREE.SphereGeometry(1, 14, 10);
const sharedJointMat = new THREE.MeshStandardMaterial({
  color: 0x00F5D4,
  emissive: 0x00A896,
  emissiveIntensity: 0.4,
  roughness: 0.2,
  metalness: 0.5,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});
const sharedJointSelectedMat = new THREE.MeshStandardMaterial({
  color: 0xF5C542,
  emissive: 0xF5C542,
  emissiveIntensity: 0.8,
  roughness: 0.2,
  metalness: 0.5,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});
const sharedBoneMat = new THREE.MeshStandardMaterial({
  color: 0xE0A800,
  roughness: 0.35,
  metalness: 0.2,
  transparent: true,
  opacity: 0.75,
  depthTest: false,
});
const sharedBoneSelectedMat = new THREE.MeshStandardMaterial({
  color: 0xF5C542,
  roughness: 0.35,
  metalness: 0.2,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const sharedRingGeo = new THREE.RingGeometry(0.045, 0.055, 24);
const sharedRingMat = new THREE.MeshBasicMaterial({
  color: 0xF5C542,
  side: THREE.DoubleSide,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});

function createUnitBoneGeometry(): THREE.BufferGeometry {
  const width = 0.12;
  const bodyZ = 0.22;
  const len = 1.0;
  const vertices = new Float32Array([
    0, 0, 0,    width, 0, bodyZ,    0, width, bodyZ,
    0, 0, 0,    0, width, bodyZ,   -width, 0, bodyZ,
    0, 0, 0,   -width, 0, bodyZ,    0, -width, bodyZ,
    0, 0, 0,    0, -width, bodyZ,   width, 0, bodyZ,
    width, 0, bodyZ,    0, 0, len,    0, width, bodyZ,
    0, width, bodyZ,    0, 0, len,   -width, 0, bodyZ,
   -width, 0, bodyZ,    0, 0, len,    0, -width, bodyZ,
    0, -width, bodyZ,   0, 0, len,    width, 0, bodyZ,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}
const sharedBoneGeo = createUnitBoneGeometry();

// Helper to create an authentic Blender-style bone octahedron mesh between parent and child positions
function createBoneMesh(
  start: THREE.Vector3,
  end: THREE.Vector3,
  isSelected: boolean,
  boneName?: string,
  parentName?: string
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (len < 0.001) return new THREE.Mesh();

  const mesh = new THREE.Mesh(sharedBoneGeo, isSelected ? sharedBoneSelectedMat : sharedBoneMat);
  mesh.renderOrder = 9998;
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  mesh.scale.set(len, len, len);
  mesh.userData = { isConnector: true, boneName, parentName };
  return mesh;
}

function createJointMesh(pos: THREE.Vector3, isSelected: boolean, boneName: string, scale: number): THREE.Mesh {
  const radius = (isSelected ? 0.045 : 0.032) * Math.max(0.3, Math.min(scale, 2.5));
  const mesh = new THREE.Mesh(sharedJointGeo, isSelected ? sharedJointSelectedMat : sharedJointMat);
  mesh.scale.setScalar(radius);
  mesh.renderOrder = 9999;
  mesh.position.copy(pos);
  mesh.userData = { isJoint: true, boneName };
  return mesh;
}

// Procedural Skeletal Animation Generator for 17-Bone Humanoid Armature
function getSingleClipOffsets(clipId: string, t: number, muted: Set<string>) {
  const rot: Record<string, [number, number, number]> = {};
  let rootY = 0;
  let rootZ = 0;

  const armsMuted = muted.has('track-arms');
  const legsMuted = muted.has('track-legs');
  const bodyMuted = muted.has('track-body');
  const faceMuted = muted.has('track-face');
  const rootMuted = muted.has('track-root');

  if (clipId === 'anim-4' || clipId === 'anim-5') {
    // Walking cycle (stride ~ 1.8s)
    const speed = clipId === 'anim-5' ? 3.0 : 4.2;
    const phase = t * speed;
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    if (!rootMuted) rootY = Math.abs(sinP) * 0.035 - 0.015;
    if (!bodyMuted) {
      rot['Hips'] = [0, sinP * 6, 0];
      rot['Spine'] = [0, -sinP * 4, 0];
      rot['Chest'] = [4, -sinP * 3, 0];
    }
    if (!legsMuted) {
      rot['UpperLeg_L'] = [sinP * 28, 0, 0];
      rot['LowerLeg_L'] = [Math.max(0, -sinP) * 32, 0, 0];
      rot['Foot_L'] = [cosP * 12, 0, 0];

      rot['UpperLeg_R'] = [-sinP * 28, 0, 0];
      rot['LowerLeg_R'] = [Math.max(0, sinP) * 32, 0, 0];
      rot['Foot_R'] = [-cosP * 12, 0, 0];
    }
    if (!armsMuted) {
      rot['UpperArm_L'] = [-sinP * 24, 0, -20];
      rot['LowerArm_L'] = [18 + Math.max(0, -sinP) * 20, 0, 0];
      rot['UpperArm_R'] = [sinP * 24, 0, 20];
      rot['LowerArm_R'] = [18 + Math.max(0, sinP) * 20, 0, 0];
    }
    if (!faceMuted) rot['Head'] = [-2, sinP * 2, 0];
  } else if (clipId === 'anim-6' || clipId === 'anim-7') {
    // Running cycle (sprint ~ 1.0s)
    const speed = clipId === 'anim-7' ? 8.0 : 6.5;
    const phase = t * speed;
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    if (!rootMuted) {
      rootY = Math.abs(sinP) * 0.07 - 0.035;
      rootZ = 0.05;
    }
    if (!bodyMuted) {
      rot['Hips'] = [12, sinP * 10, 0];
      rot['Spine'] = [8, -sinP * 6, 0];
      rot['Chest'] = [8, -sinP * 5, 0];
    }
    if (!legsMuted) {
      rot['UpperLeg_L'] = [sinP * 46, 0, 0];
      rot['LowerLeg_L'] = [Math.max(0, -sinP) * 55, 0, 0];
      rot['Foot_L'] = [cosP * 20, 0, 0];

      rot['UpperLeg_R'] = [-sinP * 46, 0, 0];
      rot['LowerLeg_R'] = [Math.max(0, sinP) * 55, 0, 0];
      rot['Foot_R'] = [-cosP * 20, 0, 0];
    }
    if (!armsMuted) {
      rot['UpperArm_L'] = [-sinP * 40, 0, -25];
      rot['LowerArm_L'] = [45 + Math.max(0, -sinP) * 35, 0, 0];
      rot['UpperArm_R'] = [sinP * 40, 0, 25];
      rot['LowerArm_R'] = [45 + Math.max(0, sinP) * 35, 0, 0];
    }
    if (!faceMuted) rot['Head'] = [6, 0, 0];
  } else if (clipId === 'anim-8' || clipId === 'anim-9') {
    // Jump cycle
    const cycle = (t * 1.8) % 2.0;
    let jumpProgress = 0;
    if (cycle < 0.4) {
      jumpProgress = -0.08 * (cycle / 0.4);
      if (!legsMuted) {
        rot['UpperLeg_L'] = [25, 0, 0];
        rot['LowerLeg_L'] = [35, 0, 0];
        rot['UpperLeg_R'] = [25, 0, 0];
        rot['LowerLeg_R'] = [35, 0, 0];
      }
      if (!armsMuted) {
        rot['UpperArm_L'] = [-25, 0, -20];
        rot['UpperArm_R'] = [-25, 0, 20];
      }
    } else if (cycle < 1.4) {
      const inAirT = (cycle - 0.4) / 1.0;
      jumpProgress = Math.sin(inAirT * Math.PI) * 0.35;
      if (!legsMuted) {
        rot['UpperLeg_L'] = [-15, 0, 0];
        rot['LowerLeg_L'] = [10, 0, 0];
        rot['UpperLeg_R'] = [-15, 0, 0];
        rot['LowerLeg_R'] = [10, 0, 0];
      }
      if (!armsMuted) {
        rot['UpperArm_L'] = [45, 0, -35];
        rot['UpperArm_R'] = [45, 0, 35];
      }
    } else {
      const landT = (cycle - 1.4) / 0.6;
      jumpProgress = -0.06 * Math.sin(landT * Math.PI);
      if (!legsMuted) {
        rot['UpperLeg_L'] = [20 * (1 - landT), 0, 0];
        rot['LowerLeg_L'] = [30 * (1 - landT), 0, 0];
        rot['UpperLeg_R'] = [20 * (1 - landT), 0, 0];
        rot['LowerLeg_R'] = [30 * (1 - landT), 0, 0];
      }
    }
    if (!rootMuted) rootY = jumpProgress;
  } else if (clipId === 'anim-10') {
    // Wave Right Hand
    const waveOsc = Math.sin(t * 8) * 22;
    if (!armsMuted) {
      rot['UpperArm_R'] = [15, 10, 75];
      rot['LowerArm_R'] = [40, 0, 35];
      rot['Hand_R'] = [0, 0, waveOsc];
      rot['UpperArm_L'] = [0, 0, -15];
      rot['LowerArm_L'] = [10, 0, 0];
    }
    if (!faceMuted) rot['Head'] = [0, 10, 5];
    if (!bodyMuted) rot['Spine'] = [0, 3, 2];
  } else if (clipId === 'anim-11') {
    // Punch Combo
    const phase = t * 6;
    const jabR = Math.max(0, Math.sin(phase));
    const jabL = Math.max(0, Math.sin(phase + Math.PI));
    if (!armsMuted) {
      rot['UpperArm_R'] = [jabR * 80 + 10, -jabR * 20, 15];
      rot['LowerArm_R'] = [(1 - jabR) * 60, 0, 0];
      rot['UpperArm_L'] = [jabL * 80 + 10, jabL * 20, -15];
      rot['LowerArm_L'] = [(1 - jabL) * 60, 0, 0];
    }
    if (!bodyMuted) {
      rot['Chest'] = [5, (jabR - jabL) * 18, 0];
      rot['Hips'] = [0, (jabR - jabL) * 10, 0];
    }
    if (!legsMuted) {
      rot['UpperLeg_L'] = [15, 0, 0];
      rot['UpperLeg_R'] = [-15, 0, 0];
    }
  } else if (clipId === 'anim-12') {
    // Celebrate Victory
    const cheer = Math.sin(t * 4) * 8;
    if (!armsMuted) {
      rot['UpperArm_L'] = [15, 0, -70 + cheer];
      rot['LowerArm_L'] = [40, 0, 0];
      rot['UpperArm_R'] = [15, 0, 70 - cheer];
      rot['LowerArm_R'] = [40, 0, 0];
    }
    if (!bodyMuted) rot['Chest'] = [-10, 0, 0];
    if (!faceMuted) rot['Head'] = [-15, 0, 0];
    if (!rootMuted) rootY = Math.abs(Math.sin(t * 5)) * 0.04;
  } else {
    // Breathing Idle
    const breath = Math.sin(t * 2.2);
    if (!bodyMuted) {
      rot['Spine'] = [breath * 2.5, 0, 0];
      rot['Chest'] = [breath * 3.5, 0, 0];
    }
    if (!rootMuted) rootY = breath * 0.012;
    if (!faceMuted) rot['Head'] = [-breath * 1.5, 0, 0];
    if (!armsMuted) {
      rot['UpperArm_L'] = [0, 0, -18 - breath * 2];
      rot['UpperArm_R'] = [0, 0, 18 + breath * 2];
    }
  }

  return { rotations: rot, rootOffset: [0, rootY, rootZ] as [number, number, number] };
}

function getBlendedJointOffsets(
  animId: string,
  t: number,
  muted: Set<string>,
  blendState?: { animA: string; animB: string; weight: number },
  isBlendMode?: boolean
) {
  if (isBlendMode && blendState) {
    const offA = getSingleClipOffsets(blendState.animA, t, muted);
    const offB = getSingleClipOffsets(blendState.animB, t, muted);
    const w = Math.max(0, Math.min(1, blendState.weight));

    const blendedRot: Record<string, [number, number, number]> = {};
    const allKeys = new Set([...Object.keys(offA.rotations), ...Object.keys(offB.rotations)]);
    allKeys.forEach((key) => {
      const rA = offA.rotations[key] || [0, 0, 0];
      const rB = offB.rotations[key] || [0, 0, 0];
      blendedRot[key] = [
        rA[0] * (1 - w) + rB[0] * w,
        rA[1] * (1 - w) + rB[1] * w,
        rA[2] * (1 - w) + rB[2] * w,
      ];
    });

    const rootOff: [number, number, number] = [
      offA.rootOffset[0] * (1 - w) + offB.rootOffset[0] * w,
      offA.rootOffset[1] * (1 - w) + offB.rootOffset[1] * w,
      offA.rootOffset[2] * (1 - w) + offB.rootOffset[2] * w,
    ];
    return { rotations: blendedRot, rootOffset: rootOff };
  }
  return getSingleClipOffsets(animId, t, muted);
}

// Forward Kinematics solver: converts local bone rotations into hierarchical world coordinates
function computeArmatureWorldPositions(
  bones: BoneItem[],
  rotations: Record<string, [number, number, number]>,
  rootOffset: [number, number, number],
  center: THREE.Vector3,
  baseY: number,
  scale: number
): Map<string, THREE.Vector3> {
  const worldPositions = new Map<string, THREE.Vector3>();
  const worldQuaternions = new Map<string, THREE.Quaternion>();

  const boneMap = new Map<string, BoneItem>();
  bones.forEach((b) => boneMap.set(b.name, b));

  function evalBone(name: string) {
    if (worldPositions.has(name)) return;
    const b = boneMap.get(name);
    if (!b) return;

    const rotDeg = rotations[name] || b.rotation || [0, 0, 0];
    const localEuler = new THREE.Euler(
      THREE.MathUtils.degToRad(rotDeg[0]),
      THREE.MathUtils.degToRad(rotDeg[1]),
      THREE.MathUtils.degToRad(rotDeg[2]),
      'XYZ'
    );
    const localQuat = new THREE.Quaternion().setFromEuler(localEuler);

    if (!b.parent || !boneMap.has(b.parent)) {
      const posX = center.x + (b.position[0] + rootOffset[0]) * scale;
      const posY = baseY + (b.position[1] + rootOffset[1]) * scale;
      const posZ = center.z + (b.position[2] + rootOffset[2]) * scale;
      worldPositions.set(name, new THREE.Vector3(posX, posY, posZ));
      worldQuaternions.set(name, localQuat);
    } else {
      if (!worldPositions.has(b.parent)) {
        evalBone(b.parent);
      }
      const parentPos = worldPositions.get(b.parent)!;
      const parentQuat = worldQuaternions.get(b.parent) || new THREE.Quaternion();

      const parentBone = boneMap.get(b.parent)!;
      const restRel = new THREE.Vector3(
        (b.position[0] - parentBone.position[0]) * scale,
        (b.position[1] - parentBone.position[1]) * scale,
        (b.position[2] - parentBone.position[2]) * scale
      );

      restRel.applyQuaternion(parentQuat);

      const childPos = new THREE.Vector3().addVectors(parentPos, restRel);
      worldPositions.set(name, childPos);

      const childQuat = parentQuat.clone().multiply(localQuat);
      worldQuaternions.set(name, childQuat);
    }
  }

  bones.forEach((b) => evalBone(b.name));
  return worldPositions;
}

interface MeshViewerProps {
  className?: string;
  showOverlayUI?: boolean;
}

export type LightTone = 'studio' | 'warm' | 'cool' | 'neutral';

export interface EnvironmentPreset {
  id: string;
  label: string;
  settings: {
    ambientIntensity: number;
    keyLightIntensity: number;
    fillLightIntensity: number;
    rimLightIntensity: number;
    exposure: number;
    lightTone: LightTone;
    backgroundColor: string;
    gridVisible: boolean;
    floorShadowOpacity: number;
    autoRotate: boolean;
  };
}

export const LIGHT_TONES: Record<LightTone, { label: string; key: number; fill: number; rim: number }> = {
  studio: { label: 'Studio', key: 0xfff8f0, fill: 0xf5f5f7, rim: 0xffeed0 },
  warm: { label: 'Warm Gold', key: 0xffe8cc, fill: 0xfff5ea, rim: 0xffcc00 },
  cool: { label: 'Cyber Cool', key: 0xffffff, fill: 0xd8e6ff, rim: 0xd0e0ff },
  neutral: { label: 'Neutral', key: 0xffffff, fill: 0xffffff, rim: 0xffffff },
};

export const BACKGROUND_OPTIONS = [
  { id: 'transparent', label: 'Studio Vignette', value: 'transparent', preview: 'radial-gradient(circle, #252525 0%, #080808 100%)' },
  { id: 'void', label: 'Deep Void', value: '#060606', preview: '#060606' },
  { id: 'charcoal', label: 'Charcoal', value: '#131418', preview: '#131418' },
  { id: 'slate', label: 'Slate', value: '#1e2025', preview: '#1e2025' },
  { id: 'clay', label: 'Clay Gray', value: '#32353f', preview: '#32353f' },
  { id: 'light', label: 'Studio Light', value: '#e8e9ed', preview: '#e8e9ed' },
];

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'studio',
    label: 'Studio Gold',
    settings: {
      ambientIntensity: 0.8,
      keyLightIntensity: 3.0,
      fillLightIntensity: 1.3,
      rimLightIntensity: 2.0,
      exposure: 1.25,
      lightTone: 'studio',
      backgroundColor: 'transparent',
      gridVisible: false,
      floorShadowOpacity: 0.2,
      autoRotate: false,
    },
  },
  {
    id: 'dramatic',
    label: 'Dramatic Rim',
    settings: {
      ambientIntensity: 0.35,
      keyLightIntensity: 4.2,
      fillLightIntensity: 0.6,
      rimLightIntensity: 3.2,
      exposure: 1.15,
      lightTone: 'cool',
      backgroundColor: '#060606',
      gridVisible: false,
      floorShadowOpacity: 0.3,
      autoRotate: false,
    },
  },
  {
    id: 'clay',
    label: 'Clay Sculpt',
    settings: {
      ambientIntensity: 1.1,
      keyLightIntensity: 2.4,
      fillLightIntensity: 1.5,
      rimLightIntensity: 1.2,
      exposure: 1.3,
      lightTone: 'neutral',
      backgroundColor: '#32353f',
      gridVisible: true,
      floorShadowOpacity: 0.25,
      autoRotate: false,
    },
  },
  {
    id: 'golden',
    label: 'Golden Hour',
    settings: {
      ambientIntensity: 0.9,
      keyLightIntensity: 3.2,
      fillLightIntensity: 1.4,
      rimLightIntensity: 2.5,
      exposure: 1.2,
      lightTone: 'warm',
      backgroundColor: 'transparent',
      gridVisible: false,
      floorShadowOpacity: 0.2,
      autoRotate: false,
    },
  },
  {
    id: 'light',
    label: 'Pure Light',
    settings: {
      ambientIntensity: 1.4,
      keyLightIntensity: 2.6,
      fillLightIntensity: 1.8,
      rimLightIntensity: 1.4,
      exposure: 1.35,
      lightTone: 'neutral',
      backgroundColor: '#e8e9ed',
      gridVisible: true,
      floorShadowOpacity: 0.15,
      autoRotate: false,
    },
  },
];


export const MeshViewer: React.FC<MeshViewerProps> = ({ 
  className = '', 
  showOverlayUI = true 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { 
    assets,
    currentAsset, 
    setCurrentAsset,
    selectAsset,
    addAsset,
    updateAssetProperties,
    shadingMode, 
    setShadingMode,
    showWireframe,
    setShowWireframe,
    isTurntable,
    setIsTurntable,
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    activeTask,
    generationSettings,
    textureSettings,
    activeTool,
    setActiveTool,
    setIsExportModalOpen,
    generate3DModel,
    viewportResetTrigger,
    isLeftPanelOpen,
    setIsLeftPanelOpen,
    leftPanelWidth,
    isRightPanelOpen,
    rightPanelWidth
  } = useWorkspace();

  const [isDesktopScreen, setIsDesktopScreen] = useState(true);

  useEffect(() => {
    const checkScreenSize = () => {
      if (typeof window !== 'undefined') {
        setIsDesktopScreen(window.innerWidth >= 1024);
      }
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  const rightOffset = (isRightPanelOpen && isDesktopScreen) ? (rightPanelWidth + 16) : 16;
  const leftOffset = (isLeftPanelOpen && isDesktopScreen) ? (leftPanelWidth + 16) : 16;

  const [shadingMenuOpen, setShadingMenuOpen] = useState(false);
  const shadingMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shadingMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (shadingMenuRef.current && !shadingMenuRef.current.contains(e.target as Node)) {
        setShadingMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [shadingMenuOpen]);

  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number; percent: number } | null>(null);
  const [showEnvironmentPanel, setShowEnvironmentPanel] = useState(false);
  const [environmentSettings, setEnvironmentSettings] = useState({
    ambientIntensity: 0.8,
    keyLightIntensity: 3.0,
    fillLightIntensity: 1.3,
    rimLightIntensity: 2.0,
    exposure: 1.25,
    lightTone: 'studio' as LightTone,
    backgroundColor: 'transparent',
    gridVisible: false,
    gridColor: '#222222',
    floorShadowOpacity: 0.2,
    autoRotate: false,
    showAxes: false,
    showStats: true,
  });

  const [cameraPreset, setCameraPreset] = useState<CameraViewPreset>('perspective');
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const envPanelRef = useRef<HTMLDivElement>(null);
  const [interactionMode, setInteractionMode] = useState<'orbit' | 'pan' | 'move'>('orbit');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropToastMessage, setDropToastMessage] = useState<string | null>(null);
  const [dropToastIsHtmlError, setDropToastIsHtmlError] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>('studio');
  const [meshStats, setMeshStats] = useState<{ faces: number; vertices: number; triangles: number; dimensions?: { x: number; y: number; z: number } } | null>(null);
  const [debugBlueprint, setDebugBlueprint] = useState(false);
  const physicsRuntimeRef = useRef<PhysicsRuntime | null>(null);
  const [physicsModeOpen, setPhysicsModeOpen] = useState(false);
  const [physicsRunning, setPhysicsRunning] = useState(false);
  const [physicsDebug, setPhysicsDebug] = useState(false);
  const [physicsStatus, setPhysicsStatus] = useState<string | null>(null);

  // Close menus on outside click or Escape key
  useEffect(() => {
    if (!cameraMenuOpen && !showEnvironmentPanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(e.target as Node)) {
        setCameraMenuOpen(false);
      }
      if (envPanelRef.current && !envPanelRef.current.contains(e.target as Node)) {
        // Only close if click wasn't on the toggle button itself
        const target = e.target as HTMLElement;
        if (!target.closest('#btn-env-settings-toggle')) {
          setShowEnvironmentPanel(false);
        }
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCameraMenuOpen(false);
        setShowEnvironmentPanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [cameraMenuOpen, showEnvironmentPanel]);

  useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ force?: boolean }>;
      setDebugBlueprint((prev) => (customEvent.detail?.force !== undefined ? customEvent.detail.force : !prev));
    };
    window.addEventListener('toggleBlueprintPreview', handleToggle);
    return () => window.removeEventListener('toggleBlueprintPreview', handleToggle);
  }, []);

  const patchEnv = (updates: Partial<typeof environmentSettings>) =>
    setEnvironmentSettings((p) => ({ ...p, ...updates }));

  const applyPreset = useCallback((presetId: string) => {
    const preset = ENVIRONMENT_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setSelectedPreset(presetId);
    setEnvironmentSettings((p) => ({ ...p, ...preset.settings }));
  }, []);

  const computeMeshStats = useCallback((object: THREE.Object3D) => {
    let f = 0, v = 0;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geom = child.geometry;
        if (geom) {
          if (geom.index) {
            f += geom.index.count / 3;
          } else if (geom.attributes?.position) {
            f += geom.attributes.position.count / 3;
          }
          if (geom.attributes?.position) {
            v += geom.attributes.position.count;
          }
        }
      }
    });
    const faces = Math.round(f);
    const verts = Math.round(v);
    const triangles = Math.round(f);

    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const height = Math.max(size.y, 0.4);
    const scale = height / 1.8;
    const baseY = box.min.y;
    meshBoundsCacheRef.current = { center, size, height, scale, baseY };
    const dimensions = {
      x: Number(size.x.toFixed(2)),
      y: Number(size.y.toFixed(2)),
      z: Number(size.z.toFixed(2)),
    };

    setMeshStats({ faces, vertices: verts, triangles, dimensions });
    useViewerStore.getState().setModelStats({ vertices: verts, triangles, dimensions });

    if (currentAsset) {
      // Authoritative contract: final canonical artifact analysis is authoritative;
      // viewer-side Three.js runtime inspection is validation / fallback only.
      const hasAuthoritative = currentAsset.statsAvailable && currentAsset.faces > 0;
      if (!hasAuthoritative) {
        updateAssetProperties(currentAsset.id, {
          faces,
          vertices: verts,
          triangles,
          statsAvailable: true,
          dimensions: currentAsset.dimensions || dimensions,
        });
      } else if (!currentAsset.dimensions) {
        updateAssetProperties(currentAsset.id, {
          dimensions,
        });
      }
    }
  }, [currentAsset, updateAssetProperties]);

  // Internal Three.js references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const currentMeshGroupRef = useRef<THREE.Group | null>(null);
  const pointCloudRef = useRef<THREE.Object3D | null>(null);
  const pointCloudGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isTurntableRef = useRef(isTurntable);
  const blobUrlRef = useRef<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const skeletonHelperRef = useRef<THREE.SkeletonHelper | null>(null);
  const rigArmatureGroupRef = useRef<THREE.Group | null>(null);
  const meshBoundsCacheRef = useRef<{
    center: THREE.Vector3;
    size: THREE.Vector3;
    height: number;
    scale: number;
    baseY: number;
  } | null>(null);

  const getMeshBounds = useCallback(() => {
    if (meshBoundsCacheRef.current) return meshBoundsCacheRef.current;
    const group = currentMeshGroupRef.current;
    if (!group || group.children.length === 0) {
      return {
        center: new THREE.Vector3(0, 0, 0),
        size: new THREE.Vector3(1, 1.8, 1),
        height: 1.8,
        scale: 1.0,
        baseY: 0,
      };
    }
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 0.4);
    const scale = height / 1.8;
    const baseY = box.min.y;
    meshBoundsCacheRef.current = { center, size, height, scale, baseY };
    return meshBoundsCacheRef.current;
  }, []);

  // Subscribe to real animation store for live 3D viewport synchronization
  const {
    transform: animTransform,
    displayOptions: animDisplayOptions,
    playbackSpeed: animPlaybackSpeed,
    isLooping: animIsLooping,
    boneRotations: animBoneRotations,
    selectedBone: animSelectedBone,
    currentTime: animCurrentTime,
    isPlaying: animIsPlaying,
    activeMode: animActiveMode,
    inspectorTab: animInspectorTab,
    bones: animBones,
    setSelectedBone: setAnimSelectedBone,
    activeViewportTool: animActiveViewportTool,
    isPlacingBone: animIsPlacingBone,
    currentAnimationId: animCurrentAnimationId,
    animations: animAnimations,
    tracks: animTracks,
    isWeightPainting: animIsWeightPainting,
    blendState: animBlendState,
    cameraPreset: animCameraPreset,
  } = useAnimationStore();

  // 1. Live model transform (position, rotation, scale)
  useEffect(() => {
    const group = currentMeshGroupRef.current;
    if (!group) return;
    group.position.set(animTransform.position[0], animTransform.position[1], animTransform.position[2]);
    group.rotation.set(
      THREE.MathUtils.degToRad(animTransform.rotation[0]),
      THREE.MathUtils.degToRad(animTransform.rotation[1]),
      THREE.MathUtils.degToRad(animTransform.rotation[2])
    );
    group.scale.set(animTransform.scale[0], animTransform.scale[1], animTransform.scale[2]);
  }, [animTransform]);

  // 2. Live display options (skeleton helper, grid, ground disc)
  useEffect(() => {
    if (skeletonHelperRef.current) {
      skeletonHelperRef.current.visible =
        (animActiveMode === 'rigging' || animInspectorTab === 'rigging') && animDisplayOptions.showSkeleton;
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = (animActiveMode === 'rigging' || animInspectorTab === 'rigging')
        ? animDisplayOptions.showGrid
        : environmentSettings.gridVisible;
    }
    if (floorRef.current) {
      floorRef.current.visible = animDisplayOptions.showGround;
    }
  }, [animDisplayOptions, animActiveMode, animInspectorTab, environmentSettings.gridVisible]);

  // 3. Live playback speed & loop mode
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.timeScale = animPlaybackSpeed;
    }
    if (actionRef.current) {
      actionRef.current.setLoop(animIsLooping ? THREE.LoopRepeat : THREE.LoopOnce, animIsLooping ? Infinity : 1);
    }
  }, [animPlaybackSpeed, animIsLooping]);

  // 4. Live timeline scrubbing / seeking when paused
  useEffect(() => {
    if (mixerRef.current && !animIsPlaying) {
      mixerRef.current.setTime(animCurrentTime);
    }
  }, [animCurrentTime, animIsPlaying]);

  const motionClipRef = useRef<{
    id: string;
    fps: number;
    duration: number;
    jointNames: string[];
    skeletonId: string;
    frames: number[][][];
    roots?: number[][];
    mapping: Record<string, string>;
  } | null>(null);
  const motionLoadErrorRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    motionClipRef.current = null;
    motionLoadErrorRef.current = null;
    const clip = animAnimations.find((item) => item.id === animCurrentAnimationId);
    if (!clip || clip.artifactType !== 'motion' || !clip.motionJsonUrl) return;

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const load = async () => {
      try {
        const response = await fetch(clip.motionJsonUrl!);
        if (!response.ok) throw new Error(`Motion metadata request failed (${response.status})`);
        const doc = await response.json();
        const jointNames = Array.isArray(doc.joint_names) ? doc.joint_names.filter((v: unknown): v is string => typeof v === 'string') : [];
        const fps = Number(doc.fps);
        const frameCount = Number(doc.num_frames);
        const skeletonId = String(doc.skeleton_id || clip.skeletonId || 'unknown');
        if (!clip.url || !jointNames.length || !Number.isFinite(fps) || fps <= 0) throw new Error('Motion artifact metadata is incomplete');
        // The backend emits a browser-playable quaternion representation in motion.json.
        const jsonFrames = Array.isArray(doc.quaternions) ? doc.quaternions : null;
        if (!jsonFrames || !Number.isFinite(frameCount) || frameCount <= 0 || jsonFrames.length !== frameCount) {
          throw new Error('Motion JSON does not contain a browser-playable quaternion frame payload');
        }
        if (!jsonFrames.every((frame: unknown) => Array.isArray(frame) && frame.length === jointNames.length)) {
          throw new Error('Motion quaternion frame dimensions do not match joint metadata');
        }
        const mapping: Record<string, string> = {};
        const targetNames = new Map(animBones.map((bone) => [normalize(bone.name), bone.name]));
        for (const source of jointNames) {
          const target = targetNames.get(normalize(source));
          if (target) mapping[source] = target;
        }
        const coverage = Object.keys(mapping).length / jointNames.length;
        if (coverage < 0.5) throw new Error(`Incompatible motion skeleton '${skeletonId}' (${Object.keys(mapping).length}/${jointNames.length} joints mapped)`);
        if (cancelled) return;
        motionClipRef.current = { id: clip.id, fps, duration: Number(clip.duration || frameCount / fps), jointNames, skeletonId, frames: jsonFrames, mapping };
      } catch (error) {
        if (!cancelled) motionLoadErrorRef.current = error instanceof Error ? error.message : String(error);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [animAnimations, animCurrentAnimationId, animBones]);

  // 5. Live Pose Editor bone rotation to actual skeleton bones
  useEffect(() => {
    const group = currentMeshGroupRef.current;
    if (!group || !animSelectedBone) return;
    const bone = group.getObjectByName(animSelectedBone);
    if (bone) {
      const rot = animBoneRotations[animSelectedBone] || [0, 0, 0];
      bone.rotation.set(
        THREE.MathUtils.degToRad(rot[0]),
        THREE.MathUtils.degToRad(rot[1]),
        THREE.MathUtils.degToRad(rot[2])
      );
      skeletonHelperRef.current?.updateMatrixWorld(true);
    }
  }, [animBoneRotations, animSelectedBone]);

  // 6. Forward Kinematics Armature Articulation Evaluator
  const updateArmatureFrame = useCallback(
    (time: number) => {
      if (!rigArmatureGroupRef.current) return;
      const rigGroup = rigArmatureGroupRef.current;
      const rigVisible = rigGroup.visible;

      const state = useAnimationStore.getState();
      const bounds = getMeshBounds();
      const mutedSet = new Set(state.tracks.filter((t) => t.isMuted).map((t) => t.id));

      const activeMotion = motionClipRef.current?.id === state.currentAnimationId ? motionClipRef.current : null;
      const animOffsets = activeMotion ? { rotations: {} as Record<string, [number, number, number]>, rootOffset: [0, 0, 0] as [number, number, number] } : getBlendedJointOffsets(
        state.currentAnimationId,
        time,
        mutedSet,
        state.blendState,
        state.activeMode === 'blend'
      );

      const totalRotations: Record<string, [number, number, number]> = { ...animOffsets.rotations };
      if (activeMotion) {
        const frameIndex = Math.min(activeMotion.frames.length - 1, Math.max(0, Math.floor(time * activeMotion.fps)));
        const frame = activeMotion.frames[frameIndex];
        if (Array.isArray(frame)) {
          activeMotion.jointNames.forEach((sourceName, index) => {
            const targetName = activeMotion.mapping[sourceName];
            const q = frame[index];
            if (!targetName || !Array.isArray(q) || q.length < 4) return;
            const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])).normalize(), 'XYZ');
            totalRotations[targetName] = [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)];
          });
        }
      }

      // Combine animation rotation + user's manual Pose Editor rotations
      for (const [boneName, rot] of Object.entries(state.boneRotations)) {
        const existing = totalRotations[boneName] || [0, 0, 0];
        totalRotations[boneName] = [
          existing[0] + rot[0],
          existing[1] + rot[1],
          existing[2] + rot[2],
        ];
      }

      // Forward Kinematics world positions
      const worldPositions = computeArmatureWorldPositions(
        state.bones,
        totalRotations,
        animOffsets.rootOffset,
        bounds.center,
        bounds.baseY,
        bounds.scale
      );

      // Update optional editor armature visuals only when they are visible.
      const unitZ = new THREE.Vector3(0, 0, 1);
      if (rigVisible) rigGroup.children.forEach((child) => {
        if (child.userData?.isJoint && child.userData.boneName) {
          const p = worldPositions.get(child.userData.boneName);
          if (p) child.position.copy(p);
        } else if (child.userData?.isRing && state.selectedBone) {
          const p = worldPositions.get(state.selectedBone);
          if (p) {
            child.position.copy(p);
            if (cameraRef.current) child.lookAt(cameraRef.current.position);
          }
        } else if (child.userData?.isConnector && child.userData.boneName && child.userData.parentName) {
          const p1 = worldPositions.get(child.userData.parentName);
          const p2 = worldPositions.get(child.userData.boneName);
          if (p1 && p2) {
            const dir = new THREE.Vector3().subVectors(p2, p1);
            const len = dir.length();
            if (len > 0.001) {
              child.position.copy(p1);
              child.quaternion.setFromUnitVectors(unitZ, dir.clone().normalize());
              child.scale.set(len, len, len);
            }
          }
        }
      });

      // Articulate matching bones in model mesh
      const group = currentMeshGroupRef.current;
      if (group) {
        group.traverse((child) => {
          if (child instanceof THREE.Bone) {
            const rotDeg = totalRotations[child.name];
            if (rotDeg) {
              child.rotation.set(
                THREE.MathUtils.degToRad(rotDeg[0]),
                THREE.MathUtils.degToRad(rotDeg[1]),
                THREE.MathUtils.degToRad(rotDeg[2])
              );
            }
          }
        });
        skeletonHelperRef.current?.updateMatrixWorld(true);
      }
    },
    [getMeshBounds]
  );

  // 6b. Live Rigging Armature Visualizer in 3D Viewport (Humanoid Biped 17-Bone Hierarchy)
  useEffect(() => {
    if (!sceneRef.current || !rigArmatureGroupRef.current) return;
    const rigGroup = rigArmatureGroupRef.current;

    // Clear previous armature meshes (reusing shared pooled geometries)
    rigGroup.clear();

    const isRiggingActive =
      (animActiveMode === 'rigging' || animInspectorTab === 'rigging') &&
      animDisplayOptions.showSkeleton;

    rigGroup.visible = isRiggingActive;
    if (!isRiggingActive) return;

    // Fast cached mesh bounds (0ms geometry traversal; falls back to default humanoid scale if empty)
    const { center, scale, baseY } = getMeshBounds();

    // Compute world positions for each bone in hierarchy
    const boneWorldPositions = new Map<string, THREE.Vector3>();

    animBones.forEach((b) => {
      const posX = center.x + b.position[0] * scale;
      const posY = baseY + b.position[1] * scale;
      const posZ = center.z + b.position[2] * scale;
      boneWorldPositions.set(b.name, new THREE.Vector3(posX, posY, posZ));
    });

    // Create joint handles and bone connectors using shared pool
    animBones.forEach((b) => {
      const pos = boneWorldPositions.get(b.name);
      if (!pos) return;
      const isSelected = animSelectedBone === b.name;

      // 1. Joint Marker Sphere (In Front / X-Ray)
      const jointMesh = createJointMesh(pos, isSelected, b.name, scale);
      rigGroup.add(jointMesh);

      // 2. Selected Bone Highlight Ring
      if (isSelected) {
        const ringMesh = new THREE.Mesh(sharedRingGeo, sharedRingMat);
        ringMesh.scale.setScalar(scale);
        ringMesh.position.copy(pos);
        ringMesh.renderOrder = 10000;
        ringMesh.userData = { isRing: true };
        ringMesh.lookAt(cameraRef.current ? cameraRef.current.position : new THREE.Vector3(0, 1, 5));
        rigGroup.add(ringMesh);
      }

      // 3. Octahedron Bone Connector to Parent
      if (b.parent) {
        const parentPos = boneWorldPositions.get(b.parent);
        if (parentPos) {
          const boneConnector = createBoneMesh(parentPos, pos, isSelected, b.name, b.parent);
          rigGroup.add(boneConnector);
        }
      }
    });

    // Initial pose articulation
    updateArmatureFrame(animCurrentTime);

    // Request immediate frame render
    if (rendererRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [
    animActiveMode,
    animInspectorTab,
    animSelectedBone,
    animBones,
    animDisplayOptions.showSkeleton,
    viewportResetTrigger,
    currentAsset?.id,
    getMeshBounds,
    updateArmatureFrame,
  ]);

  // 6c. Articulate Armature on scrub/time, clip change, or pose rotation when paused
  useEffect(() => {
    if (!animIsPlaying) {
      updateArmatureFrame(animCurrentTime);
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
  }, [
    animCurrentTime,
    animIsPlaying,
    animCurrentAnimationId,
    animBoneRotations,
    animTracks,
    animBlendState,
    updateArmatureFrame,
  ]);

  // 7. Weight Painting Heatmap Visualization
  useEffect(() => {
    const group = currentMeshGroupRef.current;
    if (!group) return;

    const isWeightActive = animActiveViewportTool === 'weight' || animIsWeightPainting;

    group.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !child.userData?.isJoint &&
        !child.userData?.isConnector &&
        !child.userData?.isRing
      ) {
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }

        if (isWeightActive) {
          const bounds = getMeshBounds();
          const selBone = animBones.find((b) => b.name === animSelectedBone);
          const jointWorldPos = selBone
            ? new THREE.Vector3(
                bounds.center.x + selBone.position[0] * bounds.scale,
                bounds.baseY + selBone.position[1] * bounds.scale,
                bounds.center.z + selBone.position[2] * bounds.scale
              )
            : bounds.center;

          const geom = child.geometry;
          if (geom && geom.attributes.position) {
            const posAttr = geom.attributes.position;
            const count = posAttr.count;
            const colors = new Float32Array(count * 3);
            const vPos = new THREE.Vector3();
            const radius = bounds.scale * 0.35;

            for (let i = 0; i < count; i++) {
              vPos.fromBufferAttribute(posAttr, i);
              child.localToWorld(vPos);
              const dist = vPos.distanceTo(jointWorldPos);
              const weight = Math.max(0, Math.min(1, 1 - dist / radius));

              // Heatmap: 0 = Blue, 0.5 = Green, 1 = Red
              const r = weight > 0.5 ? Math.min(1, (weight - 0.5) * 2) : 0;
              const g = weight < 0.5 ? Math.min(1, weight * 2) : Math.min(1, (1 - weight) * 2);
              const b = weight < 0.5 ? Math.min(1, (0.5 - weight) * 2) : 0;

              colors[i * 3] = r;
              colors[i * 3 + 1] = g;
              colors[i * 3 + 2] = b;
            }

            geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geom.attributes.color.needsUpdate = true;

            child.material = new THREE.MeshBasicMaterial({
              vertexColors: true,
              wireframe: Boolean(showWireframe),
            });
          }
        } else {
          if (child.userData.originalMaterial) {
            child.material = child.userData.originalMaterial;
          }
        }
      }
    });

    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [
    animActiveViewportTool,
    animIsWeightPainting,
    animSelectedBone,
    animBones,
    getMeshBounds,
    showWireframe,
  ]);

  // 8. Sync interactionMode and selected bone joint with TransformControls
  useEffect(() => {
    if (!controlsRef.current || !transformControlsRef.current) return;
    const tc = transformControlsRef.current;

    if (interactionMode === 'pan') {
      controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.PAN;
    } else {
      controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }

    if (
      animActiveMode === 'rigging' ||
      animActiveMode === 'editing' ||
      animActiveMode === 'animate' ||
      animInspectorTab === 'rigging' ||
      animDisplayOptions.showSkeleton
    ) {
      if (
        animActiveViewportTool === 'select' ||
        animActiveViewportTool === 'bone' ||
        animActiveViewportTool === 'weight'
      ) {
        tc.detach();
        tc.enabled = false;
        return;
      }
      if (animSelectedBone && rigArmatureGroupRef.current) {
        const jointMesh = rigArmatureGroupRef.current.children.find(
          (c) => c.userData?.isJoint && c.userData?.boneName === animSelectedBone
        );
        if (jointMesh) {
          tc.attach(jointMesh);
          const mode =
            animActiveViewportTool === 'rotate'
              ? 'rotate'
              : animActiveViewportTool === 'scale'
              ? 'scale'
              : 'translate';
          tc.setMode(mode);
          tc.enabled = true;
          return;
        }
      }
      tc.detach();
      tc.enabled = false;
    } else if (
      interactionMode === 'move' &&
      currentMeshGroupRef.current &&
      currentMeshGroupRef.current.children.length > 0
    ) {
      tc.attach(currentMeshGroupRef.current);
      tc.setMode('translate');
      tc.enabled = true;
    } else {
      tc.detach();
      tc.enabled = false;
    }
  }, [
    interactionMode,
    animActiveMode,
    animInspectorTab,
    animSelectedBone,
    animActiveViewportTool,
    animBones,
  ]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Keep turntable ref in sync with prop
  useEffect(() => {
    isTurntableRef.current = isTurntable;
  }, [isTurntable]);

  // Update Three.js scene when environment settings change
  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;

    // 1. Update background color
    if (environmentSettings.backgroundColor === 'transparent') {
      scene.background = null;
    } else {
      scene.background = new THREE.Color(environmentSettings.backgroundColor);
    }

    // 2. Update tone mapping exposure
    renderer.toneMappingExposure = environmentSettings.exposure;

    // 3. Update grid visibility
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = environmentSettings.gridVisible;
    }

    // 4. Update floor shadow opacity
    if (floorRef.current) {
      (floorRef.current.material as THREE.ShadowMaterial).opacity = environmentSettings.floorShadowOpacity;
    }

    // 5. Update light intensities and light tones
    const tone = LIGHT_TONES[environmentSettings.lightTone] || LIGHT_TONES.studio;
    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) {
        obj.intensity = environmentSettings.ambientIntensity;
      }
    });
    if (keyLightRef.current) {
      keyLightRef.current.intensity = environmentSettings.keyLightIntensity;
      keyLightRef.current.color.setHex(tone.key);
    }
    if (fillLightRef.current) {
      fillLightRef.current.intensity = environmentSettings.fillLightIntensity;
      fillLightRef.current.color.setHex(tone.fill);
    }
    if (rimLightRef.current) {
      rimLightRef.current.intensity = environmentSettings.rimLightIntensity;
      rimLightRef.current.color.setHex(tone.rim);
    }

    // 6. Update controls autoRotate
    if (controlsRef.current) {
      controlsRef.current.autoRotate = environmentSettings.autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [environmentSettings]);

  // Initialize Three.js Scene once
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 3.8);
    cameraRef.current = camera;

    // 3. Renderer with preserveDrawingBuffer enabled for real camera snapshots
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    // ponytail: cap pixel ratio at 1.5 for smooth rendering FPS
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.info.autoReset = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 100;    // Increased from 25 — allow much further zoom out
    controls.minDistance = 0.05;   // Decreased from 0.8 — allow much closer zoom in
    controls.zoomSpeed = 1.5;     // Increased scroll-wheel zoom speed
    controls.target.set(0, 0.4, 0);
    controlsRef.current = controls;

    // 4b. TransformControls for translating 3D model
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.size = 0.8;
    transformControls.setMode('translate');
    transformControls.enabled = false;
    transformControls.addEventListener('dragging-changed', (event: any) => {
      controls.enabled = !event.value;
    });
    transformControls.addEventListener('objectChange', () => {
      const state = useAnimationStore.getState();
      const obj = transformControls.object;
      if (state.selectedBone && obj?.userData?.isJoint) {
        if (transformControls.getMode() === 'rotate') {
          const rx = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1));
          const ry = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1));
          const rz = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1));
          state.setBoneRotation(state.selectedBone, [rx, ry, rz]);
        } else {
          const bounds = getMeshBounds();
          const boneX = parseFloat(((obj.position.x - bounds.center.x) / bounds.scale).toFixed(3));
          const boneY = parseFloat(((obj.position.y - bounds.baseY) / bounds.scale).toFixed(3));
          const boneZ = parseFloat(((obj.position.z - bounds.center.z) / bounds.scale).toFixed(3));
          state.updateBonePosition(state.selectedBone, [boneX, boneY, boneZ]);
        }
        idleFrames = 0;
      }
    });
    scene.add(transformControls.getHelper() as unknown as THREE.Object3D);
    transformControlsRef.current = transformControls;

    // 5. Lighting Setup (Studio 3-Point Setup) - Calibrated for high-relief feature contrast
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const mainKeyLight = new THREE.DirectionalLight(0xfff5ea, 2.8);
    mainKeyLight.position.set(4, 6, 5);
    mainKeyLight.castShadow = true;
    mainKeyLight.shadow.mapSize.width = 2048;
    mainKeyLight.shadow.mapSize.height = 2048;
    mainKeyLight.shadow.camera.near = 0.1;
    mainKeyLight.shadow.camera.far = 20;
    mainKeyLight.shadow.bias = -0.0001;
    mainKeyLight.shadow.normalBias = 0.02;
    scene.add(mainKeyLight);
    keyLightRef.current = mainKeyLight;

    const fillLight = new THREE.DirectionalLight(0xf5f5f7, 1.2);
    fillLight.position.set(-5, 3, -2);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    const rimLight = new THREE.DirectionalLight(0xfff0d0, 1.8);
    rimLight.position.set(0, 5, -5);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // 6. Floor with soft contact shadow receiver
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.18 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    scene.add(floor);
    floorRef.current = floor;

    // 7. Grid Helper
    const grid = new THREE.GridHelper(20, 40, 0xFFCC00, 0x222222);
    grid.position.y = 0;
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    grid.visible = animDisplayOptions.showGrid;
    scene.add(grid);
    gridHelperRef.current = grid;

    // 7b. Point Cloud / Scanning Blueprint Group
    const pointCloudGroup = new THREE.Group();
    pointCloudGroup.visible = false;
    scene.add(pointCloudGroup);
    pointCloudGroupRef.current = pointCloudGroup;

    // 7c. Mesh Container Group
    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    currentMeshGroupRef.current = meshGroup;

    // 7d. Rigging Armature Visualizer Group
    const rigGroup = new THREE.Group();
    rigGroup.name = 'RigArmatureGroup';
    rigGroup.visible = false;
    scene.add(rigGroup);
    rigArmatureGroupRef.current = rigGroup;

    // Raycast on canvas to select bone joints or place new bones in Rigging mode
    const onCanvasPointerDown = (event: MouseEvent) => {
      const state = useAnimationStore.getState();
      if (state.activeMode !== 'rigging' && state.inspectorTab !== 'rigging') return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Check if user is placing a new bone on the 3D model surface
      if (state.isPlacingBone || state.activeViewportTool === 'bone') {
        const group = currentMeshGroupRef.current;
        if (group && group.children.length > 0) {
          const hits = raycaster.intersectObjects(group.children, true);
          if (hits.length > 0) {
            const hit = hits[0];
            const bounds = getMeshBounds();

            const boneX = parseFloat(((hit.point.x - bounds.center.x) / bounds.scale).toFixed(3));
            const boneY = parseFloat(((hit.point.y - bounds.baseY) / bounds.scale).toFixed(3));
            const boneZ = parseFloat(((hit.point.z - bounds.center.z) / bounds.scale).toFixed(3));

            const parentBone = state.selectedBone || 'Hips';
            const newBoneName = `Bone_${state.bones.length + 1}`;

            state.addBone({
              name: newBoneName,
              parent: parentBone,
              position: [boneX, boneY, boneZ],
              rotation: [0, 0, 0],
            });
            state.setIsPlacingBone(false);
            idleFrames = 0;
            return;
          }
        }
      }

      // Check if clicking an existing joint handle in 3D
      if (rigArmatureGroupRef.current) {
        const intersects = raycaster.intersectObjects(rigArmatureGroupRef.current.children, true);
        const hit = intersects.find((i) => i.object.userData?.isJoint);
        if (hit && hit.object.userData?.boneName) {
          state.setSelectedBone(hit.object.userData.boneName);
          idleFrames = 0;
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);

    // 8. Animation & Render Loop — demand-based rendering with idle settling to save browser GPU
    const timer = new THREE.Timer();
    let idleFrames = 0;

    controls.addEventListener('change', () => {
      idleFrames = 0;
    });

    const animate = () => {
      timer.update();
      const delta = timer.getDelta();

      const turntableActive = Boolean(isTurntableRef.current && meshGroup && meshGroup.children.length > 0);
      if (turntableActive) {
        meshGroup.rotation.y += delta * 0.45;
      }

      const pointCloudActive = Boolean(pointCloudGroup && pointCloudGroup.visible && pointCloudGroup.children.length > 0);
      if (pointCloudActive) {
        const t = timer.getElapsed();
        pointCloudGroup.rotation.y += delta * 0.35;
        const ring1 = pointCloudGroup.getObjectByName('orbitalRing1');
        if (ring1) ring1.rotation.z += delta * 0.75;
        const ring2 = pointCloudGroup.getObjectByName('orbitalRing2');
        if (ring2) ring2.rotation.y += delta * 0.55;
        const ico = pointCloudGroup.getObjectByName('coreIcoMesh');
        if (ico) {
          ico.rotation.x += delta * 0.45;
          ico.rotation.y += delta * 0.35;
        }
        const oct = pointCloudGroup.getObjectByName('coreOctMesh');
        if (oct) {
          oct.rotation.y -= delta * 0.7;
          oct.rotation.z += delta * 0.4;
        }
        const scanRing = pointCloudGroup.getObjectByName('blueprintScanRing');
        if (scanRing) {
          scanRing.position.y = Math.sin(t * 1.6) * 0.75;
        }
      }

      const animState = useAnimationStore.getState();
      const isAnimPlaying = animState.isPlaying;
      const physicsActive = physicsRuntimeRef.current?.isRunning() ?? false;
      if (physicsActive) {
        physicsRuntimeRef.current?.tick(delta);
      }
      const animationActive = Boolean(mixerRef.current) || isAnimPlaying || physicsActive;

      if (animationActive && mixerRef.current) {
        mixerRef.current.update(delta);
      }
      if (isAnimPlaying || animState.activeMode === 'rigging' || animState.inspectorTab === 'rigging') {
        updateArmatureFrame(animState.currentTime);
      }
      if (skeletonHelperRef.current) {
        skeletonHelperRef.current.updateMatrixWorld();
      }
      if (rigArmatureGroupRef.current && rigArmatureGroupRef.current.visible) {
        rigArmatureGroupRef.current.updateMatrixWorld();
      }

      const controlsChanged = controls.update();
      if (turntableActive || pointCloudActive || animationActive || controlsChanged || idleFrames < 60) {
        if (turntableActive || pointCloudActive || animationActive || controlsChanged) {
          idleFrames = 0;
        } else {
          idleFrames++;
        }
        renderer.info.reset();
        renderer.render(scene, camera);
      }
    };
    renderer.setAnimationLoop(animate);

    // 9. Resize Handling via ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        idleFrames = 0;
        renderer.render(scene, camera);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
      if (rigArmatureGroupRef.current) {
        scene.remove(rigArmatureGroupRef.current);
        rigArmatureGroupRef.current = null;
      }
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      physicsRuntimeRef.current?.dispose();
      physicsRuntimeRef.current = null;
      transformControls.dispose();
      controls.dispose();
      renderer.dispose();
      if (pointCloudRef.current) {
        disposePointCloud(pointCloudRef.current);
        pointCloudRef.current = null;
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const material = obj.material;
          if (Array.isArray(material)) {
            material.forEach((m) => {
              Object.values(m).forEach((v: any) => { if (v instanceof THREE.Texture) v.dispose(); });
              m.dispose();
            });
          } else if (material) {
            Object.values(material).forEach((v: any) => { if (v instanceof THREE.Texture) v.dispose(); });
            material.dispose();
          }
        }
      });
    };
  }, []);

  // Initialize the browser physics preview from the canonical collision artifact.
  useEffect(() => {
    let cancelled = false;

    const initializePhysics = async () => {
      physicsRuntimeRef.current?.dispose();
      physicsRuntimeRef.current = null;
      setPhysicsRunning(false);
      setPhysicsStatus(null);

      const group = currentMeshGroupRef.current;
      const scene = sceneRef.current;
      const collisionUrl = currentAsset?.artifacts?.collision;
      if (!group || !scene || isLoading || !currentAsset?.artifacts?.physicsReady || !collisionUrl) {
        return;
      }

      const metadata = (currentAsset.artifacts?.physics || {}) as any;
      const body = metadata.body || {};
      const material = metadata.material || {};
      const runtime = new PhysicsRuntime();
      physicsRuntimeRef.current = runtime;

      try {
        await runtime.init(scene, group, collisionUrl, {
          bodyType: body.type || 'auto',
          massMode: body.mass_kg ? 'manual' : 'auto',
          massKg: Number(body.mass_kg || 1),
          densityMode: 'auto',
          densityKgM3: Number(body.density_kg_m3 || 500),
          friction: Number(material.dynamic_friction ?? 0.5),
          restitution: Number(material.restitution ?? 0.1),
          linearDamping: Number(body.linear_damping ?? 0.05),
          angularDamping: Number(body.angular_damping ?? 0.05),
          gravityEnabled: Boolean(body.gravity_enabled ?? true),
        });
        if (cancelled) {
          runtime.dispose();
          return;
        }
        runtime.setDebugVisibility(physicsDebug);
        setPhysicsStatus('Physics ready — rigid-body preview');
      } catch (error) {
        runtime.dispose();
        physicsRuntimeRef.current = null;
        if (!cancelled) setPhysicsStatus(error instanceof Error ? error.message : 'Physics preview initialization failed');
      }
    };

    void initializePhysics();
    return () => {
      cancelled = true;
    };
  }, [currentAsset?.id, currentAsset?.artifacts?.collision, currentAsset?.artifacts?.physicsReady, currentAsset?.artifacts?.physics, isLoading, physicsDebug]);

  useEffect(() => {
    physicsRuntimeRef.current?.setDebugVisibility(physicsDebug);
  }, [physicsDebug]);

  // Update Turntable status
  useEffect(() => {
    // handled in loop via isTurntableActive
  }, [isTurntable]);

  // Interactive 3D Point Cloud silhouette generation during AI 3D model synthesis (progressive silhouette preview)
  useEffect(() => {
    const isGenerating = Boolean(isExecuting || debugBlueprint);
    const pointCloudGroup = pointCloudGroupRef.current;
    const meshGroup = currentMeshGroupRef.current;

    if (!pointCloudGroup) return;

    if (!isGenerating) {
      // Hide & dispose point cloud when generation completes or aborts
      pointCloudGroup.visible = false;
      if (pointCloudRef.current) {
        pointCloudGroup.remove(pointCloudRef.current);
        disposePointCloud(pointCloudRef.current);
        pointCloudRef.current = null;
      }
      if (meshGroup) {
        meshGroup.visible = true;
      }
      return;
    }

    // Hide real mesh group and any skeleton helpers while generation is active
    if (meshGroup) {
      meshGroup.visible = false;
    }
    if (skeletonHelperRef.current) {
      skeletonHelperRef.current.visible = false;
    }

    let isMounted = true;

    const buildPoints = async () => {
      if (pointCloudRef.current) {
        pointCloudGroup.remove(pointCloudRef.current);
        disposePointCloud(pointCloudRef.current);
        pointCloudRef.current = null;
      }

      // Sleek AI Neural Holographic Core
      const points = createFallbackPointCloud();

      if (!isMounted) {
        disposePointCloud(points);
        return;
      }

      pointCloudRef.current = points;
      pointCloudGroup.add(points);
      pointCloudGroup.visible = true;
    };

    buildPoints();

    return () => {
      isMounted = false;
    };
  }, [isExecuting, debugBlueprint, generationSettings?.image, textureSettings?.referenceImage]);

  // Load the real selected asset into the persistent viewport.
  useEffect(() => {
    if (!sceneRef.current || !currentMeshGroupRef.current) return;
    const group = currentMeshGroupRef.current;
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const orig = child.userData?.originalMaterial;
          if (orig && orig !== child.material) {
            if (Array.isArray(orig)) orig.forEach(m => disposeMaterial(m));
            else disposeMaterial(orig);
          }
          const material = child.material;
          if (Array.isArray(material)) material.forEach(m => disposeMaterial(m));
          else if (material) disposeMaterial(material);
        }
      });
    }

    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }
    if (skeletonHelperRef.current) {
      if (sceneRef.current) sceneRef.current.remove(skeletonHelperRef.current);
      skeletonHelperRef.current.dispose();
      skeletonHelperRef.current = null;
    }

    if (!currentAsset?.source?.viewUrl && !currentAsset?.source?.localUrl) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      setIsLoading(true);
      setMeshStats(null);
      try {
        const sourceUrl = currentAsset.source?.localUrl || currentAsset.source?.viewUrl;
        if (!sourceUrl) return;

        const format = currentAsset.format.toLowerCase();
        if (format === 'glb' || format === 'gltf') {
          // Multi-tier fast loading: L1 in-memory RAM cache (0ms) -> L2 persistent disk cache (~5ms) -> Chunked streaming network fetch
          setLoadProgress({ loaded: 0, total: 0, percent: 0 });
          let arrayBuffer: ArrayBuffer;
          const cached = getCachedGLB(sourceUrl);
          if (cached) {
            arrayBuffer = cached;
            setLoadProgress({ loaded: cached.byteLength, total: cached.byteLength, percent: 100 });
          } else {
            arrayBuffer = await loadGLBWithProgress(sourceUrl, (loaded, total, percent) => {
              if (!cancelled) {
                setLoadProgress({ loaded, total, percent });
              }
            });
          }

          // Truncation check for GLB binary format to avoid Three.js typed array length error
          if (format === 'glb' && arrayBuffer.byteLength >= 12) {
            const view = new DataView(arrayBuffer);
            const magic = view.getUint32(0, true);
            if (magic === 0x46546C67) { // 'glTF'
              const declaredLength = view.getUint32(8, true);
              if (declaredLength > arrayBuffer.byteLength) {
                throw new Error(
                  `Model file truncated: received ${arrayBuffer.byteLength} of ${declaredLength} bytes. Please try reloading.`
                );
              }
            }
          }

          const loader = sharedGLTFLoader;
          const basePath = (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://') || sourceUrl.startsWith('/'))
            ? sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1)
            : '';
          const gltf = await loader.parseAsync(arrayBuffer, basePath);
          if (!cancelled) {
            group.add(gltf.scene);
            gltf.scene.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                // Dense meshes: disable self-shadow receiver to avoid severe GPU pipeline hitch
                const vCount = child.geometry?.attributes?.position?.count || 0;
                child.receiveShadow = vCount < 200000;

                // Enhance normal map depth and crispness for micro-relief (eyes, teeth, ears)
                if (child.material) {
                  const mats = Array.isArray(child.material) ? child.material : [child.material];
                  mats.forEach((m) => {
                    if (m instanceof THREE.MeshStandardMaterial && m.normalMap) {
                      m.normalScale.set(1.4, 1.4);
                      m.needsUpdate = true;
                    }
                  });
                }
              }
            });
            frameCamera(gltf.scene);
            computeMeshStats(gltf.scene);

            // If GLTF contains animation clips, start AnimationMixer
            if (gltf.animations && gltf.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(gltf.scene);
              mixerRef.current = mixer;
              const action = mixer.clipAction(gltf.animations[0]);
              actionRef.current = action;
              action.play();
            }

            // Look for SkinnedMesh or Bone to attach SkeletonHelper
            let hasSkeleton = false;
            gltf.scene.traverse((child) => {
              if (child instanceof THREE.SkinnedMesh || child instanceof THREE.Bone) {
                hasSkeleton = true;
              }
            });
            if (hasSkeleton && sceneRef.current) {
              if (skeletonHelperRef.current) {
                sceneRef.current.remove(skeletonHelperRef.current);
                skeletonHelperRef.current.dispose();
              }
              const helper = new THREE.SkeletonHelper(gltf.scene);
              helper.visible = useAnimationStore.getState().displayOptions.showSkeleton;
              sceneRef.current.add(helper);
              skeletonHelperRef.current = helper;
            }

            // Asynchronously compile shaders and upload GPU buffers to eliminate render freeze
            if (rendererRef.current && cameraRef.current) {
              try {
                await rendererRef.current.compileAsync(gltf.scene, cameraRef.current);
              } catch {}
            }
          }
        } else if (format === 'obj') {
          // ponytail: verify response is text before parsing as OBJ
          const objResponse = await fetch(sourceUrl);
          if (!objResponse.ok) throw new Error(`HTTP ${objResponse.status}`);
          const objContentType = objResponse.headers.get('content-type') || '';
          if (objContentType.includes('text/html') || objContentType.includes('application/json')) {
            const text = await objResponse.clone().text();
            if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
              throw new Error('Model file served as HTML — possible token/auth failure. Open DevTools for details.');
            }
          }
          const blob = await objResponse.blob();
          const blobUrl = URL.createObjectURL(blob);
          const loader = sharedOBJLoader;
          const object = await loader.loadAsync(blobUrl);
          URL.revokeObjectURL(blobUrl);
          if (!cancelled) {
            object.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (shadingMode === 'wireframe') {
                  const oldMaterial = child.material;
                  child.material = new THREE.MeshStandardMaterial({
                    color: 0xd0d5dc,
                    wireframe: true,
                    roughness: 0.75,
                    metalness: 0.05
                  });
                  if (Array.isArray(oldMaterial)) oldMaterial.forEach(m => disposeMaterial(m));
                  else if (oldMaterial) disposeMaterial(oldMaterial);
                }
              }
            });
            group.add(object);
            frameCamera(object);
            computeMeshStats(object);
          }
        } else if (format === 'ply') {
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html') || contentType.includes('application/json')) {
            const text = await response.clone().text();
            if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
              throw new Error('Model file served as HTML — possible token/auth failure. Open DevTools for details.');
            }
          }
          const buffer = await response.arrayBuffer();
          const loader = sharedPLYLoader;
          const geometry = loader.parse(buffer);
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: 0xbcc2cc,
            roughness: 0.82,
            metalness: 0.05,
            wireframe: shadingMode === 'wireframe'
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          frameCamera(mesh);
          computeMeshStats(mesh);
        } else if (format === 'stl') {
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await response.arrayBuffer();
          const loader = sharedSTLLoader;
          const geometry = loader.parse(buffer);
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: 0xbcc2cc,
            roughness: 0.82,
            metalness: 0.05,
            wireframe: shadingMode === 'wireframe'
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          frameCamera(mesh);
          computeMeshStats(mesh);
        } else {
          throw new Error(`No browser preview is available for ${currentAsset.format}.`);
        }

        // Auto-generate high-quality thumbnail if not present in the asset
        if (rendererRef.current && sceneRef.current && cameraRef.current && currentAsset && (!currentAsset.thumbnail || currentAsset.thumbnail === '')) {
          requestAnimationFrame(() => {
            if (rendererRef.current && sceneRef.current && cameraRef.current && currentAsset) {
              rendererRef.current.render(sceneRef.current, cameraRef.current);
              const dataUrl = rendererRef.current.domElement.toDataURL('image/jpeg', 0.85);
              if (dataUrl && dataUrl.startsWith('data:image/')) {
                updateAssetProperties(currentAsset.id, { thumbnail: dataUrl });
              }
            }
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Viewport asset load failed', error);
          const message = error instanceof Error ? error.message : 'Unable to preview asset';
          setDropToastMessage(message);
          setDropToastIsHtmlError(message.includes('served as HTML') || message.includes('token/auth'));
          if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
          toastTimeoutRef.current = window.setTimeout(() => {
            setDropToastMessage(null);
            setDropToastIsHtmlError(false);
          }, 6000);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setLoadProgress(null);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentAsset?.id, currentAsset?.source?.viewUrl, currentAsset?.source?.localUrl, currentAsset?.format, viewportResetTrigger]);

  // Dynamic In-Memory Shading Mode Switcher (PBR, Wireframe, Clay, Normal, Matcap, X-Ray) without re-fetching
  useEffect(() => {
    if (!currentMeshGroupRef.current) return;
    const group = currentMeshGroupRef.current;

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }

        const orig = child.userData.originalMaterial;

        // Dispose previous non-original material to prevent GPU memory leak
        const prevMat = child.material;
        if (prevMat && prevMat !== orig && !child.userData.shadingMaterials?.includes(prevMat)) {
          if (Array.isArray(prevMat)) {
            prevMat.forEach(m => { if (m !== orig) disposeMaterial(m); });
          } else {
            disposeMaterial(prevMat);
          }
        }

        const isWire = Boolean(showWireframe) || shadingMode === 'wireframe';

        switch (shadingMode) {
          case 'textured':
            child.material = orig;
            if (Array.isArray(child.material)) {
              child.material.forEach(m => { m.wireframe = isWire; });
            } else if (child.material) {
              child.material.wireframe = isWire;
            }
            break;

          case 'wireframe':
            child.material = new THREE.MeshStandardMaterial({
              color: 0x00ff88,
              wireframe: true,
              roughness: 0.6,
              metalness: 0.1
            });
            break;

          case 'clay':
            child.material = new THREE.MeshStandardMaterial({
              color: 0xd6d9df,
              roughness: 0.75,
              metalness: 0.05,
              wireframe: isWire
            });
            break;

          case 'matcap':
          case 'matcap-ceramic':
            child.material = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.12,
              metalness: 0.05,
              wireframe: isWire
            });
            break;

          case 'matcap-chrome':
            child.material = new THREE.MeshStandardMaterial({
              color: 0xf0f3f8,
              roughness: 0.04,
              metalness: 0.95,
              wireframe: isWire
            });
            break;

          case 'matcap-gold':
            child.material = new THREE.MeshStandardMaterial({
              color: 0xf9cf00,
              roughness: 0.22,
              metalness: 0.88,
              wireframe: isWire
            });
            break;

          case 'normals':
          case 'matcap-normal':
            child.material = new THREE.MeshNormalMaterial({
              wireframe: isWire
            });
            break;

          case 'xray':
            child.material = new THREE.MeshBasicMaterial({
              color: 0x3b82f6,
              wireframe: true,
              transparent: true,
              opacity: 0.75
            });
            break;

          case 'matcap-turquoise':
            child.material = new THREE.MeshStandardMaterial({
              color: 0x06b6d4,
              roughness: 0.3,
              metalness: 0.4,
              wireframe: isWire
            });
            break;

          default:
            child.material = orig;
            if (Array.isArray(child.material)) {
              child.material.forEach(m => { m.wireframe = isWire; });
            } else if (child.material) {
              child.material.wireframe = isWire;
            }
            break;
        }

        // Track shading materials for cleanup on unmount
        if (!child.userData.shadingMaterials) child.userData.shadingMaterials = [];
        if (child.material !== orig && !child.userData.shadingMaterials.includes(child.material)) {
          child.userData.shadingMaterials.push(child.material);
        }
      }
    });
  }, [shadingMode, showWireframe]);

  // Synchronize material PBR properties (roughness, metalness, normalScale) in real time
  useEffect(() => {
    if (!currentMeshGroupRef.current || !currentAsset?.materialConfig) return;
    const { roughness, metalness, normalScale } = currentAsset.materialConfig;
    currentMeshGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if ('roughness' in m && typeof roughness === 'number') m.roughness = roughness;
          if ('metalness' in m && typeof metalness === 'number') m.metalness = metalness;
          if ('normalScale' in m && typeof normalScale === 'number') {
            m.normalScale.set(normalScale, normalScale);
          }
          m.needsUpdate = true;
        }
      }
    });
  }, [
    currentAsset?.materialConfig?.roughness,
    currentAsset?.materialConfig?.metalness,
    currentAsset?.materialConfig?.normalScale,
  ]);

  // Camera preset switcher
  const applyCameraPreset = useCallback((preset: CameraViewPreset | 'side') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const effectivePreset: CameraViewPreset = preset === 'side' ? 'right' : preset;
    setCameraPreset(effectivePreset);
    setCameraMenuOpen(false);
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    ctrl.target.set(0, 0.4, 0);

    switch (effectivePreset) {
      case 'perspective':
        cam.position.set(0, 1.2, 3.8);
        break;
      case 'front':
        cam.position.set(0, 0.4, 4.0);
        break;
      case 'back':
        cam.position.set(0, 0.4, -4.0);
        break;
      case 'top':
        cam.position.set(0, 4.2, 0.01);
        break;
      case 'bottom':
        cam.position.set(0, -3.8, 0.01);
        break;
      case 'left':
        cam.position.set(-4.0, 0.4, 0);
        break;
      case 'right':
        cam.position.set(4.0, 0.4, 0);
        break;
      case 'ortho':
        cam.position.set(2.8, 2.0, 2.8);
        break;
    }
    ctrl.update();
  }, []);

  const resetCamera = useCallback(() => {
    applyCameraPreset('perspective');
  }, [applyCameraPreset]);

  const handleZoomIn = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      const target = controlsRef.current.target;
      const dir = new THREE.Vector3().subVectors(cameraRef.current.position, target);
      const distance = dir.length();
      // Zoom 15% of current distance, but clamp to minDistance
      const zoomAmount = Math.max(distance * 0.15, 0.1);
      dir.normalize().multiplyScalar(zoomAmount);
      cameraRef.current.position.sub(dir);
      // Clamp to min/max
      const newDist = cameraRef.current.position.distanceTo(target);
      if (newDist < controlsRef.current.minDistance) {
        const clamped = dir.normalize().multiplyScalar(controlsRef.current.minDistance);
        cameraRef.current.position.copy(target).add(clamped);
      }
      controlsRef.current.update();
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      const target = controlsRef.current.target;
      const dir = new THREE.Vector3().subVectors(cameraRef.current.position, target);
      // Zoom out 15% of current distance
      dir.multiplyScalar(1.15);
      cameraRef.current.position.addVectors(target, dir);
      // Clamp to maxDistance
      const newDist = cameraRef.current.position.distanceTo(target);
      if (newDist > controlsRef.current.maxDistance) {
        const clamped = dir.normalize().multiplyScalar(controlsRef.current.maxDistance);
        cameraRef.current.position.copy(target).add(clamped);
      }
      controlsRef.current.update();
    }
  }, []);

  const frameCamera = useCallback((object: THREE.Object3D) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    controls.target.set(0, 0, 0);
    controls.update();

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius;

    if (radius === 0 || !isFinite(radius)) return;

    // Adaptive margin based on model size:
    // Small models (<1): more margin (1.3x) so they don't fill the entire view
    // Medium models (1-5): moderate margin (1.15x)
    // Large models (>5): less margin (1.05x) so they fit comfortably
    const marginFactor = radius < 1 ? 1.3 : radius < 5 ? 1.15 : 1.05;

    const fov = camera.fov * (Math.PI / 180);
    const distance = (radius / Math.sin(fov / 2)) * marginFactor;

    // Clamp to controls min/max with small buffer
    const clampedDistance = Math.max(
      controls.minDistance * 1.2,
      Math.min(controls.maxDistance * 0.9, distance)
    );

    const dir = new THREE.Vector3(1, 0.4, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(clampedDistance));

    camera.near = Math.max(0.01, clampedDistance / 100);
    camera.far = clampedDistance * 100;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();

    // Auto-generate asset thumbnail if missing
    if (rendererRef.current && sceneRef.current && currentAsset && (!currentAsset.thumbnail || currentAsset.thumbnail.length === 0)) {
      const targetId = currentAsset.id;
      setTimeout(() => {
        try {
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
            const thumb = rendererRef.current.domElement.toDataURL('image/png');
            if (thumb && thumb.length > 50) {
              currentAsset.thumbnail = thumb;
              updateAssetProperties(targetId, { thumbnail: thumb });
            }
          }
        } catch (e) {
          // ignore
        }
      }, 150);
    }
  }, [currentAsset, updateAssetProperties]);

  // Take real 3D viewport screenshot
  const handleScreenshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    try {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      const cleanName = (currentAsset?.name || 'viewport_3d').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const fileName = `${cleanName}_snapshot_${Date.now()}.png`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDropToastMessage(`Captured 3D snapshot: ${fileName}`);
      setTimeout(() => setDropToastMessage(null), 3000);
    } catch (err) {
      console.error('Screenshot failed', err);
    }
  };

  // Sync external camera preset and viewport snapshot triggers
  useEffect(() => {
    if (animCameraPreset) {
      applyCameraPreset(animCameraPreset);
    }
  }, [animCameraPreset, applyCameraPreset]);

  useEffect(() => {
    const handleCameraPresetEvent = (e: Event) => {
      const customEvent = e as CustomEvent<CameraViewPreset | 'side'>;
      if (customEvent.detail) {
        applyCameraPreset(customEvent.detail);
      }
    };
    const handleSnapshotEvent = () => {
      handleScreenshot();
    };
    window.addEventListener('setCameraPreset', handleCameraPresetEvent);
    window.addEventListener('takeViewportSnapshot', handleSnapshotEvent);
    return () => {
      window.removeEventListener('setCameraPreset', handleCameraPresetEvent);
      window.removeEventListener('takeViewportSnapshot', handleSnapshotEvent);
    };
  }, [applyCameraPreset]);

  // Drag and drop asset loading handler
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // 1. Check if dropped from Assets library
    const assetJson = e.dataTransfer.getData('application/json');
    const assetId = e.dataTransfer.getData('text/plain');

    if (assetJson) {
      try {
        const droppedAsset: ModelAsset = JSON.parse(assetJson);
        setCurrentAsset(droppedAsset);
        setDropToastMessage(`Loaded "${droppedAsset.name}" into Viewport`);
        setTimeout(() => setDropToastMessage(null), 3000);
        return;
      } catch (err) {
        // Fallback to ID
      }
    }

    if (assetId) {
      const match = assets.find(a => a.id === assetId);
      if (match) {
        setCurrentAsset(match);
        setDropToastMessage(`Loaded "${match.name}" into Viewport`);
        setTimeout(() => setDropToastMessage(null), 3000);
        return;
      }
    }

    // 2. Check if local 3D files were dropped from desktop (OBJ, GLB, STL, FBX)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const ext = file.name.split('.').pop()?.toUpperCase() || '';
      const ALLOWED_EXTENSIONS = ['GLB', 'GLTF', 'OBJ', 'PLY', 'STL'];
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setDropToastMessage(`Unsupported file format "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
        setTimeout(() => setDropToastMessage(null), 3500);
        return;
      }

      // Validate file structure before creating blob URL
      const validation = await validate3DFile(file, 'preview');
      if (!validation.valid) {
        setDropToastMessage(validation.error || 'Invalid file');
        setTimeout(() => setDropToastMessage(null), 3500);
        return;
      }

      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      const localBlobUrl = URL.createObjectURL(file);

      // Create immediate preview asset
      const tempId = `dropped-${Date.now()}`;
      const tempAsset: ModelAsset = {
        id: tempId,
        name: cleanName,
        category: 'mesh',
        meshType: 'custom',
        thumbnail: '',
        faces: 0,
        vertices: 0,
        triangles: 0,
        statsAvailable: false,
        topology: 'Quad',
        format: ext === 'OBJ' ? 'OBJ' : ext === 'PLY' ? 'PLY' : ext === 'STL' ? 'STL' : 'GLB',
        dateCreated: new Date().toISOString().split('T')[0],
        tags: ['Local Import', '3D Model', ext],
        source: { filename: file.name, subfolder: 'models', type: 'upload', viewUrl: localBlobUrl }
      };

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = localBlobUrl;

      // Load immediately into viewport for smooth UX
      addAsset(tempAsset);
      setCurrentAsset(tempAsset);
      setDropToastMessage(`Saving "${cleanName}" to backend storage...`);

      // Persist to backend storage (/backend/storage/models)
      try {
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        const uploadRes = await getApiClient().post<{
          url: string;
          id?: string;
          filename: string;
          stored_filename?: string;
          size: number;
        }>('/api/v1/file-upload/image', uploadFormData, { headers: { 'Content-Type': 'multipart/form-data' } });

        const serverUrl = uploadRes?.url || `/static/models/${uploadRes?.stored_filename || file.name}`;
        const finalAsset: ModelAsset = {
          ...tempAsset,
          id: uploadRes?.stored_filename || uploadRes?.id || tempId,
          tags: ['Saved to Storage', '3D Model', ext],
          source: {
            filename: uploadRes?.stored_filename || file.name,
            subfolder: 'models',
            type: 'upload',
            viewUrl: serverUrl,
          },
        };
        // Update temp asset in place to avoid duplicate cards in the workspace
        updateAssetProperties(tempId, finalAsset);
        setCurrentAsset(finalAsset);
        setDropToastMessage(`Saved to storage and loaded "${cleanName}"`);
        setTimeout(() => setDropToastMessage(null), 3000);
      } catch (uploadErr) {
        console.warn('Backend storage upload failed, keeping local preview:', uploadErr);
        setDropToastMessage(`Loaded "${cleanName}" (Local preview)`);
        setTimeout(() => setDropToastMessage(null), 3500);
      }
    }
  };

  return (
    <div 
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={{
        background: environmentSettings.backgroundColor === 'transparent'
          ? 'radial-gradient(ellipse 75% 65% at 50% 50%, #161616 0%, #0d0d0d 55%, #060606 100%)'
          : environmentSettings.backgroundColor
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing" />

      {/* Drag & Drop Visual Dropzone Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-[#0c0c0c]/95 border-2 border-dashed border-primary flex flex-col items-center justify-center z-40 transition-all pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/50 flex items-center justify-center text-primary shadow-[0_0_30px_rgba(255,204,0,0.3)] animate-bounce mb-3">
            <UploadCloud className="w-8 h-8" />
          </div>
          <span className="text-base font-bold text-white tracking-wide">
            Drop 3D Asset to Load into Viewport
          </span>
          <span className="text-xs text-zinc-400 mt-1">
            Loads geometry, textures, topology & material configs instantly
          </span>
        </div>
      )}

      {/* Drop Notification Toast */}
      {dropToastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#141414] border border-primary/50 shadow-2xl flex items-center gap-2 text-xs font-semibold text-white animate-in fade-in slide-in-from-top-2 duration-300 max-w-md">
          {dropToastIsHtmlError ? (
            <Search className="w-4 h-4 text-rose-400 flex-shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 text-primary" />
          )}
          <span className="truncate">{dropToastMessage}</span>
          {dropToastIsHtmlError && (
            <button
              onClick={() => {
                setDropToastMessage(null);
                setDropToastIsHtmlError(false);
                window.dispatchEvent(new CustomEvent('openUploadDiagnostic'));
              }}
              className="ml-2 px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-[10px] font-bold flex-shrink-0 transition-colors"
            >
              Diagnose
            </button>
          )}
        </div>
      )}

      {/* Futuristic Glassmorphic 3D Generation & GPU Loading Progress Overlay */}
      {(isExecuting || debugBlueprint || activeTask?.status === 'running' || activeTask?.status === 'queued') && (
        <div className="absolute bottom-14 sm:bottom-18 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-auto max-w-md w-full px-4 text-center select-none animate-in fade-in zoom-in-95 duration-300">
          <div className="w-full bg-[hsl(var(--surface-1))]/90 backdrop-blur-xl border border-white/[0.12] rounded-2xl p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.65)] space-y-2">
            <div className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2">
              <span className="flex items-center gap-2 font-bold text-white text-[11px] tracking-wide uppercase">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span>AI Neural Synthesis</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 font-mono">
                {activeTask?.provider || generationSettings.aiModel || '3D Engine'}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs px-0.5">
              <span className="text-zinc-200 truncate pr-2 text-left text-[11px] font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0 animate-pulse" />
                <span className="truncate">{executionStep || activeTask?.currentStep || 'Synthesizing 3D mesh representation...'}</span>
              </span>
              <span className="font-mono font-black text-xs text-primary flex-shrink-0">
                {Math.round(executionProgress || activeTask?.progress || 15)}%
              </span>
            </div>

            {/* Glowing Gradient Progress Bar */}
            <div className="w-full h-2 rounded-full bg-black/60 border border-white/[0.08] overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-amber-400 via-primary to-emerald-400 rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(255,204,0,0.5)]"
                style={{ width: `${Math.max(6, Math.min(100, executionProgress || activeTask?.progress || 15))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-400 px-0.5 pt-0.5">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>GPU Acceleration Active</span>
              </span>
              <button
                onClick={isExecuting ? cancelExecution : () => setDebugBlueprint(false)}
                className="text-zinc-500 hover:text-rose-400 font-medium transition-colors cursor-pointer"
              >
                {isExecuting ? 'Cancel Generation' : 'Dismiss'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smooth Non-Intrusive Loading Overlay (Asset file parsing) */}
      {isLoading && !isExecuting && (
        <div className="absolute inset-0 bg-[hsl(var(--surface-1))]/75 backdrop-blur-sm flex flex-col items-center justify-center z-20 pointer-events-none transition-all duration-200 p-4">
          <div className="bg-[hsl(var(--surface-1))]/90 border border-zinc-800/80 rounded-2xl px-6 py-5 flex flex-col items-center shadow-2xl max-w-xs w-full">
            <div className="relative flex items-center justify-center mb-3">
              <div className="w-12 h-12 rounded-full border-2 border-zinc-800 border-t-[hsl(var(--primary))] animate-spin" />
              <Sparkles className="w-4 h-4 text-primary absolute animate-pulse" />
            </div>
            <span className="text-xs font-bold text-zinc-100 tracking-wide block mb-1">
              {loadProgress && loadProgress.percent === 100
                ? 'Processing & GPU Upload...'
                : 'Loading 3D Model...'}
            </span>
            {loadProgress && loadProgress.total > 0 ? (
              <div className="w-full mt-2 space-y-1.5">
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#ebd024] to-[hsl(var(--primary))] transition-all duration-150 rounded-full"
                    style={{ width: `${Math.max(5, loadProgress.percent)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                  <span>
                    {(loadProgress.loaded / (1024 * 1024)).toFixed(1)} / {(loadProgress.total / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <span>{loadProgress.percent}%</span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-zinc-400 mt-1">Preparing high-fidelity mesh</p>
            )}
          </div>
        </div>
      )}


      {showOverlayUI && currentAsset?.artifacts?.physicsReady && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="pointer-events-auto rounded-xl border border-white/[0.12] bg-[hsl(var(--surface-1))]/95 backdrop-blur-md shadow-2xl px-2 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPhysicsModeOpen(prev => !prev)}
                className={physicsModeOpen ? 'px-2.5 py-1.5 rounded-lg bg-primary text-black text-[10px] font-bold' : 'px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-zinc-200 text-[10px] font-bold border border-white/[0.08]'}
              >
                Physics
              </button>
              {physicsModeOpen && (
                <>
                  <button type="button" onClick={() => { physicsRuntimeRef.current?.setRunning(!physicsRuntimeRef.current?.isRunning()); setPhysicsRunning(Boolean(physicsRuntimeRef.current?.isRunning())); }} className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-[10px] text-zinc-200 border border-white/[0.08]">
                    {physicsRunning ? 'Pause' : 'Play'}
                  </button>
                  <button type="button" onClick={() => physicsRuntimeRef.current?.step()} className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-[10px] text-zinc-200 border border-white/[0.08]">Step</button>
                  <button type="button" onClick={() => { physicsRuntimeRef.current?.reset(); setPhysicsRunning(false); }} className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-[10px] text-zinc-200 border border-white/[0.08]">Reset</button>
                  <button type="button" onClick={() => setPhysicsDebug(prev => !prev)} className={physicsDebug ? 'px-2 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/40 text-[10px] font-bold' : 'px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-zinc-300 border border-white/[0.08] text-[10px]'}>Colliders</button>
                  {(['drop', 'bounce', 'slide', 'spin'] as const).map(test => (
                    <button key={test} type="button" onClick={() => { physicsRuntimeRef.current?.applyTest(test); setPhysicsRunning(true); }} className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] text-zinc-300 border border-white/[0.08] text-[10px] capitalize">
                      {test}
                    </button>
                  ))}
                </>
              )}
            </div>
            {physicsModeOpen && physicsStatus && (
              <div className="pt-1 text-[9px] text-zinc-500 text-center">{physicsStatus} · soft-body/jiggle is capability-gated</div>
            )}
          </div>
        </div>
      )}

      {/* Empty State Overlay when no asset is active */}
      {!currentAsset && !isLoading && !isExecuting && !debugBlueprint && showOverlayUI && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none p-4">
          <div className="max-w-xs w-full p-5 rounded-2xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.12] card-depth shadow-2xl backdrop-blur-md text-center pointer-events-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-2))] border border-white/[0.12] flex items-center justify-center mx-auto text-primary shadow-[0_0_20px_rgba(255,204,0,0.15)]">
              <Box className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm text-white">3D Viewport Ready</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Generate a 3D asset from the left panel, or drag and drop a GLB/OBJ file directly here.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  setIsLeftPanelOpen(true);
                  setActiveTool('model');
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] font-black text-[11px] flex items-center justify-center gap-1.5 transition-all shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] active:scale-95 cursor-pointer btn-lighting-shine"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate 3D Asset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Viewport Overlays */}
      {showOverlayUI && (
        <>
          {/* Top-Right: Topology HUD & Corner View Controller */}
          <div 
            style={{ right: `${rightOffset}px` }} 
            className="absolute top-3 z-10 flex items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-1.5rem)] transition-all duration-200 pointer-events-auto"
          >
            {/* Unobtrusive Corner Zoom / Orbit Controller Set */}
            <div className="flex items-center gap-0.5 p-1 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.12] shadow-2xl text-zinc-300">
              {/* Orbit/Pan Mode Toggle with Active Visual Indicator */}
              <SimpleTooltip side="bottom" label={`Mode: ${interactionMode === 'pan' ? 'Pan' : 'Orbit'} (Click to toggle)`}>
                <button
                  id="btn-corner-orbit-toggle"
                  onClick={() => setInteractionMode(interactionMode === 'pan' ? 'orbit' : 'pan')}
                  className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                    interactionMode === 'orbit'
                      ? 'bg-[#181818] text-primary border border-primary/40 shadow-sm'
                      : 'bg-[#181818] text-zinc-300 hover:text-white'
                  }`}
                >
                  <Compass className="w-3 h-3 text-primary" />
                  <span className="capitalize">{interactionMode}</span>
                </button>
              </SimpleTooltip>

              <div className="w-px h-3.5 bg-white/[0.12] mx-0.5" />

              {/* Zoom In */}
              <SimpleTooltip side="bottom" label="Zoom In (+)">
                <button
                  id="btn-corner-zoom-in"
                  onClick={handleZoomIn}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181818] transition-all cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>

              {/* Zoom Out */}
              <SimpleTooltip side="bottom" label="Zoom Out (-)">
                <button
                  id="btn-corner-zoom-out"
                  onClick={handleZoomOut}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181818] transition-all cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>

              {/* Fit / Focus View */}
              <SimpleTooltip side="bottom" label="Reset Focus / Center (Hotkey: F)">
                <button
                  id="btn-corner-fit-view"
                  onClick={resetCamera}
                  className="p-1 rounded-lg text-zinc-400 hover:text-primary hover:bg-[#181818] transition-all cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>
            </div>

            {/* Topology HUD */}
            <div className="bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.12] rounded-xl px-2.5 sm:px-3 py-1.5 shadow-2xl flex items-center gap-2 sm:gap-3 text-xs font-mono">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-zinc-500 text-[10px] uppercase font-semibold hidden sm:inline">Topology</span>
                <span className="text-primary font-bold text-[10px]">
                  {currentAsset?.topology || (meshStats ? 'Triangle' : '—')}
                </span>
              </div>
              <div className="w-px h-3 bg-white/[0.12]" />
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-zinc-500 text-[10px] uppercase font-semibold hidden sm:inline">Geometry</span>
                <span className="text-[hsl(var(--neon-green))] font-bold text-[10px]">
                  {currentAsset?.statsAvailable 
                    ? `${(currentAsset.faces / 1000).toFixed(1)}k / ${(currentAsset.vertices / 1000).toFixed(1)}k` 
                    : meshStats 
                      ? `${(meshStats.faces / 1000).toFixed(1)}k / ${(meshStats.vertices / 1000).toFixed(1)}k`
                      : '—'}
                </span>
              </div>
              {meshStats?.dimensions && (
                <>
                  <div className="w-px h-3 bg-white/[0.12] hidden md:block" />
                  <div className="hidden md:flex items-center gap-1.5">
                    <span className="text-zinc-500 text-[10px] uppercase font-semibold">Size</span>
                    <span className="text-zinc-300 font-bold text-[10px]">
                      {meshStats.dimensions.x}×{meshStats.dimensions.y}×{meshStats.dimensions.z}m
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right Floating Tool Rail - visible on tablet & desktop (hidden on mobile to prevent clutter) */}
          <div 
            style={{ right: `${rightOffset}px` }} 
            className="hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 flex-col gap-1.5 bg-[hsl(var(--surface-1))] border border-white/[0.12] p-1.5 rounded-2xl shadow-2xl transition-all duration-200"
          >
            <SimpleTooltip side="left" label={interactionMode === 'move' ? 'Return to Orbit Mode' : 'Move / Translate 3D Model'}>
              <button
                id="btn-viewport-move-tool"
                onClick={() => setInteractionMode(interactionMode === 'move' ? 'orbit' : 'move')}
                className={`p-2 rounded-xl transition-all ${
                  interactionMode === 'move' 
                    ? 'bg-primary text-black font-bold ring-2 ring-[hsl(var(--primary))]/40' 
                    : 'text-zinc-300 hover:text-white hover:bg-[#1f222a]'
                }`}
              >
                <Move className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip side="left" label={interactionMode === 'pan' ? 'Switch to Orbit Mode' : 'Switch to Pan Mode'}>
              <button
                onClick={() => setInteractionMode(interactionMode === 'pan' ? 'orbit' : 'pan')}
                className={`p-2 rounded-xl transition-all ${
                  interactionMode === 'pan' 
                    ? 'bg-primary text-black font-bold' 
                    : 'text-zinc-300 hover:text-white hover:bg-[#1f222a]'
                }`}
              >
                <Hand className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip side="left" label="Capture 3D Viewport Screenshot">
              <button
                onClick={handleScreenshot}
                className="p-2 rounded-xl text-zinc-300 hover:text-primary hover:bg-[#1f222a] transition-all"
              >
                <Camera className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip side="left" label={environmentSettings.gridVisible ? 'Hide Floor Grid' : 'Show Floor Grid'}>
              <button
                onClick={() => patchEnv({ gridVisible: !environmentSettings.gridVisible })}
                className={`p-2 rounded-xl transition-all ${
                  environmentSettings.gridVisible 
                    ? 'text-primary bg-[#1f222a]' 
                    : 'text-zinc-300 hover:text-white hover:bg-[#1f222a]'
                }`}
              >
                <GridIcon className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip side="left" label="Reset Camera (Hotkey: F)">
              <button
                onClick={resetCamera}
                className="p-2 rounded-xl text-zinc-300 hover:text-white hover:bg-[#1f222a] transition-all"
              >
                <RotateCcw className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip side="left" label="Environment Settings — Lighting &amp; Camera">
              <button
                id="btn-env-settings-toggle"
                onClick={() => setShowEnvironmentPanel(!showEnvironmentPanel)}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  showEnvironmentPanel
                    ? 'bg-primary text-black font-bold' 
                    : 'text-zinc-300 hover:text-white hover:bg-[#1f222a]'
                }`}
              >
                <Sun className="w-4 h-4 stroke-[2.2]" />
              </button>
            </SimpleTooltip>
          </div>

          {/* Environment Settings Panel */}
          {showEnvironmentPanel && (
            <div 
              ref={envPanelRef}
              style={{ right: `${isDesktopScreen ? rightOffset + 56 : 16}px` }} 
              className="absolute top-1/2 -translate-y-1/2 z-20 w-80 max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto custom-scrollbar bg-[hsl(var(--surface-1))]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-2xl p-4 space-y-3.5 transition-all duration-200 animate-in fade-in zoom-in-95"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                <div className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-primary" />
                  <h3 className="text-[11px] font-bold tracking-wider text-white uppercase">Studio Environment</h3>
                </div>
                <button
                  onClick={() => setShowEnvironmentPanel(false)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Presets Section */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Atmosphere Presets</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {ENVIRONMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset.id)}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all text-left truncate ${
                        selectedPreset === preset.id
                          ? 'bg-primary text-black font-bold shadow-md shadow-primary/20'
                          : 'bg-[hsl(var(--surface-2))] text-zinc-300 border border-white/[0.08] hover:border-primary/40 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Backdrop / Background Color Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Backdrop Color</span>
                  <span className="text-[9px] text-zinc-400 font-mono capitalize">
                    {BACKGROUND_OPTIONS.find(b => b.value === environmentSettings.backgroundColor)?.label || 'Custom'}
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {BACKGROUND_OPTIONS.map((opt) => {
                    const isSelected = environmentSettings.backgroundColor === opt.value;
                    return (
                      <button
                        key={opt.id}
                        title={opt.label}
                        onClick={() => {
                          setSelectedPreset(null);
                          patchEnv({ backgroundColor: opt.value });
                        }}
                        style={{ background: opt.preview }}
                        className={`h-7 rounded-lg border transition-all ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/40 scale-105'
                            : 'border-white/[0.15] hover:border-white/40'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Lighting Tone */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Lighting Tone</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(LIGHT_TONES) as LightTone[]).map((toneKey) => (
                    <button
                      key={toneKey}
                      onClick={() => {
                        setSelectedPreset(null);
                        patchEnv({ lightTone: toneKey });
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all text-left ${
                        environmentSettings.lightTone === toneKey
                          ? 'bg-primary/20 text-primary border border-primary/50 font-bold'
                          : 'bg-[hsl(var(--surface-2))] text-zinc-400 border border-white/[0.08] hover:border-white/20 hover:text-zinc-200'
                      }`}
                    >
                      {LIGHT_TONES[toneKey].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lighting Sliders */}
              <div className="space-y-2 border-t border-white/[0.06] pt-2">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Light Levels</span>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Key Light</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{environmentSettings.keyLightIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={environmentSettings.keyLightIntensity}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      patchEnv({ keyLightIntensity: parseFloat(e.target.value) });
                    }}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Fill Light</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{environmentSettings.fillLightIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.1}
                    value={environmentSettings.fillLightIntensity}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      patchEnv({ fillLightIntensity: parseFloat(e.target.value) });
                    }}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Rim Accent</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{environmentSettings.rimLightIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={environmentSettings.rimLightIntensity}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      patchEnv({ rimLightIntensity: parseFloat(e.target.value) });
                    }}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Ambient</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{environmentSettings.ambientIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={environmentSettings.ambientIntensity}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      patchEnv({ ambientIntensity: parseFloat(e.target.value) });
                    }}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Camera Exposure</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{environmentSettings.exposure.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={environmentSettings.exposure}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      patchEnv({ exposure: parseFloat(e.target.value) });
                    }}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>

              {/* Stage & Floor Section */}
              <div className="space-y-2 border-t border-white/[0.06] pt-2">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Stage & Floor</span>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-300">Contact Shadow</span>
                    <span className="text-[9px] font-mono text-primary font-bold">{Math.round(environmentSettings.floorShadowOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={environmentSettings.floorShadowOpacity}
                    onChange={(e) => patchEnv({ floorShadowOpacity: parseFloat(e.target.value) })}
                    className="w-full h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer accent-primary"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-zinc-300">Floor Grid</span>
                  <button
                    onClick={() => patchEnv({ gridVisible: !environmentSettings.gridVisible })}
                    className={`w-7 h-4 rounded-full transition-colors relative ${environmentSettings.gridVisible ? 'bg-primary' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${environmentSettings.gridVisible ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300">Turntable Rotate</span>
                  <button
                    onClick={() => patchEnv({ autoRotate: !environmentSettings.autoRotate })}
                    className={`w-7 h-4 rounded-full transition-colors relative ${environmentSettings.autoRotate ? 'bg-primary' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${environmentSettings.autoRotate ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Reset to Defaults */}
              <button
                onClick={() => {
                  setSelectedPreset('studio');
                  setEnvironmentSettings({
                    ambientIntensity: 0.8,
                    keyLightIntensity: 3.0,
                    fillLightIntensity: 1.3,
                    rimLightIntensity: 2.0,
                    exposure: 1.25,
                    lightTone: 'studio',
                    backgroundColor: 'transparent',
                    gridVisible: false,
                    gridColor: '#222222',
                    floorShadowOpacity: 0.2,
                    autoRotate: false,
                    showAxes: true,
                    showStats: true,
                  });
                }}
                className="w-full py-1.5 rounded-lg text-[10px] font-semibold text-zinc-300 bg-[hsl(var(--surface-2))] border border-white/[0.1] hover:border-primary/50 hover:text-primary transition-colors"
              >
                Reset to Studio Defaults
              </button>
            </div>
          )}

          {/* Unified Minimalist Viewport Transport & Shading HUD Capsule */}
          {!isExecuting && !debugBlueprint && (
            <div className="absolute bottom-14 md:bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 sm:gap-2 max-w-[calc(100vw-1.5rem)] flex-wrap justify-center pointer-events-auto">
              {/* Camera Presets Dropdown */}
              <div className="relative" ref={cameraMenuRef}>
                <button
                  onClick={() => setCameraMenuOpen(!cameraMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.12] text-xs font-semibold text-zinc-200 hover:text-white hover:border-primary/40 shadow-2xl transition-all cursor-pointer active:scale-95"
                >
                  <RotateCw className="w-3.5 h-3.5 text-primary" />
                  <span className="capitalize">{cameraPreset}</span>
                  <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${cameraMenuOpen ? 'rotate-180 text-primary' : ''}`} />
                </button>

                {cameraMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-36 py-1 rounded-xl bg-[#181B22]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                    {(['perspective', 'front', 'back', 'top', 'bottom', 'left', 'right'] as CameraViewPreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          applyCameraPreset(p);
                          setCameraMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 capitalize hover:bg-[#222630] transition-colors flex items-center justify-between cursor-pointer ${
                          cameraPreset === p ? 'text-primary font-bold' : 'text-zinc-300'
                        }`}
                      >
                        <span>{p}</span>
                        {cameraPreset === p && <Check className="w-3 h-3 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Shading Selector (PBR, Clay, Wireframe, Normals) */}
              <div className="relative" ref={shadingMenuRef}>
                <button
                  onClick={() => setShadingMenuOpen(!shadingMenuOpen)}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-white/[0.12] text-xs font-semibold text-zinc-200 hover:text-white hover:border-primary/40 shadow-2xl transition-all cursor-pointer active:scale-95"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    shadingMode === 'textured' ? 'bg-primary' :
                    shadingMode === 'clay' ? 'bg-zinc-400' :
                    shadingMode === 'wireframe' ? 'bg-[hsl(var(--neon-green))]' : 'bg-sky-400'
                  }`} />
                  <span className="capitalize">{shadingMode.replace('matcap-', '')}</span>
                  <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${shadingMenuOpen ? 'rotate-180 text-primary' : ''}`} />
                </button>

                {shadingMenuOpen && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-44 py-1.5 rounded-xl bg-[#181B22]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                      Shading Mode
                    </div>
                    {[
                      { id: 'textured', label: 'PBR Textured', dot: 'bg-primary' },
                      { id: 'clay', label: 'Matte Clay', dot: 'bg-zinc-400' },
                      { id: 'wireframe', label: 'Topology Wireframe', dot: 'bg-[hsl(var(--neon-green))]' },
                      { id: 'matcap-normal', label: 'Tangent Normals', dot: 'bg-sky-400' },
                      { id: 'matcap-ceramic', label: 'Ceramic Gloss', dot: 'bg-white' },
                      { id: 'matcap-chrome', label: 'Chrome Metallic', dot: 'bg-zinc-300' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setShadingMode(s.id as any);
                          setShadingMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 hover:bg-[#222630] transition-colors flex items-center justify-between cursor-pointer ${
                          shadingMode === s.id ? 'text-primary font-bold' : 'text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                          <span>{s.label}</span>
                        </div>
                        {shadingMode === s.id && <Check className="w-3 h-3 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Wireframe Quick Toggle */}
              <SimpleTooltip side="top" label="Toggle Wireframe Overlay">
                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer active:scale-95 ${
                    showWireframe
                      ? 'bg-[hsl(var(--neon-green))]/15 text-[hsl(var(--neon-green))] border-[hsl(var(--neon-green))]/40 shadow-sm'
                      : 'bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border-white/[0.12] text-zinc-400 hover:text-white'
                  }`}
                >
                  <span>#</span>
                  <span className="hidden sm:inline text-[10px]">Wire</span>
                </button>
              </SimpleTooltip>

              {/* Turntable 360° */}
              <SimpleTooltip side="top" label={isTurntable ? 'Pause Turntable' : 'Turntable 360°'}>
                <button
                  onClick={() => setIsTurntable(!isTurntable)}
                  className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 ${
                    isTurntable
                      ? 'bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] border-primary font-bold shadow-md'
                      : 'bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border-white/[0.12] text-zinc-300 hover:text-white'
                  }`}
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isTurntable ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline text-[11px]">360°</span>
                </button>
              </SimpleTooltip>

              {/* Export CTA Button */}
              <button
                id="btn-viewport-export"
                onClick={() => setIsExportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 active:scale-95 text-[#080808] text-xs font-black shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] transition-all cursor-pointer border border-white/20 btn-lighting-shine"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Export</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};


