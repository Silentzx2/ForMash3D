/**
 * High-performance multi-tier cache for 3D model files (GLB, GLTF, OBJ, PLY).
 *
 * Tier 1 (L1): In-memory ArrayBuffer cache (instant 0ms RAM lookup).
 * Tier 2 (L2): Persistent browser CacheStorage (disk-backed across page refreshes/tabs).
 * Tier 3 (L3): Chunked streaming network fetch with real-time download progress.
 */

const CACHE_NAME = 'formash-3d-models-v1';
const glbBufferCache = new Map<string, ArrayBuffer>();
const MAX_CACHE_BYTES = 150 * 1024 * 1024; // 150MB maximum in-memory budget
const MAX_CACHE_ITEMS = 12; // Cap item count
let currentCacheBytes = 0;

export function getCachedGLB(url: string): ArrayBuffer | undefined {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return undefined;
  const value = glbBufferCache.get(url);
  if (value) {
    // Map insertion order provides the LRU queue; touching a key moves it to MRU.
    glbBufferCache.delete(url);
    glbBufferCache.set(url, value);
  }
  return value;
}

export function setCachedGLB(url: string, buffer: ArrayBuffer): void {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;

  const itemBytes = buffer.byteLength;
  // If a single model exceeds the budget, don't keep it in L1 RAM (it can still live in L2 disk cache)
  if (itemBytes > MAX_CACHE_BYTES) return;

  const existing = glbBufferCache.get(url);
  if (existing) {
    currentCacheBytes -= existing.byteLength;
    glbBufferCache.delete(url);
  }

  // Evict oldest items if item count or memory budget exceeded
  while (
    (glbBufferCache.size >= MAX_CACHE_ITEMS || currentCacheBytes + itemBytes > MAX_CACHE_BYTES) &&
    glbBufferCache.size > 0
  ) {
    const firstKey = glbBufferCache.keys().next().value;
    if (!firstKey) break;
    const oldBuf = glbBufferCache.get(firstKey);
    if (oldBuf) currentCacheBytes -= oldBuf.byteLength;
    glbBufferCache.delete(firstKey);
  }

  glbBufferCache.set(url, buffer);
  currentCacheBytes += itemBytes;

  // Asynchronously persist into L2 disk CacheStorage (HTTP/HTTPS/origin paths only)
  if (typeof window !== 'undefined' && 'caches' in window && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/'))) {
    try {
      caches.open(CACHE_NAME).then((cache) => {
        const headers = new Headers({
          'Content-Type': 'model/gltf-binary',
          'Content-Length': buffer.byteLength.toString(),
        });
        // Avoid buffer.slice(0) memory copy; Response accepts ArrayBufferView/ArrayBuffer directly
        const response = new Response(buffer, { headers });
        cache.put(url, response).catch(() => {});
      }).catch(() => {});
    } catch {}
  }
}

export interface StreamProgressCallback {
  (loaded: number, total: number, percent: number): void;
}

const inFlightRequests = new Map<string, Promise<ArrayBuffer>>();
const progressListeners = new Map<string, Set<StreamProgressCallback>>();

/**
 * Load 3D model buffer using L1 RAM -> L2 Disk Cache -> In-Flight Deduplication -> Streaming Network Fetch.
 * Supports concurrent request deduplication, retry resilience, and streaming progress callbacks.
 */
export async function loadGLBWithProgress(
  url: string,
  onProgress?: StreamProgressCallback
): Promise<ArrayBuffer> {
  if (!url) throw new Error('Model URL is required');

  const isCacheableUrl = !url.startsWith('blob:') && !url.startsWith('data:');

  // 1. Check L1 in-memory cache (Instant 0ms)
  if (isCacheableUrl) {
    const memCached = getCachedGLB(url);
    if (memCached) {
      onProgress?.(memCached.byteLength, memCached.byteLength, 100);
      return memCached;
    }
  }

  // 2. Check L2 persistent browser CacheStorage (~5ms, no network)
  if (isCacheableUrl && typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(url);
      if (matched) {
        const buf = await matched.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          setCachedGLB(url, buf);
          onProgress?.(buf.byteLength, buf.byteLength, 100);
          return buf;
        }
      }
    } catch {}
  }

  // 3. Deduplicate in-flight requests: if another component (e.g. prefetcher) is already downloading this URL, share it!
  if (inFlightRequests.has(url)) {
    if (onProgress) {
      let listeners = progressListeners.get(url);
      if (!listeners) {
        listeners = new Set();
        progressListeners.set(url, listeners);
      }
      listeners.add(onProgress);
    }
    return inFlightRequests.get(url)!;
  }

  // 4. Execute fetch with automatic retry and in-flight tracking
  let listeners = progressListeners.get(url);
  if (!listeners) {
    listeners = new Set();
    progressListeners.set(url, listeners);
  }
  if (onProgress) {
    listeners.add(onProgress);
  }

  const broadcastProgress = (loaded: number, total: number, percent: number) => {
    const subs = progressListeners.get(url);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(loaded, total, percent);
        } catch {}
      }
    }
  };

  const fetchWithRetry = async (attempt = 1, maxAttempts = 3): Promise<ArrayBuffer> => {
    try {
      const controller = new AbortController();
      // Generous 120s timeout per attempt for large 3D models with 2K/4K textures
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (attempt < maxAttempts && (response.status === 502 || response.status === 503 || response.status === 504)) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          return fetchWithRetry(attempt + 1, maxAttempts);
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        const text = await response.clone().text();
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
          throw new Error('Model file served as HTML — possible token/auth failure.');
        }
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      let arrayBuffer: ArrayBuffer;

      if (response.body && typeof ReadableStream !== 'undefined' && total > 0) {
        try {
          const reader = response.body.getReader();
          let buffer = new Uint8Array(total);
          let loaded = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            if (loaded + value.byteLength > buffer.byteLength) {
              const next = new Uint8Array(Math.max(loaded + value.byteLength, buffer.byteLength * 2));
              next.set(buffer.subarray(0, loaded));
              buffer = next;
            }
            buffer.set(value, loaded);
            loaded += value.byteLength;
            const percent = Math.min(99, Math.round((loaded / total) * 100));
            broadcastProgress(loaded, total, percent);
          }

          arrayBuffer = buffer.buffer.slice(0, loaded);
          broadcastProgress(loaded, total, 100);
        } catch (streamErr) {
          console.warn('[glbCache] Streaming reader failed, falling back to full arrayBuffer fetch:', streamErr);
          const fallbackRes = await fetch(url);
          arrayBuffer = await fallbackRes.arrayBuffer();
          broadcastProgress(arrayBuffer.byteLength, arrayBuffer.byteLength, 100);
        }
      } else {
        arrayBuffer = await response.arrayBuffer();
        broadcastProgress(arrayBuffer.byteLength, arrayBuffer.byteLength, 100);
      }

      setCachedGLB(url, arrayBuffer);
      return arrayBuffer;
    } catch (err: any) {
      if (attempt < maxAttempts && (err?.name === 'AbortError' || err?.message?.includes('network') || err?.message?.includes('fetch'))) {
        console.warn(`[glbCache] Fetch attempt ${attempt} failed for ${url} (${err?.message}); retrying...`);
        await new Promise((r) => setTimeout(r, 800 * attempt));
        return fetchWithRetry(attempt + 1, maxAttempts);
      }
      throw err;
    }
  };

  const task = fetchWithRetry().finally(() => {
    inFlightRequests.delete(url);
    progressListeners.delete(url);
  });

  inFlightRequests.set(url, task);
  return task;
}

export async function prefetchGLB(url: string): Promise<ArrayBuffer | null> {
  if (!url) return null;
  try {
    return await loadGLBWithProgress(url);
  } catch {
    return null;
  }
}

