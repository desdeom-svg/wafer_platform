import type {
  DatasetVersion,
  EvaluationReport,
  InferenceJob,
  ModelVersion,
  SampleDecision,
  SampleItem,
  SystemMetrics,
  TrainingConfig,
  TrainingRun
} from './types';

export interface PlatformState {
  datasets: DatasetVersion[];
  samples: SampleItem[];
  trainingRuns: TrainingRun[];
  models: ModelVersion[];
  inferenceJobs: InferenceJob[];
  evaluations: EvaluationReport[];
  storageDir?: string;
  systemMetrics?: SystemMetrics;
}

export type SampleImageKind = 'triptych' | 'current' | 'ref1' | 'ref2';

export function sampleImageUrl(sampleId: string, kind: SampleImageKind = 'triptych'): string {
  return `/api/samples/${encodeURIComponent(sampleId)}/image?kind=${encodeURIComponent(kind)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

export const platformApi = {
  state: () => request<PlatformState>('/api/state'),

  registerDataset: (path: string, name?: string) =>
    request<PlatformState>('/api/datasets/register', {
      method: 'POST',
      body: JSON.stringify({ path, name })
    }),

  uploadDatasetZip: async (file: File) => {
    const contentBase64 = await readFileAsDataUrl(file);
    return request<PlatformState>('/api/datasets/upload', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, name: file.name.replace(/\.zip$/i, ''), contentBase64 })
    });
  },

  uploadDatasetZipWithProgress: async (file: File, onProgress: (progress: number) => void) => {
    const contentBase64 = await readFileAsDataUrl(file, (progress) => onProgress(progress * 0.45));
    return requestWithProgress<PlatformState>(
      '/api/datasets/upload',
      { filename: file.name, name: file.name.replace(/\.zip$/i, ''), contentBase64 },
      (progress) => onProgress(0.45 + progress * 0.55)
    );
  },

  renameDataset: (datasetId: string, name: string) =>
    request<PlatformState>(`/api/datasets/${datasetId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name })
    }),

  deleteDataset: (datasetId: string) =>
    request<PlatformState>(`/api/datasets/${datasetId}/delete`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  datasetSamples: (datasetId: string) =>
    request<{ datasetVersionId: string; samples: SampleItem[] }>(`/api/datasets/${datasetId}/samples`),

  setSampleDecision: (sampleId: string, decision: SampleDecision) =>
    request<PlatformState>(`/api/samples/${sampleId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    }),

  startTraining: (datasetVersionId: string, config: TrainingConfig) =>
    request<PlatformState>('/api/training-runs', {
      method: 'POST',
      body: JSON.stringify({ datasetVersionId, epochs: config.epochs, config })
    }),

  stopTraining: (runId: string) =>
    request<PlatformState>(`/api/training-runs/${runId}/stop`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  runEvaluation: (datasetVersionId: string, modelVersionId: string) =>
    request<PlatformState>('/api/evaluations', {
      method: 'POST',
      body: JSON.stringify({ datasetVersionId, modelVersionId })
    }),

  runInference: (inputPath: string, modelVersionId: string) =>
    request<PlatformState>('/api/inference-jobs', {
      method: 'POST',
      body: JSON.stringify({ inputPath, modelVersionId })
    }),

  setProductionModel: (modelId: string) =>
    request<PlatformState>(`/api/models/${modelId}/production`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  renameModel: (modelId: string, name: string) =>
    request<PlatformState>(`/api/models/${modelId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name })
    }),

  deleteModel: (modelId: string) =>
    request<PlatformState>(`/api/models/${modelId}/delete`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  renameInferenceJob: (jobId: string, name: string) =>
    request<PlatformState>(`/api/inference-jobs/${jobId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name })
    }),

  deleteInferenceJob: (jobId: string) =>
    request<PlatformState>(`/api/inference-jobs/${jobId}/delete`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  exportModel: (modelId: string) =>
    request<{ state: PlatformState; exportDir: string }>(`/api/models/${modelId}/export`, {
      method: 'POST',
      body: JSON.stringify({})
    })
};

function readFileAsDataUrl(file: File, onProgress?: (progress: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    reader.readAsDataURL(file);
  });
}

function requestWithProgress<T>(path: string, payload: unknown, onProgress: (progress: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve(data as T);
        } else {
          reject(new Error(data.error || `Request failed: ${xhr.status}`));
        }
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(JSON.stringify(payload));
  });
}
