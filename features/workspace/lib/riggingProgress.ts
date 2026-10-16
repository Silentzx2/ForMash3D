export interface RigProgressInput {
  status?: string;
  progress?: number | null;
  stage?: string | null;
  message?: string | null;
}

/**
 * Derives truthful progress percentage from backend job status.
 * Never synthesizes progress increments on stalled or unmetered jobs.
 */
export function computeRigProgress(statusRes: RigProgressInput | null | undefined): number {
  if (!statusRes) return 0;
  if (statusRes.status === 'completed') return 100;
  if (statusRes.status === 'failed' || statusRes.status === 'cancelled') return 0;
  const raw = typeof statusRes.progress === 'number' && Number.isFinite(statusRes.progress)
    ? statusRes.progress
    : null;
  if (raw === null) return 0;
  return Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
}

/**
 * Derives honest status message from backend job status and stage metadata.
 */
export function computeRigStatusText(statusRes: RigProgressInput | null | undefined): string {
  if (!statusRes) return 'idle';
  if (statusRes.status === 'completed') return 'Rig generated successfully!';
  if (statusRes.status === 'failed') return 'failed';
  if (statusRes.status === 'cancelled') return 'cancelled';
  const stageMessage = statusRes.message || statusRes.stage;
  const defaultStatus = statusRes.status === 'queued'
    ? 'Waiting for GPU scheduler…'
    : 'Fitting skeleton & skinning weights…';
  if (!stageMessage) return defaultStatus;
  if (
    stageMessage.startsWith('Auto-rig') ||
    stageMessage.startsWith('Fitting') ||
    stageMessage.startsWith('Waiting') ||
    stageMessage.startsWith('Queued')
  ) {
    return stageMessage;
  }
  return `${defaultStatus} (${stageMessage})`;
}
