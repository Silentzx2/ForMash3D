import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Runtime API Proxy for /api/v1/* requests
 * 
 * CRITICAL FIX: This route proxies API calls at RUNTIME, not build time.
 * 
 * Next.js rewrites() in next.config.js are evaluated during build, so
 * the BACKEND_URL value gets "baked in" at build time. In Docker, this means
 * the rewrites would use localhost:7842 (from build) instead of api:7842
 * (the Docker service name). This causes ECONNREFUSED errors.
 * 
 * This API route reads BACKEND_URL from process.env at REQUEST time,
 * allowing proper Docker networking to work.
 * 
* Endpoint patterns:
   * - /api/v1/mesh-generation/image-to-raw-mesh -> backend:7842/api/v1/mesh-generation/image-to-raw-mesh
   * - /api/v1/file-upload/image -> backend:7842/api/v1/file-upload/image
   * - /api/v1/system/jobs/{job_id} -> backend:7842/api/v1/system/jobs/{job_id}
   * - /api/v1/system/jobs/history -> backend:7842/api/v1/system/jobs/history
   * - SSE endpoints are handled with streaming responses
 */

let activeBackendUrl: string | null = null;

// Local dev & Colab -> loopback 127.0.0.1:7842
// BACKEND_URL always takes precedence if provided.
function getBackendUrl(): string {
  if (activeBackendUrl) {
    return activeBackendUrl;
  }

  const value = process.env.BACKEND_URL?.trim();

  if (value && value !== 'undefined' && value !== 'null') {
    const clean = value.replace(/\/+$/, '');
    // In Node.js on Linux/Colab, localhost can resolve to IPv6 ::1 and fail with ECONNREFUSED
    if (clean.includes('//localhost:7842')) {
      return clean.replace('//localhost:7842', '//127.0.0.1:7842');
    }
    return clean;
  }

  // Default to IPv4 loopback where FastAPI runs in native / Colab environments
  return 'http://127.0.0.1:7842';
}

/**
 * Resilient fetcher that forwards requests to the backend.
 * If the configured backend URL uses Docker hostname 'api' or 'localhost' and fails,
 * it automatically fails over to 127.0.0.1:7842.
 */
async function fetchWithBackendFallback(
  url: string,
  init: RequestInit & { duplex?: 'half' }
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error: any) {
    const isDnsOrConnectionError =
      error?.cause?.code === 'ENOTFOUND' ||
      error?.code === 'ENOTFOUND' ||
      error?.cause?.code === 'ECONNREFUSED' ||
      error?.code === 'ECONNREFUSED' ||
      error?.message?.includes('ENOTFOUND') ||
      error?.message?.includes('ECONNREFUSED') ||
      error?.message?.includes('fetch failed');

    if (isDnsOrConnectionError) {
      if (url.includes('//api:7842') || url.includes('//api/')) {
        const fallbackUrl = url.replace(/\/\/api(:7842)?\//, '//127.0.0.1:7842/');
        console.warn(`[API Proxy] Host 'api' unreachable; failing over to ${fallbackUrl}`);
        activeBackendUrl = 'http://127.0.0.1:7842';
        return await fetch(fallbackUrl, init);
      }
      if (url.includes('//localhost:7842')) {
        const fallbackUrl = url.replace('//localhost:7842', '//127.0.0.1:7842');
        console.warn(`[API Proxy] Host 'localhost' unreachable; failing over to ${fallbackUrl}`);
        activeBackendUrl = 'http://127.0.0.1:7842';
        return await fetch(fallbackUrl, init);
      }
    }
    throw error;
  }
}

// SSE endpoints that need streaming responses
// NOTE: fullPath from params does NOT have a leading slash (e.g. "admin/install/stream/model_id")
// so patterns must match without assuming a leading /
const SSE_PATHS = [
  'install/stream',
  'logs/stream',
  'admin/install/stream',
  'admin/logs/stream',
];

// Broader patterns: any path ending with /stream is treated as SSE
function isSsePath(path: string): boolean {
  if (SSE_PATHS.some(sse => path.includes(sse))) return true;
  return path.endsWith('/stream');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path || [];
  const fullPath = pathSegments.join('/');
  const BACKEND_URL = getBackendUrl();
  const targetUrl = `${BACKEND_URL}/api/v1/${fullPath}${request.nextUrl.search}`;
  
  // Handle SSE endpoints with streaming
  if (isSsePath(fullPath)) {
    return streamResponse(targetUrl, request);
  }
  
  // Dynamic timeout: large binary downloads/exports get 10 minutes (600000ms), other endpoints get 3 minutes (180000ms)
  const isLargeAssetPath =
    fullPath.includes('download') ||
    fullPath.includes('export') ||
    fullPath.includes('thumbnail') ||
    fullPath.includes('file-upload') ||
    fullPath.includes('artifact_format') ||
    fullPath.includes('assets') ||
    fullPath.endsWith('.glb') ||
    fullPath.endsWith('.gltf') ||
    fullPath.endsWith('.obj') ||
    fullPath.endsWith('.zip') ||
    fullPath.endsWith('.png');

  const timeoutMs = isLargeAssetPath ? 600000 : 180000;

  try {
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'GET',
      headers: getForwardingHeaders(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    
    return await createProxyResponse(response, request);
  } catch (error) {
    console.error(`[API Proxy] GET ${fullPath} failed:`, error);
    return corsJson(
      { success: false, message: `Backend unavailable or timed out at ${BACKEND_URL}` },
      { status: 504 },
      request
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path || [];
  const fullPath = pathSegments.join('/');
  const BACKEND_URL = getBackendUrl();
  const targetUrl = `${BACKEND_URL}/api/v1/${fullPath}${request.nextUrl.search}`;
  
  try {
    // Check if this is a file upload (multipart/form-data)
    const contentType = request.headers.get('content-type') || '';
    
    let body: BodyInit | undefined;
    const headers: HeadersInit = {};
    
    // Forward authorization header if present
    const auth = request.headers.get('authorization');
    if (auth) headers['authorization'] = auth;
    
    const isMultipart = contentType.includes('multipart/form-data');
    if (isMultipart) {
      const arrayBuf = await request.arrayBuffer();
      body = Buffer.from(arrayBuf);
      headers['content-type'] = contentType;
      headers['content-length'] = arrayBuf.byteLength.toString();
    } else {
      body = await request.text();
      if (contentType) headers['content-type'] = contentType;
    }
    
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'POST',
      headers,
      body: body || undefined,
      duplex: isMultipart ? undefined : undefined,
      signal: AbortSignal.timeout(600000), // 10 minutes for generation/uploads
    });
    
    return await createProxyResponse(response, request);
  } catch (error) {
    console.error(`[API Proxy] POST ${fullPath} failed:`, error);
    return corsJson(
      { success: false, message: `Upload/POST request failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
      request
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path || [];
  const fullPath = pathSegments.join('/');
  const BACKEND_URL = getBackendUrl();
  const targetUrl = `${BACKEND_URL}/api/v1/${fullPath}${request.nextUrl.search}`;
  
  try {
    const body = await request.text();
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'PUT',
      headers: {
        'content-type': request.headers.get('content-type') || 'application/json',
        ...getAuthHeader(request),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(30000),
    });
    
    return await createProxyResponse(response, request);
  } catch (error) {
    console.error(`[API Proxy] PUT ${fullPath} failed:`, error);
    return corsJson(
      { success: false, message: `Backend unavailable at ${BACKEND_URL} — is the backend service running?` },
      { status: 502 },
      request
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path || [];
  const fullPath = pathSegments.join('/');
  const BACKEND_URL = getBackendUrl();
  const targetUrl = `${BACKEND_URL}/api/v1/${fullPath}${request.nextUrl.search}`;
  
  try {
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'DELETE',
      headers: getForwardingHeaders(request),
      signal: AbortSignal.timeout(10000),
    });
    
    return await createProxyResponse(response, request);
  } catch (error) {
    return corsJson(
      { success: false, message: `Backend unavailable at ${BACKEND_URL} — is the backend service running?` },
      { status: 502 },
      request
    );
  }
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
    'Access-Control-Max-Age': '86400',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

// Helper: Get headers to forward to backend
function getForwardingHeaders(request: NextRequest): HeadersInit {
  const headers: HeadersInit = {};
  
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;
  
  const auth = request.headers.get('authorization');
  if (auth) headers['authorization'] = auth;
  
  return headers;
}

// Helper: Get just the auth header if present
function getAuthHeader(request: NextRequest): HeadersInit {
  const headers: HeadersInit = {};
  const auth = request.headers.get('authorization');
  if (auth) headers['authorization'] = auth;
  return headers;
}

// Helper: JSON response with proper CORS headers reflecting request origin
function corsJson(data: any, init?: ResponseInit, request?: NextRequest): NextResponse {
  const origin = request?.headers.get('origin');
  const headers = new Headers(init?.headers);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Info, Apikey');
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return NextResponse.json(data, { ...init, headers });
}

// Helper: Create response from backend response
async function createProxyResponse(response: Response, request?: NextRequest): Promise<NextResponse> {
  const headers = new Headers();

  // Forward relevant headers.
  // CRITICAL: NEVER forward 'content-length' or 'content-encoding'!
  // Node.js fetch() automatically decompresses gzip/deflate responses from the backend.
  // If the upstream backend sent a gzipped response (e.g. FastAPI GZipMiddleware for >1000b payloads),
  // upstream content-length is the COMPRESSED size, while response.body is DECOMPRESSED.
  // Forwarding compressed content-length causes the browser to truncate the JSON payload mid-stream!
  const forwardHeaders = ['content-type', 'accept-ranges', 'content-range', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
  for (const header of forwardHeaders) {
    const value = response.headers.get(header);
    if (value) headers.set(header, value);
  }

  // Forward content-length for binary assets if content-encoding is absent (allows download progress)
  const contentEncoding = response.headers.get('content-encoding');
  const contentLength = response.headers.get('content-length');
  if (contentLength && !contentEncoding) {
    headers.set('content-length', contentLength);
  }

  const origin = request?.headers.get('origin');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Info, Apikey');
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  // Stream response body directly through a TransformStream to absorb client aborts gracefully without unhandled Next.js pipe errors
  if (response.body) {
    const transform = new TransformStream();
    response.body.pipeTo(transform.writable).catch(() => {
      // Stream aborted by client or upstream timeout - safely absorbed
    });
    return new NextResponse(transform.readable, {
      status: response.status,
      headers,
    });
  }

  return new NextResponse(null, {
    status: response.status,
    headers,
  });
}

// Helper: Handle SSE streaming
async function streamResponse(targetUrl: string, request: NextRequest): Promise<NextResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 min safety timeout; jobs can run longer than 5 min
  
  // Track if client has disconnected
  let clientDisconnected = false;
  
  // Listen for client disconnect
  const onDisconnect = () => {
    clientDisconnected = true;
    controller.abort();
  };
  
  // NextRequest doesn't have a direct abort signal, but we can detect disconnect
  // by wrapping the response body
  request.signal?.addEventListener('abort', onDisconnect);
  
  try {
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'GET',
      headers: {
        'accept': 'text/event-stream',
        'cache-control': 'no-cache',
        ...getAuthHeader(request),
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', onDisconnect);
    
    if (!response.ok) {
      return corsJson(
        { success: false, message: `SSE connection failed: ${response.status}` },
        { status: response.status },
        request
      );
    }
    
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    if (origin) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-credentials', 'true');
    }
    
    // Wrap the response body with a transform that handles client disconnect gracefully
    // and ensures the upstream response is properly cancelled
    if (response.body) {
      // Create a readable stream that wraps the upstream response
      // and handles client disconnect gracefully
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel() {
          // Client disconnected - cancel the upstream reader
          reader.cancel().catch(() => {});
        }
      });
      
      return new NextResponse(stream, {
        status: 200,
        headers,
      });
    }
    
    return new NextResponse(null, {
      status: 200,
      headers,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', onDisconnect);
    controller.abort();
    console.error('[API Proxy] SSE stream failed:', error);
    return corsJson(
      { success: false, message: `SSE connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 502 },
      request
    );
  }
}