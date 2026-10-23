export function requireUploadFileId(fileId: unknown, fileType: 'image' | 'mesh'): string {
  const normalizedId = typeof fileId === 'string' ? fileId.trim() : '';
  if (!normalizedId) {
    throw new Error(`The backend did not return a file ID for the ${fileType} upload. Check the server response and try again.`);
  }
  return normalizedId;
}

export function resolveUploadedImageName(customName: string | undefined, fileName: string): string {
  return customName?.trim() || fileName;
}