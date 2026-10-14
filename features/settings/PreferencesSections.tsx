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

export function ShortcutsSection() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Keyboard Shortcuts</h1>
        <p className="text-muted-foreground mt-2">Customize your keyboard shortcuts for faster workflow.</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={KeyboardIcon} size={16} className="w-5 h-5" />
            Active Shortcuts
          </CardTitle>
          <CardDescription>Default keyboard shortcuts available in the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
              <span>Open Command Palette</span>
              <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">Ctrl/Cmd + K</kbd>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
              <span>Toggle Fullscreen Viewer</span>
              <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">F</kbd>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
              <span>Focus Prompt Input</span>
              <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">/</kbd>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
              <span>Quick Save</span>
              <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">Ctrl/Cmd + S</kbd>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-6 text-center">Custom keybinding support is coming in a future update.</p>
        </CardContent>
      </Card>
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
