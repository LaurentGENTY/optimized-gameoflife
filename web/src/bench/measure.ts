import type { Engine } from '../engine';
import type { Grid } from '../grid';

export interface MeasureOptions {
  warmupGens: number;
  minMs: number;
  runs: number;
  maxGens: number;
  now(): number;
  signal?: AbortSignal;
}

export const DEFAULT_MEASURE: Omit<MeasureOptions, 'now' | 'signal'> = {
  warmupGens: 50,
  minMs: 1000,
  runs: 3,
  maxGens: 1 << 22,
};

export interface Measurement {
  gens: number;
  runsMs: number[];
  gensPerSec: number;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Benchmark cancelled', 'AbortError');
}

async function timed(engine: Engine, gens: number, now: () => number): Promise<number> {
  const t0 = now();
  await engine.step(gens);
  return now() - t0;
}

export async function measure(engine: Engine, grid: Grid, o: MeasureOptions): Promise<Measurement> {
  throwIfAborted(o.signal);
  await engine.init(grid);
  await engine.step(o.warmupGens);

  // Calibration: grow the batch until one timed step lasts minMs (aiming 10% above).
  let gens = 1;
  for (;;) {
    throwIfAborted(o.signal);
    const ms = await timed(engine, gens, o.now);
    if (ms >= o.minMs || gens >= o.maxGens) break;
    const target = ms > 0 ? Math.ceil((gens * o.minMs * 1.1) / ms) : gens * 2;
    gens = Math.min(o.maxGens, Math.max(gens * 2, target));
  }

  // Each run restarts from the same grid: lazy engines must not benefit from a grid that died out.
  const runsMs: number[] = [];
  for (let r = 0; r < o.runs; r++) {
    throwIfAborted(o.signal);
    await engine.init(grid);
    await engine.step(o.warmupGens);
    runsMs.push(await timed(engine, gens, o.now));
  }
  return { gens, runsMs, gensPerSec: (gens * 1000) / median(runsMs) };
}
