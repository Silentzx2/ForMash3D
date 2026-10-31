import { AppSettings } from '@/types/state';

const STORAGE_KEY = 'minimal3d_settings';
const STORAGE_VERSION = '1.0';

interface StoredSettingsData {
  version: string;
  settings: AppSettings;
  lastUpdated: string;
}

export interface ExportQuickProfile {
  id: string;
  name: string;
  variant: 'source' | 'game_ready' | 'lod_package';
  exportFormat: 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply';
  packageZip: boolean;
  lodSelection?: string;
  includeCollision?: boolean;
  textureResolution?: string;
  isBuiltIn?: boolean;
}

export const DEFAULT_EXPORT_PROFILES: ExportQuickProfile[] = [
  {
    id: 'default-glb',
    name: 'GLB Game-Ready',
    variant: 'game_ready',
    exportFormat: 'glb',
    packageZip: false,
    lodSelection: 'lod0',
    includeCollision: false,
    textureResolution: '2048',
    isBuiltIn: true,
  },
  {
    id: 'unity-mobile',
    name: 'Unity Mobile',
    variant: 'game_ready',
    exportFormat: 'fbx',
    packageZip: false,
    lodSelection: 'lod1',
    includeCollision: true,
    textureResolution: '1024',
    isBuiltIn: true,
  },
  {
    id: 'unreal-high-poly',
    name: 'Unreal High-Poly',
    variant: 'game_ready',
    exportFormat: 'fbx',
    packageZip: true,
    lodSelection: 'lod0',
    includeCollision: true,
    textureResolution: '4096',
    isBuiltIn: true,
  },
  {
    id: 'blender-raw',
    name: 'Blender Raw',
    variant: 'source',
    exportFormat: 'obj',
    packageZip: false,
    lodSelection: 'all',
    includeCollision: false,
    textureResolution: 'original',
    isBuiltIn: true,
  },
];

const PROFILES_STORAGE_KEY = 'formash3d_export_profiles';
const DCC_TARGET_KEY = 'formash3d_last_dcc_target';

/**
 * Settings Persistence Service
 * Handles saving/loading application settings from localStorage
 */
export class SettingsPersistenceService {
  private static instance: SettingsPersistenceService;

  static getInstance(): SettingsPersistenceService {
    if (!SettingsPersistenceService.instance) {
      SettingsPersistenceService.instance = new SettingsPersistenceService();
    }
    return SettingsPersistenceService.instance;
  }

  /**
   * Save settings to localStorage
   */
  saveSettings(settings: AppSettings): void {
    try {
      const data: StoredSettingsData = {
        version: STORAGE_VERSION,
        settings,
        lastUpdated: new Date().toISOString()
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
    }
  }

  /**
   * Load settings from localStorage
   */
  loadSettings(): AppSettings | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const data: StoredSettingsData = JSON.parse(stored);
      
      // Check version compatibility
      if (data.version !== STORAGE_VERSION) {
        console.warn('Settings storage version mismatch, clearing stored settings');
        this.clearSettings();
        return null;
      }

      return data.settings;
    } catch (error) {
      console.error('Failed to load settings from localStorage:', error);
      return null;
    }
  }

  /**
   * Clear all stored settings
   */
  clearSettings(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear stored settings:', error);
    }
  }

  /**
   * Get the last update timestamp
   */
  getLastUpdateTime(): Date | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const data: StoredSettingsData = JSON.parse(stored);
      return new Date(data.lastUpdated);
    } catch (error) {
      console.error('Failed to get last update time:', error);
      return null;
    }
  }

  /**
   * Check if settings exist in localStorage
   */
  hasStoredSettings(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null;
    } catch (error) {
      console.error('Failed to check for stored settings:', error);
      return false;
    }
  }

  /**
   * Get all export quick-profiles (defaults + custom saved)
   */
  getExportProfiles(): ExportQuickProfile[] {
    try {
      if (typeof window === 'undefined') return [...DEFAULT_EXPORT_PROFILES];
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      if (!raw) return [...DEFAULT_EXPORT_PROFILES];
      const userProfiles: ExportQuickProfile[] = JSON.parse(raw);
      return [...DEFAULT_EXPORT_PROFILES, ...userProfiles];
    } catch (error) {
      console.error('Failed to load export quick-profiles:', error);
      return [...DEFAULT_EXPORT_PROFILES];
    }
  }

  /**
   * Save a new or update an existing custom export quick-profile
   */
  saveExportProfile(profile: Omit<ExportQuickProfile, 'id'> & { id?: string }): ExportQuickProfile {
    try {
      if (typeof window === 'undefined') {
        return { ...profile, id: profile.id || `profile-${Date.now()}`, isBuiltIn: false };
      }
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      const existing: ExportQuickProfile[] = raw ? JSON.parse(raw) : [];
      const newId = profile.id || `profile-${Date.now()}`;
      const updatedProfile: ExportQuickProfile = {
        ...profile,
        id: newId,
        isBuiltIn: false,
      };

      const index = existing.findIndex(p => p.id === newId);
      if (index >= 0) {
        existing[index] = updatedProfile;
      } else {
        existing.push(updatedProfile);
      }

      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(existing));
      return updatedProfile;
    } catch (error) {
      console.error('Failed to save export quick-profile:', error);
      return { ...profile, id: profile.id || `profile-${Date.now()}`, isBuiltIn: false };
    }
  }

  /**
   * Delete a custom export quick-profile by id
   */
  deleteExportProfile(id: string): boolean {
    try {
      if (typeof window === 'undefined') return false;
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      if (!raw) return false;
      const existing: ExportQuickProfile[] = JSON.parse(raw);
      const filtered = existing.filter(p => p.id !== id);
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error('Failed to delete export quick-profile:', error);
      return false;
    }
  }

  /**
   * Get last-used DCC target
   */
  getLastDccTarget(): string | null {
    try {
      if (typeof window === 'undefined') return null;
      return localStorage.getItem(DCC_TARGET_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Save last-used DCC target
   */
  setLastDccTarget(target: string): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(DCC_TARGET_KEY, target);
    } catch (error) {
      console.error('Failed to save last-used DCC target:', error);
    }
  }

  /**
   * Load custom keybinding overrides from localStorage
   */
  loadCustomShortcuts(): Record<string, string> {
    try {
      if (typeof window === 'undefined') return {};
      const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (error) {
      console.error('Failed to load custom shortcuts:', error);
      return {};
    }
  }

  /**
   * Save a single custom keybinding override
   */
  saveCustomShortcut(id: string, keyCombo: string): void {
    try {
      if (typeof window === 'undefined') return;
      const current = this.loadCustomShortcuts();
      current[id] = keyCombo;
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(current));
    } catch (error) {
      console.error('Failed to save custom shortcut:', error);
    }
  }

  /**
   * Reset a single shortcut back to default
   */
  resetCustomShortcut(id: string): void {
    try {
      if (typeof window === 'undefined') return;
      const current = this.loadCustomShortcuts();
      delete current[id];
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(current));
    } catch (error) {
      console.error('Failed to reset custom shortcut:', error);
    }
  }

  /**
   * Reset all custom shortcuts back to defaults
   */
  resetAllShortcuts(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to reset all shortcuts:', error);
    }
  }

  /**
   * Get active effective shortcuts map (default fallback + custom overrides)
   */
  getEffectiveShortcuts(): Record<string, string> {
    const overrides = this.loadCustomShortcuts();
    const effective: Record<string, string> = {};
    for (const item of DEFAULT_WORKSPACE_SHORTCUTS) {
      effective[item.id] = overrides[item.id] || item.defaultKey;
    }
    return effective;
  }
}

const SHORTCUTS_STORAGE_KEY = 'formash3d_custom_shortcuts';

export interface ShortcutDefinition {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  category: 'general' | 'tools' | 'navigation' | 'viewport';
}

export const DEFAULT_WORKSPACE_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'command-palette', name: 'Command Palette', description: 'Open global search and command palette', defaultKey: 'Ctrl/Cmd + K', category: 'general' },
  { id: 'quick-save', name: 'Quick Snapshot', description: 'Save current workspace snapshot', defaultKey: 'Ctrl/Cmd + S', category: 'general' },
  { id: 'tool-model', name: '3D Generation Tool', description: 'Switch to 3D AI Generation Studio', defaultKey: 'G', category: 'tools' },
  { id: 'tool-remesh', name: 'Quad Retopology', description: 'Switch to FastMesh Quad Retopology', defaultKey: 'R', category: 'tools' },
  { id: 'tool-texture', name: 'AI Texturing', description: 'Switch to AI PBR Texturing', defaultKey: 'T', category: 'tools' },
  { id: 'tool-uv', name: 'UV Unwrapping', description: 'Switch to PartUV Atlas Unwrapping', defaultKey: 'U', category: 'tools' },
  { id: 'tool-edit', name: 'Mesh Transform / Edit', description: 'Switch to 3D Transform Gizmo', defaultKey: 'E', category: 'tools' },
  { id: 'tool-animation', name: 'Animation / Motion', description: 'Switch to Skeletal Animation', defaultKey: 'A', category: 'tools' },
  { id: 'tool-rigging', name: 'Auto-Rigging', description: 'Switch to UniRig Armature', defaultKey: 'K', category: 'tools' },
  { id: 'tool-segment', name: 'Mesh Segmentation', description: 'Switch to Mesh Segmentation', defaultKey: 'S', category: 'tools' },
  { id: 'nav-dashboard', name: 'Dashboard', description: 'Navigate to Command Center', defaultKey: 'Ctrl/Cmd + 1', category: 'navigation' },
  { id: 'nav-assets', name: 'Assets Library', description: 'Navigate to Asset Outputs', defaultKey: 'Ctrl/Cmd + 2', category: 'navigation' },
  { id: 'nav-jobs', name: 'Jobs & Execution', description: 'Navigate to Task & Job Queue', defaultKey: 'Ctrl/Cmd + 3', category: 'navigation' },
  { id: 'nav-logs', name: 'System Logs', description: 'Open System Telemetry & Logs', defaultKey: 'Ctrl/Cmd + 4', category: 'navigation' },
  { id: 'nav-settings', name: 'Preferences', description: 'Open Studio Settings', defaultKey: 'Ctrl/Cmd + ,', category: 'navigation' },
  { id: 'view-fit', name: 'Fit Model to Viewport', description: 'Frame camera around model bounds', defaultKey: 'F', category: 'viewport' },
  { id: 'view-home', name: 'Reset Camera Home', description: 'Reset camera to default isometric view', defaultKey: 'Home', category: 'viewport' },
];

// Export singleton instance
export const settingsPersistence = SettingsPersistenceService.getInstance(); 