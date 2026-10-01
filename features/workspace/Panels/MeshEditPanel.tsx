'use client';

import React, { useState } from 'react';
import {
  Box,
  Layers,
  Upload,
  FolderOpen,
  X,
  PlusSquare,
  MinusSquare,
  RefreshCw,
  BoxSelect,
  CircleDot,
  Brush,
  Lasso,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Sliders,
  Image as ImageIcon,
  Zap,
  Loader2,
  Check,
} from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';
import { createUploadedMeshAsset } from '../types';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { toast } from 'sonner';

export const MeshEditPanel: React.FC = () => {
  const {
    currentAsset,
    setCurrentAsset,
    assets,
    isExecuting,
    activeTask,
    runMeshEditing,
  } = useWorkspace();

  const [inputTab, setInputTab] = useState<'text' | 'image' | 'sculpt'>('text');
  const [editMode, setEditMode] = useState<'add' | 'remove' | 'replace'>('add');
  const [selectionTool, setSelectionTool] = useState<'box' | 'sphere' | 'brush' | 'lasso'>('box');
  const [showManipulator, setShowManipulator] = useState(true);

  // Interactive Sculpting states
  const [sculptBrush, setSculptBrush] = useState<'standard' | 'clay' | 'inflate' | 'smooth' | 'flatten' | 'pinch' | 'grab'>('standard');
  const [sculptRadius, setSculptRadius] = useState(0.15);
  const [sculptStrength, setSculptStrength] = useState(0.50);
  const [sculptHardness, setSculptHardness] = useState(0.50);
  const [sculptSpacing, setSculptSpacing] = useState(0.10);
  const [sculptDirection, setSculptDirection] = useState<1 | -1>(1); // 1 = Add, -1 = Subtract
  const [sculptFrontOnly, setSculptFrontOnly] = useState(true);
  const [sculptSymmetry, setSculptSymmetry] = useState({ x: true, y: false, z: false });
  const [sculptSteadyStroke, setSculptSteadyStroke] = useState(0.20);
  const [sculptAutoSmooth, setSculptAutoSmooth] = useState(0.10);

  // Text-guided editing states
  const [sourcePrompt, setSourcePrompt] = useState('A medieval knight with a steel armor');
  const [targetPrompt, setTargetPrompt] = useState('Add a leather cape on the back and detailed shoulder armor with lion emblem');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Image-guided editing states
  const [referenceImage, setReferenceImage] = useState<{ name: string; url: string; base64: string; size: string } | null>(null);
  const [imageStrength, setImageStrength] = useState(0.80);
  const [projectionMode, setProjectionMode] = useState<'front' | 'ortho' | 'perspective'>('front');
  const [preserveOriginalTexture, setPreserveOriginalTexture] = useState(true);
  const [imageSupplementaryPrompt, setImageSupplementaryPrompt] = useState('');

  // Advanced parameters
  const [editStrength, setEditStrength] = useState(0.80);
  const [fidelity, setFidelity] = useState(0.70);
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [resolution, setResolution] = useState(512);

  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const isRunning = isExecuting && (activeTask?.type === 'edit');
  const hasTargetMesh = Boolean(currentAsset?.source?.viewUrl || currentAsset?.source?.localUrl || currentAsset?.source?.fileId);

  const handleStartTextEdit = async () => {
    if (!targetPrompt.trim()) {
      toast.error('Prompt required', { description: 'Please enter a target edit prompt.' });
      return;
    }

    await runMeshEditing({
      mode: 'text',
      sourcePrompt,
      targetPrompt,
      resolution,
      bbox: {
        center: [0.0, 0.45, -0.15],
        dimensions: [0.42, 0.36, 0.50],
      },
    });
  };

  const handleStartImageEdit = async () => {
    if (!referenceImage) {
      toast.error('Image required', { description: 'Please upload a reference image to guide the mesh edit.' });
      return;
    }

    await runMeshEditing({
      mode: 'image',
      targetImageBase64: referenceImage.base64,
      targetPrompt: imageSupplementaryPrompt || 'Modify mesh matching reference image details',
      strength: imageStrength,
      resolution,
      bbox: {
        center: [0.0, 0.45, -0.15],
        dimensions: [0.42, 0.36, 0.50],
      },
    });
  };

  const handleUploadReferenceImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || '';
      const url = URL.createObjectURL(file);
      setReferenceImage({
        name: file.name,
        url,
        base64,
        size: `${(file.size / 1024).toFixed(1)} KB`,
      });
      toast.success('Reference image loaded for guidance');
    };
    reader.readAsDataURL(file);
  };

  const handleUploadNewMesh = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCurrentAsset(createUploadedMeshAsset(file));
  };

  const canExecute = inputTab === 'text'
    ? (hasTargetMesh && Boolean(targetPrompt.trim()))
    : (hasTargetMesh && Boolean(referenceImage));

  return (
    <div id="panel-mesh-edit" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white select-none overflow-x-hidden overflow-y-hidden">
      {/* Top Header Tabs: Text Sculpt vs Image Sculpt vs Sculpt Brushes */}
      <div className="px-3 py-2 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex gap-1 p-0.5 bg-[hsl(var(--surface-0))] rounded-lg border border-white/[0.06]">
          {[
            { id: 'text', label: 'Text Inpaint' },
            { id: 'image', label: 'Image Guided' },
            { id: 'sculpt', label: 'Sculpt Brushes' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              id={`tab-edit-${tab.id}`}
              onClick={() => setInputTab(tab.id as any)}
              className={`flex-1 py-1 px-1 rounded-md text-[10px] font-bold transition-all cursor-pointer truncate ${
                inputTab === tab.id
                  ? 'bg-primary text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2.5 space-y-2.5 scrollbar-none pr-1.5">
        {/* 1. Target Input Mesh */}
        <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-primary" />
              <span>Target Mesh</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAssetPicker(!showAssetPicker)}
                className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <FolderOpen className="w-3 h-3 text-primary" />
                <span>Assets</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf,.obj,.ply,.stl"
                onChange={handleUploadNewMesh}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Upload className="w-3 h-3 text-primary" />
                <span>Upload</span>
              </button>
            </div>
          </div>

          {currentAsset ? (
            <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] relative group flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-7 h-7 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                  <Box className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate max-w-[170px]">{currentAsset.name || 'mesh.glb'}</div>
                  <div className="text-[9.5px] text-zinc-400">
                    {currentAsset.faces ? `${Math.round(currentAsset.faces / 1000)}K faces` : '3D Mesh'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCurrentAsset(null as any)}
                className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Remove selected mesh"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-lg border border-dashed border-white/[0.12] bg-[hsl(var(--surface-1))]/50 hover:bg-[hsl(var(--surface-1))] text-center cursor-pointer transition-colors"
            >
              <div className="text-xs font-semibold text-zinc-300">No mesh selected</div>
              <div className="text-[9.5px] text-zinc-500">Pick from Assets or click to upload GLB / OBJ</div>
            </div>
          )}

          {showAssetPicker && (
            <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.12] max-h-36 overflow-y-auto space-y-0.5">
              <div className="text-[9.5px] font-bold text-zinc-400 px-1 py-0.5">Pick 3D Asset</div>
              {assets.filter(a => a.category === 'mesh' || a.source?.viewUrl || a.source?.localUrl).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setCurrentAsset(a);
                    setShowAssetPicker(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded hover:bg-[hsl(var(--surface-2))] flex items-center justify-between text-xs text-zinc-300 hover:text-white cursor-pointer"
                >
                  <span className="truncate max-w-[170px]">{a.name}</span>
                  <span className="text-[9px] font-mono text-zinc-500">{a.faces ? `${Math.round(a.faces / 1000)}k` : '3D'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2. Edit Mode Selection */}
        <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Edit Mode</span>
            <span className="text-[10px] font-mono text-primary font-bold uppercase">{editMode}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'add', label: 'Add / Modify', icon: PlusSquare },
              { id: 'remove', label: 'Remove', icon: MinusSquare },
              { id: 'replace', label: 'Replace', icon: RefreshCw },
            ].map((m) => {
              const Icon = m.icon;
              const isActive = editMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setEditMode(m.id as any)}
                  className={`py-2 px-1 rounded-lg border text-center flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary text-black font-bold shadow-sm border-primary'
                      : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-black' : 'text-zinc-400'}`} />
                  <span className="text-[10px] font-bold leading-tight">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Selection Mask & Gizmo */}
        <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Selection Mask</span>
            <button
              type="button"
              onClick={() => setShowManipulator(!showManipulator)}
              className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-white cursor-pointer"
            >
              <span>3D Gizmo</span>
              <div className={`w-7 h-4 rounded-full transition-colors relative ${showManipulator ? 'bg-primary' : 'bg-zinc-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${showManipulator ? 'left-3.5' : 'left-0.5 bg-zinc-300'}`} />
              </div>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[
              { id: 'box', label: 'Box', icon: BoxSelect },
              { id: 'sphere', label: 'Sphere', icon: CircleDot },
              { id: 'brush', label: 'Brush', icon: Brush },
              { id: 'lasso', label: 'Lasso', icon: Lasso },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = selectionTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectionTool(t.id as any)}
                  className={`py-1.5 px-1 rounded-lg border text-center flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[hsl(var(--surface-2))] border-primary text-primary font-bold shadow-sm'
                      : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[9.5px] font-medium">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Guidance Inputs (Text vs Image) */}
        {inputTab === 'text' && (
          <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Sculpt Guidance</span>
              <span className="font-mono text-zinc-500 text-[10px]">{targetPrompt.length}/500</span>
            </div>

            <div className="space-y-1">
              <textarea
                rows={2.5}
                value={targetPrompt}
                maxLength={500}
                onChange={(e) => setTargetPrompt(e.target.value)}
                placeholder="e.g. Add leather cape on the back and lion crest armor"
                className="w-full p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Optional Source Prompt */}
            <div className="space-y-1">
              <label className="text-[9.5px] text-zinc-400">Current Mesh Description (optional)</label>
              <input
                type="text"
                value={sourcePrompt}
                onChange={(e) => setSourcePrompt(e.target.value)}
                placeholder="e.g. Medieval knight with steel armor"
                className="w-full h-7 px-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] text-[11px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Advanced Accordion */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="w-full py-1 flex items-center justify-between text-[11px] font-bold text-zinc-400 hover:text-white cursor-pointer"
              >
                <span>Advanced Parameters</span>
                {isAdvancedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {isAdvancedOpen && (
                <div className="space-y-2 pt-1.5">
                  <div className="space-y-0.5 p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
                    <div className="flex justify-between text-[9.5px]">
                      <span className="text-zinc-400">Edit Strength</span>
                      <span className="font-mono text-primary font-bold">{editStrength.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={editStrength}
                      onChange={(e) => setEditStrength(parseFloat(e.target.value))}
                      className="w-full accent-primary h-1"
                    />
                  </div>

                  <div className="space-y-0.5 p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
                    <div className="flex justify-between text-[9.5px]">
                      <span className="text-zinc-400">Geometry Fidelity</span>
                      <span className="font-mono text-primary font-bold">{fidelity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={fidelity}
                      onChange={(e) => setFidelity(parseFloat(e.target.value))}
                      className="w-full accent-primary h-1"
                    />
                  </div>

                  <div className="space-y-0.5 p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
                    <div className="flex justify-between text-[9.5px]">
                      <span className="text-zinc-400">Guidance Scale</span>
                      <span className="font-mono text-primary font-bold">{guidanceScale.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={20.0}
                      step={0.5}
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                      className="w-full accent-primary h-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {inputTab === 'image' && (
          <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Reference Guidance</span>
              {referenceImage && (
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  className="text-rose-400 text-[10px] hover:underline cursor-pointer"
                >
                  Clear Image
                </button>
              )}
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleUploadReferenceImage}
              className="hidden"
            />

            {referenceImage ? (
              <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center gap-2.5">
                <div className="w-10 h-10 rounded overflow-hidden border border-white/[0.1] bg-black flex-shrink-0">
                  <img src={referenceImage.url} alt="Reference" className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">{referenceImage.name}</div>
                  <div className="text-[9.5px] text-zinc-400">{referenceImage.size} · Active Reference</div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="w-full py-3 px-2 rounded-lg border border-dashed border-white/[0.12] bg-[hsl(var(--surface-1))]/50 hover:bg-[hsl(var(--surface-1))] text-center cursor-pointer transition-colors block"
              >
                <ImageIcon className="w-4 h-4 text-primary mx-auto mb-1" />
                <div className="text-xs font-semibold text-zinc-200">Upload Reference Image</div>
                <div className="text-[9.5px] text-zinc-500">PNG, JPG or WEBP for shape alignment</div>
              </button>
            )}

            {/* Projection Mode */}
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-zinc-300">Projection Alignment</label>
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-[hsl(var(--surface-1))] rounded-lg border border-white/[0.06]">
                {[
                  { id: 'front', label: 'Front Ortho' },
                  { id: 'ortho', label: 'Side Align' },
                  { id: 'perspective', label: 'Perspective' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setProjectionMode(mode.id as any)}
                    className={`py-1 text-[9.5px] font-bold rounded transition-all cursor-pointer ${
                      projectionMode === mode.id
                        ? 'bg-primary text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Image Strength */}
            <div className="space-y-0.5 p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-zinc-300">Influence Strength</span>
                <span className="font-mono text-primary font-bold">{(imageStrength * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0.10}
                max={1.00}
                step={0.05}
                value={imageStrength}
                onChange={(e) => setImageStrength(parseFloat(e.target.value))}
                className="w-full accent-primary h-1 cursor-pointer"
              />
            </div>

            {/* Preserve Texture Toggle */}
            <div className="flex items-center justify-between p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.06]">
              <span className="text-[10.5px] font-medium text-zinc-300">Preserve Mesh Base Texture</span>
              <button
                type="button"
                onClick={() => setPreserveOriginalTexture(!preserveOriginalTexture)}
                className={`w-7 h-4 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                  preserveOriginalTexture ? 'bg-primary' : 'bg-zinc-700'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${preserveOriginalTexture ? 'left-3.5' : 'left-0.5 bg-zinc-300'}`} />
              </button>
            </div>
          </div>
        )}

        {inputTab === 'sculpt' && (
          <div className="space-y-2.5">
            {/* Brush Selector */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                  <Brush className="w-3.5 h-3.5 text-primary" />
                  <span>Sculpt Brush</span>
                </span>
                <span className="text-[10px] font-mono text-primary font-bold uppercase">{sculptBrush}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'standard', label: 'Standard', desc: 'Displace surface' },
                  { id: 'clay', label: 'Clay', desc: 'Build up strips' },
                  { id: 'inflate', label: 'Inflate', desc: 'Expand outward' },
                  { id: 'smooth', label: 'Smooth', desc: 'Relax geometry' },
                  { id: 'flatten', label: 'Flatten', desc: 'Planar surface' },
                  { id: 'pinch', label: 'Pinch', desc: 'Sharpen crease' },
                  { id: 'grab', label: 'Grab', desc: 'Pull / Move' },
                ].map((b) => {
                  const isActive = sculptBrush === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSculptBrush(b.id as any)}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        isActive
                          ? 'bg-primary text-black font-bold shadow-sm border-primary'
                          : 'bg-[hsl(var(--surface-1))] border-white/[0.06] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                      }`}
                    >
                      <div className="text-[10.5px] font-bold leading-tight flex items-center justify-between">
                        <span>{b.label}</span>
                        {isActive && <Check className="w-3 h-3 text-black" />}
                      </div>
                      <div className={`text-[8.5px] mt-0.5 ${isActive ? 'text-black/80' : 'text-zinc-400'}`}>
                        {b.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brush Dynamics Sliders */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Brush Dynamics</span>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Brush Radius (Size)</span>
                  <span className="font-mono text-primary font-bold">{sculptRadius.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  value={sculptRadius}
                  onChange={(e) => setSculptRadius(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Brush Strength</span>
                  <span className="font-mono text-primary font-bold">{sculptStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={1.0}
                  step={0.02}
                  value={sculptStrength}
                  onChange={(e) => setSculptStrength(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Hardness (Falloff)</span>
                  <span className="font-mono text-primary font-bold">{sculptHardness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={1.0}
                  step={0.02}
                  value={sculptHardness}
                  onChange={(e) => setSculptHardness(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Stroke Spacing</span>
                  <span className="font-mono text-primary font-bold">{sculptSpacing.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.50}
                  step={0.01}
                  value={sculptSpacing}
                  onChange={(e) => setSculptSpacing(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>
            </div>

            {/* Direction & Symmetry */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Deformation &amp; Symmetry</span>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setSculptDirection(sculptDirection === 1 ? -1 : 1)}
                  className={`p-1.5 rounded-lg border text-center font-bold text-[10px] transition-all cursor-pointer ${
                    sculptDirection === 1
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  }`}
                >
                  {sculptDirection === 1 ? '▲ Direction: Add (+)' : '▼ Direction: Subtract (-)'}
                </button>
                <button
                  type="button"
                  onClick={() => setSculptFrontOnly(!sculptFrontOnly)}
                  className={`p-1.5 rounded-lg border text-center font-bold text-[10px] transition-all cursor-pointer ${
                    sculptFrontOnly
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-white/[0.04] text-zinc-400 border-white/[0.08]'
                  }`}
                >
                  {sculptFrontOnly ? 'Front Faces Only' : 'Pass-Through'}
                </button>
              </div>

              <div className="space-y-1 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400">Bilateral Mirror Symmetry</span>
                  <span className="text-[9px] text-zinc-500 font-mono">
                    {sculptSymmetry.x ? 'X-Axis' : 'None'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(['x', 'y', 'z'] as const).map((axis) => {
                    const isSym = sculptSymmetry[axis];
                    return (
                      <button
                        key={axis}
                        type="button"
                        onClick={() => setSculptSymmetry(prev => ({ ...prev, [axis]: !prev[axis] }))}
                        className={`py-1 rounded font-bold text-[10px] uppercase transition-all cursor-pointer ${
                          isSym
                            ? 'bg-primary text-black'
                            : 'bg-[hsl(var(--surface-1))] text-zinc-400 border border-white/[0.06]'
                        }`}
                      >
                        {axis} Mirror
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Steady Mouse & Stroke */}
            <div className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-2.5 space-y-2">
              <span className="text-zinc-200 font-bold uppercase text-[11px] tracking-wider">Stabilizer &amp; Smooth</span>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Steady Stroke (Lazy Mouse)</span>
                  <span className="font-mono text-primary font-bold">{sculptSteadyStroke.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.95}
                  step={0.05}
                  value={sculptSteadyStroke}
                  onChange={(e) => setSculptSteadyStroke(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Auto-Smooth Factor</span>
                  <span className="font-mono text-primary font-bold">{sculptAutoSmooth.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={sculptAutoSmooth}
                  onChange={(e) => setSculptAutoSmooth(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Footer */}
      <div className="p-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] relative z-20 flex-shrink-0 space-y-1.5 overflow-x-hidden">
        {/* Pre-flight Configuration Summary Bar */}
        <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-400 px-0.5 pb-0.5">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-200 font-semibold truncate max-w-[130px]">
              {currentAsset?.name || 'No Target Mesh'}
            </span>
            <span>•</span>
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase flex-shrink-0">
              {inputTab === 'sculpt' ? sculptBrush : editMode}
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex-shrink-0 uppercase">
            {inputTab === 'text' ? 'TEXT' : inputTab === 'image' ? 'IMAGE' : 'SCULPT BRUSH'}
          </span>
        </div>

        {/* Sticky Action Button */}
        {inputTab === 'sculpt' ? (
          <button
            type="button"
            onClick={() => toast.success(`Interactive sculpt active: ${sculptBrush.toUpperCase()} brush`, {
              description: 'Click and drag on the 3D mesh in the viewport to sculpt.'
            })}
            disabled={!hasTargetMesh}
            className="w-full h-10 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] font-black text-xs flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,204,0,0.45)] transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Brush className="w-4 h-4 text-black stroke-[2.5]" />
            <span>INTERACTIVE SCULPT ACTIVE: {sculptBrush.toUpperCase()}</span>
          </button>
        ) : (
          <ShimmerButton
            id={inputTab === 'text' ? 'btn-generate-edit' : 'btn-generate-image-edit'}
            onClick={inputTab === 'text' ? handleStartTextEdit : handleStartImageEdit}
            disabled={isRunning || !canExecute}
            shimmerColor="hsl(var(--neon-amber))"
            shimmerSize="0.1em"
            shimmerDuration="2.5s"
            borderRadius="12px"
            background={
              isRunning
                ? "hsl(var(--surface-2))"
                : "linear-gradient(135deg, #FFE066 0%, #FFCC00 50%, #E09800 100%)"
            }
            className={`w-full h-10 font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isRunning 
                ? 'text-primary border border-primary/30' 
                : 'text-[#080808] shadow-[0_4px_16px_rgba(255,204,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,204,0,0.45)] active:scale-[0.98]'
            }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                <span>Editing 3D Mesh...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>{inputTab === 'text' ? 'GENERATE TEXT SCULPT' : 'GENERATE IMAGE SCULPT'}</span>
              </>
            )}
          </ShimmerButton>
        )}
      </div>
    </div>
  );
};
