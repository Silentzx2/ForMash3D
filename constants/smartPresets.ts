/**
 * Fallback output-preset recipes used by the Generate panel when the backend
 * preset catalogue cannot be fetched.
 *
 * The backend definition in backend/config/smart_presets.yaml is the source of
 * truth. This table only mirrors the fields the panel applies, and
 * backend/tests/test_smart_preset_parity.py fails when the two drift apart.
 */
import fallback from './smartPresetFallback.json';

export interface SmartPresetFallback {
  label: string;
  target_polycount: number;
  texture_resolution: number;
  generate_lod: boolean;
  lod_preset: string;
  lod_count: number;
  collision: boolean;
  enable_auto_rig: boolean;
  enable_printability_check: boolean;
  enable_auto_repair: boolean;
}

export const SMART_PRESET_FALLBACK = fallback as unknown as Record<string, SmartPresetFallback>;
