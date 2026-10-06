# Jalon 1 — Base web + `wasm-seq` + démo en ligne : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une page web déployée sur GitHub Pages qui fait tourner le noyau séquentiel C de 2020 (compilé en WASM) dans un worker, affiche la grille via WebGPU avec zoom/pan, et charge les motifs RLE d'origine.

**Architecture:** Vite + TypeScript sans framework dans `web/`. Le C (`web/wasm/life.c`, repris de `easypap-se/kernel/c/life.c`) est compilé par `emcc` en un module ES autonome (`SINGLE_FILE`). Il tourne dans un Web Worker derrière une petite RPC. Le thread principal ne fait que l'UI : il récupère une copie de la grille au rythme de `requestAnimationFrame`, et un fragment shader WebGPU la dessine.

**Tech Stack:** Node 22, Vite, TypeScript (strict), Vitest, Emscripten (emcc), WebGPU (`@webgpu/types`), GitHub Actions (`setup-emsdk`, `deploy-pages`).

**Spec:** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2). Ce plan couvre le **jalon 1** uniquement. Les jalons 2 à 8 auront chacun leur plan.

## Global Constraints

- Les moteurs CPU sont du **C d'origine compilé avec Emscripten**. Aucune logique de calcul du jeu de la vie en TypeScript : TS sert à l'UI et à la glue.
- `easypap-se/` n'est pas modifié.
- Bords morts : l'anneau extérieur (ligne/colonne 0 et `size-1`) vaut toujours 0. Le placement RLE est rogné à l'intérieur `[1, size-2]`.
- Moteurs CPU : 1 octet par cellule (`uint8_t`), calcul uniquement dans un worker.
- Le rendu n'est jamais sur le chemin du calcul : une copie CPU de la grille n'est demandée qu'à la demande de `requestAnimationFrame`.
- Pas de WebGPU → message clair, pas de fallback.
- Le code, les commentaires, les messages de commit et les textes de l'UI sont en anglais. Les commentaires n'expliquent que le *pourquoi*.
- Chaque message de commit se termine par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Les `.wasm`/`.mjs` générés ne sont pas commités (`web/src/engines/wasm/generated/` est ignoré). La CI les reconstruit avec la version d'emsdk figée dans `web/wasm/EMSDK_VERSION`.
- Aucun `git push`, merge sur `master` ou activation de Pages sans un « oui » explicite de Laurent.
- Toutes les commandes `npm` se lancent depuis `web/`.

## Review Focus

1. **Motif RLE qui déborde de la grille** (gun aux coins d'une petite grille, motif placé près d'un bord) → les cellules hors de l'intérieur sont ignorées. Elles ne reviennent jamais sur la ligne suivante et ne touchent pas le bord. Test : Task 2.
2. **Motif trop grand pour la taille choisie** (OTCA en 512) → l'option est grisée dans l'UI et `buildGrid` lève une erreur lisible. Test : Task 3.
3. **Changements rapides de moteur/taille/motif** → seule la dernière configuration survit. Aucune frame d'un ancien moteur n'est affichée et tous les anciens workers sont terminés. Test : Task 8.
4. **Crash du worker ou erreur du moteur en pleine lecture** → la boucle s'arrête et l'erreur s'affiche. Les appels suivants sont rejetés au lieu de rester bloqués. Tests : Tasks 5 et 7.
5. **Pas de WebGPU, pas d'adaptateur, ou échec de création du device** → un message lisible remplace la page, jamais d'écran vide. Test : Task 6.

---

### Task 1 : Scaffold `web/` et module `grid`

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/.gitignore`
- Create: `web/src/grid.ts`
- Test: `web/test/grid.test.ts`

**Interfaces:**
- Produces:
  - `interface Grid { size: number; cells: Uint8Array }`
  - `createGrid(size: number): Grid`, qui lève une `RangeError` si `size < 3` ou si `size` n'est pas entier
  - `clearBorder(cells: Uint8Array, size: number): void`
  - `hashCells(cells: ArrayLike<number>): string` (FNV-1a 32 bits sur `cell !== 0`, 8 caractères hexa)
  - `liveCount(cells: ArrayLike<number>): number`

- [ ] **Step 1 : Créer le projet**

`web/package.json` :

```json
{
  "name": "gameoflife-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Puis, depuis `web/` :

```bash
npm install -D vite typescript vitest @webgpu/types
```

`web/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@webgpu/types", "vite/client"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/vite.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  worker: { format: 'es' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

`web/.gitignore` :

```
node_modules/
dist/
src/engines/wasm/generated/
```

- [ ] **Step 2 : Écrire le test qui échoue**

`web/test/grid.test.ts` :

```ts
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
```

- [ ] **Step 3 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- grid`
Attendu : FAIL, `Cannot find module '../src/grid'`.

- [ ] **Step 4 : Implémenter**

`web/src/grid.ts` :

```ts
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
```

- [ ] **Step 5 : Lancer les tests et le typecheck**

Run : `npm test -- grid && npm run typecheck`
Attendu : 6 tests PASS, aucune erreur TS.

- [ ] **Step 6 : Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/.gitignore web/src/grid.ts web/test/grid.test.ts
git commit -m "feat(web): scaffold Vite + TS project with grid helpers"
```

---

### Task 2 : Parseur RLE et placement fidèle à easypap

**Files:**
- Create: `web/src/patterns/rle/*.rle` (copiés depuis `easypap-se/data/rle/`)
- Create: `web/src/patterns/rle.ts`
- Test: `web/test/rle.test.ts`

**Interfaces:**
- Consumes : `Grid`, `createGrid` (Task 1)
- Produces :
  - `interface RlePattern { width: number; height: number; cells: Array<[x: number, y: number]> }`
  - `parseRle(text: string): RlePattern`, qui lève `Error` si l'en-tête manque (`/header/`) ou sur un caractère inattendu (`/unexpected "z"/`)
  - `const Orientation = { Normal: 0, HInvert: 1, VInvert: 2 }`
  - `stampRle(grid: Grid, pattern: RlePattern, xo: number, yo: number, orientation?: number): void`. `xo` est la colonne et `yo` la ligne, comme `life_rle_parse(file, x, y, ...)` dans easypap. Avec `HInvert`, l'origine devient `size-1-xo` et x décroît. `VInvert` fait de même sur y. Les cellules hors de `[1, size-2]²` sont ignorées.

- [ ] **Step 1 : Copier les motifs**

```bash
mkdir -p web/src/patterns/rle && cp easypap-se/data/rle/*.rle web/src/patterns/rle/
```

- [ ] **Step 2 : Écrire le test qui échoue**

`web/test/rle.test.ts` :

```ts
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
```

- [ ] **Step 3 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- rle`
Attendu : FAIL, `Cannot find module '../src/patterns/rle'`.

- [ ] **Step 4 : Implémenter**

`web/src/patterns/rle.ts` :

```ts
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
```

- [ ] **Step 5 : Lancer les tests**

Run : `npm test -- rle && npm run typecheck`
Attendu : 11 tests PASS.

- [ ] **Step 6 : Commit**

```bash
git add web/src/patterns web/test/rle.test.ts
git commit -m "feat(web): RLE parser and easypap-compatible stamping"
```

---

### Task 3 : Presets (les `life_draw_*` d'easypap)

**Files:**
- Create: `web/src/random.ts`
- Create: `web/src/patterns/presets.ts`
- Test: `web/test/presets.test.ts`

**Interfaces:**
- Consumes : `Grid`, `createGrid`, `clearBorder`, `liveCount`, `hashCells` (Task 1) ; `parseRle`, `stampRle`, `Orientation`, `RlePattern` (Task 2)
- Produces :
  - `mulberry32(seed: number): () => number`, à valeurs dans [0, 1)
  - `type Family = 'dense' | 'sparse'`
  - `interface Preset { id: string; label: string; family: Family; minSize: number; draw(grid: Grid): void }`
  - `PRESETS: readonly Preset[]`, avec les ids `random`, `guns`, `stable`, `bugs`, `clown`, `diehard`, `otca-off`, `otca-on`, `meta3x3`
  - `getPreset(id: string): Preset`, qui lève une erreur si l'id est inconnu
  - `buildGrid(presetId: string, size: number): Grid`, qui lève une `RangeError` (message contenant `minSize`) si `size < minSize`

- [ ] **Step 1 : Écrire le test qui échoue**

`web/test/presets.test.ts` :

```ts
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
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- presets`
Attendu : FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter**

`web/src/random.ts` :

```ts
// Seeded PRNG so "random" grids are identical across engines, runs and machines.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`web/src/patterns/presets.ts` :

```ts
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
```

> Note : `1 + j * 2048` correspond à `1 + j * (2058 - 10)` dans `life_draw_meta3x3`.

- [ ] **Step 4 : Lancer les tests**

Run : `npm test -- presets && npm run typecheck`
Attendu : 6 tests PASS. Le test « every preset » construit une grille 6208² pour `meta3x3`, ce qui prend environ 1 s : c'est normal.

- [ ] **Step 5 : Commit**

```bash
git add web/src/random.ts web/src/patterns/presets.ts web/test/presets.test.ts
git commit -m "feat(web): port easypap initial configurations as presets"
```

---

### Task 4 : Toolchain emcc et noyau séquentiel C → `wasm-seq`

**Files:**
- Create: `web/wasm/life.h`, `web/wasm/life.c`, `web/wasm/Makefile`, `web/wasm/EMSDK_VERSION`
- Create: `web/src/engines/wasm/life-module.d.ts`
- Create: `web/src/engines/wasm-seq-sim.ts`
- Create: `web/src/engine.ts` (type `CpuSim` seulement ; la Task 5 complète le fichier)
- Modify: `web/package.json` (scripts)
- Test: `web/test/wasm-seq-sim.test.ts`

**Interfaces:**
- Consumes : `Grid`, `createGrid`, `clearBorder`, `hashCells`, `liveCount` (Task 1) ; `buildGrid` (Task 3)
- Produces :
  - C : `int life_init(int dim)` (renvoie 0 si OK, -1 si l'allocation échoue), `uint8_t *life_cells(void)` (table courante ; le pointeur change à chaque génération), `void life_compute_seq(unsigned nb_iter)`, `void life_finalize(void)`
  - `web/src/engines/wasm/generated/life-seq.mjs` (généré, export par défaut = factory Emscripten)
  - `interface CpuSim { readonly size: number; cells(): Uint8Array; step(n: number): void; hash(): string; dispose(): void }` dans `web/src/engine.ts`
  - `class WasmSeqSim implements CpuSim` avec `static create(grid: Grid): Promise<WasmSeqSim>`

- [ ] **Step 1 : Vérifier qu'emcc est disponible**

Run : `emcc --version`
Si la commande est introuvable, **demander à Laurent** de lancer `brew install emscripten` (environ 10 min), puis relancer `emcc --version`.

Ensuite, figer la version utilisée par la CI :

```bash
emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 > web/wasm/EMSDK_VERSION
cat web/wasm/EMSDK_VERSION
```

Attendu : une version du type `4.0.x`.

- [ ] **Step 2 : Écrire le noyau C**

`web/wasm/life.h` :

```c
#ifndef LIFE_H
#define LIFE_H

#include <stdint.h>

int life_init (int dim);
uint8_t *life_cells (void);
void life_compute_seq (unsigned nb_iter);
void life_finalize (void);

#endif
```

`web/wasm/life.c` (repris de `life_compute_seq` / `compute_new_state` dans `easypap-se/kernel/c/life.c`, sans les macros easypap) :

```c
// Sequential kernel ported from easypap-se/kernel/c/life.c (2020).
// Only the easypap plumbing (DIM, monitoring, image refresh) is replaced;
// the update rule and the loop structure are the original ones.
#include <stdlib.h>
#include <emscripten/emscripten.h>

#include "life.h"

typedef uint8_t cell_t;

static int DIM = 0;
static cell_t *restrict _table = NULL, *restrict _alternate_table = NULL;

static inline cell_t *table_cell (cell_t *restrict i, int y, int x)
{
  return i + y * DIM + x;
}

#define cur_table(y, x) (*table_cell (_table, (y), (x)))
#define next_table(y, x) (*table_cell (_alternate_table, (y), (x)))

EMSCRIPTEN_KEEPALIVE void life_finalize (void)
{
  free (_table);
  free (_alternate_table);
  _table = _alternate_table = NULL;
  DIM = 0;
}

EMSCRIPTEN_KEEPALIVE int life_init (int dim)
{
  life_finalize ();
  const size_t size = (size_t)dim * dim * sizeof (cell_t);
  // calloc keeps the border ring dead in both tables forever: the kernel never writes it.
  _table = calloc (1, size);
  _alternate_table = calloc (1, size);
  if (_table == NULL || _alternate_table == NULL) {
    life_finalize ();
    return -1;
  }
  DIM = dim;
  return 0;
}

EMSCRIPTEN_KEEPALIVE cell_t *life_cells (void)
{
  return _table;
}

static inline void swap_tables (void)
{
  cell_t *tmp = _table;
  _table = _alternate_table;
  _alternate_table = tmp;
}

static void compute_new_state (int y, int x)
{
  unsigned n  = 0;
  unsigned me = cur_table (y, x) != 0;

  for (int i = y - 1; i <= y + 1; i++)
    for (int j = x - 1; j <= x + 1; j++)
      n += cur_table (i, j);

  n = (n == 3 + me) | (n == 3);
  next_table (y, x) = n;
}

// Unlike the 2020 version, no early exit on a stable grid: benchmarks need
// every requested generation to be computed.
EMSCRIPTEN_KEEPALIVE void life_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {
    for (int i = 1; i < DIM - 1; i++)
      for (int j = 1; j < DIM - 1; j++)
        compute_new_state (i, j);
    swap_tables ();
  }
}
```

`web/wasm/Makefile` :

```make
EMCC   ?= emcc
OUT    := ../src/engines/wasm/generated
# SINGLE_FILE embeds the .wasm so the same module loads in Vite, workers and Node tests.
COMMON := -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 \
          -sENVIRONMENT=web,worker,node \
          -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB \
          -sEXPORTED_RUNTIME_METHODS=HEAPU8

SEQ_EXPORTS := _life_init,_life_cells,_life_compute_seq,_life_finalize

all: $(OUT)/life-seq.mjs

$(OUT)/life-seq.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -sEXPORTED_FUNCTIONS=$(SEQ_EXPORTS) life.c -o $@

$(OUT):
	mkdir -p $@

clean:
	rm -rf $(OUT)

.PHONY: all clean
```

(Les lignes de recette du Makefile commencent par une **tabulation**.)

Modifier les scripts de `web/package.json` :

```json
  "scripts": {
    "wasm": "make -C wasm",
    "dev": "npm run wasm && vite",
    "build": "npm run wasm && tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "npm run wasm && vitest run"
  }
```

Run : `npm run wasm`
Attendu : `src/engines/wasm/generated/life-seq.mjs` est créé, sans warning.

- [ ] **Step 3 : Déclarer les types du module généré**

`web/src/engines/wasm/life-module.d.ts` :

```ts
declare module '*/life-seq.mjs' {
  interface LifeSeqModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_seq(nbIter: number): void;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeSeqModule>;
  export default factory;
}
```

`web/src/engine.ts` (première version, complétée en Task 5) :

```ts
// A CPU simulation running in the current thread (inside a worker in the app).
export interface CpuSim {
  readonly size: number;
  cells(): Uint8Array;
  step(n: number): void;
  hash(): string;
  dispose(): void;
}
```

- [ ] **Step 4 : Écrire le test qui échoue**

`web/test/wasm-seq-sim.test.ts` :

```ts
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
```

- [ ] **Step 5 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- wasm-seq`
Attendu : FAIL, `Cannot find module '../src/engines/wasm-seq-sim'`.

- [ ] **Step 6 : Implémenter**

`web/src/engines/wasm-seq-sim.ts` :

```ts
import type { CpuSim } from '../engine';
import { clearBorder, hashCells, type Grid } from '../grid';
import createLifeSeq from './wasm/generated/life-seq.mjs';

type LifeSeqModule = Awaited<ReturnType<typeof createLifeSeq>>;

export class WasmSeqSim implements CpuSim {
  private constructor(
    private readonly mod: LifeSeqModule,
    readonly size: number,
  ) {}

  static async create(grid: Grid): Promise<WasmSeqSim> {
    const mod = await createLifeSeq();
    if (mod._life_init(grid.size) !== 0) {
      throw new Error(`wasm-seq: cannot allocate a ${grid.size}×${grid.size} grid`);
    }
    const sim = new WasmSeqSim(mod, grid.size);
    const view = sim.cells();
    view.set(grid.cells);
    clearBorder(view, grid.size);
    return sim;
  }

  // Re-read pointer and HEAPU8 every call: tables swap each generation and memory may grow.
  cells(): Uint8Array {
    const ptr = this.mod._life_cells();
    return this.mod.HEAPU8.subarray(ptr, ptr + this.size * this.size);
  }

  step(n: number): void {
    this.mod._life_compute_seq(n);
  }

  hash(): string {
    return hashCells(this.cells());
  }

  dispose(): void {
    this.mod._life_finalize();
  }
}
```

- [ ] **Step 7 : Lancer tous les tests**

Run : `npm test && npm run typecheck`
Attendu : tous PASS, dont les 5 tests `wasm-seq`.
Si `diehard` échoue à 129 ou 130, vérifier d'abord le placement (`g.size >> 1` pour x et y) et ne pas toucher à la règle C.

- [ ] **Step 8 : Commit**

```bash
git add web/wasm web/src/engine.ts web/src/engines/wasm/life-module.d.ts web/src/engines/wasm-seq-sim.ts web/test/wasm-seq-sim.test.ts web/package.json
git commit -m "feat(web): compile the original sequential C kernel to WASM"
```

---

### Task 5 : Interface `Engine`, RPC worker et moteur `wasm-seq`

**Files:**
- Modify: `web/src/engine.ts`
- Create: `web/src/engines/worker-rpc.ts`, `web/src/engines/sim-handler.ts`, `web/src/engines/cpu-worker-engine.ts`, `web/src/engines/wasm-seq.worker.ts`, `web/src/engines/registry.ts`
- Test: `web/test/cpu-worker-engine.test.ts`

**Interfaces:**
- Consumes : `CpuSim` (Task 4), `WasmSeqSim` (Task 4), `Grid`, `hashCells`, `createGrid` (Task 1)
- Produces :
  - `type FrameSource = { kind: 'cpu'; size: number; cells: Uint8Array } | { kind: 'gpu'; size: number; buffer: GPUBuffer }`
  - `interface Engine { readonly id: string; init(grid: Grid): Promise<void>; step(n: number): Promise<void>; frame(): Promise<FrameSource>; hash(): Promise<string>; dispose(): void }`. Le champ optionnel `trace` de la spec arrive au jalon 6. `frame()` est async parce que les moteurs CPU tournent dans un worker.
  - `interface WorkerLike { postMessage(message: unknown, transfer: Transferable[]): void; onmessage: ((ev: MessageEvent) => void) | null; onerror: ((ev: ErrorEvent) => void) | null; terminate(): void }`
  - `class WorkerRpc { constructor(worker: WorkerLike); call<T>(request: object, transfer?: Transferable[]): Promise<T>; terminate(): void }`
  - `type SimRequest`, `type SimReply`, `createSimHandler(createSim: (grid: Grid) => Promise<CpuSim>): (req: SimRequest) => Promise<SimReply>`, `serveSimInWorker(createSim)`
  - `class CpuWorkerEngine implements Engine { constructor(id: string, worker: WorkerLike) }`
  - `interface EngineInfo { id: string; label: string; create(): Engine }`, `ENGINES: readonly EngineInfo[]`, `getEngine(id: string): EngineInfo`

- [ ] **Step 1 : Écrire le test qui échoue**

`web/test/cpu-worker-engine.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createGrid, hashCells } from '../src/grid';
import { CpuWorkerEngine } from '../src/engines/cpu-worker-engine';
import { createSimHandler, type SimReply, type SimRequest } from '../src/engines/sim-handler';
import { WasmSeqSim } from '../src/engines/wasm-seq-sim';
import { WorkerRpc, type WorkerLike } from '../src/engines/worker-rpc';

// Runs the real worker-side handler in-process, asynchronously, like a Worker would.
class InProcessWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly handle: (req: SimRequest) => Promise<SimReply>) {}
  postMessage(message: unknown): void {
    void this.handle(message as SimRequest).then((reply) =>
      this.onmessage?.({ data: reply } as MessageEvent),
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

class SilentWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

const wasmSeqWorker = () => new InProcessWorker(createSimHandler((g) => WasmSeqSim.create(g)));

describe('CpuWorkerEngine over wasm-seq', () => {
  it('runs generations and returns frames and hashes', async () => {
    const g = createGrid(12);
    for (const [x, y] of [[3, 2], [4, 3], [2, 4], [3, 4], [4, 4]]) g.cells[y * 12 + x] = 1;
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await engine.init(g);
    await engine.step(4);
    const frame = await engine.frame();
    expect(frame.kind).toBe('cpu');
    if (frame.kind !== 'cpu') return;
    expect(frame.size).toBe(12);
    expect(frame.cells[3 * 12 + 4]).toBe(1); // glider head moved from (3,2) to (4,3)
    expect(await engine.hash()).toBe(hashCells(frame.cells));
    engine.dispose();
  });

  it('returns frames as copies that do not alias engine memory', async () => {
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await engine.init(createGrid(8));
    const before = await engine.hash();
    const frame = await engine.frame();
    if (frame.kind === 'cpu') frame.cells.fill(1);
    expect(await engine.hash()).toBe(before);
    engine.dispose();
  });

  it('rejects step before init', async () => {
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await expect(engine.step(1)).rejects.toThrow(/before init/);
  });
});

describe('WorkerRpc', () => {
  it('rejects pending and later calls when the worker crashes', async () => {
    const worker = new SilentWorker();
    const rpc = new WorkerRpc(worker);
    const pending = rpc.call({ op: 'step', n: 1 });
    worker.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(pending).rejects.toThrow(/worker crashed: out of memory/);
    await expect(rpc.call({ op: 'hash' })).rejects.toThrow(/terminated/);
  });

  it('terminate rejects pending calls and is idempotent', async () => {
    const worker = new SilentWorker();
    const rpc = new WorkerRpc(worker);
    const pending = rpc.call({ op: 'hash' });
    rpc.terminate();
    rpc.terminate();
    await expect(pending).rejects.toThrow(/terminated/);
    expect(worker.terminated).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- cpu-worker-engine`
Attendu : FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter**

`web/src/engine.ts` (version complète, remplace celle de la Task 4) :

```ts
import type { Grid } from './grid';

export type FrameSource =
  | { kind: 'cpu'; size: number; cells: Uint8Array }
  | { kind: 'gpu'; size: number; buffer: GPUBuffer };

export interface Engine {
  readonly id: string;
  init(grid: Grid): Promise<void>;
  step(n: number): Promise<void>;
  frame(): Promise<FrameSource>;
  hash(): Promise<string>;
  dispose(): void;
}

// A CPU simulation running in the current thread (inside a worker in the app).
export interface CpuSim {
  readonly size: number;
  cells(): Uint8Array;
  step(n: number): void;
  hash(): string;
  dispose(): void;
}
```

`web/src/engines/worker-rpc.ts` :

```ts
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  terminate(): void;
}

type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export class WorkerRpc {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = (ev) => {
      const reply = ev.data as Reply;
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.value);
      else p.reject(new Error(reply.error));
    };
    worker.onerror = (ev) => {
      this.closed = true;
      this.failAll(new Error(`worker crashed: ${ev.message}`));
    };
  }

  call<T>(request: object, transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new Error('worker terminated'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.failAll(new Error('worker terminated'));
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
```

`web/src/engines/sim-handler.ts` :

```ts
import type { CpuSim } from '../engine';
import type { Grid } from '../grid';

export type SimRequest =
  | { id: number; op: 'init'; size: number; cells: Uint8Array }
  | { id: number; op: 'step'; n: number }
  | { id: number; op: 'frame' }
  | { id: number; op: 'hash' };

export type SimReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export function createSimHandler(
  createSim: (grid: Grid) => Promise<CpuSim>,
): (req: SimRequest) => Promise<SimReply> {
  let sim: CpuSim | null = null;
  const need = (): CpuSim => {
    if (!sim) throw new Error('engine used before init');
    return sim;
  };
  return async (req) => {
    try {
      switch (req.op) {
        case 'init':
          sim?.dispose();
          sim = null;
          sim = await createSim({ size: req.size, cells: req.cells });
          return { id: req.id, ok: true, value: null };
        case 'step':
          need().step(req.n);
          return { id: req.id, ok: true, value: null };
        case 'frame':
          return { id: req.id, ok: true, value: need().cells().slice() };
        case 'hash':
          return { id: req.id, ok: true, value: need().hash() };
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export function serveSimInWorker(createSim: (grid: Grid) => Promise<CpuSim>): void {
  const handle = createSimHandler(createSim);
  // Serialize requests so a step can never run while init is still awaiting the module.
  let queue: Promise<void> = Promise.resolve();
  self.onmessage = (ev: MessageEvent<SimRequest>) => {
    queue = queue.then(async () => {
      const reply = await handle(ev.data);
      const transfer = reply.ok && reply.value instanceof Uint8Array ? [reply.value.buffer as ArrayBuffer] : [];
      self.postMessage(reply, { transfer });
    });
  };
}
```

`web/src/engines/cpu-worker-engine.ts` :

```ts
import type { Engine, FrameSource } from '../engine';
import type { Grid } from '../grid';
import { WorkerRpc, type WorkerLike } from './worker-rpc';

export class CpuWorkerEngine implements Engine {
  private readonly rpc: WorkerRpc;
  private size = 0;

  constructor(
    readonly id: string,
    worker: WorkerLike,
  ) {
    this.rpc = new WorkerRpc(worker);
  }

  async init(grid: Grid): Promise<void> {
    this.size = grid.size;
    const cells = grid.cells.slice();
    await this.rpc.call({ op: 'init', size: grid.size, cells }, [cells.buffer as ArrayBuffer]);
  }

  async step(n: number): Promise<void> {
    await this.rpc.call({ op: 'step', n });
  }

  async frame(): Promise<FrameSource> {
    const cells = await this.rpc.call<Uint8Array>({ op: 'frame' });
    return { kind: 'cpu', size: this.size, cells };
  }

  hash(): Promise<string> {
    return this.rpc.call<string>({ op: 'hash' });
  }

  dispose(): void {
    this.rpc.terminate();
  }
}
```

`web/src/engines/wasm-seq.worker.ts` :

```ts
import { serveSimInWorker } from './sim-handler';
import { WasmSeqSim } from './wasm-seq-sim';

serveSimInWorker((grid) => WasmSeqSim.create(grid));
```

`web/src/engines/registry.ts` :

```ts
import type { Engine } from '../engine';
import { CpuWorkerEngine } from './cpu-worker-engine';

export interface EngineInfo {
  id: string;
  label: string;
  create(): Engine;
}

export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'wasm-seq',
    label: 'WASM seq — C 2020, reference',
    create: () =>
      new CpuWorkerEngine(
        'wasm-seq',
        new Worker(new URL('./wasm-seq.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
];

export function getEngine(id: string): EngineInfo {
  const e = ENGINES.find((q) => q.id === id);
  if (!e) throw new Error(`unknown engine "${id}"`);
  return e;
}
```

- [ ] **Step 4 : Lancer tous les tests**

Run : `npm test && npm run typecheck`
Attendu : tous PASS, dont 5 nouveaux tests.

- [ ] **Step 5 : Commit**

```bash
git add web/src/engine.ts web/src/engines web/test/cpu-worker-engine.test.ts
git commit -m "feat(web): run wasm-seq in a worker behind a small RPC"
```

---

### Task 6 : Init WebGPU, caméra et renderer

**Files:**
- Create: `web/src/render/gpu.ts`, `web/src/render/camera.ts`, `web/src/render/grid.wgsl`, `web/src/render/renderer.ts`
- Test: `web/test/gpu.test.ts`, `web/test/camera.test.ts`

**Interfaces:**
- Consumes : `FrameSource` (Task 5)
- Produces :
  - `type GpuInit = { ok: true; adapter: GPUAdapter; device: GPUDevice; label: string; timestamps: boolean } | { ok: false; reason: string }`
  - `initWebGPU(nav?: object): Promise<GpuInit>` (par défaut `navigator`)
  - `interface Camera { zoom: number; x: number; y: number }` : `zoom` = pixels CSS par cellule, `(x, y)` = coordonnée cellule du coin haut-gauche du canvas
  - `fitCamera(gridSize: number, width: number, height: number): Camera`
  - `zoomAt(cam: Camera, factor: number, px: number, py: number): Camera` (zoom borné entre 1/64 et 64)
  - `panBy(cam: Camera, dxPx: number, dyPx: number): Camera`
  - `screenToCell(cam: Camera, px: number, py: number): [number, number]`
  - `class GridRenderer { constructor(canvas: HTMLCanvasElement, device: GPUDevice); setFrame(frame: FrameSource): void; resize(): boolean; draw(cam: Camera): void; destroy(): void }`

- [ ] **Step 1 : Écrire les tests qui échouent**

`web/test/camera.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { fitCamera, panBy, screenToCell, zoomAt } from '../src/render/camera';

describe('camera', () => {
  it('fit centers the grid in the viewport', () => {
    const cam = fitCamera(100, 800, 400);
    expect(cam.zoom).toBe(4);
    expect(screenToCell(cam, 400, 200)).toEqual([50, 50]);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const cam = fitCamera(100, 800, 400);
    const before = { x: cam.x + 123 / cam.zoom, y: cam.y + 77 / cam.zoom };
    const z = zoomAt(cam, 2, 123, 77);
    expect(z.zoom).toBe(8);
    expect(z.x + 123 / z.zoom).toBeCloseTo(before.x);
    expect(z.y + 77 / z.zoom).toBeCloseTo(before.y);
  });

  it('clamps zoom between 1/64 and 64', () => {
    const cam = fitCamera(100, 800, 400);
    expect(zoomAt(cam, 1e6, 0, 0).zoom).toBe(64);
    expect(zoomAt(cam, 1e-6, 0, 0).zoom).toBe(1 / 64);
  });

  it('panBy moves the view opposite to the drag', () => {
    const cam = fitCamera(100, 800, 400);
    expect(panBy(cam, 40, -8)).toEqual({ zoom: 4, x: cam.x - 10, y: cam.y + 2 });
  });
});
```

`web/test/gpu.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { initWebGPU } from '../src/render/gpu';

const fakeAdapter = (requestDevice: () => Promise<unknown>) => ({
  features: new Set<string>(),
  limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 28 },
  info: { vendor: 'acme', architecture: 'rdna', description: '' },
  requestDevice,
});

describe('initWebGPU', () => {
  it('explains when the browser has no WebGPU', async () => {
    const r = await initWebGPU({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not support WebGPU/);
  });

  it('explains when no adapter is available', async () => {
    const r = await initWebGPU({ gpu: { requestAdapter: async () => null } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no GPU adapter/);
  });

  it('explains when device creation fails', async () => {
    const adapter = fakeAdapter(async () => {
      throw new Error('limits too high');
    });
    const r = await initWebGPU({ gpu: { requestAdapter: async () => adapter } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/limits too high/);
  });

  it('returns the device and a readable adapter label', async () => {
    const device = { lost: new Promise(() => {}) };
    const r = await initWebGPU({ gpu: { requestAdapter: async () => fakeAdapter(async () => device) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.device).toBe(device);
      expect(r.label).toBe('acme rdna');
      expect(r.timestamps).toBe(false);
    }
  });
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npm test -- camera gpu`
Attendu : FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter caméra et init GPU**

`web/src/render/camera.ts` :

```ts
export interface Camera {
  zoom: number; // CSS pixels per cell
  x: number; // cell coordinate at the canvas top-left corner
  y: number;
}

const MIN_ZOOM = 1 / 64;
const MAX_ZOOM = 64;

export function fitCamera(gridSize: number, width: number, height: number): Camera {
  const zoom = Math.min(width, height) / gridSize;
  return { zoom, x: -(width / zoom - gridSize) / 2, y: -(height / zoom - gridSize) / 2 };
}

export function zoomAt(cam: Camera, factor: number, px: number, py: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const cx = cam.x + px / cam.zoom;
  const cy = cam.y + py / cam.zoom;
  return { zoom, x: cx - px / zoom, y: cy - py / zoom };
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { zoom: cam.zoom, x: cam.x - dxPx / cam.zoom, y: cam.y - dyPx / cam.zoom };
}

export function screenToCell(cam: Camera, px: number, py: number): [number, number] {
  return [Math.floor(cam.x + px / cam.zoom), Math.floor(cam.y + py / cam.zoom)];
}
```

`web/src/render/gpu.ts` :

```ts
export type GpuInit =
  | { ok: true; adapter: GPUAdapter; device: GPUDevice; label: string; timestamps: boolean }
  | { ok: false; reason: string };

export async function initWebGPU(nav: object = navigator): Promise<GpuInit> {
  const gpu = (nav as { gpu?: GPU }).gpu;
  if (!gpu) {
    return {
      ok: false,
      reason: 'This browser does not support WebGPU. Use a recent desktop Chrome or Edge, or Safari 26+.',
    };
  }
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return {
      ok: false,
      reason: 'WebGPU is enabled but no GPU adapter is available (hardware acceleration off or GPU blocklisted).',
    };
  }
  const timestamps = adapter.features.has('timestamp-query');
  try {
    const device = await adapter.requestDevice({
      requiredFeatures: timestamps ? ['timestamp-query'] : [],
      // Large grids need the adapter's real limits, not the WebGPU defaults.
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const { vendor, architecture, description } = adapter.info;
    const label = description || [vendor, architecture].filter(Boolean).join(' ') || 'unknown GPU';
    return { ok: true, adapter, device, label, timestamps };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not create a WebGPU device: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

- [ ] **Step 4 : Lancer les tests**

Run : `npm test -- camera gpu && npm run typecheck`
Attendu : 8 tests PASS.

- [ ] **Step 5 : Implémenter le renderer** (pas de test unitaire : il est vérifié dans le navigateur en Task 9)

`web/src/render/grid.wgsl` :

```wgsl
struct View {
  gridSize: u32,
  cellFormat: u32, // 0 = packed u8 (CPU engines), 1 = u32 (GPU engines)
  zoom: f32,       // device pixels per cell
  _pad0: f32,
  origin: vec2f,   // cell coordinate at the top-left device pixel
  _pad1: vec2f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> cells: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn alive(idx: u32) -> bool {
  if (view.cellFormat == 0u) {
    let word = cells[idx >> 2u];
    return ((word >> ((idx & 3u) * 8u)) & 0xffu) != 0u;
  }
  return cells[idx] != 0u;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = floor(view.origin + pos.xy / view.zoom);
  let n = f32(view.gridSize);
  if (c.x < 0.0 || c.y < 0.0 || c.x >= n || c.y >= n) {
    return vec4f(0.04, 0.04, 0.06, 1.0);
  }
  if (alive(u32(c.y) * view.gridSize + u32(c.x))) {
    return vec4f(1.0, 1.0, 0.0, 1.0); // easypap's yellow
  }
  return vec4f(0.12, 0.12, 0.15, 1.0);
}
```

`web/src/render/renderer.ts` :

```ts
import type { FrameSource } from '../engine';
import type { Camera } from './camera';
import shaderCode from './grid.wgsl?raw';

const UNIFORM_BYTES = 32;

export class GridRenderer {
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly uniformData = new ArrayBuffer(UNIFORM_BYTES);
  private uploadBuffer: GPUBuffer | null = null;
  private boundBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private gridSize = 0;
  private cellFormat = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('canvas has no WebGPU context');
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniforms = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  setFrame(frame: FrameSource): void {
    if (frame.kind === 'gpu') {
      this.bind(frame.buffer, frame.size, 1);
      return;
    }
    // writeBuffer and storage bindings need a 4-byte multiple.
    const bytes = Math.ceil(frame.cells.byteLength / 4) * 4;
    if (!this.uploadBuffer || this.uploadBuffer.size !== bytes) {
      this.uploadBuffer?.destroy();
      this.uploadBuffer = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    const data = frame.cells.byteLength === bytes ? frame.cells : padTo(frame.cells, bytes);
    this.device.queue.writeBuffer(this.uploadBuffer, 0, data);
    this.bind(this.uploadBuffer, frame.size, 0);
  }

  // Returns true when the backing store changed and a redraw is needed.
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  draw(cam: Camera): void {
    if (!this.bindGroup) return;
    const dpr = window.devicePixelRatio || 1;
    const u32 = new Uint32Array(this.uniformData);
    const f32 = new Float32Array(this.uniformData);
    u32[0] = this.gridSize;
    u32[1] = this.cellFormat;
    f32[2] = cam.zoom * dpr;
    f32[4] = cam.x;
    f32[5] = cam.y;
    this.device.queue.writeBuffer(this.uniforms, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.uploadBuffer?.destroy();
    this.uniforms.destroy();
    this.context.unconfigure();
  }

  private bind(buffer: GPUBuffer, size: number, format: number): void {
    if (buffer !== this.boundBuffer) {
      this.boundBuffer = buffer;
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: { buffer } },
        ],
      });
    }
    this.gridSize = size;
    this.cellFormat = format;
  }
}

function padTo(src: Uint8Array, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(src);
  return out;
}
```

- [ ] **Step 6 : Typecheck**

Run : `npm run typecheck && npm test`
Attendu : aucune erreur, tous les tests PASS.

- [ ] **Step 7 : Commit**

```bash
git add web/src/render web/test/camera.test.ts web/test/gpu.test.ts
git commit -m "feat(web): WebGPU init, camera math and grid renderer"
```

---

### Task 7 : `LiveRunner`, calcul découplé de l'affichage

**Files:**
- Create: `web/src/live/runner.ts`
- Create: `web/test/fakes.ts`
- Test: `web/test/runner.test.ts`

**Interfaces:**
- Consumes : `Engine`, `FrameSource` (Task 5)
- Produces :
  - `interface LiveStats { generation: number; gensPerSec: number }`
  - `interface LiveCallbacks { onFrame(frame: FrameSource): void; onStats(stats: LiveStats): void; onError(error: unknown): void }`
  - `class LiveRunner { constructor(engine: Engine, cb: LiveCallbacks, opts?: { statsIntervalMs?: number }); readonly generation: number; readonly playing: boolean; play(): void; pause(): Promise<void>; step(): Promise<void>; requestFrame(): void }`
  - `web/test/fakes.ts` : `class FakeEngine implements Engine` (champs publics `generation`, `disposed`, `failAt`, `initDelayMs`, `size`)

- [ ] **Step 1 : Écrire le fake et le test qui échoue**

`web/test/fakes.ts` :

```ts
import type { Engine, FrameSource } from '../src/engine';
import type { Grid } from '../src/grid';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeEngine implements Engine {
  readonly id = 'fake';
  generation = 0;
  disposed = false;
  failAt = Infinity;
  initDelayMs = 0;
  initError: Error | null = null;
  size = 0;

  async init(grid: Grid): Promise<void> {
    if (this.initDelayMs) await sleep(this.initDelayMs);
    if (this.initError) throw this.initError;
    this.size = grid.size;
  }

  async step(n: number): Promise<void> {
    await Promise.resolve();
    if (this.generation + n > this.failAt) throw new Error('boom');
    this.generation += n;
  }

  async frame(): Promise<FrameSource> {
    return { kind: 'cpu', size: this.size, cells: new Uint8Array(this.size * this.size) };
  }

  async hash(): Promise<string> {
    return String(this.generation);
  }

  dispose(): void {
    this.disposed = true;
  }
}
```

`web/test/runner.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/grid';
import { LiveRunner } from '../src/live/runner';
import { FakeEngine, sleep } from './fakes';

async function setup(statsIntervalMs = 500) {
  const engine = new FakeEngine();
  await engine.init(createGrid(8));
  const cb = { onFrame: vi.fn(), onStats: vi.fn(), onError: vi.fn() };
  return { engine, cb, runner: new LiveRunner(engine, cb, { statsIntervalMs }) };
}

describe('LiveRunner', () => {
  it('counts exactly the generations the engine computed', async () => {
    const { engine, runner } = await setup();
    runner.play();
    await sleep(20);
    await runner.pause();
    expect(runner.generation).toBeGreaterThan(0);
    expect(runner.generation).toBe(engine.generation);
  });

  it('stops stepping once paused', async () => {
    const { engine, runner } = await setup();
    runner.play();
    await sleep(10);
    await runner.pause();
    const g = engine.generation;
    await sleep(10);
    expect(engine.generation).toBe(g);
    expect(runner.playing).toBe(false);
  });

  it('fetches one frame per requestFrame, not one per batch', async () => {
    const { cb, runner } = await setup();
    runner.play();
    await sleep(10);
    expect(cb.onFrame).toHaveBeenCalledTimes(1);
    runner.requestFrame();
    await sleep(10);
    expect(cb.onFrame).toHaveBeenCalledTimes(2);
    await runner.pause();
  });

  it('step() pauses, advances exactly one generation and emits a frame', async () => {
    const { engine, cb, runner } = await setup();
    runner.play();
    await sleep(5);
    await runner.pause();
    const g = runner.generation;
    cb.onFrame.mockClear();
    runner.play();
    await runner.step();
    expect(runner.playing).toBe(false);
    expect(engine.generation).toBe(runner.generation);
    expect(cb.onFrame).toHaveBeenCalled();
    expect(runner.generation).toBeGreaterThan(g);
    const g2 = runner.generation;
    await runner.step();
    expect(runner.generation).toBe(g2 + 1);
  });

  it('reports engine errors and stops playing', async () => {
    const { engine, cb, runner } = await setup();
    engine.failAt = 100;
    runner.play();
    await sleep(20);
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(runner.playing).toBe(false);
  });

  it('emits gens/s stats while playing', async () => {
    const { cb, runner } = await setup(1);
    runner.play();
    await sleep(20);
    await runner.pause();
    const stats = cb.onStats.mock.calls.at(-1)?.[0];
    expect(stats.generation).toBeGreaterThan(0);
    expect(stats.gensPerSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- runner`
Attendu : FAIL, `Cannot find module '../src/live/runner'`.

- [ ] **Step 3 : Implémenter**

`web/src/live/runner.ts` :

```ts
import type { Engine, FrameSource } from '../engine';

export interface LiveStats {
  generation: number;
  gensPerSec: number;
}

export interface LiveCallbacks {
  onFrame(frame: FrameSource): void;
  onStats(stats: LiveStats): void;
  onError(error: unknown): void;
}

// Batches are resized to last ~4-16 ms so pause and frame requests stay responsive.
const MIN_BATCH_MS = 4;
const MAX_BATCH_MS = 16;
const MAX_BATCH = 1 << 16;

export class LiveRunner {
  private _generation = 0;
  private running = false;
  private loop: Promise<void> | null = null;
  private frameWanted = true;
  private batch = 1;
  private readonly statsIntervalMs: number;

  constructor(
    private readonly engine: Engine,
    private readonly cb: LiveCallbacks,
    opts: { statsIntervalMs?: number } = {},
  ) {
    this.statsIntervalMs = opts.statsIntervalMs ?? 500;
  }

  get generation(): number {
    return this._generation;
  }

  get playing(): boolean {
    return this.running;
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async pause(): Promise<void> {
    this.running = false;
    await this.loop;
    this.loop = null;
  }

  async step(): Promise<void> {
    await this.pause();
    try {
      await this.engine.step(1);
      this._generation += 1;
      this.cb.onFrame(await this.engine.frame());
    } catch (err) {
      this.cb.onError(err);
    }
  }

  requestFrame(): void {
    this.frameWanted = true;
  }

  private async run(): Promise<void> {
    let windowStart = performance.now();
    let windowGens = 0;
    try {
      while (this.running) {
        const t0 = performance.now();
        await this.engine.step(this.batch);
        const dt = performance.now() - t0;
        this._generation += this.batch;
        windowGens += this.batch;
        if (dt < MIN_BATCH_MS) this.batch = Math.min(this.batch * 2, MAX_BATCH);
        else if (dt > MAX_BATCH_MS) this.batch = Math.max(1, this.batch >> 1);

        if (this.frameWanted) {
          this.frameWanted = false;
          this.cb.onFrame(await this.engine.frame());
        }

        const elapsed = performance.now() - windowStart;
        if (elapsed >= this.statsIntervalMs) {
          this.cb.onStats({ generation: this._generation, gensPerSec: (windowGens * 1000) / elapsed });
          windowStart = performance.now();
          windowGens = 0;
        }
      }
    } catch (err) {
      this.running = false;
      this.cb.onError(err);
    }
  }
}
```

- [ ] **Step 4 : Lancer les tests**

Run : `npm test -- runner && npm run typecheck`
Attendu : 6 tests PASS.

- [ ] **Step 5 : Commit**

```bash
git add web/src/live/runner.ts web/test/fakes.ts web/test/runner.test.ts
git commit -m "feat(web): live runner with adaptive batches and on-demand frames"
```

---

### Task 8 : `Session`, rechargement sûr de la configuration

**Files:**
- Create: `web/src/live/session.ts`
- Test: `web/test/session.test.ts`

**Interfaces:**
- Consumes : `Engine`, `FrameSource` (Task 5) ; `Grid` (Task 1) ; `LiveRunner`, `LiveStats` (Task 7) ; `FakeEngine` (Task 7)
- Produces :
  - `interface SessionConfig { engineId: string; presetId: string; size: number }`
  - `interface SessionDeps { createEngine(id: string): Engine; buildGrid(presetId: string, size: number): Grid; onFrame(frame: FrameSource): void; onStats(stats: LiveStats): void; onError(error: unknown): void }`
  - `class Session { constructor(deps: SessionDeps); readonly playing: boolean; load(config: SessionConfig): Promise<boolean>; play(): void; pause(): Promise<void>; step(): Promise<void>; requestFrame(): void; dispose(): Promise<void> }`

- [ ] **Step 1 : Écrire le test qui échoue**

`web/test/session.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import type { FrameSource } from '../src/engine';
import { createGrid } from '../src/grid';
import { Session } from '../src/live/session';
import { FakeEngine } from './fakes';

function setup(makeEngine: (id: string) => FakeEngine) {
  const created: FakeEngine[] = [];
  const frames: FrameSource[] = [];
  const onError = vi.fn();
  const session = new Session({
    createEngine: (id) => {
      const e = makeEngine(id);
      created.push(e);
      return e;
    },
    buildGrid: (_preset, size) => createGrid(size),
    onFrame: (f) => frames.push(f),
    onStats: () => {},
    onError,
  });
  return { session, created, frames, onError };
}

describe('Session', () => {
  it('builds the grid, inits the engine and emits its first frame', async () => {
    const { session, frames } = setup(() => new FakeEngine());
    expect(await session.load({ engineId: 'fake', presetId: 'random', size: 16 })).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].size).toBe(16);
  });

  it('lets the newest load win over a slower earlier one', async () => {
    const { session, created, frames } = setup((id) => {
      const e = new FakeEngine();
      if (id === 'slow') e.initDelayMs = 30;
      return e;
    });
    const first = session.load({ engineId: 'slow', presetId: 'random', size: 16 });
    const second = session.load({ engineId: 'fast', presetId: 'random', size: 32 });
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(created[0].disposed).toBe(true);
    expect(created[1].disposed).toBe(false);
    expect(frames.map((f) => f.size)).toEqual([32]);
  });

  it('disposes the previous engine on reload and stops its loop', async () => {
    const { session, created } = setup(() => new FakeEngine());
    await session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    session.play();
    await session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    expect(created[0].disposed).toBe(true);
    const g = created[0].generation;
    await new Promise((r) => setTimeout(r, 10));
    expect(created[0].generation).toBe(g);
    expect(session.playing).toBe(false);
  });

  it('reports init failures and keeps no engine', async () => {
    const { session, created, onError } = setup(() => {
      const e = new FakeEngine();
      e.initError = new Error('out of memory');
      return e;
    });
    expect(await session.load({ engineId: 'fake', presetId: 'random', size: 16 })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'out of memory' }));
    expect(created[0].disposed).toBe(true);
    session.play();
    expect(session.playing).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run : `npm test -- session`
Attendu : FAIL, `Cannot find module '../src/live/session'`.

- [ ] **Step 3 : Implémenter**

`web/src/live/session.ts` :

```ts
import type { Engine, FrameSource } from '../engine';
import type { Grid } from '../grid';
import { LiveRunner, type LiveStats } from './runner';

export interface SessionConfig {
  engineId: string;
  presetId: string;
  size: number;
}

export interface SessionDeps {
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
  onFrame(frame: FrameSource): void;
  onStats(stats: LiveStats): void;
  onError(error: unknown): void;
}

export class Session {
  private engine: Engine | null = null;
  private runner: LiveRunner | null = null;
  // Incremented by every load so a slower, older load can detect it was superseded.
  private token = 0;

  constructor(private readonly deps: SessionDeps) {}

  get playing(): boolean {
    return this.runner?.playing ?? false;
  }

  async load(config: SessionConfig): Promise<boolean> {
    const token = ++this.token;
    await this.teardown();
    let engine: Engine | null = null;
    try {
      const grid = this.deps.buildGrid(config.presetId, config.size);
      engine = this.deps.createEngine(config.engineId);
      await engine.init(grid);
      if (token !== this.token) {
        engine.dispose();
        return false;
      }
      const first = await engine.frame();
      if (token !== this.token) {
        engine.dispose();
        return false;
      }
      this.engine = engine;
      this.runner = new LiveRunner(engine, {
        onFrame: (f) => this.deps.onFrame(f),
        onStats: (s) => this.deps.onStats(s),
        onError: (e) => this.deps.onError(e),
      });
      this.deps.onFrame(first);
      return true;
    } catch (err) {
      engine?.dispose();
      if (token === this.token) this.deps.onError(err);
      return false;
    }
  }

  play(): void {
    this.runner?.play();
  }

  pause(): Promise<void> {
    return this.runner?.pause() ?? Promise.resolve();
  }

  step(): Promise<void> {
    return this.runner?.step() ?? Promise.resolve();
  }

  requestFrame(): void {
    this.runner?.requestFrame();
  }

  async dispose(): Promise<void> {
    this.token++;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const runner = this.runner;
    const engine = this.engine;
    this.runner = null;
    this.engine = null;
    await runner?.pause();
    engine?.dispose();
  }
}
```

- [ ] **Step 4 : Lancer les tests**

Run : `npm test && npm run typecheck`
Attendu : tous PASS, dont 4 tests `session`.

- [ ] **Step 5 : Commit**

```bash
git add web/src/live/session.ts web/test/session.test.ts
git commit -m "feat(web): session that safely reloads engine, size and pattern"
```

---

### Task 9 : UI (page, panneau, viewport) et vérification dans le navigateur

**Files:**
- Create: `web/index.html`, `web/src/style.css`, `web/src/main.ts`, `web/src/ui/panel.ts`, `web/src/ui/viewport.ts`

**Interfaces:**
- Consumes : tout ce qui précède (`initWebGPU`, `GridRenderer`, `fitCamera`, `zoomAt`, `panBy`, `Camera`, `Session`, `SessionConfig`, `LiveStats`, `ENGINES`, `getEngine`, `EngineInfo`, `PRESETS`, `Preset`, `buildGrid`)
- Produces : `createPanel(root, opts): PanelHandle`, `attachViewport(canvas, view)`. Rien d'autre n'en dépend dans ce jalon.

- [ ] **Step 1 : Page et styles**

`web/index.html` :

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Game of Life 2020 → 2026</title>
  </head>
  <body>
    <main class="app">
      <canvas id="grid"></canvas>
      <aside id="panel"></aside>
    </main>
    <div id="fatal" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css` :

```css
:root {
  color-scheme: dark;
  --bg: #0a0a0f;
  --panel: #15151c;
  --text: #e6e6ea;
  --muted: #8a8a96;
  --accent: #ffd400;
  --error: #ff6b6b;
  font-family: system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
.app { display: grid; grid-template-columns: 1fr 300px; height: 100vh; }
#grid { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
#grid:active { cursor: grabbing; }
#panel { background: var(--panel); padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
#panel h1 { font-size: 1.1rem; margin: 0; }
#panel h1 small { color: var(--accent); }
#panel label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
#panel select, #panel button {
  font: inherit; padding: 6px 8px; background: #22222c; color: var(--text);
  border: 1px solid #33333f; border-radius: 6px;
}
#panel button { cursor: pointer; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.stats { font-variant-numeric: tabular-nums; margin: 0; }
.error { color: var(--error); margin: 0; }
.machine, .hint { color: var(--muted); font-size: 0.8rem; margin: 0; }
#fatal {
  position: fixed; inset: 0; display: grid; place-items: center; padding: 16px;
  background: var(--bg); text-align: center; font-size: 1.1rem;
}
#fatal[hidden] { display: none; }
@media (max-width: 700px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 60vh auto; height: auto; }
}
```

- [ ] **Step 2 : Panneau**

`web/src/ui/panel.ts` :

```ts
import type { EngineInfo } from '../engines/registry';
import type { LiveStats } from '../live/runner';
import type { SessionConfig } from '../live/session';
import type { Preset } from '../patterns/presets';

export interface PanelOptions {
  engines: readonly EngineInfo[];
  presets: readonly Preset[];
  sizes: readonly number[];
  machine: string;
  initial: SessionConfig;
  onConfigChange(config: SessionConfig): void;
  onPlayPause(): void;
  onStep(): void;
  onFit(): void;
}

export interface PanelHandle {
  config(): SessionConfig;
  setPlaying(playing: boolean): void;
  setStats(stats: LiveStats, size: number): void;
  setError(message: string | null): void;
}

export function createPanel(root: HTMLElement, opts: PanelOptions): PanelHandle {
  root.innerHTML = `
    <h1>Game of Life <small>2020 → 2026</small></h1>
    <label>Engine <select id="engine"></select></label>
    <label>Size <select id="size"></select></label>
    <label>Pattern <select id="preset"></select></label>
    <div class="buttons">
      <button id="play">Play</button>
      <button id="step">Step</button>
      <button id="reset">Reset</button>
      <button id="fit">Fit</button>
    </div>
    <p id="stats" class="stats">gen 0</p>
    <p id="error" class="error" hidden></p>
    <p id="machine" class="machine"></p>
    <p class="hint">Wheel: zoom · drag: pan · double-click: fit</p>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const engine = $<HTMLSelectElement>('#engine');
  const size = $<HTMLSelectElement>('#size');
  const preset = $<HTMLSelectElement>('#preset');

  for (const e of opts.engines) engine.add(new Option(e.label, e.id));
  for (const s of opts.sizes) size.add(new Option(`${s} × ${s}`, String(s)));
  for (const p of opts.presets) preset.add(new Option(p.label, p.id));
  engine.value = opts.initial.engineId;
  size.value = String(opts.initial.size);
  preset.value = opts.initial.presetId;
  $('#machine').textContent = opts.machine;

  const config = (): SessionConfig => ({
    engineId: engine.value,
    presetId: preset.value,
    size: Number(size.value),
  });

  // Presets larger than the grid are shown but disabled, with the size they need.
  const syncPresets = () => {
    const n = Number(size.value);
    for (const o of preset.options) {
      const p = opts.presets.find((q) => q.id === o.value)!;
      o.disabled = p.minSize > n;
      o.textContent = o.disabled ? `${p.label} (needs ≥ ${p.minSize})` : p.label;
    }
    if (preset.selectedOptions[0]?.disabled) preset.value = 'random';
  };
  syncPresets();

  const changed = () => {
    syncPresets();
    opts.onConfigChange(config());
  };
  engine.onchange = changed;
  size.onchange = changed;
  preset.onchange = changed;
  $('#play').onclick = () => opts.onPlayPause();
  $('#step').onclick = () => opts.onStep();
  $('#reset').onclick = () => opts.onConfigChange(config());
  $('#fit').onclick = () => opts.onFit();

  return {
    config,
    setPlaying: (playing) => {
      $('#play').textContent = playing ? 'Pause' : 'Play';
    },
    setStats: (s, n) => {
      const gcells = (s.gensPerSec * n * n) / 1e9;
      $('#stats').textContent =
        `gen ${s.generation.toLocaleString('en')} · ${s.gensPerSec.toFixed(0)} gens/s · ${gcells.toFixed(2)} Gcells/s`;
    },
    setError: (message) => {
      const el = $('#error');
      el.hidden = message === null;
      el.textContent = message ?? '';
    },
  };
}
```

- [ ] **Step 3 : Viewport (zoom/pan)**

`web/src/ui/viewport.ts` :

```ts
import { panBy, zoomAt, type Camera } from '../render/camera';

export interface ViewportControl {
  get(): Camera | null;
  set(cam: Camera): void;
  fit(): void;
}

export function attachViewport(canvas: HTMLCanvasElement, view: ViewportControl): void {
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const cam = view.get();
      if (!cam) return;
      const r = canvas.getBoundingClientRect();
      view.set(zoomAt(cam, Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top));
    },
    { passive: false },
  );

  let last: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    last = { x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!last) return;
    const cam = view.get();
    if (cam) view.set(panBy(cam, ev.clientX - last.x, ev.clientY - last.y));
    last = { x: ev.clientX, y: ev.clientY };
  });
  const end = () => {
    last = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => view.fit());
}
```

- [ ] **Step 4 : Point d'entrée**

`web/src/main.ts` :

```ts
import './style.css';
import { ENGINES, getEngine } from './engines/registry';
import { Session, type SessionConfig } from './live/session';
import { buildGrid, PRESETS } from './patterns/presets';
import { fitCamera, type Camera } from './render/camera';
import { initWebGPU } from './render/gpu';
import { GridRenderer } from './render/renderer';
import { createPanel } from './ui/panel';
import { attachViewport } from './ui/viewport';

const SIZES = [512, 1024, 2048, 4096];
const INITIAL: SessionConfig = { engineId: 'wasm-seq', presetId: 'random', size: 1024 };

function showFatal(message: string): void {
  const el = document.querySelector<HTMLElement>('#fatal')!;
  el.textContent = message;
  el.hidden = false;
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#grid')!;
  const gpu = await initWebGPU();
  if (!gpu.ok) {
    showFatal(gpu.reason);
    return;
  }
  void gpu.device.lost.then((info) => {
    if (info.reason !== 'destroyed') showFatal(`The GPU device was lost (${info.message}). Reload the page.`);
  });

  const renderer = new GridRenderer(canvas, gpu.device);
  let camera: Camera | null = null;
  let gridSize = 0;
  let dirty = true;
  const fit = () => {
    if (gridSize) camera = fitCamera(gridSize, canvas.clientWidth, canvas.clientHeight);
    dirty = true;
  };

  const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
    engines: ENGINES,
    presets: PRESETS,
    sizes: SIZES,
    machine: `${navigator.hardwareConcurrency} logical cores · ${gpu.label}`,
    initial: INITIAL,
    onConfigChange: (config) => void load(config),
    onPlayPause: () => {
      if (session.playing) void session.pause().then(() => panel.setPlaying(false));
      else {
        session.play();
        panel.setPlaying(true);
      }
    },
    onStep: () => void session.step().then(() => panel.setPlaying(false)),
    onFit: fit,
  });

  const session = new Session({
    createEngine: (id) => getEngine(id).create(),
    buildGrid,
    onFrame: (frame) => {
      renderer.setFrame(frame);
      if (frame.size !== gridSize) {
        gridSize = frame.size;
        fit();
      }
      dirty = true;
    },
    onStats: (s) => panel.setStats(s, gridSize),
    onError: (e) => {
      panel.setPlaying(false);
      panel.setError(e instanceof Error ? e.message : String(e));
    },
  });

  async function load(config: SessionConfig): Promise<void> {
    panel.setPlaying(false);
    panel.setError(null);
    panel.setStats({ generation: 0, gensPerSec: 0 }, config.size);
    await session.load(config);
  }

  attachViewport(canvas, {
    get: () => camera,
    set: (cam) => {
      camera = cam;
      dirty = true;
    },
    fit,
  });

  const tick = () => {
    session.requestFrame();
    if (renderer.resize()) dirty = true;
    if (dirty && camera) {
      renderer.draw(camera);
      dirty = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await load(panel.config());
}

void main();
```

- [ ] **Step 5 : Build et typecheck**

Run : `npm run build`
Attendu : `dist/` généré sans erreur. Vite émet un chunk worker séparé pour `wasm-seq.worker`.

- [ ] **Step 6 : Vérifier dans le navigateur**

Créer `.claude/launch.json` à la racine du repo (fichier local, à ne pas commiter) :

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "web-dev", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "web", "run", "dev"], "port": 5173 }
  ]
}
```

Démarrer avec `preview_start` (nom `web-dev`). Si le panneau de navigateur intégré n'a pas WebGPU (message « does not support WebGPU »), demander à Laurent d'ouvrir `http://localhost:5173` dans Chrome et de cocher la liste ci-dessous.

Checklist (chaque point doit être vrai) :
1. La grille aléatoire 1024² s'affiche en jaune sur fond sombre, centrée.
2. Play → la grille évolue, le compteur gens/s se met à jour environ toutes les 0,5 s. Pause → elle s'arrête.
3. Step → avance d'une génération, le bouton affiche « Play ».
4. Molette → zoom centré sur le curseur. Drag → pan. Double-clic → recadrage.
5. Taille 512 → « OTCA metapixel (off) » est grisé avec « (needs ≥ 2176) ». Taille 4096 + OTCA off → le motif s'affiche.
6. Changer 5 fois de suite le motif pendant la lecture → aucune erreur console, une seule grille affichée à la fin.
7. Redimensionner la fenêtre → la grille n'est pas étirée.

- [ ] **Step 7 : Commit**

```bash
git add web/index.html web/src/style.css web/src/main.ts web/src/ui
git commit -m "feat(web): live page with engine/size/pattern panel and zoom/pan"
```

---

### Task 10 : Déploiement GitHub Pages et README

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (ajout d'une section à la fin, rien de supprimé)

**Interfaces:**
- Consumes : `npm run typecheck`, `npm test`, `npm run build`, `web/wasm/EMSDK_VERSION`
- Produces : démo publique sur `https://laurentgenty.github.io/optimized-gameoflife/`

- [ ] **Step 1 : Workflow**

`.github/workflows/pages.yml` :

```yaml
name: Deploy web demo

on:
  push:
    branches: [master]
    paths: ['web/**', '.github/workflows/pages.yml']
  workflow_dispatch:

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - id: emsdk-version
        run: echo "version=$(cat wasm/EMSDK_VERSION)" >> "$GITHUB_OUTPUT"
      - uses: mymindstorm/setup-emsdk@v14
        with:
          version: ${{ steps.emsdk-version.outputs.version }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

(Si une de ces actions a une version majeure plus récente au moment de l'exécution, utiliser cette version.)

- [ ] **Step 2 : README**

Ajouter à la fin de `README.md`, sans rien supprimer :

```markdown

## Démo web (2026)

Le noyau C de 2020 compilé en WebAssembly, avec rendu WebGPU : https://laurentgenty.github.io/optimized-gameoflife/

Nécessite un navigateur avec WebGPU (Chrome/Edge récents, Safari 26+). Code dans `web/`.
```

- [ ] **Step 3 : Vérification finale locale**

Run (depuis `web/`) : `npm ci && npm run typecheck && npm test && npm run build`
Attendu : tout passe.

- [ ] **Step 4 : Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "ci: deploy the web demo to GitHub Pages"
```

- [ ] **Step 5 : Intégration — STOP, demander à Laurent**

Utiliser `superpowers:finishing-a-development-branch`. Avant chacune de ces actions, **demander un « oui » explicite à Laurent** :
1. Merger la branche dans `master` (Laurent autorise les commits directs sur `master` pour ce repo perso).
2. `git push origin master`.
3. Activer Pages en mode « GitHub Actions » : `gh api -X POST repos/LaurentGENTY/optimized-gameoflife/pages -f build_type=workflow`.

Ensuite, vérifier le run (`gh run list --workflow pages.yml --limit 1`) et ouvrir l'URL publique pour refaire les points 1, 2 et 4 de la checklist de la Task 9.
