import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSim } from '../src/engines/wasm-sim';

const nowMs = () => performance.timeOrigin + performance.now();

async function hashSeq(grid: Grid, gens: number): Promise<string> {
  const s = await WasmSim.create('seq', grid);
  s.step(gens);
  const h = s.hash();
  s.dispose();
  return h;
}

function records(batch: Float64Array) {
  const out = [];
  for (let i = 0; i < batch.length; i += 5)
    out.push({ thread: batch[i], tile: batch[i + 1], iteration: batch[i + 2], start: batch[i + 3], end: batch[i + 4] });
  return out;
}

describe('wasm-mt-trace', () => {
  it('computes the same generations as wasm-seq', async () => {
    const grid = buildGrid('bugs', 256);
    const sim = await WasmSim.create('mt-trace', grid, { threads: 4 });
    sim.step(200);
    expect(sim.hash()).toBe(await hashSeq(grid, 200));
    sim.dispose();
  });

  it('records every computed tile once, by a valid thread, inside the step time window', async () => {
    const sim = await WasmSim.create('mt-trace', buildGrid('random', 256), { threads: 4 });
    const before = nowMs();
    sim.step(1);
    const after = nowMs();
    const batch = sim.trace();
    expect(batch?.kind).toBe('cpu');
    if (batch?.kind !== 'cpu') return;
    expect(batch).toMatchObject({ threads: 4, tileSize: 32, tilesPerSide: 8, lost: 0 });
    const recs = records(batch.records);
    expect(recs).toHaveLength(64); // first iteration computes every tile
    expect(new Set(recs.map((r) => r.tile)).size).toBe(64);
    for (const r of recs) {
      expect(r.thread).toBeGreaterThanOrEqual(0);
      expect(r.thread).toBeLessThan(4);
      expect(r.iteration).toBe(0);
      expect(r.start).toBeGreaterThanOrEqual(before);
      expect(r.end).toBeGreaterThanOrEqual(r.start);
      expect(r.end).toBeLessThanOrEqual(after);
    }
    sim.dispose();
  });

  it('drains only new records and leaves skipped tiles out', async () => {
    const g = createGrid(256);
    for (const x of [100, 101, 102]) g.cells[100 * 256 + x] = 1;
    const sim = await WasmSim.create('mt-trace', g, { threads: 4 });
    sim.step(1);
    sim.trace();
    sim.step(3);
    const batch = sim.trace();
    if (batch?.kind !== 'cpu') throw new Error('expected a cpu batch');
    const recs = records(batch.records);
    expect(recs.length).toBeLessThanOrEqual(3 * 9);
    expect(new Set(recs.map((r) => r.iteration))).toEqual(new Set([1, 2, 3]));
    sim.dispose();
  });

  it('keeps the newest records and counts the lost ones when the ring overflows', async () => {
    const sim = await WasmSim.create('mt-trace', buildGrid('random', 256), { threads: 4 });
    sim.step(1500); // well over 65536 tile records while the grid is busy
    const batch = sim.trace();
    if (batch?.kind !== 'cpu') throw new Error('expected a cpu batch');
    const recs = records(batch.records);
    expect(recs).toHaveLength(65536);
    expect(batch.lost).toBeGreaterThan(0);
    expect(recs.at(-1)!.iteration).toBe(1499);
    sim.dispose();
  });

  it('returns null for kernels without tracing', async () => {
    const sim = await WasmSim.create('mt', createGrid(16), { threads: 2 });
    expect(sim.trace()).toBeNull();
    sim.dispose();
  });
});
