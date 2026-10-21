const WORKSPACE_TOOL_SEGMENTS = new Set([
  'generate', 'model', '3d-gen', 'remesh', 'texture', 'textures', 'uv',
  'segment', 'edit', 'upscale', 'pbr', 'animation', 'animate', 'rigging', 'tools',
]);

const WORKSPACE_VIEW_SEGMENTS = new Set([
  'overview', 'dashboard', 'assets', 'outputs', 'system', 'jobs', 'models',
]);

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the path handled by app/workspace/[...tool].
 * Deep links may append one UUID job ID to a valid tool or use /jobs/{id}.
 */
export function isKnownWorkspaceRoute(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  const [first, ...rest] = segments;

  if (first === 'jobs') {
    return rest.length === 0 || (rest.length === 1 && JOB_ID_PATTERN.test(rest[0]));
  }

  if (rest.length === 1 && WORKSPACE_TOOL_SEGMENTS.has(first)) {
    return JOB_ID_PATTERN.test(rest[0]);
  }
  if (rest.length !== 0) return false;
  return WORKSPACE_TOOL_SEGMENTS.has(first) || WORKSPACE_VIEW_SEGMENTS.has(first);
}
