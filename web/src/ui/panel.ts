import type { EngineInfo } from '../engines/registry';
import type { LiveStats } from '../live/runner';
import type { SessionConfig } from '../live/session';
import type { Preset } from '../patterns/presets';

export interface PanelOptions {
  engines: readonly EngineInfo[];
  presets: readonly Preset[];
  sizes: readonly number[];
  machine: string;
  initial: SessionConfig;
  maxSize(engineId: string): number;
  unavailable(engineId: string): string | null;
  onConfigChange(config: SessionConfig): void;
  onPlayPause(): void;
  onStep(): void;
  onFit(): void;
  onTab(tab: 'live' | 'bench'): void;
}

export interface PanelHandle {
  config(): SessionConfig;
  setPlaying(playing: boolean): void;
  setStats(stats: LiveStats, size: number): void;
  setError(message: string | null): void;
}

export function createPanel(root: HTMLElement, opts: PanelOptions): PanelHandle {
  root.innerHTML = `
    <h1>Game of Life <small>2020 → 2026</small></h1>
    <div class="tabs" role="tablist">
      <button role="tab" id="t-live" aria-selected="true">Live</button>
      <button role="tab" id="t-bench" aria-selected="false">Benchmark</button>
    </div>
    <div id="tab-live">
      <label>Engine <select id="engine"></select></label>
      <label>Size <select id="size"></select></label>
      <label>Pattern <select id="preset"></select></label>
      <div class="buttons">
        <button id="play">Play</button>
        <button id="step">Step</button>
        <button id="reset">Reset</button>
        <button id="fit">Fit</button>
      </div>
      <p id="stats" class="stats">gen 0</p>
      <p id="error" class="error" hidden></p>
      <p class="hint">Wheel: zoom · drag: pan · double-click: fit</p>
    </div>
    <div id="tab-bench" hidden></div>
    <p id="machine" class="machine"></p>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const engine = $<HTMLSelectElement>('#engine');
  const size = $<HTMLSelectElement>('#size');
  const preset = $<HTMLSelectElement>('#preset');

  for (const e of opts.engines) engine.add(new Option(e.label, e.id));
  for (const o of engine.options) {
    const reason = opts.unavailable(o.value);
    if (reason) {
      o.disabled = true;
      o.textContent += ' (unavailable)';
      o.title = reason;
    }
  }
  for (const s of opts.sizes) size.add(new Option(`${s} × ${s}`, String(s)));
  for (const p of opts.presets) preset.add(new Option(p.label, p.id));
  engine.value = opts.initial.engineId;
  size.value = String(opts.initial.size);
  preset.value = opts.initial.presetId;
  $('#machine').textContent = opts.machine;

  const config = (): SessionConfig => ({
    engineId: engine.value,
    presetId: preset.value,
    size: Number(size.value),
  });

  // Presets larger than the grid are shown but disabled, with the size they need.
  const syncPresets = () => {
    const n = Number(size.value);
    for (const o of preset.options) {
      const p = opts.presets.find((q) => q.id === o.value)!;
      o.disabled = p.minSize > n;
      o.textContent = o.disabled ? `${p.label} (needs ≥ ${p.minSize})` : p.label;
    }
    if (preset.selectedOptions[0]?.disabled) preset.value = 'random';
  };
  // Sizes beyond the selected engine's limit stay visible but disabled.
  const syncSizes = () => {
    const max = opts.maxSize(engine.value);
    for (const o of size.options) {
      o.disabled = Number(o.value) > max;
      o.textContent = o.disabled ? `${o.value} × ${o.value} (n/a for this engine)` : `${o.value} × ${o.value}`;
    }
    if (size.selectedOptions[0]?.disabled) {
      const allowed = [...size.options].filter((o) => !o.disabled);
      if (allowed.length) size.value = allowed[allowed.length - 1].value;
    }
  };
  syncSizes();
  syncPresets();

  const changed = () => {
    syncSizes();
    syncPresets();
    opts.onConfigChange(config());
  };
  engine.onchange = changed;
  size.onchange = changed;
  preset.onchange = changed;
  $('#play').onclick = () => opts.onPlayPause();
  $('#step').onclick = () => opts.onStep();
  $('#reset').onclick = () => opts.onConfigChange(config());
  $('#fit').onclick = () => opts.onFit();

  const select = (tab: 'live' | 'bench') => {
    $('#t-live').setAttribute('aria-selected', String(tab === 'live'));
    $('#t-bench').setAttribute('aria-selected', String(tab === 'bench'));
    $('#tab-live').hidden = tab !== 'live';
    $('#tab-bench').hidden = tab !== 'bench';
    opts.onTab(tab);
  };
  $('#t-live').onclick = () => select('live');
  $('#t-bench').onclick = () => select('bench');

  return {
    config,
    setPlaying: (playing) => {
      $('#play').textContent = playing ? 'Pause' : 'Play';
    },
    setStats: (s, n) => {
      const gcells = (s.gensPerSec * n * n) / 1e9;
      $('#stats').textContent =
        `gen ${s.generation.toLocaleString('en')} · ${s.gensPerSec.toFixed(0)} gens/s · ${gcells.toFixed(2)} Gcells/s`;
    },
    setError: (message) => {
      const el = $('#error');
      el.hidden = message === null;
      el.textContent = message ?? '';
    },
  };
}
