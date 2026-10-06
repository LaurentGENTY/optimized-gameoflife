import type { CpuSim } from '../engine';
import { clearBorder, hashCells, type Grid } from '../grid';
import createLifeSeq from './wasm/generated/life-seq.mjs';

type LifeSeqModule = Awaited<ReturnType<typeof createLifeSeq>>;

export class WasmSeqSim implements CpuSim {
  private constructor(
    private readonly mod: LifeSeqModule,
    readonly size: number,
  ) {}

  static async create(grid: Grid): Promise<WasmSeqSim> {
    const mod = await createLifeSeq();
    if (mod._life_init(grid.size) !== 0) {
      throw new Error(`wasm-seq: cannot allocate a ${grid.size}×${grid.size} grid`);
    }
    const sim = new WasmSeqSim(mod, grid.size);
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
    this.mod._life_compute_seq(n);
  }

  hash(): string {
    return hashCells(this.cells());
  }

  dispose(): void {
    this.mod._life_finalize();
  }
}
