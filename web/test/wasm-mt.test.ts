import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSim } from '../src/engines/wasm-sim';

async function hashSeq(grid: Grid, gens: number): Promise<string> {
  const s = await WasmSim.create('seq', grid);
  s.step(gens);
  const h = s.hash();
  s.dispose();
  return h;
}

describe('wasm-mt (pthreads + tiled + lazy + SIMD) matches wasm-seq', () => {
  for (const threads of [1, 2, 4]) {
    for (const [preset, size, gens] of [
      ['random', 70, 60],
      ['random', 256, 200],
      ['guns', 256, 300],
      ['bugs', 256, 400],
    ] as Array<[string, number, number]>) {
      it(`${threads} thread(s): ${preset} ${size}² × ${gens}`, async () => {
        const grid = buildGrid(preset, size);
        const sim = await WasmSim.create('mt', grid, { threads });
        expect(sim.threads()).toBe(threads);
        sim.step(gens);
        expect(sim.hash()).toBe(await hashSeq(grid, gens));
        sim.dispose();
      });
    }
  }

  it('reuses the pool across many short calls', async () => {
    const grid = buildGrid('random', 256);
    const sim = await WasmSim.create('mt', grid, { threads: 4 });
    for (let i = 0; i < 50; i++) sim.step(1);
    sim.step(30);
    expect(sim.hash()).toBe(await hashSeq(grid, 80));
    sim.dispose();
  });

  it('stops the pool on dispose and starts a fresh one for the next simulation', async () => {
    const grid = buildGrid('random', 128);
    const a = await WasmSim.create('mt', grid, { threads: 3 });
    a.step(10);
    a.dispose();
    const b = await WasmSim.create('mt', grid, { threads: 2 });
    b.step(10);
    expect(b.hash()).toBe(await hashSeq(grid, 10));
    b.dispose();
  });

  it('still skips idle tiles: one blinker in 256² recomputes at most 9 tiles', async () => {
    const g = createGrid(256);
    for (const x of [100, 101, 102]) g.cells[100 * 256 + x] = 1;
    const sim = await WasmSim.create('mt', g, { threads: 4 });
    sim.step(4);
    expect(sim.tilesComputed()).toBeLessThanOrEqual(9);
    sim.dispose();
  });

  it('caps the thread count at hardwareConcurrency', async () => {
    const sim = await WasmSim.create('mt', createGrid(16), { threads: 10_000 });
    expect(sim.threads()).toBe(navigator.hardwareConcurrency);
    sim.dispose();
  });
});
