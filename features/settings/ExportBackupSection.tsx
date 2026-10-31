"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download01Icon, Upload01Icon, AlertCircleIcon, CheckIcon, Copy01Icon } from '@hugeicons/core-free-icons';
import { useSystemSettings } from '@/hooks/useBackendData';
import { toast } from 'sonner';

export function ExportBackupSection() {
  const { settings } = useSystemSettings();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);

  const handleCopyConfig = async () => {
    try {
      const keysToBackup = [
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
        'ai3d:pipelines:compare:v1',
        'ai3d:settings:sidebarOpen'
      ];

      const localData: Record<string, string | null> = {};
      keysToBackup.forEach(key => {
        localData[key] = localStorage.getItem(key);
      });

      const dataToExport = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        settings: settings || {},
        localStorage: localData
      };

      const jsonString = JSON.stringify(dataToExport, null, 2);
      await navigator.clipboard.writeText(jsonString);
      toast.success('Configuration copied to clipboard!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to copy configuration.');
    }
  };

  const handleExport = () => {
    setExporting(true);
    setStatus(null);
    try {
      // Gather data to export
      const keysToBackup = [
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
        'ai3d:pipelines:compare:v1',
        'ai3d:settings:sidebarOpen'
      ];

      const localData: Record<string, string | null> = {};
      keysToBackup.forEach(key => {
        localData[key] = localStorage.getItem(key);
      });

      const dataToExport = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        settings: settings || {},
        localStorage: localData
      };

      const jsonString = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `formash-3d-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setStatus({ type: 'success', message: 'Settings exported successfully.' });
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Failed to export settings.' });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setStatus(null);
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const data = JSON.parse(content);
        
        // Basic validation
        if (!data.version) throw new Error('Invalid backup file format');

        // Restore local storage if present
        if (data.localStorage && typeof data.localStorage === 'object') {
          Object.keys(data.localStorage).forEach(key => {
            const val = data.localStorage[key];
            if (val !== null && val !== undefined) {
              localStorage.setItem(key, val);
            }
          });
        }
        
        setStatus({ type: 'success', message: 'Settings restored successfully. Please refresh the page.' });
      } catch (error) {
        console.error(error);
        setStatus({ type: 'error', message: 'Failed to restore settings. Invalid file format.' });
      } finally {
        setImporting(false);
      }
    };
    reader.onerror = () => {
      setStatus({ type: 'error', message: 'Failed to read the file.' });
      setImporting(false);
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Export & Backup</h1>
          <p className="text-muted-foreground mt-2">Export your environment settings or restore from a previous backup.</p>
        </div>
        <Button onClick={handleCopyConfig} variant="outline" className="flex items-center gap-2 self-start">
          <HugeiconsIcon icon={Copy01Icon} size={16} className="w-4 h-4" />
          Copy Configuration
        </Button>
      </div>
      
      {status && (
        <div className={`p-4 rounded-lg flex items-start gap-3 border ${
          status.type === 'success' ? 'bg-[hsl(var(--neon-green))]/10 border-[hsl(var(--neon-green))]/20 text-[hsl(var(--neon-green))]' : 'bg-[hsl(var(--destructive))]/10 border-[hsl(var(--destructive))]/20 text-[hsl(var(--destructive))]'
        }`}>
          {status.type === 'success' ? <HugeiconsIcon icon={CheckIcon} size={16} className="w-5 h-5 mt-0.5" /> : <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-5 h-5 mt-0.5" />}
          <div>
            <p className="font-medium">{status.type === 'success' ? 'Success' : 'Error'}</p>
            <p className="text-sm mt-1">{status.message}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={Download01Icon} size={16} className="w-5 h-5" />
              Export Settings
            </CardTitle>
            <CardDescription>Download a JSON backup of your current configurations and preferences.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This will include your general settings, UI preferences, and generation parameters. It does NOT include any 3D models or generated assets.
            </p>
             <Button variant="default" onClick={handleExport} disabled={exporting} className="w-full">
                {exporting ? 'Exporting...' : 'Download Backup File'}
              </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={Upload01Icon} size={16} className="w-5 h-5" />
              Restore Backup
            </CardTitle>
            <CardDescription>Upload a previously exported JSON backup file to restore settings.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Restoring will overwrite your current preferences. You may need to refresh the page after restoring for all changes to take effect.
            </p>
            <div className="relative">
              <input 
                type="file" 
                accept=".json" 
                onChange={handleImport}
                disabled={importing}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
              />
              <Button variant="outline" disabled={importing} className="w-full">
                {importing ? 'Restoring...' : 'Select Backup File'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
