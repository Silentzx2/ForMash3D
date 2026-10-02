/**
 * Client-side validation for 3D file uploads.
 * Validates extension, MIME type, file size, and format-specific structure.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export type FileValidationContext = 'upload' | 'preview';

const ALLOWED_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];

const ALLOWED_MIME_TYPES = [
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
  'text/plain',
];

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB for backend upload
const MAX_PREVIEW_SIZE = 150 * 1024 * 1024; // 150MB for local preview

// GLB magic bytes: "glTF" in ASCII (little-endian uint32 = 0x46546C67)
const GLB_MAGIC_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

function readFileBytes(file: File, start: number, end: number): Promise<ArrayBuffer> {
  return file.slice(start, end).arrayBuffer();
}

function readFileText(file: File, start: number, end: number): Promise<string> {
  return file.slice(start, end).text();
}

async function validateGlbStructure(file: File): Promise<Pick<ValidationResult, 'error' | 'warnings'>> {
  const warnings: string[] = [];
  const header = await readFileBytes(file, 0, 12);
  const bytes = new Uint8Array(header);

  // Check magic bytes
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== GLB_MAGIC_BYTES[i]) {
      return { error: 'Invalid GLB file: missing glTF magic bytes. File may be corrupted or not a valid GLB.' };
    }
  }

  // Check version
  const view = new DataView(header);
  const version = view.getUint32(4, true);
  if (version !== 1 && version !== 2) {
    warnings.push(`Unexpected GLB version ${version}. Parser will attempt to load.`);
  }

  // Verify declared length matches actual file size (truncation check)
  const declaredLength = view.getUint32(8, true);
  if (file.size < declaredLength) {
    return {
      error: `GLB file appears truncated. Header declares ${declaredLength} bytes, but file is ${file.size} bytes.`,
    };
  }

  return { warnings };
}

async function validateGltfStructure(file: File): Promise<Pick<ValidationResult, 'error' | 'warnings'>> {
  const preview = await readFileText(file, 0, 200);
  const trimmed = preview.trim();

  // GLTF must start with { for JSON
  if (!trimmed.startsWith('{')) {
    return { error: 'Invalid GLTF file: does not contain valid JSON structure.' };
  }

  // Check for required "asset" field (GLTF spec requirement)
  if (!trimmed.includes('"asset"')) {
    return { error: 'Invalid GLTF file: missing required "asset" field.' };
  }

  return {};
}

async function validateObjStructure(file: File): Promise<Pick<ValidationResult, 'error' | 'warnings'>> {
  const preview = await readFileText(file, 0, 500);

  // OBJ files contain vertex data ("v ") or comments ("#")
  if (!preview.includes('v ') && !preview.startsWith('#')) {
    return { error: 'Invalid OBJ file: no vertex data or comments found.' };
  }

  return {};
}

/**
 * Validates a 3D file for upload or preview.
 * Checks extension, MIME type, file size, and format-specific structure.
 *
 * @param file - The File object to validate
 * @param context - 'upload' (100MB limit) or 'preview' (150MB limit)
 * @returns ValidationResult with valid flag, optional error message, and warnings
 */
export async function validate3DFile(
  file: File,
  context: FileValidationContext = 'preview'
): Promise<ValidationResult> {
  const warnings: string[] = [];

  // 1. Validate file extension
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file format ".${ext}". Allowed formats: ${ALLOWED_EXTENSIONS.map(e => e.toUpperCase()).join(', ')}.`,
    };
  }

  // 2. Validate MIME type (warn only — browsers often report octet-stream for 3D files)
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    warnings.push(`Unrecognized MIME type "${file.type}". File will be validated by content.`);
  }

  // 3. Validate file size
  const maxSize = context === 'upload' ? MAX_UPLOAD_SIZE : MAX_PREVIEW_SIZE;
  if (file.size > maxSize) {
    const limitMB = maxSize / (1024 * 1024);
    return {
      valid: false,
      error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum size for ${context === 'upload' ? 'upload' : 'preview'} is ${limitMB}MB.`,
    };
  }

  // 4. Format-specific structure validation
  try {
    let formatResult: Pick<ValidationResult, 'error' | 'warnings'> = {};

    if (ext === 'glb') {
      formatResult = await validateGlbStructure(file);
    } else if (ext === 'gltf') {
      formatResult = await validateGltfStructure(file);
    } else if (ext === 'obj') {
      formatResult = await validateObjStructure(file);
    }
    // STL, FBX, PLY: extension + MIME + size checks are sufficient for client-side

    if (formatResult.error) {
      return { valid: false, error: formatResult.error };
    }
    if (formatResult.warnings) {
      warnings.push(...formatResult.warnings);
    }
  } catch (err) {
    return {
      valid: false,
      error: `Failed to read file content: ${err instanceof Error ? err.message : 'unknown error'}.`,
    };
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}
