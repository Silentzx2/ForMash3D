'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export interface RealtimeGpuData {
  available: boolean;
  devices: Array<{
    index: number;
    name: string;
    vram_mb: number;
    free_vram_mb: number;
    utilization?: number;
    temperature?: number;
  }>;
  free_vram_mb: number;
  total_vram_mb: number;
}

export interface RealtimeHealthData {
  gpu: Record<string, unknown>;
  cuda: Record<string, unknown>;
  system_resources: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RealtimeState {
  connected: boolean;
  gpu: RealtimeGpuData | null;
  health: RealtimeHealthData | null;
}

/**
 * Backend realtime status hook.
 *
 * The current 3DAIGC-API backend does not expose a WebSocket transport.
 * This hook returns a disconnected state and lets consumers fall back to
 * REST polling. Do not add reconnect loops to a nonexistent endpoint.
 */
export function useRealtime(): RealtimeState {
  const [state, setState] = useState<RealtimeState>({
    connected: false,
    gpu: null,
    health: null,
  });

  return state;
}
