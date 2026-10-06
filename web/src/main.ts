import './style.css';
import { engineUnavailable, getEngine, setGpuTimestamps, SIZES, tracedVariant, visibleEngines, type EngineEnv } from './engines/registry';
import { Session, type SessionConfig } from './live/session';
import { buildGrid, PRESETS } from './patterns/presets';
import { fitCamera, type Camera } from './render/camera';
import { initWebGPU } from './render/gpu';
import { GridRenderer } from './render/renderer';
import { runSelfTestPage } from './selftest/page';
import { createPanel } from './ui/panel';
import { attachViewport } from './ui/viewport';
import { renderBenchView } from './bench/view';
import { benchMatrix, BENCH_PRESETS, GUARD_GENS, runBench } from './bench/run';
import { loadNativeReport, reportToJson, type BenchReport } from './bench/report';
import { createBenchPanel } from './ui/bench-panel';
import { getPreset } from './patterns/presets';
import { CpuMonitor, GpuMonitor } from './monitor/model';
import { createMonitorPanel } from './ui/monitor-panel';

const INITIAL: SessionConfig = { engineId: 'wasm-seq', presetId: 'random', size: 1024 };

function showFatal(message: string): void {
  const el = document.querySelector<HTMLElement>('#fatal')!;
  el.textContent = message;
  el.hidden = false;
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#grid')!;
  const gpu = await initWebGPU();
  if (!gpu.ok) {
    showFatal(gpu.reason);
    return;
  }
  void gpu.device.lost.then((info) => {
    if (info.reason !== 'destroyed') showFatal(`The GPU device was lost (${info.message}). Reload the page.`);
  });

  const renderer = new GridRenderer(canvas, gpu.device);
  const gpuLabel = gpu.label;
  const env: EngineEnv = { device: gpu.device, limits: gpu.adapter.limits, timestamps: gpu.timestamps };
  setGpuTimestamps(gpu.timestamps);
  if (new URLSearchParams(location.search).has('selftest')) {
    document.querySelector<HTMLElement>('.app')!.hidden = true;
    const root = document.createElement('main');
    root.className = 'selftest';
    document.body.append(root);
    await runSelfTestPage(root, env);
    return;
  }
  let camera: Camera | null = null;
  let gridSize = 0;
  let dirty = true;
  const fit = () => {
    if (gridSize) camera = fitCamera(gridSize, canvas.clientWidth, canvas.clientHeight);
    dirty = true;
  };

  const benchView = document.querySelector<HTMLElement>('#bench-view')!;
  const native = loadNativeReport();
  let report: BenchReport | null = null;
  let benchAbort: AbortController | null = null;
  let benchRunning = false;

  const monitorRoot = document.querySelector<HTMLElement>('#monitor')!;
  let monitoring = false;
  let monitorDirty = false;
  let liveConfig: SessionConfig = INITIAL;
  const cpuMonitor = new CpuMonitor();
  const gpuMonitor = new GpuMonitor();
  const monitorPanel = createMonitorPanel(monitorRoot, {
    cores: navigator.hardwareConcurrency,
    onOverlay: () => {
      monitorDirty = true;
    },
  });

  // Null when the engine can be monitored, otherwise the reason shown on the disabled checkbox.
  const monitoringReason = (engineId: string): string | null => {
    const traced = tracedVariant(engineId);
    if (!traced) return 'Monitoring is available for wasm-mt and the WebGPU engines.';
    if (engineId === 'wasm-mt' && navigator.hardwareConcurrency < 2) return 'Monitoring wasm-mt needs at least 2 threads.';
    return engineUnavailable(getEngine(traced));
  };

  const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
    engines: visibleEngines(),
    presets: PRESETS,
    sizes: SIZES,
    machine: `${navigator.hardwareConcurrency} logical cores · ${gpu.label}`,
    initial: INITIAL,
    maxSize: (id) => getEngine(id).maxSize(env),
    unavailable: (id) => engineUnavailable(getEngine(id)),
    onConfigChange: (config) => {
      if (!benchRunning) void load(config);
    },
    onPlayPause: () => {
      if (benchRunning) return;
      if (session.playing) void session.pause().then(() => panel.setPlaying(false));
      else {
        session.play();
        panel.setPlaying(session.playing);
      }
    },
    onStep: () => {
      if (!benchRunning) void session.step().then(() => panel.setPlaying(false));
    },
    onFit: fit,
    onMonitoring: (on) => {
      monitoring = on;
      monitorRoot.hidden = !on;
      void load(liveConfig);
    },
    onTab: (tab) => {
      benchView.hidden = tab !== 'bench';
      monitorRoot.hidden = tab === 'bench' || !monitoring;
      if (tab === 'bench') {
        void session.pause().then(() => panel.setPlaying(false));
        renderBenchView(benchView, report, native, null);
      }
    },
  });

  // Errors after init (e.g. device memory pressure mid-run) are otherwise only logged to the console.
  gpu.device.addEventListener('uncapturederror', (ev) => panel.setError(`GPU error: ${ev.error.message}`));

  const session = new Session({
    createEngine: (id) => getEngine(id).create(env),
    buildGrid,
    onFrame: (frame) => {
      renderer.setFrame(frame);
      if (frame.size !== gridSize) {
        gridSize = frame.size;
        fit();
      }
      dirty = true;
    },
    onStats: (s) => panel.setStats(s, gridSize),
    onError: (e) => {
      panel.setPlaying(false);
      panel.setError(e instanceof Error ? e.message : String(e));
    },
    onTrace: (b) => {
      if (b.kind === 'cpu') cpuMonitor.push(b);
      else gpuMonitor.push(b);
      monitorDirty = true;
    },
  });

  async function load(config: SessionConfig): Promise<void> {
    liveConfig = config;
    renderer.clear();
    renderer.setOverlay(null);
    cpuMonitor.clear();
    gpuMonitor.clear();
    monitorDirty = true; // redraw the emptied views instead of keeping the previous engine's
    panel.setMonitoringAvailable(monitoringReason(config.engineId));
    const engineId = monitoring && !monitoringReason(config.engineId) ? tracedVariant(config.engineId)! : config.engineId;
    monitorPanel.showMode(engineId.startsWith('webgpu') ? 'gpu' : 'cpu');
    panel.setPlaying(false);
    panel.setError(null);
    panel.setStats({ generation: 0, gensPerSec: 0 }, config.size);
    await session.load({ ...config, engineId });
  }

  const benchPanel = createBenchPanel(document.querySelector<HTMLElement>('#tab-bench')!, {
    engines: visibleEngines().map((e) => ({ id: e.id, label: e.label, disabledReason: engineUnavailable(e) })),
    sizes: SIZES,
    defaultSizes: [512, 1024, 2048],
    onCancel: () => benchAbort?.abort(),
    onExport: () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([reportToJson(report)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `gameoflife-bench-${report.date.slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    },
    onRun: (engineIds, sizes) => void runBenchmark(engineIds, sizes),
  });

  // Browsers throttle hidden tabs (timers and GPU work), which would silently corrupt the numbers.
  const HIDDEN_MESSAGE =
    'Cancelled: the tab was hidden. Browsers throttle background tabs, so the numbers would be wrong. Keep the tab visible while measuring.';

  async function runBenchmark(engineIds: string[], sizes: number[]): Promise<void> {
    if (benchRunning) return;
    if (document.visibilityState === 'hidden') {
      renderBenchView(benchView, report, native, HIDDEN_MESSAGE);
      return;
    }
    let hidden = false;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hidden = true;
        benchAbort?.abort();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    benchRunning = true;
    benchAbort = new AbortController();
    benchPanel.setRunning(true);
    panel.setLiveLocked(true);
    await session.pause(); // no live compute and no frames while measuring
    panel.setPlaying(false);
    const presets = BENCH_PRESETS.map((id) => ({ id, minSize: getPreset(id).minSize }));
    const cases = benchMatrix(engineIds, sizes, presets, (id) => getEngine(id).maxSize(env));
    const started = new Date().toISOString();
    try {
      const rows = await runBench(cases, {
        referenceId: 'wasm-seq',
        createEngine: (id) => getEngine(id).create(env),
        buildGrid,
        now: () => performance.now(),
        signal: benchAbort.signal,
        onProgress: (done, total, next) =>
          renderBenchView(benchView, report, native, next ? `Running ${done + 1}/${total}: ${next.engineId} · ${next.presetId} · ${next.size}²` : null),
      });
      report = {
        version: 1,
        date: started,
        machine: { cores: navigator.hardwareConcurrency, gpu: gpuLabel, userAgent: navigator.userAgent },
        guardGens: GUARD_GENS,
        rows,
      };
      benchPanel.setExportable(true);
      window.__benchReport = report;
      renderBenchView(benchView, report, native, null);
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      const message = cancelled ? (hidden ? HIDDEN_MESSAGE : 'Cancelled.') : `Benchmark failed: ${err instanceof Error ? err.message : String(err)}`;
      renderBenchView(benchView, report, native, message);
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      benchRunning = false;
      benchAbort = null;
      benchPanel.setRunning(false);
      panel.setLiveLocked(false);
      panel.setMonitoringAvailable(monitoringReason(liveConfig.engineId));
    }
  }

  attachViewport(canvas, {
    get: () => camera,
    set: (cam) => {
      camera = cam;
      dirty = true;
    },
    fit,
  });

  const tick = () => {
    // Nothing is rendered or fetched while a benchmark measures.
    if (!benchRunning) {
      session.requestFrame();
      if (monitoring && monitorDirty) {
        monitorDirty = false;
        if (liveConfig.engineId.startsWith('webgpu')) monitorPanel.renderGpu(gpuMonitor);
        else {
          monitorPanel.renderCpu(cpuMonitor);
          const o = monitorPanel.overlayFor(cpuMonitor);
          renderer.setOverlay(o && { ...o, tileSize: 32 });
          dirty = true;
        }
      }
      if (renderer.resize()) dirty = true;
      if (dirty && camera) {
        renderer.draw(camera);
        dirty = false;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await load(panel.config());
}

main().catch((err) => showFatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`));
