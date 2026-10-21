const WORKSPACE_TOOL_SEGMENTS = new Set([
  'generate', 'model', '3d-gen', 'remesh', 'texture', 'textures', 'uv',
  'segment', 'edit', 'upscale', 'pbr', 'animation', 'animate', 'rigging',
]);

const WORKSPACE_VIEW_SEGMENTS = new Set([
  'overview', 'dashboard', 'assets', 'outputs', 'system', 'jobs', 'models',
]);

/**
 * Validate the path handled by app/workspace/[...tool].
 * Jobs may have one additional path segment for a job detail URL.
 */
export function isKnownWorkspaceRoute(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  const [first, ...rest] = segments;
  if (first === 'jobs') {
    return rest.length <= 1 && rest.every((segment) => segment.length > 0);
  }
  if (rest.length !== 0) return false;
  return WORKSPACE_TOOL_SEGMENTS.has(first) || WORKSPACE_VIEW_SEGMENTS.has(first);
}
