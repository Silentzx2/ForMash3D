import { useAppStore } from '@/stores/useAppStore';
import { useViewerStore } from '@/stores/useViewerStore';
import type { ShadingPreset } from '@/stores/useViewerStore';

export function shadingModeToPreset(mode: string): ShadingPreset {
  const map: Record<string, ShadingPreset> = {
    'textured': 'default',
    'clay': 'clay',
    'matcap-gold': 'gold',
    'matcap-normal': 'normal',
    'matcap-chrome': 'metallic',
    'matcap-ceramic': 'clay',
    'matcap-turquoise': 'cyberpunk',
    'wireframe': 'wireframe',
    'xray': 'default',
    'pbr': 'default',
    'normals': 'normal',
    'matcap': 'default',
  };
  return map[mode] ?? 'default';
}

export function presetToShadingMode(preset: ShadingPreset): string {
  const map: Record<ShadingPreset, string> = {
    'default': 'textured',
    'clay': 'clay',
    'metallic': 'matcap-chrome',
    'wireframe': 'wireframe',
    'normal': 'normals',
    'gold': 'matcap-gold',
    'cyberpunk': 'matcap-turquoise',
    'uv': 'textured',
  };
  return map[preset] ?? 'textured';
}

export { useAppStore, useViewerStore };
