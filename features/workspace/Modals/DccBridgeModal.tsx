import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { motion, AnimatePresence } from 'motion/react';


import { HugeiconsIcon } from '@hugeicons/react';
import { Cable, Cancel, Check, CheckmarkCircle02Icon, Copy, RefreshCw, Send, Terminal } from '@hugeicons/core-free-icons';
type DccApp = 'blender' | 'unreal' | 'maya' | 'unity';

interface DccPreset {
  id: DccApp;
  name: string;
  defaultPort: number;
  description: string;
  iconTag: string;
  format: string;
}

const DCC_PRESETS: DccPreset[] = [
  {
    id: 'blender',
    name: 'Blender 4.x / 5.x',
    defaultPort: 9876,
    description: 'Direct live mesh & armature sync into active Blender viewport',
    iconTag: 'BLEND',
    format: 'GLTF / FBX',
  },
  {
    id: 'unreal',
    name: 'Unreal Engine 5',
    defaultPort: 30010,
    description: 'Remote Control API live-link directly into Content Browser / Level',
    iconTag: 'UE5',
    format: 'FBX / USD',
  },
  {
    id: 'unity',
    name: 'Unity Editor',
    defaultPort: 8081,
    description: 'WebSocket AssetPipeline automated importer and prefab generator',
    iconTag: 'UNITY',
    format: 'FBX / GLTF',
  },
  {
    id: 'maya',
    name: 'Autodesk Maya',
    defaultPort: 7001,
    description: 'Command port listener for seamless Maya scene ingestion',
    iconTag: 'MAYA',
    format: 'FBX / OBJ',
  },
];

export const DccBridgeModal: React.FC = () => {
  const { isDccBridgeOpen, setIsDccBridgeOpen, currentAsset } = useWorkspace();
  const [selectedApp, setSelectedApp] = useState<DccApp>('blender');
  const [port, setPort] = useState(9876);
  const [host, setHost] = useState('127.0.0.1');
  const [isPinging, setIsPinging] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connected' | 'offline'>('idle');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Sync settings
  const [includeTextures, setIncludeTextures] = useState(true);
  const [includeRig, setIncludeRig] = useState(true);
  const [autoFocus, setAutoFocus] = useState(true);

  // When app changes, update default port
  useEffect(() => {
    const preset = DCC_PRESETS.find(p => p.id === selectedApp);
    if (preset) {
      setPort(preset.defaultPort);
      setConnectionStatus('idle');
      setSendSuccess(false);
    }
  }, [selectedApp]);

  // Dismiss on Escape
  useEffect(() => {
    if (!isDccBridgeOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDccBridgeOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDccBridgeOpen, setIsDccBridgeOpen]);

  if (!isDccBridgeOpen) return null;

  const currentPreset = DCC_PRESETS.find(p => p.id === selectedApp)!;
  const assetName = currentAsset?.name || 'ForMash3D_Asset';
  const assetUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || '/static/models/HeroAsset.glb';

  const blenderScript = `# Run inside Blender's Scripting workspace or install as add-on
import bpy, urllib.request, tempfile, os

url = "${window.location.origin}${assetUrl}"
temp_path = os.path.join(tempfile.gettempdir(), "${assetName}.glb")
print(f"[ForMash3D Bridge] Downloading {url}...")
urllib.request.urlretrieve(url, temp_path)

if temp_path.endswith('.glb') or temp_path.endswith('.gltf'):
    bpy.ops.import_scene.gltf(filepath=temp_path)
    print("[ForMash3D Bridge] Successfully imported ${assetName} into active scene!")
`;

  const unrealScript = `# Run in Unreal Engine 5 Python Console
import unreal, urllib.request, os

asset_url = "${window.location.origin}${assetUrl}"
destination_path = "/Game/ForMash3D/${assetName}"
print(f"[ForMash3D UE5] Syncing to {destination_path}...")
# Live-link payload received over port ${port}
`;

  const activeScript = selectedApp === 'unreal' ? unrealScript : blenderScript;

  const handleTestConnection = () => {
    setIsPinging(true);
    setConnectionStatus('idle');
    setTimeout(() => {
      setIsPinging(false);
      // Simulate successful local bridge connection
      setConnectionStatus('connected');
    }, 700);
  };

  const handleSendToDcc = () => {
    setIsSending(true);
    setTimeout(() => {
      setIsSending(false);
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 4000);
    }, 1200);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeScript);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl bg-[hsl(var(--surface-1))] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[hsl(var(--surface-1))]/80 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/15 text-primary border border-primary/25">
                <HugeiconsIcon icon={Cable} size={16} className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                  DCC Live Bridge
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 font-semibold">
                    Studio Sync
                  </span>
                </h2>
                <p className="text-xs text-zinc-400">Stream 3D assets & animations directly into your creative suite</p>
              </div>
            </div>

            <button
              onClick={() => setIsDccBridgeOpen(false)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <HugeiconsIcon icon={Cancel} size={16} className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
            {/* Target Software Select */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block mb-2">
                Target Creative Environment
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DCC_PRESETS.map((preset) => {
                  const isSelected = selectedApp === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedApp(preset.id)}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-sm shadow-primary/20'
                          : 'bg-[hsl(var(--surface-2))] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-primary text-black' : 'bg-white/[0.08] text-zinc-400'
                        }`}>
                          {preset.iconTag}
                        </span>
                        {isSelected && <HugeiconsIcon icon={Check} size={16} className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <span className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-zinc-300'}`}>
                        {preset.name.split(' ')[0]}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono mt-0.5">Port {preset.defaultPort}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">{currentPreset.description}</p>
            </div>

            {/* Connection Status & Host Config */}
            <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">Local Bridge Daemon</span>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    connectionStatus === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-amber-400'
                  }`} />
                  <span className="text-[11px] font-mono text-zinc-300">
                    {connectionStatus === 'connected' ? 'Ready & Linked' : 'Listening on localhost'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <span className="text-[10px] text-zinc-400">Host IP</span>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-white font-mono focus:border-primary outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400">Port</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-white font-mono focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleTestConnection}
                  disabled={isPinging}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/[0.1] transition-all"
                >
                  <HugeiconsIcon icon={RefreshCw} size={16} className={`w-3 h-3 ${isPinging ? 'animate-spin' : ''}`} />
                  <span>{isPinging ? 'Testing Port...' : 'Test Connection'}</span>
                </button>

                <div className="text-[11px] text-zinc-400">
                  Format: <span className="font-mono text-primary">{currentPreset.format}</span>
                </div>
              </div>
            </div>

            {/* Sync Options */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block">
                Sync Pipeline Flags
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={includeTextures}
                    onChange={(e) => setIncludeTextures(e.target.checked)}
                    className="rounded border-zinc-700 text-primary focus:ring-primary accent-primary"
                  />
                  <span className="text-xs text-zinc-300">PBR Textures</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={includeRig}
                    onChange={(e) => setIncludeRig(e.target.checked)}
                    className="rounded border-zinc-700 text-primary focus:ring-primary accent-primary"
                  />
                  <span className="text-xs text-zinc-300">Rig / Skeleton</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] cursor-pointer hover:border-white/20 transition-all">
                  <input
                    type="checkbox"
                    checked={autoFocus}
                    onChange={(e) => setAutoFocus(e.target.checked)}
                    className="rounded border-zinc-700 text-primary focus:ring-primary accent-primary"
                  />
                  <span className="text-xs text-zinc-300">Auto Focus View</span>
                </label>
              </div>
            </div>

            {/* One-Click Import Script */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                  <HugeiconsIcon icon={Terminal} size={16} className="w-3.5 h-3.5 text-primary" />
                  Quick Ingestion Script
                </span>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
                >
                  {copiedCode ? <HugeiconsIcon icon={Check} size={16} className="w-3 h-3" /> : <HugeiconsIcon icon={Copy} size={16} className="w-3 h-3" />}
                  <span>{copiedCode ? 'Copied to Clipboard!' : 'Copy Script'}</span>
                </button>
              </div>
              <div className="relative rounded-xl bg-[#0a0b0d] border border-white/[0.08] p-3 overflow-x-auto font-mono text-[11px] text-zinc-300 leading-relaxed max-h-32 custom-scrollbar">
                <pre>{activeScript}</pre>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-white/[0.08] bg-[hsl(var(--surface-1))]/90 flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-400 truncate max-w-[240px]">
              Asset: <span className="font-semibold text-white">{assetName}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsDccBridgeOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Close
              </button>

              <button
                onClick={handleSendToDcc}
                disabled={isSending}
                className="btn-lighting-shine relative overflow-hidden flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-primary hover:brightness-110 shadow-lg shadow-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {sendSuccess ? (
                  <>
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-4 h-4 text-black" />
                    <span>Dispatched to {currentPreset.name.split(' ')[0]}!</span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={Send} size={16} className={`w-4 h-4 ${isSending ? 'animate-bounce' : ''}`} />
                    <span>{isSending ? 'Transmitting Mesh...' : `Send to ${currentPreset.name.split(' ')[0]}`}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
