import { createGrid, type Grid } from '../grid';
import { mulberry32 } from '../random';
import { Orientation, parseRle, stampRle, type RlePattern } from './rle';

export type Family = 'dense' | 'sparse';

export interface Preset {
  id: string;
  label: string;
  family: Family;
  minSize: number;
  draw(grid: Grid): void;
}

const files = import.meta.glob('./rle/*.rle', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const parsed = new Map<string, RlePattern>();

function pattern(name: string): RlePattern {
  let p = parsed.get(name);
  if (!p) {
    const text = files[`./rle/${name}.rle`];
    if (text === undefined) throw new Error(`unknown RLE pattern "${name}"`);
    p = parseRle(text);
    parsed.set(name, p);
  }
  return p;
}

const put = (g: Grid, name: string, x: number, y: number, o: number = Orientation.Normal) =>
  stampRle(g, pattern(name), x, y, o);

function fourCorners(g: Grid, name: string, d: number): void {
  put(g, name, d, d);
  put(g, name, d, d, Orientation.HInvert);
  put(g, name, d, d, Orientation.VInvert);
  put(g, name, d, d, Orientation.HInvert | Orientation.VInvert);
}

// OTCA metapixel plus its control block, offsets from easypap's otca_autoswitch/otca_life.
function otca(g: Grid, meta: string, ctrl: string, x: number, y: number): void {
  put(g, meta, x, y);
  put(g, ctrl, x + 123, y + 1396);
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'random',
    label: 'Random 50%',
    family: 'dense',
    minSize: 3,
    draw: (g) => {
      const rand = mulberry32(2020);
      for (let y = 1; y < g.size - 1; y++)
        for (let x = 1; x < g.size - 1; x++) if (rand() < 0.5) g.cells[y * g.size + x] = 1;
    },
  },
  {
    id: 'guns',
    label: 'Gosper guns (4 corners)',
    family: 'sparse',
    minSize: 128,
    draw: (g) => fourCorners(g, 'gun', 1),
  },
  {
    id: 'stable',
    label: 'Blocks (still life)',
    family: 'dense',
    minSize: 4,
    draw: (g) => {
      for (let i = 1; i < g.size - 2; i += 4)
        for (let j = 1; j < g.size - 2; j += 4) {
          g.cells[i * g.size + j] = 1;
          g.cells[i * g.size + j + 1] = 1;
          g.cells[(i + 1) * g.size + j] = 1;
          g.cells[(i + 1) * g.size + j + 1] = 1;
        }
    },
  },
  {
    id: 'bugs',
    label: 'LWSS tagalongs',
    family: 'sparse',
    minSize: 64,
    draw: (g) => {
      for (let y = 0; y < g.size / 2; y += 32) {
        put(g, 'tagalong', y + 1, y + 8);
        put(g, 'tagalong', y + 1, g.size - 32 - y + 8);
      }
    },
  },
  {
    id: 'clown',
    label: 'Clown seed',
    family: 'sparse',
    minSize: 16,
    draw: (g) => put(g, 'clown-seed', g.size >> 1, g.size >> 1),
  },
  {
    id: 'diehard',
    label: 'Diehard (dies at gen 130)',
    family: 'sparse',
    minSize: 16,
    draw: (g) => put(g, 'diehard', g.size >> 1, g.size >> 1),
  },
  {
    id: 'otca-off',
    label: 'OTCA metapixel (off)',
    family: 'sparse',
    minSize: 2176,
    draw: (g) => otca(g, 'otca-off', 'autoswitch-ctrl', 1, 1),
  },
  {
    id: 'otca-on',
    label: 'OTCA metapixel (on)',
    family: 'sparse',
    minSize: 2176,
    draw: (g) => otca(g, 'otca-on', 'autoswitch-ctrl', 1, 1),
  },
  {
    id: 'meta3x3',
    label: 'OTCA 3×3 Life',
    family: 'sparse',
    minSize: 6208,
    draw: (g) => {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          otca(g, j === 1 ? 'otca-on' : 'otca-off', 'b3-s23-ctrl', 1 + j * 2048, 1 + i * 2048);
    },
  },
];

export function getPreset(id: string): Preset {
  const p = PRESETS.find((q) => q.id === id);
  if (!p) throw new Error(`unknown preset "${id}"`);
  return p;
}

export function buildGrid(presetId: string, size: number): Grid {
  const p = getPreset(presetId);
  if (size < p.minSize) {
    throw new RangeError(`"${p.label}" needs a grid of at least ${p.minSize}×${p.minSize} (minSize), got ${size}`);
  }
  const g = createGrid(size);
  p.draw(g);
  return g;
}
