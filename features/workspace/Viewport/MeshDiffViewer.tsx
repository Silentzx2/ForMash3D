import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ModelAsset } from '../types';
import { useWorkspace } from '../store/WorkspaceContext';
import { getApiClient } from '@/services/apiClient';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import { Box, CameraIcon, Cancel, CheckIcon, ChevronDown, CloudUpload, CompassIcon, DownloadIcon, FlipHorizontalIcon, GridIcon, Hand, LoaderCircle, AlertCircle, Maximize02Icon, MoveIcon, RotateCcwIcon, RotateCw, SearchIcon, SparklesIcon, SunIcon, ZapIcon, ZoomInIcon, ZoomOutIcon } from '@hugeicons/core-free-icons';

interface MeshDiffViewerProps {
  className?: string;
  showControls?: boolean;
}

interface MeshStats {
  faces: number;
  vertices: number;
  triangles: number;
}

// Shared loaders to avoid GC churn
const sharedGLTFLoader = new GLTFLoader();
const sharedOBJLoader = new OBJLoader();
const sharedPLYLoader = new PLYLoader();
const sharedSTLLoader = new STLLoader();

// Function to load model based on URL extension
async function loadModelFromUrl(url: string): Promise<THREE.Group> {
  if (!url) throw new Error('No URL provided');
  
  const extension = url.split('.').pop()?.toLowerCase() || '';
  const loaderMap: Record<string, any> = {
    glb: sharedGLTFLoader,
    gltf: sharedGLTFLoader,
    obj: sharedOBJLoader,
    ply: sharedPLYLoader,
    stl: sharedSTLLoader,
  };
  
  const loader = loaderMap[extension] || sharedGLTFLoader;
  
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
        resolve(scene);
      },
      undefined,
      (error) => reject(error)
    );
  });
}

export const MeshDiffViewer: React.FC<MeshDiffViewerProps> = ({ 
  className = '', 
  showControls = true 
}) => {
  const { currentAsset } = useWorkspace();
  const [leftMesh, setLeftMesh] = useState<THREE.Group | null>(null);
  const [rightMesh, setRightMesh] = useState<THREE.Group | null>(null);
  const [leftStats, setLeftStats] = useState<MeshStats | null>(null);
  const [rightStats, setRightStats] = useState<MeshStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'source-final' | 'source-lod1' | 'lod0-lod1'>('source-final');
  const leftCamera = useRef<THREE.PerspectiveCamera | null>(null);
  const rightCamera = useRef<THREE.PerspectiveCamera | null>(null);
  const leftControls = useRef<OrbitControls | null>(null);
  const rightControls = useRef<OrbitControls | null>(null);
  const leftRenderer = useRef<THREE.WebGLRenderer | null>(null);
  const rightRenderer = useRef<THREE.WebGLRenderer | null>(null);
  const leftScene = useRef<THREE.Scene | null>(null);
  const rightScene = useRef<THREE.Scene | null>(null);
  const leftContainerRef = useRef<HTMLDivElement | null>(null);
  const rightContainerRef = useRef<HTMLDivElement | null>(null);
  const [animationFrame, setAnimationFrame] = useState<number>(0);

  // Initialize Three.js scenes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Left scene
    const newLeftScene = new THREE.Scene();
    newLeftScene.background = new THREE.Color(0x1a1a1a);
    leftScene.current = newLeftScene;

    // Right scene
    const newRightScene = new THREE.Scene();
    newRightScene.background = new THREE.Color(0x1a1a1a);
    rightScene.current = newRightScene;

    // Initialize cameras
    const newLeftCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    newLeftCamera.position.set(0, 1.5, 3);
    leftCamera.current = newLeftCamera;

    const newRightCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    newRightCamera.position.set(0, 1.5, 3);
    rightCamera.current = newRightCamera;

    // Add lights to both scenes
    const addLightsToScene = (scene: THREE.Scene) => {
      const ambientLight = new THREE.AmbientLight(0x404040, 2);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
      directionalLight.position.set(5, 10, 7);
      scene.add(directionalLight);
    };

    addLightsToScene(newLeftScene);
    addLightsToScene(newRightScene);

    return () => {
      // Cleanup
    };
  }, []);

  // Load meshes when currentAsset changes or diffMode changes
  useEffect(() => {
    if (!currentAsset) {
      setLeftMesh(null);
      setRightMesh(null);
      setLeftStats(null);
      setRightStats(null);
      return;
    }

    const loadMeshes = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let leftUrl: string | undefined | null = null;
        let rightUrl: string | undefined | null = null;

        // Determine which meshes to load based on diffMode
        switch (diffMode) {
          case 'source-final':
            // Left: source mesh (input), Right: final output mesh
            leftUrl = currentAsset.artifacts?.source || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
            rightUrl = currentAsset.artifacts?.gameReady || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
            break;
          case 'source-lod1':
            // Left: source mesh, Right: LOD1
            leftUrl = currentAsset.artifacts?.source || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
            const lods = currentAsset.artifacts?.lods;
            rightUrl = lods && lods.length > 0 ? lods[0] : null;
            break;
          case 'lod0-lod1':
            // Left: LOD0 (base), Right: LOD1
            const lodPair = currentAsset.artifacts?.lods;
            leftUrl = lodPair && lodPair.length > 0 ? lodPair[0] : null;
            rightUrl = lodPair && lodPair.length > 1 ? lodPair[1] : lodPair && lodPair.length > 0 ? lodPair[0] : null;
            break;
        }

        if (!leftUrl || !rightUrl) {
          throw new Error('Missing mesh URLs for comparison');
        }

        // Load both meshes
        const [leftMesh, rightMesh] = await Promise.all([
          loadModelFromUrl(leftUrl),
          loadModelFromUrl(rightUrl)
        ]);

        setLeftMesh(leftMesh);
        setRightMesh(rightMesh);

        // Calculate stats for left mesh
        let leftFaces = 0, leftVertices = 0, leftTriangles = 0;
        leftMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geom = child.geometry;
            if (geom) {
              if (geom.index) {
                leftTriangles += geom.index.count / 3;
                leftFaces += geom.index.count / 3;
              } else if (geom.attributes?.position) {
                const count = geom.attributes.position.count;
                leftTriangles += count / 3;
                leftFaces += count / 3;
              }
              if (geom.attributes?.position) {
                leftVertices += geom.attributes.position.count;
              }
            }
          }
        });

        // Calculate stats for right mesh
        let rightFaces = 0, rightVertices = 0, rightTriangles = 0;
        rightMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geom = child.geometry;
            if (geom) {
              if (geom.index) {
                rightTriangles += geom.index.count / 3;
                rightFaces += geom.index.count / 3;
              } else if (geom.attributes?.position) {
                const count = geom.attributes.position.count;
                rightTriangles += count / 3;
                rightFaces += count / 3;
              }
              if (geom.attributes?.position) {
                rightVertices += geom.attributes.position.count;
              }
            }
          }
        });

        setLeftStats({
          faces: Math.round(leftFaces),
          vertices: Math.round(leftVertices),
          triangles: Math.round(leftTriangles)
        });

        setRightStats({
          faces: Math.round(rightFaces),
          vertices: Math.round(rightVertices),
          triangles: Math.round(rightTriangles)
        });
      } catch (err) {
        console.error('Failed to load meshes for diff viewer:', err);
        setError(err instanceof Error ? err.message : 'Failed to load meshes');
      } finally {
        setIsLoading(false);
      }
    };

    loadMeshes();
  }, [currentAsset, diffMode]);

  // Resize observers for canvas elements
  useEffect(() => {
    const handleResize = () => {
      updateRendererSizes();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (leftContainerRef.current) resizeObserver.observe(leftContainerRef.current);
    if (rightContainerRef.current) resizeObserver.observe(rightContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Update renderer sizes when containers change size
  const updateRendererSizes = useCallback(() => {
    if (leftContainerRef.current && leftRenderer.current && leftCamera.current) {
      const rect = leftContainerRef.current.getBoundingClientRect();
      leftRenderer.current.setSize(rect.width, rect.height);
      leftCamera.current.aspect = rect.width / rect.height;
      leftCamera.current.updateProjectionMatrix();
    }

    if (rightContainerRef.current && rightRenderer.current && rightCamera.current) {
      const rect = rightContainerRef.current.getBoundingClientRect();
      rightRenderer.current.setSize(rect.width, rect.height);
      rightCamera.current.aspect = rect.width / rect.height;
      rightCamera.current.updateProjectionMatrix();
    }
  }, []);

  // Synchronize cameras if enabled
  useEffect(() => {
    if (!leftControls.current || !rightControls.current) return;

    const syncControls = () => {
      // Sync left to right
      rightControls.current!.target.copy(leftControls.current!.target);
      rightControls.current!.object.position.copy(leftControls.current!.object.position);
      rightControls.current!.update();

      // Sync right to left  
      leftControls.current!.target.copy(rightControls.current!.target);
      leftControls.current!.object.position.copy(rightControls.current!.object.position);
      leftControls.current!.update();
    };

    // Add event listeners
    leftControls.current!.addEventListener('change', syncControls);
    rightControls.current!.addEventListener('change', syncControls);

    return () => {
      leftControls.current!.removeEventListener('change', syncControls);
      rightControls.current!.removeEventListener('change', syncControls);
    };
  }, [leftControls, rightControls]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      setAnimationFrame(prev => prev + 1);
      
      // Render left scene
      if (leftRenderer.current && leftScene.current && leftCamera.current) {
        leftRenderer.current.render(leftScene.current, leftCamera.current);
      }
      
      // Render right scene
      if (rightRenderer.current && rightScene.current && rightCamera.current) {
        rightRenderer.current.render(rightScene.current, rightCamera.current);
      }
      
      requestAnimationFrame(animate);
    };

    animate();
    
    return () => {
      // Cleanup handled by React 18 automatic cleanup
    };
  }, [leftRenderer, rightRenderer, leftScene, rightScene, leftCamera, rightCamera]);

  // Initialize renderers, scenes, and controls when refs are set
  useEffect(() => {
    if (leftContainerRef.current) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(leftContainerRef.current.clientWidth, leftContainerRef.current.clientHeight);
      leftContainerRef.current.appendChild(renderer.domElement);
      leftRenderer.current = renderer;

      const scene = leftScene.current;
      if (scene) {
        // Add a grid helper for reference
        const gridHelper = new THREE.GridHelper(10, 10, 0x404040, 0x404040);
        gridHelper.position.y = -0.01; // Slightly above ground to avoid z-fighting
        scene.add(gridHelper);
      }

      const camera = leftCamera.current;
      if (camera) {
        camera.position.set(0, 1.5, 3);
        camera.lookAt(0, 0, 0);

        const controls = new OrbitControls(camera, leftContainerRef.current);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 0.5;
        controls.maxDistance = 20;
        controls.target.set(0, 0, 0);
        leftControls.current = controls;
      }
    }

    if (rightContainerRef.current) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(rightContainerRef.current.clientWidth, rightContainerRef.current.clientHeight);
      rightContainerRef.current.appendChild(renderer.domElement);
      rightRenderer.current = renderer;

      const scene = rightScene.current;
      if (scene) {
        // Add a grid helper for reference
        const gridHelper = new THREE.GridHelper(10, 10, 0x404040, 0x404040);
        gridHelper.position.y = -0.01; // Slightly above ground to avoid z-fighting
        scene.add(gridHelper);
      }

      const camera = rightCamera.current;
      if (camera) {
        camera.position.set(0, 1.5, 3);
        camera.lookAt(0, 0, 0);

        const controls = new OrbitControls(camera, rightContainerRef.current);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 0.5;
        controls.maxDistance = 20;
        controls.target.set(0, 0, 0);
        rightControls.current = controls;
      }
    }

    return () => {
      // Cleanup
      if (leftRenderer.current) {
        leftRenderer.current.dispose();
        leftContainerRef.current?.removeChild(leftRenderer.current.domElement);
      }
      if (rightRenderer.current) {
        rightRenderer.current.dispose();
        rightContainerRef.current?.removeChild(rightRenderer.current.domElement);
      }
      if (leftControls.current) leftControls.current.dispose();
      if (rightControls.current) rightControls.current.dispose();
    };
  }, [leftContainerRef, rightContainerRef, leftScene, rightScene, leftCamera, rightCamera]);

  // Add meshes to scenes when they load
  useEffect(() => {
    if (leftMesh && leftScene.current) {
      // Clear existing meshes (except grid helper)
      leftScene.current.traverse((object) => {
        if (object instanceof THREE.Mesh && (typeof object.userData !== 'string' || object.userData !== 'gridHelper')) {
          leftScene.current!.remove(object);
        }
      });
      leftScene.current.add(leftMesh);
    }
  }, [leftMesh, leftScene]);

  useEffect(() => {
    if (rightMesh && rightScene.current) {
      // Clear existing meshes (except grid helper)
      rightScene.current.traverse((object) => {
        if (object instanceof THREE.Mesh && (typeof object.userData !== 'string' || object.userData !== 'gridHelper')) {
          rightScene.current!.remove(object);
        }
      });
      rightScene.current.add(rightMesh);
    }
  }, [rightMesh, rightScene]);

  // Format number for display
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  // Calculate difference percentage
  const calculateDiffPercentage = (left: number, right: number): string => {
    if (left === 0) return right === 0 ? '0%' : '+∞%';
    const diff = ((right - left) / left) * 100;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}%`;
  };

  // Get mesh URLs based on diffMode for display
  const getMeshUrls = useCallback(() => {
    if (!currentAsset) return { left: 'None', right: 'None' };
    
    let leftUrl: string | undefined | null = null;
    let rightUrl: string | undefined | null = null;

    switch (diffMode) {
      case 'source-final':
        leftUrl = currentAsset.artifacts?.source || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
        rightUrl = currentAsset.artifacts?.gameReady || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
        break;
      case 'source-lod1':
        leftUrl = currentAsset.artifacts?.source || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
        const lods = currentAsset.artifacts?.lods;
        rightUrl = lods && lods.length > 0 ? lods[0] : null;
        break;
      case 'lod0-lod1':
        const lodPair = currentAsset.artifacts?.lods;
        leftUrl = lodPair && lodPair.length > 0 ? lodPair[0] : null;
        rightUrl = lodPair && lodPair.length > 1 ? lodPair[1] : lodPair && lodPair.length > 0 ? lodPair[0] : null;
        break;
    }

    return {
      left: leftUrl || 'Not available',
      right: rightUrl || 'Not available'
    };
  }, [currentAsset, diffMode]);

  if (!currentAsset) {
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center bg-[hsl(var(--surface-1))] px-4 text-center ${className}`}>
        <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-4">
          <HugeiconsIcon icon={Box} size={16} className="w-6 h-6" />
        </div>
        <div className="text-xs font-bold text-white">Select an Asset to Compare</div>
        <div className="text-[11px] text-zinc-400 mt-2">Choose a 3D model from the Assets tab to view mesh comparisons</div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[hsl(var(--surface-1))]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--surface-2))] flex items-center justify-center">
            <HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">{currentAsset.name}</h3>
            <div className="text-xs text-zinc-400">Mesh Difference Viewer</div>
          </div>
        </div>
        
        {/* Mode Selector */}
        {showControls && (
          <div className="relative">
            <button
              onClick={() => {
                // Cycle through modes: source-final -> source-lod1 -> lod0-lod1 -> source-final
                const nextMode = diffMode === 'source-final' ? 'source-lod1' : 
                               diffMode === 'source-lod1' ? 'lod0-lod1' : 
                               'source-final';
                setDiffMode(nextMode);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.1] text-zinc-300 hover:bg-[hsl(var(--surface-3))] hover:text-white transition-all"
            >
              <span className="text-xs font-mono">
                {diffMode === 'source-final' ? 'Source vs Final' : 
                 diffMode === 'source-lod1' ? 'Source vs LOD1' : 
                 'LOD0 vs LOD1'}
              </span>
              <HugeiconsIcon icon={ChevronDown} size={12} className="text-zinc-400" />
            </button>
          </div>
        )}
      </div>

      {/* Loading/Error State */}
      {isLoading && !leftMesh && !rightMesh && (
        <div className="flex-1 flex items-center justify-center bg-[hsl(var(--surface-0))]">
          <div className="flex flex-col items-center gap-3">
            <HugeiconsIcon icon={LoaderCircle} size={20} className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-zinc-400">Loading meshes for comparison...</span>
          </div>
        </div>
      )}

      {error && !leftMesh && !rightMesh && (
        <div className="flex-1 flex items-center justify-center bg-[hsl(var(--surface-0))]">
          <div className="flex flex-col items-center gap-3">
            <HugeiconsIcon icon={AlertCircle} size={20} className="w-6 h-6 text-rose-400" />
            <span className="text-xs text-zinc-400">{error}</span>
          </div>
        </div>
      )}

      {/* Mesh Comparison View */}
      {!isLoading && (leftMesh || rightMesh) && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Mesh Viewer */}
          <div className="flex-1 border-r border-white/[0.08]">
            <div 
              ref={leftContainerRef}
              className="w-full h-full bg-[hsl(var(--surface-0))]"
            />
            <div className="absolute bottom-2 left-2 right-2 flex justify-between px-2">
              <div className="flex gap-2 text-xs text-zinc-400">
                <span className="font-medium">Left Mesh:</span>
                <span>{diffMode === 'source-final' ? 'Source' : 
                         diffMode === 'source-lod1' ? 'Source' : 
                         'LOD0'}</span>
              </div>
              <div className="flex gap-2 text-xs text-zinc-400">
                {leftStats && (
                  <>
                    <span className="font-mono">{formatNumber(leftStats.vertices)} vertices</span>
                    <span className="mx-2">|</span>
                    <span className="font-mono">{formatNumber(leftStats.faces)} faces</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Mesh Viewer */}
          <div className="flex-1 border-l border-white/[0.08]">
            <div 
              ref={rightContainerRef}
              className="w-full h-full bg-[hsl(var(--surface-0))]"
            />
            <div className="absolute bottom-2 left-2 right-2 flex justify-between px-2">
              <div className="flex gap-2 text-xs text-zinc-400">
                <span className="font-medium">Right Mesh:</span>
                <span>{diffMode === 'source-final' ? 'Final' : 
                         diffMode === 'source-lod1' ? 'LOD1' : 
                         'LOD1'}</span>
              </div>
              <div className="flex gap-2 text-xs text-zinc-400">
                {rightStats && (
                  <>
                    <span className="font-mono">{formatNumber(rightStats.vertices)} vertices</span>
                    <span className="mx-2">|</span>
                    <span className="font-mono">{formatNumber(rightStats.faces)} faces</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics and Difference Metrics */}
      {(leftStats || rightStats) && showControls && (
        <div className="px-4 py-3 border-t border-white/[0.08] bg-[hsl(var(--surface-1))]">
          <div className="space-y-3">
            {/* Statistics Comparison */}
            <div className="grid grid-cols-2 gap-4">
              {/* Left Stats */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span>Left Mesh Stats</span>
                  <span>{diffMode === 'source-final' ? '(Source)' : 
                           diffMode === 'source-lod1' ? '(Source)' : 
                           '(LOD0)'}</span>
                </div>
                {leftStats && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Vertices:</span>
                      <span className="font-mono text-white">{formatNumber(leftStats.vertices)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Faces:</span>
                      <span className="font-mono text-white">{formatNumber(leftStats.faces)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Triangles:</span>
                      <span className="font-mono text-white">{formatNumber(leftStats.triangles)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Stats */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span>Right Mesh Stats</span>
                  <span>{diffMode === 'source-final' ? '(Final)' : 
                           diffMode === 'source-lod1' ? '(LOD1)' : 
                           '(LOD1)'}</span>
                </div>
                {rightStats && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Vertices:</span>
                      <span className="font-mono text-white">{formatNumber(rightStats.vertices)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Faces:</span>
                      <span className="font-mono text-white">{formatNumber(rightStats.faces)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Triangles:</span>
                      <span className="font-mono text-white">{formatNumber(rightStats.triangles)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Difference Metrics */}
            {leftStats && rightStats && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span>Difference Metrics</span>
                  <span>{diffMode === 'source-final' ? '(Source → Final)' : 
                           diffMode === 'source-lod1' ? '(Source → LOD1)' : 
                           '(LOD0 → LOD1)'}</span>
                </div>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Vertex Count Δ:</span>
                    <span className="font-mono">
                      {rightStats.vertices >= leftStats.vertices ? '+' : ''}
                      {formatNumber(rightStats.vertices - leftStats.vertices)}
                      ({calculateDiffPercentage(leftStats.vertices, rightStats.vertices)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Face Count Δ:</span>
                    <span className="font-mono">
                      {rightStats.faces >= leftStats.faces ? '+' : ''}
                      {formatNumber(rightStats.faces - leftStats.faces)}
                      ({calculateDiffPercentage(leftStats.faces, rightStats.faces)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Triangle Count Δ:</span>
                    <span className="font-mono">
                      {rightStats.triangles >= leftStats.triangles ? '+' : ''}
                      {formatNumber(rightStats.triangles - leftStats.triangles)}
                      ({calculateDiffPercentage(leftStats.triangles, rightStats.triangles)})
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Mesh Information */}
            <div className="border-t border-white/[0.08] pt-3">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span>Mesh Information</span>
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Source:</span>
                  <span className="font-mono text-wrap">
                    {getMeshUrls().left}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Target:</span>
                  <span className="font-mono text-wrap">
                    {getMeshUrls().right}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};