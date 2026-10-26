import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  SparklesIcon,
  UploadIcon,
} from '@hugeicons/core-free-icons';
import type { GenerationSettings } from '../../types';

export interface SamplePreset {
  id: string;
  name: string;
  url: string;
}

export interface PromptAndImageDropzoneProps {
  generationSettings: GenerationSettings;
  setGenerationSettings: React.Dispatch<React.SetStateAction<GenerationSettings>>;
  uploadStatus: 'idle' | 'uploading' | 'verifying' | 'saved' | 'error';
  uploadError: string | null;
  uploadProgress: { percent: number };
  processImageFiles: (files: File[]) => Promise<void>;
  onClearImage: () => void;
  approvalStatus: 'approved' | 'needs_review' | 'failed' | null;
  approvalWarning: string | null;
  approvalValidation: unknown;
  approvalAcknowledged: boolean;
  setApprovalAcknowledged: (val: boolean) => void;
  sampleLoading: boolean;
  onSelectSample: (preset: SamplePreset) => Promise<void>;
  samplePresets: SamplePreset[];
  previewEnhancement: () => Promise<void>;
  disableEnhancement: () => void;
  enhancementLoading: boolean;
  enhancementError: string | null;
  navigateToTool: (tool: any) => void;
  formatValidationDetails: (validation: unknown) => string | null;
}

export const PromptAndImageDropzone: React.FC<PromptAndImageDropzoneProps> = React.memo(({
  generationSettings,
  setGenerationSettings,
  uploadStatus,
  uploadError,
  uploadProgress,
  processImageFiles,
  onClearImage,
  approvalStatus,
  approvalWarning,
  approvalValidation,
  approvalAcknowledged,
  setApprovalAcknowledged,
  sampleLoading,
  onSelectSample,
  samplePresets,
  previewEnhancement,
  disableEnhancement,
  enhancementLoading,
  enhancementError,
  navigateToTool,
  formatValidationDetails,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    void processImageFiles([files[0]]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || []);
    if (files.length > 0) void processImageFiles([files[0]]);
  };

  const preprocessingApprovalStatus = generationSettings.preprocessingMetadata?.approval_status ?? null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1D1F26] p-3 space-y-3">
      {/* Hidden File Input (Strictly Single Image) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
        multiple={false}
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header Badge */}
      <div className="flex items-center justify-between h-5 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-zinc-300 font-bold text-[10.5px] uppercase tracking-wider">
          <HugeiconsIcon icon={ImageIcon} size={15} className="text-[#F5C542]" />
          <span>Reference Image</span>
        </div>
        <span className="text-[9px] font-mono text-zinc-400">
          JPG · PNG · WEBP ≤ 20MB
        </span>
      </div>

      {/* Fixed aspect ratio dropzone container (CLS Guarded) with #16171B drop target */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        animate={{
          scale: isDragOver ? 1.01 : 1,
          borderColor: isDragOver ? '#F5C542' : uploadError ? '#ef4444' : 'rgba(255,255,255,0.08)',
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="relative w-full h-36 rounded-xl border border-dashed border-white/[0.12] cursor-pointer overflow-hidden flex flex-col items-center justify-center p-2 group/dropzone bg-[#16171B] hover:border-[#F5C542]/50 transition-colors"
      >
        {uploadStatus === 'uploading' || uploadStatus === 'verifying' ? (
          <div className="text-center space-y-1.5 w-full px-4 z-10">
            <HugeiconsIcon
              icon={LoaderCircle}
              size={20}
              className="mx-auto animate-spin text-[#F5C542]"
            />
            <div className="font-bold text-xs text-white">
              {uploadStatus === 'verifying' ? 'Verifying upload...' : 'Uploading reference image...'}
            </div>
            <div className="w-full bg-[#272930] rounded-full h-1.5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress.percent}%` }}
                className="bg-[#F5C542] h-full rounded-full"
              />
            </div>
          </div>
        ) : generationSettings.image ? (
          <div className="relative w-full h-full group z-10 flex items-center justify-center">
            <img
              src={generationSettings.image}
              alt="Source reference"
              className="w-full h-full object-contain"
            />
            {/* Clear Image Overlay Button */}
            <button
              type="button"
              title="Clear Image"
              onClick={(e) => {
                e.stopPropagation();
                onClearImage();
              }}
              className="absolute top-1.5 right-1.5 bg-black/80 hover:bg-black text-zinc-300 hover:text-rose-400 border border-white/20 p-1 rounded-md text-[10px] font-bold flex items-center justify-center cursor-pointer z-20 transition-all opacity-80 group-hover:opacity-100 shadow-md"
            >
              <HugeiconsIcon icon={Cancel} size={13} />
            </button>
            {/* Replace Image Overlay Button */}
            <button
              type="button"
              title="Replace Image"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="absolute bottom-1.5 right-1.5 bg-black/80 hover:bg-black border border-white/20 text-[#F5C542] hover:text-[#FFE066] px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer z-20 transition-all opacity-80 group-hover:opacity-100 shadow-md"
            >
              <HugeiconsIcon icon={RefreshCw} size={12} />
              <span>Replace</span>
            </button>
          </div>
        ) : (
          <div className="text-center space-y-1.5 z-10">
            <div
              className={`w-9 h-9 mx-auto rounded-full bg-[#242732] border border-white/[0.08] flex items-center justify-center transition-all ${
                isDragOver
                  ? 'text-[#F5C542] border-[#F5C542]'
                  : 'text-zinc-400 group-hover/dropzone:text-[#F5C542]'
              }`}
            >
              <HugeiconsIcon icon={UploadIcon} size={18} />
            </div>
            <div className="space-y-0.5">
              <div className="font-bold text-xs text-zinc-100">
                Drop Reference Image Here
              </div>
              <div className="text-[10px] text-zinc-400 font-mono">
                Click to browse from local disk
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Upload Status / Validation Alerts */}
      {uploadStatus === 'saved' && (
        <div role="status" className="text-[10px] text-emerald-400 font-medium">
          ✓ Reference image uploaded and verified.
        </div>
      )}
      {uploadError && (
        <div role="alert" className="text-[10px] leading-relaxed text-rose-400 font-medium">
          ⚠ {uploadError}
        </div>
      )}

      {Boolean(approvalStatus || approvalWarning || approvalValidation) && (
        <div
          role={approvalStatus === 'failed' ? 'alert' : 'status'}
          className={`space-y-1 rounded-lg border px-2.5 py-1.5 text-[10px] leading-relaxed ${
            approvalStatus === 'failed'
              ? 'border-rose-500/25 bg-rose-500/[0.06] text-rose-300'
              : approvalStatus === 'needs_review'
              ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200'
              : 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-200'
          }`}
        >
          <div className="font-semibold flex items-center justify-between">
            <span>
              {approvalStatus === 'approved'
                ? 'Backend validation: approved'
                : approvalStatus === 'needs_review'
                ? 'Backend review required'
                : approvalStatus === 'failed'
                ? 'Backend validation failed'
                : 'Backend validation notice'}
            </span>
          </div>
          {approvalWarning && <div>{approvalWarning}</div>}
          {formatValidationDetails(approvalValidation) && (
            <div>{formatValidationDetails(approvalValidation)}</div>
          )}
          {approvalStatus === 'needs_review' && (
            <label className="flex items-start gap-1.5 pt-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={approvalAcknowledged}
                onChange={(e) => setApprovalAcknowledged(e.target.checked)}
                className="mt-0.5 accent-[#F5C542]"
              />
              <span>I reviewed this notice and want to proceed with this image.</span>
            </label>
          )}
          {approvalStatus === 'failed' && (
            <div className="text-rose-300 font-bold">
              Choose a different image; generation is blocked by QA.
            </div>
          )}
        </div>
      )}

      {/* Quick Presets / Clear Action */}
      <div className="flex items-center justify-between text-[10px] pt-0.5 gap-1.5 flex-wrap">
        <span className="text-zinc-400 font-medium shrink-0">
          {generationSettings.image ? 'Loaded Image' : 'Try Samples:'}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {generationSettings.image ? (
            <button
              type="button"
              onClick={onClearImage}
              className="text-rose-400 hover:text-rose-300 hover:underline cursor-pointer font-medium text-[10px]"
            >
              Clear Image
            </button>
          ) : (
            samplePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={sampleLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  void onSelectSample(preset);
                }}
                className="px-2 py-0.5 rounded-full bg-[#16171B] hover:bg-[#242732] text-zinc-300 hover:text-white border border-white/[0.08] text-[9px] font-medium cursor-pointer transition-colors disabled:opacity-50"
              >
                {sampleLoading ? '…' : preset.name.split(' ')[0]}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Asset Name / Guidance Input (Optional) */}
      <div className="pt-1.5 border-t border-white/[0.06] space-y-1">
        <div className="flex items-center justify-between text-[9px] text-zinc-400">
          <span className="font-semibold uppercase tracking-wider">Asset Name &amp; Guidance</span>
          <span className="font-mono text-zinc-500">Optional</span>
        </div>
        <input
          type="text"
          value={generationSettings.prompt || ''}
          onChange={(e) => {
            const val = e.target.value;
            setGenerationSettings((prev) => ({
              ...prev,
              prompt: val,
              imageName: prev.imageName || val.slice(0, 32),
            }));
          }}
          placeholder="e.g. Mech Sentinel, Cyberpunk Drone, Obsidian Blade..."
          className="w-full h-8 rounded-lg bg-[#16171B] border border-white/[0.08] px-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#F5C542]/60 transition-colors"
        />
      </div>

      {/* Adaptive Preprocessing / Generation Preview */}
      {generationSettings.image && (
        <div className="rounded-xl border border-white/[0.06] bg-[#16171B] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <HugeiconsIcon icon={SparklesIcon} size={13} className="text-[#F5C542]" />
                <span>Generation Preview</span>
              </div>
              <div className="text-[9px] text-zinc-400">
                Optional adaptive foreground segmentation &amp; crop
              </div>
            </div>
            <span
              className={`text-[8.5px] font-mono px-1.5 py-0.2 rounded font-bold ${
                generationSettings.enhancementEnabled
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : preprocessingApprovalStatus === 'failed' || preprocessingApprovalStatus === 'needs_review'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-white/[0.06] text-zinc-400 border border-white/[0.08]'
              }`}
            >
              {generationSettings.enhancementEnabled
                ? preprocessingApprovalStatus === 'needs_review'
                  ? 'Override Active'
                  : 'Enhanced'
                : preprocessingApprovalStatus === 'approved'
                ? 'Validated'
                : preprocessingApprovalStatus === 'needs_review'
                ? 'Review Req'
                : preprocessingApprovalStatus === 'failed'
                ? 'Failed'
                : 'Original'}
            </span>
          </div>

          {/* Side-by-Side Preview (Fixed Height for CLS) */}
          {generationSettings.preprocessingPreviewUrl && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-black/40 h-20 relative">
                <img
                  src={generationSettings.image}
                  alt="Original reference"
                  className="w-full h-full object-contain"
                />
                <div className="absolute bottom-1 left-1.5 px-1 py-0.2 rounded bg-black/70 text-[7.5px] text-zinc-400 font-mono">
                  Original
                </div>
              </div>
              <div className="rounded-lg overflow-hidden border border-[#F5C542]/40 bg-black/40 h-20 relative">
                <img
                  src={generationSettings.preprocessingPreviewUrl}
                  alt="Enhanced preview"
                  className="w-full h-full object-contain"
                />
                <div className="absolute bottom-1 left-1.5 px-1 py-0.2 rounded bg-black/70 text-[7.5px] text-[#F5C542] font-mono">
                  Enhanced
                </div>
              </div>
            </div>
          )}

          {enhancementError && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[9px] text-amber-300">
              {enhancementError}
            </div>
          )}

          {preprocessingApprovalStatus === 'needs_review' && (
            <label className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1.5 text-[9px] leading-relaxed text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(generationSettings.preprocessingReviewOverride)}
                onChange={(e) =>
                  setGenerationSettings((prev) => ({
                    ...prev,
                    preprocessingReviewOverride: e.target.checked,
                  }))
                }
                className="mt-0.5 accent-[#F5C542]"
              />
              <span>I reviewed the foreground warning and want to use this preview.</span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => void previewEnhancement()}
              disabled={enhancementLoading}
              className="rounded-lg border border-[#F5C542]/30 bg-[#F5C542]/10 hover:bg-[#F5C542]/20 px-2 py-1.5 text-[9px] font-bold text-[#F5C542] transition-colors cursor-pointer disabled:opacity-50"
            >
              {enhancementLoading
                ? 'Preparing…'
                : generationSettings.preprocessingArtifactId
                ? 'Regenerate Preview'
                : 'Create Preview'}
            </button>

            {generationSettings.preprocessingArtifactId ? (
              <button
                type="button"
                disabled={
                  preprocessingApprovalStatus === 'failed' ||
                  (preprocessingApprovalStatus === 'needs_review' &&
                    !generationSettings.preprocessingReviewOverride) ||
                  !['approved', 'needs_review'].includes(preprocessingApprovalStatus)
                }
                onClick={() =>
                  setGenerationSettings((prev) => ({ ...prev, enhancementEnabled: true }))
                }
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1.5 text-[9px] font-bold text-emerald-300 transition-colors cursor-pointer disabled:opacity-40"
              >
                {preprocessingApprovalStatus === 'needs_review'
                  ? 'Use Reviewed'
                  : 'Use Validated'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateToTool('edit')}
                className="rounded-lg border border-white/[0.08] bg-[#1D1F26] hover:bg-[#242732] px-2 py-1.5 text-[9px] font-bold text-zinc-300 transition-colors cursor-pointer"
              >
                Edit Manually
              </button>
            )}
          </div>

          {generationSettings.preprocessingArtifactId && (
            <button
              type="button"
              onClick={disableEnhancement}
              className="w-full text-center text-[8.5px] text-zinc-400 hover:text-white pt-1 transition-colors cursor-pointer"
            >
              Disable enhancement and revert to original
            </button>
          )}
        </div>
      )}
    </div>
  );
});

PromptAndImageDropzone.displayName = 'PromptAndImageDropzone';
