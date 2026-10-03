import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { getApiClient } from '@/services/apiClient';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  X,
  Download,
  Sliders,
  Sparkles,
  Layers,
  Upload,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Eye,
} from 'lucide-react';

interface MultiViewWorkspaceProps {
  onImageUploaded?: (file: File) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  activeModelObj?: any;
  setNoticeMessage: (msg: string | null) => void;
}

export const MultiViewWorkspace: React.FC<MultiViewWorkspaceProps> = ({
  fileInputRef,
  activeModelObj,
  setNoticeMessage,
}) => {
  const { generationSettings, setGenerationSettings } = useWorkspace();

  // Multi-View sub-tabs: 'generate' (Zero123++) vs 'upload' (Manual view sets)
  const [mvSubMode, setMvSubMode] = useState<'generate' | 'upload'>('generate');

  // Multi-view generation execution state
  const [isGeneratingMv, setIsGeneratingMv] = useState<boolean>(false);
  const [mvStepText, setMvStepText] = useState<string>('');
  const [mvProgress, setMvProgress] = useState<number>(0);
  const [mvError, setMvError] = useState<string | null>(null);

  // Advanced options drawer toggle
  const [showAdvancedDrawer, setShowAdvancedDrawer] = useState<boolean>(false);
  const [inferenceSteps, setInferenceSteps] = useState<number>(28);
  const [guidanceScale, setGuidanceScale] = useState<number>(4.0);
  const [seedMode, setSeedMode] = useState<'auto' | 'custom'>('auto');
  const [customSeed, setCustomSeed] = useState<number>(42);
  const [saveContactSheet, setSaveContactSheet] = useState<boolean>(true);
  const [bgRemoval, setBgRemoval] = useState<boolean>(false);
  const [genMasks, setGenMasks] = useState<boolean>(false);
  const [genNormals, setGenNormals] = useState<boolean>(false);
  const [includeManifest, setIncludeManifest] = useState<boolean>(true);

  // Zoom / Pan viewer modal state
  const [zoomViewerOpen, setZoomViewerOpen] = useState<boolean>(false);
  const [zoomIndex, setZoomIndex] = useState<number>(0);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Manual views upload state
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  const [manualViews, setManualViews] = useState<Array<{
    id: string;
    file?: File;
    previewUrl: string;
    label: string;
    azimuth?: number;
    elevation?: number;
  }>>([]);

  const isModelMultiviewCapable = Boolean(activeModelObj?.capabilities?.multiview);

  // Generated views from state
  const views = generationSettings.multiviewViews || [];
  const hasGeneratedViews = views.length > 0;
  const assetId = generationSettings.multiviewAssetId;

  // Poll job status until complete
  const pollMvJob = useCallback(async (jobId: string, assetStem: string) => {
    const api = getApiClient();
    const startTime = Date.now();
    const timeoutMs = 300000; // 5 minutes max

    const check = async () => {
      if (Date.now() - startTime > timeoutMs) {
        setIsGeneratingMv(false);
        setMvError('Multi-View generation timed out');
        return;
      }
      try {
        const jobStatus: any = await api.getJobStatus(jobId);
        const status = jobStatus?.status || jobStatus?.job?.status;
        const progress = jobStatus?.progress ?? jobStatus?.job?.progress ?? 0;
        const step = jobStatus?.step ?? jobStatus?.job?.step ?? 'Generating views...';

        setMvProgress(Math.min(100, Math.max(10, Math.round(progress * 100))));
        setMvStepText(step);

        if (status === 'completed' || status === 'COMPLETED') {
          setIsGeneratingMv(false);
          setMvProgress(100);
          setMvStepText('Views generated successfully');

          // Fetch generated asset details
          try {
            const rawResult = jobStatus?.result || jobStatus?.job?.result || {};
            const createdAssetId = rawResult?.asset_id || (rawResult?.asset_name
              ? `${rawResult.asset_name}_${jobId.slice(0, 8)}`
              : `${assetStem}_${jobId.slice(0, 8)}`);

            // Call GET /api/v1/multiview/{asset_id}
            const res = await fetch(`/api/v1/multiview/${createdAssetId}`);
            if (res.ok) {
              const data = await res.json();
              setGenerationSettings(prev => ({
                ...prev,
                multiviewAssetId: data.asset_id,
                multiviewViews: data.views,
                multiviewManifest: data.manifest,
                multiviewZipUrl: data.zip_url,
                multiviewStatus: 'ready',
              }));
            } else {
              // Direct view construction from results
              if (rawResult?.views) {
                const multiviewBaseUrl = `/static/models/meshes/${encodeURIComponent(createdAssetId)}/multiview`;
                setGenerationSettings(prev => ({
                  ...prev,
                  multiviewAssetId: rawResult.asset_id || createdAssetId,
                  multiviewViews: rawResult.views.map((view: any) => ({
                    ...view,
                    url: view.url || `${multiviewBaseUrl}/${view.file}`,
                  })),
                  multiviewManifest: rawResult.manifest,
                  multiviewZipUrl: `/api/v1/multiview/${encodeURIComponent(createdAssetId)}/zip`,
                  multiviewStatus: 'ready',
                }));
              }
            }
          } catch (e) {
            console.warn('Failed to retrieve multiview asset details:', e);
          }
          return;
        }

        if (status === 'failed' || status === 'FAILED' || status === 'error') {
          setIsGeneratingMv(false);
          const err = jobStatus?.error || jobStatus?.job?.error || 'Zero123++ generation failed';
          setMvError(String(err));
          return;
        }

        // Poll again after 1.5s
        setTimeout(check, 1500);
      } catch (err: any) {
        console.warn('Polling error:', err);
        setTimeout(check, 2500);
      }
    };

    setTimeout(check, 1000);
  }, [setGenerationSettings]);

  // Handle "Generate Views" action
  const handleGenerateViews = async () => {
    if (!generationSettings.image) {
      setNoticeMessage('Please upload or select a reference image first.');
      return;
    }

    setIsGeneratingMv(true);
    setMvError(null);
    setMvProgress(10);
    setMvStepText('Loading Zero123++ pipeline...');

    try {
      const activeSeed = seedMode === 'custom' ? customSeed : -1;
      const payload: any = {
        image_path: generationSettings.image.startsWith('blob:') ? undefined : generationSettings.image,
        image_file_id: generationSettings.imageFileId || undefined,
        image_base64: generationSettings.image.startsWith('data:') ? generationSettings.image : undefined,
        asset_name: generationSettings.imageName || 'reference',
        inference_steps: inferenceSteps,
        guidance_scale: guidanceScale,
        seed: activeSeed,
        background_removal: bgRemoval,
        generate_masks: genMasks,
        generate_normals: genNormals,
        save_contact_sheet: saveContactSheet,
        output_format: 'png',
        model_preference: 'zero123plus_v12_image_to_multiview',
      };

      const res = await fetch('/api/v1/multiview/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to submit Zero123++ generation request');
      }

      const data = await res.json();
      const jobId = data.job_id;
      setGenerationSettings(prev => ({
        ...prev,
        multiviewJobId: jobId,
        multiviewStatus: 'generating',
      }));

      // Begin polling
      pollMvJob(jobId, data.asset_name || 'reference');
    } catch (e: any) {
      setIsGeneratingMv(false);
      setMvError(e.message || 'Generation failed');
    }
  };

  // Handle ZIP export
  const handleExportZip = () => {
    if (!assetId && !generationSettings.multiviewZipUrl) {
      setNoticeMessage('No multi-view views are available for export yet.');
      return;
    }
    const zipUrl = generationSettings.multiviewZipUrl || `/api/v1/multiview/${assetId}/zip`;
    const safeStem = generationSettings.imageName?.replace(/\.[^/.]+$/, '') || 'multiview';
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `${safeStem}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Keyboard navigation for zoom viewer
  useEffect(() => {
    if (!zoomViewerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomViewerOpen(false);
      else if (e.key === 'ArrowLeft') setZoomIndex(prev => (prev > 0 ? prev - 1 : views.length - 1));
      else if (e.key === 'ArrowRight') setZoomIndex(prev => (prev < views.length - 1 ? prev + 1 : 0));
      else if (e.key === '+' || e.key === '=') setZoomScale(s => Math.min(4.0, s + 0.25));
      else if (e.key === '-') setZoomScale(s => Math.max(0.5, s - 0.25));
      else if (e.key === '0') { setZoomScale(1.0); setPanOffset({ x: 0, y: 0 }); }
      else if (e.key === '1') { setZoomScale(1.0); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomViewerOpen, views.length]);

  return (
    <div className="space-y-2.5">
      {/* Multi-View Sub-mode Toggle: Generate Views vs Upload Views */}
      <div className="flex items-center justify-between p-0.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <button
          type="button"
          onClick={() => setMvSubMode('generate')}
          className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            mvSubMode === 'generate'
              ? 'bg-primary text-black shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          <span>Generate Views (Zero123++)</span>
        </button>
        <button
          type="button"
          onClick={() => setMvSubMode('upload')}
          className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            mvSubMode === 'upload'
              ? 'bg-primary text-black shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Upload className="w-3 h-3" />
          <span>Upload View Set</span>
        </button>
      </div>

      {mvSubMode === 'generate' ? (
        <>
          {/* Reference Image Container (Reuses single-image seamlessly) */}
          <div className="rounded-lg border border-white/[0.08] bg-[hsl(var(--surface-1))]/50 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-zinc-300 flex items-center gap-1">
                <span>Single Reference Image</span>
                <span className="text-[9px] text-zinc-500 font-mono">(Automatic Reuse)</span>
              </span>
              {generationSettings.image && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[9px] text-primary hover:underline cursor-pointer flex items-center gap-0.5"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Replace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerationSettings(prev => ({ ...prev, image: null, imageName: undefined }))}
                    className="text-[9px] text-rose-400 hover:underline cursor-pointer flex items-center gap-0.5"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Clear</span>
                  </button>
                </div>
              )}
            </div>

            {generationSettings.image ? (
              <div className="relative h-24 rounded-md border border-white/[0.08] bg-black/40 overflow-hidden flex items-center justify-center">
                <img
                  src={generationSettings.image}
                  alt="Reference"
                  className="max-h-full max-w-full object-contain"
                />
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[8.5px] text-zinc-300 font-mono">
                  {generationSettings.imageName || 'reference.png'}
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="h-20 rounded-md border border-dashed border-white/[0.14] bg-[hsl(var(--surface-1))] hover:border-primary/50 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
              >
                <Upload className="w-4 h-4 text-zinc-400" />
                <span className="text-[10px] text-zinc-300 font-medium">Click to upload reference image</span>
                <span className="text-[8.5px] text-zinc-500">Square aspect recommended (≥ 320x320)</span>
              </div>
            )}
          </div>

          {/* Action Row: Generate Views & Options Drawer Toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateViews}
              disabled={isGeneratingMv || !generationSettings.image}
              className={`flex-1 h-8 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isGeneratingMv
                  ? 'bg-[hsl(var(--surface-2))] text-primary border border-primary/30'
                  : 'bg-primary text-black hover:bg-primary/90 shadow-md active:scale-95'
              }`}
            >
              {isGeneratingMv ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{mvStepText || 'Generating Views...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Views (Zero123++)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowAdvancedDrawer(!showAdvancedDrawer)}
              className={`h-8 px-2.5 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                showAdvancedDrawer
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-white/[0.1] bg-[hsl(var(--surface-1))] text-zinc-300 hover:text-white hover:border-white/20'
              }`}
              title="Advanced Multi-View Options"
            >
              <Sliders className="w-3 h-3" />
              <span>Options</span>
            </button>

            {hasGeneratedViews && (
              <button
                type="button"
                onClick={handleExportZip}
                className="h-8 px-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                title="Export Multi-View pack as ZIP"
              >
                <FileArchive className="w-3 h-3" />
                <span>Export ZIP</span>
              </button>
            )}
          </div>

          {/* Progress bar when generating */}
          {isGeneratingMv && (
            <div className="space-y-1 p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08]">
              <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400">
                <span>{mvStepText || 'Generating views...'}</span>
                <span className="text-primary font-bold">{mvProgress}%</span>
              </div>
              <div className="w-full bg-[hsl(var(--surface-0))] h-1.5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${mvProgress}%` }}
                  className="bg-primary h-full rounded-full transition-all"
                />
              </div>
            </div>
          )}

          {mvError && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{mvError}</span>
            </div>
          )}

          {/* Options Drawer */}
          <AnimatePresence>
            {showAdvancedDrawer && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg border border-white/[0.08] bg-[hsl(var(--surface-1))] p-2.5 space-y-2 text-[10px] overflow-hidden"
              >
                <div className="font-bold text-zinc-200 uppercase tracking-wider text-[9px] pb-1 border-b border-white/[0.06]">
                  Multi-View Generation Settings
                </div>

                {/* Steps */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Inference Steps:</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={15}
                      max={100}
                      value={inferenceSteps}
                      onChange={(e) => setInferenceSteps(Number(e.target.value))}
                      className="w-20 accent-primary"
                    />
                    <span className="font-mono text-primary font-bold">{inferenceSteps}</span>
                  </div>
                </div>

                {/* Guidance scale */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Guidance Scale (CFG):</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(Number(e.target.value))}
                      className="w-20 accent-primary"
                    />
                    <span className="font-mono text-primary font-bold">{guidanceScale.toFixed(1)}</span>
                  </div>
                </div>

                {/* Seed */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Seed:</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSeedMode(seedMode === 'auto' ? 'custom' : 'auto')}
                      className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border cursor-pointer ${
                        seedMode === 'auto'
                          ? 'bg-primary/20 text-primary border-primary/40'
                          : 'bg-white/[0.05] text-zinc-400 border-white/[0.08]'
                      }`}
                    >
                      {seedMode === 'auto' ? 'Auto' : 'Custom'}
                    </button>
                    {seedMode === 'custom' && (
                      <input
                        type="number"
                        value={customSeed}
                        onChange={(e) => setCustomSeed(Number(e.target.value))}
                        className="w-16 px-1 py-0.5 rounded bg-[hsl(var(--surface-2))] border border-white/[0.1] text-white font-mono text-[9px]"
                      />
                    )}
                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={saveContactSheet}
                      onChange={(e) => setSaveContactSheet(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <span className="text-zinc-300">Save 3x2 Contact Sheet</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={bgRemoval}
                      onChange={(e) => setBgRemoval(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <span className="text-zinc-300">Transparent Background (Input rembg)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={genMasks}
                      onChange={(e) => setGenMasks(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <span className="text-zinc-300">Generate View Alpha Masks</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={genNormals}
                      onChange={(e) => setGenNormals(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <div className="flex flex-col">
                      <span className="text-zinc-300">Generate View-Space Normals</span>
                      <span className="text-[8px] text-zinc-500 leading-tight">View-space camera normals (not tangent textures)</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeManifest}
                      onChange={(e) => setIncludeManifest(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <span className="text-zinc-300">Include manifest.json in export</span>
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 6-View Gallery Grid */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-zinc-300 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span>Multi-View Gallery (6 Novel Views)</span>
              </span>
              <span className="text-[9px] text-zinc-400 font-mono">
                {hasGeneratedViews ? `${views.length}/6 Ready` : 'Not generated'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {[
                { name: 'front_right_30', label: 'Front Right', azimuth: 30, elevation: 20 },
                { name: 'right_90', label: 'Right', azimuth: 90, elevation: -10 },
                { name: 'back_right_150', label: 'Back Right', azimuth: 150, elevation: 20 },
                { name: 'back_left_210', label: 'Back Left', azimuth: 210, elevation: -10 },
                { name: 'left_270', label: 'Left', azimuth: 270, elevation: 20 },
                { name: 'front_left_330', label: 'Front Left', azimuth: 330, elevation: -10 },
              ].map((slot, idx) => {
                const viewData = views.find(v => v.file?.includes(slot.name) || v.label?.toLowerCase() === slot.label.toLowerCase()) || views[idx];
                const imgUrl = viewData?.url;

                return (
                  <div
                    key={slot.name}
                    onClick={() => {
                      if (imgUrl) {
                        setZoomIndex(idx);
                        setZoomScale(1.0);
                        setPanOffset({ x: 0, y: 0 });
                        setZoomViewerOpen(true);
                      }
                    }}
                    className={`relative h-20 rounded-lg border flex flex-col items-center justify-center p-1 overflow-hidden transition-all group ${
                      imgUrl
                        ? 'border-primary/40 bg-[hsl(var(--surface-2))] shadow-sm cursor-pointer hover:border-primary'
                        : 'border-dashed border-white/[0.12] bg-[hsl(var(--surface-1))]/50'
                    }`}
                  >
                    {imgUrl ? (
                      <>
                        <img
                          src={imgUrl}
                          alt={slot.label}
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-1 text-[8.5px] text-white font-bold">
                          <Eye className="w-3 h-3 text-primary" />
                          <span>Inspect</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center space-y-0.5 text-zinc-500">
                        <Layers className="w-3.5 h-3.5 mx-auto opacity-40" />
                        <span className="text-[8px] block">{slot.label}</span>
                      </div>
                    )}

                    {/* View tag overlay */}
                    <div className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded text-[7px] font-bold bg-black/80 text-zinc-300">
                      {slot.label} ({slot.azimuth}°)
                    </div>

                    {/* Indicators */}
                    {viewData?.mask_url && (
                      <div className="absolute top-0.5 right-0.5 px-1 rounded text-[6.5px] font-bold bg-cyan-500/80 text-black">
                        MASK
                      </div>
                    )}
                    {viewData?.normal_url && (
                      <div className="absolute top-0.5 left-0.5 px-1 rounded text-[6.5px] font-bold bg-purple-500/80 text-white">
                        NORM
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Manual Multi-View Upload Mode */
        <div className="space-y-2">
          <input
            ref={manualFileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              const newViews = files.map((f, i) => ({
                id: `mv_${Date.now()}_${i}`,
                file: f,
                previewUrl: URL.createObjectURL(f),
                label: i === 0 ? 'Front' : i === 1 ? 'Right' : i === 2 ? 'Back' : i === 3 ? 'Left' : 'Unassigned',
              }));
              setManualViews(prev => [...prev, ...newViews]);
            }}
          />

          <div
            onClick={() => manualFileInputRef.current?.click()}
            className="h-24 rounded-lg border border-dashed border-white/[0.14] bg-[hsl(var(--surface-1))]/50 hover:border-primary/50 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors p-2 text-center"
          >
            <Upload className="w-5 h-5 text-zinc-400" />
            <div className="text-[10px] text-zinc-200 font-bold">Upload Custom View Set</div>
            <div className="text-[8.5px] text-zinc-500">Select 2 to 6 viewpoint photos (JPG, PNG, WEBP)</div>
          </div>

          {manualViews.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-300 font-semibold">{manualViews.length} Views Loaded</span>
                <button
                  type="button"
                  onClick={() => setManualViews([])}
                  className="text-rose-400 hover:underline text-[9px] cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {manualViews.map((mv, idx) => (
                  <div
                    key={mv.id}
                    className="relative h-20 rounded-lg border border-white/[0.1] bg-black/40 p-1 flex flex-col items-center justify-center overflow-hidden group"
                  >
                    <img src={mv.previewUrl} alt={mv.label} className="w-full h-full object-contain" />
                    <button
                      type="button"
                      onClick={() => setManualViews(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 hover:bg-rose-600 text-white cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                    <select
                      value={mv.label}
                      onChange={(e) => {
                        const nextLabel = e.target.value;
                        setManualViews(prev => prev.map((item, i) => i === idx ? { ...item, label: nextLabel } : item));
                      }}
                      className="absolute bottom-0.5 left-0.5 right-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-black/80 text-zinc-200 border-none outline-none"
                    >
                      <option value="Front">Front</option>
                      <option value="Right">Right</option>
                      <option value="Back">Back</option>
                      <option value="Left">Left</option>
                      <option value="Front Right">Front Right</option>
                      <option value="Front Left">Front Left</option>
                      <option value="Unassigned">Unassigned</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Capability Gate Status Indicator for Selected 3D Model */}
      <div className="p-2 rounded-lg border bg-[hsl(var(--surface-0))] flex items-center justify-between text-[10px]">
        <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
          <span>3D Engine Capability:</span>
        </span>
        {isModelMultiviewCapable ? (
          <span className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[9px]">
            <CheckCircle2 className="w-3 h-3" />
            <span>Multi-View Ready</span>
          </span>
        ) : (
          <SimpleTooltip label="The active 3D model does not support multi-view reconstruction. Multi-view generation & ZIP export are fully available, but Generate 3D requires a multi-view enabled model.">
            <span className="flex items-center gap-1 text-amber-400 font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full text-[9px] cursor-help">
              <AlertTriangle className="w-3 h-3" />
              <span>Single-Image 3D Only</span>
            </span>
          </SimpleTooltip>
        )}
      </div>

      {/* Image Zoom / Pan Viewer Modal */}
      <AnimatePresence>
        {zoomViewerOpen && views[zoomIndex] && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4">
            {/* Top Bar */}
            <div className="w-full flex items-center justify-between text-white text-xs border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-primary">{views[zoomIndex].label}</span>
                <span className="text-zinc-400 font-mono">
                  {views[zoomIndex].azimuth_deg !== undefined ? `${views[zoomIndex].azimuth_deg}° Azimuth` : ''}
                  {views[zoomIndex].elevation_deg !== undefined ? ` • ${views[zoomIndex].elevation_deg}° Elevation` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setZoomScale(s => Math.min(4.0, s + 0.25))}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  title="Zoom In (+)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomScale(s => Math.max(0.5, s - 0.25))}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  title="Zoom Out (-)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => { setZoomScale(1.0); setPanOffset({ x: 0, y: 0 }); }}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer text-[10px] font-bold"
                  title="Fit to Screen (0)"
                >
                  Fit
                </button>
                <button
                  type="button"
                  onClick={() => setZoomViewerOpen(false)}
                  className="p-1 rounded bg-white/10 hover:bg-rose-600 text-white cursor-pointer ml-2"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Central Zoom & Pan Canvas */}
            <div
              className="relative flex-1 w-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
              onMouseDown={(e) => {
                setIsPanning(true);
                panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
              }}
              onMouseMove={(e) => {
                if (isPanning) {
                  setPanOffset({
                    x: e.clientX - panStartRef.current.x,
                    y: e.clientY - panStartRef.current.y,
                  });
                }
              }}
              onMouseUp={() => setIsPanning(false)}
              onMouseLeave={() => setIsPanning(false)}
            >
              <img
                src={views[zoomIndex].url}
                alt={views[zoomIndex].label}
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                  transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                }}
                className="max-h-[80vh] max-w-[85vw] object-contain pointer-events-none drop-shadow-2xl"
              />
            </div>

            {/* Bottom Navigation */}
            <div className="w-full flex items-center justify-between text-zinc-400 text-xs border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => setZoomIndex(prev => (prev > 0 ? prev - 1 : views.length - 1))}
                className="flex items-center gap-1 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer text-[11px]"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous View (←)</span>
              </button>

              <span className="font-mono text-[11px] text-zinc-300">
                View {zoomIndex + 1} of {views.length}
              </span>

              <button
                type="button"
                onClick={() => setZoomIndex(prev => (prev < views.length - 1 ? prev + 1 : 0))}
                className="flex items-center gap-1 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer text-[11px]"
              >
                <span>Next View (→)</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
