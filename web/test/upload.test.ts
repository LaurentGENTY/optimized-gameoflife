import { describe, expect, it } from 'vitest';
import { uploadCells } from '../src/engines/upload';

function collect(cells: Uint8Array, size: number, chunkCells: number) {
  const out = new Uint32Array(size * size);
  const offsets: number[] = [];
  uploadCells(cells, size, (byteOffset, data) => {
    offsets.push(byteOffset);
    out.set(data, byteOffset / 4);
  }, chunkCells);
  return { out, offsets };
}

describe('uploadCells', () => {
  it('converts to 0/1 u32 and kills the border', () => {
    const cells = new Uint8Array(16).fill(7);
    const { out } = collect(cells, 4, 1 << 20);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('splits the upload into chunks with byte offsets', () => {
    const cells = new Uint8Array(25).fill(1);
    const { out, offsets } = collect(cells, 5, 10);
    expect(offsets).toEqual([0, 40, 80]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(9); // 3×3 interior
  });

  it('does not mutate the caller grid', () => {
    const cells = new Uint8Array(16).fill(1);
    collect(cells, 4, 1 << 20);
    expect(cells[0]).toBe(1);
  });
});
