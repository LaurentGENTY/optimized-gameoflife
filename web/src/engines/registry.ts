import type { Engine } from '../engine';
import { CpuWorkerEngine } from './cpu-worker-engine';
import type { GpuLimits } from './gpu-limits';

export const SIZES = [512, 1024, 2048, 4096, 8192] as const;

export interface EngineEnv {
  device: GPUDevice;
  limits: GpuLimits;
}

export interface EngineInfo {
  id: string;
  label: string;
  maxSize(env: EngineEnv): number;
  create(env: EngineEnv): Engine;
}

// CPU engines stop at 4096: the spec reserves 8192 for GPU engines.
const CPU_MAX_SIZE = 4096;

export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'wasm-seq',
    label: 'WASM seq — C 2020, reference',
    maxSize: () => CPU_MAX_SIZE,
    create: () =>
      new CpuWorkerEngine(
        'wasm-seq',
        new Worker(new URL('./wasm-seq.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
];

export function getEngine(id: string): EngineInfo {
  const e = ENGINES.find((q) => q.id === id);
  if (!e) throw new Error(`unknown engine "${id}"`);
  return e;
}
