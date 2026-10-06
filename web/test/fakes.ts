import type { Engine, FrameSource } from '../src/engine';
import type { Grid } from '../src/grid';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeEngine implements Engine {
  readonly id = 'fake';
  generation = 0;
  disposed = false;
  failAt = Infinity;
  initDelayMs = 0;
  initError: Error | null = null;
  size = 0;

  async init(grid: Grid): Promise<void> {
    if (this.initDelayMs) await sleep(this.initDelayMs);
    if (this.initError) throw this.initError;
    this.size = grid.size;
  }

  async step(n: number): Promise<void> {
    await Promise.resolve();
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
}
