export interface Grid {
  size: number;
  cells: Uint8Array;
}

export function createGrid(size: number): Grid {
  if (!Number.isInteger(size) || size < 3) {
    throw new RangeError(`grid size must be an integer >= 3, got ${size}`);
  }
  return { size, cells: new Uint8Array(size * size) };
}

export function clearBorder(cells: Uint8Array, size: number): void {
  const last = size - 1;
  cells.fill(0, 0, size);
  cells.fill(0, last * size, size * size);
  for (let y = 1; y < last; y++) {
    cells[y * size] = 0;
    cells[y * size + last] = 0;
  }
}

// FNV-1a over alive/dead bits: u8 (CPU) and u32 (GPU) grids hash identically.
export function hashCells(cells: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < cells.length; i++) {
    h ^= cells[i] !== 0 ? 1 : 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function liveCount(cells: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) n++;
  return n;
}
