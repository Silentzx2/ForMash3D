import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getApiClient } from '@/services/apiClient';
import { useWorkspace } from '../store/WorkspaceContext';
import { ModelAsset, normalizeModelAsset } from '../types';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { UploadDiagnosticModal } from '../Modals/UploadDiagnosticModal';
import { validate3DFile } from '../lib/fileValidation';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';


import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircle, Box, CheckIcon, ChevronLeft, ChevronRight, Copy, FilterIcon, FolderOpenIcon, GridIcon, LoaderCircle, MoreVerticalIcon, StarIcon, Trash2, ZoomInIcon } from '@hugeicons/core-free-icons';
export const RightAssetsPanel: React.FC = () => {
  const { 
    assets, 
    currentAsset, 
    setCurrentAsset, 
    assetFilter, 
    setAssetFilter,
    duplicateAsset,
    deleteAsset,
    addAsset,
    setActiveTool
  } = useWorkspace();

  const [activePage, setActivePage] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeMenuAssetId, setActiveMenuAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { progress: uploadProgress, readFileWithProgress, startUpload, updateProgress, finishUpload, failUpload } = useUploadProgress();
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [diagnosticFile, setDiagnosticFile] = useState<File | null>(null);

  const ACCEPTED_MODEL_EXTS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];
  const ITEMS_PER_PAGE = 8;

  useEffect(() => {
    setActivePage(1);
  }, [assetFilter, showFavoritesOnly]);

  // Handle outside click and Escape key for dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
      if (activeMenuAssetId && !(e.target as HTMLElement).closest(`[data-asset-menu="${activeMenuAssetId}"]`)) {
        setActiveMenuAssetId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFilterMenuOpen(false);
        setActiveMenuAssetId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuAssetId]);

  const processModelFile = useCallback(async (file: File) => {
    setUploadError(null);

    // Validate file structure before upload (extension, MIME, size, magic bytes)
    const validation = await validate3DFile(file, 'upload');
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid file');
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ACCEPTED_MODEL_EXTS.includes(ext)) {
      setUploadError('Invalid file type. Use GLB, GLTF, OBJ, FBX, STL, or PLY.');
      return;
    }

    if (file.size === 0) {
      setUploadError('File is empty.');
      return;
    }

    // Show progress while uploading
    startUpload(file.name, file.size);

    try {
      // UploadIcon file to backend with real-time progress
      const formData = new FormData();
      formData.append('file', file);
      const result = await getApiClient().post<{
        url: string;
        thumbnail_url?: string;
        id?: string;
        filename: string;
        stored_filename?: string;
        size: number;
        mesh_stats?: { polygon_count: number; vertex_count: number };
      }>('/api/v1/file-upload/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

      finishUpload();

      // Resolve relative URLs: /static/* paths go through the /static proxy route
      const resolveUrl = (url: string | undefined) => {
        if (!url) return '';
        if (url.startsWith('/static/')) {
          // Return as same-origin relative URL - the /static/* proxy route
          // will forward to the backend
          return url;
        }
        return url;
      };

      const meshStats = result?.mesh_stats as any;
      const newAsset = normalizeModelAsset({
        id: result?.id || result?.stored_filename || `user-upload-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        category: 'mesh',
        meshType: 'custom',
        thumbnail: resolveUrl(result?.thumbnail_url),
        polygon_count: meshStats?.polygon_count,
        vertex_count: meshStats?.vertex_count,
        faces: meshStats?.polygon_count || 0,
        vertices: meshStats?.vertex_count || 0,
        triangles: meshStats?.polygon_count || 0,
        statsAvailable: !!(meshStats && ((meshStats.polygon_count ?? 0) > 0 || (meshStats.vertex_count ?? 0) > 0)),
        source: { filename: result?.stored_filename || file.name, subfolder: 'models', type: 'upload', viewUrl: resolveUrl(result?.url) },
        topology: meshStats?.topology || 'Triangle',
        format: (() => {
          if (ext === 'obj') return 'OBJ';
          if (ext === 'ply') return 'PLY';
          if (ext === 'glb' || ext === 'gltf') return 'GLB';
          if (ext === 'fbx') return 'FBX';
          if (ext === 'stl') return 'STL';
          return 'FILE';
        })(),
        dimensions: meshStats?.dimensions,
        boundingBox: meshStats?.bounding_box,
        objectCount: meshStats?.object_count,
        componentCount: meshStats?.component_count,
        materialCount: meshStats?.material_count,
        meshDetails: meshStats?.mesh_details,
        dateCreated: '',
        tags: ['Custom', 'UserIcon-UploadIcon', 'Mesh']
      });
      addAsset(newAsset);
      setCurrentAsset(newAsset);
    } catch (err) {
      failUpload();
      setUploadError(err instanceof Error ? err.message : 'Failed to upload file.');
    }
  }, [addAsset, setCurrentAsset, startUpload, updateProgress, finishUpload, failUpload]);

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processModelFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) processModelFile(file);
  };

  const filteredAssets = assets.filter(a => {
    if (showFavoritesOnly && !a.isFavorite) return false;
    if (assetFilter === 'all') return true;
    if (assetFilter === 'models') return a.category === 'generation' || a.category === 'mesh';
    if (assetFilter === 'textures') return a.category === 'texture' || a.tags?.includes('PBR');
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / ITEMS_PER_PAGE));
  const safePage = Math.min(activePage, totalPages);
  const paginatedAssets = filteredAssets.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  return (
    <div id="panel-assets-library" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none">
      {/* Hidden file input for uploading custom 3D files */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.obj,.fbx,.stl,.ply"
        className="hidden"
        onChange={handleModelUpload}
      />

      {/* Top Action Sub-bar */}
      <div className="px-2.5 py-2 border-b border-white/[0.08] bg-[hsl(var(--surface-1))]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {/* GridIcon / All View */}
            <SimpleTooltip label="All Assets">
              <button
                onClick={() => { setShowFavoritesOnly(false); setAssetFilter('all'); }}
                className={`p-1.5 rounded-lg transition-colors ${
                  !showFavoritesOnly && assetFilter === 'all'
                    ? 'bg-[hsl(var(--surface-2))] text-primary'
                    : 'text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                }`}
              >
                <HugeiconsIcon icon={GridIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>

            {/* Favorite FilterIcon */}
            <SimpleTooltip label="Favorites Only">
              <button
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={`p-1.5 rounded-lg transition-colors ${
                  showFavoritesOnly
                    ? 'bg-[hsl(var(--surface-2))] text-primary'
                    : 'text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                }`}
              >
                <HugeiconsIcon icon={StarIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>

            {/* Category FilterIcon */}
            <div className="relative" ref={filterMenuRef}>
              <SimpleTooltip label="FilterIcon by Category">
                <button
                  onClick={() => setFilterMenuOpen(!filterMenuOpen)}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    assetFilter !== 'all'
                      ? 'bg-[hsl(var(--surface-2))] text-primary'
                      : 'text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))]'
                  }`}
                >
                  <HugeiconsIcon icon={FilterIcon} size={16} className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>

              {filterMenuOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-36 py-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.1] shadow-2xl z-50 text-xs font-medium animate-in fade-in zoom-in-95 duration-100">
                  <button
                    onClick={() => { setAssetFilter('all'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--surface-3))] text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>All Assets</span>
                    {assetFilter === 'all' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3 h-3 text-primary" />}
                  </button>
                  <button
                    onClick={() => { setAssetFilter('models'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--surface-3))] text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>3D Models</span>
                    {assetFilter === 'models' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3 h-3 text-primary" />}
                  </button>
                  <button
                    onClick={() => { setAssetFilter('textures'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--surface-3))] text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>PBR Textures</span>
                    {assetFilter === 'textures' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3 h-3 text-primary" />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Import Button */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 rounded-lg text-xs font-bold text-zinc-200 hover:text-primary hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>Import</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Asset GridIcon Body */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 no-scrollbar">
        {/* UploadIcon 3D Model Card - Centered Dropzone */}
        <div
          id="btn-upload-3d-model-card"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative w-full rounded-xl border border-dashed cursor-pointer p-3 flex flex-col items-center justify-center text-center transition-all ${
            isDragOver
              ? 'border-primary bg-primary/15 shadow-[0_0_16px_rgba(255,204,0,0.25)]'
              : 'border-white/[0.12] hover:border-primary/70 bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-1))]'
          }`}
        >
          {uploadProgress.active ? (
            <div className="flex flex-col items-center justify-center space-y-1.5 w-full px-2">
              <HugeiconsIcon icon={LoaderCircle} size={16} className="w-5 h-5 animate-spin text-primary" />
              <div className="w-full bg-[hsl(var(--surface-2))] rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                {uploadProgress.percent}%
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <div className={`w-9 h-9 rounded-full bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center transition-all mb-1.5 ${
                isDragOver ? 'text-primary border-primary' : 'text-zinc-400 group-hover:text-primary group-hover:border-primary/40'
              }`}>
                <HugeiconsIcon icon={Box} size={16} className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white leading-tight">
                {isDragOver ? 'Drop 3D Model Here' : 'Import 3D Model'}
              </span>
              <span className="text-[10px] text-zinc-400 mt-0.5 font-medium">
                GLB, GLTF, OBJ, FBX, STL, PLY
              </span>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="flex items-center gap-1.5 text-[10px] text-rose-400 px-2 py-1.5 bg-rose-500/10 rounded-lg border border-rose-500/20">
            <HugeiconsIcon icon={AlertCircle} size={16} className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <div className="py-6 px-2 text-center text-zinc-400">
            <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-8 h-8 mx-auto mb-2 text-zinc-500" />
            <div className="text-xs font-bold text-zinc-300">No outputs yet</div>
            <div className="text-[11px] mt-1 text-zinc-500">Run a generation workflow or import a 3D file above.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Asset Items */}
            {paginatedAssets.map((asset) => {
            const isSelected = currentAsset?.id === asset.id;

            return (
              <div
                key={asset.id}
                id={`asset-card-${asset.id}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify(asset));
                  e.dataTransfer.setData('text/plain', asset.id);
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                onClick={() => setCurrentAsset(asset)}
                className={`group relative rounded-xl overflow-hidden cursor-grab active:cursor-grabbing transition-all aspect-square flex flex-col ${
                  isSelected
                    ? 'ring-2 ring-[hsl(var(--primary))] bg-[hsl(var(--surface-2))] shadow-md shadow-[hsl(var(--primary))]/15'
                    : 'border border-white/[0.08] bg-[hsl(var(--surface-0))] hover:border-white/[0.2] hover:bg-[#1A1B1F]'
                }`}
                title={`Click or drag "${asset.name}" into 3D Viewport`}
              >
                {/* 3D Asset Thumbnail */}
                <div className="relative w-full flex-1 bg-[#121316] overflow-hidden">
                  {asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(var(--surface-1))] gap-1 p-1">
                      <div className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center">
                        <HugeiconsIcon icon={Box} size={16} className="w-4 h-4 text-zinc-400" />
                      </div>
                      <span className="text-[9px] font-bold text-zinc-400 uppercase">
                        {asset.format}
                      </span>
                    </div>
                  )}

{asset.thumbnail && (
                    <div
                      className="absolute top-1.5 left-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={asset.thumbnail}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md bg-black/70 hover:bg-black text-zinc-300 hover:text-primary border border-white/20 shadow transition-colors"
                        title="Zoom preview"
                      >
                        <HugeiconsIcon icon={ZoomInIcon} size={16} className="w-3 h-3" />
                      </a>
                    </div>
                  )}

                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-black shadow">
                      <HugeiconsIcon icon={CheckIcon} size={16} className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Bottom Asset Label */}
                <div className="px-2 py-1.5 bg-[hsl(var(--surface-1))] border-t border-white/[0.06] flex items-center justify-between gap-1">
                  <span className={`text-xs truncate font-medium ${isSelected ? 'text-primary font-bold' : 'text-zinc-200'}`}>
                    {asset.name}
                  </span>

                  {/* 3-Dots Menu */}
                  <div className="relative" data-asset-menu={asset.id}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuAssetId(activeMenuAssetId === asset.id ? null : asset.id);
                      }}
                      className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))] transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={MoreVerticalIcon} size={16} className="w-3.5 h-3.5" />
                    </button>

                      {activeMenuAssetId === asset.id && (
                        <div className="absolute right-0 bottom-full mb-1 w-28 py-1 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.1] shadow-xl z-50 text-xs font-medium animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateAsset(asset.id);
                              setActiveMenuAssetId(null);
                            }}
                           className="w-full text-left px-2.5 py-1.5 text-zinc-200 hover:bg-[hsl(var(--surface-3))] flex items-center gap-1.5 cursor-pointer"
                         >
                           <HugeiconsIcon icon={Copy} size={16} className="w-3 h-3 text-primary" />
                           <span>Duplicate</span>
                         </button>
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             deleteAsset(asset.id);
                             setActiveMenuAssetId(null);
                           }}
                           className="w-full text-left px-2.5 py-1.5 text-rose-400 hover:bg-rose-500/10 flex items-center gap-1.5 cursor-pointer"
                         >
                           <HugeiconsIcon icon={Trash2} size={16} className="w-3 h-3" />
                           <span>Delete</span>
                         </button>
                        </div>
                      )}
                   </div>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="px-3 py-2 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] flex items-center justify-between text-xs text-zinc-400">
        <span className="text-[10px] text-zinc-500 font-mono">
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActivePage(Math.max(1, activePage - 1))}
            disabled={activePage <= 1}
            className="p-1 rounded-lg hover:text-white hover:bg-[hsl(var(--surface-2))] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ChevronLeft} size={16} className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button
              key={page}
              onClick={() => setActivePage(page)}
              className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold transition-all cursor-pointer ${
                safePage === page ? 'bg-primary text-black shadow-sm font-extrabold' : 'hover:text-white hover:bg-[hsl(var(--surface-2))] text-zinc-400'
              }`}
            >
              {page}
            </button>
          ))}

          <button
            onClick={() => setActivePage(Math.min(totalPages, activePage + 1))}
            disabled={activePage >= totalPages}
            className="p-1 rounded-lg hover:text-white hover:bg-[hsl(var(--surface-2))] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ChevronRight} size={16} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* UploadIcon Diagnostic Modal */}
      <UploadDiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => {
          setIsDiagnosticOpen(false);
          setDiagnosticFile(null);
        }}
        initialFile={diagnosticFile}
      />
    </div>
  );
};
