import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/grid';
import { benchMatrix, runBench, type BenchDeps } from '../src/bench/run';
import { BrokenEngine, FakeEngine } from './fakes';

const PRESETS = [
  { id: 'random', minSize: 3 },
  { id: 'otca-off', minSize: 2176 },
];

describe('benchMatrix', () => {
  it('skips presets above the size and sizes above each engine limit', () => {
    const cases = benchMatrix(['cpu', 'gpu'], [512, 8192], PRESETS, (id) => (id === 'cpu' ? 4096 : 8192));
    expect(cases.map((c) => `${c.presetId}/${c.size}/${c.engineId}`)).toEqual([
      'random/512/cpu',
      'random/512/gpu',
      'random/8192/gpu',
      'otca-off/8192/gpu',
    ]);
  });
});

function deps(make: Record<string, () => FakeEngine>, extra: Partial<BenchDeps> = {}, onNow?: (t: number) => void) {
  const created: FakeEngine[] = [];
  const d: BenchDeps = {
    referenceId: 'ref',
    createEngine: (id) => {
      const e = make[id]();
      created.push(e);
      return e;
    },
    buildGrid: (_p, size) => createGrid(size),
    // Fake clock: 10 ms per generation computed by any engine.
    now: () => {
      const t = created.reduce((sum, e) => sum + e.generation * 10, 0);
      onNow?.(t);
      return t;
    },
    measure: { warmupGens: 2, minMs: 100, runs: 3, maxGens: 1 << 12 },
    ...extra,
  };
  return { d, created };
}

const CASE = { engineId: 'a', presetId: 'random', size: 16 };

describe('runBench', () => {
  it('measures an engine that matches the reference', async () => {
    const { d } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine() });
    const [row] = await runBench([CASE], d);
    expect(row.status).toBe('ok');
    expect(row.gensPerSec).toBeCloseTo(100);
    expect(row.gcellsPerSec).toBeCloseTo((100 * 16 * 16) / 1e9);
  });

  it('marks a diverging engine invalid and does not measure it', async () => {
    const { d } = deps({ ref: () => new FakeEngine(), a: () => new BrokenEngine() });
    const [row] = await runBench([CASE], d);
    expect(row).toMatchObject({ status: 'invalid', expectedHash: '32', actualHash: '33' });
    expect(row.gensPerSec).toBeUndefined();
  });

  it('records an engine error and carries on with the next case', async () => {
    const { d, created } = deps({
      ref: () => new FakeEngine(),
      a: () => {
        const e = new FakeEngine();
        e.initError = new Error('GPU out of memory');
        return e;
      },
      b: () => new FakeEngine(),
    });
    const rows = await runBench([CASE, { ...CASE, engineId: 'b' }], d);
    expect(rows.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(rows[0].error).toBe('GPU out of memory');
    expect(created.every((e) => e.disposed)).toBe(true);
  });

  it('computes the reference hash once per preset and size', async () => {
    const { d, created } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine(), b: () => new FakeEngine() });
    await runBench([CASE, { ...CASE, engineId: 'b' }], d);
    expect(created.filter((e) => e.id === 'fake').length).toBe(3); // 1 reference + 2 engines
  });

  it('reports progress before each case and at the end', async () => {
    const seen: string[] = [];
    const { d } = deps(
      { ref: () => new FakeEngine(), a: () => new FakeEngine() },
      { onProgress: (done, total, next) => seen.push(`${done}/${total}:${next?.engineId ?? '-'}`) },
    );
    await runBench([CASE], d);
    expect(seen).toEqual(['0/1:a', '1/1:-']);
  });

  it('stops on cancellation during a measurement, disposes the engine and rejects', async () => {
    const ctrl = new AbortController();
    // Reference and guard use 2 × 32 gens = 640 ms; the first clock read in measure() aborts.
    const { d, created } = deps(
      { ref: () => new FakeEngine(), a: () => new FakeEngine() },
      { signal: ctrl.signal },
      (t) => t > 500 && ctrl.abort(),
    );
    await expect(runBench([CASE], d)).rejects.toThrow(/cancelled/);
    expect(created).toHaveLength(2);
    expect(created.every((e) => e.disposed)).toBe(true);
  });
});
