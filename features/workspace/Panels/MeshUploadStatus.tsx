'use client';

import React from 'react';
import type { MeshAssetUploadState } from '@/hooks/useMeshAssetUpload';

export function MeshUploadStatus({ state }: { state: MeshAssetUploadState }) {
  if (state.status === 'idle') return null;

  const label = state.status === 'uploading'
    ? 'Uploading'
    : state.status === 'verifying'
      ? 'Verifying and saving'
      : state.status === 'saved'
        ? 'Saved to assets'
        : 'Upload failed';
  const formatBytes = (bytes: number) => bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const transfer = state.totalBytes === null
    ? `${formatBytes(state.loadedBytes)} transferred · total unavailable`
    : `${formatBytes(state.loadedBytes)} / ${formatBytes(state.totalBytes)}`;

  return (
    <div
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live={state.status === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed ${state.status === 'error' ? 'border-rose-500/25 bg-rose-500/[0.06] text-rose-300' : state.status === 'saved' ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300' : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold">{state.fileName}</span>
        <span className="shrink-0 font-medium">{label}</span>
      </div>
      {state.status === 'error' ? (
        <p className="mt-1 break-words">{state.error}</p>
      ) : (
        <div className="mt-0.5 flex items-center justify-between gap-2 text-zinc-400">
          <span>{transfer}</span>
          <span>{state.percent === null ? 'Percentage unavailable' : `${state.percent}%`}</span>
        </div>
      )}
      {state.status === 'uploading' && state.percent !== null && (
        <div
          role="progressbar"
          aria-label={`Uploading ${state.fileName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.percent}
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${state.percent}%` }} />
        </div>
      )}
    </div>
  );
}