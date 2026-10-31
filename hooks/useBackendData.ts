/**
 * Standalone backend data hooks.
 *
 * NOTE: These make their own API calls and are intended for use OUTSIDE of
 * WorkspaceContext. WorkspaceContext already polls system stats, history, and
 * runtime options — using these hooks inside a WorkspaceContext subtree will
 * duplicate polling. Prefer reading from the WorkspaceContext when available.
 *
 * @WARNING Using this hook inside WorkspaceContext subtree duplicates polling.
 */
import { useEffect, useState, useRef } from 'react';
import { getApiClient } from '@/services/apiClient';
import { useRealtime } from '@/hooks/useRealtime';
import { dedupedGet, TTL } from '@/lib/requestDedup';
import type { HealthStatus } from '@/types/api';

export type BackendStatus = 'unknown' | 'online' | 'offline';

export function useBackendStatus(): BackendStatus {
  const realtime = useRealtime();
  const [polledStatus, setPolledStatus] = useState<BackendStatus>('unknown');

  // When WebSocket is connected, derive status from it directly
  useEffect(() => {
    if (realtime.connected) {
      setPolledStatus('online');
    }
  }, [realtime.connected]);

  // Fallback polling only when WebSocket is disconnected
  useEffect(() => {
    if (realtime.connected) return; // WebSocket handles status

    let active = true;
    const check = async () => {
      try {
        await getApiClient().get<HealthStatus>('/api/v1/system/health');
        if (active) setPolledStatus('online');
      } catch {
        if (active) setPolledStatus('offline');
      }
    };
    check();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      check();
    }, 60000);
    return () => { active = false; clearInterval(interval); };
  }, [realtime.connected]);

  return realtime.connected ? 'online' : polledStatus;
}

export function useRuntimeOptions() {
  const [options, setOptions] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Fetch full options data (deduped — 60s TTL)
    const fetchOptions = async () => {
      try {
        const data = await dedupedGet<any>('/api/v1/system/scheduler-status', TTL.OPTIONS);
        if (active) {
          setOptions((prev: any) => ({ ...prev, ...(data?.data ?? data ?? {}) }));
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to fetch options');
          setLoading(false);
        }
      }
    };

    fetchOptions();
    return () => {
      active = false;
    };
  }, []);

  return { options, loading, error };
}

export function useSystemSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const data = await getApiClient().get<any>('/api/v1/system/status');
        const payload = data?.data ?? data ?? {};
        setSettings({
          ...payload,
          default_provider: payload.default_provider ?? payload.ai_provider ?? payload.aiProvider,
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch settings');
        setSettings(null);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  return { settings, loading, error };
}
