type ArtifactFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply' | 'zip';

type DownloadOptions = {
  fetcher?: typeof fetch;
  save?: (blob: Blob, filename: string) => void;
};

const EXPECTED_CONTENT_TYPES: Record<ArtifactFormat, string[]> = {
  glb: ['model/gltf-binary', 'application/octet-stream'],
  gltf: ['model/gltf+json'],
  fbx: ['model/fbx', 'application/octet-stream'],
  obj: ['application/wavefront-obj', 'model/obj', 'text/plain', 'application/octet-stream'],
  stl: ['model/stl', 'application/octet-stream'],
  ply: ['model/ply', 'application/octet-stream'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let filename = fallback;
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded.trim());
    } catch {
      filename = fallback;
    }
  } else if (plain) {
    filename = (plain[1] || plain[2]).trim();
  }
  return filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '') || fallback;
}

async function responseError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const text = await response.clone().text();
    try {
      const payload = JSON.parse(text);
      const value = payload?.detail ?? payload?.message ?? payload?.error;
      detail = typeof value === 'string' ? value : '';
    } catch {
      if (text && !/^\s*</.test(text)) detail = text.trim().slice(0, 300);
    }
  } catch {
    // The HTTP status remains actionable when an error body cannot be read.
  }
  return new Error(detail ? `Download failed (HTTP ${response.status}): ${detail}` : `Download failed (HTTP ${response.status}).`);
}

async function rejectErrorPayload(blob: Blob, format: ArtifactFormat): Promise<void> {
  if (format === 'gltf') {
    let payload: unknown;
    try {
      payload = JSON.parse(await blob.text());
    } catch {
      throw new Error('The server returned invalid glTF JSON instead of a downloadable artifact.');
    }
    if (!payload || typeof payload !== 'object' || !('asset' in payload)) {
      throw new Error('The server returned JSON without a glTF asset. Retry the export or check that the artifact is available.');
    }
    return;
  }

  const prefix = await blob.slice(0, 512).text();
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith('<')) {
    throw new Error('The server returned an HTML error page instead of the requested artifact. Check the artifact URL and retry.');
  }
  if (format === 'glb' && !prefix.startsWith('glTF')) {
    throw new Error('The server response is not a valid GLB file. Refresh the asset and retry.');
  }
  if (format === 'fbx' && !/^(?:Kaydara FBX Binary|;\s*FBX|FBXHeaderExtension:)/.test(trimmed)) {
    throw new Error('The server response is not a valid FBX file. Verify the rig artifact is available and retry.');
  }
  if (trimmed.startsWith('{') && /"(?:detail|error|message)"\s*:/.test(trimmed)) {
    let payload: { detail?: unknown; error?: unknown; message?: unknown };
    try {
      payload = JSON.parse(trimmed);
    } catch {
      throw new Error('The server returned a JSON error payload instead of the requested artifact. Check the artifact URL and retry.');
    }
    const detail = payload.detail ?? payload.message ?? payload.error;
    if (detail) {
      throw new Error(typeof detail === 'string' ? detail : 'The server returned an error payload instead of the requested artifact.');
    }
  }
}

function saveArtifact(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

export async function downloadArtifact(
  url: string,
  filename: string,
  format: ArtifactFormat,
  { fetcher = fetch, save = saveArtifact }: DownloadOptions = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(url, { credentials: 'same-origin' });
  } catch (error) {
    throw new Error(`Could not reach the artifact download endpoint. Check your connection and retry. ${error instanceof Error ? error.message : ''}`.trim());
  }

  if (!response.ok) throw await responseError(response);

  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!EXPECTED_CONTENT_TYPES[format].includes(contentType)) {
    throw new Error(`The server returned ${contentType || 'no content type'} instead of a ${format.toUpperCase()} artifact. The file may be missing or expired; refresh the asset and retry.`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error('The server returned an empty artifact. Retry the export.');
  await rejectErrorPayload(blob, format);
  save(blob, responseFilename(response, filename));
}