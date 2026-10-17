"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { HugeiconsIcon } from '@hugeicons/react';
import { BellIcon, KeyboardIcon, NetworkIcon, RotateCcwIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function NotificationsSection({ onSaveRegister }: { onSaveRegister?: (save: () => Promise<void>) => void }) {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('notificationSettings');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return {
      emailAlerts: true,
      pushNotifications: false,
      jobCompletion: true,
      systemUpdates: true,
      marketing: false
    };
  });

  // Register save function with parent for section-switch saving
  useEffect(() => {
    if (onSaveRegister) {
      onSaveRegister(async () => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('notificationSettings', JSON.stringify(settings));
        }
      });
    }
  }, [onSaveRegister, settings]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground mt-2">Manage how you receive alerts and updates.</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={BellIcon} size={16} className="w-5 h-5" />
            Alert Preferences
          </CardTitle>
          <CardDescription>Choose what events trigger a notification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Push Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive browser push notifications.</p>
            </div>
            <Switch checked={settings.pushNotifications} onCheckedChange={(v) => setSettings({...settings, pushNotifications: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Alerts</Label>
              <p className="text-sm text-muted-foreground">Receive emails for important events.</p>
            </div>
            <Switch checked={settings.emailAlerts} onCheckedChange={(v) => setSettings({...settings, emailAlerts: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Job Completion</Label>
              <p className="text-sm text-muted-foreground">Notify when a generation job finishes.</p>
            </div>
            <Switch checked={settings.jobCompletion} onCheckedChange={(v) => setSettings({...settings, jobCompletion: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>System Updates</Label>
              <p className="text-sm text-muted-foreground">Notify when new models or features are available.</p>
            </div>
            <Switch checked={settings.systemUpdates} onCheckedChange={(v) => setSettings({...settings, systemUpdates: v})} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { settingsPersistence, DEFAULT_WORKSPACE_SHORTCUTS, ShortcutDefinition } from '@/services/settingsPersistence';

export function ShortcutsSection() {
  const [customShortcuts, setCustomShortcuts] = useState<Record<string, string>>(() => {
    return settingsPersistence.loadCustomShortcuts();
  });
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<{
    id: string;
    conflictingName: string;
    keyCombo: string;
  } | null>(null);

  // Key recording listener
  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === 'Escape') {
        setRecordingId(null);
        setConflictWarning(null);
        return;
      }

      // Ignore pure modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      // Format combo string
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl/Cmd');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let mainKey = e.key;
      if (mainKey === ' ') mainKey = 'Space';
      else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();

      parts.push(mainKey);
      const combo = parts.join(' + ');

      // Conflict detection against other shortcuts
      const conflicting = DEFAULT_WORKSPACE_SHORTCUTS.find((other) => {
        if (other.id === recordingId) return false;
        const otherCombo = customShortcuts[other.id] || other.defaultKey;
        return otherCombo.toLowerCase() === combo.toLowerCase();
      });

      if (conflicting) {
        setConflictWarning({
          id: recordingId,
          conflictingName: conflicting.name,
          keyCombo: combo,
        });
        return;
      }

      // No conflict: save and exit recording
      settingsPersistence.saveCustomShortcut(recordingId, combo);
      setCustomShortcuts(settingsPersistence.loadCustomShortcuts());
      setRecordingId(null);
      setConflictWarning(null);
      toast.success(`Shortcut updated: ${combo}`);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingId, customShortcuts]);

  const handleResetSingle = (id: string) => {
    settingsPersistence.resetCustomShortcut(id);
    setCustomShortcuts(settingsPersistence.loadCustomShortcuts());
    toast.success('Shortcut reset to default');
  };

  const handleResetAll = () => {
    settingsPersistence.resetAllShortcuts();
    setCustomShortcuts({});
    setConflictWarning(null);
    setRecordingId(null);
    toast.success('All shortcuts reset to defaults');
  };

  const hasAnyOverrides = Object.keys(customShortcuts).length > 0;

  const categories: { key: ShortcutDefinition['category']; label: string }[] = [
    { key: 'tools', label: 'Tool Switching' },
    { key: 'navigation', label: 'Navigation & Screens' },
    { key: 'viewport', label: '3D Viewport Controls' },
    { key: 'general', label: 'General & Actions' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[hsl(var(--foreground))]">Keyboard Shortcuts</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Click any shortcut badge to record a new key combination. Remapped keys persist across sessions.
          </p>
        </div>
        {hasAnyOverrides && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetAll}
            className="flex items-center gap-1.5 border-[hsl(var(--border))] text-xs cursor-pointer hover:bg-[hsl(var(--surface-2))]"
          >
            <HugeiconsIcon icon={RotateCcwIcon} size={14} />
            <span>Reset All to Defaults</span>
          </Button>
        )}
      </div>

      {conflictWarning && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="text-amber-400 shrink-0" />
            <span>
              <strong>Key Conflict:</strong> <kbd className="px-1.5 py-0.5 rounded bg-black/40 font-mono text-amber-200">{conflictWarning.keyCombo}</kbd> is already bound to <strong>{conflictWarning.conflictingName}</strong>. Choose another combination.
            </span>
          </div>
          <button
            onClick={() => setConflictWarning(null)}
            className="text-amber-400 hover:text-white text-xs underline cursor-pointer ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {categories.map(({ key, label }) => {
        const items = DEFAULT_WORKSPACE_SHORTCUTS.filter((s) => s.category === key);
        if (items.length === 0) return null;

        return (
          <Card key={key} className="bg-[hsl(var(--surface-1))] border-[hsl(var(--border))]">
            <CardHeader className="py-3 px-4 border-b border-[hsl(var(--border))]">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[hsl(var(--foreground))]">
                <HugeiconsIcon icon={KeyboardIcon} size={16} className="w-4 h-4 text-primary" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 divide-y divide-[hsl(var(--border))]/50">
              {items.map((shortcut) => {
                const isCustomized = Boolean(customShortcuts[shortcut.id]);
                const effectiveKey = customShortcuts[shortcut.id] || shortcut.defaultKey;
                const isRecording = recordingId === shortcut.id;

                return (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between py-2.5 px-2 hover:bg-[hsl(var(--surface-2))]/40 rounded-md transition-colors"
                  >
                    <div className="min-w-0 pr-4">
                      <div className="text-xs font-medium text-[hsl(var(--foreground))] flex items-center gap-2">
                        <span>{shortcut.name}</span>
                        {isCustomized && (
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-primary/20 text-primary border border-primary/30">
                            Custom
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                        {shortcut.description}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (isRecording) {
                            setRecordingId(null);
                            setConflictWarning(null);
                          } else {
                            setRecordingId(shortcut.id);
                            setConflictWarning(null);
                          }
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all cursor-pointer ${
                          isRecording
                            ? 'bg-primary text-black ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] animate-pulse font-bold'
                            : isCustomized
                            ? 'bg-[hsl(var(--surface-3))] text-primary border border-primary/40 hover:border-primary'
                            : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--foreground))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))]'
                        }`}
                        title="Click to record new key combination"
                      >
                        {isRecording ? 'Press keys (Esc to cancel)...' : effectiveKey}
                      </button>

                      {isCustomized && (
                        <button
                          type="button"
                          onClick={() => handleResetSingle(shortcut.id)}
                          className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-white hover:bg-[hsl(var(--surface-3))] transition-colors"
                          title="Reset to default key"
                        >
                          <HugeiconsIcon icon={RotateCcwIcon} size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function NetworkSection({ onSaveRegister }: { onSaveRegister?: (save: () => Promise<void>) => void }) {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('networkSettings');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return {
      offlineMode: false,
      proxyEnabled: false,
      autoSync: true
    };
  });
  
  // Register save function with parent for section-switch saving
  useEffect(() => {
    if (onSaveRegister) {
      onSaveRegister(async () => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('networkSettings', JSON.stringify(settings));
        }
      });
    }
  }, [onSaveRegister, settings]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Network</h1>
        <p className="text-muted-foreground mt-2">Configure network connectivity and syncing behavior.</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={NetworkIcon} size={16} className="w-5 h-5" />
            Connectivity
          </CardTitle>
          <CardDescription>Manage how the application connects to remote services.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Offline Mode</Label>
              <p className="text-sm text-muted-foreground">Force the application to work offline when possible.</p>
            </div>
            <Switch checked={settings.offlineMode} onCheckedChange={(v) => setSettings({...settings, offlineMode: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto Sync</Label>
              <p className="text-sm text-muted-foreground">Automatically sync workspace data with the backend.</p>
            </div>
            <Switch checked={settings.autoSync} onCheckedChange={(v) => setSettings({...settings, autoSync: v})} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdvancedSection({ onSaveRegister }: { onSaveRegister?: (save: () => Promise<void>) => void }) {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('advancedSettings');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return {
      experimentalFeatures: false,
      hardwareAcceleration: true,
      debugMode: false,
    };
  });

  // Register save function with parent for section-switch saving
  useEffect(() => {
    if (onSaveRegister) {
      onSaveRegister(async () => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('advancedSettings', JSON.stringify(settings));
        }
      });
    }
  }, [onSaveRegister, settings]);

  const handleResetDefaults = () => {
    const keysToReset = [
      'notificationSettings',
      'networkSettings',
      'advancedSettings',
      'generationSettings',
      'uiPreferences',
      'SETTINGS_RAY_TRACING',
      'SETTINGS_ANTI_ALIASING',
      'SETTINGS_AUTOSAVE_INTERVAL',
      'gen_advanced_settings',
      'ai3d:pipelines:notifications:v1',
      'ai3d:pipelines:workflows:v1',
      'ai3d:pipelines:presets:v1',
      'ai3d:pipelines:compare:v1'
    ];

    if (typeof window !== 'undefined') {
      keysToReset.forEach(key => localStorage.removeItem(key));
      toast.success("Settings have been reset to factory defaults.");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Advanced</h1>
        <p className="text-muted-foreground mt-2">Configure advanced system behaviors.</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={RotateCcwIcon} size={16} className="w-5 h-5" />
            System Behaviors
          </CardTitle>
          <CardDescription>Warning: These settings can affect performance and stability.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Hardware Acceleration</Label>
              <p className="text-sm text-muted-foreground">Use GPU for 3D viewer rendering (Recommended).</p>
            </div>
            <Switch checked={settings.hardwareAcceleration} onCheckedChange={(v) => setSettings({...settings, hardwareAcceleration: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Experimental Features</Label>
              <p className="text-sm text-muted-foreground">Enable beta features that are still in development.</p>
            </div>
            <Switch checked={settings.experimentalFeatures} onCheckedChange={(v) => setSettings({...settings, experimentalFeatures: v})} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Debug Mode</Label>
              <p className="text-sm text-muted-foreground">Output detailed logs to the browser console.</p>
            </div>
            <Switch checked={settings.debugMode} onCheckedChange={(v) => setSettings({...settings, debugMode: v})} />
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6 bg-muted/20">
          <div className="flex flex-col space-y-4 w-full">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-destructive">Danger Zone</h4>
              <p className="text-sm text-muted-foreground">This action cannot be undone and will reset your preferences across the application.</p>
            </div>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-fit gap-2">
                  <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4" />
                  Reset to Defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently reset all non-critical configurations (UI preferences, notifications, and advanced settings) back to their initial factory state. You will lose all customized preferences.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={handleResetDefaults}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Reset Everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
