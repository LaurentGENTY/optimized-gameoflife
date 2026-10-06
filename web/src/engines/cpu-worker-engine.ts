import type { Engine, FrameSource, TraceBatch } from '../engine';
import type { Grid } from '../grid';
import { WorkerRpc, type WorkerLike } from './worker-rpc';

export class CpuWorkerEngine implements Engine {
  private readonly rpc: WorkerRpc;
  private size = 0;

  constructor(
    readonly id: string,
    worker: WorkerLike,
  ) {
    this.rpc = new WorkerRpc(worker);
  }

  async init(grid: Grid): Promise<void> {
    this.size = grid.size;
    const cells = grid.cells.slice();
    await this.rpc.call({ op: 'init', size: grid.size, cells }, [cells.buffer as ArrayBuffer]);
  }

  async step(n: number): Promise<void> {
    await this.rpc.call({ op: 'step', n });
  }

  async frame(): Promise<FrameSource> {
    const cells = await this.rpc.call<Uint8Array>({ op: 'frame' });
    return { kind: 'cpu', size: this.size, cells };
  }

  hash(): Promise<string> {
    return this.rpc.call<string>({ op: 'hash' });
  }

  trace(): Promise<TraceBatch | null> {
    return this.rpc.call<TraceBatch | null>({ op: 'trace' });
  }

  dispose(): void {
    this.rpc.terminate();
  }
}
