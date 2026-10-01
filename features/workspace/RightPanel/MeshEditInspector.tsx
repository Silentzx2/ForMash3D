'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, ChevronDown, ChevronUp, ClockIcon, MoreVerticalIcon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
interface RecentEditItem {
  id: string;
  title: string;
  timestamp: string;
  status: 'Completed' | 'Failed' | 'Processing';
  model: string;
  fileId?: string;
  downloadUrl?: string;
}

export const MeshEditInspector: React.FC = () => {
  const { currentAsset, navigateToTool } = useWorkspace();

  // Accordion open/close states
  const [isSelectionOpen, setIsSelectionOpen] = useState(true);
  const [isParametersOpen, setIsParametersOpen] = useState(true);
  const [isModelOpen, setIsModelOpen] = useState(true);
  const [isModelDetailsOpen, setIsModelDetailsOpen] = useState(false);

  // Edit Parameters states matching project theme
  const [editStrength, setEditStrength] = useState(0.80);
  const [fidelity, setFidelity] = useState(0.70);
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [samplingSteps, setSamplingSteps] = useState(50);
  const [resolution, setResolution] = useState(512);
  const [preserveUnchanged, setPreserveUnchanged] = useState(true);
  const [useMaskFromSelection, setUseMaskFromSelection] = useState(true);

  // Recent edits list
  const [recentEdits] = useState<RecentEditItem[]>([
    {
      id: 'edit-1',
      title: 'Add cape and shoulder armor',
      timestamp: '2 minutes ago',
      status: 'Completed',
      model: 'VoxHammer',
    },
    {
      id: 'edit-2',
      title: 'Remove helmet',
      timestamp: '1 hour ago',
      status: 'Completed',
      model: 'VoxHammer',
    },
    {
      id: 'edit-3',
      title: 'Add backpack',
      timestamp: '3 hours ago',
      status: 'Failed',
      model: 'VoxHammer',
    },
    {
      id: 'edit-4',
      title: 'Change weapon',
      timestamp: '1 day ago',
      status: 'Completed',
      model: 'VoxHammer',
    },
  ]);

  return (
    <div id="mesh-edit-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none">
      <div className="p-3 space-y-3">
        {/* SECTION 1: Selection InfoIcon */}
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsSelectionOpen(!isSelectionOpen)}
            className="w-full flex items-center justify-between p-3 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span>Selection InfoIcon</span>
            </div>
            {isSelectionOpen ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {isSelectionOpen && (
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.04] text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Selected Vertices</span>
                <span className="font-mono text-white font-medium">12,482</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Selected Faces</span>
                <span className="font-mono text-white font-medium">24,931</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Selection Volume</span>
                <span className="font-mono text-white font-medium">0.18 m³</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Bounds (m)</span>
                <span className="font-mono text-white font-medium">0.42 × 0.36 × 0.50</span>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 2: Edit Parameters */}
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsParametersOpen(!isParametersOpen)}
            className="w-full flex items-center justify-between p-3 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-3.5 h-3.5 text-primary" />
              <span>Edit Parameters</span>
            </div>
            {isParametersOpen ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {isParametersOpen && (
            <div className="px-3 pb-3 pt-1 space-y-3.5 border-t border-white/[0.04] text-xs">
              {/* Edit Strength */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Edit Strength</span>
                  <span className="font-mono text-primary text-[11px] font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                    {editStrength.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={editStrength}
                  onChange={(e) => setEditStrength(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              {/* Geometry Fidelity */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Geometry Fidelity</span>
                  <span className="font-mono text-primary text-[11px] font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                    {fidelity.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={fidelity}
                  onChange={(e) => setFidelity(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              {/* Guidance Scale */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Guidance Scale</span>
                  <span className="font-mono text-primary text-[11px] font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                    {guidanceScale.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={guidanceScale}
                  onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              {/* Sampling Steps */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Sampling Steps</span>
                  <span className="font-mono text-primary text-[11px] font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                    {samplingSteps}
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={samplingSteps}
                  onChange={(e) => setSamplingSteps(parseInt(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              {/* Output Resolution */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-[11px]">Output Resolution</span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(parseInt(e.target.value))}
                  className="bg-[hsl(var(--surface-2))] border border-white/[0.1] rounded-lg px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-primary cursor-pointer"
                >
                  <option value={256}>256</option>
                  <option value={512}>512</option>
                  <option value={1024}>1024</option>
                </select>
              </div>

              {/* Preserve Unchanged Area */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-400 text-[11px]">Preserve Unchanged Area</span>
                <button
                  type="button"
                  onClick={() => setPreserveUnchanged(!preserveUnchanged)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    preserveUnchanged ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                      preserveUnchanged ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'
                    }`}
                  />
                </button>
              </div>

              {/* Use Mask from Selection */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-[11px]">Use Mask from Selection</span>
                <button
                  type="button"
                  onClick={() => setUseMaskFromSelection(!useMaskFromSelection)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    useMaskFromSelection ? 'bg-primary' : 'bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                      useMaskFromSelection ? 'left-4.5 bg-black' : 'left-0.5 bg-zinc-400'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3: Model Card */}
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsModelOpen(!isModelOpen)}
            className="w-full flex items-center justify-between p-3 text-xs font-bold text-white hover:bg-white/[0.02] cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span>Model</span>
            </div>
            {isModelOpen ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-3.5 h-3.5 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {isModelOpen && (
            <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.04] text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.06]">
                <span className="font-semibold text-white">VoxHammer (Default)</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  Available
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Text and image-guided 3D mesh editing with localized volumetric bounding constraints.
              </p>

              <div>
                <button
                  type="button"
                  onClick={() => setIsModelDetailsOpen(!isModelDetailsOpen)}
                  className="flex items-center justify-between w-full text-[11px] text-zinc-400 hover:text-white cursor-pointer py-1"
                >
                  <span>Model Details</span>
                  <HugeiconsIcon icon={ChevronDown} size={16} className={`w-3 h-3 transition-transform ${isModelDetailsOpen ? 'rotate-180 text-white' : ''}`} />
                </button>
                {isModelDetailsOpen && (
                  <div className="p-2 mt-1 rounded bg-[hsl(var(--surface-2))] text-[10px] font-mono space-y-1 text-zinc-400 border border-white/[0.04]">
                    <div>VRAM Requirement: ~40 GB</div>
                    <div>Supported Inputs: mesh (.glb, .obj), prompt, image</div>
                    <div>Supported Outputs: .glb</div>
                    <div>Location: backend/pretrained/VoxHammer</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* SECTION 4: Recent Edits */}
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-white/[0.04]">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <HugeiconsIcon icon={ClockIcon} size={16} className="w-3.5 h-3.5 text-primary" />
              <span>Recent Edits</span>
            </div>
            <button
              type="button"
              onClick={() => toast.info('Recent edits list refreshed')}
              className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>

          <div className="p-2 space-y-1.5">
            {recentEdits.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] transition-colors border border-white/[0.04]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-[hsl(var(--surface-1))] flex items-center justify-center flex-shrink-0">
                    <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-white truncate max-w-[130px]">
                      {item.title}
                    </div>
                    <div className="text-[9px] text-zinc-500">{item.timestamp}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      item.status === 'Completed'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {item.status}
                  </span>
                  <button
                    type="button"
                    title="Edit options"
                    onClick={() => toast.info(`Options for ${item.title}`)}
                    className="p-1 rounded text-zinc-500 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  >
                    <HugeiconsIcon icon={MoreVerticalIcon} size={16} className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
