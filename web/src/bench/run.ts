import type { Engine } from '../engine';
import type { Grid } from '../grid';
import { DEFAULT_MEASURE, measure, throwIfAborted, type MeasureOptions } from './measure';

export const BENCH_PRESETS = ['random', 'guns', 'otca-off'] as const;
export const GUARD_GENS = 32;

export interface BenchCase {
  engineId: string;
  presetId: string;
  size: number;
}

export type BenchStatus = 'ok' | 'invalid' | 'error';

export interface BenchRow extends BenchCase {
  status: BenchStatus;
  gens?: number;
  runsMs?: number[];
  gensPerSec?: number;
  gcellsPerSec?: number;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
}

export interface BenchDeps {
  referenceId: string;
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
  now(): number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number, next: BenchCase | null): void;
  measure?: Partial<Omit<MeasureOptions, 'now' | 'signal'>>;
}

export function benchMatrix(
  engineIds: readonly string[],
  sizes: readonly number[],
  presets: readonly { id: string; minSize: number }[],
  maxSize: (engineId: string) => number,
): BenchCase[] {
  const cases: BenchCase[] = [];
  for (const p of presets)
    for (const size of sizes) {
      if (size < p.minSize) continue;
      for (const engineId of engineIds) if (size <= maxSize(engineId)) cases.push({ engineId, presetId: p.id, size });
    }
  return cases;
}

async function hashAfter(engine: Engine, grid: Grid, gens: number): Promise<string> {
  await engine.init(grid);
  await engine.step(gens);
  return engine.hash();
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export async function runBench(cases: readonly BenchCase[], deps: BenchDeps): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  const grids = new Map<string, Grid>();
  // A failed reference is remembered so every case of that preset and size reports it.
  const references = new Map<string, string | { error: string }>();
  const options: MeasureOptions = { ...DEFAULT_MEASURE, ...deps.measure, now: deps.now, signal: deps.signal };

  for (const [i, c] of cases.entries()) {
    deps.onProgress?.(i, cases.length, c);
    throwIfAborted(deps.signal);
    const key = `${c.presetId}/${c.size}`;
    let grid = grids.get(key);
    if (!grid) {
      grid = deps.buildGrid(c.presetId, c.size);
      grids.clear(); // cases are grouped by preset and size: keep only the current grid in memory
      grids.set(key, grid);
    }
    let expected = references.get(key);
    if (expected === undefined) {
      const ref = deps.createEngine(deps.referenceId);
      try {
        expected = await hashAfter(ref, grid, GUARD_GENS);
      } catch (err) {
        if (isAbort(err)) throw err;
        expected = { error: `reference ${deps.referenceId} failed: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        ref.dispose();
      }
      references.set(key, expected);
    }
    if (typeof expected !== 'string') {
      rows.push({ ...c, status: 'error', error: expected.error });
      continue;
    }

    const engine = deps.createEngine(c.engineId);
    try {
      const actual = await hashAfter(engine, grid, GUARD_GENS);
      if (actual !== expected) {
        rows.push({ ...c, status: 'invalid', expectedHash: expected, actualHash: actual });
        continue;
      }
      const m = await measure(engine, grid, options);
      rows.push({
        ...c,
        status: 'ok',
        gens: m.gens,
        runsMs: m.runsMs,
        gensPerSec: m.gensPerSec,
        gcellsPerSec: (m.gensPerSec * c.size * c.size) / 1e9,
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      rows.push({ ...c, status: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      engine.dispose();
    }
  }
  deps.onProgress?.(cases.length, cases.length, null);
  return rows;
}
