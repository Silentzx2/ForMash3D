import React, { useState, useEffect } from 'react';
import { 
  Server, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Wrench
} from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';
import { apiClient } from '../lib/api';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    systemStats,
    refreshSystemStats,
    generationSettings,
    setGenerationSettings
  } = useWorkspace();

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSettingsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  const [host, setHost] = useState(() => {
    // Load saved host from localStorage or use default
    try { return localStorage.getItem('ai3d_api_host') || apiClient.getBaseUrl(); } catch { return apiClient.getBaseUrl(); }
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const nodeCount = systemStats.status === 'online' ? 1 : 0;
  const nodeError = systemStats.status === 'offline' ? 'Backend is offline' : null;

  if (!isSettingsOpen) return null;

  const handleSave = () => {
    // Persist host URL to localStorage and update apiClient
    try { localStorage.setItem('ai3d_api_host', host); } catch { /* ignore */ }
    apiClient.setBaseUrl(host);
    setIsSettingsOpen(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const stats = await apiClient.getSystemStats();
    setTesting(false);
    if (stats.status === 'online') {
      setTestResult({ success: true, msg: 'Connected to ForMash 3D backend successfully.' });
      refreshSystemStats();
    } else {
      setTestResult({ success: false, msg: `Backend server unreachable. Ensure FastAPI is running.` });
      refreshSystemStats();
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setIsSettingsOpen(false); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-4 select-none animate-in fade-in duration-200"
    >
      <div className="w-full max-w-xl max-w-[calc(100vw-1.5rem)] max-h-[90vh] rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-[hsl(var(--surface-2))] border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Backend Configuration</h3>
              <p className="text-[11px] text-zinc-400">Connect to local or cloud 3D Generation Pipeline</p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4 text-xs bg-[hsl(var(--surface-0))] flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
          {/* Host & Port Input */}
          <div className="space-y-1.5">
            <label className="font-medium text-zinc-400">Backend Server URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="/api/v1"
                className="flex-1 px-3 py-2 rounded-xl bg-[hsl(var(--surface-1))] border border-border text-xs font-mono text-white focus:border-primary outline-none"
              />
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="px-4 py-2 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-border text-primary font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? 'Testing...' : 'Test Link'}</span>
              </button>
            </div>
          </div>

          {/* Test Status Banner */}
          {testResult && (
            <div className={`p-3 rounded-xl border flex items-center gap-2.5 ${
              testResult.success ? 'bg-green-500/10 border-green-500/40 text-green-500' : 'bg-red-500/10 border-red-500/40 text-red-500'
            }`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
              <span className="text-xs">{testResult.msg}</span>
            </div>
          )}

          {/* Node registry status (real /object_info data) */}
          <div className="space-y-2 pt-2">
            <span className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">Backend Status & Hardware</span>
            <div className="p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-border space-y-2">
              {nodeError ? (
                <div className="text-[11px] text-red-500">Backend unreachable: {nodeError}</div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">FastAPI Status</span>
                    <span className={`text-[11px] font-mono font-bold ${systemStats.status === 'online' ? 'text-green-500' : 'text-red-500'}`}>
                      {systemStats.status === 'online' ? `Online (${systemStats.lastPingMs}ms)` : 'Offline'}
                    </span>
                  </div>
                  {systemStats.gpu && systemStats.gpu !== 'Unavailable' && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">GPU</span>
                      <span className="font-mono text-white truncate max-w-[280px]">{systemStats.gpu}</span>
                    </div>
                  )}
                  {systemStats.vramUsedGb != null && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">VRAM</span>
                      <span className="font-mono text-blue-400">{systemStats.vramUsedGb} / {systemStats.vramTotalGb || '?'} GB</span>
                    </div>
                  )}
                  {systemStats.pythonVersion && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Python / PyTorch</span>
                      <span className="font-mono text-zinc-300">{systemStats.pythonVersion} {systemStats.torchVersion ? `· PyTorch ${systemStats.torchVersion}` : ''}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-zinc-500 pt-1 border-t border-border">ForMash 3D connects through the configured /api/v1 backend proxy.</div>
            </div>
          </div>

          {/* Post-Process Quality Defaults */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Post-Process Quality Defaults</span>
            </div>
            <div className="p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-border space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-foreground">Default Target Polycount</span>
                  <span className="text-[10px] font-mono text-primary">{generationSettings.autoOptimizeSettings.targetPolycount.toLocaleString()} tris</span>
                </div>
                <input
                  type="range"
                  min={5000}
                  max={100000}
                  step={5000}
                  value={generationSettings.autoOptimizeSettings.targetPolycount}
                  onChange={(e) => setGenerationSettings(prev => ({
                    ...prev,
                    autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: parseInt(e.target.value) }
                  }))}
                  className="w-full h-1.5 rounded-full appearance-none bg-border accent-primary cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[hsl(var(--surface-2))] border-t border-white/[0.08]">
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="px-4 py-2 rounded-xl bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white font-medium text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 active:scale-95 text-primary-foreground font-extrabold text-xs shadow-md shadow-primary/20 transition-all cursor-pointer border border-white/20"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
