import type { Engine } from '../engine';
import { CpuWorkerEngine } from './cpu-worker-engine';
import { maxGpuSize, type GpuLimits } from './gpu-limits';
import naiveShader from './webgpu/life-naive.wgsl?raw';
import tiledShader from './webgpu/life-tiled.wgsl?raw';
import { WebGpuEngine } from './webgpu-engine';

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
  unavailable?(): string | null;
  // Instrumented variants: used by monitoring and the self-test, never listed or benchmarked.
  hidden?: boolean;
}

export function engineUnavailable(info: EngineInfo): string | null {
  return info.unavailable?.() ?? null;
}

const needsIsolation = () =>
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ? null
    : 'Needs cross-origin isolation (SharedArrayBuffer). Reload once the service worker is installed.';

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
  {
    id: 'wasm-simd',
    label: 'WASM SIMD — tiled + lazy, 1 thread',
    maxSize: () => CPU_MAX_SIZE,
    create: () =>
      new CpuWorkerEngine(
        'wasm-simd',
        new Worker(new URL('./wasm-simd.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
  {
    id: 'wasm-mt',
    label: `WASM threads — tiled + lazy + SIMD, ${typeof navigator === 'undefined' ? '' : navigator.hardwareConcurrency} threads`,
    maxSize: () => CPU_MAX_SIZE,
    unavailable: needsIsolation,
    create: () =>
      new CpuWorkerEngine(
        'wasm-mt',
        new Worker(new URL('./wasm-mt.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
  {
    id: 'wasm-mt-trace',
    label: 'WASM threads (instrumented)',
    hidden: true,
    maxSize: () => CPU_MAX_SIZE,
    unavailable: needsIsolation,
    create: () =>
      new CpuWorkerEngine(
        'wasm-mt-trace',
        new Worker(new URL('./wasm-mt-trace.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
  {
    id: 'webgpu-naive',
    label: 'WebGPU naive — OpenCL 2020 in WGSL',
    maxSize: (env) => maxGpuSize(env.limits, SIZES),
    create: (env) => new WebGpuEngine('webgpu-naive', env.device, naiveShader),
  },
  {
    id: 'webgpu-tiled',
    label: 'WebGPU tiled — workgroup shared memory',
    maxSize: (env) => maxGpuSize(env.limits, SIZES),
    create: (env) => new WebGpuEngine('webgpu-tiled', env.device, tiledShader),
  },
];

export function visibleEngines(): EngineInfo[] {
  return ENGINES.filter((e) => !e.hidden);
}

const TRACED: Record<string, string> = { 'wasm-mt': 'wasm-mt-trace' };

// Monitoring swaps an engine for its instrumented build; null when it has none.
export function tracedVariant(engineId: string): string | null {
  return TRACED[engineId] ?? null;
}

export function getEngine(id: string): EngineInfo {
  const e = ENGINES.find((q) => q.id === id);
  if (!e) throw new Error(`unknown engine "${id}"`);
  return e;
}
