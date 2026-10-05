import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ModelAsset } from '../../types';
import { useWorkspace } from '../store/WorkspaceContext';
import { getApiClient } from '@/services/apiClient';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import { Box, CameraIcon, Cancel, CheckIcon, ChevronDown, CloudUpload, CompassIcon, DownloadIcon, FlipHorizontalIcon, GridIcon, Hand, Maximize02Icon, MoveIcon, RotateCcwIcon, RotateCw, SearchIcon, SparklesIcon, SunIcon, ZapIcon, ZoomInIcon, ZoomOutIcon } from '@hugeicons/core-free-icons';

interface ModelComparisonViewerProps {
  className?: string;
  showControls?: boolean;
  modelIds: string[]; // Array of model IDs to compare
}

interface ModelStats {
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

export const ModelComparisonViewer: React.FC<ModelComparisonViewerProps> = ({ 
  className = '', 
  showControls = true,
  modelIds = [] 
}) => {
  const { currentAsset } = useWorkspace();
  const [models, setModels] = useState<(THREE.Group | null)[]>([]);
  const [modelStats, setModelStats] = useState<ModelStats[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<THREE.PerspectiveCamera[]>([]);
  const [controls, setControls] = useState<OrbitControls[]>([]);
  const [renderers, setRenderers] = useState<THREE.WebGLRenderer[]>([]);
  const [scenes, setScenes] = useState<THREE.Scene[]>([]);
  const [containerRefs, setContainerRefs] = useState<(HTMLDivElement | null)[]>([]);
  const [animationFrame, setAnimationFrame] = useState<number>(0);

  // Initialize scenes, cameras, controls, and renderers for each model
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initialize arrays for each model
    const scenes: THREE.Scene[] = [];
    const cameras: THREE.PerspectiveCamera[] = [];
    const controls: OrbitControls[] = [];
    const renderers: THREE.WebGLRenderer[] = [];
    
    modelIds.forEach((_, index) => {
      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      scenes.push(scene);

      // Camera
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.position.set(0, 1.5, 3);
      cameras.push(camera);

      // Controls (we'll initialize these later when containers are available)
      controls.push(null as any);

      // Renderer (we'll initialize these later when containers are available)
      renderers.push(null as any);
    });

    setScenes(scenes);
    setCameras(cameras);
    setControls(controls);
    setRenderers(renderers);

    // Add lights to all scenes
    const addLightsToScene = (scene: THREE.Scene) => {
      const ambientLight = new THREE.AmbientLight(0x404040, 2);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
      directionalLight.position.set(5, 10, 7);
      scene.add(directionalLight);
    };

    scenes.forEach(addLightsToScene);

    return () => {
      // Cleanup
      scenes.forEach(scene => scene.dispose());
      cameras.forEach(camera => {});
      controls.forEach(control => {
        if (control) control.dispose();
      });
      renderers.forEach(renderer => {
        if (renderer) renderer.dispose();
      });
    };
  }, [modelIds]);

  // Load models when modelIds change
  useEffect(() => {
    if (modelIds.length === 0) {
      setModels([]);
      setModelStats([]);
      return;
    }

    const loadModels = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load all models
        const loadedModels = await Promise.all(
          modelIds.map(async (modelId) => {
            // In a real implementation, we would fetch the model URL from the asset or job results
            // For now, we'll use a placeholder or try to get it from currentAsset if it's the same
            // This is a simplified implementation - in reality, we'd need to get the actual model URLs
            // from the comparison group results or job metadata
            try {
              // For demonstration, we'll use the current asset if available and it matches one of the modelIds
              // In a real implementation, we'd have proper model URLs from the comparison results
              if (currentAsset && modelIds.includes(currentAsset.id)) {
                const url = currentAsset.artifacts?.gameReady || currentAsset.source?.viewUrl || currentAsset.source?.localUrl;
                if (url) {
                  return await loadModelFromUrl(url);
                }
              }
              
              // If we can't load a specific model, return null for now
              // In a real implementation, we'd fetch the actual model URLs from job results
              return null;
            } catch (error) {
              console.warn(`Failed to load model ${modelId}:`, error);
              return null;
            }
          })
        );

        setModels(loadedModels);

        // Calculate stats for each model
        const stats: ModelStats[] = [];
        loadedModels.forEach((model, index) => {
          if (!model) {
            stats.push({ faces: 0, vertices: 0, triangles: 0 });
            return;
          }

          let faces = 0, vertices = 0, triangles = 0;
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const geom = child.geometry;
              if (geom) {
                if (geom.index) {
                  triangles += geom.index.count / 3;
                  faces += geom.index.count / 3;
                } else if (geom.attributes?.position) {
                  const count = geom.attributes.position.count;
                  triangles += count / 3;
                  faces += count / 3;
                }
                if (geom.attributes?.position) {
                  vertices += geom.attributes.position.count;
                }
              }
            }
          });

          stats.push({
            faces: Math.round(faces),
            vertices: Math.round(vertices),
            triangles: Math.round(triangles)
          });
        });

        setModelStats(stats);
      } catch (err) {
        console.error('Failed to load models for comparison:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();
  }, [modelIds, currentAsset]);

  // Resize observers for canvas elements
  useEffect(() => {
    const handleResize = () => {
      updateRendererSizes();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    containerRefs.forEach((ref, index) => {
      if (ref) resizeObserver.observe(ref);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRefs]);

  // Update renderer sizes when containers change size
  const updateRendererSizes = useCallback(() => {
    renderers.forEach((renderer, index) => {
      if (renderer && containerRefs[index] && cameras[index]) {
        const rect = containerRefs[index].getBoundingClientRect();
        renderer.setSize(rect.width, rect.height);
        cameras[index].aspect = rect.width / rect.height;
        cameras[index].updateProjectionMatrix();
      }
    });
  }, [renderers, containerRefs, cameras]);

  // Synchronize cameras if enabled
  useEffect(() => {
    if (!controls.every(c => c !== null)) return;

    const syncControls = () => {
      // Use the first camera as the source of truth
      const sourceCamera = cameras[0];
      const sourceControl = controls[0];
      
      if (!sourceCamera || !sourceControl) return;

      // Sync all other cameras to the first one
      cameras.forEach((camera, index) => {
        if (index === 0 || !camera || !controls[index]) return;
        
        // Sync position and target
        camera.position.copy(sourceCamera.position);
        // For simplicity, we're not syncing the target here - in a full implementation
        // we would need to sync the orbit controls' target
        controls[index].target.copy(sourceControl.target);
        controls[index].update();
      });
    };

    // Add event listeners
    controls.forEach((control, index) => {
      if (control) {
        control.addEventListener('change', syncControls);
      }
    });

    return () => {
      controls.forEach((control, index) => {
        if (control) {
          control.removeEventListener('syncControls', syncControls);
        }
      });
    };
  }, [controls, cameras]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      setAnimationFrame(prev => prev + 1);
      
      // Render all scenes
      renderers.forEach((renderer, index) => {
        if (renderer && scenes[index] && cameras[index]) {
          renderer.render(scenes[index], cameras[index]);
        }
      });
      
      requestAnimationFrame(animate);
    };

    animate();
    
    return () => {
      // Cleanup handled by React 18 automatic cleanup
    };
  }, [renderers, scenes, cameras]);

  // Initialize renderers, scenes, and controls when refs are set
  useEffect(() => {
    containerRefs.forEach((containerRef, index) => {
      if (containerRef && !renderers[index]) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
        containerRef.appendChild(renderer.domElement);
        const renderersCopy = [...renderers];
        renderersCopy[index] = renderer;
        setRenderers(renderersCopy);

        const scene = scenes[index];
        if (scene) {
          // Add a grid helper for reference
          const gridHelper = new THREE.GridHelper(10, 10, 0x404040, 0x404040);
          gridHelper.position.y = -0.01; // Slightly above ground to avoid z-fighting
          scene.add(gridHelper);
        }

        const camera = cameras[index];
        if (camera) {
          camera.position.set(0, 1.5, 3);
          camera.lookAt(0, 0, 0);
        }

        const control = new OrbitControls(camera, containerRef);
        control.enableDamping = true;
        control.dampingFactor = 0.05;
        control.screenSpacePanning = false;
        control.minDistance = 0.5;
        control.maxDistance = 20;
        control.target.set(0, 0, 0);
        const controlsCopy = [...controls];
        controlsCopy[index] = control;
        setControls(controlsCopy);
      }
    });

    return () => {
      // Cleanup
      renderers.forEach((renderer, index) => {
        if (renderer && containerRefs[index]) {
          renderer.current?.dispose();
          containerRefs[index]?.removeChild(renderer.domElement);
        }
      });
      controls.forEach((control, index) => {
        if (control) control.dispose();
      });
    };
  }, [containerRefs, renderers, scenes, cameras]);

  // Add models to scenes when they load
  useEffect(() => {
    models.forEach((model, index) => {
      if (model && scenes[index]) {
        // Clear existing meshes (except grid helper)
        scenes[index].traverse((object) => {
          if (object.isMesh && object.userData !== 'gridHelper') {
            scenes[index].remove(object);
          }
        });
        scenes[index].add(model);
      }
    });
  }, [models, scenes]);

  // Format number for display
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  // Get model URLs based on modelIds for display (simplified)
  const getModelUrls = useCallback((): { [key: string]: string } => {
    const urls: { [key: string]: string } = {};
    modelIds.forEach(modelId => {
      // In a real implementation, we would get the actual model URLs from job results or asset data
      // For now, we'll use a placeholder
      urls[modelId] = currentAsset && modelId === currentAsset.id ? 
        (currentAsset.artifacts?.gameReady || currentAsset.source?.viewUrl || currentAsset.source?.localUrl || 'Not available') : 
        'Not available';
    });
    return urls;
  }, [modelIds, currentAsset]);

  if (modelIds.length === 0) {
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center bg-[hsl(var(--surface-1))] px-4 text-center ${className}`}>
        <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-4">
          <HugeiconsIcon icon={Box} size={16} className="w-6 h-6" />
        </div>
        <div className="text-xs font-bold text-white">Select Models to Compare</div>
        <div className="text-[11px] text-zinc-400 mt-2">Select 2-3 models from the generation results to compare</div>
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
            <h3 className="font-bold text-sm text-white">{currentAsset?.name || 'Model Comparison'}</h3>
            <div className="text-xs text-zinc-400">Model Comparison Viewer</div>
          </div>
        </div>
        
        {/* Model Selector */}
        {showControls && modelIds.length > 1 && (
          <div className="relative">
            <button
              onClick={() => {
                // Simple model selection - in a real implementation, this would open a model picker
                const nextIndex = (selectedModelId ? modelIds.indexOf(selectedModelId) : -1) + 1;
                const nextModelId = modelIds[nextIndex >= modelIds.length ? 0 : nextIndex];
                setSelectedModelId(nextModelId);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.1] text-zinc-300 hover:bg-[hsl(var(--surface-3))] hover:text-white transition-all"
            >
              <span className="text-xs font-mono">
                {selectedModelId ? `Selected: ${selectedModelId.slice(-6)}` : 'Select Model'}
              </span>
              <HugeiconsIcon icon={ChevronDown} size={12} className="text-zinc-400" />
            </div>
          </div>
        )}
      </div>

      {/* Loading/Error State */}
      {isLoading && !models.some(m => m !== null) && (
        <div className="flex-1 flex items-center justify-center bg-[hsl(var(--surface-0))]">
          <div className="flex flex-col items-center gap-3">
            <HugeiconsIcon icon={LoaderCircle} size={20} className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-zinc-400">Loading models for comparison...</span>
          </div>
        </div>
      )}

      {error && !models.some(m => m !== null) && (
        <div className="flex-1 flex items-center justify-center bg-[hsl(var(--surface-0))]">
          <div className="flex flex-col items-center gap-3">
            <HugeiconsIcon icon={AlertCircle} size={20} className="w-6 h-6 text-rose-400" />
            <span className="text-xs text-zinc-400">{error}</span>
          </div>
        </div>
      )}

      {/* Model Comparison View */}
      {!isLoading && models.some(m => m !== null) && (
        <div className="flex-1 flex overflow-hidden">
          {/* Model Viewers */}
          <div className="flex-1">
            {models.map((model, index) => {
              const isSelected = selectedModelId === modelIds[index];
              
              return (
                <div key={modelIds[index]} className={`flex-1 ${isSelected ? 'border-2 border-primary' : 'border-none'} border-r border-white/[0.08] flex-1 min-w-0`}>
                  <div 
                    ref={(ref) => {
                      const containerRefsCopy = [...containerRefs];
                      containerRefsCopy[index] = ref;
                      setContainerRefs(containerRefsCopy);
                    }}
                    className="w-full h-full bg-[hsl(var(--surface-0))]"
                  />
                  <div className="absolute bottom-2 left-2 right-2 flex justify-between px-2">
                    <div className="flex gap-2 text-xs text-zinc-400">
                      <span className="font-medium">Model {index + 1}:</span>
                      <span>{modelIds[index].slice(-6)}</span>
                    </div>
                    <div className="flex gap-2 text-xs text-zinc-400">
                      {modelStats[index] && (
                        <>
                          <span className="font-mono">{formatNumber(modelStats[index].vertices)} vertices</span>
                          <span className="mx-2">|</span>
                          <span className="font-mono">{formatNumber(modelStats[index].faces)} faces</span>
                        </>
                      )}
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        Selected
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Statistics and Difference Metrics */}
      {(modelStats.some(s => s !== null) || models.some(m => m !== null)) && showControls && (
        <div className="px-4 py-3 border-t border-white/[0.08] bg-[hsl(var(--surface-1))]">
          <div className="space-y-3">
            {/* Statistics Comparison */}
            {modelIds.length > 1 && (
              <div className="grid grid-cols-{modelIds.length} gap-4">
                {modelIds.map((modelId, index) => (
                  <div key={modelId} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                      <span>Model {index + 1}</span>
                      <span>{modelId.slice(-6)}</span>
                    </div>
                    {modelStats[index] && (
                      <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Vertices:</span>
                          <span className="font-mono text-white">{formatNumber(modelStats[index].vertices)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Faces:</span>
                          <span className="font-mono text-white">{formatNumber(modelStats[index].faces)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Triangles:</span>
                          <span className="font-mono text-white">{formatNumber(modelStats[index].triangles)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* Difference Metrics (for 2 models) */}
            {modelIds.length === 2 && modelStats[0] && modelStats[1] && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span>Difference Metrics</span>
                  <span> (Model 1 → Model 2)</span>
                </div>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Vertex Count Δ:</span>
                    <span className="font-mono">
                      {modelStats[1].vertices >= modelStats[0].vertices ? '+' : ''}
                      {formatNumber(Math.abs(modelStats[1].vertices - modelStats[0].vertices))}
                      ({((modelStats[1].vertices - modelStats[0].vertices) / Math.max(modelStats[0].vertices, 1) * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Face Count Δ:</span>
                    <span className="font-mono">
                      {modelStats[1].faces >= modelStats[0].faces ? '+' : ''}
                      {formatNumber(Math.abs(modelStats[1].faces - modelStats[0].faces))}
                      ({((modelStats[1].faces - modelStats[0].faces) / Math.max(modelStats[0].faces, 1) * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Triangle Count Δ:</span>
                    <span className="font-mono">
                      {modelStats[1].triangles >= modelStats[0].triangles ? '+' : ''}
                      {formatNumber(Math.abs(modelStats[1].triangles - modelStats[0].triangles))}
                      ({((modelStats[1].triangles - modelStats[0].triangles) / Math.max(modelStats[0].triangles, 1) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Model Information */}
            <div className="border-t border-white/[0.08] pt-3">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span>Model Information</span>
              </div>
              <div className="text-xs space-y-1">
                {modelIds.map((modelId, index) => (
                  <div key={modelId} className="flex justify-between mb-1">
                    <span className="text-zinc-400">Model {index + 1}:</span>
                    <span className="font-mono text-wrap">
                      {getModelUrls()[modelId]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};