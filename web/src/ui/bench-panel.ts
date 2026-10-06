export interface BenchPanelOptions {
  engines: readonly { id: string; label: string; disabledReason: string | null }[];
  sizes: readonly number[];
  defaultSizes: readonly number[];
  onRun(engineIds: string[], sizes: number[]): void;
  onCancel(): void;
  onExport(): void;
}

export interface BenchPanelHandle {
  setRunning(running: boolean): void;
  setExportable(ok: boolean): void;
}

export function createBenchPanel(root: HTMLElement, opts: BenchPanelOptions): BenchPanelHandle {
  root.innerHTML = `
    <label>Engines <div class="checks" id="b-engines"></div></label>
    <label>Sizes <div class="checks" id="b-sizes"></div></label>
    <div class="buttons"><button id="b-run">Run</button><button id="b-export" disabled>Export JSON</button></div>
    <p class="hint">Patterns: random (dense), guns and OTCA (sparse, ≥ 2176). Each engine is checked against wasm-seq first.</p>`;
  const box = (parent: HTMLElement, value: string, text: string, checked: boolean, disabled: string | null) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked && !disabled;
    input.disabled = disabled !== null;
    if (disabled) {
      label.title = disabled;
      input.dataset.unavailable = '1';
    }
    label.append(input, text);
    parent.append(label);
  };
  const engines = root.querySelector<HTMLElement>('#b-engines')!;
  const sizes = root.querySelector<HTMLElement>('#b-sizes')!;
  for (const e of opts.engines) box(engines, e.id, e.id, true, e.disabledReason);
  for (const s of opts.sizes) box(sizes, String(s), String(s), opts.defaultSizes.includes(s), null);
  const run = root.querySelector<HTMLButtonElement>('#b-run')!;
  const exp = root.querySelector<HTMLButtonElement>('#b-export')!;
  let running = false;
  const checked = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
  run.onclick = () => (running ? opts.onCancel() : opts.onRun(checked(engines), checked(sizes).map(Number)));
  exp.onclick = () => opts.onExport();
  return {
    setRunning: (r) => {
      running = r;
      run.textContent = r ? 'Cancel' : 'Run';
      for (const i of root.querySelectorAll<HTMLInputElement>('input')) i.disabled = r || i.dataset.unavailable === '1';
    },
    setExportable: (ok) => {
      exp.disabled = !ok;
    },
  };
}
