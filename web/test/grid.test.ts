import { describe, expect, it } from 'vitest';
import { clearBorder, createGrid, hashCells, liveCount } from '../src/grid';

describe('createGrid', () => {
  it('allocates size*size dead cells', () => {
    const g = createGrid(8);
    expect(g.size).toBe(8);
    expect(g.cells.length).toBe(64);
    expect(liveCount(g.cells)).toBe(0);
  });

  it('rejects sizes below 3 and non-integers', () => {
    expect(() => createGrid(2)).toThrow(RangeError);
    expect(() => createGrid(4.5)).toThrow(RangeError);
  });
});

describe('clearBorder', () => {
  it('kills the outer ring only', () => {
    const g = createGrid(4);
    g.cells.fill(1);
    clearBorder(g.cells, 4);
    expect(Array.from(g.cells)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });
});

describe('hashCells', () => {
  it('is deterministic and 8 hex chars long', () => {
    const a = new Uint8Array(16);
    expect(hashCells(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashCells(a)).toBe(hashCells(new Uint8Array(16)));
  });

  it('changes when a single cell changes', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    b[5] = 1;
    expect(hashCells(b)).not.toBe(hashCells(a));
  });

  it('treats any non-zero value as alive so u8 and u32 grids hash the same', () => {
    expect(hashCells(new Uint32Array([0, 7, 0, 1]))).toBe(hashCells(new Uint8Array([0, 1, 0, 1])));
  });
});
