import { describe, expect, it } from 'vitest';
import { sampleImageUrl } from './api';
import { navItems, mockDatasetVersions, mockSamples, mockTrainingRuns } from './data/mock';
import { defaultTrainingConfig } from './trainingConfig';
import {
  filterSamplesByDataset,
  filterSamplesForReview,
  getRiskQueue,
  getTrainingActions,
  getVisibleSamples,
  mergeSamplesByDataset,
  updateSampleDecision
} from './utils/appState';

describe('wafer platform model', () => {
  it('covers all planned primary navigation entries with Chinese labels', () => {
    expect(navItems.map((item) => item.id)).toEqual([
      'overview',
      'datasets',
      'labeling',
      'training',
      'evaluation',
      'inference',
      'models',
      'export',
      'settings'
    ]);
    expect(navItems.map((item) => item.label)).toEqual([
      '总览',
      '数据集',
      '标注审核',
      '模型训练',
      '模型评估',
      '推理测试',
      '模型仓库',
      '模型导出',
      '设置'
    ]);
  });

  it('keeps dataset and sample mock data traceable by version id', () => {
    const activeVersion = mockDatasetVersions[0];
    expect(mockSamples.every((sample) => sample.datasetVersionId === activeVersion.id)).toBe(true);
  });

  it('derives Chinese risk queue from training and labeling state', () => {
    const risks = getRiskQueue(mockSamples, mockTrainingRuns);
    expect(risks.some((risk) => risk.title === '待审核样本')).toBe(true);
    expect(risks.some((risk) => risk.title === '训练任务运行中')).toBe(true);
  });

  it('updates a sample decision without mutating the original collection', () => {
    const updated = updateSampleDecision(mockSamples, mockSamples[0].id, 'NG');
    expect(updated[0].decision).toBe('NG');
    expect(mockSamples[0].decision).not.toBe('NG');
  });

  it('builds stable real-image endpoints for dataset sample previews', () => {
    expect(sampleImageUrl('sample-001')).toBe('/api/samples/sample-001/image?kind=triptych');
    expect(sampleImageUrl('sample-001', 'ref2')).toBe('/api/samples/sample-001/image?kind=ref2');
  });

  it('keeps training actions explicit while a run is active', () => {
    const actions = getTrainingActions(mockTrainingRuns);
    expect(actions.start.label).toBe('训练运行中...');
    expect(actions.start.enabled).toBe(false);
    expect(actions.refresh.label).toBe('刷新状态');
    expect(actions.stop.label).toBe('停止训练');
    expect(actions.stop.enabled).toBe(true);
  });

  it('filters sample preview by selected dataset version', () => {
    const otherSample = { ...mockSamples[0], id: 'other-sample', datasetVersionId: 'ds-other' };
    const selected = filterSamplesByDataset([...mockSamples, otherSample], mockDatasetVersions[0].id);
    expect(selected).toHaveLength(mockSamples.length);
    expect(selected.every((sample) => sample.datasetVersionId === mockDatasetVersions[0].id)).toBe(true);
  });

  it('limits visible samples so image-heavy pages render in batches', () => {
    const manySamples = Array.from({ length: 120 }, (_, index) => ({ ...mockSamples[0], id: `sample-${index}` }));
    expect(getVisibleSamples(manySamples, 48)).toHaveLength(48);
    expect(getVisibleSamples(manySamples, 160)).toHaveLength(120);
  });

  it('filters labeling queues by review decision category', () => {
    const updated = updateSampleDecision(mockSamples, mockSamples[0].id, 'NG');
    expect(filterSamplesForReview(updated, 'NG').map((sample) => sample.id)).toContain(mockSamples[0].id);
    expect(filterSamplesForReview(updated, 'unlabeled').every((sample) => sample.decision === 'UNLABELED')).toBe(true);
  });

  it('merges partial state refreshes without dropping cached dataset samples', () => {
    const cached = mockSamples.map((sample, index) => ({ ...sample, id: `cached-${index}` }));
    const partial = [{ ...cached[0], probabilityNg: 0.99 }];
    const merged = mergeSamplesByDataset(cached, partial);
    expect(merged).toHaveLength(cached.length);
    expect(merged.find((sample) => sample.id === cached[0].id)?.probabilityNg).toBe(0.99);
  });

  it('uses the proven raw3 robust training recipe as UI defaults', () => {
    expect(defaultTrainingConfig).toMatchObject({
      epochs: 500,
      batchSize: 128,
      lr: 0.0002,
      inputSize: 32,
      arch: 'tinycnn',
      inputMode: 'raw3',
      intensityNorm: 'robust',
      selectionMode: 'fp-under-fn-cap',
      maxValFn: 2,
      maxGuardFn: 15,
      maxThreshold: 0.75,
      device: 'cpu',
      numWorkers: 4,
      amp: 0,
      channelsLast: 0,
      guardEvalEvery: 5,
      cudnnBenchmark: 0
    });
  });
});
