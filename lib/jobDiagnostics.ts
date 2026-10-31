import type { AdminJob } from '@/types';

export interface JobDiagnostic {
  providerId: string;
  providerLabel: string;
  isRuntimeError: boolean;
  issueDescription: string;
  suggestedAction: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  'hunyuan3d-2-mini': 'Hunyuan3D-2 Mini',
  'hunyuan3d-2.1': 'Hunyuan3D-2.1',
  'hunyuan3d-2': 'Hunyuan3D-2.1',
  'hunyuan3d': 'Hunyuan3D-2.1',
  'trellis': 'TRELLIS',
  'triposg': 'TripoSG',
  'triposr': 'TripoSR',
  'detailgen3d': 'DetailGen3D',
  'shap-e': 'Shap-E',
  'flux': 'FLUX',
};

/**
 * Interprets generation job errors and extracts repairable runtime environment issues.
 * Identifies RuntimeError, C-extension / Pillow issues, package import issues, and model load failures.
 */
export function diagnoseJobError(job: AdminJob): JobDiagnostic | null {
  if (job.status !== 'failed') return null;

  const rawError = (job.error || job.error_message || '').trim();
  const lowerErr = rawError.toLowerCase();

  // Check if this is a runtime / environment / load failure
  const isRuntimeError =
    /load failed/i.test(rawError) ||
    /RuntimeError/i.test(rawError) ||
    /ImportError/i.test(rawError) ||
    /ModuleNotFoundError/i.test(rawError) ||
    /cannot import name/i.test(rawError) ||
    /_imaging/i.test(rawError) ||
    /C-extension/i.test(rawError) ||
    /preflight/i.test(rawError) ||
    /environment/i.test(rawError) ||
    /failed to initialize/i.test(rawError) ||
    /weights.*missing|missing.*weights/i.test(rawError) ||
    /CUDA out of memory/i.test(rawError) ||
    /out of memory/i.test(rawError) ||
    (/No such file or directory/i.test(rawError) && /venv|lib|python/i.test(rawError));

  let providerId = (job.provider || '').toLowerCase().trim();

  // Infer provider ID from error message if not present on job
  if (!providerId || providerId === 'unknown') {
    if (lowerErr.includes('hunyuan3d-2 mini') || lowerErr.includes('hunyuan3d-2mini') || lowerErr.includes('2mini') || lowerErr.includes('2 mini') || lowerErr.includes('hy3dgen')) {
      providerId = 'hunyuan3d-2-mini';
    } else if (lowerErr.includes('hunyuan3d-2.1') || lowerErr.includes('hunyuan3d-2') || lowerErr.includes('hunyuan3d')) {
      providerId = 'hunyuan3d-2.1';
    } else if (lowerErr.includes('trellis')) {
      providerId = 'trellis';
    } else if (lowerErr.includes('triposg') || lowerErr.includes('tripo')) {
      providerId = 'triposg';
    } else if (lowerErr.includes('detailgen3d')) {
      providerId = 'detailgen3d';
    } else if (lowerErr.includes('shap-e') || lowerErr.includes('shape')) {
      providerId = 'shap-e';
    } else {
      const match = rawError.match(/([A-Za-z0-9_.\-]+)\s+load failed/i);
      if (match && match[1]) {
        providerId = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      }
    }
  }

  // If no provider identified and not a recognizable runtime error, return null
  if (!providerId && !isRuntimeError) {
    return null;
  }

  // Normalize provider ID
  if (providerId === 'hunyuan3d-2' || providerId === 'hunyuan3d') {
    providerId = 'hunyuan3d-2.1';
  }

  // Fallback provider if error clearly indicates runtime crash
  if (!providerId && isRuntimeError) {
    providerId = 'hunyuan3d-2-mini';
  }

  const providerLabel = PROVIDER_NAMES[providerId] || providerId.toUpperCase();

  // Describe the root cause concisely
  let issueDescription = `${providerLabel} runtime environment error`;
  let suggestedAction = `Re-initialize ${providerLabel} environment and run preflight`;

  if (/cannot import name '_regex'|regex/i.test(rawError)) {
    issueDescription = 'regex C-extension ABI mismatch (Python 3.10 vs 3.12)';
    suggestedAction = `Rebuild backend overlay with Python 3.12 regex C-extension and repair runtime`;
  } else if (/cannot import name '_imaging'|pillow/i.test(rawError)) {
    issueDescription = 'Pillow C-extension incompatibility in model virtualenv';
    suggestedAction = `Rebuild runtime overlay and reinstall Pillow C-extensions for ${providerLabel}`;
  } else if (/load failed/i.test(rawError)) {
    const loadMatch = rawError.match(/([A-Za-z0-9_.\-\s]+load failed[^\n:;]*)/i);
    issueDescription = loadMatch ? loadMatch[1] : `${providerLabel} load failed`;
    suggestedAction = `Repair provider environment, re-verify weights, and run preflight`;
  } else if (/out of memory|cuda/i.test(rawError)) {
    issueDescription = 'GPU VRAM exhaustion (CUDA OOM) during execution';
    suggestedAction = `Enable Low VRAM mode or restart provider runtime`;
  } else if (/import|modulenotfound/i.test(rawError)) {
    issueDescription = 'Missing or mismatched dependency in provider virtualenv';
    suggestedAction = `Re-install provider dependencies and verify virtualenv`;
  }

  return {
    providerId,
    providerLabel,
    isRuntimeError: true,
    issueDescription,
    suggestedAction,
  };
}
