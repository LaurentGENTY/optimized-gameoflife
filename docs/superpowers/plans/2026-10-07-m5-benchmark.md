# Jalon 5 — Mode benchmark, graphique, garde de correction : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un onglet Benchmark qui mesure chaque moteur sans rendu. Chaque moteur est d'abord vérifié contre `wasm-seq` par hash, puis mesuré : warm-up, durée ≥ 1 s, médiane de 3 runs. Les résultats s'affichent en barres groupées sur échelle log (une figure par motif, barres « C natif 2020 » si `bench/native.json` existe), avec un tableau et un export JSON. S'y ajoute un test Playwright local du `?selftest`.

**Architecture :** la logique est pure et testée dans Node : `measure` (calibrage + runs), `runBench` (matrice, garde, progression, annulation), `buildChartSvg` (SVG statique), `report` (JSON + natif). L'UI ne fait que l'orchestration : elle met la session live en pause, n'envoie aucune demande de frame pendant la mesure, puis affiche la vue benchmark par-dessus le canvas.

**Tech Stack :** TypeScript, SVG fait main (pas de dépendance graphique), Vitest, Playwright (`channel: 'chrome'`, Chrome système).

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), section 4 et jalon 5.

## Global Constraints

- Aucun rendu pendant une mesure : la session live est en pause, et ni `requestFrame` ni `draw` n'ont lieu tant qu'un benchmark tourne.
- Protocole : 50 générations de warm-up, nombre de générations calibré pour qu'un run dure ≥ 1 000 ms, médiane de 3 runs. Chaque run repart de la même grille (`init`, puis warm-up), pour que les moteurs lazy ne profitent pas d'une grille déjà éteinte.
- Garde de correction : avant de mesurer, le hash de chaque moteur après `GUARD_GENS = 32` générations est comparé à celui de `wasm-seq`. Un moteur divergent est marqué `invalid`, n'est pas mesuré et n'apparaît pas dans le graphique. La référence tourne à toutes les tailles, 8192 compris, même si l'UI limite `wasm-seq` à 4096.
- Métriques : gens/s et Gcells/s (`gensPerSec × size² / 1e9`). Le temps kernel GPU par timestamp queries est reporté au jalon 6, avec la timeline GPU qui en a besoin.
- Motifs : `random` (dense), `guns` (clairsemé) à toutes les tailles, et `otca-off` (clairsemé) aux tailles ≥ 2176.
- Tailles : 512, 1024, 2048, 4096, plus 8192 pour les moteurs GPU (bornées par `EngineInfo.maxSize`).
- Graphique : barres groupées par taille, une figure par motif, une seule échelle y (log10, gens/s), une légende HTML, une info-bulle `<title>` par barre, et un tableau des résultats comme vue alternative. Palette sombre validée (`validate_palette.js --mode dark --surface #15151c`, tout PASS) : moteurs `#3987e5, #d95926, #199e70, #c98500, #d55181`, natif 2020 `#008300, #9085e9, #e66767` hachurés.
- `bench/native.json`, à la racine du repo, est produit au jalon 7. Son absence est normale et ne doit rien casser.
- Code, commentaires, UI et commits en anglais. Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.

## Review Focus

1. **Moteur qui échoue en plein benchmark** (allocation GPU 8192 refusée, worker planté) → ligne `error`, le benchmark continue avec les cas suivants. Test : Task 2.
2. **Annulation** → arrêt au prochain point de contrôle, le moteur en cours est disposé et aucun résultat partiel faux n'est produit. Test : Task 2.
3. **Moteur très rapide** (GPU sur 512², > 50 000 gens/s) → le calibrage converge sans boucle infinie et respecte un plafond `maxGens`. Test : Task 1.
4. **Données manquantes** (taille non mesurée pour un moteur, pas de `native.json`, tous les résultats invalides) → le graphique s'affiche sans barre fantôme, avec un message si vide. Test : Task 3.
5. **Lancer « Run » deux fois ou changer d'onglet pendant un run** → un seul benchmark à la fois, la session live reste en pause jusqu'au retour sur Live. Vérification : Task 4.

---

### Task 1 : `measure` — calibrage et médiane

**Files :**
- Create : `web/src/bench/measure.ts`
- Test : `web/test/measure.test.ts`

**Interfaces :**
- Consumes : `Engine` (M1), `Grid` (M1)
- Produces :
  - `median(xs: readonly number[]): number`
  - `interface MeasureOptions { warmupGens: number; minMs: number; runs: number; maxGens: number; now(): number; signal?: AbortSignal }`
  - `const DEFAULT_MEASURE: Omit<MeasureOptions, 'now' | 'signal'> = { warmupGens: 50, minMs: 1000, runs: 3, maxGens: 1 << 22 }`
  - `interface Measurement { gens: number; runsMs: number[]; gensPerSec: number }`
  - `measure(engine: Engine, grid: Grid, o: MeasureOptions): Promise<Measurement>`
  - `throwIfAborted(signal?: AbortSignal): void` (lève une `DOMException('Benchmark cancelled', 'AbortError')`)

- [ ] **Step 1 : Test qui échoue**

`web/test/measure.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { Engine, FrameSource } from '../src/engine';
import { createGrid, type Grid } from '../src/grid';
import { measure, median } from '../src/bench/measure';

// Engine on a fake clock: each generation costs `msPerGen`; records every call.
class ClockEngine implements Engine {
  readonly id = 'clock';
  t = 0;
  calls: string[] = [];
  constructor(private readonly msPerGen: number) {}
  async init(grid: Grid) {
    this.calls.push(`init:${grid.size}`);
  }
  async step(n: number) {
    this.calls.push(`step:${n}`);
    this.t += n * this.msPerGen;
  }
  async frame(): Promise<FrameSource> {
    throw new Error('frame() must not be called while measuring');
  }
  async hash() {
    return '';
  }
  dispose() {}
}

const opts = (e: ClockEngine, extra = {}) => ({
  warmupGens: 50,
  minMs: 1000,
  runs: 3,
  maxGens: 1 << 22,
  now: () => e.t,
  ...extra,
});

describe('median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('measure', () => {
  it('calibrates the generation count so a run lasts at least minMs', async () => {
    const e = new ClockEngine(2); // 500 gens/s
    const m = await measure(e, createGrid(8), opts(e));
    expect(m.runsMs).toHaveLength(3);
    for (const ms of m.runsMs) expect(ms).toBeGreaterThanOrEqual(1000);
    expect(m.gensPerSec).toBeCloseTo(500);
  });

  it('restarts every run from the initial grid with a warm-up and never renders', async () => {
    const e = new ClockEngine(1);
    const m = await measure(e, createGrid(8), opts(e));
    const runs = e.calls.slice(-9);
    expect(runs).toEqual([
      'init:8', 'step:50', `step:${m.gens}`,
      'init:8', 'step:50', `step:${m.gens}`,
      'init:8', 'step:50', `step:${m.gens}`,
    ]);
  });

  it('stops calibrating at maxGens for extremely fast engines', async () => {
    const e = new ClockEngine(1e-6);
    const m = await measure(e, createGrid(8), opts(e, { maxGens: 1 << 20 }));
    expect(m.gens).toBe(1 << 20);
  });

  it('aborts between steps when the signal fires', async () => {
    const e = new ClockEngine(1);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(measure(e, createGrid(8), opts(e, { signal: ctrl.signal }))).rejects.toThrow(/cancelled/);
  });
});
```

Run : `npx vitest run measure` → Attendu : FAIL, module introuvable.

- [ ] **Step 2 : Implémenter**

`web/src/bench/measure.ts` :

```ts
import type { Engine } from '../engine';
import type { Grid } from '../grid';

export interface MeasureOptions {
  warmupGens: number;
  minMs: number;
  runs: number;
  maxGens: number;
  now(): number;
  signal?: AbortSignal;
}

export const DEFAULT_MEASURE: Omit<MeasureOptions, 'now' | 'signal'> = {
  warmupGens: 50,
  minMs: 1000,
  runs: 3,
  maxGens: 1 << 22,
};

export interface Measurement {
  gens: number;
  runsMs: number[];
  gensPerSec: number;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Benchmark cancelled', 'AbortError');
}

async function timed(engine: Engine, gens: number, now: () => number): Promise<number> {
  const t0 = now();
  await engine.step(gens);
  return now() - t0;
}

export async function measure(engine: Engine, grid: Grid, o: MeasureOptions): Promise<Measurement> {
  throwIfAborted(o.signal);
  await engine.init(grid);
  await engine.step(o.warmupGens);

  // Calibration: grow the batch until one timed step lasts minMs (aiming 10% above).
  let gens = 1;
  for (;;) {
    throwIfAborted(o.signal);
    const ms = await timed(engine, gens, o.now);
    if (ms >= o.minMs || gens >= o.maxGens) break;
    const target = ms > 0 ? Math.ceil((gens * o.minMs * 1.1) / ms) : gens * 2;
    gens = Math.min(o.maxGens, Math.max(gens * 2, target));
  }

  // Each run restarts from the same grid: lazy engines must not benefit from a grid that died out.
  const runsMs: number[] = [];
  for (let r = 0; r < o.runs; r++) {
    throwIfAborted(o.signal);
    await engine.init(grid);
    await engine.step(o.warmupGens);
    runsMs.push(await timed(engine, gens, o.now));
  }
  return { gens, runsMs, gensPerSec: (gens * 1000) / median(runsMs) };
}
```

> Note : si le calibrage s'arrête à `maxGens` avant `minMs`, les runs durent moins d'1 s. C'est voulu pour les moteurs extrêmes, et les `runsMs` exportés le montrent.

Run : `npx vitest run measure && npm run typecheck` → Attendu : 5 PASS.

- [ ] **Step 3 : Commit**

```bash
git add web/src/bench/measure.ts web/test/measure.test.ts
git commit -m "feat(web): benchmark measurement with calibration and median of runs"
```

---

### Task 2 : `runBench` — matrice, garde de correction, rapport JSON

**Files :**
- Create : `web/src/bench/run.ts`, `web/src/bench/report.ts`
- Modify : `web/vite.config.ts` (`server.fs.allow` pour lire `../bench/native.json`)
- Test : `web/test/bench-run.test.ts`, `web/test/bench-report.test.ts`

**Interfaces :**
- Consumes : `measure`, `DEFAULT_MEASURE`, `throwIfAborted`, `MeasureOptions` (Task 1) ; `Engine`, `Grid`
- Produces :
  - `interface BenchCase { engineId: string; presetId: string; size: number }`
  - `type BenchStatus = 'ok' | 'invalid' | 'error'`
  - `interface BenchRow extends BenchCase { status: BenchStatus; gens?: number; runsMs?: number[]; gensPerSec?: number; gcellsPerSec?: number; expectedHash?: string; actualHash?: string; error?: string }`
  - `const BENCH_PRESETS = ['random', 'guns', 'otca-off'] as const`, `const GUARD_GENS = 32`
  - `benchMatrix(engineIds: readonly string[], sizes: readonly number[], presets: readonly { id: string; minSize: number }[], maxSize: (engineId: string) => number): BenchCase[]` : ordre preset → taille → moteur, sans les cas hors limites
  - `interface BenchDeps { referenceId: string; createEngine(id: string): Engine; buildGrid(presetId: string, size: number): Grid; now(): number; signal?: AbortSignal; onProgress?(done: number, total: number, next: BenchCase | null): void; measure?: Partial<Omit<MeasureOptions, 'now' | 'signal'>> }`
  - `runBench(cases: readonly BenchCase[], deps: BenchDeps): Promise<BenchRow[]>`
  - `report.ts` : `interface Machine { cores: number; gpu: string; userAgent: string }`, `interface BenchReport { version: 1; date: string; machine: Machine; guardGens: number; rows: BenchRow[] }`, `reportToJson(r: BenchReport): string`, `type NativeVariant = 'seq' | 'omp_tiled' | 'ocl'`, `interface NativeReport { machine: string; date: string; results: { variant: NativeVariant; presetId: string; size: number; gensPerSec: number }[] }`, `loadNativeReport(): NativeReport | null`, `parseNativeReport(value: unknown): NativeReport | null`

- [ ] **Step 1 : Tests qui échouent**

`web/test/bench-run.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/grid';
import { benchMatrix, runBench, type BenchDeps } from '../src/bench/run';
import { BrokenEngine, FakeEngine } from './fakes';

const PRESETS = [
  { id: 'random', minSize: 3 },
  { id: 'otca-off', minSize: 2176 },
];

describe('benchMatrix', () => {
  it('skips presets above the size and sizes above each engine limit', () => {
    const cases = benchMatrix(['cpu', 'gpu'], [512, 8192], PRESETS, (id) => (id === 'cpu' ? 4096 : 8192));
    expect(cases.map((c) => `${c.presetId}/${c.size}/${c.engineId}`)).toEqual([
      'random/512/cpu',
      'random/512/gpu',
      'random/8192/gpu',
      'otca-off/8192/gpu',
    ]);
  });
});

function deps(make: Record<string, () => FakeEngine>, extra: Partial<BenchDeps> = {}, onNow?: (t: number) => void) {
  const created: FakeEngine[] = [];
  const d: BenchDeps = {
    referenceId: 'ref',
    createEngine: (id) => {
      const e = make[id]();
      created.push(e);
      return e;
    },
    buildGrid: (_p, size) => createGrid(size),
    // Fake clock: 10 ms per generation computed by any engine.
    now: () => {
      const t = created.reduce((sum, e) => sum + e.generation * 10, 0);
      onNow?.(t);
      return t;
    },
    measure: { warmupGens: 2, minMs: 100, runs: 3, maxGens: 1 << 12 },
    ...extra,
  };
  return { d, created };
}

const CASE = { engineId: 'a', presetId: 'random', size: 16 };

describe('runBench', () => {
  it('measures an engine that matches the reference', async () => {
    const { d } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine() });
    const [row] = await runBench([CASE], d);
    expect(row.status).toBe('ok');
    expect(row.gensPerSec).toBeCloseTo(100);
    expect(row.gcellsPerSec).toBeCloseTo((100 * 16 * 16) / 1e9);
  });

  it('marks a diverging engine invalid and does not measure it', async () => {
    const { d } = deps({ ref: () => new FakeEngine(), a: () => new BrokenEngine() });
    const [row] = await runBench([CASE], d);
    expect(row).toMatchObject({ status: 'invalid', expectedHash: '32', actualHash: '33' });
    expect(row.gensPerSec).toBeUndefined();
  });

  it('records an engine error and carries on with the next case', async () => {
    const { d, created } = deps({
      ref: () => new FakeEngine(),
      a: () => {
        const e = new FakeEngine();
        e.initError = new Error('GPU out of memory');
        return e;
      },
      b: () => new FakeEngine(),
    });
    const rows = await runBench([CASE, { ...CASE, engineId: 'b' }], d);
    expect(rows.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(rows[0].error).toBe('GPU out of memory');
    expect(created.every((e) => e.disposed)).toBe(true);
  });

  it('computes the reference hash once per preset and size', async () => {
    const { d, created } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine(), b: () => new FakeEngine() });
    await runBench([CASE, { ...CASE, engineId: 'b' }], d);
    expect(created.filter((e) => e.id === 'fake').length).toBe(3); // 1 reference + 2 engines
  });

  it('reports progress before each case and at the end', async () => {
    const seen: string[] = [];
    const { d } = deps(
      { ref: () => new FakeEngine(), a: () => new FakeEngine() },
      { onProgress: (done, total, next) => seen.push(`${done}/${total}:${next?.engineId ?? '-'}`) },
    );
    await runBench([CASE], d);
    expect(seen).toEqual(['0/1:a', '1/1:-']);
  });

  it('stops on cancellation during a measurement, disposes the engine and rejects', async () => {
    const ctrl = new AbortController();
    // Reference and guard use 2 × 32 gens = 640 ms; the first clock read in measure() aborts.
    const { d, created } = deps(
      { ref: () => new FakeEngine(), a: () => new FakeEngine() },
      { signal: ctrl.signal },
      (t) => t > 500 && ctrl.abort(),
    );
    await expect(runBench([CASE], d)).rejects.toThrow(/cancelled/);
    expect(created).toHaveLength(2);
    expect(created.every((e) => e.disposed)).toBe(true);
  });
});
```

`web/test/bench-report.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { parseNativeReport, reportToJson } from '../src/bench/report';

describe('reportToJson', () => {
  it('round-trips the report with version and rows', () => {
    const r = {
      version: 1 as const,
      date: '2026-10-07T10:00:00.000Z',
      machine: { cores: 8, gpu: 'acme', userAgent: 'test' },
      guardGens: 32,
      rows: [{ engineId: 'a', presetId: 'random', size: 512, status: 'ok' as const, gensPerSec: 10 }],
    };
    expect(JSON.parse(reportToJson(r))).toEqual(r);
  });
});

describe('parseNativeReport', () => {
  it('accepts a well-formed native.json', () => {
    const n = { machine: 'M3', date: '2026-10-07', results: [{ variant: 'seq', presetId: 'random', size: 512, gensPerSec: 1200 }] };
    expect(parseNativeReport(n)).toEqual(n);
  });

  it('rejects malformed content instead of crashing the chart', () => {
    expect(parseNativeReport({ results: [{ variant: 'cuda', size: 'big' }] })).toBeNull();
    expect(parseNativeReport(null)).toBeNull();
  });
});
```

Run : `npx vitest run bench-run bench-report` → Attendu : FAIL, modules introuvables.

> Le fake clock du test : `now()` vaut 10 ms × la somme des générations calculées par tous les moteurs. Un seul moteur avance pendant un `measure`, donc la mesure vaut 100 gens/s exactement.

- [ ] **Step 2 : Implémenter**

`web/src/bench/run.ts` :

```ts
import type { Engine } from '../engine';
import type { Grid } from '../grid';
import { DEFAULT_MEASURE, measure, throwIfAborted, type MeasureOptions } from './measure';

export const BENCH_PRESETS = ['random', 'guns', 'otca-off'] as const;
export const GUARD_GENS = 32;

export interface BenchCase {
  engineId: string;
  presetId: string;
  size: number;
}

export type BenchStatus = 'ok' | 'invalid' | 'error';

export interface BenchRow extends BenchCase {
  status: BenchStatus;
  gens?: number;
  runsMs?: number[];
  gensPerSec?: number;
  gcellsPerSec?: number;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
}

export interface BenchDeps {
  referenceId: string;
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
  now(): number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number, next: BenchCase | null): void;
  measure?: Partial<Omit<MeasureOptions, 'now' | 'signal'>>;
}

export function benchMatrix(
  engineIds: readonly string[],
  sizes: readonly number[],
  presets: readonly { id: string; minSize: number }[],
  maxSize: (engineId: string) => number,
): BenchCase[] {
  const cases: BenchCase[] = [];
  for (const p of presets)
    for (const size of sizes) {
      if (size < p.minSize) continue;
      for (const engineId of engineIds) if (size <= maxSize(engineId)) cases.push({ engineId, presetId: p.id, size });
    }
  return cases;
}

async function hashAfter(engine: Engine, grid: Grid, gens: number): Promise<string> {
  await engine.init(grid);
  await engine.step(gens);
  return engine.hash();
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export async function runBench(cases: readonly BenchCase[], deps: BenchDeps): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  const grids = new Map<string, Grid>();
  const references = new Map<string, string>();
  const options: MeasureOptions = { ...DEFAULT_MEASURE, ...deps.measure, now: deps.now, signal: deps.signal };

  for (const [i, c] of cases.entries()) {
    deps.onProgress?.(i, cases.length, c);
    throwIfAborted(deps.signal);
    const key = `${c.presetId}/${c.size}`;
    let grid = grids.get(key);
    if (!grid) {
      grid = deps.buildGrid(c.presetId, c.size);
      grids.clear(); // cases are grouped by preset and size: keep only the current grid in memory
      grids.set(key, grid);
    }
    let expected = references.get(key);
    if (expected === undefined) {
      const ref = deps.createEngine(deps.referenceId);
      try {
        expected = await hashAfter(ref, grid, GUARD_GENS);
      } finally {
        ref.dispose();
      }
      references.set(key, expected);
    }

    const engine = deps.createEngine(c.engineId);
    try {
      const actual = await hashAfter(engine, grid, GUARD_GENS);
      if (actual !== expected) {
        rows.push({ ...c, status: 'invalid', expectedHash: expected, actualHash: actual });
        continue;
      }
      const m = await measure(engine, grid, options);
      rows.push({
        ...c,
        status: 'ok',
        gens: m.gens,
        runsMs: m.runsMs,
        gensPerSec: m.gensPerSec,
        gcellsPerSec: (m.gensPerSec * c.size * c.size) / 1e9,
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      rows.push({ ...c, status: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      engine.dispose();
    }
  }
  deps.onProgress?.(cases.length, cases.length, null);
  return rows;
}
```

> Le moteur de référence est créé avant le moteur testé, d'où les 3 instances de `FakeEngine` attendues dans le test « reference hash once ». Les `FakeEngine` ont tous l'id `fake`.

`web/src/bench/report.ts` :

```ts
import type { BenchRow } from './run';

export interface Machine {
  cores: number;
  gpu: string;
  userAgent: string;
}

export interface BenchReport {
  version: 1;
  date: string;
  machine: Machine;
  guardGens: number;
  rows: BenchRow[];
}

export function reportToJson(r: BenchReport): string {
  return JSON.stringify(r, null, 2);
}

export type NativeVariant = 'seq' | 'omp_tiled' | 'ocl';
const VARIANTS: readonly NativeVariant[] = ['seq', 'omp_tiled', 'ocl'];

export interface NativeReport {
  machine: string;
  date: string;
  results: { variant: NativeVariant; presetId: string; size: number; gensPerSec: number }[];
}

export function parseNativeReport(value: unknown): NativeReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<NativeReport>;
  if (typeof v.machine !== 'string' || typeof v.date !== 'string' || !Array.isArray(v.results)) return null;
  const ok = v.results.every(
    (r) =>
      r &&
      VARIANTS.includes(r.variant) &&
      typeof r.presetId === 'string' &&
      Number.isInteger(r.size) &&
      typeof r.gensPerSec === 'number' &&
      r.gensPerSec > 0,
  );
  return ok ? (v as NativeReport) : null;
}

// bench/native.json is produced on Laurent's Mac in milestone 7; it may not exist yet.
const nativeFiles = import.meta.glob('../../../bench/native.json', { eager: true, import: 'default' });

export function loadNativeReport(): NativeReport | null {
  const [value] = Object.values(nativeFiles);
  return parseNativeReport(value);
}
```

`web/vite.config.ts` : dans `server`, ajouter `fs: { allow: ['..'] }`, pour que le serveur de dev puisse lire `../bench/native.json` :

```ts
  server: { headers: isolation, fs: { allow: ['..'] } },
```

Run : `npm test && npm run typecheck` → Attendu : tout PASS, 9 nouveaux tests.

- [ ] **Step 3 : Commit**

```bash
git add web/src/bench/run.ts web/src/bench/report.ts web/vite.config.ts web/test/bench-run.test.ts web/test/bench-report.test.ts
git commit -m "feat(web): benchmark runner with correctness guard and JSON report"
```

---

### Task 3 : `buildChartSvg` — barres groupées, échelle log

**Files :**
- Create : `web/src/bench/chart.ts`
- Test : `web/test/chart.test.ts`

**Interfaces :**
- Produces :
  - `interface ChartSeries { id: string; label: string; color: string; hatched?: boolean }`
  - `interface ChartDatum { seriesId: string; size: number; value: number }` (gens/s)
  - `logTicks(min: number, max: number): number[]` : puissances de 10 qui couvrent `[min, max]`
  - `formatRate(v: number): string` : `0.5`, `12`, `1.2k`, `35k`, `1.5M`
  - `buildChartSvg(o: { title: string; sizes: readonly number[]; series: readonly ChartSeries[]; data: readonly ChartDatum[]; width: number; height: number }): string`
  - `const ENGINE_COLORS: Record<string, string>`, `const NATIVE_SERIES: readonly ChartSeries[]`

- [ ] **Step 1 : Test qui échoue**

`web/test/chart.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { buildChartSvg, formatRate, logTicks, type ChartSeries } from '../src/bench/chart';

const SERIES: ChartSeries[] = [
  { id: 'a', label: 'Engine A', color: '#3987e5' },
  { id: 'b', label: 'Engine <B>', color: '#d95926' },
  { id: 'n', label: 'Native', color: '#008300', hatched: true },
];

function bars(svg: string) {
  return [...svg.matchAll(/<path class="bar" data-series="([^"]+)" data-size="(\d+)" data-h="([\d.]+)"/g)].map((m) => ({
    series: m[1],
    size: Number(m[2]),
    h: Number(m[3]),
  }));
}

const base = { title: 'Random 50%', sizes: [512, 1024], series: SERIES, width: 600, height: 300 };

describe('chart helpers', () => {
  it('logTicks covers the range with powers of ten', () => {
    expect(logTicks(3, 2500)).toEqual([1, 10, 100, 1000, 10000]);
    expect(logTicks(100, 100)).toEqual([100, 1000]);
  });

  it('formatRate is compact', () => {
    expect([0.5, 12, 1234, 35000, 1.5e6].map(formatRate)).toEqual(['0.5', '12', '1.2k', '35k', '1.5M']);
  });
});

describe('buildChartSvg', () => {
  it('draws one bar per datum, taller for faster engines', () => {
    const svg = buildChartSvg({
      ...base,
      data: [
        { seriesId: 'a', size: 512, value: 100 },
        { seriesId: 'b', size: 512, value: 10000 },
        { seriesId: 'a', size: 1024, value: 30 },
      ],
    });
    const b = bars(svg);
    expect(b).toHaveLength(3);
    const h = (s: string, size: number) => b.find((x) => x.series === s && x.size === size)!.h;
    expect(h('b', 512)).toBeGreaterThan(h('a', 512));
    expect(h('a', 512)).toBeGreaterThan(h('a', 1024));
  });

  it('gives each bar a tooltip and escapes labels', () => {
    const svg = buildChartSvg({ ...base, data: [{ seriesId: 'b', size: 512, value: 1234 }] });
    expect(svg).toContain('<title>Engine &lt;B&gt; · 512² · 1.2k gens/s</title>');
    expect(svg).not.toContain('Engine <B>');
  });

  it('fills hatched series with a pattern', () => {
    const svg = buildChartSvg({ ...base, data: [{ seriesId: 'n', size: 1024, value: 50 }] });
    expect(svg).toMatch(/<pattern id="hatch-n"/);
    expect(svg).toContain('fill="url(#hatch-n)"');
  });

  it('shows a message instead of an empty plot when there is no data', () => {
    const svg = buildChartSvg({ ...base, data: [] });
    expect(bars(svg)).toHaveLength(0);
    expect(svg).toContain('No valid results');
  });
});
```

Run : `npx vitest run chart` → Attendu : FAIL, module introuvable.

- [ ] **Step 2 : Implémenter**

`web/src/bench/chart.ts` :

```ts
export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  hatched?: boolean;
}

export interface ChartDatum {
  seriesId: string;
  size: number;
  value: number;
}

// Dark categorical palette, validated against the panel surface #15151c (all checks pass).
export const ENGINE_COLORS: Record<string, string> = {
  'wasm-seq': '#3987e5',
  'wasm-simd': '#d95926',
  'wasm-mt': '#199e70',
  'webgpu-naive': '#c98500',
  'webgpu-tiled': '#d55181',
};

export const NATIVE_SERIES: readonly ChartSeries[] = [
  { id: 'native-seq', label: 'C 2020 native — seq', color: '#008300', hatched: true },
  { id: 'native-omp_tiled', label: 'C 2020 native — OpenMP tiled', color: '#9085e9', hatched: true },
  { id: 'native-ocl', label: 'C 2020 native — OpenCL', color: '#e66767', hatched: true },
];

const SURFACE = '#15151c';
const INK = '#e6e6ea';
const MUTED = '#8a8a96';
const GRID = '#2a2a33';

export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)));
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e++) ticks.push(10 ** e);
  return ticks;
}

export function formatRate(v: number): string {
  const trim = (x: number) => (x >= 10 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());
  if (v >= 1e6) return `${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${trim(v / 1e3)}k`;
  return trim(v);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bar rising from the baseline, 4px rounded top corners.
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function buildChartSvg(o: {
  title: string;
  sizes: readonly number[];
  series: readonly ChartSeries[];
  data: readonly ChartDatum[];
  width: number;
  height: number;
}): string {
  const m = { top: 28, right: 12, bottom: 32, left: 52 };
  const plotW = o.width - m.left - m.right;
  const plotH = o.height - m.top - m.bottom;
  const base = m.top + plotH;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="100%" role="img" aria-label="${esc(o.title)}" font-family="system-ui, sans-serif" font-size="11">`;
  const title = `<text x="${m.left}" y="16" fill="${INK}" font-size="13" font-weight="600">${esc(o.title)}</text>`;
  const values = o.data.map((d) => d.value).filter((v) => v > 0);
  if (values.length === 0) {
    return `${head}${title}<text x="${o.width / 2}" y="${o.height / 2}" fill="${MUTED}" text-anchor="middle">No valid results</text></svg>`;
  }

  const ticks = logTicks(Math.min(...values), Math.max(...values));
  const lo = Math.log10(ticks[0]);
  const hi = Math.log10(ticks[ticks.length - 1]);
  const y = (v: number) => base - ((Math.log10(v) - lo) / (hi - lo)) * plotH;

  const parts: string[] = [head, title];
  const defs = o.series
    .filter((s) => s.hatched)
    .map(
      (s) =>
        `<pattern id="hatch-${esc(s.id)}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">` +
        `<rect width="6" height="6" fill="${s.color}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${SURFACE}" stroke-width="2"/></pattern>`,
    );
  if (defs.length) parts.push(`<defs>${defs.join('')}</defs>`);

  for (const t of ticks) {
    const ty = y(t);
    parts.push(`<line x1="${m.left}" x2="${m.left + plotW}" y1="${ty}" y2="${ty}" stroke="${GRID}"/>`);
    parts.push(`<text x="${m.left - 6}" y="${ty + 4}" fill="${MUTED}" text-anchor="end">${formatRate(t)}</text>`);
  }
  parts.push(`<text x="12" y="${m.top + plotH / 2}" fill="${MUTED}" transform="rotate(-90 12 ${m.top + plotH / 2})" text-anchor="middle">gens/s (log)</text>`);

  const groupW = plotW / o.sizes.length;
  o.sizes.forEach((size, gi) => {
    const present = o.series.filter((s) => o.data.some((d) => d.seriesId === s.id && d.size === size));
    const slot = Math.min(18, (groupW * 0.8) / Math.max(1, present.length));
    const barW = slot - 2; // 2px surface gap between adjacent bars
    const x0 = m.left + gi * groupW + (groupW - slot * present.length) / 2;
    present.forEach((s, si) => {
      const d = o.data.find((q) => q.seriesId === s.id && q.size === size)!;
      const top = y(d.value);
      const fill = s.hatched ? `url(#hatch-${esc(s.id)})` : s.color;
      parts.push(
        `<path class="bar" data-series="${esc(s.id)}" data-size="${size}" data-h="${(base - top).toFixed(2)}" d="${barPath(x0 + si * slot, barW, top, base)}" fill="${fill}">` +
          `<title>${esc(s.label)} · ${size}² · ${formatRate(d.value)} gens/s</title></path>`,
      );
    });
    parts.push(`<text x="${m.left + gi * groupW + groupW / 2}" y="${base + 18}" fill="${MUTED}" text-anchor="middle">${size}²</text>`);
  });
  parts.push(`<line x1="${m.left}" x2="${m.left + plotW}" y1="${base}" y2="${base}" stroke="${MUTED}"/>`);
  parts.push('</svg>');
  return parts.join('');
}
```

Run : `npx vitest run chart && npm run typecheck` → Attendu : 6 PASS.

- [ ] **Step 3 : Commit**

```bash
git add web/src/bench/chart.ts web/test/chart.test.ts
git commit -m "feat(web): log-scale grouped bar chart for benchmark results"
```

---

### Task 4 : onglet Benchmark dans l'UI

**Files :**
- Create : `web/src/bench/view.ts`, `web/src/ui/bench-panel.ts`
- Modify : `web/index.html`, `web/src/style.css`, `web/src/ui/panel.ts`, `web/src/main.ts`

**Interfaces :**
- Consumes : `runBench`, `benchMatrix`, `BENCH_PRESETS`, `GUARD_GENS`, `BenchRow` (Task 2) ; `reportToJson`, `loadNativeReport`, `BenchReport` (Task 2) ; `buildChartSvg`, `ENGINE_COLORS`, `NATIVE_SERIES`, `formatRate` (Task 3) ; `ENGINES`, `SIZES`, `engineUnavailable`, `getEngine` (M2-M4) ; `PRESETS`, `getPreset`, `buildGrid` (M1)
- Produces :
  - `renderBenchView(root: HTMLElement, report: BenchReport | null, native: NativeReport | null, progress: string | null): void`
  - `createBenchPanel(root: HTMLElement, opts: BenchPanelOptions): BenchPanelHandle`
  - `PanelOptions.onTab(tab: 'live' | 'bench'): void` et un conteneur `#tab-bench` dans le panneau

- [ ] **Step 1 : Squelette HTML / CSS**

`web/index.html` : envelopper le canvas dans une scène et ajouter la vue benchmark :

```html
    <main class="app">
      <div class="stage">
        <canvas id="grid"></canvas>
        <section id="bench-view" hidden></section>
      </div>
      <aside id="panel"></aside>
    </main>
```

Ajouter à `web/src/style.css` :

```css
.stage { position: relative; min-width: 0; min-height: 0; }
#bench-view { position: absolute; inset: 0; overflow: auto; background: var(--bg); padding: 16px; }
#bench-view[hidden] { display: none; }
#bench-view .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
#bench-view .chart { background: var(--panel); border-radius: 8px; padding: 8px; }
#bench-view table { border-collapse: collapse; margin-top: 16px; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
#bench-view td, #bench-view th { padding: 4px 10px; border-bottom: 1px solid #33333f; text-align: left; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.8rem; color: var(--muted); margin: 8px 0 12px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.legend i.hatched { background-image: repeating-linear-gradient(45deg, transparent 0 2px, var(--panel) 2px 4px); }
.tabs { display: flex; gap: 6px; }
.tabs button[aria-selected='true'] { border-color: var(--accent); color: var(--accent); }
.checks { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.85rem; }
.checks label { flex-direction: row !important; align-items: center; gap: 4px !important; color: var(--text) !important; }
```

- [ ] **Step 2 : Vue benchmark**

`web/src/bench/view.ts` :

```ts
import { getPreset } from '../patterns/presets';
import { ENGINES } from '../engines/registry';
import { buildChartSvg, ENGINE_COLORS, formatRate, NATIVE_SERIES, type ChartDatum, type ChartSeries } from './chart';
import type { BenchReport, NativeReport } from './report';
import { BENCH_PRESETS } from './run';

function engineSeries(): ChartSeries[] {
  return ENGINES.map((e) => ({ id: e.id, label: e.label, color: ENGINE_COLORS[e.id] ?? '#8a8a96' }));
}

export function renderBenchView(
  root: HTMLElement,
  report: BenchReport | null,
  native: NativeReport | null,
  progress: string | null,
): void {
  root.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Benchmark — generations per second (higher is better)';
  root.append(h);
  const info = document.createElement('p');
  info.className = 'machine';
  info.textContent = report
    ? `${report.machine.cores} logical cores · ${report.machine.gpu} · ${new Date(report.date).toLocaleString('en')} · guard: hash vs wasm-seq after ${report.guardGens} gens`
    : 'Pick engines and sizes in the panel, then Run. Rendering is paused while measuring.';
  root.append(info);
  if (progress) {
    const p = document.createElement('p');
    p.className = 'stats';
    p.textContent = progress;
    root.append(p);
  }
  if (!report) return;

  const series = [...engineSeries(), ...(native ? NATIVE_SERIES : [])];
  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const s of series) {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.backgroundColor = s.color;
    if (s.hatched) sw.className = 'hatched';
    item.append(sw, s.label);
    legend.append(item);
  }
  root.append(legend);

  const charts = document.createElement('div');
  charts.className = 'charts';
  for (const presetId of BENCH_PRESETS) {
    const rows = report.rows.filter((r) => r.presetId === presetId);
    if (rows.length === 0) continue;
    const sizes = [...new Set(rows.map((r) => r.size))].sort((a, b) => a - b);
    const data: ChartDatum[] = rows
      .filter((r) => r.status === 'ok' && r.gensPerSec)
      .map((r) => ({ seriesId: r.engineId, size: r.size, value: r.gensPerSec! }));
    for (const n of native?.results ?? [])
      if (n.presetId === presetId && sizes.includes(n.size))
        data.push({ seriesId: `native-${n.variant}`, size: n.size, value: n.gensPerSec });
    const box = document.createElement('div');
    box.className = 'chart';
    // buildChartSvg escapes every label; the SVG is generated locally from numbers.
    box.innerHTML = buildChartSvg({ title: getPreset(presetId).label, sizes, series, data, width: 560, height: 280 });
    charts.append(box);
  }
  root.append(charts);

  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const t of ['engine', 'pattern', 'size', 'gens/s', 'Gcells/s', 'runs (ms)', 'status']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.append(th);
  }
  const body = table.createTBody();
  for (const r of report.rows) {
    const row = body.insertRow();
    const cells = [
      r.engineId,
      r.presetId,
      `${r.size}²`,
      r.gensPerSec ? formatRate(r.gensPerSec) : '—',
      r.gcellsPerSec ? r.gcellsPerSec.toFixed(2) : '—',
      r.runsMs ? r.runsMs.map((ms) => ms.toFixed(0)).join(' / ') : '—',
      r.status === 'ok' ? 'ok' : r.status === 'invalid' ? 'INVALID (hash mismatch, excluded)' : `error: ${r.error}`,
    ];
    for (const c of cells) row.insertCell().textContent = c;
  }
  root.append(table);
}
```

- [ ] **Step 3 : Panneau benchmark**

`web/src/ui/bench-panel.ts` :

```ts
export interface BenchPanelOptions {
  engines: readonly { id: string; label: string; disabledReason: string | null }[];
  sizes: readonly number[];
  defaultSizes: readonly number[];
  onRun(engineIds: string[], sizes: number[]): void;
  onCancel(): void;
  onExport(): void;
}

export interface BenchPanelHandle {
  setRunning(running: boolean): void;
  setExportable(ok: boolean): void;
}

export function createBenchPanel(root: HTMLElement, opts: BenchPanelOptions): BenchPanelHandle {
  root.innerHTML = `
    <label>Engines <div class="checks" id="b-engines"></div></label>
    <label>Sizes <div class="checks" id="b-sizes"></div></label>
    <div class="buttons"><button id="b-run">Run</button><button id="b-export" disabled>Export JSON</button></div>
    <p class="hint">Patterns: random (dense), guns and OTCA (sparse, ≥ 2176). Each engine is checked against wasm-seq first.</p>`;
  const box = (parent: HTMLElement, value: string, text: string, checked: boolean, disabled: string | null) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked && !disabled;
    input.disabled = disabled !== null;
    if (disabled) {
      label.title = disabled;
      input.dataset.unavailable = '1';
    }
    label.append(input, text);
    parent.append(label);
  };
  const engines = root.querySelector<HTMLElement>('#b-engines')!;
  const sizes = root.querySelector<HTMLElement>('#b-sizes')!;
  for (const e of opts.engines) box(engines, e.id, e.id, true, e.disabledReason);
  for (const s of opts.sizes) box(sizes, String(s), String(s), opts.defaultSizes.includes(s), null);
  const run = root.querySelector<HTMLButtonElement>('#b-run')!;
  const exp = root.querySelector<HTMLButtonElement>('#b-export')!;
  let running = false;
  const checked = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
  run.onclick = () => (running ? opts.onCancel() : opts.onRun(checked(engines), checked(sizes).map(Number)));
  exp.onclick = () => opts.onExport();
  return {
    setRunning: (r) => {
      running = r;
      run.textContent = r ? 'Cancel' : 'Run';
      for (const i of root.querySelectorAll<HTMLInputElement>('input')) i.disabled = r || i.dataset.unavailable === '1';
    },
    setExportable: (ok) => {
      exp.disabled = !ok;
    },
  };
}
```

> Une case de moteur indisponible porte `data-unavailable` : elle reste grisée après un run.

- [ ] **Step 4 : Onglets dans le panneau**

Dans `web/src/ui/panel.ts` :
- ajouter `onTab(tab: 'live' | 'bench'): void;` à `PanelOptions` ;
- remplacer le gabarit `root.innerHTML` par :

```ts
  root.innerHTML = `
    <h1>Game of Life <small>2020 → 2026</small></h1>
    <div class="tabs" role="tablist">
      <button role="tab" id="t-live" aria-selected="true">Live</button>
      <button role="tab" id="t-bench" aria-selected="false">Benchmark</button>
    </div>
    <div id="tab-live">
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
      <p class="hint">Wheel: zoom · drag: pan · double-click: fit</p>
    </div>
    <div id="tab-bench" hidden></div>
    <p id="machine" class="machine"></p>`;
```

  (le CSS `#panel label` existant s'applique toujours ; ajouter `#tab-live, #tab-bench { display: flex; flex-direction: column; gap: 12px; } #tab-live[hidden], #tab-bench[hidden] { display: none; }` à `style.css`) ;
- avant le `return`, brancher les onglets :

```ts
  const select = (tab: 'live' | 'bench') => {
    $('#t-live').setAttribute('aria-selected', String(tab === 'live'));
    $('#t-bench').setAttribute('aria-selected', String(tab === 'bench'));
    $('#tab-live').hidden = tab !== 'live';
    $('#tab-bench').hidden = tab !== 'bench';
    opts.onTab(tab);
  };
  $('#t-live').onclick = () => select('live');
  $('#t-bench').onclick = () => select('bench');
```

- [ ] **Step 5 : Câblage dans `main.ts`**

Ajouter les imports :

```ts
import { renderBenchView } from './bench/view';
import { benchMatrix, BENCH_PRESETS, GUARD_GENS, runBench } from './bench/run';
import { loadNativeReport, reportToJson, type BenchReport } from './bench/report';
import { createBenchPanel } from './ui/bench-panel';
import { getPreset } from './patterns/presets';
```

Après la création de `session` et de `load`, ajouter :

```ts
  const benchView = document.querySelector<HTMLElement>('#bench-view')!;
  const native = loadNativeReport();
  let report: BenchReport | null = null;
  let benchAbort: AbortController | null = null;
  let benchRunning = false;

  const benchPanel = createBenchPanel(document.querySelector<HTMLElement>('#tab-bench')!, {
    engines: ENGINES.map((e) => ({ id: e.id, label: e.label, disabledReason: engineUnavailable(e) })),
    sizes: SIZES,
    defaultSizes: [512, 1024, 2048],
    onCancel: () => benchAbort?.abort(),
    onExport: () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([reportToJson(report)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `gameoflife-bench-${report.date.slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    },
    onRun: (engineIds, sizes) => void runBenchmark(engineIds, sizes),
  });

  async function runBenchmark(engineIds: string[], sizes: number[]): Promise<void> {
    if (benchRunning) return;
    benchRunning = true;
    benchAbort = new AbortController();
    benchPanel.setRunning(true);
    await session.pause(); // no live compute and no frames while measuring
    panel.setPlaying(false);
    const presets = BENCH_PRESETS.map((id) => ({ id, minSize: getPreset(id).minSize }));
    const cases = benchMatrix(engineIds, sizes, presets, (id) => getEngine(id).maxSize(env));
    const started = new Date().toISOString();
    try {
      const rows = await runBench(cases, {
        referenceId: 'wasm-seq',
        createEngine: (id) => getEngine(id).create(env),
        buildGrid,
        now: () => performance.now(),
        signal: benchAbort.signal,
        onProgress: (done, total, next) =>
          renderBenchView(benchView, report, native, next ? `Running ${done + 1}/${total}: ${next.engineId} · ${next.presetId} · ${next.size}²` : null),
      });
      report = {
        version: 1,
        date: started,
        machine: { cores: navigator.hardwareConcurrency, gpu: gpu.label, userAgent: navigator.userAgent },
        guardGens: GUARD_GENS,
        rows,
      };
      benchPanel.setExportable(true);
      renderBenchView(benchView, report, native, null);
    } catch (err) {
      renderBenchView(benchView, report, native, err instanceof DOMException && err.name === 'AbortError' ? 'Cancelled.' : `Benchmark failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      benchRunning = false;
      benchAbort = null;
      benchPanel.setRunning(false);
    }
  }
```

et passer à `createPanel` :

```ts
    onTab: (tab) => {
      benchView.hidden = tab !== 'bench';
      if (tab === 'bench') {
        void session.pause().then(() => panel.setPlaying(false));
        renderBenchView(benchView, report, native, null);
      }
    },
```

> `benchView` est utilisé dans `onTab`, qui n'est appelé qu'après un clic, donc après sa déclaration. Si le typecheck signale un usage avant déclaration, déplacer la déclaration `const benchView = …` avant `createPanel`.

Enfin, ne rien dessiner pendant un benchmark : dans `tick`, entourer le contenu ainsi :

```ts
  const tick = () => {
    if (!benchRunning) {
      session.requestFrame();
      if (renderer.resize()) dirty = true;
      if (dirty && camera) {
        renderer.draw(camera);
        dirty = false;
      }
    }
    requestAnimationFrame(tick);
  };
```

(`benchRunning` doit être déclaré avant `tick`.)

- [ ] **Step 6 : Vérifier dans le navigateur**

Run : `npm run typecheck && npm test && npm run build`, puis sur `http://localhost:5173` :
1. Onglet Benchmark → la vue remplace la grille, et le live est en pause.
2. Sizes = 512 seul, tous moteurs → Run. La progression défile, puis un graphique par motif (random, guns), la légende et le tableau s'affichent. Statut `ok` partout.
3. Le survol d'une barre affiche l'info-bulle.
4. Export JSON → le fichier se télécharge et contient `version: 1` et toutes les lignes.
5. Run puis Cancel → « Cancelled. », le bouton revient à Run, aucune erreur console.
6. Retour sur Live → Play fonctionne.

- [ ] **Step 7 : Commit**

```bash
git add web/index.html web/src/style.css web/src/ui/panel.ts web/src/ui/bench-panel.ts web/src/bench/view.ts web/src/main.ts
git commit -m "feat(web): benchmark tab with charts, table and JSON export"
```

---

### Task 5 : Playwright — `?selftest` dans Chrome (local)

**Files :**
- Create : `web/playwright.config.ts`, `web/e2e/selftest.spec.ts`
- Modify : `web/package.json` (script `e2e`), `web/vite.config.ts` (exclure `e2e/` de Vitest est déjà fait par `include: ['test/**']`)

**Interfaces :**
- Consumes : la page `?selftest` (M2), `window.__selftest`

- [ ] **Step 1 : Installer et configurer**

```bash
npm install -D @playwright/test
```

Aucun navigateur n'est téléchargé : la config utilise le Chrome du système (`channel: 'chrome'`).

`web/playwright.config.ts` :

```ts
import { defineConfig } from '@playwright/test';

// Local only: CI runners have no GPU, so WebGPU engines cannot run there.
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:4173', headless: false },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 },
});
```

`web/e2e/selftest.spec.ts` :

```ts
import { expect, test } from '@playwright/test';

test('every engine matches wasm-seq in Chrome', async ({ page }) => {
  await page.goto('/?selftest');
  await expect(page).toHaveTitle(/^selftest: (pass|fail)$/, { timeout: 150_000 });
  const results = await page.evaluate(() => window.__selftest ?? []);
  const failures = results.filter((r) => !r.ok).map((r) => `${r.engineId} ${r.testCase.presetId} ${r.testCase.size}: ${r.error ?? `${r.actual} != ${r.expected}`}`);
  expect(failures).toEqual([]);
  expect(new Set(results.map((r) => r.engineId))).toEqual(new Set(['wasm-simd', 'wasm-mt', 'webgpu-naive', 'webgpu-tiled']));
});
```

`web/package.json`, dans `scripts` : `"e2e": "playwright test"`.

Dans `web/tsconfig.json`, ajouter `"e2e"` et `"playwright.config.ts"` à `include`.

- [ ] **Step 2 : Lancer**

Run : `npm run e2e`
Attendu : 1 test PASS. Une fenêtre Chrome s'ouvre, car `headless: false` : le mode headless de Chrome n'expose pas toujours un adaptateur WebGPU sur macOS. Si l'adaptateur manque malgré tout, le test échoue avec 0 moteur WebGPU : noter le message, ne pas affaiblir l'assertion.

- [ ] **Step 3 : Commit**

```bash
git add web/playwright.config.ts web/e2e web/package.json web/package-lock.json web/tsconfig.json
git commit -m "test(web): Playwright self-test of every engine in Chrome"
```
