import { useState, useCallback } from 'react';

export interface UploadProgress {
  active: boolean;
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  fileName: string;
}

const initialProgress: UploadProgress = {
  active: false,
  percent: 0,
  loadedBytes: 0,
  totalBytes: 0,
  fileName: '',
};

export function useUploadProgress() {
  const [progress, setProgress] = useState<UploadProgress>(initialProgress);

  const startUpload = useCallback((fileName: string, totalBytes: number) => {
    setProgress({ active: true, percent: 0, loadedBytes:0,totalBytes, fileName });
  }, []);

  const updateProgress = useCallback((loadedBytes: number) => {
    setProgress(prev => {
      if (!prev.active || prev.totalBytes === 0) return prev;
      const percent = Math.min(100, Math.round((loadedBytes / prev.totalBytes) * 100));
      return { ...prev, loadedBytes, percent };
    });
  }, []);

  const finishUpload = useCallback(() => {
    setProgress(prev => ({ ...prev, active: false, percent: 100 }));
    setTimeout(() => setProgress(initialProgress), 800);
  }, []);

  const failUpload = useCallback(() => {
    setProgress(initialProgress);
  }, []);

  const readFileWithProgress = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      startUpload(file.name, file.size);
      const reader = new FileReader();

      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          updateProgress(e.loaded);
        }
      };

      reader.onload = () => {
        finishUpload();
        resolve(reader.result as string);
      };

      reader.onerror = () => {
        failUpload();
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }, [startUpload, updateProgress, finishUpload, failUpload]);

  return { progress, readFileWithProgress, startUpload, updateProgress, finishUpload, failUpload };
}
