import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSim } from '../src/engines/wasm-sim';

async function hashBoth(grid: Grid, gens: number): Promise<[string, string]> {
  const seq = await WasmSim.create('seq', grid);
  const simd = await WasmSim.create('simd', grid);
  seq.step(gens);
  simd.step(gens);
  const out: [string, string] = [seq.hash(), simd.hash()];
  seq.dispose();
  simd.dispose();
  return out;
}

describe('wasm-simd (tiled + lazy + SIMD) matches wasm-seq', () => {
  const cases: Array<[string, number, number]> = [
    ['random', 3, 5],
    ['random', 70, 60],
    ['random', 100, 37],
    ['random', 256, 200],
    ['guns', 256, 300],
    ['bugs', 256, 400],
    ['clown', 64, 110],
  ];
  for (const [preset, size, gens] of cases) {
    it(`${preset} ${size}² × ${gens}`, async () => {
      const [seq, simd] = await hashBoth(buildGrid(preset, size), gens);
      expect(simd).toBe(seq);
    });
  }

  it('wakes sleeping tiles: a lone glider crossing an empty 200² grid', async () => {
    const g = createGrid(200);
    for (const [x, y] of [[3, 2], [4, 3], [2, 4], [3, 4], [4, 4]]) g.cells[y * 200 + x] = 1;
    const [seq, simd] = await hashBoth(g, 600);
    expect(simd).toBe(seq);
  });

  // Off-diagonal movers: a tile and its mirror across the main diagonal differ, so these
  // catch the transposed tile indexing of the 2020 lazy kernel (a diagonal glider cannot).
  const movers: Array<[string, Array<[number, number]>, number, number, number]> = [
    ['glider heading south-east, off the diagonal', [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 3, 60, 500],
    ['glider heading south-west', [[1, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 190, 5, 500],
    ['LWSS heading west', [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]], 150, 50, 400],
  ];
  for (const [name, cells, x0, y0, gens] of movers) {
    it(`wakes sleeping tiles: ${name}`, async () => {
      const g = createGrid(200);
      for (const [x, y] of cells) g.cells[(y0 + y) * 200 + x0 + x] = 1;
      const [seq, simd] = await hashBoth(g, gens);
      expect(simd).toBe(seq);
    });
  }

  it('skips tiles far from activity: one blinker in 256² recomputes at most 9 tiles', async () => {
    const g = createGrid(256);
    for (const x of [100, 101, 102]) g.cells[100 * 256 + x] = 1;
    const sim = await WasmSim.create('simd', g);
    sim.step(1);
    expect(sim.tilesComputed()).toBe(64); // first iteration computes every 32×32 tile
    sim.step(3);
    expect(sim.tilesComputed()).toBeLessThanOrEqual(9);
    sim.dispose();
  });

  it('keeps tile state per simulation: two instances do not interfere', async () => {
    const sim = await WasmSim.create('simd', buildGrid('random', 128));
    sim.step(5);
    const again = await WasmSim.create('simd', buildGrid('random', 128));
    again.step(5);
    expect(again.hash()).toBe(sim.hash());
    sim.dispose();
    again.dispose();
  });

  it('reports no tile count for the sequential kernel', async () => {
    const sim = await WasmSim.create('seq', createGrid(8));
    expect(sim.tilesComputed()).toBeNull();
    sim.dispose();
  });
});
