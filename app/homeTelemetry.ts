import { getApiClient } from '@/services/apiClient';

export interface HomeTelemetry {
  status: 'online' | 'busy' | 'offline' | 'unknown';
  gpuName: string | null;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
  queueRunning: number | null;
  queuePending: number | null;
  latencyMs: number | null;
}

export const UNKNOWN_HOME_TELEMETRY: HomeTelemetry = {
  status: 'unknown',
  gpuName: null,
  vramUsedGb: null,
  vramTotalGb: null,
  queueRunning: null,
  queuePending: null,
  latencyMs: null,
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function mapStatsToTelemetry(data: unknown): HomeTelemetry {
  if (!data || typeof data !== 'object') return UNKNOWN_HOME_TELEMETRY;
  const stats = data as Record<string, unknown>;
  const gpuName = typeof stats.gpu_name === 'string' && stats.gpu_name.trim()
    ? String(stats.gpu_name).trim()
    : null;
  const hasGpu = Boolean(gpuName && gpuName.toLowerCase() !== 'unknown');
  const queue = (stats.queue as Record<string, unknown> | undefined) || {};
  return {
    status: 'online',
    gpuName: hasGpu ? gpuName : null,
    vramUsedGb: hasGpu ? finiteNumber(stats.vram_used_gb) : null,
    vramTotalGb: hasGpu ? finiteNumber(stats.vram_total_gb) : null,
    queueRunning: finiteNumber(queue.processing_jobs),
    queuePending: finiteNumber(queue.pending_jobs),
    latencyMs: null,
  };
}

async function defaultFetcher(): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  try {
    const data = await getApiClient().getSystemStats();
    return { ok: true, json: async () => data };
  } catch {
    return { ok: false, json: async () => null };
  }
}

export async function fetchHomeTelemetry(
  fetcher: () => Promise<{ ok: boolean; json: () => Promise<unknown> }> = defaultFetcher
): Promise<HomeTelemetry> {
  try {
    const response = await fetcher();
    if (!response.ok) return UNKNOWN_HOME_TELEMETRY;
    const data = await response.json();
    return mapStatsToTelemetry(data);
  } catch {
    return UNKNOWN_HOME_TELEMETRY;
  }
}
