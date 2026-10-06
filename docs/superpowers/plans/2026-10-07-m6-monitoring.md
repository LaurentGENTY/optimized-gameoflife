# Jalon 6 — Monitoring (trace instrumentée, Gantt, overlays, timeline GPU) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** en mode live, un interrupteur « Monitoring » bascule `wasm-mt` sur un build instrumenté et les moteurs WebGPU sur une variante avec timestamp queries. On voit alors un Gantt par thread façon EasyView, la grille colorée par thread ou en « heat » par durée de tuile, le % d'activité par thread et une timeline du temps kernel GPU. Les limites du navigateur sont annoncées dans l'UI.

**Architecture :**
- **Build `mt-trace` :** quatrième build de `life.c` (`-DLIFE_TRACE`). Chaque tuile calculée écrit `(thread, tuile, itération, début, fin)` dans un ring buffer statique (mémoire partagée WASM préallouée, aucune allocation dans la boucle). Le JS draine le ring entre deux appels, quand les threads sont au repos.
- **WebGPU :** la variante tracée fait une compute pass par génération, avec `timestampWrites`.
- **Transport :** les deux remontent un `TraceBatch` via `Engine.trace()`. `LiveRunner` l'appelle après chaque frame, seulement si le moteur le propose.
- **Côté UI :** un modèle pur (`CpuMonitor`, `GpuMonitor`) agrège les données, des vues Canvas 2D les dessinent, et le renderer WebGPU applique la teinte par tuile.

**Tech Stack :** C + C11 atomics + `emscripten_get_now()`, WebGPU `timestamp-query`, Canvas 2D, Vitest.

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), section 5 et jalon 6. Ce plan reprend aussi la règle reportée du jalon 5 : le temps kernel GPU.

## Global Constraints

- Zéro surcoût hors monitoring : les builds `seq`, `simd` et `mt` et les moteurs GPU normaux restent inchangés. Le benchmark et la liste des moteurs n'utilisent jamais les variantes tracées (`hidden: true`). Seul le selftest les inclut, pour prouver que leur hash reste identique.
- Ring buffer préalloué de `TRACE_CAPACITY = 65536` enregistrements de 32 octets, écrit par index atomique, sans allocation dans la boucle de tuiles. Le JS signale les enregistrements perdus (`lost`) quand le ring a débordé entre deux lectures.
- Horodatages : `emscripten_get_now()` (avec pthreads, c'est `performance.timeOrigin + performance.now()`, cohérent entre threads), en millisecondes `double`.
- Tuiles sautées par le lazy tiling : aucun enregistrement. Elles apparaissent vides dans le Gantt et sans teinte dans l'overlay.
- Couleurs par thread : les 8 teintes catégorielles validées du jalon 5 (`#3987e5, #d95926, #199e70, #c98500, #d55181, #008300, #9085e9, #e66767`). Les threads ≥ 8 réutilisent la teinte n° `t % 8`, assombrie à 60 % (encodage composite teinte + luminosité). L'identité ne repose jamais sur la couleur seule : chaque ligne du Gantt porte son n° de thread, et une info-bulle donne thread, tuile, itération et durée. Heat : une seule teinte, du sombre au clair.
- Texte obligatoire dans l'UI : « Browsers do not expose which physical core runs a worker: rows are threads, not cores (navigator.hardwareConcurrency = N) » et, pour le GPU, « No per-thread information on GPU: kernel time per generation only ».
- Monitoring disponible pour `wasm-mt` (≥ 2 threads) et pour les moteurs WebGPU quand l'adaptateur a `timestamp-query`. Sinon la case est grisée avec sa raison.
- Code, commentaires, UI et commits en anglais. Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.

## Review Focus

1. **Le ring déborde entre deux lectures** (lot live de milliers d'itérations) → on garde les `TRACE_CAPACITY` plus récents, `lost` est exact, aucun enregistrement à moitié écrit. Test : Task 1.
2. **Horodatages de threads différents** → tous dans la fenêtre `[avant step, après step]` mesurée par le JS. Test : Task 1.
3. **Monitoring activé puis changement de moteur ou de taille** → les vues se vident, aucune trace de l'ancien moteur n'est affichée (garde par token dans `Session`). Test : Task 3.
4. **GPU sans `timestamp-query`, ou timestamps à 0 / incohérents** → message clair, aucune durée négative. Test : Task 4.
5. **Overlay sur une grille dont la taille n'est pas multiple de 32** → les tuiles du bord droit et bas, rognées, sont teintées correctement, et l'anneau mort n'est jamais teint. Vérification navigateur en 1000² (Task 5).

---

### Task 1 : build `mt-trace` — ring buffer de tuiles dans `life.c`

**Files :**
- Modify : `web/wasm/life.c`, `web/wasm/life.h`, `web/wasm/Makefile`, `web/src/engines/wasm/life-module.d.ts`, `web/src/engines/wasm-sim.ts`, `web/src/engine.ts`
- Test : `web/test/wasm-mt-trace.test.ts`

**Interfaces :**
- Produces :
  - C (build `mt-trace`) : `void *life_trace_buffer (void)`, `unsigned life_trace_capacity (void)`, `unsigned life_trace_count (void)`, `double life_now (void)`, `int life_nb_tiles (void)` (tous builds `LIFE_TILED`)
  - Disposition d'un enregistrement (32 octets) : `int32 thread @0`, `int32 tile @4`, `uint32 iteration @8`, `pad @12`, `f64 start @16`, `f64 end @24`
  - `web/src/engine.ts` :

```ts
export type TraceBatch =
  | {
      kind: 'cpu';
      threads: number;
      tileSize: number;
      tilesPerSide: number;
      // [thread, tile, iteration, startMs, endMs] per record, oldest first
      records: Float64Array;
      lost: number;
    }
  | {
      kind: 'gpu';
      // [iteration, kernelMs] per sample, oldest first
      samples: Float64Array;
      lost: number;
    };
```

  et `Engine` gagne `trace?(): Promise<TraceBatch | null>;`. `CpuSim` gagne `trace?(): TraceBatch | null;`.
  - `WasmKernel` gagne `'mt-trace'`. `WasmSim.trace(): TraceBatch | null` (`null` pour les noyaux sans trace).

- [ ] **Step 1 : Test qui échoue**

`web/test/wasm-mt-trace.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createGrid, type Grid } from '../src/grid';
import { buildGrid } from '../src/patterns/presets';
import { WasmSim } from '../src/engines/wasm-sim';

const nowMs = () => performance.timeOrigin + performance.now();

async function hashSeq(grid: Grid, gens: number): Promise<string> {
  const s = await WasmSim.create('seq', grid);
  s.step(gens);
  const h = s.hash();
  s.dispose();
  return h;
}

function records(batch: Float64Array) {
  const out = [];
  for (let i = 0; i < batch.length; i += 5)
    out.push({ thread: batch[i], tile: batch[i + 1], iteration: batch[i + 2], start: batch[i + 3], end: batch[i + 4] });
  return out;
}

describe('wasm-mt-trace', () => {
  it('computes the same generations as wasm-seq', async () => {
    const grid = buildGrid('bugs', 256);
    const sim = await WasmSim.create('mt-trace', grid, { threads: 4 });
    sim.step(200);
    expect(sim.hash()).toBe(await hashSeq(grid, 200));
    sim.dispose();
  });

  it('records every computed tile once, by a valid thread, inside the step time window', async () => {
    const sim = await WasmSim.create('mt-trace', buildGrid('random', 256), { threads: 4 });
    const before = nowMs();
    sim.step(1);
    const after = nowMs();
    const batch = sim.trace();
    expect(batch?.kind).toBe('cpu');
    if (batch?.kind !== 'cpu') return;
    expect(batch).toMatchObject({ threads: 4, tileSize: 32, tilesPerSide: 8, lost: 0 });
    const recs = records(batch.records);
    expect(recs).toHaveLength(64); // first iteration computes every tile
    expect(new Set(recs.map((r) => r.tile)).size).toBe(64);
    for (const r of recs) {
      expect(r.thread).toBeGreaterThanOrEqual(0);
      expect(r.thread).toBeLessThan(4);
      expect(r.iteration).toBe(0);
      expect(r.start).toBeGreaterThanOrEqual(before);
      expect(r.end).toBeGreaterThanOrEqual(r.start);
      expect(r.end).toBeLessThanOrEqual(after);
    }
    sim.dispose();
  });

  it('drains only new records and leaves skipped tiles out', async () => {
    const g = createGrid(256);
    for (const x of [100, 101, 102]) g.cells[100 * 256 + x] = 1;
    const sim = await WasmSim.create('mt-trace', g, { threads: 4 });
    sim.step(1);
    sim.trace();
    sim.step(3);
    const batch = sim.trace();
    if (batch?.kind !== 'cpu') throw new Error('expected a cpu batch');
    const recs = records(batch.records);
    expect(recs.length).toBeLessThanOrEqual(3 * 9);
    expect(new Set(recs.map((r) => r.iteration))).toEqual(new Set([1, 2, 3]));
    sim.dispose();
  });

  it('keeps the newest records and counts the lost ones when the ring overflows', async () => {
    const sim = await WasmSim.create('mt-trace', buildGrid('random', 256), { threads: 4 });
    sim.step(1500); // well over 65536 tile records while the grid is busy
    const batch = sim.trace();
    if (batch?.kind !== 'cpu') throw new Error('expected a cpu batch');
    const recs = records(batch.records);
    expect(recs).toHaveLength(65536);
    expect(batch.lost).toBeGreaterThan(0);
    expect(recs.at(-1)!.iteration).toBe(1499);
    sim.dispose();
  });

  it('returns null for kernels without tracing', async () => {
    const sim = await WasmSim.create('mt', createGrid(16), { threads: 2 });
    expect(sim.trace()).toBeNull();
    sim.dispose();
  });
});
```

Run : `npx vitest run wasm-mt-trace` → Attendu : FAIL (le noyau `mt-trace` est inconnu).

- [ ] **Step 2 : `life.c`**

(a) Dans la section `LIFE_TILED`, après `life_tiles_computed` :

```c
EMSCRIPTEN_KEEPALIVE int life_nb_tiles (void)
{
  return nb_tiles;
}
```

(b) Dans la section `LIFE_THREADS`, juste après les déclarations statiques (`quitting`) :

```c
#ifdef LIFE_TRACE
// Monitoring build only: one record per computed tile, in a preallocated ring.
typedef struct {
  int32_t thread;
  int32_t tile;
  uint32_t iteration;
  uint32_t pad;
  double start;
  double end;
} trace_rec_t;

#define TRACE_CAPACITY (1u << 16)
static trace_rec_t trace_buf[TRACE_CAPACITY];
static atomic_uint trace_count;
static uint32_t trace_iteration = 0;

static inline void trace_tile (int self, int tile, double start, double end)
{
  const unsigned i = atomic_fetch_add (&trace_count, 1);
  trace_rec_t *r   = &trace_buf[i & (TRACE_CAPACITY - 1)];
  r->thread        = self;
  r->tile          = tile;
  r->iteration     = trace_iteration;
  r->start         = start;
  r->end           = end;
}

EMSCRIPTEN_KEEPALIVE void *life_trace_buffer (void) { return trace_buf; }
EMSCRIPTEN_KEEPALIVE unsigned life_trace_capacity (void) { return TRACE_CAPACITY; }
EMSCRIPTEN_KEEPALIVE unsigned life_trace_count (void) { return atomic_load (&trace_count); }
EMSCRIPTEN_KEEPALIVE double life_now (void) { return emscripten_get_now (); }
#endif
```

(c) Dans `run_iterations`, remplacer la boucle de tuiles et la section du thread 0 par :

```c
    for (int t = atomic_fetch_add (&next_tile, 1); t < total; t = atomic_fetch_add (&next_tile, 1)) {
#ifdef LIFE_TRACE
      const double t0 = emscripten_get_now ();
#endif
      if (process_tile (t % nb_tiles, t / nb_tiles)) {
        atomic_fetch_add (&tiles_done, 1);
#ifdef LIFE_TRACE
        trace_tile (self, t, t0, emscripten_get_now ());
#endif
      }
    }
    pthread_barrier_wait (&barrier);
    if (self == 0) {
      tiles_computed = atomic_exchange (&tiles_done, 0);
      end_iteration ();
      atomic_store (&next_tile, 0);
#ifdef LIFE_TRACE
      trace_iteration++;
#endif
    }
    pthread_barrier_wait (&barrier);
```

(d) Dans `life_init`, après `tiles_reset ();` (bloc `LIFE_TILED`) :

```c
#ifdef LIFE_TRACE
  atomic_store (&trace_count, 0);
  trace_iteration = 0;
#endif
```

> `emscripten_get_now` est déclaré dans `<emscripten/emscripten.h>`, déjà inclus. Avec 1 seul thread, `life_compute_tiled_mt` retombe sur `life_compute_tiled`, qui n'est pas tracé : le monitoring exige ≥ 2 threads (contrainte globale).

`web/wasm/life.h` : ajouter `int life_nb_tiles (void);`, `void *life_trace_buffer (void);`, `unsigned life_trace_capacity (void);`, `unsigned life_trace_count (void);`, `double life_now (void);`.

- [ ] **Step 3 : Build**

`web/wasm/Makefile` :

```make
TRACE_EXPORTS := $(MT_EXPORTS),_life_nb_tiles,_life_trace_buffer,_life_trace_capacity,_life_trace_count,_life_now

all: $(OUT)/life-seq.mjs $(OUT)/life-simd.mjs $(OUT)/life-mt.mjs $(OUT)/life-mt-trace.mjs

$(OUT)/life-mt-trace.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -DLIFE_TILED -DLIFE_THREADS -DLIFE_TRACE -DTILE_SIZE=32 -msimd128 -msse2 -pthread \
	  -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
	  -sEXPORTED_FUNCTIONS=$(TRACE_EXPORTS) life.c -o $@
```

(remplacer la ligne `all:` existante). Ajouter aussi `_life_nb_tiles` à `SIMD_EXPORTS`.

- [ ] **Step 4 : `WasmSim`**

`web/src/engines/wasm/life-module.d.ts` : ajouter un bloc `declare module '*/life-mt-trace.mjs'`, avec les membres de `LifeMtModule` plus :

```ts
    _life_nb_tiles(): number;
    _life_trace_buffer(): number;
    _life_trace_capacity(): number;
    _life_trace_count(): number;
    _life_now(): number;
```

Dans `web/src/engines/wasm-sim.ts` :
- `export type WasmKernel = 'seq' | 'simd' | 'mt' | 'mt-trace';`
- ajouter au `Kernel` le champ optionnel `traced?: boolean`
- ajouter l'entrée `'mt-trace'` : identique à `mt` (même `step`, `tiles` et `start`, et `shared: true`), sauf `load: async () => (await import('./wasm/generated/life-mt-trace.mjs')).default()` et `traced: true`
- ajouter un champ `private traceSeen = 0;`, remis à 0 dans `create` (nouvelle simulation = nouveau compteur côté C)
- ajouter la méthode :

```ts
  // Drains records written since the last call. Threads are idle between steps, so no record is half-written.
  trace(): TraceBatch | null {
    if (!this.kernel.traced) return null;
    const mod = this.mod as LifeModule & {
      _life_trace_buffer(): number;
      _life_trace_capacity(): number;
      _life_trace_count(): number;
      _life_nb_tiles(): number;
    };
    const total = mod._life_trace_count() >>> 0;
    const capacity = mod._life_trace_capacity();
    const fresh = (total - this.traceSeen) >>> 0;
    const take = Math.min(fresh, capacity);
    const base = mod._life_trace_buffer();
    const i32 = new Int32Array(mod.HEAPU8.buffer);
    const f64 = new Float64Array(mod.HEAPU8.buffer);
    const records = new Float64Array(take * 5);
    for (let k = 0; k < take; k++) {
      const slot = (total - take + k) & (capacity - 1);
      const off = base + slot * 32;
      records[k * 5] = i32[off >> 2];
      records[k * 5 + 1] = i32[(off >> 2) + 1];
      records[k * 5 + 2] = i32[(off >> 2) + 2] >>> 0;
      records[k * 5 + 3] = f64[(off >> 3) + 2];
      records[k * 5 + 4] = f64[(off >> 3) + 3];
    }
    this.traceSeen = total;
    return { kind: 'cpu', threads: this.nbThreads, tileSize: 32, tilesPerSide: mod._life_nb_tiles(), records, lost: fresh - take };
  }
```

(importer `type TraceBatch` depuis `../engine`). Dans `web/src/engine.ts`, ajouter le type `TraceBatch` et les deux méthodes optionnelles décrits dans **Interfaces**.

- [ ] **Step 5 : Tests + commit**

Run : `npm test && npm run typecheck` → Attendu : tout PASS, dont 5 tests `wasm-mt-trace`.

```bash
git add web/wasm web/src/engines/wasm/life-module.d.ts web/src/engines/wasm-sim.ts web/src/engine.ts web/test/wasm-mt-trace.test.ts
git commit -m "feat(web): instrumented wasm-mt build with a per-tile trace ring"
```

---

### Task 2 : transport de la trace (worker → `Engine.trace`) et moteurs cachés

**Files :**
- Modify : `web/src/engines/sim-handler.ts`, `web/src/engines/cpu-worker-engine.ts`, `web/src/engines/registry.ts`, `web/src/ui/panel.ts`, `web/src/main.ts`
- Create : `web/src/engines/wasm-mt-trace.worker.ts`
- Test : `web/test/cpu-worker-engine.test.ts` (ajout), `web/test/registry.test.ts` (ajout)

**Interfaces :**
- Consumes : `WasmSim.trace()`, `TraceBatch` (Task 1)
- Produces :
  - op RPC `{ op: 'trace' }` : renvoie `TraceBatch | null`. `records` est transféré, pas copié.
  - `CpuWorkerEngine.trace(): Promise<TraceBatch | null>`
  - `EngineInfo.hidden?: boolean`, `visibleEngines(): EngineInfo[]`, `tracedVariant(engineId: string): string | null`
  - entrée cachée `wasm-mt-trace` (même disponibilité que `wasm-mt`)

- [ ] **Step 1 : Tests qui échouent**

Ajouter à `web/test/cpu-worker-engine.test.ts` :

```ts
describe('CpuWorkerEngine.trace', () => {
  it('relays the traced kernel records through the worker protocol', async () => {
    const engine = new CpuWorkerEngine(
      'wasm-mt-trace',
      new InProcessWorker(createSimHandler((g) => WasmSim.create('mt-trace', g, { threads: 2 }))),
    );
    await engine.init(createGrid(64));
    await engine.step(1);
    const batch = await engine.trace();
    expect(batch?.kind).toBe('cpu');
    if (batch?.kind === 'cpu') expect(batch.records.length).toBe(4 * 5); // 2×2 tiles of 32 over a 62² interior
    engine.dispose();
  });

  it('returns null for an untraced engine', async () => {
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await engine.init(createGrid(8));
    expect(await engine.trace()).toBeNull();
    engine.dispose();
  });
});
```

Ajouter à `web/test/registry.test.ts` :

```ts
import { tracedVariant, visibleEngines } from '../src/engines/registry';

describe('traced variants', () => {
  it('hides traced variants from engine lists', () => {
    expect(visibleEngines().map((e) => e.id)).not.toContain('wasm-mt-trace');
  });

  it('maps engines to their monitoring variant', () => {
    expect(tracedVariant('wasm-mt')).toBe('wasm-mt-trace');
    expect(tracedVariant('wasm-seq')).toBeNull();
  });
});
```

(regrouper l'import avec l'import existant de `registry`.)

Run : `npx vitest run cpu-worker-engine registry` → Attendu : FAIL.

- [ ] **Step 2 : Implémenter**

`web/src/engines/sim-handler.ts` :
- ajouter `| { id: number; op: 'trace' }` à `SimRequest` ;
- dans le `switch`, ajouter `case 'trace': return { id: req.id, ok: true, value: need().trace?.() ?? null };` ;
- dans `serveSimInWorker`, transférer aussi le buffer des enregistrements :

```ts
      const v = reply.ok ? reply.value : null;
      const transfer =
        v instanceof Uint8Array
          ? [v.buffer as ArrayBuffer]
          : v && typeof v === 'object' && 'records' in v && v.records instanceof Float64Array
            ? [v.records.buffer as ArrayBuffer]
            : [];
```

`web/src/engines/cpu-worker-engine.ts` : ajouter

```ts
  trace(): Promise<TraceBatch | null> {
    return this.rpc.call<TraceBatch | null>({ op: 'trace' });
  }
```

`web/src/engines/wasm-mt-trace.worker.ts` :

```ts
import { serveSimInWorker } from './sim-handler';
import { WasmSim } from './wasm-sim';

serveSimInWorker((grid) => WasmSim.create('mt-trace', grid));
```

`web/src/engines/registry.ts` :
- `EngineInfo` gagne `hidden?: boolean;` ;
- extraire la règle d'isolation de `wasm-mt` dans une constante, pour la partager :

```ts
const needsIsolation = () =>
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ? null
    : 'Needs cross-origin isolation (SharedArrayBuffer). Reload once the service worker is installed.';
```

  (`wasm-mt` utilise alors `unavailable: needsIsolation`) ;
- ajouter l'entrée cachée, juste après `wasm-mt` :

```ts
  {
    id: 'wasm-mt-trace',
    label: 'WASM threads (instrumented)',
    hidden: true,
    maxSize: () => CPU_MAX_SIZE,
    unavailable: needsIsolation,
    create: () =>
      new CpuWorkerEngine(
        'wasm-mt-trace',
        new Worker(new URL('./wasm-mt-trace.worker.ts', import.meta.url), { type: 'module' }),
      ),
  },
```

- ajouter :

```ts
export function visibleEngines(): EngineInfo[] {
  return ENGINES.filter((e) => !e.hidden);
}

const TRACED: Record<string, string> = { 'wasm-mt': 'wasm-mt-trace' };

// Monitoring swaps an engine for its instrumented build; null when it has none.
export function tracedVariant(engineId: string): string | null {
  return TRACED[engineId] ?? null;
}
```

`web/src/main.ts` : passer `engines: visibleEngines()` à `createPanel`, et `visibleEngines().map(…)` au lieu de `ENGINES.map(…)` à `createBenchPanel`. Le selftest garde `ENGINES` : il couvre donc aussi le build instrumenté.

Run : `npm test && npm run typecheck` → Attendu : tout PASS.

- [ ] **Step 3 : Commit**

```bash
git add web/src/engines web/src/main.ts web/test/cpu-worker-engine.test.ts web/test/registry.test.ts
git commit -m "feat(web): relay engine traces and register the instrumented wasm-mt"
```

---

### Task 3 : modèle de monitoring (pur) + trace dans le runner et la session

**Files :**
- Create : `web/src/monitor/model.ts`
- Modify : `web/src/live/runner.ts`, `web/src/live/session.ts`, `web/test/fakes.ts`
- Test : `web/test/monitor-model.test.ts`, `web/test/runner.test.ts` (ajout), `web/test/session.test.ts` (ajout)

**Interfaces :**
- Consumes : `TraceBatch` (Task 1)
- Produces :
  - `interface TileSpan { thread: number; tile: number; iteration: number; start: number; end: number }`
  - `class CpuMonitor { constructor(keepIterations?: number /* 4 */); push(b: Extract<TraceBatch, { kind: 'cpu' }>): void; readonly threads: number; readonly lost: number; window(): { spans: TileSpan[]; t0: number; t1: number; iterations: number[] }; latestTiles(): { tilesPerSide: number; thread: Float32Array; durationMs: Float32Array } | null; activity(): number[] /* % busy per thread over the window */ ; clear(): void }`
  - `class GpuMonitor { constructor(keep?: number /* 240 */); push(b: Extract<TraceBatch, { kind: 'gpu' }>): void; samples(): { iteration: number; ms: number }[]; readonly lost: number; clear(): void }`
  - `LiveCallbacks.onTrace?(batch: TraceBatch): void` : appelé après chaque frame, seulement si le moteur a `trace`
  - `SessionDeps.onTrace?(batch: TraceBatch): void`, filtré par le token de session

- [ ] **Step 1 : Tests qui échouent**

`web/test/monitor-model.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { CpuMonitor, GpuMonitor } from '../src/monitor/model';

// [thread, tile, iteration, start, end]
const cpu = (recs: number[][], threads = 2, lost = 0) => ({
  kind: 'cpu' as const,
  threads,
  tileSize: 32,
  tilesPerSide: 2,
  records: Float64Array.from(recs.flat()),
  lost,
});

describe('CpuMonitor', () => {
  it('keeps only the latest iterations across batches', () => {
    const m = new CpuMonitor(2);
    m.push(cpu([[0, 0, 0, 0, 1], [1, 1, 0, 0, 2]]));
    m.push(cpu([[0, 0, 1, 3, 4], [0, 1, 2, 5, 6]]));
    expect(m.window().iterations).toEqual([1, 2]);
    expect(m.window().spans.map((s) => s.iteration)).toEqual([1, 2]);
    expect(m.window()).toMatchObject({ t0: 3, t1: 6 });
  });

  it('maps the latest iteration to tiles, leaving skipped tiles at -1', () => {
    const m = new CpuMonitor();
    m.push(cpu([[1, 3, 0, 10, 14], [0, 0, 0, 10, 11]]));
    const t = m.latestTiles()!;
    expect(Array.from(t.thread)).toEqual([0, -1, -1, 1]);
    expect(Array.from(t.durationMs)).toEqual([1, -1, -1, 4]);
  });

  it('computes per-thread activity over the window, including idle threads', () => {
    const m = new CpuMonitor();
    m.push(cpu([[0, 0, 0, 0, 10], [0, 1, 0, 10, 15]], 3));
    expect(m.activity()).toEqual([100, 0, 0]);
  });

  it('accumulates lost records and clears', () => {
    const m = new CpuMonitor();
    m.push(cpu([[0, 0, 0, 0, 1]], 2, 5));
    m.push(cpu([[0, 0, 1, 1, 2]], 2, 2));
    expect(m.lost).toBe(7);
    m.clear();
    expect(m.window().spans).toEqual([]);
    expect(m.latestTiles()).toBeNull();
    expect(m.lost).toBe(0);
  });
});

describe('GpuMonitor', () => {
  it('keeps the last samples in order', () => {
    const m = new GpuMonitor(3);
    m.push({ kind: 'gpu', samples: Float64Array.from([0, 0.5, 1, 0.6]), lost: 0 });
    m.push({ kind: 'gpu', samples: Float64Array.from([2, 0.7, 3, 0.8]), lost: 1 });
    expect(m.samples()).toEqual([
      { iteration: 1, ms: 0.6 },
      { iteration: 2, ms: 0.7 },
      { iteration: 3, ms: 0.8 },
    ]);
    expect(m.lost).toBe(1);
  });
});
```

Ajouter à `web/test/fakes.ts`, dans `FakeEngine` :

```ts
  traceBatches: TraceBatch[] | null = null;
  async trace(): Promise<TraceBatch | null> {
    return this.traceBatches?.shift() ?? null;
  }
```

(importer `TraceBatch` depuis `../src/engine`). Ajouter à `web/test/runner.test.ts` :

```ts
  it('forwards a trace batch after each fetched frame', async () => {
    const { engine, cb, runner } = await setup();
    const onTrace = vi.fn();
    const batch = { kind: 'gpu' as const, samples: new Float64Array(0), lost: 0 };
    engine.traceBatches = [batch];
    const traced = new LiveRunner(engine, { ...cb, onTrace });
    traced.requestFrame();
    await traced.step();
    expect(onTrace).toHaveBeenCalledWith(batch);
    void runner;
  });
```

Ajouter à `web/test/session.test.ts` :

```ts
  it('drops traces from a superseded engine', async () => {
    const onTrace = vi.fn();
    const created: FakeEngine[] = [];
    const session = new Session({
      createEngine: () => {
        const e = new FakeEngine();
        e.stepDelayMs = 30;
        e.traceBatches = [{ kind: 'gpu', samples: new Float64Array(0), lost: 0 }];
        created.push(e);
        return e;
      },
      buildGrid: (_p, size) => createGrid(size),
      onFrame: () => {},
      onStats: () => {},
      onError: () => {},
      onTrace,
    });
    await session.load({ engineId: 'a', presetId: 'random', size: 16 });
    const step = session.step();
    await session.load({ engineId: 'b', presetId: 'random', size: 16 });
    await step;
    expect(onTrace).not.toHaveBeenCalled();
  });
```

Run : `npx vitest run monitor-model runner session` → Attendu : FAIL.

- [ ] **Step 2 : Implémenter**

`web/src/monitor/model.ts` :

```ts
import type { TraceBatch } from '../engine';

export interface TileSpan {
  thread: number;
  tile: number;
  iteration: number;
  start: number;
  end: number;
}

type CpuBatch = Extract<TraceBatch, { kind: 'cpu' }>;
type GpuBatch = Extract<TraceBatch, { kind: 'gpu' }>;

export class CpuMonitor {
  private spans: TileSpan[] = [];
  private _threads = 0;
  private tilesPerSide = 0;
  private _lost = 0;

  constructor(private readonly keepIterations = 4) {}

  get threads(): number {
    return this._threads;
  }

  get lost(): number {
    return this._lost;
  }

  push(b: CpuBatch): void {
    this._threads = b.threads;
    this.tilesPerSide = b.tilesPerSide;
    this._lost += b.lost;
    for (let i = 0; i < b.records.length; i += 5) {
      this.spans.push({
        thread: b.records[i],
        tile: b.records[i + 1],
        iteration: b.records[i + 2],
        start: b.records[i + 3],
        end: b.records[i + 4],
      });
    }
    const last = this.spans.at(-1)?.iteration;
    if (last !== undefined) this.spans = this.spans.filter((s) => s.iteration > last - this.keepIterations);
  }

  window(): { spans: TileSpan[]; t0: number; t1: number; iterations: number[] } {
    if (this.spans.length === 0) return { spans: [], t0: 0, t1: 0, iterations: [] };
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const s of this.spans) {
      t0 = Math.min(t0, s.start);
      t1 = Math.max(t1, s.end);
    }
    const iterations = [...new Set(this.spans.map((s) => s.iteration))].sort((a, b) => a - b);
    return { spans: this.spans, t0, t1, iterations };
  }

  // Latest iteration only: -1 marks tiles skipped by lazy tiling.
  latestTiles(): { tilesPerSide: number; thread: Float32Array; durationMs: Float32Array } | null {
    const last = this.spans.at(-1)?.iteration;
    if (last === undefined) return null;
    const n = this.tilesPerSide * this.tilesPerSide;
    const thread = new Float32Array(n).fill(-1);
    const durationMs = new Float32Array(n).fill(-1);
    for (const s of this.spans) {
      if (s.iteration !== last) continue;
      thread[s.tile] = s.thread;
      durationMs[s.tile] = s.end - s.start;
    }
    return { tilesPerSide: this.tilesPerSide, thread, durationMs };
  }

  activity(): number[] {
    const { spans, t0, t1 } = this.window();
    const busy = new Array<number>(this._threads).fill(0);
    for (const s of spans) busy[s.thread] += s.end - s.start;
    const span = t1 - t0;
    return busy.map((b) => (span > 0 ? Math.min(100, (b / span) * 100) : 0));
  }

  clear(): void {
    this.spans = [];
    this._lost = 0;
  }
}

export class GpuMonitor {
  private data: { iteration: number; ms: number }[] = [];
  private _lost = 0;

  constructor(private readonly keep = 240) {}

  get lost(): number {
    return this._lost;
  }

  push(b: GpuBatch): void {
    this._lost += b.lost;
    for (let i = 0; i < b.samples.length; i += 2) this.data.push({ iteration: b.samples[i], ms: b.samples[i + 1] });
    if (this.data.length > this.keep) this.data = this.data.slice(-this.keep);
  }

  samples(): { iteration: number; ms: number }[] {
    return this.data;
  }

  clear(): void {
    this.data = [];
    this._lost = 0;
  }
}
```

> Le test d'activité attend `[100, 0, 0]` : la fenêtre va de 0 à 15, et le thread 0 est occupé 10 + 5 = 15.

`web/src/live/runner.ts` :
- `LiveCallbacks` gagne `onTrace?(batch: TraceBatch): void;` (importer `TraceBatch`) ;
- ajouter une méthode privée :

```ts
  private async emitFrame(): Promise<void> {
    this.cb.onFrame(await this.engine.frame());
    if (this.engine.trace && this.cb.onTrace) {
      const batch = await this.engine.trace();
      if (batch) this.cb.onTrace(batch);
    }
  }
```

- remplacer les deux `this.cb.onFrame(await this.engine.frame());` (dans `step()` et dans `run()`) par `await this.emitFrame();`.

`web/src/live/session.ts` :
- `SessionDeps` gagne `onTrace?(batch: TraceBatch): void;` ;
- dans les callbacks du runner, ajouter `onTrace: (b) => current() && this.deps.onTrace?.(b),`.

Run : `npm test && npm run typecheck` → Attendu : tout PASS.

- [ ] **Step 3 : Commit**

```bash
git add web/src/monitor/model.ts web/src/live web/test/fakes.ts web/test/monitor-model.test.ts web/test/runner.test.ts web/test/session.test.ts
git commit -m "feat(web): monitoring model and trace plumbing in the live loop"
```

---

### Task 4 : WebGPU — variante tracée avec timestamp queries

**Files :**
- Create : `web/src/engines/gpu-timestamps.ts`
- Modify : `web/src/engines/webgpu-engine.ts`, `web/src/engines/registry.ts`, `web/src/render/gpu.ts` (aucun changement si `timestamp-query` est déjà demandé ; à vérifier)
- Test : `web/test/gpu-timestamps.test.ts`

**Interfaces :**
- Consumes : `TraceBatch` (Task 1), `tracedVariant`/`hidden` (Task 2)
- Produces :
  - `kernelSamples(timestamps: BigUint64Array, count: number, firstIteration: number): Float64Array` : `[iteration, ms]` par passe ; une durée ≤ 0 ou absurde (> 10 s) est ignorée et comptée à part
  - `WebGpuEngine` : constructeur `(id, device, shaderCode, opts?: { timestamps?: boolean })`. En mode tracé : une compute pass par génération avec `timestampWrites`, `trace()` renvoie les échantillons accumulés (max 4096, `lost` au-delà)
  - `EngineEnv.timestamps: boolean` (renseigné depuis `GpuInit.timestamps`)
  - entrées cachées `webgpu-naive-trace` et `webgpu-tiled-trace`, indisponibles sans `timestamp-query` ; `tracedVariant` les mappe

- [ ] **Step 1 : Test qui échoue**

`web/test/gpu-timestamps.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { kernelSamples } from '../src/engines/gpu-timestamps';

describe('kernelSamples', () => {
  it('turns begin/end pairs in ns into [iteration, ms] samples', () => {
    const ts = BigUint64Array.from([1_000_000n, 1_500_000n, 2_000_000n, 2_250_000n]);
    expect(Array.from(kernelSamples(ts, 2, 10))).toEqual([10, 0.5, 11, 0.25]);
  });

  it('drops zero, negative and absurd durations instead of plotting them', () => {
    const ts = BigUint64Array.from([0n, 0n, 5n, 3n, 0n, 20_000_000_000n, 100n, 1_100n]);
    expect(Array.from(kernelSamples(ts, 4, 0))).toEqual([3, 0.001]);
  });
});
```

Run : `npx vitest run gpu-timestamps` → Attendu : FAIL.

- [ ] **Step 2 : Implémenter**

`web/src/engines/gpu-timestamps.ts` :

```ts
// GPU timestamps can be zero or non-monotonic on some drivers; such passes are skipped.
const MAX_PLAUSIBLE_NS = 10_000_000_000n;

export function kernelSamples(timestamps: BigUint64Array, count: number, firstIteration: number): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const begin = timestamps[2 * i];
    const end = timestamps[2 * i + 1];
    const ns = end - begin;
    if (begin === 0n || end <= begin || ns > MAX_PLAUSIBLE_NS) continue;
    out.push(firstIteration + i, Number(ns) / 1e6);
  }
  return Float64Array.from(out);
}
```

`web/src/engines/webgpu-engine.ts` :
- constructeur : `opts: { timestamps?: boolean } = {}`, stocké en `private readonly timestamps: boolean` ;
- champs : `private querySet: GPUQuerySet | null = null; private resolveBuf: GPUBuffer | null = null; private readBuf: GPUBuffer | null = null; private iteration = 0; private pending: number[] = []; private lostSamples = 0;`
- dans `init`, si `this.timestamps` : créer `querySet` (`type: 'timestamp'`, `count: 2 * MAX_DISPATCHES_PER_SUBMIT`), `resolveBuf` (`size: 16 * MAX_DISPATCHES_PER_SUBMIT`, `usage: QUERY_RESOLVE | COPY_SRC`) et `readBuf` (même taille, `MAP_READ | COPY_DST`), puis remettre `iteration = 0`, `pending = []` et `lostSamples = 0`. `release()` détruit les trois ;
- dans `step`, si `this.timestamps` : à chaque soumission, une passe par génération avec

```ts
        const pass = encoder.beginComputePass({
          timestampWrites: { querySet: this.querySet!, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 },
        });
```

  puis, après les passes, `encoder.resolveQuerySet(querySet, 0, 2 * k, resolveBuf, 0)` et `encoder.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, 16 * k)`. Après `submit`, lire les timestamps avant de réutiliser le `readBuf` :

```ts
      await this.readBuf!.mapAsync(GPUMapMode.READ, 0, 16 * k);
      const samples = kernelSamples(new BigUint64Array(this.readBuf!.getMappedRange(0, 16 * k)), k, this.iteration);
      this.readBuf!.unmap();
      this.iteration += k;
      for (const v of samples) this.pending.push(v);
      // Bounded: keep the newest 4096 samples (2 numbers each).
      if (this.pending.length > 8192) {
        this.lostSamples += (this.pending.length - 8192) / 2;
        this.pending = this.pending.slice(-8192);
      }
```

  Le chemin non tracé reste strictement inchangé : une seule passe, 256 dispatches au plus ;
- `trace` est défini seulement en mode tracé. Dans le constructeur : `if (!this.timestamps) this.trace = undefined;`. Déclarer la méthode ainsi :

```ts
  trace?: () => Promise<TraceBatch | null> = async () => {
    const batch: TraceBatch = { kind: 'gpu', samples: Float64Array.from(this.pending), lost: this.lostSamples };
    this.pending = [];
    this.lostSamples = 0;
    return batch;
  };
```

`web/src/engines/registry.ts` :
- `EngineEnv` gagne `timestamps: boolean` ; dans `main.ts`, `env = { device, limits, timestamps: gpu.timestamps }` ;
- deux entrées cachées :

```ts
  {
    id: 'webgpu-naive-trace',
    label: 'WebGPU naive (timestamps)',
    hidden: true,
    maxSize: (env) => maxGpuSize(env.limits, SIZES),
    unavailable: () => (gpuTimestamps ? null : 'This GPU adapter does not support timestamp queries.'),
    create: (env) => new WebGpuEngine('webgpu-naive-trace', env.device, naiveShader, { timestamps: true }),
  },
```

  et la même chose pour `webgpu-tiled-trace` avec `tiledShader`. `gpuTimestamps` est une variable de module (`let gpuTimestamps = false; export function setGpuTimestamps(v: boolean) { gpuTimestamps = v; }`), appelée par `main.ts` juste après `initWebGPU`. La disponibilité (`unavailable()`) ne reçoit pas l'`env` ;
- `TRACED` : ajouter `'webgpu-naive': 'webgpu-naive-trace', 'webgpu-tiled': 'webgpu-tiled-trace'`.

> Le selftest couvre les deux variantes tracées quand l'adaptateur a `timestamp-query`.

- [ ] **Step 3 : Vérifier**

Run : `npm test && npm run typecheck && npm run build`, puis `?selftest` dans le navigateur. Attendu : toutes les lignes passent, y compris `wasm-mt-trace`, `webgpu-naive-trace` et `webgpu-tiled-trace` si l'adaptateur a `timestamp-query`.

- [ ] **Step 4 : Commit**

```bash
git add web/src/engines web/src/main.ts web/test/gpu-timestamps.test.ts
git commit -m "feat(web): timestamped WebGPU variants for per-generation kernel time"
```

---

### Task 5 : overlay par tuile dans le renderer

**Files :**
- Modify : `web/src/render/grid.wgsl`, `web/src/render/renderer.ts`
- Create : `web/src/monitor/colors.ts`
- Test : `web/test/monitor-colors.test.ts`

**Interfaces :**
- Consumes : `CpuMonitor.latestTiles()` (Task 3)
- Produces :
  - `THREAD_HUES: readonly string[]` (les 8 teintes), `threadColor(t: number): [number, number, number]` (RGB 0..1, assombri ×0.6 pour t ≥ 8), `heatColor(v: number): [number, number, number]` (v ∈ [0,1], une teinte du sombre au clair)
  - `overlayValues(mode: 'thread' | 'heat', tiles: { thread: Float32Array; durationMs: Float32Array }): Float32Array` : thread → n° de thread ou −1 ; heat → durée / max ∈ [0,1] ou −1
  - `GridRenderer.setOverlay(o: { mode: 'off' | 'thread' | 'heat'; tilesPerSide: number; tileSize: number; values: Float32Array } | null): void`

- [ ] **Step 1 : Test qui échoue**

`web/test/monitor-colors.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { heatColor, overlayValues, threadColor, THREAD_HUES } from '../src/monitor/colors';

describe('monitor colors', () => {
  it('uses the 8 validated hues, then darker variants', () => {
    expect(THREAD_HUES).toHaveLength(8);
    const [r, g, b] = threadColor(0);
    const [r8, g8, b8] = threadColor(8);
    expect(r8).toBeCloseTo(r * 0.6);
    expect(g8).toBeCloseTo(g * 0.6);
    expect(b8).toBeCloseTo(b * 0.6);
  });

  it('heat goes from dark to bright on one hue', () => {
    const lo = heatColor(0).reduce((a, b) => a + b);
    const hi = heatColor(1).reduce((a, b) => a + b);
    expect(hi).toBeGreaterThan(lo);
  });

  it('builds overlay values, keeping skipped tiles at -1', () => {
    const tiles = { thread: Float32Array.from([2, -1, 0]), durationMs: Float32Array.from([4, -1, 1]) };
    expect(Array.from(overlayValues('thread', tiles))).toEqual([2, -1, 0]);
    expect(Array.from(overlayValues('heat', tiles))).toEqual([1, -1, 0.25]);
  });
});
```

Run : `npx vitest run monitor-colors` → Attendu : FAIL.

- [ ] **Step 2 : Couleurs**

`web/src/monitor/colors.ts` :

```ts
// Validated dark categorical palette (same as the benchmark chart).
export const THREAD_HUES: readonly string[] = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
];

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

// Threads beyond 8 reuse a hue at 60% brightness: hue + lightness, never a generated hue.
export function threadColor(t: number): [number, number, number] {
  const [r, g, b] = rgb(THREAD_HUES[t % 8]);
  const k = t >= 8 ? 0.6 : 1;
  return [r * k, g * k, b * k];
}

const HEAT_LO = rgb('#2a1408');
const HEAT_HI = rgb('#ff9a5a');

export function heatColor(v: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, v));
  return [0, 1, 2].map((i) => HEAT_LO[i] + (HEAT_HI[i] - HEAT_LO[i]) * c) as [number, number, number];
}

export function overlayValues(
  mode: 'thread' | 'heat',
  tiles: { thread: Float32Array; durationMs: Float32Array },
): Float32Array {
  if (mode === 'thread') return Float32Array.from(tiles.thread);
  let max = 0;
  for (const d of tiles.durationMs) if (d > max) max = d;
  return tiles.durationMs.map((d) => (d < 0 ? -1 : max > 0 ? d / max : 0));
}
```

Run : `npx vitest run monitor-colors` → Attendu : 3 PASS.

- [ ] **Step 3 : Shader et renderer**

`web/src/render/grid.wgsl` : étendre `View` et ajouter un binding.

```wgsl
struct View {
  gridSize: u32,
  cellFormat: u32,
  zoom: f32,
  overlayMode: u32, // 0 = off, 1 = thread, 2 = heat (replaces _pad0)
  origin: vec2f,
  tilesPerSide: u32,
  tileSize: u32,
  palette: array<vec4f, 16>, // 0..15: thread colors; heat uses 0 (low) and 1 (high)
}

@group(0) @binding(2) var<storage, read> overlay: array<f32>;
```

Dans `fs`, remplacer la fin (à partir de `if (alive(…))`) par :

```wgsl
  var color = vec3f(0.12, 0.12, 0.15);
  if (alive(u32(c.y) * view.gridSize + u32(c.x))) {
    color = vec3f(1.0, 1.0, 0.0); // easypap's yellow
  }
  let interior = c.x >= 1.0 && c.y >= 1.0 && c.x < n - 1.0 && c.y < n - 1.0;
  if (view.overlayMode != 0u && interior) {
    let tx = (u32(c.x) - 1u) / view.tileSize;
    let ty = (u32(c.y) - 1u) / view.tileSize;
    let v = overlay[ty * view.tilesPerSide + tx];
    if (v >= 0.0) {
      var tint = view.palette[u32(v) % 16u].rgb;
      if (view.overlayMode == 2u) {
        tint = mix(view.palette[0].rgb, view.palette[1].rgb, v);
      }
      color = mix(color, tint, 0.55);
    }
  }
  return vec4f(color, 1.0);
```

`web/src/render/renderer.ts` :
- `UNIFORM_BYTES = 48 + 16 * 16` (304 octets : 8 champs scalaires, 2 de remplissage, puis la palette alignée sur 16) ;
- remplir dans `draw` : `u32[3] = overlayMode`, `u32[6] = tilesPerSide`, `u32[7] = tileSize` (l'origine reste `f32[4]`, `f32[5]`), et la palette à partir de l'octet 48 (index f32 12). En mode thread, `threadColor(i)` pour i ∈ 0..15 ; en mode heat, `heatColor(0)` puis `heatColor(1)` ;
- un buffer `overlayBuffer` (storage, `COPY_DST`) d'au moins 4 octets, recréé quand la taille change, lié en binding 2. Le bind group est reconstruit quand le buffer de cellules ou l'overlay change ;
- `setOverlay(o)` : `null` ou `mode: 'off'` → `overlayMode = 0` ; sinon écrit `values` dans `overlayBuffer` et mémorise `mode`, `tilesPerSide` et `tileSize`.

> Le binding 2 reste toujours lié, avec un buffer d'au moins 4 octets quand l'overlay est éteint, parce que le pipeline `layout: 'auto'` l'exige dès que le shader le déclare.

Run : `npm run typecheck && npm test && npm run build`. Attendu : PASS. Le rendu est vérifié en Task 6.

- [ ] **Step 4 : Commit**

```bash
git add web/src/render web/src/monitor/colors.ts web/test/monitor-colors.test.ts
git commit -m "feat(web): per-tile thread and heat overlay in the grid renderer"
```

---

### Task 6 : UI de monitoring (Gantt, activité, timeline GPU)

**Files :**
- Create : `web/src/monitor/views.ts`, `web/src/ui/monitor-panel.ts`
- Modify : `web/index.html`, `web/src/style.css`, `web/src/ui/panel.ts`, `web/src/main.ts`
- Test : `web/test/monitor-views.test.ts`

**Interfaces :**
- Consumes : `CpuMonitor`, `GpuMonitor` (Task 3) ; `threadColor`, `overlayValues` (Task 5) ; `tracedVariant`, `engineUnavailable`, `getEngine` (Task 2/4) ; `GridRenderer.setOverlay` (Task 5)
- Produces :
  - `ganttLayout(spans, threads, t0, t1, width, rowH): { x: number; y: number; w: number; h: number; span: TileSpan }[]`
  - `hitTest(rects, x, y): TileSpan | null`
  - `drawGantt(ctx, rects, threads, width, rowH, labelW)`, `drawKernelTimeline(ctx, samples, width, height)`
  - `PanelOptions.onMonitoring(enabled: boolean): void` et `PanelHandle.setMonitoringAvailable(reason: string | null): void`

- [ ] **Step 1 : Test qui échoue**

`web/test/monitor-views.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ganttLayout, hitTest } from '../src/monitor/views';

const spans = [
  { thread: 0, tile: 5, iteration: 0, start: 100, end: 150 },
  { thread: 1, tile: 6, iteration: 0, start: 150, end: 200 },
];

describe('gantt layout', () => {
  it('puts each thread on its own row and scales time to the width', () => {
    const r = ganttLayout(spans, 2, 100, 200, 200, 10);
    expect(r[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 10 });
    expect(r[1]).toMatchObject({ x: 100, y: 10, w: 100, h: 10 });
  });

  it('keeps very short spans visible (at least 1px wide)', () => {
    const r = ganttLayout([{ thread: 0, tile: 0, iteration: 0, start: 100, end: 100.0001 }], 1, 100, 200, 200, 10);
    expect(r[0].w).toBe(1);
  });

  it('finds the span under the cursor', () => {
    const r = ganttLayout(spans, 2, 100, 200, 200, 10);
    expect(hitTest(r, 120, 15)?.tile).toBe(6);
    expect(hitTest(r, 20, 5)?.tile).toBe(5);
    expect(hitTest(r, 20, 15)).toBeNull();
  });
});
```

Run : `npx vitest run monitor-views` → Attendu : FAIL.

- [ ] **Step 2 : Vues**

`web/src/monitor/views.ts` :

```ts
import { threadColor } from './colors';
import type { TileSpan } from './model';

export interface GanttRect {
  x: number;
  y: number;
  w: number;
  h: number;
  span: TileSpan;
}

export function ganttLayout(
  spans: readonly TileSpan[],
  threads: number,
  t0: number,
  t1: number,
  width: number,
  rowH: number,
): GanttRect[] {
  const scale = t1 > t0 ? width / (t1 - t0) : 0;
  void threads;
  return spans.map((span) => ({
    x: (span.start - t0) * scale,
    y: span.thread * rowH,
    w: Math.max(1, (span.end - span.start) * scale),
    h: rowH,
    span,
  }));
}

export function hitTest(rects: readonly GanttRect[], x: number, y: number): TileSpan | null {
  for (const r of rects) if (x >= r.x && x <= r.x + r.w && y >= r.y && y < r.y + r.h) return r.span;
  return null;
}

const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export function drawGantt(
  ctx: CanvasRenderingContext2D,
  rects: readonly GanttRect[],
  threads: number,
  width: number,
  rowH: number,
  labelW: number,
): void {
  ctx.clearRect(0, 0, width + labelW, threads * rowH);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let t = 0; t < threads; t++) {
    ctx.fillStyle = '#8a8a96';
    ctx.fillText(`T${t}`, 2, t * rowH + rowH / 2);
    ctx.fillStyle = t % 2 ? '#1a1a22' : '#16161d';
    ctx.fillRect(labelW, t * rowH, width, rowH);
  }
  for (const r of rects) {
    ctx.fillStyle = css(threadColor(r.span.thread));
    // 1px surface gap between neighbouring tiles of the same thread.
    ctx.fillRect(labelW + r.x, r.y + 1, Math.max(1, r.w - 1), r.h - 2);
  }
}

export function drawKernelTimeline(
  ctx: CanvasRenderingContext2D,
  samples: readonly { iteration: number; ms: number }[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (samples.length < 2) return;
  const max = Math.max(...samples.map((s) => s.ms));
  ctx.strokeStyle = '#3987e5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = (i / (samples.length - 1)) * width;
    const y = height - 4 - (s.ms / max) * (height - 16);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#8a8a96';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(`max ${max.toFixed(3)} ms / generation`, 4, 10);
}
```

Run : `npx vitest run monitor-views` → Attendu : 3 PASS.

- [ ] **Step 3 : Panneau de monitoring**

`web/index.html` : dans `.stage`, après `#bench-view`, ajouter `<section id="monitor" hidden></section>`.

`web/src/style.css` :

```css
#monitor { position: absolute; left: 0; right: 0; bottom: 0; max-height: 45%; overflow: auto; background: rgba(10, 10, 15, 0.92); border-top: 1px solid #33333f; padding: 8px 12px; font-size: 0.8rem; color: var(--muted); }
#monitor[hidden] { display: none; }
#monitor canvas { display: block; width: 100%; }
#monitor .tip { color: var(--text); min-height: 1.2em; }
#monitor .activity { display: grid; grid-template-columns: 3em 1fr 4em; gap: 2px 8px; align-items: center; }
#monitor .activity i { display: block; height: 6px; border-radius: 3px; }
```

`web/src/ui/monitor-panel.ts` :

```ts
import { overlayValues, threadColor } from '../monitor/colors';
import type { CpuMonitor, GpuMonitor } from '../monitor/model';
import { drawGantt, drawKernelTimeline, ganttLayout, hitTest, type GanttRect } from '../monitor/views';

export type OverlayMode = 'off' | 'thread' | 'heat';

export interface MonitorPanelOptions {
  cores: number;
  onOverlay(mode: OverlayMode): void;
}

const ROW_H = 10;
const LABEL_W = 26;
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export function createMonitorPanel(root: HTMLElement, opts: MonitorPanelOptions) {
  let rects: GanttRect[] = [];
  let mode: 'cpu' | 'gpu' = 'cpu';
  root.innerHTML = `
    <div class="cpu">
      <label>Overlay <select id="m-overlay"><option value="off">off</option><option value="thread">tile → thread</option><option value="heat">tile → duration (heat)</option></select></label>
      <p>Last iterations, one row per thread. Blank = tile skipped by lazy tiling.</p>
      <canvas id="m-gantt" height="160"></canvas>
      <p class="tip" id="m-tip"></p>
      <div class="activity" id="m-activity"></div>
      <p id="m-lost"></p>
      <p>Browsers do not expose which physical core runs a worker: rows are threads, not cores (navigator.hardwareConcurrency = ${opts.cores}).</p>
    </div>
    <div class="gpu" hidden>
      <p>Kernel time per generation (GPU timestamps).</p>
      <canvas id="m-kernel" height="120"></canvas>
      <p>No per-thread information on GPU: kernel time per generation only.</p>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const gantt = $<HTMLCanvasElement>('#m-gantt');
  const overlay = $<HTMLSelectElement>('#m-overlay');
  overlay.onchange = () => opts.onOverlay(overlay.value as OverlayMode);
  gantt.onmousemove = (ev) => {
    const r = gantt.getBoundingClientRect();
    const s = hitTest(rects, ((ev.clientX - r.left) * gantt.width) / r.width - LABEL_W, ((ev.clientY - r.top) * gantt.height) / r.height);
    $('#m-tip').textContent = s ? `thread ${s.thread} · tile ${s.tile} · iteration ${s.iteration} · ${(s.end - s.start).toFixed(3)} ms` : '';
  };

  return {
    showMode(m: 'cpu' | 'gpu') {
      mode = m;
      $('.cpu').hidden = m !== 'cpu';
      $('.gpu').hidden = m !== 'gpu';
    },
    overlayMode: (): OverlayMode => (mode === 'cpu' ? (overlay.value as OverlayMode) : 'off'),
    renderCpu(m: CpuMonitor) {
      const { spans, t0, t1 } = m.window();
      const width = gantt.clientWidth - LABEL_W;
      gantt.width = gantt.clientWidth;
      gantt.height = Math.max(ROW_H, m.threads * ROW_H);
      rects = ganttLayout(spans, m.threads, t0, t1, width, ROW_H);
      drawGantt(gantt.getContext('2d')!, rects, m.threads, width, ROW_H, LABEL_W);
      const act = $('#m-activity');
      act.replaceChildren();
      m.activity().forEach((pct, t) => {
        const label = document.createElement('span');
        label.textContent = `T${t}`;
        const bar = document.createElement('i');
        bar.style.width = `${pct}%`;
        bar.style.background = css(threadColor(t));
        const val = document.createElement('span');
        val.textContent = `${pct.toFixed(0)}%`;
        act.append(label, bar, val);
      });
      $('#m-lost').textContent = m.lost ? `${m.lost} tile records dropped (trace ring full between frames)` : '';
    },
    renderGpu(m: GpuMonitor) {
      const k = $<HTMLCanvasElement>('#m-kernel');
      k.width = k.clientWidth;
      drawKernelTimeline(k.getContext('2d')!, m.samples(), k.width, k.height);
    },
    overlayFor(m: CpuMonitor) {
      const tiles = m.latestTiles();
      const o = overlay.value as OverlayMode;
      return tiles && o !== 'off' ? { mode: o, tilesPerSide: tiles.tilesPerSide, values: overlayValues(o, tiles) } : null;
    },
  };
}
```

- [ ] **Step 4 : Interrupteur et câblage**

`web/src/ui/panel.ts` :
- dans `#tab-live`, sous le sélecteur de motif : `<label class="toggle"><input type="checkbox" id="monitoring"> Monitoring</label>` ;
- `PanelOptions.onMonitoring(enabled: boolean): void;` → `$('#monitoring').onchange = () => opts.onMonitoring($<HTMLInputElement>('#monitoring').checked);`
- `PanelHandle.setMonitoringAvailable(reason: string | null)` : grise la case et pose `title = reason` quand `reason` n'est pas `null` (et la décoche) ;
- `config()` reste inchangé : le monitoring est géré par `main.ts`.

`web/src/main.ts` :
- `let monitoring = false;` ; `const cpuMonitor = new CpuMonitor(); const gpuMonitor = new GpuMonitor();` ; `const monitorPanel = createMonitorPanel(document.querySelector('#monitor')!, { cores: navigator.hardwareConcurrency, onOverlay: () => { dirty = true; } });`
- `monitoringReason(engineId)` : `null` si `tracedVariant(engineId)` existe, que cette variante est disponible (`engineUnavailable`) et, pour `wasm-mt`, que `navigator.hardwareConcurrency ≥ 2` ; sinon une raison lisible (« Monitoring is available for wasm-mt and WebGPU engines », ou la raison d'indisponibilité de la variante) ;
- `load(config)` : `cpuMonitor.clear(); gpuMonitor.clear(); renderer.setOverlay(null);`, puis charger `monitoring ? tracedVariant(config.engineId)! : config.engineId`, et appeler `panel.setMonitoringAvailable(monitoringReason(config.engineId))` ;
- `onMonitoring: (on) => { monitoring = on; document.querySelector('#monitor')!.hidden = !on; monitorPanel.showMode(config.engineId.startsWith('webgpu') ? 'gpu' : 'cpu'); void load(panel.config()); }`
- dans `Session`, `onTrace: (b) => { if (b.kind === 'cpu') { cpuMonitor.push(b); monitorDirty = true; } else { gpuMonitor.push(b); monitorDirty = true; } }` ;
- dans `tick` (hors benchmark) : si `monitoring && monitorDirty`, alors `monitorDirty = false`, puis `renderCpu` ou `renderGpu`, et pour le CPU `const o = monitorPanel.overlayFor(cpuMonitor); renderer.setOverlay(o && { ...o, tileSize: 32 }); dirty = true;`. Garder l'ordre : `requestFrame`, puis la mise à jour du monitoring, puis `draw`.

- [ ] **Step 5 : Vérifier dans le navigateur**

Run : `npm run typecheck && npm test && npm run build`, puis :
1. `wasm-mt`, 1024² random, Monitoring ✓, Play → Gantt à N lignes rempli, activité par thread entre 0 et 100 %, info-bulle au survol.
2. Overlay `tile → thread` → la grille est teintée par tuile. `guns` → seules les tuiles actives sont teintées.
3. Overlay heat → dégradé d'une seule teinte.
4. Taille 1000² (Review Focus 5) : choisir 1024 puis, en console, forcer `load({engineId:'wasm-mt', presetId:'random', size:1000})`. Les tuiles du bord droit et bas sont teintées, et l'anneau extérieur ne l'est pas.
5. `webgpu-naive` + Monitoring → timeline du temps kernel qui avance, texte « No per-thread information on GPU ». Sans `timestamp-query`, la case est grisée avec sa raison.
6. `wasm-seq` → case Monitoring grisée avec sa raison.
7. Changer de moteur pendant le monitoring → les vues se vident puis se remplissent avec le nouveau moteur. Aucune erreur console.
8. Onglet Benchmark → la liste ne contient aucune variante tracée.

- [ ] **Step 6 : Commit**

```bash
git add web/index.html web/src/style.css web/src/ui web/src/monitor/views.ts web/src/main.ts web/test/monitor-views.test.ts
git commit -m "feat(web): live monitoring panel with Gantt, activity and GPU timeline"
```
