import { describe, expect, it } from 'vitest';
import { CpuMonitor, GpuMonitor } from '../src/monitor/model';

// [thread, tile, iteration, start, end]
const cpu = (recs: number[][], threads = 2, lost = 0) => ({
  kind: 'cpu' as const,
  threads,
  tileSize: 32,
  tilesPerSide: 2,
  records: Float64Array.from(recs.flat()),
  lost,
});

describe('CpuMonitor', () => {
  it('keeps only the latest iterations across batches', () => {
    const m = new CpuMonitor(2);
    m.push(cpu([[0, 0, 0, 0, 1], [1, 1, 0, 0, 2]]));
    m.push(cpu([[0, 0, 1, 3, 4], [0, 1, 2, 5, 6]]));
    expect(m.window().iterations).toEqual([1, 2]);
    expect(m.window().spans.map((s) => s.iteration)).toEqual([1, 2]);
    expect(m.window()).toMatchObject({ t0: 3, t1: 6 });
  });

  it('maps the latest iteration to tiles, leaving skipped tiles at -1', () => {
    const m = new CpuMonitor();
    m.push(cpu([[1, 3, 0, 10, 14], [0, 0, 0, 10, 11]]));
    const t = m.latestTiles()!;
    expect(Array.from(t.thread)).toEqual([0, -1, -1, 1]);
    expect(Array.from(t.durationMs)).toEqual([1, -1, -1, 4]);
  });

  it('computes per-thread activity over the window, including idle threads', () => {
    const m = new CpuMonitor();
    m.push(cpu([[0, 0, 0, 0, 10], [0, 1, 0, 10, 15]], 3));
    expect(m.activity()).toEqual([100, 0, 0]);
  });

  it('measures activity inside each iteration, ignoring gaps between steps', () => {
    const m = new CpuMonitor();
    // Two iterations 1 s apart (frame readback, Step clicks): both fully busy for thread 0.
    m.push(cpu([[0, 0, 0, 0, 10], [1, 1, 0, 0, 5]]));
    m.push(cpu([[0, 0, 1, 1000, 1010], [1, 1, 1, 1000, 1005]]));
    expect(m.activity()).toEqual([100, 50]);
  });

  it('accumulates lost records and clears', () => {
    const m = new CpuMonitor();
    m.push(cpu([[0, 0, 0, 0, 1]], 2, 5));
    m.push(cpu([[0, 0, 1, 1, 2]], 2, 2));
    expect(m.lost).toBe(7);
    m.clear();
    expect(m.window().spans).toEqual([]);
    expect(m.latestTiles()).toBeNull();
    expect(m.lost).toBe(0);
  });
});

describe('GpuMonitor', () => {
  it('keeps the last samples in order', () => {
    const m = new GpuMonitor(3);
    m.push({ kind: 'gpu', samples: Float64Array.from([0, 0.5, 1, 0.6]), lost: 0 });
    m.push({ kind: 'gpu', samples: Float64Array.from([2, 0.7, 3, 0.8]), lost: 1 });
    expect(m.samples()).toEqual([
      { iteration: 1, ms: 0.6 },
      { iteration: 2, ms: 0.7 },
      { iteration: 3, ms: 0.8 },
    ]);
    expect(m.lost).toBe(1);
  });
});
