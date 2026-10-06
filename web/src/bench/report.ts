import type { BenchRow } from './run';

export interface Machine {
  cores: number;
  gpu: string;
  userAgent: string;
}

export interface BenchReport {
  version: 1;
  date: string;
  machine: Machine;
  guardGens: number;
  rows: BenchRow[];
}

declare global {
  interface Window {
    // Exposed for the headless benchmark script (web/e2e-bench).
    __benchReport?: BenchReport;
  }
}

export function reportToJson(r: BenchReport): string {
  return JSON.stringify(r, null, 2);
}

export type NativeVariant = 'seq' | 'omp_tiled' | 'ocl';
const VARIANTS: readonly NativeVariant[] = ['seq', 'omp_tiled', 'ocl'];

export interface NativeReport {
  machine: string;
  date: string;
  results: { variant: NativeVariant; presetId: string; size: number; gensPerSec: number }[];
}

export function parseNativeReport(value: unknown): NativeReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<NativeReport>;
  if (typeof v.machine !== 'string' || typeof v.date !== 'string' || !Array.isArray(v.results)) return null;
  const ok = v.results.every(
    (r) =>
      r &&
      VARIANTS.includes(r.variant) &&
      typeof r.presetId === 'string' &&
      Number.isInteger(r.size) &&
      typeof r.gensPerSec === 'number' &&
      r.gensPerSec > 0,
  );
  return ok ? (v as NativeReport) : null;
}

// bench/native.json is produced on Laurent's Mac in milestone 7; it may not exist yet.
const nativeFiles = import.meta.glob('../../../bench/native.json', { eager: true, import: 'default' });

export function loadNativeReport(): NativeReport | null {
  const [value] = Object.values(nativeFiles);
  return parseNativeReport(value);
}
