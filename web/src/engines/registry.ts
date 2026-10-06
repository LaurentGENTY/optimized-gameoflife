import type { Engine } from '../engine';
import { CpuWorkerEngine } from './cpu-worker-engine';

export interface EngineInfo {
  id: string;
  label: string;
  create(): Engine;
}

export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'wasm-seq',
    label: 'WASM seq — C 2020, reference',
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
