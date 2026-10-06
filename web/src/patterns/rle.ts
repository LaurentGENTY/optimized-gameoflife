import type { Grid } from '../grid';

export interface RlePattern {
  width: number;
  height: number;
  cells: Array<[x: number, y: number]>;
}

export const Orientation = { Normal: 0, HInvert: 1, VInvert: 2 } as const;

const HEADER = /^\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/;

export function parseRle(text: string): RlePattern {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => HEADER.test(l));
  if (headerIdx < 0) throw new Error('RLE: missing "x = .., y = .." header');
  const [, w, h] = HEADER.exec(lines[headerIdx])!;

  const body = lines
    .slice(headerIdx + 1)
    .filter((l) => !l.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');

  const cells: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < body.length) {
    let j = i;
    while (j < body.length && body[j] >= '0' && body[j] <= '9') j++;
    const n = j > i ? parseInt(body.slice(i, j), 10) : 1;
    const tag = body[j];
    if (tag === 'b') x += n;
    else if (tag === 'o') {
      for (let k = 0; k < n; k++) cells.push([x + k, y]);
      x += n;
    } else if (tag === '$') {
      y += n;
      x = 0;
    } else if (tag === '!') break;
    else throw new Error(`RLE: unexpected "${tag ?? 'end of input'}" at offset ${j}`);
    i = j + 1;
  }
  return { width: Number(w), height: Number(h), cells };
}

// Mirrors easypap's rle_lexer: inverted axes start from the opposite edge.
export function stampRle(grid: Grid, pattern: RlePattern, xo: number, yo: number, orientation = 0): void {
  const { size, cells } = grid;
  const hInv = (orientation & Orientation.HInvert) !== 0;
  const vInv = (orientation & Orientation.VInvert) !== 0;
  const x0 = hInv ? size - 1 - xo : xo;
  const y0 = vInv ? size - 1 - yo : yo;
  const xdir = hInv ? -1 : 1;
  const ydir = vInv ? -1 : 1;
  for (const [dx, dy] of pattern.cells) {
    const x = x0 + xdir * dx;
    const y = y0 + ydir * dy;
    // Borders are dead and out-of-grid cells must not wrap onto the next row.
    if (x < 1 || y < 1 || x > size - 2 || y > size - 2) continue;
    cells[y * size + x] = 1;
  }
}
