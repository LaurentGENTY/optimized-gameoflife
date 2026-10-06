import type { Grid } from './grid';

export type FrameSource =
  | { kind: 'cpu'; size: number; cells: Uint8Array }
  | { kind: 'gpu'; size: number; buffer: GPUBuffer };

export type TraceBatch =
  | {
      kind: 'cpu';
      threads: number;
      tileSize: number;
      tilesPerSide: number;
      // [thread, tile, iteration, startMs, endMs] per record, oldest first
      records: Float64Array;
      lost: number;
    }
  | {
      kind: 'gpu';
      // [iteration, kernelMs] per sample, oldest first
      samples: Float64Array;
      lost: number;
    };

export interface Engine {
  readonly id: string;
  init(grid: Grid): Promise<void>;
  step(n: number): Promise<void>;
  frame(): Promise<FrameSource>;
  hash(): Promise<string>;
  dispose(): void;
  // Only instrumented engines (monitoring) implement it.
  trace?(): Promise<TraceBatch | null>;
}

// A CPU simulation running in the current thread (inside a worker in the app).
export interface CpuSim {
  readonly size: number;
  cells(): Uint8Array;
  step(n: number): void;
  hash(): string;
  dispose(): void;
  trace?(): TraceBatch | null;
}
