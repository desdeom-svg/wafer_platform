export type PageId =
  | 'overview'
  | 'datasets'
  | 'labeling'
  | 'training'
  | 'evaluation'
  | 'inference'
  | 'models'
  | 'export'
  | 'settings';

export type SampleDecision = 'OK' | 'NG' | 'OK_HARD' | 'IGNORE' | 'UNLABELED';

export interface NavItem {
  id: PageId;
  label: string;
  description: string;
}

export interface DatasetVersion {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  status: 'ready' | 'validating' | 'warning';
  okCount: number;
  ngCount: number;
  hardOkCount: number;
  unlabeledCount: number;
  owner: string;
  path?: string;
}

export interface SampleItem {
  id: string;
  datasetVersionId: string;
  filename: string;
  sourceLot: string;
  label: SampleDecision;
  decision: SampleDecision;
  probabilityNg: number;
  risk: 'high' | 'medium' | 'low';
  imageTone: 'cool' | 'warm' | 'neutral';
  path?: string;
}

export interface TrainingRun {
  id: string;
  datasetVersionId: string;
  modelName: string;
  status: 'running' | 'completed' | 'queued' | 'stopped';
  progress: number;
  startedAt: string;
  epochs: number;
  currentEpoch: number;
  metrics: TrainingMetric[];
  logs: string[];
  runDir?: string;
}

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  lr: number;
  warmupEpochs: number;
  valRatio: number;
  inputSize: number;
  arch: 'tinycnn' | 'tinycnn_diffv2';
  inputMode: 'raw3' | 'd2d6' | 'meanabs3';
  intensityNorm: 'raw' | 'robust';
  norm: 'group' | 'batch' | 'none';
  pooling: 'avg' | 'avgmax';
  balancedSampler: 0 | 1;
  ngHardAugRepeat: number;
  guardNgTrainRepeat: number;
  earlyStop: 0 | 1;
  selectionMode: 'fn-first' | 'fp-under-fn-cap';
  maxValFn: number;
  maxGuardFn: number;
  posWeight: string;
  loss: 'bce' | 'focal' | 'bce_ng_margin';
  minThreshold: number;
  thresholdMargin: number;
  maxThreshold: number;
  seed: number;
  device: string;
  numWorkers: number;
  amp: 0 | 1;
  channelsLast: 0 | 1;
  prefetchFactor: number;
  evalEvery: number;
  guardEvalEvery: number;
  cudnnBenchmark: 0 | 1;
}

export interface TrainingMetric {
  epoch: number;
  loss: number;
  recallNg: number;
  falseNegative: number;
  falsePositive: number;
  threshold: number;
}

export interface EvaluationReport {
  id: string;
  modelVersionId: string;
  datasetVersionId: string;
  recallNg: number;
  accuracy: number;
  falseNegative: number;
  falsePositive: number;
  threshold: number;
  confusion: {
    trueNg: number;
    missedNg: number;
    falseAlarmOk: number;
    trueOk: number;
  };
}

export interface InferenceJob {
  id: string;
  name: string;
  mode: 'single' | 'batch';
  status: 'completed' | 'running' | 'queued';
  progress?: number;
  total: number;
  ngCount: number;
  okCount: number;
  createdAt: string;
  reportPath?: string;
  modelVersionId?: string;
  inputPath?: string;
  results?: InferenceResult[];
}

export interface InferenceResult {
  id: string;
  sampleId?: string;
  filename: string;
  sourceLot?: string;
  probabilityNg: number;
  prediction: 'OK' | 'NG';
  path?: string;
}

export interface ModelVersion {
  id: string;
  name: string;
  version: string;
  datasetVersionId: string;
  createdAt: string;
  recallNg: number;
  falseNegative: number;
  falsePositive: number;
  threshold: number;
  format: 'pt' | 'onnx' | 'pt+onnx';
  production: boolean;
  weightsPath?: string;
  runId?: string;
  runDir?: string;
  trainingConfig?: Partial<TrainingConfig>;
}

export interface ExportRecord {
  id: string;
  modelVersionId: string;
  modelName: string;
  exportedAt: string;
  exportDir: string;
  format: string;
}

export interface SystemMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  updatedAt: string;
  cpuThreads?: number;
}

export interface RiskItem {
  id: string;
  kind: 'labeling' | 'training' | 'evaluation';
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}
