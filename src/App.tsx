import {
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Download,
  FileBarChart,
  FolderUp,
  Gauge,
  HardDrive,
  LineChart,
  Maximize2,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Upload,
  UserRound
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { platformApi, sampleImageUrl, type PlatformState, type SampleImageKind } from './api';
import { mockDatasetVersions, mockEvaluation, mockInferenceJobs, mockModels, mockSamples, navItems } from './data/mock';
import { defaultTrainingConfig } from './trainingConfig';
import type {
  DatasetVersion,
  EvaluationReport,
  ExportRecord,
  InferenceJob,
  InferenceResult,
  ModelVersion,
  PageId,
  SampleDecision,
  SampleItem,
  SystemMetrics,
  TrainingConfig,
  TrainingRun
} from './types';
import {
  filterSamplesByDataset,
  filterSamplesForReview,
  formatCount,
  formatPercent,
  getRiskQueue,
  getTrainingActions,
  getVisibleSamples,
  mergeSamplesByDataset,
  type SampleReviewFilter,
  updateSampleDecision
} from './utils/appState';

const navIconMap: Record<PageId, LucideIcon> = {
  overview: Gauge,
  datasets: Database,
  labeling: Tag,
  training: LineChart,
  evaluation: FileBarChart,
  inference: Search,
  models: Archive,
  export: Download,
  settings: Settings
};

const statusClass = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  validating: 'border-blue-200 bg-blue-50 text-blue-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700'
};

const decisionClass: Record<SampleDecision, string> = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  NG: 'border-red-200 bg-red-50 text-red-700',
  OK_HARD: 'border-amber-200 bg-amber-50 text-amber-700',
  IGNORE: 'border-slate-200 bg-slate-100 text-slate-600',
  UNLABELED: 'border-blue-200 bg-blue-50 text-blue-700'
};

const decisionLabel: Record<SampleDecision, string> = {
  OK: 'OK',
  NG: 'NG',
  OK_HARD: 'OK_HARD',
  IGNORE: '忽略',
  UNLABELED: '未标注'
};

const emptyMetrics: SystemMetrics = {
  cpuPercent: 0,
  memoryPercent: 0,
  memoryUsedGb: 0,
  memoryTotalGb: 0,
  updatedAt: ''
};

function App() {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [datasetVersions, setDatasetVersions] = useState(mockDatasetVersions);
  const [samples, setSamples] = useState(mockSamples);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [models, setModels] = useState(mockModels);
  const [inferenceJobs, setInferenceJobs] = useState(mockInferenceJobs);
  const [evaluations, setEvaluations] = useState<EvaluationReport[]>([mockEvaluation]);
  const [selectedDatasetId, setSelectedDatasetId] = useState(mockDatasetVersions[0].id);
  const [trainingDatasetId, setTrainingDatasetId] = useState(mockDatasetVersions[0].id);
  const [labelingDatasetId, setLabelingDatasetId] = useState(mockDatasetVersions[0].id);
  const [selectedSampleId, setSelectedSampleId] = useState(mockSamples[0].id);
  const [labelingSampleId, setLabelingSampleId] = useState(mockSamples[0].id);
  const [threshold, setThreshold] = useState(mockEvaluation.threshold);
  const [sampleFilter, setSampleFilter] = useState<SampleReviewFilter>('all');
  const [apiMode, setApiMode] = useState<'connecting' | 'live' | 'mock'>('connecting');
  const [notice, setNotice] = useState('正在连接本地后端...');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loadingDatasetId, setLoadingDatasetId] = useState<string | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>(emptyMetrics);
  const [exportRecords, setExportRecords] = useState<ExportRecord[]>([]);

  const selectedDataset = datasetVersions.find((dataset) => dataset.id === selectedDatasetId) ?? datasetVersions[0];
  const trainingDataset = datasetVersions.find((dataset) => dataset.id === trainingDatasetId) ?? datasetVersions[0];
  const labelingDataset = datasetVersions.find((dataset) => dataset.id === labelingDatasetId) ?? datasetVersions[0];
  const selectedDatasetSamples = useMemo(() => filterSamplesByDataset(samples, selectedDataset.id), [samples, selectedDataset.id]);
  const labelingDatasetSamples = useMemo(() => filterSamplesByDataset(samples, labelingDataset.id), [samples, labelingDataset.id]);
  const selectedSample = selectedDatasetSamples.find((sample) => sample.id === selectedSampleId) ?? selectedDatasetSamples[0] ?? samples[0];
  const selectedLabelingSample = labelingDatasetSamples.find((sample) => sample.id === labelingSampleId) ?? labelingDatasetSamples[0];
  const filteredLabelingSamples = useMemo(() => filterSamplesForReview(labelingDatasetSamples, sampleFilter), [labelingDatasetSamples, sampleFilter]);
  const risks = useMemo(() => getRiskQueue(selectedDatasetSamples.length ? selectedDatasetSamples : samples, trainingRuns), [selectedDatasetSamples, samples, trainingRuns]);
  const runningRun = trainingRuns.find((run) => run.status === 'running');
  const trainingRunning = Boolean(runningRun);
  const currentModel = models[0];

  useEffect(() => {
    void refreshState();
    const timer = window.setInterval(() => void refreshState(), trainingRunning ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [trainingRunning]);

  useEffect(() => {
    if (selectedDatasetSamples.length && !selectedDatasetSamples.some((sample) => sample.id === selectedSampleId)) {
      setSelectedSampleId(selectedDatasetSamples[0].id);
    }
  }, [selectedDatasetSamples, selectedSampleId]);

  useEffect(() => {
    if (labelingDatasetSamples.length && !labelingDatasetSamples.some((sample) => sample.id === labelingSampleId)) {
      setLabelingSampleId(labelingDatasetSamples[0].id);
    }
  }, [labelingDatasetSamples, labelingSampleId]);

  function applyState(state: PlatformState) {
    if (state.datasets) {
      setDatasetVersions(state.datasets);
      if (state.datasets.length > 0) {
        setSelectedDatasetId((current) => (state.datasets.some((dataset) => dataset.id === current) ? current : state.datasets[0].id));
        setTrainingDatasetId((current) => (state.datasets.some((dataset) => dataset.id === current) ? current : state.datasets[0].id));
        setLabelingDatasetId((current) => (state.datasets.some((dataset) => dataset.id === current) ? current : state.datasets[0].id));
      }
      const datasetIds = new Set(state.datasets.map((dataset) => dataset.id));
      setSamples((current) => current.filter((sample) => datasetIds.has(sample.datasetVersionId)));
    }
    if (state.samples) {
      setSamples((current) => {
        const merged = mergeSamplesByDataset(current, state.samples);
        setSelectedSampleId((selected) => (merged.some((sample) => sample.id === selected) ? selected : (merged[0]?.id ?? selected)));
        setLabelingSampleId((selected) => (merged.some((sample) => sample.id === selected) ? selected : (merged[0]?.id ?? selected)));
        return merged;
      });
    }
    if (state.trainingRuns) setTrainingRuns(state.trainingRuns);
    if (state.models) setModels(state.models);
    if (state.inferenceJobs) setInferenceJobs(state.inferenceJobs);
    if (state.evaluations) {
      setEvaluations(state.evaluations);
      if (state.evaluations.length > 0) {
        setThreshold(state.evaluations[0].threshold);
      }
    }
    if (state.systemMetrics) setSystemMetrics(state.systemMetrics);
    setApiMode('live');
    setNotice(`后端在线 - ${state.storageDir ?? 'storage'}`);
  }

  async function refreshState() {
    try {
      applyState(await platformApi.state());
    } catch (error) {
      setApiMode('mock');
      setNotice('后端未连接，当前使用前端模拟数据。');
    }
  }

  async function runAction(action: () => Promise<PlatformState | { state: PlatformState; exportDir: string }>, success: string) {
    try {
      const result = await action();
      if ('state' in result) {
        applyState(result.state);
        setNotice(`${success} - ${result.exportDir}`);
      } else {
        applyState(result);
        setNotice(success);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function loadDatasetSamples(datasetId: string, onFirstSample?: (id: string) => void) {
    if (apiMode === 'live') {
      setLoadingDatasetId(datasetId);
      platformApi
        .datasetSamples(datasetId)
        .then((result) => {
          setSamples((current) => mergeSamplesByDataset(current, result.samples));
          if (result.samples[0]) onFirstSample?.(result.samples[0].id);
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => setLoadingDatasetId((current) => (current === datasetId ? null : current)));
    }
  }

  function handleSelectDataset(datasetId: string) {
    setSelectedDatasetId(datasetId);
    const cachedSample = samples.find((sample) => sample.datasetVersionId === datasetId);
    if (cachedSample) setSelectedSampleId(cachedSample.id);
    loadDatasetSamples(datasetId, setSelectedSampleId);
  }

  function handleSelectLabelingDataset(datasetId: string) {
    setLabelingDatasetId(datasetId);
    const cachedSample = samples.find((sample) => sample.datasetVersionId === datasetId);
    if (cachedSample) setLabelingSampleId(cachedSample.id);
    loadDatasetSamples(datasetId, setLabelingSampleId);
  }

  function handleDecision(decision: SampleDecision, sampleId = selectedLabelingSample?.id) {
    const target = samples.find((sample) => sample.id === sampleId);
    if (!target) return;
    setSamples((current) => updateSampleDecision(current, target.id, decision));
    if (apiMode === 'live') {
      void runAction(() => platformApi.setSampleDecision(target.id, decision), `已更新 ${target.filename} 为 ${decision}`);
    }
  }

  function handleRegisterDataset(path: string) {
    void runAction(() => platformApi.registerDataset(path), '数据集已上传并完成扫描');
  }

  function handleUploadZip(file: File) {
    if (apiMode !== 'live') {
      setUploadProgress(1);
      window.setTimeout(() => setUploadProgress(null), 1000);
      setNotice('模拟模式不会写入文件；启动后端后将上传到 storage/datasets。');
      return;
    }
    setUploadProgress(0);
    platformApi
      .uploadDatasetZipWithProgress(file, setUploadProgress)
      .then((state) => {
        applyState(state);
        setNotice('ZIP 已上传到 storage/datasets 并完成扫描');
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
      .finally(() => window.setTimeout(() => setUploadProgress(null), 1200));
  }

  function handleRenameDataset(datasetId: string) {
    const current = datasetVersions.find((dataset) => dataset.id === datasetId);
    const nextName = window.prompt('请输入新的数据集名称', current?.name ?? '');
    if (!nextName) return;
    if (apiMode !== 'live') {
      setDatasetVersions((versions) => versions.map((dataset) => (dataset.id === datasetId ? { ...dataset, name: nextName } : dataset)));
      return;
    }
    void runAction(() => platformApi.renameDataset(datasetId, nextName), '数据集已重命名');
  }

  function handleDeleteDataset(datasetId: string) {
    const current = datasetVersions.find((dataset) => dataset.id === datasetId);
    if (!window.confirm(`确认删除数据集 ${current?.name ?? datasetId}？`)) return;
    if (apiMode !== 'live') {
      setDatasetVersions((versions) => versions.filter((dataset) => dataset.id !== datasetId));
      setSamples((items) => items.filter((sample) => sample.datasetVersionId !== datasetId));
      return;
    }
    void runAction(() => platformApi.deleteDataset(datasetId), '数据集已删除');
  }

  function handleStartTraining(config: TrainingConfig) {
    if (apiMode !== 'live') {
      setNotice('模拟模式不能启动真实训练；请启动后端后运行 train.py。');
      return;
    }
    void runAction(() => platformApi.startTraining(trainingDataset.id, config), '训练任务已启动');
  }

  function handleStopTraining(runId?: string) {
    if (!runId) {
      void refreshState();
      setNotice('当前没有正在运行的训练任务');
      return;
    }
    void runAction(() => platformApi.stopTraining(runId), '训练任务已停止');
  }

  function handleRunEvaluation(datasetId: string, modelId: string) {
    void runAction(() => platformApi.runEvaluation(datasetId, modelId), '评估任务已完成');
  }

  function handleRunInference(inputPath: string, modelId: string) {
    void runAction(() => platformApi.runInference(inputPath, modelId), '推理任务已完成');
  }

  function handleRenameModel(modelId: string) {
    const current = models.find((model) => model.id === modelId);
    const nextName = window.prompt('请输入新的模型名称', current?.name ?? '');
    if (!nextName) return;
    if (apiMode !== 'live') {
      setModels((items) => items.map((model) => (model.id === modelId ? { ...model, name: nextName } : model)));
      return;
    }
    void runAction(() => platformApi.renameModel(modelId, nextName), '模型已重命名');
  }

  function handleDeleteModel(modelId: string) {
    const current = models.find((model) => model.id === modelId);
    if (!window.confirm(`确认删除模型 ${current?.name ?? modelId}？`)) return;
    if (apiMode !== 'live') {
      setModels((items) => items.filter((model) => model.id !== modelId));
      return;
    }
    void runAction(() => platformApi.deleteModel(modelId), '模型已删除');
  }

  function handleRenameInferenceJob(jobId: string) {
    const current = inferenceJobs.find((job) => job.id === jobId);
    const nextName = window.prompt('请输入新的推理任务名称', current?.name ?? '');
    if (!nextName) return;
    if (apiMode !== 'live') {
      setInferenceJobs((jobs) => jobs.map((job) => (job.id === jobId ? { ...job, name: nextName } : job)));
      return;
    }
    void runAction(() => platformApi.renameInferenceJob(jobId, nextName), '推理任务已重命名');
  }

  function handleDeleteInferenceJob(jobId: string) {
    if (!window.confirm('确认删除该推理任务？')) return;
    if (apiMode !== 'live') {
      setInferenceJobs((jobs) => jobs.filter((job) => job.id !== jobId));
      return;
    }
    void runAction(() => platformApi.deleteInferenceJob(jobId), '推理任务已删除');
  }

  async function handleExportModel(modelId: string) {
    try {
      const result = await platformApi.exportModel(modelId);
      applyState(result.state);
      const model = result.state.models.find((item) => item.id === modelId) ?? models.find((item) => item.id === modelId);
      const record: ExportRecord = {
        id: `export-${Date.now()}`,
        modelVersionId: modelId,
        modelName: model?.name ?? modelId,
        exportedAt: new Date().toLocaleString(),
        exportDir: result.exportDir,
        format: 'PT + ONNX'
      };
      setExportRecords((records) => [record, ...records]);
      setNotice(`模型导出完成 - ${result.exportDir}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function renderPage() {
    switch (activePage) {
      case 'datasets':
        return (
          <DatasetsPage
            selectedDataset={selectedDataset}
            datasetVersions={datasetVersions}
            samples={selectedDatasetSamples}
            loadingSamples={loadingDatasetId === selectedDataset.id}
            uploadProgress={uploadProgress}
            onSelectDataset={handleSelectDataset}
            onRenameDataset={handleRenameDataset}
            onDeleteDataset={handleDeleteDataset}
            onRegisterDataset={handleRegisterDataset}
            onUploadZip={handleUploadZip}
          />
        );
      case 'labeling':
        return (
          <LabelingPage
            datasetVersions={datasetVersions}
            selectedDatasetId={labelingDataset.id}
            samples={filteredLabelingSamples}
            selectedSample={selectedLabelingSample}
            sampleFilter={sampleFilter}
            loading={loadingDatasetId === labelingDataset.id}
            onDatasetChange={handleSelectLabelingDataset}
            onFilterChange={setSampleFilter}
            onSelectSample={setLabelingSampleId}
            onDecision={handleDecision}
          />
        );
      case 'training':
        return (
          <TrainingPage
            datasetVersions={datasetVersions}
            selectedDatasetId={trainingDataset.id}
            runs={trainingRuns}
            runningRun={runningRun}
            trainingRunning={trainingRunning}
            onDatasetChange={setTrainingDatasetId}
            onStartTraining={handleStartTraining}
            onStopTraining={handleStopTraining}
            onRefresh={refreshState}
          />
        );
      case 'evaluation':
        return (
          <EvaluationPage
            datasetVersions={datasetVersions}
            models={models}
            evaluations={evaluations}
            samples={samples}
            threshold={threshold}
            onThresholdChange={setThreshold}
            onRunEvaluation={handleRunEvaluation}
            onDecision={handleDecision}
          />
        );
      case 'inference':
        return (
          <InferencePage
            selectedSample={selectedSample}
            models={models}
            jobs={inferenceJobs}
            samples={samples}
            onRunInference={handleRunInference}
            onRenameJob={handleRenameInferenceJob}
            onDeleteJob={handleDeleteInferenceJob}
          />
        );
      case 'models':
        return <ModelsPage models={models} datasetVersions={datasetVersions} onRenameModel={handleRenameModel} onDeleteModel={handleDeleteModel} />;
      case 'export':
        return <ExportPage models={models} exportRecords={exportRecords} onExportModel={handleExportModel} />;
      case 'settings':
        return <SettingsPage systemMetrics={systemMetrics} storageDir="wafer_platform/storage" onSave={(message) => setNotice(message)} />;
      default:
        return <OverviewPage dataset={selectedDataset} samples={selectedDatasetSamples} runs={trainingRuns} models={models} risks={risks} />;
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-white">
        <div className="border-b border-line p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <BarChart3 size={22} />
            </div>
            <div>
              <div className="text-base font-bold">WaferTinyCNN</div>
              <div className="text-xs text-slate-500">产线模型工作台</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = navIconMap[item.id];
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-line p-4 text-xs text-slate-500">
          <div className="flex items-center gap-2"><UserRound size={14} />本地操作员</div>
          <div className="mt-2">{apiMode === 'live' ? '后端在线' : apiMode === 'mock' ? '模拟模式' : '连接中'}</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between border-b border-line bg-white px-6">
          <div>
            <div className="text-sm font-semibold text-slate-900">{navItems.find((item) => item.id === activePage)?.label ?? '总览'}</div>
            <div className="mt-1 text-xs text-slate-500">数据集 {selectedDataset?.version ?? '-'} / 最新模型 {currentModel?.version ?? '-'}</div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <TopStatus label="任务" value={runningRun ? `训练中 ${Math.round(runningRun.progress * 100)}%` : '空闲'} />
            <TopStatus label="CPU" value={`${systemMetrics.cpuPercent.toFixed(1)}%`} />
            <TopStatus label="内存" value={`${systemMetrics.memoryPercent.toFixed(1)}%`} />
          </div>
        </header>
        <div className="px-6 py-4">
          <div className="mb-3 rounded-md border border-line bg-white px-3 py-2 text-xs text-slate-600">{notice}</div>
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

function TopStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function OverviewPage({ dataset, samples, runs, models, risks }: { dataset: DatasetVersion; samples: SampleItem[]; runs: TrainingRun[]; models: ModelVersion[]; risks: ReturnType<typeof getRiskQueue> }) {
  const runningRun = runs.find((run) => run.status === 'running');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Metric title="样本数" value={formatCount(samples.length)} detail={`${dataset.name} ${dataset.version}`} />
        <Metric title="NG 占比" value={formatPercent(dataset.ngCount / Math.max(1, dataset.okCount + dataset.ngCount))} detail={`${dataset.ngCount} NG`} />
        <Metric title="最新模型" value={models[0]?.version ?? '-'} detail={models[0]?.name ?? '暂无模型'} />
        <Metric title="训练状态" value={runningRun ? `${runningRun.currentEpoch}/${runningRun.epochs}` : '空闲'} detail={runningRun?.id ?? '暂无运行任务'} />
      </div>
      <div className="grid grid-cols-[1fr_360px] gap-4">
        <div className="panel p-4">
          <h2 className="section-title">样本分布</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer>
              <BarChart data={[
                { name: 'OK', value: dataset.okCount, color: '#0f9f6e' },
                { name: 'NG', value: dataset.ngCount, color: '#dc2626' },
                { name: 'OK_HARD', value: dataset.hardOkCount, color: '#b7791f' },
                { name: '未标注', value: dataset.unlabeledCount, color: '#2563eb' }
              ]}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {[0, 1, 2, 3].map((index) => <Cell key={index} fill={['#0f9f6e', '#dc2626', '#b7791f', '#2563eb'][index]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="section-title">风险队列</h2>
          <div className="mt-3 space-y-2">
            {risks.slice(0, 6).map((risk) => (
              <div key={risk.id} className="rounded-md border border-line bg-slate-50 p-3 text-sm">
                <div className="font-semibold">{risk.title}</div>
                <div className="mt-1 text-xs text-slate-500">{risk.detail}</div>
              </div>
            ))}
            {!risks.length && <EmptyState text="暂无风险项" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DatasetsPage({
  selectedDataset,
  datasetVersions,
  samples,
  loadingSamples,
  uploadProgress,
  onSelectDataset,
  onRenameDataset,
  onDeleteDataset,
  onRegisterDataset,
  onUploadZip
}: {
  selectedDataset: DatasetVersion;
  datasetVersions: DatasetVersion[];
  samples: SampleItem[];
  loadingSamples: boolean;
  uploadProgress: number | null;
  onSelectDataset: (id: string) => void;
  onRenameDataset: (id: string) => void;
  onDeleteDataset: (id: string) => void;
  onRegisterDataset: (path: string) => void;
  onUploadZip: (file: File) => void;
}) {
  const [path, setPath] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(60);
  const visibleSamples = getVisibleSamples(samples, visibleLimit);
  useEffect(() => setVisibleLimit(60), [selectedDataset.id, samples.length]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUploadZip(file);
    event.target.value = '';
  }

  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[360px_1fr] gap-4">
      <div className="panel flex min-h-0 flex-col">
        <div className="border-b border-line p-4">
          <h2 className="section-title">数据集管理</h2>
          <div className="mt-3 space-y-2">
            <ConfigText label="上传目录" value={path} onChange={setPath} />
            <button onClick={() => path && onRegisterDataset(path)} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              <FolderUp size={16} />上传目录
            </button>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Upload size={16} />上传 ZIP
              <input type="file" accept=".zip" className="hidden" onChange={handleFile} />
            </label>
            {uploadProgress !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>上传进度</span><span>{Math.round(uploadProgress * 100)}%</span></div>
                <ProgressBar value={uploadProgress} />
              </div>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 thin-scrollbar">
          {datasetVersions.map((dataset) => (
            <button key={dataset.id} onClick={() => onSelectDataset(dataset.id)} className={`mb-2 w-full rounded-md border p-3 text-left hover:bg-blue-50 ${dataset.id === selectedDataset.id ? 'border-blue-300 bg-blue-50' : 'border-line bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{dataset.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{dataset.version} / {dataset.createdAt}</div>
                </div>
                <span className={`chip ${statusClass[dataset.status]}`}>{dataset.status === 'ready' ? '就绪' : dataset.status === 'validating' ? '校验中' : '警告'}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <SmallButton icon={Pencil} label="重命名" onClick={(event) => { event.stopPropagation(); onRenameDataset(dataset.id); }} />
                <SmallButton icon={Trash2} label="删除" tone="red" onClick={(event) => { event.stopPropagation(); onDeleteDataset(dataset.id); }} />
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="panel flex min-h-0 flex-col">
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="section-title">样本预览</h2>
              <p className="mt-1 text-xs text-slate-500">{selectedDataset.name} / {samples.length} 张</p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <CountPill label="OK" value={selectedDataset.okCount} />
              <CountPill label="NG" value={selectedDataset.ngCount} />
              <CountPill label="OK_HARD" value={selectedDataset.hardOkCount} />
              <CountPill label="未标注" value={selectedDataset.unlabeledCount} />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 thin-scrollbar">
          {loadingSamples ? <EmptyState text="正在加载样本..." /> : samples.length === 0 ? <EmptyState text="当前版本暂无样本" /> : (
            <>
              <div className="grid grid-cols-4 gap-3 2xl:grid-cols-5">
                {visibleSamples.map((sample) => (
                  <div key={sample.id} className="rounded-md border border-line p-2">
                    <WaferThumb sample={sample} />
                    <div className="mt-2 truncate text-xs font-medium text-slate-700">{sample.filename}</div>
                    <span className={`chip mt-2 ${decisionClass[sample.decision]}`}>{decisionLabel[sample.decision]}</span>
                  </div>
                ))}
              </div>
              {visibleSamples.length < samples.length && <LoadMore onClick={() => setVisibleLimit((value) => value + 60)} current={visibleSamples.length} total={samples.length} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LabelingPage({
  datasetVersions,
  selectedDatasetId,
  samples,
  selectedSample,
  sampleFilter,
  loading,
  onDatasetChange,
  onFilterChange,
  onSelectSample,
  onDecision
}: {
  datasetVersions: DatasetVersion[];
  selectedDatasetId: string;
  samples: SampleItem[];
  selectedSample?: SampleItem;
  sampleFilter: SampleReviewFilter;
  loading: boolean;
  onDatasetChange: (id: string) => void;
  onFilterChange: (filter: SampleReviewFilter) => void;
  onSelectSample: (id: string) => void;
  onDecision: (decision: SampleDecision, sampleId?: string) => void;
}) {
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => setVisibleLimit(120), [selectedDatasetId, sampleFilter, samples.length]);
  const visibleSamples = getVisibleSamples(samples, visibleLimit);
  const selectedIndex = samples.findIndex((sample) => sample.id === selectedSample?.id);
  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < samples.length - 1;
  const reviewFilters: Array<{ id: SampleReviewFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'risk', label: '风险' },
    { id: 'unlabeled', label: '未标注' },
    { id: 'OK', label: 'OK' },
    { id: 'NG', label: 'NG' },
    { id: 'OK_HARD', label: 'OK_HARD' },
    { id: 'IGNORE', label: '忽略' }
  ];

  const goPrev = () => canPrev && onSelectSample(samples[selectedIndex - 1].id);
  const goNext = () => canNext && onSelectSample(samples[selectedIndex + 1].id);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') goPrev();
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') goNext();
      if (event.key === '1') onDecision('OK');
      if (event.key === '2') onDecision('NG');
      if (event.key === '3') onDecision('OK_HARD');
      if (event.key === '4') onDecision('IGNORE');
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canPrev, canNext, selectedIndex, selectedSample?.id, samples]);

  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[340px_1fr_300px] gap-4">
      <div className="panel flex min-h-0 flex-col">
        <div className="border-b border-line p-3">
          <ConfigSelect label="审核数据集" value={selectedDatasetId} options={datasetVersions.map((dataset) => dataset.id)} labels={Object.fromEntries(datasetVersions.map((dataset) => [dataset.id, `${dataset.name} ${dataset.version}`]))} onChange={onDatasetChange} />
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1 text-xs">
            {reviewFilters.map((filter) => (
              <button key={filter.id} onClick={() => onFilterChange(filter.id)} className={`rounded px-2 py-1.5 font-medium ${sampleFilter === filter.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 thin-scrollbar">
          {loading ? <EmptyState text="正在加载样本..." /> : visibleSamples.map((sample) => (
            <button key={sample.id} onClick={() => onSelectSample(sample.id)} className={`mb-2 flex w-full gap-3 rounded-md border p-2 text-left hover:bg-blue-50 ${sample.id === selectedSample?.id ? 'border-blue-300 bg-blue-50' : 'border-line bg-white'}`}>
              <div className="h-12 w-16 overflow-hidden rounded border border-line"><WaferThumb sample={sample} compact /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{sample.filename}</div>
                <div className="mt-1 text-xs text-slate-500">{sample.sourceLot}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`chip ${decisionClass[sample.decision]}`}>{decisionLabel[sample.decision]}</span>
                  <span className="text-xs font-semibold text-red-600">{Math.round(sample.probabilityNg * 100)}%</span>
                </div>
              </div>
            </button>
          ))}
          {visibleSamples.length < samples.length && <LoadMore onClick={() => setVisibleLimit((value) => value + 120)} current={visibleSamples.length} total={samples.length} />}
        </div>
      </div>
      <SampleReviewCanvas selectedSample={selectedSample} onFullscreen={() => setFullscreen(true)} />
      <div className="panel p-4">
        <h2 className="section-title">标注操作</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={goPrev} disabled={!canPrev} className="icon-button"><ChevronLeft size={16} />上一张</button>
          <button onClick={goNext} disabled={!canNext} className="icon-button"><ChevronRight size={16} />下一张</button>
        </div>
        <div className="mt-4 grid gap-2">
          <DecisionButton label="标为 OK (1)" tone="green" onClick={() => onDecision('OK')} />
          <DecisionButton label="标为 NG (2)" tone="red" onClick={() => onDecision('NG')} />
          <DecisionButton label="确认 OK_HARD (3)" tone="amber" onClick={() => onDecision('OK_HARD')} />
          <DecisionButton label="忽略样本 (4)" tone="slate" onClick={() => onDecision('IGNORE')} />
        </div>
        <div className="mt-5 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          快捷键：A/← 上一张，D/→ 下一张，1/2/3/4 修改标签。标注只更新记录，不移动图片路径。
        </div>
      </div>
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-5 text-white">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{selectedSample?.filename ?? '未选择样本'}</div>
              <div className="text-xs text-slate-400">全屏标注 / Esc 退出</div>
            </div>
            <button onClick={() => setFullscreen(false)} className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900">退出全屏</button>
          </div>
          <div className="min-h-0 flex-1 rounded-md border border-slate-800 p-3">
            {selectedSample && <WaferImage sample={selectedSample} kind="triptych" />}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 thin-scrollbar">
            {visibleSamples.map((sample) => (
              <button key={sample.id} onClick={() => onSelectSample(sample.id)} className={`h-16 w-28 shrink-0 overflow-hidden rounded border ${sample.id === selectedSample?.id ? 'border-blue-400' : 'border-slate-700'}`}>
                <WaferThumb sample={sample} compact />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SampleReviewCanvas({ selectedSample, onFullscreen }: { selectedSample?: SampleItem; onFullscreen: () => void }) {
  return (
    <div className="panel min-h-0 p-4">
      {selectedSample ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-title">{selectedSample.filename}</h2>
              <p className="text-xs text-slate-500">{selectedSample.sourceLot} / NG {formatPercent(selectedSample.probabilityNg)}</p>
            </div>
            <button onClick={onFullscreen} className="icon-button"><Maximize2 size={16} />全屏</button>
          </div>
          <div className="h-[calc(100%-4rem)] rounded-lg border border-line bg-slate-950 p-3">
            <WaferImage sample={selectedSample} kind="triptych" />
          </div>
        </>
      ) : <EmptyState text="未选择样本" />}
    </div>
  );
}

function TrainingPage({
  datasetVersions,
  selectedDatasetId,
  runs,
  runningRun,
  trainingRunning,
  onDatasetChange,
  onStartTraining,
  onStopTraining,
  onRefresh
}: {
  datasetVersions: DatasetVersion[];
  selectedDatasetId: string;
  runs: TrainingRun[];
  runningRun?: TrainingRun;
  trainingRunning: boolean;
  onDatasetChange: (id: string) => void;
  onStartTraining: (config: TrainingConfig) => void;
  onStopTraining: (runId?: string) => void;
  onRefresh: () => void;
}) {
  const [config, setConfig] = useState<TrainingConfig>(defaultTrainingConfig);
  const [expertOpen, setExpertOpen] = useState(false);
  const actions = getTrainingActions(runs);
  const logs = runningRun?.logs.length ? runningRun.logs : (runs[0]?.logs ?? []);
  const setConfigValue = <K extends keyof TrainingConfig>(key: K, value: TrainingConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[390px_1fr] gap-4">
      <div className="panel flex min-h-0 flex-col p-4">
        <h2 className="section-title">训练配置</h2>
        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 thin-scrollbar">
          <ConfigSelect label="训练数据集" value={selectedDatasetId} options={datasetVersions.map((dataset) => dataset.id)} labels={Object.fromEntries(datasetVersions.map((dataset) => [dataset.id, `${dataset.name} ${dataset.version}`]))} onChange={onDatasetChange} />
          <Field label="CPU 推荐配置" value="raw3 + robust + tinycnn + fp-under-fn-cap" />
          <div className="grid grid-cols-2 gap-3">
            <ConfigNumber label="轮次" value={config.epochs} onChange={(value) => setConfigValue('epochs', value)} />
            <ConfigNumber label="批大小" value={config.batchSize} onChange={(value) => setConfigValue('batchSize', value)} />
            <ConfigNumber label="学习率" value={config.lr} step={0.0001} onChange={(value) => setConfigValue('lr', value)} />
            <ConfigNumber label="输入尺寸" value={config.inputSize} onChange={(value) => setConfigValue('inputSize', value)} />
            <ConfigSelect label="网络结构" value={config.arch} options={['tinycnn', 'tinycnn_diffv2']} onChange={(value) => setConfigValue('arch', value as TrainingConfig['arch'])} />
            <ConfigSelect label="输入模式" value={config.inputMode} options={['raw3', 'd2d6', 'meanabs3']} onChange={(value) => setConfigValue('inputMode', value as TrainingConfig['inputMode'])} />
            <ConfigSelect label="强度归一化" value={config.intensityNorm} options={['raw', 'robust']} onChange={(value) => setConfigValue('intensityNorm', value as TrainingConfig['intensityNorm'])} />
            <ConfigNumber label="验证比例" value={config.valRatio} step={0.01} onChange={(value) => setConfigValue('valRatio', value)} />
          </div>
          <button onClick={() => setExpertOpen((value) => !value)} className="flex w-full items-center justify-center gap-2 rounded-md border border-line py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <SlidersHorizontal size={16} />{expertOpen ? '收起专家参数' : '展开专家参数'}
          </button>
          {expertOpen && (
            <div className="rounded-md border border-line bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-3">
                <ConfigNumber label="预热轮次" value={config.warmupEpochs} onChange={(value) => setConfigValue('warmupEpochs', value)} />
                <ConfigSelect label="归一层" value={config.norm} options={['group', 'batch', 'none']} onChange={(value) => setConfigValue('norm', value as TrainingConfig['norm'])} />
                <ConfigSelect label="池化方式" value={config.pooling} options={['avg', 'avgmax']} onChange={(value) => setConfigValue('pooling', value as TrainingConfig['pooling'])} />
                <ConfigSelect label="均衡采样" value={String(config.balancedSampler)} options={['0', '1']} onChange={(value) => setConfigValue('balancedSampler', Number(value) as 0 | 1)} />
                <ConfigNumber label="NG 增强重复" value={config.ngHardAugRepeat} onChange={(value) => setConfigValue('ngHardAugRepeat', value)} />
                <ConfigNumber label="Guard NG 重复" value={config.guardNgTrainRepeat} onChange={(value) => setConfigValue('guardNgTrainRepeat', value)} />
                <ConfigSelect label="选择策略" value={config.selectionMode} options={['fn-first', 'fp-under-fn-cap']} onChange={(value) => setConfigValue('selectionMode', value as TrainingConfig['selectionMode'])} />
                <ConfigNumber label="验证 FN 上限" value={config.maxValFn} onChange={(value) => setConfigValue('maxValFn', value)} />
                <ConfigNumber label="Guard FN 上限" value={config.maxGuardFn} onChange={(value) => setConfigValue('maxGuardFn', value)} />
                <ConfigText label="正样本权重" value={config.posWeight} onChange={(value) => setConfigValue('posWeight', value)} />
                <ConfigSelect label="损失函数" value={config.loss} options={['bce', 'focal', 'bce_ng_margin']} onChange={(value) => setConfigValue('loss', value as TrainingConfig['loss'])} />
                <ConfigNumber label="最小阈值" value={config.minThreshold} step={0.01} onChange={(value) => setConfigValue('minThreshold', value)} />
                <ConfigNumber label="阈值余量" value={config.thresholdMargin} step={0.01} onChange={(value) => setConfigValue('thresholdMargin', value)} />
                <ConfigNumber label="最大阈值" value={config.maxThreshold} step={0.01} onChange={(value) => setConfigValue('maxThreshold', value)} />
                <ConfigNumber label="随机种子" value={config.seed} onChange={(value) => setConfigValue('seed', value)} />
                <ConfigText label="训练设备" value={config.device} onChange={(value) => setConfigValue('device', value)} />
                <ConfigNumber label="加载线程" value={config.numWorkers} onChange={(value) => setConfigValue('numWorkers', value)} />
                <ConfigSelect label="混合精度" value={String(config.amp)} options={['0', '1']} onChange={(value) => setConfigValue('amp', Number(value) as 0 | 1)} />
                <ConfigSelect label="通道后置" value={String(config.channelsLast)} options={['0', '1']} onChange={(value) => setConfigValue('channelsLast', Number(value) as 0 | 1)} />
                <ConfigNumber label="预取批次" value={config.prefetchFactor} onChange={(value) => setConfigValue('prefetchFactor', value)} />
                <ConfigNumber label="评估间隔" value={config.evalEvery} onChange={(value) => setConfigValue('evalEvery', value)} />
                <ConfigNumber label="Guard 评估间隔" value={config.guardEvalEvery} onChange={(value) => setConfigValue('guardEvalEvery', value)} />
                <ConfigSelect label="cuDNN 加速" value={String(config.cudnnBenchmark)} options={['0', '1']} onChange={(value) => setConfigValue('cudnnBenchmark', Number(value) as 0 | 1)} />
                <ConfigSelect label="早停" value={String(config.earlyStop)} options={['0', '1']} onChange={(value) => setConfigValue('earlyStop', Number(value) as 0 | 1)} />
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {runningRun && (
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>训练进度</span>
                <span>{Math.round(runningRun.progress * 100)}%</span>
              </div>
              <ProgressBar value={runningRun.progress} />
            </div>
          )}
          <button
            onClick={() => actions.start.enabled && onStartTraining(config)}
            disabled={!actions.start.enabled}
            className={`flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white ${actions.start.enabled ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'}`}
          >
            <Play size={16} />{actions.start.label}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onRefresh} className="icon-button"><LineChart size={15} />刷新</button>
            <button onClick={() => onStopTraining(actions.stop.runId)} disabled={!actions.stop.enabled} className={`flex items-center justify-center gap-2 rounded-md border py-2 text-sm font-semibold ${actions.stop.enabled ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
              <Square size={15} />{actions.stop.label}
            </button>
          </div>
        </div>
      </div>
      <div className="grid min-h-0 grid-rows-[1fr_220px] gap-4">
        <div className="panel min-h-0 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-title">训练指标</h2>
              <p className="text-xs text-slate-500">每完成一次评估追加一个 epoch 点，曲线图例可点击隐藏。</p>
            </div>
            <span className={`chip ${trainingRunning ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{trainingRunning ? '运行中' : '空闲'}</span>
          </div>
          {runningRun && <ProgressBar value={runningRun.progress} />}
          <div className="mt-4 h-[calc(100%-4.5rem)]"><TrainingChart run={runningRun} /></div>
        </div>
        <div className="panel min-h-0 p-4">
          <h2 className="section-title">训练日志</h2>
          <div className="mt-3 h-[calc(100%-2rem)] overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-200 thin-scrollbar">
            {logs.length ? logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>) : <div className="text-slate-500">暂无日志</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrainingChart({ run }: { run?: TrainingRun }) {
  const chartData = run?.metrics ?? [];
  if (chartData.length === 0) {
    return <EmptyState text="暂无训练指标。启动训练后，每个 epoch 评估结果会实时追加到这里。" />;
  }
  return (
    <ResponsiveContainer>
      <ReLineChart data={chartData}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="epoch" tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
        <Tooltip />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="loss" stroke="#2563eb" strokeWidth={2} name="Loss 损失" />
        <Line yAxisId="left" type="monotone" dataKey="recallNg" stroke="#0f9f6e" strokeWidth={2} name="NG 召回" />
        <Line yAxisId="right" type="monotone" dataKey="falseNegative" stroke="#dc2626" strokeWidth={2} name="FN 漏检" />
        <Line yAxisId="right" type="monotone" dataKey="falsePositive" stroke="#b7791f" strokeWidth={2} name="FP 误报" />
      </ReLineChart>
    </ResponsiveContainer>
  );
}

function EvaluationPage({
  datasetVersions,
  models,
  evaluations,
  samples,
  threshold,
  onThresholdChange,
  onRunEvaluation,
  onDecision
}: {
  datasetVersions: DatasetVersion[];
  models: ModelVersion[];
  evaluations: EvaluationReport[];
  samples: SampleItem[];
  threshold: number;
  onThresholdChange: (value: number) => void;
  onRunEvaluation: (datasetId: string, modelId: string) => void;
  onDecision: (decision: SampleDecision, sampleId?: string) => void;
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [resultFilter, setResultFilter] = useState<'all' | 'fn' | 'fp'>('all');
  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) setModelId(models[0]?.id ?? '');
  }, [modelId, models]);
  const model = models.find((item) => item.id === modelId) ?? models[0];
  const dataset = datasetVersions.find((item) => item.id === model?.datasetVersionId) ?? datasetVersions[0];
  const evaluation = evaluations.find((item) => item.modelVersionId === modelId) ?? modelToEvaluation(model);
  const mismatchSamples = buildMismatchSamples(samples.filter((sample) => sample.datasetVersionId === dataset?.id), threshold).filter((item) => resultFilter === 'all' || item.kind === resultFilter);

  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[360px_1fr] gap-4">
      <div className="panel flex min-h-0 flex-col p-4">
        <h2 className="section-title">评估与调试</h2>
        <div className="mt-4 space-y-3">
          <ConfigSelect label="模型" value={modelId} options={models.map((item) => item.id)} labels={Object.fromEntries(models.map((item) => [item.id, `${item.name} ${item.version}`]))} onChange={setModelId} />
          <Field label="训练数据集" value={dataset ? `${dataset.name} ${dataset.version}` : '-'} />
          <Field label="训练参数" value={summarizeConfig(model?.trainingConfig)} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">阈值 {threshold.toFixed(2)}</span>
            <input type="range" min="0.01" max="0.99" step="0.01" value={threshold} onChange={(event) => onThresholdChange(Number(event.target.value))} className="w-full" />
          </label>
          <button onClick={() => model && dataset && onRunEvaluation(dataset.id, model.id)} disabled={!model || !dataset} className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">开始评估</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric title="NG 召回" value={formatPercent(evaluation.recallNg)} detail="当前模型" />
          <Metric title="准确率" value={formatPercent(evaluation.accuracy)} detail="当前模型" />
          <Metric title="FN" value={String(evaluation.falseNegative)} detail="漏检 NG" />
          <Metric title="FP" value={String(evaluation.falsePositive)} detail="误报 OK" />
        </div>
      </div>
      <div className="panel flex min-h-0 flex-col">
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">预测与真实不一致样本</h2>
            <div className="flex gap-2 text-xs">
              {(['all', 'fn', 'fp'] as const).map((filter) => <button key={filter} onClick={() => setResultFilter(filter)} className={`rounded border px-2 py-1 ${resultFilter === filter ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-line'}`}>{filter === 'all' ? '全部' : filter.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
            <MatrixCell label="检出 NG" value={evaluation.confusion.trueNg} tone="green" />
            <MatrixCell label="漏检 NG" value={evaluation.confusion.missedNg} tone="red" />
            <MatrixCell label="误报 OK" value={evaluation.confusion.falseAlarmOk} tone="amber" />
            <MatrixCell label="正确 OK" value={evaluation.confusion.trueOk} tone="green" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 thin-scrollbar">
          <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
            {mismatchSamples.map(({ sample, predicted, kind }) => (
              <div key={sample.id} className="rounded-md border border-line p-3">
                <WaferThumb sample={sample} />
                <div className="mt-2 truncate text-sm font-semibold">{sample.filename}</div>
                <div className="mt-1 text-xs text-slate-500">真实 {decisionLabel[sample.decision]} / 预测 {predicted} / {kind.toUpperCase()}</div>
                <div className="mt-3 grid grid-cols-4 gap-1">
                  {(['OK', 'NG', 'OK_HARD', 'IGNORE'] as SampleDecision[]).map((decision) => (
                    <button key={decision} onClick={() => onDecision(decision, sample.id)} className={`rounded border px-2 py-1 text-xs ${decisionClass[decision]}`}>{decisionLabel[decision]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!mismatchSamples.length && <EmptyState text="当前筛选下暂无不一致样本" />}
        </div>
      </div>
    </div>
  );
}

function InferencePage({
  selectedSample,
  models,
  jobs,
  samples,
  onRunInference,
  onRenameJob,
  onDeleteJob
}: {
  selectedSample?: SampleItem;
  models: ModelVersion[];
  jobs: InferenceJob[];
  samples: SampleItem[];
  onRunInference: (inputPath: string, modelId: string) => void;
  onRenameJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
}) {
  const [inputPath, setInputPath] = useState(selectedSample?.path ?? selectedSample?.filename ?? '');
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '');
  const [resultFilter, setResultFilter] = useState<'all' | 'NG' | 'OK'>('all');
  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) setModelId(models[0]?.id ?? '');
  }, [modelId, models]);
  useEffect(() => {
    if (!jobs.some((job) => job.id === jobId)) setJobId(jobs[0]?.id ?? '');
  }, [jobId, jobs]);
  useEffect(() => {
    if (!inputPath && selectedSample) setInputPath(selectedSample.path ?? selectedSample.filename);
  }, [inputPath, selectedSample]);
  const selectedJob = jobs.find((job) => job.id === jobId) ?? jobs[0];
  const results = buildInferenceResults(selectedJob, samples).filter((result) => resultFilter === 'all' || result.prediction === resultFilter);
  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[360px_1fr] gap-4">
      <div className="panel flex min-h-0 flex-col p-4">
        <h2 className="section-title">推理测试</h2>
        <div className="mt-4 space-y-3">
          <ConfigText label="图片或目录路径" value={inputPath} onChange={setInputPath} />
          <ConfigSelect label="模型" value={modelId} options={models.map((model) => model.id)} labels={Object.fromEntries(models.map((model) => [model.id, `${model.name} ${model.version}`]))} onChange={setModelId} />
          <button onClick={() => onRunInference(inputPath, modelId)} disabled={!inputPath || !modelId} className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">开始推理</button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto thin-scrollbar">
          {jobs.map((job) => (
            <button key={job.id} onClick={() => setJobId(job.id)} className={`mb-2 w-full rounded-md border p-3 text-left ${job.id === selectedJob?.id ? 'border-blue-300 bg-blue-50' : 'border-line bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{job.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{job.mode === 'single' ? '单张' : '批量'} / {job.createdAt}</div>
                </div>
                <span className="chip border-slate-200 bg-slate-50 text-slate-700">{job.status === 'completed' ? '完成' : job.status === 'running' ? '运行中' : '排队'}</span>
              </div>
              <div className="mt-2"><ProgressBar value={job.progress ?? (job.status === 'completed' ? 1 : 0.35)} /></div>
              <div className="mt-2 flex gap-2">
                <SmallButton icon={Pencil} label="重命名" onClick={(event) => { event.stopPropagation(); onRenameJob(job.id); }} />
                <SmallButton icon={Trash2} label="删除" tone="red" onClick={(event) => { event.stopPropagation(); onDeleteJob(job.id); }} />
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="panel flex min-h-0 flex-col">
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">推理结果</h2>
            <div className="flex gap-2 text-xs">
              {(['all', 'NG', 'OK'] as const).map((filter) => <button key={filter} onClick={() => setResultFilter(filter)} className={`rounded border px-2 py-1 ${resultFilter === filter ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-line'}`}>{filter === 'all' ? '全部' : filter}</button>)}
            </div>
          </div>
          {selectedJob && <div className="mt-2 text-xs text-slate-500">NG {selectedJob.ngCount} / OK {selectedJob.okCount} / 报告 {selectedJob.reportPath ?? '-'}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 thin-scrollbar">
          <div className="grid grid-cols-3 gap-3">
            {results.map((result) => {
              const sample = result.sampleId ? samples.find((item) => item.id === result.sampleId) : undefined;
              return (
                <div key={result.id} className="rounded-md border border-line p-2">
                  <WaferThumb sample={sample} />
                  <div className="mt-2 truncate text-xs font-semibold">{result.filename}</div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={result.prediction === 'NG' ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>{result.prediction}</span>
                    <span>NG {formatPercent(result.probabilityNg)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {!results.length && <EmptyState text="暂无推理结果" />}
        </div>
      </div>
    </div>
  );
}

function ModelsPage({ models, datasetVersions, onRenameModel, onDeleteModel }: { models: ModelVersion[]; datasetVersions: DatasetVersion[]; onRenameModel: (id: string) => void; onDeleteModel: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? '');
  useEffect(() => {
    if (!models.some((model) => model.id === selectedId)) setSelectedId(models[0]?.id ?? '');
  }, [models, selectedId]);
  const selected = models.find((model) => model.id === selectedId) ?? models[0];
  const dataset = datasetVersions.find((item) => item.id === selected?.datasetVersionId);
  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[1fr_360px] gap-4">
      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h2 className="section-title">模型仓库</h2></div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">模型</th><th className="px-4 py-3">训练数据集</th><th className="px-4 py-3">核心参数</th><th className="px-4 py-3">指标</th><th className="px-4 py-3">操作</th></tr></thead>
          <tbody>
            {models.map((model) => {
              const itemDataset = datasetVersions.find((item) => item.id === model.datasetVersionId);
              return (
                <tr key={model.id} onClick={() => setSelectedId(model.id)} className={`cursor-pointer border-t border-slate-100 ${model.id === selected?.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-3"><div className="font-semibold">{model.name}</div><div className="text-xs text-slate-500">{model.version} / {model.createdAt}</div></td>
                  <td className="px-4 py-3">{itemDataset ? `${itemDataset.name} ${itemDataset.version}` : model.datasetVersionId}</td>
                  <td className="px-4 py-3">{summarizeConfig(model.trainingConfig)}</td>
                  <td className="px-4 py-3">召回 {formatPercent(model.recallNg)} / FN {model.falseNegative} / FP {model.falsePositive}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <SmallButton icon={Pencil} label="改名" onClick={(event) => { event.stopPropagation(); onRenameModel(model.id); }} />
                      <SmallButton icon={Trash2} label="删除" tone="red" onClick={(event) => { event.stopPropagation(); onDeleteModel(model.id); }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel p-4">
        <h2 className="section-title">模型详情</h2>
        {selected ? (
          <div className="mt-4 space-y-3 text-sm">
            <Field label="名称" value={selected.name} />
            <Field label="版本" value={selected.version} />
            <Field label="数据集" value={dataset ? `${dataset.name} ${dataset.version}` : selected.datasetVersionId} />
            <Field label="权重路径" value={selected.weightsPath ?? '-'} />
            <Field label="训练目录" value={selected.runDir ?? '-'} />
            <Field label="格式" value={selected.format} />
            <Field label="阈值" value={selected.threshold.toFixed(3)} />
            <Field label="训练参数" value={summarizeConfig(selected.trainingConfig)} />
          </div>
        ) : <EmptyState text="暂无模型" />}
      </div>
    </div>
  );
}

function ExportPage({ models, exportRecords, onExportModel }: { models: ModelVersion[]; exportRecords: ExportRecord[]; onExportModel: (id: string) => void }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) setModelId(models[0]?.id ?? '');
  }, [models, modelId]);
  const model = models.find((item) => item.id === modelId);
  return (
    <div className="grid h-[calc(100vh-8.7rem)] grid-cols-[360px_1fr] gap-4">
      <div className="panel p-4">
        <h2 className="section-title">模型导出</h2>
        <div className="mt-4 space-y-3 text-sm">
          <ConfigSelect label="选择模型" value={modelId} options={models.map((item) => item.id)} labels={Object.fromEntries(models.map((item) => [item.id, `${item.name} ${item.version}`]))} onChange={setModelId} />
          <Field label="格式" value="PT + ONNX 生产包" />
          <Field label="权重路径" value={model?.weightsPath ?? '-'} />
          <button onClick={() => modelId && onExportModel(modelId)} disabled={!modelId} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"><Download size={16} />导出</button>
        </div>
      </div>
      <div className="panel flex min-h-0 flex-col p-4">
        <h2 className="section-title">导出记录</h2>
        <pre className="mt-4 rounded-md bg-slate-950 p-4 text-xs text-slate-100">{`export/
  best.pt
  model.onnx
  model_card.json
  threshold.json
  README.txt`}</pre>
        <div className="mt-4 min-h-0 flex-1 overflow-auto thin-scrollbar">
          {exportRecords.map((record) => (
            <div key={record.id} className="mb-2 rounded-md border border-line p-3 text-sm">
              <div className="font-semibold">{record.modelName}</div>
              <div className="mt-1 text-xs text-slate-500">{record.exportedAt}</div>
              <div className="mt-2 rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">{record.exportDir}</div>
            </div>
          ))}
          {!exportRecords.length && <EmptyState text="暂无导出记录，选择模型后点击导出。" />}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ systemMetrics, storageDir, onSave }: { systemMetrics: SystemMetrics; storageDir: string; onSave: (message: string) => void }) {
  const [settings, setSettings] = useState({
    storageDir,
    apiPort: '5173',
    previewLimit: '120',
    refreshSeconds: '2',
    cpuWorkers: String(systemMetrics.cpuThreads ?? 4),
    autoRefresh: true
  });
  const setValue = (key: keyof typeof settings, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <div className="panel p-4">
        <h2 className="section-title">系统设置</h2>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <ConfigText label="数据存储目录" value={settings.storageDir} onChange={(value) => setValue('storageDir', value)} />
          <ConfigText label="前端端口" value={settings.apiPort} onChange={(value) => setValue('apiPort', value)} />
          <ConfigText label="预览加载上限" value={settings.previewLimit} onChange={(value) => setValue('previewLimit', value)} />
          <ConfigText label="刷新间隔秒" value={settings.refreshSeconds} onChange={(value) => setValue('refreshSeconds', value)} />
          <ConfigText label="CPU 加载线程" value={settings.cpuWorkers} onChange={(value) => setValue('cpuWorkers', value)} />
          <label className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium">
            <input type="checkbox" checked={settings.autoRefresh} onChange={(event) => setValue('autoRefresh', event.target.checked)} />
            自动刷新任务状态
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => onSave('设置已保存到当前前端会话；后续可接入后端配置文件。')} className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Save size={16} />保存设置</button>
          <button onClick={() => setSettings({ storageDir, apiPort: '5173', previewLimit: '120', refreshSeconds: '2', cpuWorkers: String(systemMetrics.cpuThreads ?? 4), autoRefresh: true })} className="icon-button"><RotateCcw size={16} />恢复默认</button>
        </div>
      </div>
      <div className="space-y-4">
        <Metric title="CPU" value={`${systemMetrics.cpuPercent.toFixed(1)}%`} detail={`${systemMetrics.cpuThreads ?? '-'} 线程`} />
        <Metric title="内存" value={`${systemMetrics.memoryPercent.toFixed(1)}%`} detail={`${systemMetrics.memoryUsedGb}/${systemMetrics.memoryTotalGb} GB`} />
        <Metric title="刷新时间" value={systemMetrics.updatedAt || '-'} detail="后端系统指标" />
      </div>
    </div>
  );
}

function DecisionButton({ label, tone, onClick }: { label: string; tone: 'green' | 'red' | 'amber' | 'slate'; onClick: () => void }) {
  const toneClass = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
  };
  return <button onClick={onClick} className={`rounded-md border px-3 py-2.5 text-sm font-semibold ${toneClass[tone]}`}>{label}</button>;
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function MatrixCell({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' }) {
  const toneClass = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200'
  };
  return <div className={`rounded-md border p-3 ${toneClass[tone]}`}><div className="text-xs font-medium">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span><div className="truncate rounded-md border border-line bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800" title={value}>{value}</div></label>;
}

function ConfigNumber({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input type="number" value={value} step={step} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-400" />
    </label>
  );
}

function ConfigText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-400" />
    </label>
  );
}

function ConfigSelect({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-400">
        {options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
      </select>
    </label>
  );
}

function SmallButton({ icon: Icon, label, tone = 'slate', onClick }: { icon: LucideIcon; label: string; tone?: 'slate' | 'red'; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold ${tone === 'red' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-line bg-white text-slate-700 hover:bg-slate-50'}`}>
      <Icon size={13} />{label}
    </button>
  );
}

function CountPill({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-line bg-slate-50 px-2 py-1 text-center"><div className="font-semibold">{value}</div><div className="text-slate-500">{label}</div></div>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, Math.round(value * 100)))}%` }} /></div>;
}

function LoadMore({ onClick, current, total }: { onClick: () => void; current: number; total: number }) {
  return <button onClick={onClick} className="mt-3 w-full rounded-md border border-line py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">加载更多 ({current}/{total})</button>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full min-h-32 items-center justify-center rounded-md border border-dashed border-line bg-slate-50 p-6 text-center text-sm text-slate-500">{text}</div>;
}

function WaferThumb({ sample, compact = false }: { sample?: SampleItem; compact?: boolean }) {
  if (!sample) return <div className="h-full w-full bg-slate-200" />;
  const height = compact ? 'h-full' : 'h-24';
  return (
    <div className={`${height} aspect-[3/1] w-full overflow-hidden rounded bg-slate-950`}>
      {sample.path ? (
        <img src={sampleImageUrl(sample.id, 'triptych')} alt={sample.filename} loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <div className="grid h-full w-full grid-cols-3 gap-px bg-slate-800 p-1">
          {[0, 1, 2].map((index) => <div key={index} className="rounded-sm bg-slate-600" />)}
        </div>
      )}
    </div>
  );
}

function WaferImage({ sample, kind }: { sample: SampleItem; kind: SampleImageKind }) {
  return sample.path ? (
    <img src={sampleImageUrl(sample.id, kind)} alt={sample.filename} loading="lazy" className="h-full w-full rounded object-contain" />
  ) : (
    <div className="flex h-full w-full items-center justify-center rounded bg-slate-800 text-sm text-slate-300">模拟晶圆图像</div>
  );
}

function summarizeConfig(config?: Partial<TrainingConfig>) {
  if (!config) return '参数未记录';
  const arch = config.arch ?? 'tinycnn';
  const mode = config.inputMode ?? (config as Record<string, unknown>).input_mode ?? 'raw3';
  const norm = config.intensityNorm ?? (config as Record<string, unknown>).intensity_norm ?? 'robust';
  const lr = config.lr ?? '-';
  const batch = config.batchSize ?? (config as Record<string, unknown>).batch_size ?? '-';
  return `${arch} / ${mode} / ${norm} / lr ${lr} / batch ${batch}`;
}

function modelToEvaluation(model?: ModelVersion): EvaluationReport {
  return {
    id: model ? `eval-${model.id}` : 'eval-empty',
    modelVersionId: model?.id ?? '',
    datasetVersionId: model?.datasetVersionId ?? '',
    recallNg: model?.recallNg ?? 0,
    accuracy: model ? Math.max(0, Math.min(0.999, model.recallNg - model.falsePositive / 20000)) : 0,
    falseNegative: model?.falseNegative ?? 0,
    falsePositive: model?.falsePositive ?? 0,
    threshold: model?.threshold ?? 0.5,
    confusion: {
      trueNg: Math.max(0, 426 - (model?.falseNegative ?? 0)),
      missedNg: model?.falseNegative ?? 0,
      falseAlarmOk: model?.falsePositive ?? 0,
      trueOk: Math.max(0, 14800 - (model?.falsePositive ?? 0))
    }
  };
}

function buildMismatchSamples(samples: SampleItem[], threshold: number): Array<{ sample: SampleItem; predicted: 'OK' | 'NG'; kind: 'fn' | 'fp' }> {
  return samples
    .map((sample) => ({ sample, predicted: sample.probabilityNg >= threshold ? 'NG' as const : 'OK' as const }))
    .filter(({ sample, predicted }) => (sample.decision === 'NG' && predicted === 'OK') || ((sample.decision === 'OK' || sample.decision === 'OK_HARD') && predicted === 'NG'))
    .map(({ sample, predicted }) => ({ sample, predicted, kind: sample.decision === 'NG' ? 'fn' as const : 'fp' as const }))
    .slice(0, 120);
}

function buildInferenceResults(job: InferenceJob | undefined, samples: SampleItem[]): InferenceResult[] {
  if (!job) return [];
  if (job.results?.length) return job.results;
  const count = Math.min(job.total || 24, 120, samples.length || 24);
  const source = samples.length ? samples.slice(0, count) : [];
  return source.map((sample, index) => ({
    id: `${job.id}-${sample.id}`,
    sampleId: sample.id,
    filename: sample.filename,
    sourceLot: sample.sourceLot,
    probabilityNg: Math.max(0.02, Math.min(0.98, sample.probabilityNg || (index % 7 === 0 ? 0.78 : 0.08))),
    prediction: (sample.probabilityNg || (index % 7 === 0 ? 0.78 : 0.08)) >= 0.5 ? 'NG' : 'OK',
    path: sample.path
  }));
}

export default App;
