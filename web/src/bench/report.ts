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
    // Set before load by the headless script to bench other presets than the default ones.
    __benchPresets?: string[];
  }
}

export function reportToJson(r: BenchReport): string {
  return JSON.stringify(r, null, 2);
}

const rowKey = (r: BenchRow) => `${r.engineId}|${r.presetId}|${r.size}`;

// Rows are only comparable across runs of the same machine, hence the guard.
export function mergeReports(base: BenchReport, extra: BenchReport): BenchReport {
  if (base.machine.cores !== extra.machine.cores) throw new Error('cannot merge reports: machine.cores differ');
  if (base.machine.gpu !== extra.machine.gpu) throw new Error('cannot merge reports: machine.gpu differ');
  const rows = [...base.rows];
  const index = new Map(rows.map((r, i) => [rowKey(r), i]));
  for (const r of extra.rows) {
    const i = index.get(rowKey(r));
    if (i === undefined) {
      index.set(rowKey(r), rows.length);
      rows.push(r);
    } else rows[i] = r;
  }
  return { ...base, date: extra.date, rows };
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
// The glob stays inside the function so Node (the headless bench script imports this module) never evaluates it.
export function loadNativeReport(): NativeReport | null {
  const nativeFiles = import.meta.glob('../../../bench/native.json', { eager: true, import: 'default' });
  const [value] = Object.values(nativeFiles);
  return parseNativeReport(value);
}
