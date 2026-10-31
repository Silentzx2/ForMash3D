import { getApiUrl } from '@/services/apiClient';

export interface DiagnosticResult {
  success: boolean;
  timestamp: string;
  file: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };
  request: {
    url: string;
    method: string;
    headers: Record<string, string | null>;
    formDataEntries: string[];
    apiBaseUrl: string;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    bodyTruncated: boolean;
    isHtml: boolean;
    isJson: boolean;
  } | null;
  errors: string[];
  recommendations: string[];
}

/**
 * Detects whether a response body looks like HTML (token error page, redirect, etc.)
 */
function detectHtml(body: string, contentType: string): boolean {
  if (contentType.includes('text/html')) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<?xml');
}

/**
 * Builds the headers object that WOULD be sent (for logging purposes).
 * Note: XMLHttpRequest with FormData sets Content-Type automatically with boundary.
 */
function getExpectedHeaders(): Record<string, string | null> {
  return {
    'Content-Type': 'multipart/form-data (auto-set by browser with boundary)',
    'Accept': '*/*',
    // These are common headers that may be present but not explicitly set
    'Origin': typeof window !== 'undefined' ? window.location.origin : null,
    'Referer': typeof window !== 'undefined' ? window.location.href : null,
  };
}

/**
 * Runs a full diagnostic on a file upload attempt.
 * Logs request structure, attempts upload, captures response details.
 */
export async function diagnoseUpload(file: File): Promise<DiagnosticResult> {
  const errors: string[] = [];
  const recommendations: string[] = [];

  const apiBaseUrl = getApiUrl();
  const uploadPath = '/api/v1/file-upload/mesh';
  const fullUrl = `${apiBaseUrl}${uploadPath}`;

  // Build FormData to inspect structure
  const formData = new FormData();
  formData.append('file', file);
  const formDataEntries: string[] = [];
  formData.forEach((value, key) => {
    if (value instanceof File) {
      formDataEntries.push(`${key}: File(${value.name}, ${value.size} bytes, ${value.type || 'unknown'})`);
    } else {
      formDataEntries.push(`${key}: ${String(value).slice(0, 100)}`);
    }
  });

  const result: DiagnosticResult = {
    success: false,
    timestamp: new Date().toISOString(),
    file: {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    },
    request: {
      url: fullUrl,
      method: 'POST',
      headers: getExpectedHeaders(),
      formDataEntries,
      apiBaseUrl,
    },
    response: null,
    errors,
    recommendations,
  };

  // Pre-flight checks
  if (!apiBaseUrl) {
    recommendations.push('API base URL is empty — requests use relative URLs via proxy route. Ensure proxy is configured.');
  }

  if (file.size === 0) {
    errors.push('File is empty (0 bytes)');
    recommendations.push('Verify the file was selected correctly and is not corrupted.');
  }

  if (file.size > 150 * 1024 * 1024) {
    errors.push(`File exceeds 150MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    recommendations.push('Reduce file size or split the model into smaller parts.');
  }

  // Attempt the actual upload
  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type — browser sets it with boundary
    });

    const responseContentType = response.headers.get('content-type') || '';
    let responseBody = '';
    let bodyTruncated = false;

    const rawText = await response.text();
    if (rawText.length > 500) {
      responseBody = rawText.slice(0, 500);
      bodyTruncated = true;
    } else {
      responseBody = rawText;
    }

    // Collect response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const isHtml = detectHtml(responseBody, responseContentType);
    const isJson = responseContentType.includes('application/json');

    result.response = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      bodyTruncated,
      isHtml,
      isJson,
    };

    if (response.ok && !isHtml) {
      result.success = true;
    } else {
      if (isHtml) {
        errors.push(`Server returned HTML instead of JSON (status ${response.status}). This usually means:`);
        errors.push('  1. A CSRF/token validation failure (HTML error page)');
        errors.push('  2. A redirect to a login page');
        errors.push('  3. A reverse proxy (nginx/Cloudflare) intercepting the request');
        errors.push('  4. The API route does not exist and a fallback HTML page is served');
        recommendations.push('Check if the backend requires a CSRF token or auth header.');
        recommendations.push('Verify the upload endpoint exists: POST /api/v1/file-upload/mesh');
        recommendations.push('Check reverse proxy configuration — it may be returning an error page.');
        recommendations.push('Inspect the HTML body above for specific error messages.');
      } else if (!response.ok) {
        errors.push(`Upload failed with status ${response.status}: ${response.statusText}`);
        if (response.status === 401 || response.status === 403) {
          errors.push('Authentication/authorization failure — token may be missing or expired.');
          recommendations.push('Check if the session/auth token is still valid.');
        } else if (response.status === 413) {
          recommendations.push('File too large for server. Check server upload size limits.');
        } else if (response.status === 422) {
          recommendations.push('Validation error — check the response body for field-specific errors.');
        } else if (response.status >= 500) {
          recommendations.push('Server error — check backend logs for details.');
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Request failed: ${message}`);
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      recommendations.push('Network error — backend may be unreachable or CORS is blocking the request.');
      recommendations.push(`Verify the backend is running and accessible at: ${apiBaseUrl || '(relative URL via proxy)'}`);
    }
  }

  return result;
}

/**
 * Generates a minimal valid GLB file for testing.
 * GLB magic: 0x46546C67 ("glTF"), version: 2, JSON chunk with minimal scene.
 */
export function createSampleGlbFile(): File {
  // Minimal valid GLB binary (a single triangle, no materials)
  const jsonChunk = JSON.stringify({
    asset: { version: '2.0', generator: 'diagnostic-tool' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', max: [1, 1, 0], min: [0, 0, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 48 }],
  });

  // Pad JSON chunk to 4-byte boundary
  const jsonPadding = (4 - (jsonChunk.length % 4)) % 4;
  const jsonPadded = jsonChunk + ' '.repeat(jsonPadding);

  // Binary buffer: 3 vertices (x,y,z float32) + 3 indices (uint16)
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);

  const jsonBuffer = new TextEncoder().encode(jsonPadded).buffer;
  const binBuffer = new ArrayBuffer(48);
  new Float32Array(binBuffer, 0, 3).set(positions);
  new Uint16Array(binBuffer, 36, 3).set(indices);

  // GLB header (12 bytes) + JSON chunk header (8 bytes) + JSON + BIN chunk header (8 bytes) + BIN
  const totalLength = 12 + 8 + jsonBuffer.byteLength + 8 + binBuffer.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const uint8 = new Uint8Array(glb);

  // Header
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);          // version
  view.setUint32(8, totalLength, true); // total length

  // JSON chunk
  view.setUint32(12, jsonBuffer.byteLength, true); // chunk length
  view.setUint32(16, 0x4e4f534a, true);            // "JSON"
  uint8.set(new Uint8Array(jsonBuffer), 20);

  // BIN chunk
  const binOffset = 20 + jsonBuffer.byteLength;
  view.setUint32(binOffset, binBuffer.byteLength, true);     // chunk length
  view.setUint32(binOffset + 4, 0x004e4942, true);            // "BIN\0"
  uint8.set(new Uint8Array(binBuffer), binOffset + 8);

  return new File([glb], 'diagnostic-test.glb', { type: 'model/gltf-binary' });
}

/**
 * Formats a DiagnosticResult as a JSON string for copying.
 */
export function formatReport(result: DiagnosticResult): string {
  return JSON.stringify(result, null, 2);
}
