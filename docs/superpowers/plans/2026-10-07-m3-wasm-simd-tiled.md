# Jalon 3 — C tuilé + lazy tiling + SIMD → `wasm-simd` : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un moteur `wasm-simd` mono-thread, compilé depuis `web/wasm/life.c`. Il découpe la grille en tuiles, ne recalcule que les tuiles dont un voisin a changé à l'itération précédente (lazy tiling de 2020), et calcule 16 cellules par instruction SIMD.

**Architecture :** un seul `life.c`, deux builds emcc. Le build `seq` est inchangé. Le build `simd` ajoute `-DLIFE_TILED -msimd128 -msse2` et exporte `life_compute_tiled`. Les intrinsics SSE2 (`_mm_add_epi8`, `_mm_cmpeq_epi8`…), dans l'esprit de l'AVX de 2020, sont traduites 1:1 en WASM SIMD128 par Emscripten. Côté TS, `WasmSeqSim` devient `WasmSim`, paramétré par le noyau (`seq` | `simd`).

**Tech Stack :** C + intrinsics SSE2, Emscripten (`-msimd128`), Vitest dans Node (WASM SIMD supporté), page `?selftest`.

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), jalon 3.

## Global Constraints

- Le calcul est en C : aucune règle du jeu de la vie en TypeScript.
- Bords morts : l'anneau extérieur n'est jamais écrit (comme `wasm-seq`). Le hash de `wasm-simd` doit être identique à celui de `wasm-seq`.
- 1 octet par cellule, calcul dans un worker, taille max 4096 (moteur CPU).
- Fidélité à 2020 : même règle (somme 3×3 incluant la cellule : 3 → vivante, 4 → inchangée), même idée de lazy tiling (deux tableaux de drapeaux par tuile échangés à chaque itération, comme `toSee` / `isUpdate`), tuiles de 32×32 (`-DTILE_SIZE=32`).
- **Écart assumé avec 2020, à documenter dans le README au jalon 7 :** dans `life_compute_omp_tiled`, `updateNextIter(y, x)` indexe `isUpdate[(ligne/TS)*NB_TILE + colonne/TS]`, alors que les tests de voisinage lisent `toCoord(x, y) = colonne*NB_TILE + ligne`. Les indices semblent transposés. Le portage utilise un indexage ligne-majeur cohérent, et l'arrêt anticipé `if (!changed)` est retiré (comme pour `seq`).
- Code, commentaires, commits en anglais. Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.

## Review Focus

1. **Activité qui entre dans une tuile endormie** (vaisseau qui traverse des tuiles stables) → la tuile se réveille à temps et le hash reste identique à `seq`. Tests : cas `bugs` et glider (Task 1).
2. **Taille dont l'intérieur n'est pas multiple de 32 ni de 16** (ex. 70, 100, 3) → tuiles et vecteurs du bord droit ou bas rognés, le reste en scalaire, aucune lecture hors ligne. Tests : Task 1.
3. **Tuile sautée** → ses deux tables sont identiques. Invariant prouvé par la conformité sur des centaines de générations.
4. **Le lazy tiling saute vraiment des tuiles** → un seul blinker en 256² recalcule au plus 9 tuiles par itération. Test : Task 1.
5. **Réinitialisation (`life_init` appelé deux fois) et `life_finalize`** → les drapeaux de tuiles sont libérés, puis réalloués à « tout calculer ». Deux simulations ne partagent pas d'état. Test : Task 1.

---

### Task 1 : noyau C tuilé + lazy + SIMD, build `simd`, `WasmSim`

**Files :**
- Modify : `web/wasm/life.c`, `web/wasm/life.h`, `web/wasm/Makefile`, `web/src/engines/wasm/life-module.d.ts`
- Rename : `web/src/engines/wasm-seq-sim.ts` → `web/src/engines/wasm-sim.ts` (classe `WasmSim`)
- Modify : `web/src/engines/wasm-seq.worker.ts`, `web/test/wasm-seq-sim.test.ts`, `web/test/cpu-worker-engine.test.ts` (nouvel import)
- Test : `web/test/wasm-simd.test.ts`

**Interfaces :**
- Produces :
  - C (build `simd` seulement) : `void life_compute_tiled (unsigned nb_iter)`, `int life_tiles_computed (void)` (tuiles recalculées à la dernière itération)
  - `type WasmKernel = 'seq' | 'simd'`
  - `class WasmSim implements CpuSim { static create(kernel: WasmKernel, grid: Grid): Promise<WasmSim>; tilesComputed(): number | null }` : `null` pour `seq`

- [ ] **Step 1 : Test qui échoue**

`web/test/wasm-simd.test.ts` :

```ts
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
```

Remplacer dans `web/test/wasm-seq-sim.test.ts` l'import par `import { WasmSim } from '../src/engines/wasm-sim';`, `WasmSeqSim.create(x)` par `WasmSim.create('seq', x)`, et les annotations `WasmSeqSim` par `WasmSim`. Faire de même dans `web/test/cpu-worker-engine.test.ts` (`createSimHandler((g) => WasmSim.create('seq', g))`).

Run : `npx vitest run wasm-simd` → Attendu : FAIL, `Cannot find module '../src/engines/wasm-sim'`.

- [ ] **Step 2 : Noyau C**

Dans `web/wasm/life.c` :

(a) `compute_new_state` renvoie maintenant s'il y a eu changement (le séquentiel ignore cette valeur) :

```c
static int compute_new_state (int y, int x)
{
  unsigned n  = 0;
  unsigned me = cur_table (y, x) != 0;

  for (int i = y - 1; i <= y + 1; i++)
    for (int j = x - 1; j <= x + 1; j++)
      n += cur_table (i, j);

  n = (n == 3 + me) | (n == 3);
  next_table (y, x) = n;
  return n != me;
}
```

(b) À la fin du fichier, la version tuilée :

```c
#ifdef LIFE_TILED
// Tiled + lazy + SIMD kernel, after life_compute_omp_tiled (2020) without OpenMP.
#include <emmintrin.h>
#include <string.h>

#ifndef TILE_SIZE
#define TILE_SIZE 32
#endif

static int nb_tiles = 0; // tiles per side, covering the interior [1, DIM-2]
static int tiles_computed = 0;
// Like toSee/isUpdate in 2020: which tiles changed at the previous / current iteration.
static unsigned char *tile_changed = NULL, *tile_changed_next = NULL;

static void tiles_reset (void)
{
  free (tile_changed);
  free (tile_changed_next);
  tile_changed = tile_changed_next = NULL;
  nb_tiles = 0;
  if (DIM < 3)
    return;
  nb_tiles = (DIM - 2 + TILE_SIZE - 1) / TILE_SIZE;
  tile_changed = malloc ((size_t)nb_tiles * nb_tiles);
  tile_changed_next = calloc ((size_t)nb_tiles * nb_tiles, 1);
  // Everything counts as changed so the first iteration computes every tile.
  memset (tile_changed, 1, (size_t)nb_tiles * nb_tiles);
}

static int tile_active (int tx, int ty)
{
  for (int j = ty - 1; j <= ty + 1; j++)
    for (int i = tx - 1; i <= tx + 1; i++)
      if (i >= 0 && j >= 0 && i < nb_tiles && j < nb_tiles && tile_changed[j * nb_tiles + i])
        return 1;
  return 0;
}

// 16 cells per SSE2 vector; Emscripten maps these intrinsics 1:1 to WASM SIMD128.
static int do_tile (int x0, int y0, int x1, int y1)
{
  const __m128i one = _mm_set1_epi8 (1), three = _mm_set1_epi8 (3), four = _mm_set1_epi8 (4);
  __m128i diff  = _mm_setzero_si128 ();
  int changed   = 0;

  for (int y = y0; y < y1; y++) {
    int x = x0;
    for (; x + 16 <= x1; x += 16) {
      __m128i n = _mm_setzero_si128 ();
      for (int i = y - 1; i <= y + 1; i++) {
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x - 1)));
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x)));
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x + 1)));
      }
      const __m128i me = _mm_loadu_si128 ((const __m128i *)table_cell (_table, y, x));
      // Same rule as compute_new_state on the 3x3 sum: 3 → alive, 4 → keep current state.
      const __m128i alive = _mm_or_si128 (
          _mm_cmpeq_epi8 (n, three),
          _mm_and_si128 (_mm_cmpeq_epi8 (n, four), _mm_cmpeq_epi8 (me, one)));
      const __m128i next = _mm_and_si128 (alive, one);
      _mm_storeu_si128 ((__m128i *)table_cell (_alternate_table, y, x), next);
      diff = _mm_or_si128 (diff, _mm_xor_si128 (next, me));
    }
    for (; x < x1; x++)
      changed |= compute_new_state (y, x);
  }
  return changed || _mm_movemask_epi8 (_mm_cmpeq_epi8 (diff, _mm_setzero_si128 ())) != 0xFFFF;
}

// A skipped tile is safe: none of its neighbours changed last iteration, so it did not
// change either and both tables already hold the same cells there.
EMSCRIPTEN_KEEPALIVE void life_compute_tiled (unsigned nb_iter)
{
  if (nb_tiles == 0 || tile_changed == NULL)
    tiles_reset ();

  for (unsigned it = 1; it <= nb_iter; it++) {
    tiles_computed = 0;
    for (int ty = 0; ty < nb_tiles; ty++)
      for (int tx = 0; tx < nb_tiles; tx++) {
        if (!tile_active (tx, ty))
          continue;
        const int x0 = 1 + tx * TILE_SIZE, y0 = 1 + ty * TILE_SIZE;
        const int x1 = x0 + TILE_SIZE < DIM - 1 ? x0 + TILE_SIZE : DIM - 1;
        const int y1 = y0 + TILE_SIZE < DIM - 1 ? y0 + TILE_SIZE : DIM - 1;
        tile_changed_next[ty * nb_tiles + tx] = do_tile (x0, y0, x1, y1);
        tiles_computed++;
      }
    swap_tables ();
    unsigned char *tmp = tile_changed;
    tile_changed       = tile_changed_next;
    tile_changed_next  = tmp;
    memset (tile_changed_next, 0, (size_t)nb_tiles * nb_tiles);
  }
}

EMSCRIPTEN_KEEPALIVE int life_tiles_computed (void)
{
  return tiles_computed;
}
#endif
```

(c) Dans `life_finalize`, après `DIM = 0;`, ajouter :

```c
#ifdef LIFE_TILED
  tiles_reset (); // DIM is 0 here, so this only frees the tile flags
#endif
```

Dans `life_init`, remplacer `DIM = dim; return 0;` par :

```c
  DIM = dim;
#ifdef LIFE_TILED
  tiles_reset ();
#endif
  return 0;
```

Cela demande une déclaration anticipée en haut du fichier, sous les `#define` :

```c
#ifdef LIFE_TILED
static void tiles_reset (void);
#endif
```

(d) `web/wasm/life.h` : ajouter

```c
void life_compute_tiled (unsigned nb_iter);
int life_tiles_computed (void);
```

- [ ] **Step 3 : Build**

`web/wasm/Makefile` : remplacer la cible `all` et ajouter la cible `simd` :

```make
SIMD_EXPORTS := $(SEQ_EXPORTS),_life_compute_tiled,_life_tiles_computed

all: $(OUT)/life-seq.mjs $(OUT)/life-simd.mjs

$(OUT)/life-simd.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -DLIFE_TILED -DTILE_SIZE=32 -msimd128 -msse2 -sEXPORTED_FUNCTIONS=$(SIMD_EXPORTS) life.c -o $@
```

Run : `npm run wasm` → Attendu : deux `.mjs`, aucun warning.

- [ ] **Step 4 : `WasmSim`**

`web/src/engines/wasm/life-module.d.ts` : ajouter

```ts
declare module '*/life-simd.mjs' {
  interface LifeSimdModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_seq(nbIter: number): void;
    _life_compute_tiled(nbIter: number): void;
    _life_tiles_computed(): number;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeSimdModule>;
  export default factory;
}
```

`git mv web/src/engines/wasm-seq-sim.ts web/src/engines/wasm-sim.ts`, puis remplacer son contenu :

```ts
import type { CpuSim } from '../engine';
import { clearBorder, hashCells, type Grid } from '../grid';

export type WasmKernel = 'seq' | 'simd';

interface LifeModule {
  HEAPU8: Uint8Array;
  _life_init(dim: number): number;
  _life_cells(): number;
  _life_finalize(): void;
}

interface Kernel {
  load(): Promise<LifeModule>;
  step(mod: LifeModule, n: number): void;
  tiles(mod: LifeModule): number | null;
}

const KERNELS: Record<WasmKernel, Kernel> = {
  seq: {
    load: async () => (await import('./wasm/generated/life-seq.mjs')).default(),
    step: (mod, n) => (mod as LifeModule & { _life_compute_seq(n: number): void })._life_compute_seq(n),
    tiles: () => null,
  },
  simd: {
    load: async () => (await import('./wasm/generated/life-simd.mjs')).default(),
    step: (mod, n) => (mod as LifeModule & { _life_compute_tiled(n: number): void })._life_compute_tiled(n),
    tiles: (mod) => (mod as LifeModule & { _life_tiles_computed(): number })._life_tiles_computed(),
  },
};

export class WasmSim implements CpuSim {
  private constructor(
    private readonly kernel: Kernel,
    private readonly mod: LifeModule,
    readonly size: number,
  ) {}

  static async create(kernel: WasmKernel, grid: Grid): Promise<WasmSim> {
    const k = KERNELS[kernel];
    const mod = await k.load();
    if (mod._life_init(grid.size) !== 0) {
      throw new Error(`wasm-${kernel}: cannot allocate a ${grid.size}×${grid.size} grid`);
    }
    const sim = new WasmSim(k, mod, grid.size);
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
    this.kernel.step(this.mod, n);
  }

  hash(): string {
    return hashCells(this.cells());
  }

  tilesComputed(): number | null {
    return this.kernel.tiles(this.mod);
  }

  dispose(): void {
    this.mod._life_finalize();
  }
}
```

`web/src/engines/wasm-seq.worker.ts` :

```ts
import { serveSimInWorker } from './sim-handler';
import { WasmSim } from './wasm-sim';

serveSimInWorker((grid) => WasmSim.create('seq', grid));
```

- [ ] **Step 5 : Tests**

Run : `npm test && npm run typecheck`
Attendu : tout PASS, dont 11 tests `wasm-simd`.
Si un cas de conformité échoue, chercher d'abord la frontière de tuile ou de vecteur fautive (tailles 70 / 100), puis le réveil des tuiles (glider). Ne pas toucher à la règle.

- [ ] **Step 6 : Commit**

```bash
git add web/wasm web/src/engines web/test
git commit -m "feat(web): tiled lazy SIMD C kernel compiled to WASM"
```

---

### Task 2 : moteur `wasm-simd` dans l'UI et le selftest

**Files :**
- Create : `web/src/engines/wasm-simd.worker.ts`
- Modify : `web/src/engines/registry.ts`

**Interfaces :**
- Consumes : `WasmSim.create('simd', …)` (Task 1), `CpuWorkerEngine`, `serveSimInWorker` (M1)
- Produces : l'entrée de registre `wasm-simd`

- [ ] **Step 1 : Worker + registre**

`web/src/engines/wasm-simd.worker.ts` :

```ts
import { serveSimInWorker } from './sim-handler';
import { WasmSim } from './wasm-sim';

serveSimInWorker((grid) => WasmSim.create('simd', grid));
```

Dans `ENGINES`, juste après `wasm-seq` :

```ts
  {
    id: 'wasm-simd',
    label: 'WASM SIMD — tiled + lazy, 1 thread',
    maxSize: () => CPU_MAX_SIZE,
    create: () =>
      new CpuWorkerEngine(
        'wasm-simd',
        new Worker(new URL('./wasm-simd.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
```

- [ ] **Step 2 : Vérifier dans le navigateur**

Run : `npm run typecheck && npm test && npm run build`, puis :
1. `?selftest` → 12 lignes (3 moteurs × 4 cas), toutes `pass`.
2. Live, 1024² random : `wasm-simd` nettement plus rapide que `wasm-seq`. En `guns` 1024² (motif clairsemé), l'écart doit être bien plus grand encore, grâce au lazy tiling.
3. Aucune erreur console.

- [ ] **Step 3 : Commit**

```bash
git add web/src/engines/wasm-simd.worker.ts web/src/engines/registry.ts
git commit -m "feat(web): wasm-simd engine in the UI and self-test"
```
