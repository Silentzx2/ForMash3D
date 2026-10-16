'use client';

import { useCallback, useRef, useState } from 'react';
import { uploadMeshAsset, type MeshUploadStage, type ModelAsset } from '@/features/workspace/types';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { getUploadPercent } from '@/features/workspace/lib/uploadProgress';

export interface MeshAssetUploadState {
  status: 'idle' | MeshUploadStage | 'saved' | 'error';
  fileName: string;
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  error: string | null;
}

const initialState: MeshAssetUploadState = {
  status: 'idle',
  fileName: '',
  loadedBytes: 0,
  totalBytes: null,
  percent: 0,
  error: null,
};

export function useMeshAssetUpload() {
  const { addAsset, setCurrentAsset } = useWorkspace();
  const [state, setState] = useState(initialState);
  const uploadInProgress = useRef(false);

  const upload = useCallback(async (file: File): Promise<ModelAsset | null> => {
    if (uploadInProgress.current) return null;
    uploadInProgress.current = true;
    setState({ status: 'verifying', fileName: file.name, loadedBytes: 0, totalBytes: null, percent: null, error: null });
    try {
      const asset = await uploadMeshAsset(file, {
        onStage: (status) => setState((current) => ({ ...current, status })),
        onProgress: (loadedBytes, totalBytes) => setState((current) => {
          const nextLoadedBytes = Math.max(current.loadedBytes, loadedBytes);
          const nextTotalBytes = Number.isFinite(totalBytes) && totalBytes! > 0 ? totalBytes! : null;
          const nextPercent = getUploadPercent(nextLoadedBytes, nextTotalBytes);
          return {
            ...current,
            status: 'uploading',
            loadedBytes: nextLoadedBytes,
            totalBytes: nextTotalBytes,
            percent: nextPercent === null ? null : Math.max(current.percent ?? 0, nextPercent),
          };
        }),
      });
      addAsset(asset);
      setCurrentAsset(asset);
      setState({ status: 'saved', fileName: file.name, loadedBytes: file.size, totalBytes: file.size, percent: 100, error: null });
      return asset;
    } catch (error) {
      setState({
        status: 'error',
        fileName: file.name,
        loadedBytes: 0,
        totalBytes: null,
        percent: 0,
        error: error instanceof Error ? error.message : 'Mesh upload failed.',
      });
      return null;
    } finally {
      uploadInProgress.current = false;
    }
  }, [addAsset, setCurrentAsset]);

  return { state, upload };
}