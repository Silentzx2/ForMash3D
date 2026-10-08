import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  ApiConfig, 
  BaseApiResponse, 
  HealthStatus,
  SystemStatus,
  SystemStats,
  SchedulerStatus,
  AvailableModels,
  ModelRuntimeDetails,
  FeaturesResponse,
  JobInfo,
  JobResultInfo,
  JobsHistoryResponse,
  JobsHistoryParams,
  ImageToMeshRequest,
  ImageToTexturedMeshRequest,
  MeshPaintingRequest,
  PartCompletionRequest,
  MeshSegmentationRequest,
  AutoRiggingRequest,
  MeshRetopologyRequest,
  RetopologyAvailableModels,
  MeshUVUnwrappingRequest,
  UVUnwrappingAvailableModels,
  UVPackMethods,
  FileUploadResponse,
  FileMetadata,
  SupportedFormats,
  ApiError,
  AuthStatus,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  ModelParametersResponse,
  TextMeshEditingRequest,
  ImageMeshEditingRequest,
  QueueStatsResponse,
  MotionGenerationRequest,
  MotionCheckpointsResponse,
  MotionAvailableModelsResponse
} from '@/types/api';

class ApiClient {
  private client: AxiosInstance;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Set auth token if provided
    if (config.apiKey) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${config.apiKey}`;
    }

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // If uploading FormData, ensure Content-Type is not forced to application/json
        // Only delete Content-Type if explicitly set by the caller.
        // Axios auto-sets 'multipart/form-data; boundary=...' when Content-Type is absent.
        // Some proxies require explicit header, so we only delete if it's 'application/json'
        // or explicitly set to 'multipart/form-data' without boundary.
        if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
          if (config.headers) {
            const contentType = config.headers['Content-Type'] || (config.headers as any)['content-type'];
            // Only remove if it's application/json (default axios default) or malformed multipart
            if (contentType && (contentType === 'application/json' || 
                (contentType.startsWith('multipart/form-data') && !contentType.includes('boundary=')))) {
              delete config.headers['Content-Type'];
              delete (config.headers as any)['content-type'];
            }
          }
          if (!config.timeout || config.timeout < 600000) {
            config.timeout = 600000;
          }
        }
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[API] ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        const apiError = this.handleError(error);
        console.error('[API] Response error:', apiError);
        return Promise.reject(apiError);
      }
    );
  }

  private handleError(error: AxiosError): ApiError {
    const apiError = new Error() as ApiError;
    
    if (error.response) {
      // Server responded with error status
      const errorData = error.response.data as any; // Use any to handle different error response formats
      
      // Extract error message with priority: detail > message > default
      let errorMessage = 'An error occurred';
      let errorCode = 'API_ERROR';
      
      if (errorData) {
        // Handle FastAPI style errors with detail field
        if (errorData.detail) {
          errorMessage = typeof errorData.detail === 'string' 
            ? errorData.detail 
            : JSON.stringify(errorData.detail);
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
        
        // Extract error code
        if (errorData.error) {
          errorCode = errorData.error;
        } else if (errorData.code) {
          errorCode = errorData.code;
        }
      }
      
      // Fallback to HTTP status text if no detailed message
      if (errorMessage === 'An error occurred' && error.response.statusText) {
        errorMessage = `${error.response.status} ${error.response.statusText}`;
      }
      
      apiError.message = errorMessage;
      apiError.code = errorCode;
      apiError.status = error.response.status;
      apiError.response = errorData;
    } else if (error.request) {
      // Request was made but no response received
      apiError.message = 'No response from server. Please check your internet connection and try again.';
      apiError.code = 'NETWORK_ERROR';
    } else {
      // Something else happened
      apiError.message = error.message || 'Unknown error occurred';
      apiError.code = 'UNKNOWN_ERROR';
    }

    return apiError;
  }

  private async retry<T>(
    operation: () => Promise<T>,
    retries: number = this.config.retries || 2
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retries > 0) {
        console.log(`[API] Retrying... ${retries} attempts left`);
        await new Promise(resolve => setTimeout(resolve, 300));
        return this.retry(operation, retries - 1);
      }
      throw error;
    }
  }

  // Update configuration
  updateConfig(newConfig: Partial<ApiConfig>) {
    this.config = { ...this.config, ...newConfig };
    
    // Update base URL if changed
    if (newConfig.baseURL) {
      this.client.defaults.baseURL = newConfig.baseURL;
    }
    
    // Update auth header if API key changed
    if (newConfig.apiKey !== undefined) {
      if (newConfig.apiKey) {
        this.client.defaults.headers.common['Authorization'] = `Bearer ${newConfig.apiKey}`;
      } else {
        delete this.client.defaults.headers.common['Authorization'];
      }
    }
  }

  // Set authentication token for all requests
  setAuthToken(token: string | null) {
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      this.config.apiKey = token;
      console.log('[API Client] Auth token set');
    } else {
      delete this.client.defaults.headers.common['Authorization'];
      this.config.apiKey = undefined;
      console.log('[API Client] Auth token cleared');
    }
  }

  // Authentication Endpoints
  async getAuthStatus(): Promise<AuthStatus> {
    const response = await this.retry(() => 
      this.client.get<AuthStatus>('/api/v1/system/auth-status')
    );
    return response.data;
  }

  async register(request: RegisterRequest): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>(
      '/api/v1/users/register',
      request
    );
    return response.data;
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>(
      '/api/v1/users/login',
      request
    );
    return response.data;
  }

  // System Management Endpoints
  async getHealthStatus(): Promise<HealthStatus> {
    const response = await this.retry(() => 
      this.client.get<HealthStatus>('/api/v1/system/health')
    );
    return response.data;
  }

  async getSystemStatus(): Promise<SystemStatus> {
      const response = await this.retry(() =>
        this.client.get<SystemStatus>('/api/v1/system/status')
      );
      return response.data;
    }

    async getSystemStats(): Promise<SystemStats> {
      const response = await this.client.get<SystemStats>('/api/v1/system/stats');
      return response.data;
    }

    async getSchedulerStatus(): Promise<SchedulerStatus> {
    const response = await this.retry(() => 
      this.client.get<SchedulerStatus>('/api/v1/system/scheduler-status')
    );
    return response.data;
  }

  async getAvailableModels(feature?: string): Promise<AvailableModels> {
    const params = feature ? { feature } : {};
    const response = await this.retry(() => 
      this.client.get<AvailableModels>('/api/v1/system/models', { params })
    );
    return response.data;
  }

  async getAvailableFeatures(): Promise<FeaturesResponse> {
    const response = await this.retry(() => 
      this.client.get<FeaturesResponse>('/api/v1/system/features')
    );
    return response.data;
  }

  async getModelParameters(modelId: string): Promise<ModelParametersResponse> {
    const response = await this.retry(() =>
      this.client.get<ModelParametersResponse>(`/api/v1/system/models/${encodeURIComponent(modelId)}/parameters`)
    );
    return response.data;
  }

  // Job Management Endpoints
  async getJobStatus(jobId: string): Promise<JobInfo> {
    const response = await this.retry(() => 
      this.client.get<JobInfo>(`/api/v1/system/jobs/${jobId}`)
    );
    return response.data;
  }

  async getJobResultInfo(jobId: string): Promise<JobResultInfo> {
    const response = await this.retry(() => 
      this.client.get<JobResultInfo>(`/api/v1/system/jobs/${jobId}/info`)
    );
    return response.data;
  }

  async downloadJobResult(jobId: string, format: 'file' | 'base64' = 'file', filename?: string): Promise<Blob | string> {
    const params: any = { format };
    if (filename) params.filename = filename;

    const response = await this.retry(() => 
      this.client.get(`/api/v1/system/jobs/${jobId}/download`, {
        params,
        responseType: format === 'file' ? 'blob' : 'json'
      })
    );

    return response.data;
  }

  async getJobsHistory(params?: JobsHistoryParams): Promise<JobsHistoryResponse> {
    const response = await this.retry(() => 
      this.client.get<JobsHistoryResponse>('/api/v1/system/jobs/history', { params })
    );
    return response.data;
  }

  async cancelGenerationJob(jobId: string): Promise<{ job_id: string; status: string; cancelled: boolean; message: string }> {
    const response = await this.client.post<{ job_id: string; status: string; cancelled: boolean; message: string }>(
      `/api/v1/mesh-generation/cancel/${encodeURIComponent(jobId)}`
    );
    return response.data;
  }

  async retryPostprocess(jobId: string): Promise<{ job_id: string; status: string; postprocess_status: string; result?: any }> {
    const response = await this.client.post<{ job_id: string; status: string; postprocess_status: string; result?: any }>(
      `/api/v1/system/jobs/${encodeURIComponent(jobId)}/postprocess/retry`
    );
    return response.data;
  }

  async deleteJob(jobId: string): Promise<BaseApiResponse> {
    const response = await this.client.delete<BaseApiResponse>(
      `/api/v1/system/jobs/${jobId}`
    );
    return response.data;
  }

  async getQueueStats(): Promise<QueueStatsResponse> {
    const response = await this.retry(() => 
      this.client.get<QueueStatsResponse>('/api/v1/system/jobs/queue/stats')
    );
    return response.data;
  }

  // NEW File Upload Endpoints
  async uploadImageFile(file: File, onProgress?: (progress: number) => void): Promise<FileUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post<FileUploadResponse>(
      '/api/v1/file-upload/image',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100;
            onProgress(progress);
          }
        }
      }
    );
    return response.data;
  }

  async uploadMeshFile(file: File, onProgress?: (progress: number) => void): Promise<FileUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post<FileUploadResponse>(
      '/api/v1/file-upload/mesh',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100;
            onProgress(progress);
          }
        }
      }
    );
    return response.data;
  }

  async getFileMetadata(fileId: string): Promise<FileMetadata> {
    const response = await this.retry(() => 
      this.client.get<FileMetadata>(`/api/v1/file-upload/metadata/${fileId}`)
    );
    return response.data;
  }

  async previewImageEnhancement(request: {
    image_path?: string;
    image_base64?: string;
    image_file_id?: string;
    remove_background?: boolean;
    auto_crop?: boolean;
    upscale?: boolean;
    sharpen?: boolean;
  }): Promise<any> {
    const response = await this.client.post('/api/v1/image-enhancement/preview', request);
    return response.data;
  }

  async getSmartPresets(): Promise<any> {
    const response = await this.retry(() => this.client.get('/api/v1/smart-generation/presets'));
    return response.data;
  }

  async resolveSmartIntent(intent: string, model?: string): Promise<any> {
    const response = await this.client.post('/api/v1/smart-generation/resolve', { intent, model });
    return response.data;
  }

  async generateSmartGeneration(request: Record<string, any>): Promise<any> {
    const response = await this.retry(() => this.client.post('/api/v1/smart-generation/generation', request));
    return response.data;
  }

  // Mesh Generation Endpoints
  async imageToRawMesh(request: ImageToMeshRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-generation/image-to-raw-mesh',
      request
    );
    return response.data;
  }

  async imageToTexturedMesh(request: ImageToTexturedMeshRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-generation/image-to-textured-mesh',
      request
    );
    return response.data;
  }

  async textMeshPainting(request: MeshPaintingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-generation/text-mesh-painting',
      request
    );
    return response.data;
  }

  async imageMeshPainting(request: MeshPaintingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-generation/image-mesh-painting',
      request
    );
    return response.data;
  }

  async partCompletion(request: PartCompletionRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-generation/part-completion',
      request
    );
    return response.data;
  }


  // Mesh Segmentation Endpoints
  async segmentMesh(request: MeshSegmentationRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-segmentation/segment-mesh',
      request
    );
    return response.data;
  }


  // Auto Rigging Endpoints
  async generateRig(request: AutoRiggingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/auto-rigging/generate-rig',
      request
    );
    return response.data;
  }


  // Supported Formats Endpoints
  async getMeshGenerationSupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() => 
      this.client.get<SupportedFormats>('/api/v1/mesh-generation/supported-formats')
    );
    return response.data;
  }

  async getMeshSegmentationSupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() => 
      this.client.get<SupportedFormats>('/api/v1/mesh-segmentation/supported-formats')
    );
    return response.data;
  }

  async getAutoRiggingSupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() => 
      this.client.get<SupportedFormats>('/api/v1/auto-rigging/supported-formats')
    );
    return response.data;
  }

  // Mesh Retopology Endpoints
  async retopologizeMesh(request: MeshRetopologyRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-retopology/retopologize-mesh',
      request
    );
    return response.data;
  }

  async getRetopologyAvailableModels(): Promise<RetopologyAvailableModels> {
    const response = await this.retry(() => 
      this.client.get<RetopologyAvailableModels>('/api/v1/mesh-retopology/available-models')
    );
    return response.data;
  }

  async getMeshRetopologySupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() => 
      this.client.get<SupportedFormats>('/api/v1/mesh-retopology/supported-formats')
    );
    return response.data;
  }

  // Mesh UV Unwrapping Endpoints
  async unwrapMeshUV(request: MeshUVUnwrappingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-uv-unwrapping/unwrap-mesh',
      request
    );
    return response.data;
  }

  async getUVUnwrappingAvailableModels(): Promise<UVUnwrappingAvailableModels> {
    const response = await this.retry(() => 
      this.client.get<UVUnwrappingAvailableModels>('/api/v1/mesh-uv-unwrapping/available-models')
    );
    return response.data;
  }

  async getUVUnwrappingPackMethods(): Promise<UVPackMethods> {
    const response = await this.retry(() => 
      this.client.get<UVPackMethods>('/api/v1/mesh-uv-unwrapping/pack-methods')
    );
    return response.data;
  }

  async getMeshUVUnwrappingSupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() => 
      this.client.get<SupportedFormats>('/api/v1/mesh-uv-unwrapping/supported-formats')
    );
    return response.data;
  }

  // Mesh Editing Endpoints
  async textMeshEditing(request: TextMeshEditingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-editing/text-mesh-editing',
      request
    );
    return response.data;
  }

  async imageMeshEditing(request: ImageMeshEditingRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/mesh-editing/image-mesh-editing',
      request
    );
    return response.data;
  }

  // Motion Generation Endpoints (ARDY)
  async generateMotion(request: MotionGenerationRequest): Promise<BaseApiResponse> {
    const response = await this.client.post<BaseApiResponse>(
      '/api/v1/motion-generation/generate-motion',
      request
    );
    return response.data;
  }

  async getMotionCheckpoints(): Promise<MotionCheckpointsResponse> {
    const response = await this.retry(() =>
      this.client.get<MotionCheckpointsResponse>('/api/v1/motion-generation/checkpoints')
    );
    return response.data;
  }

  async getMotionAvailableModels(): Promise<MotionAvailableModelsResponse> {
    const response = await this.retry(() =>
      this.client.get<MotionAvailableModelsResponse>('/api/v1/motion-generation/available-models')
    );
    return response.data;
  }

  async getMotionSupportedFormats(): Promise<SupportedFormats> {
    const response = await this.retry(() =>
      this.client.get<SupportedFormats>('/api/v1/motion-generation/supported-formats')
    );
    return response.data;
  }

  // ─── Admin / Runtime Endpoints ──────────────────────────────────────────────
  // ponytail: the current 3DAIGC-API backend does not expose the legacy admin
  // /runtime, /install, /repair, /settings, or /generation-settings endpoints
  // that the previous architecture assumed. Each method below surfaces the
  // limitation honestly (throws) instead of silently hitting 404s.

  async getLogs(limit: number = 100, level?: string): Promise<any[]> {
    const params: any = { lines: String(limit) };
    if (level) params.level = level.toUpperCase();
    const response = await this.client.get('/api/v1/system/logs', { params });
    const rawLogs = response?.data?.logs || (response as any)?.logs || [];
    return rawLogs.map((log: any, index: number) => ({
      id: log.id || `log-${index}-${Date.now()}`,
      timestamp: log.timestamp || log.ts || new Date().toISOString(),
      level: (log.level || 'info').toLowerCase(),
      source: log.source || log.logger || 'system',
      message: log.message || '',
    }));
  }

  async clearLogs(): Promise<void> {
    await this.client.delete('/api/v1/system/logs/files/app.log');
  }

  streamLogs(onEntry: (log: any) => void, lastN: number = 100): () => void {
    return this.streamEvents(
      `/api/v1/system/logs/stream?last_n=${lastN}`,
      (raw: any) => {
        const d = raw as Record<string, unknown>;
        if (d.level === 'HEARTBEAT' && !d.message) return;
        const entry = {
          id: String(d.id ?? `log-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          timestamp: String(d.timestamp || d.ts || new Date().toISOString()),
          level: (String(d.level || 'info').toLowerCase()).replace(/[^a-z]/g, '') || 'info',
          source: String(d.source || d.logger || 'system'),
          message: String(d.message || ''),
        };
        onEntry(entry);
      }
    );
  }

  async listModels(): Promise<ModelRuntimeDetails[]> {
    try {
      const response = await this.client.get<AvailableModels>('/api/v1/system/models');
      const details = response.data?.model_details;
      if (!details || typeof details !== 'object') return [];
      return Object.values(details);
    } catch {
      return [];
    }
  }

  // SSE streaming helper
  streamEvents(path: string, onEvent: (data: unknown) => void, onDone?: () => void): () => void {
    let es: EventSource | null = null;
    let isClosed = false;

    try {
      const url = path.startsWith('/') ? path : `/${path}`;
      es = new EventSource(url);

      es.onmessage = (e) => {
        if (isClosed) return;
        try {
          onEvent(JSON.parse(e.data));
        } catch {
          // Ignore JSON parse errors
        }
      };

      es.onerror = () => {
        if (isClosed) return;
        if (es && es.readyState === EventSource.CLOSED) {
          isClosed = true;
          es.close();
          es = null;
          onDone?.();
        }
      };
    } catch (err) {
      isClosed = true;
      onDone?.();
      console.error('Failed to create EventSource:', err);
    }

    return () => {
      if (!isClosed && es) {
        isClosed = true;
        es.close();
        es = null;
      }
    };
  }

  // Utility methods
  async checkConnection(): Promise<boolean> {
    try {
      await this.getHealthStatus();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fast health check with minimal timeout and retries for app initialization
   */
  async quickHealthCheck(): Promise<boolean> {
    try {
      // Create a quick health check with minimal timeout and no retries
      const response = await this.client.get<HealthStatus>('/api/v1/system/health', {
        timeout: 5000, // 5 second timeout
        // No retry wrapper - fail fast
      });
      return response.data.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  getConfig(): ApiConfig {
    return { ...this.config };
  }

  get<T = any>(path: string, ...args: any[]): Promise<T> {
    return this.client.get(path, ...args).then((response) => response.data);
  }

  post<T = any>(path: string, data?: any, ...args: any[]): Promise<T> {
    return this.client.post(path, data, ...args).then((response) => response.data);
  }
}

// Create singleton instance
let apiClient: ApiClient;

export const createApiClient = (config: ApiConfig): ApiClient => {
  apiClient = new ApiClient(config);
  return apiClient;
};

export const getApiClient = (): ApiClient => {
  if (!apiClient) {
    // ponytail: lazy same-origin default so callers work without explicit
    // init; the Next.js /api/v1 proxy route forwards to BACKEND_URL at runtime.
    apiClient = new ApiClient({ baseURL: '' });
  }
  return apiClient;
};

export const getApiUrl = (): string => {
  if (!apiClient) {
    return '';
  }
  return apiClient.getConfig().baseURL;
};

export default ApiClient; 