import type { CpuSim, TraceBatch } from '../engine';
import { clearBorder, hashCells, type Grid } from '../grid';

export type WasmKernel = 'seq' | 'simd' | 'mt' | 'mt-trace';

interface LifeModule {
  HEAPU8: Uint8Array;
  _life_init(dim: number): number;
  _life_cells(): number;
  _life_finalize(): void;
}

interface Kernel {
  load(): Promise<LifeModule>;
  step(mod: LifeModule, n: number): void;
  tiles(mod: LifeModule): number | null;
  start?(mod: LifeModule, threads: number): void;
  // An mt module preloads hardwareConcurrency workers: load it once per JS realm.
  // Each app engine lives in its own Web Worker, so simulations never share it there.
  shared?: boolean;
  traced?: boolean;
}

const mtKernel: Kernel = {
  shared: true,
  load: async () => (await import('./wasm/generated/life-mt.mjs')).default(),
  step: (mod, n) => (mod as LifeModule & { _life_compute_tiled_mt(n: number): void })._life_compute_tiled_mt(n),
  tiles: (mod) => (mod as LifeModule & { _life_tiles_computed(): number })._life_tiles_computed(),
  start: (mod, threads) => {
    if ((mod as LifeModule & { _life_threads_start(n: number): number })._life_threads_start(threads) !== 0) {
      throw new Error(`wasm-mt: cannot start ${threads} threads`);
    }
  },
};

const KERNELS: Record<WasmKernel, Kernel> = {
  seq: {
    load: async () => (await import('./wasm/generated/life-seq.mjs')).default(),
    step: (mod, n) => (mod as LifeModule & { _life_compute_seq(n: number): void })._life_compute_seq(n),
    tiles: () => null,
  },
  simd: {
    load: async () => (await import('./wasm/generated/life-simd.mjs')).default(),
    step: (mod, n) => (mod as LifeModule & { _life_compute_tiled(n: number): void })._life_compute_tiled(n),
    tiles: (mod) => (mod as LifeModule & { _life_tiles_computed(): number })._life_tiles_computed(),
  },
  mt: mtKernel,
  'mt-trace': {
    ...mtKernel,
    traced: true,
    load: async () => (await import('./wasm/generated/life-mt-trace.mjs')).default(),
  },
};

const loaded = new Map<WasmKernel, Promise<LifeModule>>();

function loadModule(kernel: WasmKernel): Promise<LifeModule> {
  const k = KERNELS[kernel];
  if (!k.shared) return k.load();
  let p = loaded.get(kernel);
  if (!p) {
    p = k.load();
    loaded.set(kernel, p);
  }
  return p;
}

export class WasmSim implements CpuSim {
  private nbThreads = 1;
  private traceSeen = 0;

  private constructor(
    private readonly kernel: Kernel,
    private readonly mod: LifeModule,
    readonly size: number,
  ) {}

  static async create(kernel: WasmKernel, grid: Grid, opts: { threads?: number } = {}): Promise<WasmSim> {
    const k = KERNELS[kernel];
    const mod = await loadModule(kernel);
    if (mod._life_init(grid.size) !== 0) {
      throw new Error(`wasm-${kernel}: cannot allocate a ${grid.size}×${grid.size} grid`);
    }
    const sim = new WasmSim(k, mod, grid.size);
    const view = sim.cells();
    view.set(grid.cells);
    clearBorder(view, grid.size);
    if (k.start) {
      // The Emscripten pool holds hardwareConcurrency workers; never ask for more.
      const max = navigator.hardwareConcurrency;
      const threads = Math.max(1, Math.min(opts.threads ?? max, max));
      k.start(mod, threads);
      sim.nbThreads = threads;
    }
    return sim;
  }

  // Re-read pointer and HEAPU8 every call: tables swap each generation and memory may grow.
  cells(): Uint8Array {
    const ptr = this.mod._life_cells();
    return this.mod.HEAPU8.subarray(ptr, ptr + this.size * this.size);
  }

  step(n: number): void {
    this.kernel.step(this.mod, n);
  }

  hash(): string {
    return hashCells(this.cells());
  }

  threads(): number {
    return this.nbThreads;
  }

  // Drains records written since the last call. Threads are idle between steps, so no record is half-written.
  trace(): TraceBatch | null {
    if (!this.kernel.traced) return null;
    const mod = this.mod as LifeModule & {
      _life_trace_buffer(): number;
      _life_trace_capacity(): number;
      _life_trace_count(): number;
      _life_nb_tiles(): number;
    };
    const total = mod._life_trace_count() >>> 0;
    const capacity = mod._life_trace_capacity();
    const fresh = (total - this.traceSeen) >>> 0;
    const take = Math.min(fresh, capacity);
    const base = mod._life_trace_buffer();
    const i32 = new Int32Array(mod.HEAPU8.buffer);
    const f64 = new Float64Array(mod.HEAPU8.buffer);
    const records = new Float64Array(take * 5);
    for (let k = 0; k < take; k++) {
      const slot = (total - take + k) & (capacity - 1);
      const off = base + slot * 32;
      records[k * 5] = i32[off >> 2];
      records[k * 5 + 1] = i32[(off >> 2) + 1];
      records[k * 5 + 2] = i32[(off >> 2) + 2] >>> 0;
      records[k * 5 + 3] = f64[(off >> 3) + 2];
      records[k * 5 + 4] = f64[(off >> 3) + 3];
    }
    this.traceSeen = total;
    return {
      kind: 'cpu',
      threads: this.nbThreads,
      tileSize: 32,
      tilesPerSide: mod._life_nb_tiles(),
      records,
      lost: fresh - take,
    };
  }

  tilesComputed(): number | null {
    return this.kernel.tiles(this.mod);
  }

  dispose(): void {
    this.mod._life_finalize();
  }
}
