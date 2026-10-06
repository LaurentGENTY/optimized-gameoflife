import './style.css';
import { ENGINES, getEngine, SIZES, type EngineEnv } from './engines/registry';
import { Session, type SessionConfig } from './live/session';
import { buildGrid, PRESETS } from './patterns/presets';
import { fitCamera, type Camera } from './render/camera';
import { initWebGPU } from './render/gpu';
import { GridRenderer } from './render/renderer';
import { runSelfTestPage } from './selftest/page';
import { createPanel } from './ui/panel';
import { attachViewport } from './ui/viewport';

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

  const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
    engines: ENGINES,
    presets: PRESETS,
    sizes: SIZES,
    machine: `${navigator.hardwareConcurrency} logical cores · ${gpu.label}`,
    initial: INITIAL,
    maxSize: (id) => getEngine(id).maxSize(env),
    onConfigChange: (config) => void load(config),
    onPlayPause: () => {
      if (session.playing) void session.pause().then(() => panel.setPlaying(false));
      else {
        session.play();
        panel.setPlaying(true);
      }
    },
    onStep: () => void session.step().then(() => panel.setPlaying(false)),
    onFit: fit,
  });

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

  attachViewport(canvas, {
    get: () => camera,
    set: (cam) => {
      camera = cam;
      dirty = true;
    },
    fit,
  });

  const tick = () => {
    session.requestFrame();
    if (renderer.resize()) dirty = true;
    if (dirty && camera) {
      renderer.draw(camera);
      dirty = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await load(panel.config());
}

main().catch((err) => showFatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`));
