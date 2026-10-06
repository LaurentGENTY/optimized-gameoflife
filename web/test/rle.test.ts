import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { Orientation, parseRle, stampRle } from '../src/patterns/rle';

const GLIDER = '#C This is a glider.\nx = 3, y = 3\nbo$2bo$3o!\n';

const sortXY = (cells: Array<[number, number]>) =>
  [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

function alive(g: Grid): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++) if (g.cells[y * g.size + x]) out.push([x, y]);
  return out;
}

describe('parseRle', () => {
  it('parses the glider', () => {
    const p = parseRle(GLIDER);
    expect(p.width).toBe(3);
    expect(p.height).toBe(3);
    expect(sortXY(p.cells)).toEqual(sortXY([[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]));
  });

  it('handles a rule header, CRLF line endings and multi-digit counts', () => {
    const p = parseRle('#N demo\r\nx = 12, y = 2, rule = B3/S23\r\n10bo$12o!\r\n');
    expect(p.cells).toContainEqual([10, 0]);
    expect(p.cells.filter(([, y]) => y === 1)).toHaveLength(12);
  });

  it('handles counted line skips', () => {
    expect(parseRle('x = 1, y = 3\no2$o!').cells).toEqual([[0, 0], [0, 2]]);
  });

  it('rejects input without a header', () => {
    expect(() => parseRle('bo$2bo$3o!')).toThrow(/header/);
  });

  it('rejects unexpected characters', () => {
    expect(() => parseRle('x = 1, y = 1\nz!')).toThrow(/unexpected "z"/);
  });

  it('parses every bundled easypap pattern', () => {
    const files = import.meta.glob('../src/patterns/rle/*.rle', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(files).length).toBe(9);
    for (const [name, text] of Object.entries(files)) {
      expect(parseRle(text).cells.length, name).toBeGreaterThan(0);
    }
  });
});

describe('stampRle', () => {
  it('places the pattern with x = column and y = row', () => {
    const g = createGrid(8);
    stampRle(g, parseRle(GLIDER), 2, 3);
    expect(alive(g)).toEqual(sortXY([[3, 3], [4, 4], [2, 5], [3, 5], [4, 5]]));
  });

  it('HInvert mirrors from the right edge like easypap', () => {
    const g = createGrid(8);
    stampRle(g, parseRle('x = 2, y = 1\n2o!'), 1, 1, Orientation.HInvert);
    expect(alive(g)).toEqual([[5, 1], [6, 1]]);
  });

  it('VInvert mirrors from the bottom edge like easypap', () => {
    const g = createGrid(8);
    stampRle(g, parseRle('x = 1, y = 2\no$o!'), 1, 1, Orientation.VInvert);
    expect(alive(g)).toEqual([[1, 5], [1, 6]]);
  });

  it('clips cells past the right edge instead of wrapping to the next row', () => {
    const g = createGrid(6);
    stampRle(g, parseRle('x = 6, y = 1\n6o!'), 2, 1);
    expect(alive(g)).toEqual([[2, 1], [3, 1], [4, 1]]);
  });

  it('never writes the dead border', () => {
    const g = createGrid(6);
    stampRle(g, parseRle('x = 2, y = 2\n2o$2o!'), 0, 0);
    expect(alive(g)).toEqual([[1, 1]]);
  });
});
