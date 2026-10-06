# Jalon 4 — WASM multithread (pthreads) + coi-serviceworker : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un moteur `wasm-mt`, le noyau tuilé + lazy + SIMD du jalon 3 réparti sur un pool de pthreads (l'équivalent navigateur de l'OpenMP de 2020). Il est disponible en local comme sur GitHub Pages grâce à l'isolation cross-origin, et grisé avec une explication quand elle manque.

**Architecture :** troisième build de `life.c` (`-DLIFE_TILED -DLIFE_THREADS -pthread`). Un pool persistant de N−1 pthreads, le thread appelant étant le n° 0, se synchronise par `pthread_barrier`. Les tuiles sont distribuées par un compteur atomique, l'équivalent de `schedule(dynamic)`. Le thread 0 échange les tables entre deux barrières. COOP/COEP sont fournis par les en-têtes du serveur Vite en local et par `coi-serviceworker` sur Pages.

**Tech Stack :** C + pthreads + C11 atomics, Emscripten (`-pthread`, `PTHREAD_POOL_SIZE`), Vitest dans Node (worker_threads), `coi-serviceworker` 0.1.7 (MIT).

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), jalon 4.

## Global Constraints

- Le calcul reste en C, et le hash de `wasm-mt` doit être identique à celui de `wasm-seq` quel que soit le nombre de threads.
- Sans cross-origin isolation (`crossOriginIsolated === false`), `wasm-mt` est grisé avec une explication. Aucune autre partie de l'app n'en dépend.
- Nombre de threads = `navigator.hardwareConcurrency` (pool Emscripten de la même taille), avec un plafond côté JS.
- Les tuiles de 32×32 et la règle sont partagées avec `wasm-simd` : une seule fonction de tuile, pas de duplication du noyau.
- Le build propre est sans instrumentation (le monitoring arrive au jalon 6).
- Code, commentaires, commits en anglais. Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.

## Review Focus

1. **Appels courts répétés** (runner : `step(1)` puis des lots de taille variable) → le pool est réutilisé, sans deadlock ni thread créé à chaque appel. Test : 50 × `step(1)` (Task 1).
2. **`dispose` puis nouvelle simulation** → les threads s'arrêtent proprement (join) et un nouveau pool démarre. Test : Task 1.
3. **1 thread** (machine à 1 cœur, ou plafond) → même chemin que `wasm-simd`, aucune barrière bloquante. Test : `threads: 1` (Task 1).
4. **Page servie sans COOP/COEP** → `wasm-mt` grisé avec son explication, les autres moteurs fonctionnent. Test : `engineUnavailable` (Task 2) + vérification manuelle.
5. **Course sur les drapeaux de tuiles** → chaque tuile n'est écrite que par le thread qui l'a prise, et l'échange se fait entre deux barrières. Prouvé par la conformité à 2 et 4 threads sur des centaines de générations.

---

### Task 1 : pool pthreads dans `life.c`, build `mt`, noyau `mt` dans `WasmSim`

**Files :**
- Modify : `web/wasm/life.c`, `web/wasm/life.h`, `web/wasm/Makefile`, `web/src/engines/wasm/life-module.d.ts`, `web/src/engines/wasm-sim.ts`
- Test : `web/test/wasm-mt.test.ts`

**Interfaces :**
- Produces :
  - C (build `mt`) : `int life_threads_start (int n)` (0 si OK, -1 sinon), `void life_compute_tiled_mt (unsigned nb_iter)`. `life_finalize` arrête le pool.
  - `type WasmKernel = 'seq' | 'simd' | 'mt'`
  - `WasmSim.create(kernel, grid, opts?: { threads?: number })` : pour `mt`, démarre `min(opts.threads ?? navigator.hardwareConcurrency, navigator.hardwareConcurrency)` threads
  - `WasmSim.threads(): number` (1 pour `seq` et `simd`)

- [ ] **Step 1 : Test qui échoue**

`web/test/wasm-mt.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSim } from '../src/engines/wasm-sim';

async function hashSeq(grid: Grid, gens: number): Promise<string> {
  const s = await WasmSim.create('seq', grid);
  s.step(gens);
  const h = s.hash();
  s.dispose();
  return h;
}

describe('wasm-mt (pthreads + tiled + lazy + SIMD) matches wasm-seq', () => {
  for (const threads of [1, 2, 4]) {
    for (const [preset, size, gens] of [
      ['random', 70, 60],
      ['random', 256, 200],
      ['guns', 256, 300],
      ['bugs', 256, 400],
    ] as Array<[string, number, number]>) {
      it(`${threads} thread(s): ${preset} ${size}² × ${gens}`, async () => {
        const grid = buildGrid(preset, size);
        const sim = await WasmSim.create('mt', grid, { threads });
        expect(sim.threads()).toBe(threads);
        sim.step(gens);
        expect(sim.hash()).toBe(await hashSeq(grid, gens));
        sim.dispose();
      });
    }
  }

  it('reuses the pool across many short calls', async () => {
    const grid = buildGrid('random', 256);
    const sim = await WasmSim.create('mt', grid, { threads: 4 });
    for (let i = 0; i < 50; i++) sim.step(1);
    sim.step(30);
    expect(sim.hash()).toBe(await hashSeq(grid, 80));
    sim.dispose();
  });

  it('stops the pool on dispose and starts a fresh one for the next simulation', async () => {
    const grid = buildGrid('random', 128);
    const a = await WasmSim.create('mt', grid, { threads: 3 });
    a.step(10);
    a.dispose();
    const b = await WasmSim.create('mt', grid, { threads: 2 });
    b.step(10);
    expect(b.hash()).toBe(await hashSeq(grid, 10));
    b.dispose();
  });

  it('still skips idle tiles: one blinker in 256² recomputes at most 9 tiles', async () => {
    const g = createGrid(256);
    for (const x of [100, 101, 102]) g.cells[100 * 256 + x] = 1;
    const sim = await WasmSim.create('mt', g, { threads: 4 });
    sim.step(4);
    expect(sim.tilesComputed()).toBeLessThanOrEqual(9);
    sim.dispose();
  });

  it('caps the thread count at hardwareConcurrency', async () => {
    const sim = await WasmSim.create('mt', createGrid(16), { threads: 10_000 });
    expect(sim.threads()).toBe(navigator.hardwareConcurrency);
    sim.dispose();
  });
});
```

Run : `npx vitest run wasm-mt` → Attendu : FAIL (le noyau `mt` n'existe pas).

- [ ] **Step 2 : `life.c`, refactor sans changement de comportement**

Dans la section `#ifdef LIFE_TILED`, extraire le corps de la boucle de tuiles de `life_compute_tiled` dans une fonction partagée par la version mono-thread et la version multithread. Placer ce code juste avant `life_compute_tiled` :

```c
// Computes tile (tx, ty) if a neighbour changed last iteration; returns 1 if computed.
static int process_tile (int tx, int ty)
{
  if (!tile_active (tx, ty))
    return 0;
  const int x0 = 1 + tx * TILE_SIZE, y0 = 1 + ty * TILE_SIZE;
  const int x1 = x0 + TILE_SIZE < DIM - 1 ? x0 + TILE_SIZE : DIM - 1;
  const int y1 = y0 + TILE_SIZE < DIM - 1 ? y0 + TILE_SIZE : DIM - 1;
  tile_changed_next[ty * nb_tiles + tx] = do_tile (x0, y0, x1, y1);
  return 1;
}

static void end_iteration (void)
{
  swap_tables ();
  unsigned char *tmp = tile_changed;
  tile_changed       = tile_changed_next;
  tile_changed_next  = tmp;
  memset (tile_changed_next, 0, (size_t)nb_tiles * nb_tiles);
}
```

et réécrire `life_compute_tiled` avec ces deux fonctions :

```c
EMSCRIPTEN_KEEPALIVE void life_compute_tiled (unsigned nb_iter)
{
  if (nb_tiles == 0 || tile_changed == NULL)
    tiles_reset ();

  for (unsigned it = 1; it <= nb_iter; it++) {
    tiles_computed = 0;
    for (int ty = 0; ty < nb_tiles; ty++)
      for (int tx = 0; tx < nb_tiles; tx++)
        tiles_computed += process_tile (tx, ty);
    end_iteration ();
  }
}
```

(Le commentaire « A skipped tile is safe… » reste au-dessus de `process_tile`.)

Run : `npm run wasm && npx vitest run wasm-simd` → Attendu : 11 PASS (refactor sans changement de comportement).

- [ ] **Step 3 : `life.c`, pool de threads**

Ajouter avant le `#endif` final de la section `LIFE_TILED` :

```c
#ifdef LIFE_THREADS
// OpenMP's role in 2020: a persistent pthread pool, caller is thread 0,
// tiles handed out by an atomic counter like schedule(dynamic).
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>

static int nb_threads = 1;
static pthread_t *workers = NULL;
static pthread_barrier_t barrier;
static atomic_int next_tile;
static atomic_int tiles_done;
static unsigned pending_iters = 0;
static int quitting = 0;

static void run_iterations (unsigned nb_iter, int self)
{
  const int total = nb_tiles * nb_tiles;
  for (unsigned it = 1; it <= nb_iter; it++) {
    for (int t = atomic_fetch_add (&next_tile, 1); t < total; t = atomic_fetch_add (&next_tile, 1))
      if (process_tile (t % nb_tiles, t / nb_tiles))
        atomic_fetch_add (&tiles_done, 1);
    pthread_barrier_wait (&barrier);
    if (self == 0) {
      tiles_computed = atomic_exchange (&tiles_done, 0);
      end_iteration ();
      atomic_store (&next_tile, 0);
    }
    pthread_barrier_wait (&barrier);
  }
}

static void *worker_main (void *arg)
{
  const int self = (int)(intptr_t)arg;
  for (;;) {
    pthread_barrier_wait (&barrier); // wait for work (or shutdown)
    if (quitting)
      return NULL;
    run_iterations (pending_iters, self);
  }
}

static void threads_stop (void)
{
  if (workers == NULL)
    return;
  quitting = 1;
  pthread_barrier_wait (&barrier);
  for (int i = 1; i < nb_threads; i++)
    pthread_join (workers[i], NULL);
  pthread_barrier_destroy (&barrier);
  free (workers);
  workers    = NULL;
  quitting   = 0;
  nb_threads = 1;
}

EMSCRIPTEN_KEEPALIVE int life_threads_start (int n)
{
  threads_stop ();
  if (n <= 1)
    return 0; // single thread: life_compute_tiled_mt falls back to life_compute_tiled
  workers = calloc ((size_t)n, sizeof (pthread_t));
  if (workers == NULL || pthread_barrier_init (&barrier, NULL, (unsigned)n) != 0) {
    free (workers);
    workers = NULL;
    return -1;
  }
  nb_threads = n;
  for (int i = 1; i < n; i++)
    if (pthread_create (&workers[i], NULL, worker_main, (void *)(intptr_t)i) != 0)
      return -1; // pool is sized to hardwareConcurrency, so this means a misconfiguration
  return 0;
}

EMSCRIPTEN_KEEPALIVE void life_compute_tiled_mt (unsigned nb_iter)
{
  if (nb_tiles == 0 || tile_changed == NULL)
    tiles_reset ();
  if (workers == NULL) {
    life_compute_tiled (nb_iter);
    return;
  }
  pending_iters = nb_iter;
  atomic_store (&next_tile, 0);
  atomic_store (&tiles_done, 0);
  pthread_barrier_wait (&barrier); // release the workers
  run_iterations (nb_iter, 0);
}
#endif
```

Arrêter le pool dans `life_finalize`, avant la libération des tables :

```c
EMSCRIPTEN_KEEPALIVE void life_finalize (void)
{
#ifdef LIFE_THREADS
  threads_stop ();
#endif
  free (_table);
  …
```

avec, en haut du fichier à côté de la déclaration de `tiles_reset` :

```c
#ifdef LIFE_THREADS
static void threads_stop (void);
#endif
```

`web/wasm/life.h` : ajouter `int life_threads_start (int n);` et `void life_compute_tiled_mt (unsigned nb_iter);`.

- [ ] **Step 4 : Build `mt`**

`web/wasm/Makefile` :

```make
MT_EXPORTS := $(SIMD_EXPORTS),_life_threads_start,_life_compute_tiled_mt

all: $(OUT)/life-seq.mjs $(OUT)/life-simd.mjs $(OUT)/life-mt.mjs

# The pool is created up front: a worker blocked in pthread_barrier_wait cannot spawn threads lazily.
$(OUT)/life-mt.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -DLIFE_TILED -DLIFE_THREADS -DTILE_SIZE=32 -msimd128 -msse2 -pthread \
	  -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
	  -sEXPORTED_FUNCTIONS=$(MT_EXPORTS) life.c -o $@
```

(Remplacer la ligne `all:` existante.) Run : `npm run wasm`. Attendu : `life-mt.mjs` est généré. Le warning Emscripten sur `-pthread` + `ALLOW_MEMORY_GROWTH` (accès JS à la mémoire plus lent) est accepté : `WasmSim.cells()` relit déjà `HEAPU8` à chaque appel.

- [ ] **Step 5 : `WasmSim`**

`web/src/engines/wasm/life-module.d.ts` : ajouter

```ts
declare module '*/life-mt.mjs' {
  interface LifeMtModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_tiled_mt(nbIter: number): void;
    _life_threads_start(n: number): number;
    _life_tiles_computed(): number;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeMtModule>;
  export default factory;
}
```

Dans `web/src/engines/wasm-sim.ts` :
- `export type WasmKernel = 'seq' | 'simd' | 'mt';`
- ajouter au `Kernel` deux champs optionnels : `start?(mod: LifeModule, threads: number): void` et `shared?: boolean`
- `shared: true` charge le module une seule fois par contexte JS, et `create` réutilise l'instance en cache. Un module `mt` précharge `hardwareConcurrency` workers : en instancier un par simulation multiplierait les threads (dans Node, une instance par test). Dans l'app, chaque moteur vit dans son propre Web Worker, donc son propre module. Contrepartie : deux simulations `mt` simultanées dans le même contexte JS partageraient leur état, ce qui ne se produit ni dans l'app ni dans les tests (simulations `mt` séquentielles, toujours `dispose` avant la suivante).

```ts
const loaded = new Map<WasmKernel, Promise<LifeModule>>();

function loadModule(kernel: WasmKernel): Promise<LifeModule> {
  const k = KERNELS[kernel];
  if (!k.shared) return k.load();
  let p = loaded.get(kernel);
  if (!p) {
    p = k.load();
    loaded.set(kernel, p);
  }
  return p;
}
```

  et, dans `create`, remplacer `const mod = await k.load();` par `const mod = await loadModule(kernel);`
- ajouter l'entrée :

```ts
  mt: {
    shared: true,
    load: async () => (await import('./wasm/generated/life-mt.mjs')).default(),
    step: (mod, n) => (mod as LifeModule & { _life_compute_tiled_mt(n: number): void })._life_compute_tiled_mt(n),
    tiles: (mod) => (mod as LifeModule & { _life_tiles_computed(): number })._life_tiles_computed(),
    start: (mod, threads) => {
      if ((mod as LifeModule & { _life_threads_start(n: number): number })._life_threads_start(threads) !== 0) {
        throw new Error(`wasm-mt: cannot start ${threads} threads`);
      }
    },
  },
```

- `create(kernel, grid, opts: { threads?: number } = {})`. Après le remplissage des cellules :

```ts
    if (k.start) {
      // The Emscripten pool holds hardwareConcurrency workers; never ask for more.
      const max = navigator.hardwareConcurrency;
      const threads = Math.max(1, Math.min(opts.threads ?? max, max));
      k.start(mod, threads);
      sim.nbThreads = threads;
    }
```

- un champ `private nbThreads = 1;` et `threads(): number { return this.nbThreads; }`.

- [ ] **Step 6 : Tests**

Run : `npm test && npm run typecheck`
Attendu : tout PASS, dont 16 tests `wasm-mt`. Un test bloqué au-delà de 5 s signale un deadlock de barrière : vérifier en premier que le nombre de `pthread_barrier_wait` par itération est identique pour tous les threads.

- [ ] **Step 7 : Commit**

```bash
git add web/wasm web/src/engines/wasm/life-module.d.ts web/src/engines/wasm-sim.ts web/test/wasm-mt.test.ts
git commit -m "feat(web): pthread pool for the tiled lazy SIMD kernel"
```

---

### Task 2 : isolation cross-origin, moteur `wasm-mt` dans l'UI

**Files :**
- Create : `web/public/coi-serviceworker.min.js` (copié depuis le paquet npm), `web/src/engines/wasm-mt.worker.ts`
- Modify : `web/vite.config.ts`, `web/index.html`, `web/src/engines/registry.ts`, `web/src/ui/panel.ts`, `web/src/main.ts`, `web/src/selftest/page.ts`
- Test : `web/test/registry.test.ts`

**Interfaces :**
- Consumes : `WasmSim.create('mt', …)` (Task 1)
- Produces :
  - `EngineInfo.unavailable?(): string | null` (raison lisible, ou `null` si disponible)
  - `engineUnavailable(info: EngineInfo): string | null`
  - `PanelOptions.unavailable(engineId: string): string | null`

- [ ] **Step 1 : Test qui échoue**

`web/test/registry.test.ts` :

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { engineUnavailable, getEngine } from '../src/engines/registry';

const original = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
afterEach(() => {
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = original;
});

describe('engine availability', () => {
  it('greys out wasm-mt without cross-origin isolation, with a reason', () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = false;
    expect(engineUnavailable(getEngine('wasm-mt'))).toMatch(/cross-origin isolation/);
  });

  it('offers wasm-mt when the page is cross-origin isolated', () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
    expect(engineUnavailable(getEngine('wasm-mt'))).toBeNull();
  });

  it('never greys out engines without an availability rule', () => {
    expect(engineUnavailable(getEngine('wasm-seq'))).toBeNull();
  });
});
```

Run : `npx vitest run registry` → Attendu : FAIL (`engineUnavailable` n'existe pas).

> `registry.ts` importe des `?raw` WGSL et crée des `Worker` seulement dans `create()` : l'import du module en Node est sans effet de bord.

- [ ] **Step 2 : Registre**

`web/src/engines/wasm-mt.worker.ts` :

```ts
import { serveSimInWorker } from './sim-handler';
import { WasmSim } from './wasm-sim';

serveSimInWorker((grid) => WasmSim.create('mt', grid));
```

Dans `web/src/engines/registry.ts` :
- ajouter à `EngineInfo` : `unavailable?(): string | null;`
- ajouter :

```ts
export function engineUnavailable(info: EngineInfo): string | null {
  return info.unavailable?.() ?? null;
}
```

- insérer après `wasm-simd` :

```ts
  {
    id: 'wasm-mt',
    label: `WASM threads — tiled + lazy + SIMD, ${typeof navigator === 'undefined' ? '' : navigator.hardwareConcurrency} threads`,
    maxSize: () => CPU_MAX_SIZE,
    unavailable: () =>
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
        ? null
        : 'Needs cross-origin isolation (SharedArrayBuffer). Reload once the service worker is installed.',
    create: () =>
      new CpuWorkerEngine(
        'wasm-mt',
        new Worker(new URL('./wasm-mt.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
```

Run : `npx vitest run registry` → Attendu : 3 PASS.

- [ ] **Step 3 : COOP/COEP**

`web/vite.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

// SharedArrayBuffer (WASM threads) needs cross-origin isolation.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

GitHub Pages ne permet pas d'envoyer d'en-têtes : `coi-serviceworker` les ajoute côté client.

```bash
npm install -D coi-serviceworker@0.1.7
mkdir -p public && cp node_modules/coi-serviceworker/coi-serviceworker.min.js public/
```

Dans `web/index.html`, dans `<head>`, avant tout autre script :

```html
    <!-- Adds COOP/COEP on GitHub Pages, which cannot send headers; reloads once on first visit. -->
    <script src="coi-serviceworker.min.js"></script>
```

- [ ] **Step 4 : Panneau et selftest**

`web/src/ui/panel.ts` :
- ajouter `unavailable(engineId: string): string | null;` à `PanelOptions` ;
- après le remplissage de `engine`, griser les moteurs indisponibles :

```ts
  for (const o of engine.options) {
    const reason = opts.unavailable(o.value);
    if (reason) {
      o.disabled = true;
      o.textContent += ' (unavailable)';
      o.title = reason;
    }
  }
```

`web/src/main.ts` : passer `unavailable: (id) => engineUnavailable(getEngine(id)),` à `createPanel` (importer `engineUnavailable`).

`web/src/selftest/page.ts` : n'utiliser que les moteurs disponibles :

```ts
      engineIds: ENGINES.filter((e) => !engineUnavailable(e))
        .map((e) => e.id)
        .filter((id) => id !== REFERENCE),
```

(importer `engineUnavailable`).

- [ ] **Step 5 : Vérifier**

Run : `npm run typecheck && npm test && npm run build`. Puis dans le navigateur (le serveur de dev doit être redémarré pour les en-têtes) :
1. `crossOriginIsolated === true` sur `http://localhost:5173`.
2. `?selftest` → 16 lignes (4 moteurs × 4 cas), toutes `pass`.
3. Live 1024² random : `wasm-mt` plus rapide que `wasm-simd`, aucune erreur console.
4. `npm run preview` (build de prod) → `wasm-mt` fonctionne aussi (le worker pthread est bien embarqué par Vite).

- [ ] **Step 6 : Commit**

```bash
git add web/public web/index.html web/vite.config.ts web/package.json web/package-lock.json web/src/engines web/src/ui/panel.ts web/src/main.ts web/src/selftest/page.ts web/test/registry.test.ts
git commit -m "feat(web): wasm-mt engine with cross-origin isolation"
```
