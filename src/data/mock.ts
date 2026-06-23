import type {
  DatasetVersion,
  EvaluationReport,
  InferenceJob,
  ModelVersion,
  NavItem,
  SampleItem,
  TrainingRun
} from '../types';

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', description: '生产状态和风险队列' },
  { id: 'datasets', label: '数据集', description: '上传、校验和版本管理' },
  { id: 'labeling', label: '标注审核', description: '人工复核和标签修正' },
  { id: 'training', label: '模型训练', description: '配置、训练和日志' },
  { id: 'evaluation', label: '模型评估', description: '阈值、误判和指标' },
  { id: 'inference', label: '推理测试', description: '单张和批量诊断' },
  { id: 'models', label: '模型仓库', description: '版本、上线和回滚' },
  { id: 'export', label: '模型导出', description: 'ONNX 生产包' },
  { id: 'settings', label: '设置', description: '路径、权限和资源' }
];

export const mockDatasetVersions: DatasetVersion[] = [
  {
    id: 'ds-20260618-v7',
    name: '主产线 D2D 缺陷数据',
    version: 'v7',
    createdAt: '2026-06-18 14:30',
    status: 'ready',
    okCount: 14820,
    ngCount: 426,
    hardOkCount: 312,
    unlabeledCount: 96,
    owner: '工艺 A 班'
  },
  {
    id: 'ds-20260617-v6',
    name: '主产线 D2D 缺陷数据',
    version: 'v6',
    createdAt: '2026-06-17 18:05',
    status: 'warning',
    okCount: 13760,
    ngCount: 384,
    hardOkCount: 284,
    unlabeledCount: 188,
    owner: '工艺 A 班'
  },
  {
    id: 'ds-20260615-v5',
    name: '亮度漂移补强集',
    version: 'v5',
    createdAt: '2026-06-15 21:20',
    status: 'ready',
    okCount: 9160,
    ngCount: 241,
    hardOkCount: 128,
    unlabeledCount: 0,
    owner: '算法组'
  }
];

export const mockSamples: SampleItem[] = [
  {
    id: 'sample-001',
    datasetVersionId: 'ds-20260618-v7',
    filename: 'sample_s23_i1725_d2308.png',
    sourceLot: 'LOT-0618-A09',
    label: 'UNLABELED',
    decision: 'UNLABELED',
    probabilityNg: 0.82,
    risk: 'high',
    imageTone: 'cool'
  },
  {
    id: 'sample-002',
    datasetVersionId: 'ds-20260618-v7',
    filename: 'sample_s71_i7077_d0.png',
    sourceLot: 'LOT-0618-B12',
    label: 'OK',
    decision: 'OK',
    probabilityNg: 0.14,
    risk: 'low',
    imageTone: 'neutral'
  },
  {
    id: 'sample-003',
    datasetVersionId: 'ds-20260618-v7',
    filename: 'sample_s1_i11580_d90.png',
    sourceLot: 'LOT-0618-C04',
    label: 'NG',
    decision: 'NG',
    probabilityNg: 0.93,
    risk: 'high',
    imageTone: 'warm'
  },
  {
    id: 'sample-004',
    datasetVersionId: 'ds-20260618-v7',
    filename: 'ok_sample_s22_i1524_d1906.png',
    sourceLot: 'LOT-0618-A02',
    label: 'OK_HARD',
    decision: 'OK_HARD',
    probabilityNg: 0.48,
    risk: 'medium',
    imageTone: 'cool'
  },
  {
    id: 'sample-005',
    datasetVersionId: 'ds-20260618-v7',
    filename: 'ng_sample_s0_i38_d0.png',
    sourceLot: 'LOT-0618-D01',
    label: 'UNLABELED',
    decision: 'UNLABELED',
    probabilityNg: 0.67,
    risk: 'medium',
    imageTone: 'warm'
  }
];

export const trainingMetrics = [
  { epoch: 1, loss: 0.482, recallNg: 0.921, falseNegative: 9, falsePositive: 118, threshold: 0.24 },
  { epoch: 5, loss: 0.331, recallNg: 0.948, falseNegative: 6, falsePositive: 134, threshold: 0.22 },
  { epoch: 10, loss: 0.246, recallNg: 0.967, falseNegative: 3, falsePositive: 148, threshold: 0.2 },
  { epoch: 15, loss: 0.196, recallNg: 0.976, falseNegative: 2, falsePositive: 156, threshold: 0.18 },
  { epoch: 20, loss: 0.171, recallNg: 0.981, falseNegative: 1, falsePositive: 169, threshold: 0.16 },
  { epoch: 24, loss: 0.158, recallNg: 0.986, falseNegative: 0, falsePositive: 181, threshold: 0.15 }
];

export const mockTrainingRuns: TrainingRun[] = [
  {
    id: 'run-20260618-1435',
    datasetVersionId: 'ds-20260618-v7',
    modelName: 'tinycnn-d2d6-avgmax',
    status: 'running',
    progress: 0.68,
    startedAt: '2026-06-18 14:35',
    epochs: 36,
    currentEpoch: 24,
    metrics: trainingMetrics,
    logs: [
      '14:35 加载数据集 ds-20260618-v7',
      '14:36 启用 balanced sampler 和 GroupNorm',
      '14:47 Epoch 10: FN=3 FP=148 threshold=0.200',
      '15:03 Epoch 24: FN=0 FP=181 threshold=0.150'
    ]
  },
  {
    id: 'run-20260617-2030',
    datasetVersionId: 'ds-20260617-v6',
    modelName: 'tinycnn-raw3-robust',
    status: 'completed',
    progress: 1,
    startedAt: '2026-06-17 20:30',
    epochs: 80,
    currentEpoch: 80,
    metrics: trainingMetrics.slice(0, 5),
    logs: ['训练完成，已保存 best.pt 和 threshold.json']
  }
];

export const mockEvaluation: EvaluationReport = {
  id: 'eval-20260618-1515',
  modelVersionId: 'model-v12',
  datasetVersionId: 'ds-20260618-v7',
  recallNg: 0.986,
  accuracy: 0.972,
  falseNegative: 0,
  falsePositive: 181,
  threshold: 0.15,
  confusion: {
    trueNg: 426,
    missedNg: 0,
    falseAlarmOk: 181,
    trueOk: 14639
  }
};

export const mockInferenceJobs: InferenceJob[] = [
  {
    id: 'infer-001',
    name: 'LOT-0618-A09 批量诊断',
    mode: 'batch',
    status: 'completed',
    total: 1200,
    ngCount: 31,
    okCount: 1169,
    createdAt: '2026-06-18 15:08'
  },
  {
    id: 'infer-002',
    name: '单张复核 sample_s23_i1725_d2308',
    mode: 'single',
    status: 'completed',
    total: 1,
    ngCount: 1,
    okCount: 0,
    createdAt: '2026-06-18 15:21'
  }
];

export const mockModels: ModelVersion[] = [
  {
    id: 'model-v12',
    name: 'tinycnn-d2d6-avgmax',
    version: 'v12',
    datasetVersionId: 'ds-20260618-v7',
    createdAt: '2026-06-18 15:16',
    recallNg: 0.986,
    falseNegative: 0,
    falsePositive: 181,
    threshold: 0.15,
    format: 'pt+onnx',
    production: true
  },
  {
    id: 'model-v11',
    name: 'tinycnn-raw3-robust',
    version: 'v11',
    datasetVersionId: 'ds-20260617-v6',
    createdAt: '2026-06-17 21:40',
    recallNg: 0.974,
    falseNegative: 2,
    falsePositive: 142,
    threshold: 0.2,
    format: 'pt+onnx',
    production: false
  },
  {
    id: 'model-v10',
    name: 'tinycnn-meanabs3',
    version: 'v10',
    datasetVersionId: 'ds-20260615-v5',
    createdAt: '2026-06-15 23:10',
    recallNg: 0.961,
    falseNegative: 4,
    falsePositive: 96,
    threshold: 0.22,
    format: 'pt',
    production: false
  }
];
