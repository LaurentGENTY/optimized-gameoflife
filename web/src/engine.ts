import type { Grid } from './grid';

export type FrameSource =
  | { kind: 'cpu'; size: number; cells: Uint8Array }
  | { kind: 'gpu'; size: number; buffer: GPUBuffer };

export interface Engine {
  readonly id: string;
  init(grid: Grid): Promise<void>;
  step(n: number): Promise<void>;
  frame(): Promise<FrameSource>;
  hash(): Promise<string>;
  dispose(): void;
}

// A CPU simulation running in the current thread (inside a worker in the app).
export interface CpuSim {
  readonly size: number;
  cells(): Uint8Array;
  step(n: number): void;
  hash(): string;
  dispose(): void;
}
