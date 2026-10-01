"use client";

import React, { useState, useEffect } from 'react';
import { useRuntimeOptions, useSystemSettings } from '@/hooks/useBackendData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/premium/Spinner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CpuIcon, SlidersHorizontalIcon, Box01Icon, SparklesIcon, ZapIcon, GaugeIcon, ListOrderedIcon } from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/useAppStore';

export function GenerationSection({ onSaveRegister }: { onSaveRegister?: (save: () => Promise<void>) => void }) {
  const { options, loading: optionsLoading, error: optionsError } = useRuntimeOptions();
  const { settings, loading: settingsLoading } = useSystemSettings();
  const batchGenerationEnabled = useAppStore((s) => s.batchGenerationEnabled);
  const setBatchGenerationEnabled = useAppStore((s) => s.setBatchGenerationEnabled);

  const [provider, setProvider] = useState<string>('');
  const [quality, setQuality] = useState<string>('high');
  const [outputFormat, setOutputFormat] = useState<string>('glb');
  const [resolution, setResolution] = useState<string>('1024');
  const [steps, setSteps] = useState<number>(30);
  const [lowVram, setLowVram] = useState<boolean>(false);
  const [batchEnabled, setBatchEnabled] = useState<boolean>(batchGenerationEnabled);
  const [saving, setSaving] = useState(false);

  // Register save function with parent for section-switch saving
  useEffect(() => {
    if (onSaveRegister) {
      onSaveRegister(async () => {
        if (!provider) return;
        try {
          localStorage.setItem('generationSettings', JSON.stringify({ provider, quality, outputFormat, resolution, steps, lowVram, batchEnabled }));
          localStorage.setItem('batchGenerationEnabled', JSON.stringify(batchEnabled));
          localStorage.setItem('lowVramMode', JSON.stringify(lowVram));
          await Promise.all([
            getApiClient().updateConfig({ render_quality: quality, output_format: outputFormat, resolution, low_vram: lowVram } as any),
            getApiClient().saveGenerationSettings({
              default_provider: provider,
              render_quality: quality,
              output_format: outputFormat,
              resolution,
              steps,
              low_vram: lowVram,
              batch_generation_enabled: batchEnabled,
            }),
          ]);
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
    // Load saved settings from backend first, fallback to localStorage
    const loadSettings = async () => {
      try {
        const backendGen = await getApiClient().getGenerationSettings();
        if (backendGen) {
          if (backendGen.default_provider) setProvider(backendGen.default_provider);
          if (backendGen.render_quality) setQuality(backendGen.render_quality);
          if (backendGen.output_format) setOutputFormat(backendGen.output_format);
          if (backendGen.resolution) setResolution(backendGen.resolution);
          if (backendGen.steps) setSteps(backendGen.steps);
          if (backendGen.low_vram !== undefined) setLowVram(backendGen.low_vram);
          if (backendGen.batch_generation_enabled !== undefined) {
            setBatchEnabled(backendGen.batch_generation_enabled);
            setBatchGenerationEnabled(backendGen.batch_generation_enabled);
          }
          return;
        }
      } catch { /* ignore */ }

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
        ? 'Workspace will now support queueing multiple text-to-3D prompts consecutively.'
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
        <h1 className="text-3xl font-bold tracking-tight">Generation Settings</h1>
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
          <CardDescription>Select the primary model engine for text-to-3D and image-to-3D generation.</CardDescription>
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
            <HugeiconsIcon icon={Box01Icon} size={16} className="w-5 h-5 text-primary" />
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
                  Target Provider Compatibility: {selectedModelObj?.label || provider || 'Default Model'}
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
            Allows the workspace to queue multiple text-to-3D prompts consecutively, showing a real-time progress queue indicator for the entire job set.
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
                When active, the prompt input bar in the 3D workspace enables multi-prompt entry, sequential rendering, and total set progress tracking.
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
        </CardContent>
      </Card>
    </div>
  );
}
