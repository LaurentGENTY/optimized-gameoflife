import type { Engine, FrameSource, TraceBatch } from '../src/engine';
import type { Grid } from '../src/grid';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeEngine implements Engine {
  readonly id = 'fake';
  generation = 0;
  disposed = false;
  failAt = Infinity;
  initDelayMs = 0;
  stepDelayMs = 0;
  initError: Error | null = null;
  size = 0;

  async init(grid: Grid): Promise<void> {
    if (this.initDelayMs) await sleep(this.initDelayMs);
    if (this.initError) throw this.initError;
    this.size = grid.size;
  }

  async step(n: number): Promise<void> {
    await (this.stepDelayMs ? sleep(this.stepDelayMs) : Promise.resolve());
    if (this.disposed) throw new Error('worker terminated');
    if (this.generation + n > this.failAt) throw new Error('boom');
    this.generation += n;
  }

  async frame(): Promise<FrameSource> {
    return { kind: 'cpu', size: this.size, cells: new Uint8Array(this.size * this.size) };
  }

  async hash(): Promise<string> {
    return String(this.generation);
  }

  dispose(): void {
    this.disposed = true;
  }

  traceBatches: TraceBatch[] | null = null;
  async trace(): Promise<TraceBatch | null> {
    return this.traceBatches?.shift() ?? null;
  }
}

// Computes one generation too many per step, like an off-by-one kernel would.
export class BrokenEngine extends FakeEngine {
  override async step(n: number): Promise<void> {
    await super.step(n + 1);
  }
}
