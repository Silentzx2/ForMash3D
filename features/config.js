// ForMash3D Compatibility Bridge for Migrated 3DGenStudio Components
// Points to Next.js routes and FastAPI backend endpoints

export const SERVER_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
export const API_BASE = `${SERVER_ORIGIN}/api/v1`;

// Build a URL to a static asset served from ForMash3D backend
export function assetUrl(pathOrFilename) {
  if (!pathOrFilename) return '';
  if (pathOrFilename.startsWith('http://') || pathOrFilename.startsWith('https://') || pathOrFilename.startsWith('blob:')) {
    return pathOrFilename;
  }
  return `${SERVER_ORIGIN}/static/${encodeURI(pathOrFilename)}`;
}

// Build a URL to bundled resources (e.g. presets, VFX spritesheets, textures)
export function resourceUrl(pathOrFilename) {
  if (!pathOrFilename) return '';
  if (pathOrFilename.startsWith('/')) {
    return pathOrFilename;
  }
  return `/resources/${encodeURI(pathOrFilename)}`;
}
