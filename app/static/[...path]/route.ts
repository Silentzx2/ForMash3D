import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Static file proxy: forwards /static/* requests to the backend,
 * with local filesystem fallback to /backend/storage when backend is offline.
 */

let activeBackendUrl: string | null = null;

function getBackendUrl(): string {
  if (activeBackendUrl) {
    return activeBackendUrl;
  }
  const value = process.env.BACKEND_URL?.trim();
  if (value && value !== 'undefined' && value !== 'null') {
    return value.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:7842';
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    case '.obj':
      return 'text/plain';
    case '.ply':
    case '.stl':
    case '.fbx':
      return 'application/octet-stream';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function tryServeFromDisk(fullPath: string): Promise<NextResponse | null> {
  const candidates: string[] = [];
  if (process.env.STORAGE_LOCAL_PATH) {
    candidates.push(path.resolve(process.env.STORAGE_LOCAL_PATH, fullPath));
  }
  candidates.push(
    path.join(process.cwd(), 'backend', 'storage', fullPath),
    path.join('/backend/storage', fullPath),
    path.resolve('backend/storage', fullPath)
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const blob = await fs.openAsBlob(candidate);
        const headers = new Headers();
        headers.set('Content-Type', getMimeType(candidate));
        headers.set('Content-Length', blob.size.toString());
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=3600');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Access-Control-Allow-Origin', '*');
        return new NextResponse(blob.stream() as any, { status: 200, headers });
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path || [];
  const fullPath = pathSegments.join('/');

  // Security: prevent path traversal
  if (fullPath.includes('..') || fullPath.includes('~') || fullPath.startsWith('/')) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  // 1. Serve directly from disk when available (fastest, avoids socket timeouts)
  const diskResponse = await tryServeFromDisk(fullPath);
  if (diskResponse) {
    return diskResponse;
  }

  const BACKEND_URL = getBackendUrl();
  const targetUrl = `${BACKEND_URL}/static/${fullPath}`;

  try {
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(300000), // 5 min timeout for large 3D models
      });
    } catch (fetchErr: any) {
      if (targetUrl.includes('//api:7842') || fetchErr?.cause?.code === 'ENOTFOUND') {
        activeBackendUrl = 'http://127.0.0.1:7842';
        const fallbackUrl = targetUrl.replace(/\/\/api(:7842)?\//, '//127.0.0.1:7842/');
        response = await fetch(fallbackUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(300000),
        });
      } else {
        throw fetchErr;
      }
    }

    if (response.ok) {
      // Forward the response with appropriate headers
      const headers = new Headers();
      const contentType = response.headers.get('content-type');
      if (contentType) headers.set('content-type', contentType);

      const contentLength = response.headers.get('content-length');
      if (contentLength) headers.set('content-length', contentLength);

      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges) headers.set('accept-ranges', acceptRanges);

      const contentRange = response.headers.get('content-range');
      if (contentRange) headers.set('content-range', contentRange);

      headers.set('Cache-Control', 'no-transform');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Access-Control-Allow-Origin', '*');

      if (fullPath.endsWith('.glb')) {
        headers.set('Content-Type', 'model/gltf-binary');
      } else if (fullPath.endsWith('.gltf')) {
        headers.set('Content-Type', 'model/gltf+json');
      } else if (fullPath.endsWith('.obj')) {
        headers.set('Content-Type', 'text/plain');
      } else if (fullPath.endsWith('.ply')) {
        headers.set('Content-Type', 'application/octet-stream');
      }

      return new NextResponse(response.body, {
        status: response.status,
        headers,
      });
    }
  } catch {
    // Backend unreachable and disk already checked
  }

  return NextResponse.json(
    { success: false, message: `File "${fullPath}" not found in storage` },
    { status: 404 }
  );
}
