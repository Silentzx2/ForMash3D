"use client";

import React, { useState, useEffect } from 'react';
import { useRuntimeOptions, useSystemSettings } from '@/hooks/useBackendData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/premium/Spinner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CpuIcon, SlidersHorizontalIcon, BoxIcon, SparklesIcon, ZapIcon, GaugeIcon, GaugeIcon, ListOrderedIcon } from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/useAppStore';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';

export function GenerationSection({ onSaveRegister }: { onSaveRegister?: (save: () => Promise<void>) => void }) {
   const { options, loading: optionsLoading, error: optionsError } = useRuntimeOptions();
   const { settings, loading: settingsLoading } = useSystemSettings();
   const batchGenerationEnabled = useAppStore((s) => s.batchGenerationEnabled);
   const setBatchGenerationEnabled = useAppStore((s) => s.setBatchGenerationEnabled);
   const { processBatchQueue, cancelBatchProcessing, retryFailedBatchItems } = useWorkspace();

  const [provider, setProvider] = useState<string>('');
  const [quality, setQuality] = useState<string>('high');
  const [outputFormat, setOutputFormat] = useState<string>('glb');
  const [resolution, setResolution] = useState<string>('1024');
  const [steps, setSteps] = useState<number>(30);
  const [lowVram, setLowVram] = useState<boolean>(false);
  const [batchEnabled, setBatchEnabled] = useState<boolean>(batchGenerationEnabled);
   const [saving, setSaving] = useState(false);
   const [presets, setPresets] = useState<Array<{id: string; name: string; settings: any}>>([]);
   const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
   const [presetNameInput, setPresetNameInput] = useState('');
   const [showPresetManager, setShowPresetManager] = useState(false);

   // Load user presets from localStorage
   useEffect(() => {
     try {
       const savedPresets = localStorage.getItem('userPresets');
       if (savedPresets) {
         setPresets(JSON.parse(savedPresets));
       }
     } catch (err) {
       console.warn('Failed to load user presets from localStorage:', err);
       setPresets([]);
     }
   }, []);
   
   // Save user presets to localStorage when they change
   useEffect(() => {
     try {
       localStorage.setItem('userPresets', JSON.stringify(presets));
     } catch (err) {
       console.warn('Failed to save user presets to localStorage:', err);
     }
   }, [presets]);

   // Save current settings as a new preset
   const handleSavePreset = () => {
     if (!presetNameInput.trim()) {
       toast.error('Please enter a preset name');
       return;
     }
     
     // Check if preset with this name already exists
     const exists = presets.some(p => 
       p.name.toLowerCase() === presetNameInput.trim().toLowerCase() && 
       p.id !== selectedPresetId
     );
     
     if (exists) {
       toast.error('A preset with this name already exists');
       return;
     }
     
     // Create settings object from current values
     const settings = {
       provider,
       quality,
       outputFormat,
       resolution,
       steps,
       lowVram,
       batchEnabled
     };
     
     const newPreset: {id: string; name: string; settings: any} = {
       id: presetNameInput.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
       name: presetNameInput.trim(),
       settings
     };
     
     setPresets(prev => [...prev, newPreset]);
     setSelectedPresetId(newPreset.id);
     setPresetNameInput('');
     toast.success('Preset saved successfully');
   };
   
   // Load selected preset
   const handleLoadPreset = () => {
     const preset = presets.find(p => p.id === selectedPresetId);
     if (!preset) return;
     
     try {
       // Apply preset settings
       setProvider(preset.settings.provider);
       setQuality(preset.settings.quality);
       setOutputFormat(preset.settings.outputFormat);
       setResolution(preset.settings.resolution);
       setSteps(preset.settings.steps);
       setLowVram(preset.settings.lowVram);
       setBatchGenerationEnabled(preset.settings.batchEnabled);
       
       toast.success(`Preset '${preset.name}' loaded successfully`);
     } catch (err) {
       console.error('Failed to load preset:', err);
       toast.error('Failed to load preset');
     }
   };
   
   // Delete selected preset
   const handleDeletePreset = () => {
     if (!selectedPresetId) return;
     
     setPresets(prev => prev.filter(p => p.id !== selectedPresetId));
     setSelectedPresetId(null);
     setPresetNameInput('');
     toast.success('Preset deleted successfully');
   };
   
   // Rename selected preset
   const handleRenamePreset = () => {
     if (!selectedPresetId || !presetNameInput.trim()) {
       toast.error('Please enter a new name');
       return;
     }
     
     // Check if preset with this name already exists
     const exists = presets.some(p => 
       p.name.toLowerCase() === presetNameInput.trim().toLowerCase() && 
       p.id !== selectedPresetId
     );
     
     if (exists) {
       toast.error('A preset with this name already exists');
       return;
     }
     
     setPresets(prev => prev.map(p => 
       p.id === selectedPresetId 
         ? {...p, name: presetNameInput.trim()} 
         : p
     ));
     setSelectedPresetId(prev => prev === selectedPresetId ? 
       presetNameInput.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') 
       : prev);
     setPresetNameInput('');
     toast.success('Preset renamed successfully');
   };
   
   // Reset to built-in defaults
   const handleResetToDefault = () => {
     // These would be the default values - in a real app these might come from backend config
     setProvider(options?.three_d_models?.[0]?.id || options?.providers?.[0]?.id || '');
     setQuality('high');
     setOutputFormat('glb');
     setResolution('1024');
     setSteps(30);
     setLowVram(false);
     setBatchGenerationEnabled(false);
     
     setSelectedPresetId(null);
     setPresetNameInput('');
     toast.success('Reset to default settings');
   };

  // Register save function with parent for section-switch saving
  useEffect(() => {
    if (onSaveRegister) {
      onSaveRegister(async () => {
        if (!provider) return;
        try {
          localStorage.setItem('generationSettings', JSON.stringify({ provider, quality, outputFormat, resolution, steps, lowVram, batchEnabled }));
          localStorage.setItem('batchGenerationEnabled', JSON.stringify(batchEnabled));
          localStorage.setItem('lowVramMode', JSON.stringify(lowVram));
          await getApiClient().updateConfig({ render_quality: quality, output_format: outputFormat, resolution, low_vram: lowVram } as any);
        } catch { /* ignore */ }
      });
    }
  }, [onSaveRegister, provider, quality, outputFormat, resolution, steps, lowVram, batchEnabled]);

  const rawList = options?.three_d_models || options?.providers || [
    { id: 'hunyuan3d-2.1', label: 'Hunyuan3D 2.1' },
    { id: 'trellis', label: 'Trellis' },
  ];
  const providersList = rawList;

  const selectedModelObj = providersList.find((p: any) => (p.id || p.name) === provider);

  useEffect(() => {
    // Load saved settings from localStorage
    const loadSettings = async () => {
      const savedGen = localStorage.getItem('generationSettings');
      const savedBatch = localStorage.getItem('batchGenerationEnabled');
      const savedLowVram = localStorage.getItem('lowVramMode');

      if (savedLowVram !== null) {
        setLowVram(JSON.parse(savedLowVram));
      }
      if (savedBatch !== null) {
        const isBatch = JSON.parse(savedBatch);
        setBatchEnabled(isBatch);
        setBatchGenerationEnabled(isBatch);
      }
      if (savedGen) {
        try {
          const parsed = JSON.parse(savedGen);
          if (parsed.provider) setProvider(parsed.provider);
          if (parsed.quality) setQuality(parsed.quality);
          if (parsed.outputFormat) setOutputFormat(parsed.outputFormat);
          if (parsed.resolution) setResolution(parsed.resolution);
          if (parsed.steps) setSteps(parsed.steps);
          if (parsed.lowVram !== undefined) setLowVram(parsed.lowVram);
          if (parsed.batchEnabled !== undefined) {
            setBatchEnabled(parsed.batchEnabled);
            setBatchGenerationEnabled(parsed.batchEnabled);
          }
        } catch { /* ignore */ }
      } else if (settings?.default_provider || options?.active_provider) {
        setProvider(settings?.default_provider || options?.active_provider || '');
      }
    };

    void loadSettings();
  }, [settings, options, setBatchGenerationEnabled]);

  const handleToggleBatch = (val: boolean) => {
    setBatchEnabled(val);
    setBatchGenerationEnabled(val);
    localStorage.setItem('batchGenerationEnabled', JSON.stringify(val));
    toast.success(val ? 'Batch Generation Enabled' : 'Batch Generation Disabled', {
      description: val
        ? 'Workspace will now support queueing multiple 3D generation jobs consecutively.'
        : 'Workspace standard single-generation mode active.'
    });
  };

  const handleToggleLowVram = (val: boolean) => {
    setLowVram(val);
    localStorage.setItem('lowVramMode', JSON.stringify(val));
    toast.success(val ? 'Low VRAM Mode Enabled' : 'Low VRAM Mode Disabled', {
      description: val
        ? 'Sequential offloading & half-precision chunking enabled for memory-constrained GPUs (<8GB VRAM).'
        : 'Standard full VRAM performance pipeline active.'
    });
  };

  if (optionsLoading || settingsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Generation SettingsIcon</h1>
        <p className="text-muted-foreground mt-2">
          Configure default AI models, output formats, and generation parameters.
        </p>
      </div>

      {/* AI Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={CpuIcon} size={16} className="w-5 h-5 text-primary" />
            Default 3D Model Provider
          </CardTitle>
          <CardDescription>Select the primary model engine for image-to-3D generation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            value={provider || (providersList[0]?.id || '')}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {providersList.map((p: any) => (
              <option key={p.id || p.name} value={p.id || p.name}>
                {p.label || p.name || p.id} {p.vram_required_mb ? `(${Math.round(p.vram_required_mb / 1024)}GB VRAM)` : ''}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Output Format & Quality */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={BoxIcon} size={16} className="w-5 h-5 text-primary" />
            Output Format & Quality
          </CardTitle>
          <CardDescription>Specify standard 3D export file formats and render target resolution.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Export Mesh Format</label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground"
            >
              <option value="glb">GLB (Binary glTF - Web / Three.js)</option>
              <option value="gltf">GLTF (glTF JSON - Open Standard)</option>
              <option value="fbx">FBX (Autodesk - Unreal / Unity / Maya)</option>
              <option value="obj">OBJ + MTL (Wavefront - Legacy 3D Editors)</option>
              <option value="stl">STL (Stereolithography - 3D Printing / CAD)</option>
              <option value="ply">PLY (Polygon File Format)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Texture Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground"
            >
              <option value="512">512 x 512 (Fast Preview)</option>
              <option value="1024">1024 x 1024 (Standard HD)</option>
              <option value="2048">2048 x 2048 (Ultra High Detail)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Sampling Steps & Preset */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-5 h-5 text-emerald-400" />
            Inference & Sampling Parameters
          </CardTitle>
          <CardDescription>Control quality vs speed trade-offs during diffusion generation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Inference Steps: {steps}</label>
              <span className="text-xs text-muted-foreground">Higher = Higher fidelity (longer render time)</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
               className="w-full accent-primary"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-3 block">Quality Preset</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['low', 'medium', 'high', 'ultra'].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`px-4 py-2.5 rounded-lg border text-sm font-medium capitalize transition-all ${
                    quality === q
                       ? 'bg-primary text-primary-foreground border-primary font-bold shadow-md'
                      : 'bg-background border-input hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Low VRAM Mode Card — Conditionally shown: hidden if selected model does not support low VRAM */}
      {selectedModelObj?.low_vram_supported && (
        <Card className="border-[hsl(var(--border))] bg-[hsl(var(--surface-1))]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <HugeiconsIcon icon={GaugeIcon} size={16} className="w-5 h-5 text-primary" />
                Low VRAM Execution Mode (&lt;8GB GPUs)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Switch
                  checked={lowVram}
                  onCheckedChange={(checked) => handleToggleLowVram(checked)}
                />
              </div>
            </div>
            <CardDescription>
              Enables model-layer sequential offloading to CPU memory, tile-based attention, and float16/bf16 quantization for consumer GPUs with &lt;8GB VRAM (e.g. RTX 3050, RTX 3060 6GB, GTX 1660, Apple Silicon).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4 text-primary" />
                  TargetIcon Provider Compatibility: {selectedModelObj?.label || provider || 'Default Model'}
                </span>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Supported by {selectedModelObj.label} with memory requirement of {selectedModelObj.low_vram_required_mb ? Math.round(selectedModelObj.low_vram_required_mb / 1024) : 4}GB.
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap self-start sm:self-auto ${
                lowVram
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
              }`}>
                {lowVram ? 'Low VRAM Active' : 'Full VRAM Mode'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

       {/* Batch Generation Mode Card */}
       <Card className="border-[hsl(var(--border))] bg-[hsl(var(--surface-1))]">
         <CardHeader>
           <div className="flex items-center justify-between">
             <CardTitle className="flex items-center gap-2 text-base font-semibold">
               <HugeiconsIcon icon={ListOrderedIcon} size={16} className="w-5 h-5 text-primary" />
               Batch Generation &amp; Queue Pipelining
             </CardTitle>
             <div className="flex items-center gap-2">
               <Switch
                 checked={batchEnabled}
                 onCheckedChange={(checked) => handleToggleBatch(checked)}
               />
             </div>
           </div>
           <CardDescription>
             Allows the workspace to queue multiple 3D generation jobs consecutively, showing a real-time progress queue indicator for the entire job set.
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-4">
           <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
             <div className="space-y-1">
               <span className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                 <HugeiconsIcon icon={ZapIcon} size={16} className="w-4 h-4 text-primary" />
                 Consecutive Job Queueing
               </span>
               <p className="text-xs text-[hsl(var(--muted-foreground))]">
                 When active, the 3D workspace can queue multiple generation jobs and track total set progress.
               </p>
             </div>
             <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap self-start sm:self-auto ${
               batchEnabled
                 ? 'bg-primary/15 text-primary border border-primary/30'
                 : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
             }`}>
               {batchEnabled ? 'Active in Workspace' : 'Standard Mode'}
             </span>
           </div>
           <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
             <div className="flex items-center justify-between">
               <button
                 onClick={async () => {
                   try {
                     await processBatchQueue();
                   } catch (err) {
                     console.error('Failed to process batch queue:', err);
                     toast.error('Failed to start batch processing');
                   }
                 }}
                 disabled={!batchEnabled}
                 className="w-full px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 Process Batch Queue
               </button>
               <span className="text-xs font-medium text-[hsl(var(--foreground))]">
                 {batchEnabled ? 'Click to process queued items' : 'Enable batch generation first'}
               </span>
             </div>
             <div className="flex items-center justify-between mt-2">
               <button
                 onClick={async () => {
                   try {
                     await cancelBatchProcessing();
                   } catch (err) {
                     console.error('Failed to cancel batch processing:', err);
                     toast.error('Failed to cancel batch processing');
                   }
                 }}
                 disabled={!batchEnabled}
                 className="w-full px-4 py-2 rounded-lg bg-[hsl(var(--destructive))] text-white font-medium hover:bg-[hsl(var(--destructive))]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 Cancel Batch Processing
               </button>
               <span className="text-xs font-medium text-[hsl(var(--foreground))]">
                 {batchEnabled ? 'Click to cancel batch processing' : 'Enable batch generation first'}
               </span>
             </div>
             <div className="flex items-center justify-between mt-2">
               <button
                 onClick={async () => {
                   try {
                     await retryFailedBatchItems();
                   } catch (err) {
                     console.error('Failed to retry failed batch items:', err);
                     toast.error('Failed to retry failed batch items');
                   }
                 }}
                 disabled={!batchEnabled}
                 className="w-full px-4 py-2 rounded-lg bg-[hsl(var(--warning))] text-white font-medium hover:bg-[hsl(var(--warning))]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 Retry Failed Items
               </button>
               <span className="text-xs font-medium text-[hsl(var(--foreground))]">
                 {batchEnabled ? 'Click to retry failed items' : 'Enable batch generation first'}
               </span>
             </div>
           </div>
         </CardContent>
       </Card>
     </div>
   
     {/* Preset Management */}
     <div className="space-y-6">
       <div className="flex items-center justify-between">
         <h2 className="text-2xl font-bold tracking-tight">Generation Presets</h2>
         <div className="flex items-center gap-2">
           <button
             onClick={() => setShowPresetManager(true)}
             className="px-3 py-1 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-all"
           >
             Manage Presets
           </button>
           <button
             onClick={handleResetToDefault}
             className="px-3 py-1 rounded-lg text-sm font-medium bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/80 transition-all"
           >
             Reset to Defaults
           </button>
         </div>
       </div>
   
       {/* Current Settings Display */}
       <div className="bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] rounded-xl p-4">
         <div className="space-y-4">
           <div className="flex items-center justify-between">
             <span className="text-sm font-medium text-[hsl(var(--mixed-foreground))]">Current Settings</span>
             <button
               onClick={handleSavePreset}
               disabled={!presetNameInput.trim()}
               className="px-2 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-50"
             >
               Save as Preset
               {saving && <HugeiconsIcon icon={LoaderCircle} size={10} className="animate-spin" />}
             </button>
           </div>
           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
               <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Preset Name</label>
               <input
                 value={presetNameInput}
                 onChange={(e) => setPresetNameInput(e.target.value)}
                 placeholder="Enter preset name..."
                 className="w-full bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-all"
               />
             </div>
             <div className="space-y-2">
               <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Quick Apply</label>
               <div className="flex flex-wrap gap-2">
                 {[
                   {label: 'Default', id: 'default'},
                   ...presets.map(p => ({label: p.name, id: p.id}))
                 ].map(({label, id}) => (
                   <button
                     key={id}
                     onClick={() => {
                       if (id === 'default') {
                         handleResetToDefault();
                       } else {
                         setSelectedPresetId(id);
                         handleLoadPreset();
                       }
                     }}
                     className={`px-2 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]/80 transition-all ${
                       selectedPresetId === id ? 'bg-primary text-white' : ''
                     }`}
                   >
                     {label}
                   </button>
                 ))}
               </div>
             </div>
           </div>
         </div>
       </div>
   
       {/* Preset Manager Modal */}
       {showPresetManager && (
         <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="w-full max-w-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] rounded-2xl p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
             <div className="flex items-center justify-between border-b border-[hsl(var(--border)/0.5)] pb-3">
               <div className="flex items-center gap-2">
                 <HugeiconsIcon icon={FileCodeIcon} size={16} className="text-[hsl(var(--primary))]" />
                 <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">Preset Manager</h3>
               </div>
               <button
                 onClick={() => setShowPresetManager(false)}
                 className="p-1 rounded-lg hover:bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]"
               >
                 ✕
               </button>
             </div>
   
             {/* Preset List */}
             <div className="space-y-4">
               <div className="space-y-2">
                 <label className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Your Presets</label>
                 <p className="text-[hsl(var(--muted-foreground))]">
                   {presets.length === 0 ? 'No presets saved yet' : `${presets.length} preset${presets.length === 1 ? '' : 's'} saved`}
                 </p>
               </div>
   
               {presets.length > 0 ? (
                 <div className="space-y-2">
                   <div className="bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl p-4">
                     {presets.map((preset) => (
                       <div key={preset.id} className="flex items-center justify-between px-3 py-2 bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))]/50 rounded-lg transition-all cursor-pointer">
                         <div className="flex items-center gap-3">
                           <div className="flex items-center gap-2">
                             {selectedPresetId === preset.id && (
                               <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} className="text-primary" />
                             )}
                             <span className="font-medium">{preset.name}</span>
                           </div>
                           <div className="text-[hsl(var(--muted-foreground))] text-xs">
                             {new Date().toLocaleString()} {/* In a real app, we'd store the timestamp when saved */}
                           </div>
                         </div>
                         <div className="flex items-center gap-2">
                           <button
                             onClick={() => {
                               setSelectedPresetId(preset.id);
                               setPresetNameInput(preset.name);
                               setShowPresetManager(false);
                               handleLoadPreset();
                             }}
                             className="px-2 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-all"
                           >
                             Load
                           </button>
                           <button
                             onClick={() => {
                               setSelectedPresetId(preset.id);
                               setPresetNameInput(preset.name);
                               setShowPresetManager(false);
                             }}
                             className="px-2 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--warning))] text-white hover:bg-[hsl(var(--warning))]/90 transition-all"
                           >
                             Edit
                           </button>
                           <button
                             onClick={() => {
                               setSelectedPresetId(preset.id);
                               handleDeletePreset();
                             }}
                             className="px-2 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90 transition-all"
                           >
                             Delete
                           </button>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
               ) : (
                 <div className="text-[hsl(var(--muted-foreground))] text-center py-4">
                   No presets saved yet. Create your first preset above!
                 </div>
               )}
             </div>
           </div>
   
             {/* Preset Editor */}
             {selectedPresetId && (
               <div className="mt-6">
                 <div className="space-y-4">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <HugeiconsIcon icon={FileCodeIcon} size={16} className="text-[hsl(var(--primary))]" />
                       <h4 className="text-sm font-bold text-[hsl(var(--foreground))]">Edit Preset</h4>
                     </div>
                     <button
                       onClick={() => {
                         setSelectedPresetId(null);
                         setPresetNameInput('');
                         setShowPresetManager(false);
                       }}
                       className="p-1 rounded-lg hover:bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))]"
                     >
                       ✕
                     </div>
                   </div>
   
                   <div className="space-y-2">
                     <label className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Preset Name</label>
                     <input
                       value={presetNameInput}
                       onChange={(e) => setPresetNameInput(e.target.value)}
                       placeholder="Enter preset name..."
                       className="w-full bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-all"
                     />
                   </div>
   
                   <div className="flex items-center justify-between">
                     <span className="text-[hsl(var(--muted-foreground))] font-medium">Changes will be saved when you edit the name</span>
                     <div className="flex items-center gap-2">
                       <button
                         onClick={handleRenamePreset}
                         disabled={!presetNameInput.trim()}
                         className="px-2 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-50"
                       >
                         Save Changes
                       </button>
                       <button
                         onClick={() => {
                           setSelectedPresetId(null);
                           setPresetNameInput('');
                           setShowPresetManager(false);
                         }}
                         className="px-2 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-2))]/80 transition-all"
                       >
                         Cancel
                       </button>
                     </div>
                   </div>
                 </div>
               </div>
             )}
           </div>
         </div>
       )}
     </div>
   );
 
