# Jalon 2 — Moteurs WebGPU naïf + tuilé : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** deux moteurs WebGPU compute, `webgpu-naive` et `webgpu-tiled` (mémoire partagée de workgroup), sélectionnables dans l'UI jusqu'en 8192², avec un rendu sans copie et une page `?selftest` qui vérifie chaque moteur contre `wasm-seq` par hash.

**Architecture :** un seul `WebGpuEngine` paramétré par son shader WGSL. Il tient deux storage buffers `u32` qu'il alterne (ping-pong) et encode N générations comme N dispatches dans une seule compute pass par soumission. `frame()` renvoie le `GPUBuffer` courant au renderer, qui partage le même `GPUDevice`. Les moteurs reçoivent un `EngineEnv { device, limits }` à leur création.

**Tech Stack :** WebGPU / WGSL, TypeScript, Vitest (logique pure), navigateur intégré (page `?selftest`).

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), jalon 2. Ce plan s'appuie sur le jalon 1 (`docs/superpowers/plans/2026-10-06-m1-web-base-wasm-seq.md`), déjà livré.

## Global Constraints

- Moteurs WebGPU : 1 `u32` par cellule (0 ou 1). Le buffer reste sur le GPU et `frame()` le donne au renderer sans copie.
- Bords morts identiques à la référence `wasm-seq` : l'anneau extérieur vaut toujours 0 et n'est jamais écrit. *(Le kernel OpenCL de 2020 faisait évoluer les cellules de bord, contrairement au séquentiel. Le portage suit la référence pour que les hashes concordent.)*
- Le TypeScript ne contient aucune règle du jeu de la vie : le calcul est dans le WGSL, et TS ne fait que l'upload, l'encodage des commandes et la lecture du hash.
- Les tailles au-delà des limites de l'adaptateur (`size² × 4` > `min(maxStorageBufferBindingSize, maxBufferSize)`) sont grisées. 8192 est proposé aux moteurs GPU uniquement.
- Workgroup 16×16, comme `TILEX = TILEY = 16` dans `easypap-se/src/ocl.c`.
- Code, commentaires, UI et commits en anglais. Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pas de push sans un « oui » explicite de Laurent.

## Review Focus

1. **Taille non multiple de 16** (ex. 100) → les invocations hors grille ne lisent ni n'écrivent rien, et le hash est identique à `wasm-seq`. Test : cas `random 100` du selftest (Task 4).
2. **Changement de moteur pendant la lecture alors que le renderer affiche un buffer GPU** → aucune erreur de validation WebGPU sur un buffer détruit. Le renderer est vidé avant le rechargement. Test : vérification console en Task 5.
3. **8192² sur un adaptateur dont la limite est plus basse** → l'option est grisée et jamais proposée. Test : `maxGpuSize` (Task 1).
4. **Gros `step(n)` (lots du runner jusqu'à 65 536)** → découpé en soumissions de 256 dispatches au plus, sans blocage du thread principal pendant l'encodage. Vérifié en Task 5 (lecture fluide en 512²).
5. **Hash d'un moteur GPU lu pendant qu'un pas est en cours** → la lecture passe par la même file, donc l'ordre est garanti. Test : selftest (Task 4).

---

### Task 1 : `EngineEnv`, limites de taille et upload `u32` par morceaux

**Files :**
- Create : `web/src/engines/gpu-limits.ts`, `web/src/engines/upload.ts`
- Modify : `web/src/engines/registry.ts`
- Test : `web/test/gpu-limits.test.ts`, `web/test/upload.test.ts`

**Interfaces :**
- Produces :
  - `interface EngineEnv { device: GPUDevice; limits: { maxStorageBufferBindingSize: number; maxBufferSize: number } }`
  - `maxGpuSize(limits: EngineEnv['limits'], sizes: readonly number[]): number` : la plus grande taille telle que `size*size*4 <= min(limits)`, ou 0 si aucune
  - `uploadCells(cells: Uint8Array, size: number, write: (byteOffset: number, data: Uint32Array) => void, chunkCells?: number): void` : convertit en `u32` 0/1, bord forcé à 0, par morceaux de `chunkCells` (défaut `1 << 20`)
  - `EngineInfo` devient `{ id; label; maxSize(env: EngineEnv): number; create(env: EngineEnv): Engine }`. `wasm-seq` a `maxSize = () => 4096` et ignore `env`.
  - `export const SIZES = [512, 1024, 2048, 4096, 8192] as const` dans `registry.ts`

- [ ] **Step 1 : Tests qui échouent**

`web/test/gpu-limits.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { maxGpuSize } from '../src/engines/gpu-limits';

const SIZES = [512, 1024, 2048, 4096, 8192];

describe('maxGpuSize', () => {
  it('allows 8192 when both limits fit 8192² u32 cells (256 MiB)', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 2 ** 28, maxBufferSize: 2 ** 28 }, SIZES)).toBe(8192);
  });

  it('is bounded by the smaller of the two limits', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 2 ** 27, maxBufferSize: 2 ** 30 }, SIZES)).toBe(4096);
  });

  it('returns 0 when even the smallest size does not fit', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 1024, maxBufferSize: 1024 }, SIZES)).toBe(0);
  });
});
```

`web/test/upload.test.ts` :

```ts
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
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run : `npx vitest run gpu-limits upload`
Attendu : FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter**

`web/src/engines/gpu-limits.ts` :

```ts
export interface GpuLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
}

export function maxGpuSize(limits: GpuLimits, sizes: readonly number[]): number {
  const maxBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  let best = 0;
  for (const s of sizes) if (s * s * 4 <= maxBytes && s > best) best = s;
  return best;
}
```

`web/src/engines/upload.ts` :

```ts
// Converts the u8 grid to the GPU's u32 layout in bounded chunks, so an 8192² grid
// never needs a 256 MiB temporary array on the JS heap.
export function uploadCells(
  cells: Uint8Array,
  size: number,
  write: (byteOffset: number, data: Uint32Array) => void,
  chunkCells = 1 << 20,
): void {
  const total = size * size;
  for (let start = 0; start < total; start += chunkCells) {
    const end = Math.min(total, start + chunkCells);
    const out = new Uint32Array(end - start);
    for (let i = start; i < end; i++) {
      const x = i % size;
      const y = (i - x) / size;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      out[i - start] = !border && cells[i] !== 0 ? 1 : 0;
    }
    write(start * 4, out);
  }
}
```

`web/src/engines/registry.ts` (remplace le fichier) :

```ts
import type { Engine } from '../engine';
import { CpuWorkerEngine } from './cpu-worker-engine';
import type { GpuLimits } from './gpu-limits';

export const SIZES = [512, 1024, 2048, 4096, 8192] as const;

export interface EngineEnv {
  device: GPUDevice;
  limits: GpuLimits;
}

export interface EngineInfo {
  id: string;
  label: string;
  maxSize(env: EngineEnv): number;
  create(env: EngineEnv): Engine;
}

// CPU engines stop at 4096: the spec reserves 8192 for GPU engines.
const CPU_MAX_SIZE = 4096;

export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'wasm-seq',
    label: 'WASM seq — C 2020, reference',
    maxSize: () => CPU_MAX_SIZE,
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

Adapter `web/src/main.ts` pour que ça compile :
- `import { ENGINES, getEngine, SIZES, type EngineEnv } from './engines/registry';` et supprimer la constante locale `SIZES`
- juste après la création du renderer : `const env: EngineEnv = { device: gpu.device, limits: gpu.adapter.limits };`
- `createEngine: (id) => getEngine(id).create(env),`

- [ ] **Step 4 : Tests + typecheck**

Run : `npm test && npm run typecheck`
Attendu : tout PASS, 6 nouveaux tests.

- [ ] **Step 5 : Commit**

```bash
git add web/src/engines/gpu-limits.ts web/src/engines/upload.ts web/src/engines/registry.ts web/src/main.ts web/test/gpu-limits.test.ts web/test/upload.test.ts
git commit -m "feat(web): engine env, GPU size limits and chunked u32 upload"
```

---

### Task 2 : Harnais de selftest (logique pure)

**Files :**
- Create : `web/src/selftest/selftest.ts`
- Modify : `web/test/fakes.ts` (ajoute `BrokenEngine`)
- Test : `web/test/selftest.test.ts`

**Interfaces :**
- Consumes : `Engine` (M1), `Grid` (M1), `FakeEngine` (M1)
- Produces :
  - `interface SelfTestCase { presetId: string; size: number; gens: number }`
  - `interface SelfTestResult { engineId: string; testCase: SelfTestCase; expected: string; actual: string | null; ok: boolean; error?: string }`
  - `interface SelfTestDeps { referenceId: string; engineIds: readonly string[]; createEngine(id: string): Engine; buildGrid(presetId: string, size: number): Grid }`
  - `runSelfTest(deps: SelfTestDeps, cases: readonly SelfTestCase[]): Promise<SelfTestResult[]>` : une ligne par (moteur hors référence × cas), chaque moteur est disposé même en cas d'erreur
  - `SELFTEST_CASES: readonly SelfTestCase[]` = `random 100 × 37`, `random 256 × 100`, `guns 256 × 300`, `random 1024 × 50`

- [ ] **Step 1 : Test qui échoue**

Ajouter à `web/test/fakes.ts` :

```ts
// Computes one generation too many per step, like an off-by-one kernel would.
export class BrokenEngine extends FakeEngine {
  override async step(n: number): Promise<void> {
    await super.step(n + 1);
  }
}
```

`web/test/selftest.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { Engine } from '../src/engine';
import { createGrid } from '../src/grid';
import { runSelfTest } from '../src/selftest/selftest';
import { BrokenEngine, FakeEngine } from './fakes';

function deps(make: Record<string, () => FakeEngine>) {
  const created: FakeEngine[] = [];
  return {
    created,
    deps: {
      referenceId: 'ref',
      engineIds: Object.keys(make).filter((id) => id !== 'ref'),
      createEngine: (id: string): Engine => {
        const e = make[id]();
        created.push(e);
        return e;
      },
      buildGrid: (_p: string, size: number) => createGrid(size),
    },
  };
}

const CASE = { presetId: 'random', size: 16, gens: 10 };

describe('runSelfTest', () => {
  it('passes an engine whose hash matches the reference', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), good: () => new FakeEngine() });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'good', ok: true, expected: '10', actual: '10' });
  });

  it('flags an engine whose hash differs', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), bad: () => new BrokenEngine() });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'bad', ok: false, expected: '10', actual: '11' });
  });

  it('records an engine that throws and still disposes every engine', async () => {
    const { deps: d, created } = deps({
      ref: () => new FakeEngine(),
      boom: () => {
        const e = new FakeEngine();
        e.initError = new Error('no adapter');
        return e;
      },
    });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'boom', ok: false, actual: null, error: 'no adapter' });
    expect(created.every((e) => e.disposed)).toBe(true);
  });

  it('returns one row per engine and case', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine(), b: () => new FakeEngine() });
    const rows = await runSelfTest(d, [CASE, { ...CASE, gens: 3 }]);
    expect(rows.map((r) => `${r.engineId}:${r.testCase.gens}`)).toEqual(['a:10', 'b:10', 'a:3', 'b:3']);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run : `npx vitest run selftest`
Attendu : FAIL, module introuvable.

- [ ] **Step 3 : Implémenter**

`web/src/selftest/selftest.ts` :

```ts
import type { Engine } from '../engine';
import type { Grid } from '../grid';

export interface SelfTestCase {
  presetId: string;
  size: number;
  gens: number;
}

export interface SelfTestResult {
  engineId: string;
  testCase: SelfTestCase;
  expected: string;
  actual: string | null;
  ok: boolean;
  error?: string;
}

export interface SelfTestDeps {
  referenceId: string;
  engineIds: readonly string[];
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
}

// 100 is deliberately not a multiple of the 16×16 workgroup.
export const SELFTEST_CASES: readonly SelfTestCase[] = [
  { presetId: 'random', size: 100, gens: 37 },
  { presetId: 'random', size: 256, gens: 100 },
  { presetId: 'guns', size: 256, gens: 300 },
  { presetId: 'random', size: 1024, gens: 50 },
];

async function hashAfter(engine: Engine, grid: Grid, gens: number): Promise<string> {
  try {
    await engine.init(grid);
    await engine.step(gens);
    return await engine.hash();
  } finally {
    engine.dispose();
  }
}

export async function runSelfTest(deps: SelfTestDeps, cases: readonly SelfTestCase[]): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  for (const testCase of cases) {
    const grid = deps.buildGrid(testCase.presetId, testCase.size);
    const expected = await hashAfter(deps.createEngine(deps.referenceId), grid, testCase.gens);
    for (const engineId of deps.engineIds) {
      try {
        const actual = await hashAfter(deps.createEngine(engineId), grid, testCase.gens);
        results.push({ engineId, testCase, expected, actual, ok: actual === expected });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ engineId, testCase, expected, actual: null, ok: false, error });
      }
    }
  }
  return results;
}
```

- [ ] **Step 4 : Tests**

Run : `npm test && npm run typecheck`
Attendu : tout PASS, 4 nouveaux tests.

- [ ] **Step 5 : Commit**

```bash
git add web/src/selftest/selftest.ts web/test/fakes.ts web/test/selftest.test.ts
git commit -m "feat(web): self-test harness comparing engines to the reference by hash"
```

---

### Task 3 : Page `?selftest` (rouge tant qu'il n'y a pas de moteur GPU)

**Files :**
- Create : `web/src/selftest/page.ts`
- Modify : `web/src/main.ts`, `web/src/style.css`

**Interfaces :**
- Consumes : `runSelfTest`, `SELFTEST_CASES` (Task 2), `ENGINES`, `getEngine`, `EngineEnv` (Task 1), `buildGrid` (M1)
- Produces : `runSelfTestPage(root: HTMLElement, env: EngineEnv): Promise<void>`. Met `document.title` à `selftest: pass` ou `selftest: fail`, et expose `window.__selftest = results` pour Playwright (jalon 5).

- [ ] **Step 1 : Implémenter la page**

`web/src/selftest/page.ts` :

```ts
import { ENGINES, getEngine, type EngineEnv } from '../engines/registry';
import { buildGrid } from '../patterns/presets';
import { runSelfTest, SELFTEST_CASES, type SelfTestResult } from './selftest';

declare global {
  interface Window {
    __selftest?: SelfTestResult[];
  }
}

const REFERENCE = 'wasm-seq';

export async function runSelfTestPage(root: HTMLElement, env: EngineEnv): Promise<void> {
  root.innerHTML = '<h1>Self-test</h1><p id="st-status">running…</p><table id="st"></table>';
  const results = await runSelfTest(
    {
      referenceId: REFERENCE,
      engineIds: ENGINES.map((e) => e.id).filter((id) => id !== REFERENCE),
      createEngine: (id) => getEngine(id).create(env),
      buildGrid,
    },
    SELFTEST_CASES,
  );
  const pass = results.length > 0 && results.every((r) => r.ok);
  const table = root.querySelector<HTMLTableElement>('#st')!;
  const head = table.insertRow();
  for (const h of ['engine', 'case', 'expected', 'actual', 'result']) head.insertCell().textContent = h;
  for (const r of results) {
    const row = table.insertRow();
    row.className = r.ok ? 'ok' : 'ko';
    row.insertCell().textContent = r.engineId;
    row.insertCell().textContent = `${r.testCase.presetId} ${r.testCase.size}² × ${r.testCase.gens}`;
    row.insertCell().textContent = r.expected;
    row.insertCell().textContent = r.actual ?? '—';
    row.insertCell().textContent = r.ok ? 'pass' : `FAIL${r.error ? `: ${r.error}` : ''}`;
  }
  root.querySelector('#st-status')!.textContent = results.length === 0 ? 'no engine to compare' : pass ? 'pass' : 'fail';
  document.title = `selftest: ${pass ? 'pass' : 'fail'}`;
  window.__selftest = results;
}
```

Dans `web/src/main.ts`, juste après la création de `env` :

```ts
  if (new URLSearchParams(location.search).has('selftest')) {
    document.querySelector<HTMLElement>('.app')!.hidden = true;
    const root = document.createElement('main');
    root.className = 'selftest';
    document.body.append(root);
    await runSelfTestPage(root, env);
    return;
  }
```

avec `import { runSelfTestPage } from './selftest/page';`.

Ajouter à `web/src/style.css` :

```css
.app[hidden] { display: none; }
.selftest { padding: 16px; font-variant-numeric: tabular-nums; }
.selftest table { border-collapse: collapse; }
.selftest td { padding: 4px 10px; border-bottom: 1px solid #33333f; }
.selftest tr.ok td:last-child { color: #7bd88f; }
.selftest tr.ko td:last-child { color: var(--error); }
```

- [ ] **Step 2 : Vérifier l'état rouge dans le navigateur**

Ouvrir `http://localhost:5173/?selftest` (preview `web-dev`).
Attendu : statut `no engine to compare`, titre `selftest: fail`. Aucun moteur GPU n'existe encore : c'est l'état RED de la Task 4.

- [ ] **Step 3 : Typecheck + commit**

Run : `npm run typecheck && npm test`

```bash
git add web/src/selftest/page.ts web/src/main.ts web/src/style.css
git commit -m "feat(web): ?selftest page checking every engine against wasm-seq"
```

---

### Task 4 : `WebGpuEngine` + shaders naïf et tuilé

**Files :**
- Create : `web/src/engines/webgpu/life-naive.wgsl`, `web/src/engines/webgpu/life-tiled.wgsl`, `web/src/engines/webgpu-engine.ts`
- Modify : `web/src/engines/registry.ts`

**Interfaces :**
- Consumes : `Engine`, `FrameSource` (M1) ; `EngineEnv`, `maxGpuSize`, `uploadCells`, `SIZES` (Task 1) ; `hashCells` (M1)
- Produces : `class WebGpuEngine implements Engine { constructor(id: string, device: GPUDevice, shaderCode: string) }`, et deux entrées de registre `webgpu-naive` et `webgpu-tiled`

- [ ] **Step 1 : Shaders**

`web/src/engines/webgpu/life-naive.wgsl` (portage direct de `life_ocl`, une invocation par cellule) :

```wgsl
struct Params { size: u32 }

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cur: array<u32>;
@group(0) @binding(2) var<storage, read_write> next: array<u32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.size;
  let x = id.x;
  let y = id.y;
  // Dead border like the reference kernel; also drops out-of-grid invocations.
  if (x == 0u || y == 0u || x >= n - 1u || y >= n - 1u) {
    return;
  }
  var count = 0u;
  for (var dy = 0u; dy < 3u; dy++) {
    for (var dx = 0u; dx < 3u; dx++) {
      if (dx != 1u || dy != 1u) {
        count += select(0u, 1u, cur[(y + dy - 1u) * n + x + dx - 1u] != 0u);
      }
    }
  }
  let me = cur[y * n + x] != 0u;
  next[y * n + x] = select(0u, 1u, count == 3u || (me && count == 2u));
}
```

`web/src/engines/webgpu/life-tiled.wgsl` (tuile 16×16 + halo d'une cellule en mémoire de workgroup) :

```wgsl
struct Params { size: u32 }

const TILE: u32 = 16u;
const HALO: u32 = 18u; // TILE + 2

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cur: array<u32>;
@group(0) @binding(2) var<storage, read_write> next: array<u32>;

var<workgroup> tile: array<u32, 324>; // HALO * HALO

@compute @workgroup_size(16, 16)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let n = params.size;
  let ox = wg.x * TILE;
  let oy = wg.y * TILE;
  // 256 invocations cooperatively load the 18×18 tile, halo included; outside cells read as dead.
  for (var i = li; i < HALO * HALO; i += TILE * TILE) {
    let gx = i32(ox + i % HALO) - 1;
    let gy = i32(oy + i / HALO) - 1;
    var v = 0u;
    if (gx >= 0 && gy >= 0 && gx < i32(n) && gy < i32(n)) {
      v = cur[u32(gy) * n + u32(gx)];
    }
    tile[i] = select(0u, 1u, v != 0u);
  }
  workgroupBarrier();

  let x = ox + lid.x;
  let y = oy + lid.y;
  if (x == 0u || y == 0u || x >= n - 1u || y >= n - 1u) {
    return;
  }
  let c = (lid.y + 1u) * HALO + lid.x + 1u;
  let count = tile[c - HALO - 1u] + tile[c - HALO] + tile[c - HALO + 1u]
            + tile[c - 1u] + tile[c + 1u]
            + tile[c + HALO - 1u] + tile[c + HALO] + tile[c + HALO + 1u];
  next[y * n + x] = select(0u, 1u, count == 3u || (tile[c] == 1u && count == 2u));
}
```

- [ ] **Step 2 : Moteur**

`web/src/engines/webgpu-engine.ts` :

```ts
import type { Engine, FrameSource } from '../engine';
import { hashCells, type Grid } from '../grid';
import { uploadCells } from './upload';

const WORKGROUP = 16;
// Bounds a single submit so huge live batches never build one giant command buffer.
const MAX_DISPATCHES_PER_SUBMIT = 256;

export class WebGpuEngine implements Engine {
  private readonly pipeline: GPUComputePipeline;
  private buffers: [GPUBuffer, GPUBuffer] | null = null;
  // bindGroups[i] reads buffers[i] and writes buffers[1 - i].
  private bindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
  private params: GPUBuffer | null = null;
  private current = 0;
  private size = 0;

  constructor(
    readonly id: string,
    private readonly device: GPUDevice,
    shaderCode: string,
  ) {
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  }

  async init(grid: Grid): Promise<void> {
    this.release();
    const bytes = grid.size * grid.size * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const a = this.device.createBuffer({ size: bytes, usage });
    const b = this.device.createBuffer({ size: bytes, usage });
    uploadCells(grid.cells, grid.size, (offset, data) => this.device.queue.writeBuffer(a, offset, data));
    const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([grid.size, 0, 0, 0]));
    const layout = this.pipeline.getBindGroupLayout(0);
    const bind = (src: GPUBuffer, dst: GPUBuffer) =>
      this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: dst } },
        ],
      });
    this.buffers = [a, b];
    this.bindGroups = [bind(a, b), bind(b, a)];
    this.params = params;
    this.current = 0;
    this.size = grid.size;
    await this.device.queue.onSubmittedWorkDone();
  }

  async step(n: number): Promise<void> {
    const bindGroups = this.need().bindGroups;
    const groups = Math.ceil(this.size / WORKGROUP);
    for (let left = n; left > 0; left -= MAX_DISPATCHES_PER_SUBMIT) {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      // Dispatches in one pass are ordered with storage barriers between them: one per generation.
      for (let i = 0; i < Math.min(left, MAX_DISPATCHES_PER_SUBMIT); i++) {
        pass.setBindGroup(0, bindGroups[this.current]);
        pass.dispatchWorkgroups(groups, groups);
        this.current ^= 1;
      }
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async frame(): Promise<FrameSource> {
    return { kind: 'gpu', size: this.size, buffer: this.need().buffers[this.current] };
  }

  async hash(): Promise<string> {
    const { buffers } = this.need();
    const bytes = this.size * this.size * 4;
    const staging = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffers[this.current], 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const h = hashCells(new Uint32Array(staging.getMappedRange()));
    staging.unmap();
    staging.destroy();
    return h;
  }

  dispose(): void {
    this.release();
  }

  private need(): { buffers: [GPUBuffer, GPUBuffer]; bindGroups: [GPUBindGroup, GPUBindGroup] } {
    if (!this.buffers || !this.bindGroups) throw new Error('engine used before init');
    return { buffers: this.buffers, bindGroups: this.bindGroups };
  }

  private release(): void {
    this.buffers?.forEach((b) => b.destroy());
    this.params?.destroy();
    this.buffers = null;
    this.bindGroups = null;
    this.params = null;
  }
}
```

- [ ] **Step 3 : Registre**

Dans `web/src/engines/registry.ts`, ajouter les imports :

```ts
import { maxGpuSize } from './gpu-limits';
import naiveShader from './webgpu/life-naive.wgsl?raw';
import tiledShader from './webgpu/life-tiled.wgsl?raw';
import { WebGpuEngine } from './webgpu-engine';
```

et ajouter ces deux entrées à la fin de `ENGINES` :

```ts
  {
    id: 'webgpu-naive',
    label: 'WebGPU naive — OpenCL 2020 in WGSL',
    maxSize: (env) => maxGpuSize(env.limits, SIZES),
    create: (env) => new WebGpuEngine('webgpu-naive', env.device, naiveShader),
  },
  {
    id: 'webgpu-tiled',
    label: 'WebGPU tiled — workgroup shared memory',
    maxSize: (env) => maxGpuSize(env.limits, SIZES),
    create: (env) => new WebGpuEngine('webgpu-tiled', env.device, tiledShader),
  },
```

- [ ] **Step 4 : Selftest vert dans le navigateur**

Run : `npm run typecheck && npm test`, puis ouvrir `http://localhost:5173/?selftest`.
Attendu : 8 lignes (2 moteurs × 4 cas), toutes `pass`, titre `selftest: pass`, aucune erreur console.
Si une ligne échoue seulement sur `random 100`, le problème vient du traitement des invocations hors grille. Le vérifier avant de toucher à la règle.

- [ ] **Step 5 : Commit**

```bash
git add web/src/engines/webgpu web/src/engines/webgpu-engine.ts web/src/engines/registry.ts
git commit -m "feat(web): WebGPU naive and tiled compute engines"
```

---

### Task 5 : UI — tailles par moteur, renderer vidé au rechargement

**Files :**
- Modify : `web/src/ui/panel.ts`, `web/src/render/renderer.ts`, `web/src/main.ts`

**Interfaces :**
- Consumes : `EngineInfo.maxSize`, `EngineEnv`, `SIZES` (Task 1)
- Produces :
  - `PanelOptions.maxSize(engineId: string): number`
  - `GridRenderer.clear(): void`, qui retire le buffer lié : `draw` ne fait rien jusqu'au prochain `setFrame`

- [ ] **Step 1 : `GridRenderer.clear()`**

Ajouter dans `web/src/render/renderer.ts`, après `setFrame` :

```ts
  // Drops the reference to an engine-owned GPU buffer before that engine is disposed.
  clear(): void {
    this.boundBuffer = null;
    this.bindGroup = null;
  }
```

- [ ] **Step 2 : Panneau — tailles grisées par moteur**

Dans `web/src/ui/panel.ts` :
- ajouter `maxSize(engineId: string): number;` à `PanelOptions` ;
- ajouter, après `syncPresets` :

```ts
  // Sizes beyond the selected engine's limit stay visible but disabled.
  const syncSizes = () => {
    const max = opts.maxSize(engine.value);
    for (const o of size.options) {
      o.disabled = Number(o.value) > max;
      o.textContent = o.disabled ? `${o.value} × ${o.value} (n/a for this engine)` : `${o.value} × ${o.value}`;
    }
    if (size.selectedOptions[0]?.disabled) {
      const allowed = [...size.options].filter((o) => !o.disabled);
      if (allowed.length) size.value = allowed[allowed.length - 1].value;
    }
  };
  syncSizes();
  syncPresets();
```

  et retirer l'appel isolé `syncPresets();` existant ;
- dans `changed`, appeler `syncSizes();` avant `syncPresets();`.

- [ ] **Step 3 : `main.ts`**

- passer `maxSize: (id) => getEngine(id).maxSize(env),` à `createPanel` ;
- dans `load()`, appeler `renderer.clear();` en première ligne.

- [ ] **Step 4 : Vérifier dans le navigateur**

Run : `npm run typecheck && npm test && npm run build`. Puis, sur `http://localhost:5173` :
1. Moteur `WebGPU naive`, 1024² random → Play : la grille évolue et gens/s ≫ `wasm-seq`.
2. Moteur `WebGPU tiled` : même chose.
3. Taille 8192 : disponible pour les moteurs GPU si l'adaptateur le permet, grisée pour `wasm-seq`. Repasser sur `wasm-seq` alors que 8192 est choisi → la taille retombe à 4096.
4. Pendant la lecture, alterner 5 fois entre `webgpu-tiled` et `wasm-seq` → aucune erreur console (en particulier aucune « destroyed buffer »).
5. `?selftest` → toujours `selftest: pass`.

- [ ] **Step 5 : Commit**

```bash
git add web/src/ui/panel.ts web/src/render/renderer.ts web/src/main.ts
git commit -m "feat(web): per-engine size limits and safe renderer reset on reload"
```
