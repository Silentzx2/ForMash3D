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
  return glbBufferCache.get(url);
}

export function setCachedGLB(url: string, buffer: ArrayBuffer): void {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;

  const itemBytes = buffer.byteLength;
  // If a single model exceeds the budget, don't keep it in L1 RAM (it can still live in L2 disk cache)
  if (itemBytes > MAX_CACHE_BYTES) return;

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

/**
 * Load 3D model buffer using L1 RAM -> L2 Disk Cache -> Streaming Network Fetch.
 * Supports streaming progress callbacks for real-time loading HUD.
 */
export async function loadGLBWithProgress(
  url: string,
  onProgress?: StreamProgressCallback
): Promise<ArrayBuffer> {
  if (!url) throw new Error('Model URL is required');

  const isCacheableUrl = !url.startsWith('blob:') && !url.startsWith('data:');

  // 1. Check L1 in-memory cache (Instant 0ms)
  if (isCacheableUrl) {
    const memCached = glbBufferCache.get(url);
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
          glbBufferCache.set(url, buf);
          onProgress?.(buf.byteLength, buf.byteLength, 100);
          return buf;
        }
      }
    } catch {}
  }

  // 3. Network Fetch with chunked stream progress
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.length;
        const percent = Math.min(99, Math.round((loaded / total) * 100));
        onProgress?.(loaded, total, percent);
      }
    }

    const combined = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    arrayBuffer = combined.buffer;
    onProgress?.(loaded, total, 100);
  } else {
    arrayBuffer = await response.arrayBuffer();
    onProgress?.(arrayBuffer.byteLength, arrayBuffer.byteLength, 100);
  }

  setCachedGLB(url, arrayBuffer);
  return arrayBuffer;
}

export async function prefetchGLB(url: string): Promise<ArrayBuffer | null> {
  if (!url) return null;
  try {
    return await loadGLBWithProgress(url);
  } catch {
    return null;
  }
}

