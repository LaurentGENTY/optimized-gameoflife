import type { CpuSim } from '../engine';
import { clearBorder, hashCells, type Grid } from '../grid';

export type WasmKernel = 'seq' | 'simd';

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
}

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
};

export class WasmSim implements CpuSim {
  private constructor(
    private readonly kernel: Kernel,
    private readonly mod: LifeModule,
    readonly size: number,
  ) {}

  static async create(kernel: WasmKernel, grid: Grid): Promise<WasmSim> {
    const k = KERNELS[kernel];
    const mod = await k.load();
    if (mod._life_init(grid.size) !== 0) {
      throw new Error(`wasm-${kernel}: cannot allocate a ${grid.size}×${grid.size} grid`);
    }
    const sim = new WasmSim(k, mod, grid.size);
    const view = sim.cells();
    view.set(grid.cells);
    clearBorder(view, grid.size);
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

  tilesComputed(): number | null {
    return this.kernel.tiles(this.mod);
  }

  dispose(): void {
    this.mod._life_finalize();
  }
}
