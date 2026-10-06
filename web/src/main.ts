import './style.css';
import { engineUnavailable, ENGINES, getEngine, SIZES, type EngineEnv } from './engines/registry';
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
  const env: EngineEnv = { device: gpu.device, limits: gpu.adapter.limits };
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

  const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
    engines: ENGINES,
    presets: PRESETS,
    sizes: SIZES,
    machine: `${navigator.hardwareConcurrency} logical cores · ${gpu.label}`,
    initial: INITIAL,
    maxSize: (id) => getEngine(id).maxSize(env),
    unavailable: (id) => engineUnavailable(getEngine(id)),
    onConfigChange: (config) => void load(config),
    onPlayPause: () => {
      if (session.playing) void session.pause().then(() => panel.setPlaying(false));
      else {
        session.play();
        panel.setPlaying(session.playing);
      }
    },
    onStep: () => void session.step().then(() => panel.setPlaying(false)),
    onFit: fit,
    onTab: (tab) => {
      benchView.hidden = tab !== 'bench';
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
  });

  async function load(config: SessionConfig): Promise<void> {
    renderer.clear();
    panel.setPlaying(false);
    panel.setError(null);
    panel.setStats({ generation: 0, gensPerSec: 0 }, config.size);
    await session.load(config);
  }

  const benchPanel = createBenchPanel(document.querySelector<HTMLElement>('#tab-bench')!, {
    engines: ENGINES.map((e) => ({ id: e.id, label: e.label, disabledReason: engineUnavailable(e) })),
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

  async function runBenchmark(engineIds: string[], sizes: number[]): Promise<void> {
    if (benchRunning) return;
    benchRunning = true;
    benchAbort = new AbortController();
    benchPanel.setRunning(true);
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
      renderBenchView(benchView, report, native, null);
    } catch (err) {
      renderBenchView(benchView, report, native, err instanceof DOMException && err.name === 'AbortError' ? 'Cancelled.' : `Benchmark failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      benchRunning = false;
      benchAbort = null;
      benchPanel.setRunning(false);
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
