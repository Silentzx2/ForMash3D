/**
 * Client-side request deduplication with TTL caching.
 *
 * Prevents polling storms by:
 * 1. Returning cached responses within TTL
 * 2. Coalescing concurrent in-flight requests to the same endpoint
 *
 * Used by hooks and API clients that may be mounted simultaneously
 * by multiple components.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
let lastCleanup = 0;

/** Default TTLs by endpoint pattern (ms) */
export const TTL = {
    // /runtime/options carries the model selector list, which changes whenever
    // a provider is installed/unloaded. A long TTL here hid newly installed
    // models from the selector for up to a minute (the dedup cache was never
    // invalidated after install completed). Keep it short so installs surface
    // quickly; the endpoint is light and polled by one hook.
    OPTIONS: 10_000,
    SYSTEM_INFO: 15_000, // /system/info — moderate change rate
    RUNTIME_STATUS: 10_000, // /system/scheduler-status — frequent updates
    HISTORY: 60_000,    // /system/jobs/history — event-driven preferred
} as const;

/** Get the appropriate TTL for a given URL path */
function resolveTtl(path: string): number {
  if (path.includes('/runtime/options')) return TTL.OPTIONS;
  if (path.includes('/system/info')) return TTL.SYSTEM_INFO;
  if (path.includes('/system/scheduler-status')) return TTL.RUNTIME_STATUS;
  if (path.includes('/system/jobs/history')) return TTL.HISTORY;
  return 5_000; // default 5s
}

/** Periodically evict expired entries to prevent unbounded growth */
function evictExpired(): void {
  const now = Date.now();
  // Run cleanup at most once per 30s
  if (now - lastCleanup < 30_000) return;
  lastCleanup = now;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/**
 * Fetch with deduplication and TTL caching.
 * Multiple concurrent calls with the same path return the same promise.
 */
export async function dedupedGet<T>(path: string, ttl?: number): Promise<T> {
  const now = Date.now();
  const effectiveTtl = ttl ?? resolveTtl(path);

  // Check cache first
  const cached = cache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  // Check in-flight — return existing promise if already fetching
  const existing = inFlight.get(path);
  if (existing) {
    return existing as Promise<T>;
  }

  // Create new request
  const promise = fetch(path, {
    headers: { 'Accept': 'application/json' },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return res.json();
    })
    .then((data: T) => {
      cache.set(path, { data, expiresAt: now + effectiveTtl });
      return data;
    })
    .finally(() => {
      inFlight.delete(path);
      evictExpired();
    });

  inFlight.set(path, promise);
  return promise;
}

/** Invalidate a specific path or the entire cache */
export function invalidateDedup(path?: string): void {
  if (path) {
    cache.delete(path);
  } else {
    cache.clear();
  }
}
