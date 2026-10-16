export function getUploadPercent(loadedBytes: number, totalBytes: number | null): number | null {
  if (!Number.isFinite(loadedBytes) || loadedBytes < 0 || !Number.isFinite(totalBytes) || totalBytes === null || totalBytes <= 0) {
    return null;
  }
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
}