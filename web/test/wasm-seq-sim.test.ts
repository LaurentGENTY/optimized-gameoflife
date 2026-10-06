import { describe, expect, it } from 'vitest';
import { createGrid, liveCount } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSeqSim } from '../src/engines/wasm-seq-sim';

type XY = Array<[number, number]>;

async function simFrom(size: number, cells: XY): Promise<WasmSeqSim> {
  const g = createGrid(size);
  for (const [x, y] of cells) g.cells[y * size + x] = 1;
  return WasmSeqSim.create(g);
}

function aliveXY(sim: WasmSeqSim): XY {
  const out: XY = [];
  const c = sim.cells();
  for (let y = 0; y < sim.size; y++)
    for (let x = 0; x < sim.size; x++) if (c[y * sim.size + x]) out.push([x, y]);
  return out;
}

const sortXY = (cells: XY) => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

describe('wasm-seq (original C sequential kernel)', () => {
  it('keeps a block still', async () => {
    const s = await simFrom(8, [[3, 3], [4, 3], [3, 4], [4, 4]]);
    const h = s.hash();
    s.step(10);
    expect(s.hash()).toBe(h);
    s.dispose();
  });

  it('oscillates a blinker with period 2', async () => {
    const s = await simFrom(8, [[2, 3], [3, 3], [4, 3]]);
    s.step(1);
    expect(sortXY(aliveXY(s))).toEqual([[3, 2], [3, 3], [3, 4]]);
    s.step(1);
    expect(sortXY(aliveXY(s))).toEqual([[2, 3], [3, 3], [4, 3]]);
    s.dispose();
  });

  it('moves a glider by one cell diagonally every 4 generations', async () => {
    const glider: XY = [[3, 2], [4, 3], [2, 4], [3, 4], [4, 4]];
    const s = await simFrom(12, glider);
    s.step(4);
    expect(sortXY(aliveXY(s))).toEqual(sortXY(glider.map(([x, y]) => [x + 1, y + 1])));
    s.dispose();
  });

  it('lets diehard die exactly at generation 130', async () => {
    const s = await WasmSeqSim.create(buildGrid('diehard', 128));
    s.step(129);
    expect(liveCount(s.cells())).toBeGreaterThan(0);
    s.step(1);
    expect(liveCount(s.cells())).toBe(0);
    s.dispose();
  });

  it('clears border cells given at init and keeps them dead', async () => {
    const g = createGrid(8);
    g.cells.fill(1);
    const s = await WasmSeqSim.create(g);
    const isBorder = (x: number, y: number) => x === 0 || y === 0 || x === 7 || y === 7;
    expect(aliveXY(s).filter(([x, y]) => isBorder(x, y))).toEqual([]);
    s.step(3);
    expect(aliveXY(s).filter(([x, y]) => isBorder(x, y))).toEqual([]);
    s.dispose();
  });
});
