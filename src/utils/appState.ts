import type { RiskItem, SampleDecision, SampleItem, TrainingRun } from '../types';

export type SampleReviewFilter = 'all' | 'risk' | 'unlabeled' | SampleDecision;

export function updateSampleDecision(
  samples: SampleItem[],
  sampleId: string,
  decision: SampleDecision
): SampleItem[] {
  return samples.map((sample) => (sample.id === sampleId ? { ...sample, decision } : sample));
}

export function filterSamplesByDataset(samples: SampleItem[], datasetVersionId: string): SampleItem[] {
  return samples.filter((sample) => sample.datasetVersionId === datasetVersionId);
}

export function filterSamplesForReview(samples: SampleItem[], filter: SampleReviewFilter): SampleItem[] {
  if (filter === 'risk') return samples.filter((sample) => sample.risk !== 'low');
  if (filter === 'unlabeled') return samples.filter((sample) => sample.decision === 'UNLABELED');
  if (filter === 'all') return samples;
  return samples.filter((sample) => sample.decision === filter);
}

export function mergeSamplesByDataset(current: SampleItem[], incoming: SampleItem[]): SampleItem[] {
  if (incoming.length === 0) return current;
  const incomingById = new Map(incoming.map((sample) => [sample.id, sample]));
  const merged = current.map((sample) => incomingById.get(sample.id) ?? sample);
  const currentIds = new Set(current.map((sample) => sample.id));
  return [...merged, ...incoming.filter((sample) => !currentIds.has(sample.id))];
}

export function getVisibleSamples(samples: SampleItem[], limit: number): SampleItem[] {
  return samples.slice(0, Math.max(0, limit));
}

export function getRiskQueue(samples: SampleItem[], runs: TrainingRun[]): RiskItem[] {
  const unlabeledCount = samples.filter((sample) => sample.decision === 'UNLABELED').length;
  const highRiskUnlabeled = samples.filter(
    (sample) => sample.decision === 'UNLABELED' && sample.risk === 'high'
  ).length;
  const runningRun = runs.find((run) => run.status === 'running');
  const latestMetric = runningRun?.metrics.at(-1);

  const risks: RiskItem[] = [];

  if (unlabeledCount > 0) {
    risks.push({
      id: 'risk-labeling',
      kind: 'labeling',
      title: '待审核样本',
      detail: `${unlabeledCount} 个样本待标注，其中 ${highRiskUnlabeled} 个为高 NG 概率`,
      severity: highRiskUnlabeled > 0 ? 'high' : 'medium'
    });
  }

  if (runningRun && latestMetric) {
    risks.push({
      id: 'risk-training',
      kind: 'training',
      title: '训练任务运行中',
      detail: `${runningRun.modelName} 已到 Epoch ${runningRun.currentEpoch}/${runningRun.epochs}，FN=${latestMetric.falseNegative}`,
      severity: latestMetric.falseNegative > 0 ? 'medium' : 'low'
    });
  }

  risks.push({
    id: 'risk-evaluation',
    kind: 'evaluation',
    title: '上线前复核',
    detail: '生产模型阈值为 0.15，建议复核最新误判样本包',
    severity: 'low'
  });

  return risks;
}

export function getTrainingActions(runs: TrainingRun[]) {
  const runningRun = runs.find((run) => run.status === 'running');
  return {
    start: {
      label: runningRun ? '训练运行中...' : '开始训练',
      enabled: !runningRun
    },
    refresh: { label: '刷新状态', enabled: true },
    stop: { label: '停止训练', enabled: Boolean(runningRun), runId: runningRun?.id }
  };
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}
