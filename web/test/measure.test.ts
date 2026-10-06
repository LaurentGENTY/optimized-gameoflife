import { describe, expect, it } from 'vitest';
import type { Engine, FrameSource } from '../src/engine';
import { createGrid, type Grid } from '../src/grid';
import { measure, median } from '../src/bench/measure';

// Engine on a fake clock: each generation costs `msPerGen`; records every call.
class ClockEngine implements Engine {
  readonly id = 'clock';
  t = 0;
  calls: string[] = [];
  constructor(private readonly msPerGen: number) {}
  async init(grid: Grid) {
    this.calls.push(`init:${grid.size}`);
  }
  async step(n: number) {
    this.calls.push(`step:${n}`);
    this.t += n * this.msPerGen;
  }
  async frame(): Promise<FrameSource> {
    throw new Error('frame() must not be called while measuring');
  }
  async hash() {
    return '';
  }
  dispose() {}
}

const opts = (e: ClockEngine, extra = {}) => ({
  warmupGens: 50,
  minMs: 1000,
  runs: 3,
  maxGens: 1 << 22,
  now: () => e.t,
  ...extra,
});

describe('median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('measure', () => {
  it('calibrates the generation count so a run lasts at least minMs', async () => {
    const e = new ClockEngine(2); // 500 gens/s
    const m = await measure(e, createGrid(8), opts(e));
    expect(m.runsMs).toHaveLength(3);
    for (const ms of m.runsMs) expect(ms).toBeGreaterThanOrEqual(1000);
    expect(m.gensPerSec).toBeCloseTo(500);
  });

  it('restarts every run from the initial grid with a warm-up and never renders', async () => {
    const e = new ClockEngine(1);
    const m = await measure(e, createGrid(8), opts(e));
    const runs = e.calls.slice(-9);
    expect(runs).toEqual([
      'init:8', 'step:50', `step:${m.gens}`,
      'init:8', 'step:50', `step:${m.gens}`,
      'init:8', 'step:50', `step:${m.gens}`,
    ]);
  });

  it('stops calibrating at maxGens for extremely fast engines', async () => {
    const e = new ClockEngine(1e-6);
    const m = await measure(e, createGrid(8), opts(e, { maxGens: 1 << 20 }));
    expect(m.gens).toBe(1 << 20);
  });

  it('aborts between steps when the signal fires', async () => {
    const e = new ClockEngine(1);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(measure(e, createGrid(8), opts(e, { signal: ctrl.signal }))).rejects.toThrow(/cancelled/);
  });
});
