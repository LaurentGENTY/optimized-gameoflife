import { describe, expect, it } from 'vitest';
import { hashCells, liveCount } from '../src/grid';
import { buildGrid, getPreset, PRESETS } from '../src/patterns/presets';
import { mulberry32 } from '../src/random';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('presets', () => {
  it('every preset draws live cells at its minimum size and never touches the border', () => {
    for (const p of PRESETS) {
      const size = Math.max(p.minSize, 64);
      const g = buildGrid(p.id, size);
      expect(liveCount(g.cells), p.id).toBeGreaterThan(0);
      for (let i = 0; i < size; i++) {
        expect(g.cells[i], `${p.id} top`).toBe(0);
        expect(g.cells[(size - 1) * size + i], `${p.id} bottom`).toBe(0);
        expect(g.cells[i * size], `${p.id} left`).toBe(0);
        expect(g.cells[i * size + size - 1], `${p.id} right`).toBe(0);
      }
    }
  });

  it('random is reproducible and about 50% dense', () => {
    const a = buildGrid('random', 256);
    expect(hashCells(a.cells)).toBe(hashCells(buildGrid('random', 256).cells));
    const density = liveCount(a.cells) / (254 * 254);
    expect(density).toBeGreaterThan(0.45);
    expect(density).toBeLessThan(0.55);
  });

  it('guns puts one 36-cell Gosper gun in each corner', () => {
    expect(liveCount(buildGrid('guns', 128).cells)).toBe(4 * 36);
  });

  it('refuses a size below the preset minimum with a readable error', () => {
    expect(() => buildGrid('otca-off', 512)).toThrow(/2176/);
  });

  it('rejects unknown presets', () => {
    expect(() => getPreset('nope')).toThrow(/unknown preset/);
  });
});
