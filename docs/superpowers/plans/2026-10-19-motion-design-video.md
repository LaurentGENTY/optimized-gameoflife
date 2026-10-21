# Motion design video "Descent into silicon" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Amended 2026-10-21:** the screens scene is now 6 bars (12 s: 2 s entrance + 10 s hold), the film 78 s / 4680 frames and the loop frames 2760–3359 — see the "Amendement 2026-10-21" section of the spec. Values below are the original plan.

**Goal:** Render a ~76 s motion design film (DA C "Silicon neon", concept 2) with synthesized music and SFX, from real Life simulations and real bench data, plus a 10 s muted loop for the portfolio card.

**Architecture:** A new `motion/` package (Vite + TypeScript) draws every frame deterministically on a 1920×1200 Canvas 2D through `window.renderFrame(i)`. A Node script drives it with Playwright, writes PNG frames (resumable), renders the audio with `OfflineAudioContext`, and ffmpeg encodes master, film, loop and posters. Visuals and audio share one cue table, so every SFX and musical layer lands on its visual event.

**Tech Stack:** TypeScript, Vite 8, Vitest 5, Playwright 1.63 (`channel: 'chrome'`), Canvas 2D, Web Audio, ffmpeg 9 (`/opt/homebrew/bin/ffmpeg`), Emscripten (`npm --prefix web run wasm`), `@fontsource/space-grotesk`.

**Spec:** `docs/superpowers/specs/2026-10-19-motion-design-video-design.md` (French). Styleframes: `.superpowers/brainstorm/*/content/directions-artistiques.html` (canvases `c1`, `c2`) and `concepts-da-c.html` (concept 2).

## Global Constraints

- Branch `feat/motion-design-video` in this repo; never commit on `master`; never push without Laurent's OK.
- All on-screen text in **English**. Minimum font size 28 px on the 1920 px master (≈15 px on the 1024 px loop).
- Every number on screen comes from `bench/web.json` / `bench/native.json` through `motion/src/data.ts`; none is typed by hand. A missing figure throws, it never renders `NaN`/`undefined`.
- The 7 engines: `native-seq`, `native-omp_tiled`, `wasm-seq`, `wasm-simd`, `wasm-mt`, `webgpu-naive`, `webgpu-tiled`. Native engines only on `random` and `guns`.
- Palette: night `#05040f` → `#1a1240` (radial), CPU cyan `#4cc9f0` → violet `#b14cff` → magenta `#ff3d81` → GPU orange `#ff9e3d`. An engine's color comes from its speed rank (slow = cold, fast = hot) and is the same in every scene.
- Font: Space Grotesk only (bundled via `@fontsource/space-grotesk`, never loaded from the network at render time).
- Cells are round dots composited with `lighter` plus a bloom layer; never decorative particles unrelated to a simulated grid.
- 120 BPM, 1 bar = 2 s, 60 fps. Scene bars: life-in-life 3, native 4, simd 4, threads 6, gpu 5, screens 5, curves 7, end 4 → 38 bars = 76 s = 4560 frames.
- Machine label on screen: `Apple M5 Pro · 15 cores`; every figure shows its grid size (e.g. `1024²`).
- Credits copy (exact): `Laurent Genty · Clément Bertin · Emeric Duchemin` / `Built on easypap by Raymond Namyst` / `laurentgenty.github.io/optimized-gameoflife`.
- Deliverables: master 1920×1200 60 fps with sound; `gameoflife-film.webm` 1440×900 30 fps VP9 + Opus ≤ 20 MB; `gameoflife-loop.webm` 1024×640, no audio track, 10 s (frames 2640–3239, the screens scene), ≤ 3.5 MB; `.webp` posters for both.

## Review Focus

1. **Fonts not ready on the first rendered frame** → frames silently use a fallback font. Expect `renderFrame` to refuse to draw until `document.fonts.check('700 64px "Space Grotesk"')` is true (Task 4).
2. **Frames rendered out of order or re-rendered after a crash** → a simulation must give the same image as a sequential run. Expect `SimTrack.at(50)` after `at(100)` to equal a fresh `at(50)` (Task 3).
3. **A scene asks for a figure the bench never measured** → expect a thrown error naming engine/preset/size, and a test proving every scene's figures resolve and all 7 engines appear (Tasks 2, 12).
4. **Render interrupted after 30 minutes** → expect `render.ts` to skip PNGs already on disk and `check-outputs.ts` to refuse encoding unless exactly 4560 frames exist (Task 14).
5. **Viewer watches muted (portfolio default)** → the loop must carry no audio stream and the film must keep every key number on screen ≥ 2 s; `check-outputs.ts` asserts the loop has 0 audio streams (Task 14).

---

### Task 1: Bench the extra seeds and merge them into `bench/web.json`

**Files:**
- Modify: `web/src/bench/run.ts` (add `benchPresets`), `web/src/bench/report.ts` (add `mergeReports`), `web/src/main.ts:205` and `web/src/bench/view.ts:52` (use `benchPresets(window.__benchPresets)`), `web/e2e-bench/bench.spec.ts`
- Test: `web/test/bench-run.test.ts`, `web/test/bench-report.test.ts`
- Data: `bench/web.json`

**Interfaces:**
- Produces: `benchPresets(override?: readonly string[]): readonly string[]` (override if non-empty, each id checked with `getPreset`, else `BENCH_PRESETS`); `mergeReports(base: BenchReport, extra: BenchReport): BenchReport`; global `window.__benchPresets?: string[]` declared next to `__benchReport`.

- [ ] **Step 1: Write failing tests**
  - `benchPresets()` → `['random','guns','otca-off']`; `benchPresets(['bugs','clown'])` → `['bugs','clown']`; `benchPresets(['nope'])` throws.
  - `mergeReports`: a row with the same `engineId/presetId/size` in `extra` replaces the base row in place; other base rows keep their order and values; new rows are appended; result `date` = `extra.date`; throws if `machine.cores` or `machine.gpu` differ.
- [ ] **Step 2:** `cd web && npm install && npm test -- bench` → FAIL (functions missing).
- [ ] **Step 3: Implement** both functions; wire `benchPresets(window.__benchPresets)` in `main.ts` and `view.ts`; in `bench.spec.ts`, read `BENCH_PRESETS` (comma list) and pass it with `page.addInitScript`, and when `BENCH_MERGE=1` read the existing `bench/web.json` and write `mergeReports(existing, report)` instead of `report`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Run the bench (machine must be the M5 Pro, page visible, nothing else heavy running)**
  `BENCH_PRESETS=bugs,clown,diehard BENCH_SIZES=1024 BENCH_MERGE=1 npm run bench:headless`
  Expected: 15 new rows (`bugs|clown|diehard` × 5 web engines × 1024), all `status: "ok"`; `git diff bench/web.json` shows additions plus the `date` line only — no `random`/`guns` value changed.
- [ ] **Step 6: Commit** `feat(bench): bench extra presets and merge them into web.json`

### Task 2: Scaffold `motion/` and the data layer

**Files:**
- Create: `motion/package.json`, `motion/tsconfig.json`, `motion/vite.config.ts`, `motion/.gitignore` (`node_modules/ out/ public/app/`), `motion/index.html`, `motion/src/data.ts`
- Test: `motion/test/data.test.ts`

**Interfaces:**
- Produces (in `src/data.ts`):
  - `type EngineId = 'native-seq'|'native-omp_tiled'|'wasm-seq'|'wasm-simd'|'wasm-mt'|'webgpu-naive'|'webgpu-tiled'`; `ENGINES: readonly EngineId[]` (that order)
  - `ENGINE_LABEL: Record<EngineId,string>` = `Native C · sequential`, `Native C · OpenMP ×15`, `wasm-seq`, `wasm-simd · 1 thread`, `wasm-mt · 15 threads`, `webgpu-naive`, `webgpu-tiled`
  - `interface FigureRef { engine: EngineId; preset: string; size: number }`
  - `gensPerSec(ref: FigureRef): number` — throws `Error('no bench figure for <engine>/<preset>/<size>')`
  - `speedRank(): EngineId[]` (ascending by `random`/1024), `speedup(ref: FigureRef): number` (vs `native-seq`/`random`/1024), `formatGps(v: number): string` (en-US grouping, integer), `MACHINE_LABEL = 'Apple M5 Pro · 15 cores'`
- Package: same versions as `web/package.json` for vite/typescript/vitest/@playwright/test/@types/node, plus `@fontsource/space-grotesk`. Scripts: `dev`, `test` (`vitest run`), `typecheck`, `still`, `capture`, `render`, `encode`, `check`. `vite.config.ts`: `server.fs.allow: ['..']`, JSON imports of `../bench/*.json`.

- [ ] **Step 1: Write failing tests:** `round(gensPerSec({engine:'webgpu-naive',preset:'random',size:1024}))===22198`; `round(gensPerSec({engine:'wasm-simd',preset:'guns',size:1024}))===26900`; `gensPerSec({engine:'native-seq',preset:'clown',size:1024})` throws with that message; `speedRank()` equals `['native-seq','wasm-seq','native-omp_tiled','wasm-mt','wasm-simd','webgpu-tiled','webgpu-naive']`; `Math.round(speedup({engine:'webgpu-naive',preset:'random',size:1024}))===118`; `formatGps(22198.4)==='22,198'`; for each of `bugs, clown, diehard`, both `wasm-simd` and `webgpu-naive` at 1024 resolve.
- [ ] **Step 2:** `cd motion && npm install && npm test` → FAIL.
- [ ] **Step 3: Implement** `data.ts` (native rows map `seq`→`native-seq`, `omp_tiled`→`native-omp_tiled`).
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(motion): scaffold the motion package and bench data layer`

### Task 3: Simulation tracks

**Files:**
- Create: `motion/src/sim/life.ts`, `motion/src/sim/track.ts`
- Test: `motion/test/sim.test.ts`

**Interfaces:**
- Consumes: `web/src/grid.ts` (`Grid`, `createGrid`, `hashCells`, `liveCount`), `web/src/patterns/presets.ts` (`getPreset`).
- Produces: `lifeStep(g: Grid): Grid` (B3/S23, border cells stay dead — same semantics as `wasm-seq`); `seedGrid(presetId: string, size: number): Grid`; `class SimTrack { constructor(seed: () => Grid); at(gen: number): Grid }` (steps forward from its current gen, restarts from `seed()` when `gen` is lower).

- [ ] **Step 1: Write failing tests:** blinker has period 2; a glider is the same shape shifted (+1,+1) after 4 gens; `seedGrid('diehard',64)` has `liveCount > 0` at gen 129 and `=== 0` at gen 130; `SimTrack` determinism: `hashCells(t.at(100).cells)` then `t.at(50)` equals a fresh track's `at(50)`.
- [ ] **Step 2:** `npm test -- sim` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(motion): deterministic Life simulation tracks`

### Task 4: Timeline, cues, render core and still harness

**Files:**
- Create: `motion/src/timeline.ts`, `motion/src/render/palette.ts`, `motion/src/render/canvas.ts`, `motion/src/scenes/types.ts`, `motion/src/scenes/index.ts`, `motion/src/main.ts`, `motion/scripts/still.ts`
- Test: `motion/test/timeline.test.ts`, `motion/test/palette.test.ts`

**Interfaces:**
- Produces:
  - `timeline.ts`: `BPM=120`, `FPS=60`, `W=1920`, `H=1200`, `type SceneId = 'life-in-life'|'native'|'simd'|'threads'|'gpu'|'screens'|'curves'|'end'`, `SCENE_BARS: Record<SceneId, number>` (values in Global Constraints), `TOTAL_FRAMES=4560`, `sceneAt(frame: number): { id: SceneId; t: number; p: number; beat: number }` (`t` seconds since scene start, `p` 0..1, `beat` beats since scene start), `sceneStart(id): number` (seconds), and
    `CUES = { reveal: 3, nativeOmp: 10, compile: 14, simdLaser: 16, threadPlucks: 15 plucks at 24 + i*0.5, gpuDrop: 38, gpuTiled: 41, satellites: [44, 44.5, 45, 45.5], curvesScaling: 58, reversal: 64, layersOff: [68, 70, 72, 74], finalTick: 75.5 }` (seconds).
  - `palette.ts`: `heat(t: number): string` (0 → `#4cc9f0`, 1 → `#ff9e3d`, via `#b14cff`, `#ff3d81`), `engineColor(id: EngineId): string` = `heat(rank/6)` from `speedRank()`, `NIGHT = ['#05040f', '#1a1240']`.
  - `canvas.ts`: `nightBackground(ctx)`, `withLayer(ctx, paint: (l: CanvasRenderingContext2D) => void, opts: { filter?: string; alpha?: number; op?: GlobalCompositeOperation })` (offscreen canvas, filter applied once — a per-cell filter loses the context, seen in the styleframes), `drawCells(ctx, grid: Grid, rect: {x,y,w,h}, opts: { color: (u: number, v: number) => string; bloom: number; dim?: number; blur?: number })` (dots when a cell ≥ 3 px, density image otherwise), `drawPerspective(ctx, img: CanvasImageSource, quad: [P,P,P,P])` (column slicing, 64 strips), `text(ctx, s: string, x, y, opts: { size: number; weight: 400|600|700; color: string; align?: CanvasTextAlign })` asserting `size >= 28`.
  - `scenes/types.ts`: `interface Scene { id: SceneId; figures: FigureRef[]; prepare?(): Promise<void>; draw(ctx: CanvasRenderingContext2D, s: ReturnType<typeof sceneAt>): void | Promise<void> }`.
  - `main.ts`: `window.renderFrame(i: number): Promise<void>` (awaits fonts — throws if `document.fonts.check('700 64px "Space Grotesk"')` is false — then the scene's `prepare` once, then `draw`), `window.motionReady: Promise<void>`.
  - `scripts/still.ts`: `node scripts/still.ts <frame...>` starts Vite through its API, opens Chrome with Playwright, writes `out/stills/<frame>.png`.
- Scenes not built yet render a placeholder (night background + scene id) so the harness works from this task on.

- [ ] **Step 1: Write failing tests:** `TOTAL_FRAMES===4560`; `sceneAt(0).id==='life-in-life'`; `sceneAt(360).id==='native'`; `sceneStart('screens')===44` and `SCENE_BARS.screens*2===10`; `sceneAt(4559).id==='end'`; every `CUES` time lies in `[0,76)`; `heat(0)==='#4cc9f0'`, `heat(1)==='#ff9e3d'`; `engineColor('webgpu-naive')==='#ff9e3d'`, `engineColor('native-seq')==='#4cc9f0'`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS; `npm run still -- 0 2700` writes two PNGs showing the night gradient and the scene id in Space Grotesk (open them to check).
- [ ] **Step 5: Commit** `feat(motion): timeline, cues, render core and still harness`

### Task 5: Scene 1 — Life in Life (0–6 s)

**Files:** Create `motion/src/scenes/life-in-life.ts`; register in `scenes/index.ts`.

**Interfaces:** Consumes `seedGrid('meta3x3', 6208)` stepped with `WasmSim.create('simd', grid)` from `web/src/engines/wasm-sim.ts` (prerequisite `npm --prefix ../web run wasm`), `drawCells`, `CUES.reveal`, `text`. `figures: []`.

- Look: start on one live cell filling ~1/10 of the frame, exponential zoom-out (log-space lerp) to the whole 3×3 metapixel grid by 5.5 s; the sim advances 1 generation every 2 frames; title `Optimized Game of Life` fades in at `CUES.reveal`, subtitle `Life, simulated by Life` below it.
- [ ] **Step 1:** Implement the scene.
- [ ] **Step 2:** `npm run still -- 0 180 300 355` → check: frame 0 is a single glowing cell, 180 shows metapixel structure, 300 shows the 3×3 grid with the title, no frame is empty or flat.
- [ ] **Step 3: Commit** `feat(motion): scene 1, Life in Life`

### Task 6: Scenes 2–3 — native C, then WASM + SIMD (6–22 s)

**Files:** Create `motion/src/scenes/native.ts`, `motion/src/scenes/simd.ts`; register.

**Interfaces:** Consumes `SimTrack(seedGrid('random', 256))`, `gensPerSec`, `formatGps`, `engineColor`, `CUES.nativeOmp`, `CUES.compile`, `CUES.simdLaser`.
- `native` figures: `native-seq` and `native-omp_tiled`, `random`, 1024. Look: one bright scan line sweeping the grid row by row, slowly; counter `188 gen/s`; at `CUES.nativeOmp` the grid splits into 15 bands swept in parallel, counter rolls to the OpenMP figure. Caption `2020 · native C · 1024²`.
- `simd` figures: `wasm-seq` and `wasm-simd`, `random`, 1024. Look: glitch transition at `CUES.compile` (caption `compiled to WebAssembly`), `wasm-seq` counter; at `CUES.simdLaser` a row of 16 dots lights at once and sweeps (caption `16 cells per instruction`), counter rolls to the `wasm-simd` figure.
- [ ] **Step 1:** Implement both scenes.
- [ ] **Step 2:** `npm run still -- 480 700 900 1100 1300` → check the counters show `188`, the OpenMP figure, `548`, `5,359` with `1024²` visible, and the colors follow `engineColor`.
- [ ] **Step 3: Commit** `feat(motion): scenes 2-3, native C and WASM SIMD`

### Task 7: App capture and scene 4 — Threads (22–34 s)

**Files:** Create `motion/playwright.capture.config.ts`, `motion/e2e-capture/app.spec.ts`, `motion/src/scenes/threads.ts`; register.

**Interfaces:**
- Capture: config like `web/playwright.video.config.ts` but viewport/video 1440×900, `webServer.command: 'npm --prefix ../web run build && npm --prefix ../web run preview -- --port 4173 --strictPort'`. Spec: engine `wasm-mt`, size `1024`, preset `random`, check `#monitoring`, `#m-overlay` = `thread`, play 13 s; save to `motion/out/app.webm`. Then `ffmpeg -i out/app.webm -ss 1 -t 12 -vf fps=60 -q:v 3 public/app/%04d.jpg` (720 frames). Script `npm run capture` does both.
- Scene figures: `wasm-mt` and `wasm-simd`, `random`, 1024. Look: frame `public/app/{n}.jpg` (n = scene frame + 1) drawn with `drawPerspective` inside a glass panel tilted ~18° around Y; on the right, 15 lanes `T0…T14` light one per `CUES.threadPlucks` entry; caption `15 threads · 10–30 % busy`; at the end the `wasm-mt` counter (`3,644`) sits next to the dimmer `wasm-simd · 1 thread 5,359` with caption `more threads, less speed: barriers`.
- [ ] **Step 1:** Write the capture spec and config; `npm run capture` → 720 JPGs exist and show the app with monitoring.
- [ ] **Step 2:** Implement the scene.
- [ ] **Step 3:** `npm run still -- 1400 1700 2000` → app readable in the tilted panel, lanes lit progressively, both counters at 2000.
- [ ] **Step 4: Commit** `feat(motion): app capture and scene 4, threads`

### Task 8: Scene 5 — GPU (34–44 s)

**Files:** Create `motion/src/scenes/gpu.ts`; register.

**Interfaces:** figures `webgpu-naive` and `webgpu-tiled`, `random`, 1024. Consumes `SimTrack(seedGrid('random', 512))`, `CUES.gpuDrop`, `CUES.gpuTiled`.
- Look: aerial view of a 32×32 grid of workgroup tiles, each tile showing its live cells, lighting in waves until all are lit at `CUES.gpuDrop`, where the `webgpu-naive` counter lands with a bloom pulse (`22,198 gen/s · ×118`); at `CUES.gpuTiled` the `webgpu-tiled` counter appears smaller with caption `shared-memory tiling: slower on Apple GPUs`.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run still -- 2100 2280 2500` → waves at 2100, full bloom and `×118` at 2280, both GPU counters at 2500.
- [ ] **Step 3: Commit** `feat(motion): scene 5, GPU`

### Task 9: Scene 6 — Five screens (44–54 s)

**Files:** Create `motion/src/scenes/screens.ts`; register.

**Interfaces:** figures: for each of `random, guns, bugs, clown, diehard` at 1024: `wasm-simd` and `webgpu-naive`. Tracks: `random` 256, `guns` 256, `bugs` 256, `clown` 128, `diehard` 128 (`SimTrack`, Diehard restarts every 130 gens). Consumes `CUES.satellites`.
- Look: styleframe `c1` — central glass screen "pop" (Random) with bloom, 4 satellites (Guns, LWSS tagalongs, Clown, Diehard) with depth-of-field blur and dimming, each entering at its `CUES.satellites` time; under each screen its name and the pair `wasm-simd 1 thread · <n>` / `webgpu-naive · <n>` (`1024²`). Slow camera drift; no text enters or leaves during the 10 s, so the loop export is clean.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run still -- 2640 2700 2940 3239` → all 5 screens animated, 10 numbers present; frame 3239 is close enough to 2640 in composition for a loop.
- [ ] **Step 3: Commit** `feat(motion): scene 6, five screens`

### Task 10: Scene 7 — The curves (54–68 s)

**Files:** Create `motion/src/scenes/curves.ts`; register.

**Interfaces:** figures: all 7 engines on `random` 1024; the 5 web engines plus both native on `random` 512/1024/2048; all 7 on `guns` 1024. Consumes `CUES.curvesScaling`, `CUES.reversal`, `speedup`, `engineColor`.
- Look, three parts: (a) 54–58 s race of generations over 1 s, fan of light from the origin, `×N` labels per engine (styleframe `c2`); (b) `CUES.curvesScaling`–64 s gens/s vs grid size 512²→2048², log-log; (c) from `CUES.reversal` a slope chart Random → Guns at 1024² where `wasm-simd` crosses both GPU lines, caption `sparse pattern: 1 CPU thread beats the GPU`, then `lazy tiling`. Labels never overlap (dodge as in the styleframe code).
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run still -- 3400 3700 3900 4000` → each part readable; all 7 engines labeled in (a) and (c).
- [ ] **Step 3: Commit** `feat(motion): scene 7, curves`

### Task 11: Scene 8 — End (68–76 s)

**Files:** Create `motion/src/scenes/end.ts`; register.

**Interfaces:** `figures: []`; consumes `CUES.layersOff`, `CUES.finalTick`, credits copy from Global Constraints.
- Look: title, the three credit lines, live demo URL; elements dim one by one on `CUES.layersOff`; a single cell remains and blinks at `CUES.finalTick`.
- [ ] **Step 1:** Implement. **Step 2:** `npm run still -- 4200 4550` → credits exact, last frame a single cell. **Step 3: Commit** `feat(motion): scene 8, end`

### Task 12: Exhaustiveness test and transitions

**Files:** Modify `motion/src/scenes/*.ts` as needed; Test: `motion/test/scenes.test.ts`.

- [ ] **Step 1: Write the test:** importing `scenes/index.ts` (scenes must not touch the DOM at import time): every scene's `figures` resolves with `gensPerSec`; the union of engines across scenes equals `ENGINES` (all 7); `screens` figures cover presets `random, guns, bugs, clown, diehard`; scene ids in `scenes/index.ts` equal `Object.keys(SCENE_BARS)` in order.
- [ ] **Step 2:** `npm test` → PASS (fix scenes if not).
- [ ] **Step 3:** Add transitions at scene boundaries (builder's choice, ≤ 0.5 s, cut on the bar line); `npm run still -- 355 365 1795 1805 2635 2645` → no blank or half-drawn frame.
- [ ] **Step 4: Commit** `feat(motion): exhaustiveness test and scene transitions`

### Task 13: Music and SFX

**Files:** Create `motion/src/audio/score.ts`, `motion/src/audio/wav.ts`, `motion/src/audio/synth.ts`; expose `window.renderAudioWav(): Promise<string>` (base64) in `main.ts`. Test: `motion/test/audio.test.ts`.

**Interfaces:**
- `type Layer = 'drone'|'kick'|'hats'|'bass'|'lead'|'pluck'`; `type Sfx = 'reveal'|'glitch'|'laser'|'whoosh'|'impact'|'tick'`; `interface NoteEvent { time: number; voice: Layer|Sfx; dur: number; gain: number; pitch?: number }` (time in seconds).
- `buildScore(): NoteEvent[]` — pure, built from `SCENE_BARS`/`sceneStart`/`CUES`: drone 0–6 s; `kick` from `sceneStart('native')`; `hats` from `sceneStart('simd')`; `bass` from `sceneStart('threads')`; `lead` from `sceneStart('gpu')`, full arrangement with drop at `CUES.gpuDrop`; one `pluck` per `CUES.threadPlucks`; `whoosh` on each `CUES.satellites`; `reveal` at `CUES.reveal`; `glitch` at `CUES.compile`; `laser` at `CUES.simdLaser`; `impact` at `CUES.gpuDrop` and `CUES.reversal`; breakdown `[CUES.reversal, 68)` = kick + SFX only; layers stop in order lead, bass, hats, kick on `CUES.layersOff`; `tick` at `CUES.finalTick`.
- `encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array` (16-bit PCM).
- `renderScore(score: NoteEvent[], sampleRate = 48000): Promise<AudioBuffer>` — `OfflineAudioContext`, 2 channels, 76 s, oscillators/noise/envelopes only (no samples, no network).

- [ ] **Step 1: Write failing tests:** no `lead` event before 34; no `bass` before 22; in `[64,68)` only `kick` and SFX voices; exactly 15 `pluck` and 4 `whoosh` events; all `time + dur <= 76`; `encodeWav([new Float32Array(4), new Float32Array(4)], 48000)` has length 44 + 16, starts with `RIFF`, has `WAVE` at offset 8 and sample rate 48000 at offset 24.
- [ ] **Step 2:** `npm test -- audio` → FAIL.
- [ ] **Step 3: Implement** score, wav, synth.
- [ ] **Step 4:** Add an `--audio` flag to `scripts/still.ts` that calls `renderAudioWav()` and writes `out/audio.wav`. `npm test` → PASS; `npm run still -- --audio` writes `out/audio.wav`; listen-check: layers enter at 6/14/22/34 s, drop at 38 s, breakdown at 64 s.
- [ ] **Step 5: Commit** `feat(motion): synthesized music and SFX`

### Task 14: Render, encode and check

**Files:** Create `motion/scripts/render.ts`, `motion/scripts/encode.sh`, `motion/scripts/check-outputs.ts`.

**Interfaces:**
- `render.ts`: for `i` in `0..4559`, skip if `out/frames/<i 5-digit>.png` exists, else `renderFrame(i)` and write the canvas PNG; then write `out/audio.wav`. Prints progress every 60 frames.
- `encode.sh` (exact encodes):
  - master: `ffmpeg -framerate 60 -i out/frames/%05d.png -i out/audio.wav -c:v libx264 -crf 12 -pix_fmt yuv420p -c:a flac out/film-master.mkv`
  - film: two-pass `libvpx-vp9 -b:v 1800k -vf scale=1440:900,fps=30` + `-c:a libopus -b:a 128k` → `out/gameoflife-film.webm`
  - loop: `-framerate 60 -start_number 2640 -i out/frames/%05d.png -frames:v 600 -vf scale=1024:640 -an -c:v libvpx-vp9 -b:v 2200k` → `out/gameoflife-loop.webm`
  - posters: frame 2280 → `out/gameoflife-film.webp`, frame 2940 → `out/gameoflife-loop.webp` (`-vf scale=1024:640 -quality 80`)
- `check-outputs.ts` (ffprobe): before encoding (`--frames`) exactly 4560 PNGs; after: film 1440×900, 76 s ± 0.1, 1 audio stream, ≤ 20 MB; loop 1024×640, 10 s ± 0.05, 0 audio streams, ≤ 3.5 MB; master 1920×1200 60 fps with audio. Exit 1 with the failing check named.

- [ ] **Step 1:** Implement the three scripts.
- [ ] **Step 2:** `npm run render` (≈ 30–60 min; resumable) → `npm run check -- --frames` PASS.
- [ ] **Step 3:** `npm run encode && npm run check` → PASS (if film > 20 MB, lower `-b:v` by 200k and re-encode).
- [ ] **Step 4:** Watch the film once start to end, with and without sound; fix and re-render the affected frame ranges (delete those PNGs) if anything is off.
- [ ] **Step 5: Commit** `feat(motion): render, encode and output checks` (scripts only; `out/` is ignored).

### Task 15: Publish to the README and the portfolio

**Files:**
- This repo: `docs/media/gameoflife-film.webm`, `docs/media/gameoflife-film.webp`, `README.md` (one line under the live demo link: `[▶ Motion design film](docs/media/gameoflife-film.webm)`), `motion/README.md` (how to capture, render, encode).
- Portfolio, worktree `git -C ~/perso/portfolio worktree add ../portfolio-gameoflife-film feat/new-projects`: `public/projects/videos/gameoflife-loop.webm`, `gameoflife-film.webm`; `public/projects/posters/gameoflife-loop.webp`, `gameoflife-film.webp`; `src/components/side-projects/sideProjects.data.ts` entry `gameoflife`.

**Interfaces:** entry becomes `videos: [`${V}gameoflife-loop.webm`]`, `poster: `${P}gameoflife-loop.webp``, `thumb: { t: 5 }`, `recordings: { desktop: [{ video: `${V}gameoflife-film.webm`, poster: `${P}gameoflife-film.webp` }, { video: `${V}gameoflife.webm`, poster: `${P}gameoflife.webp` }] }`; every other field unchanged.

- [ ] **Step 1:** Commit the README/docs/media changes here: `docs: add the motion design film`.
- [ ] **Step 2:** In the portfolio worktree: `git pull --rebase`, copy the 4 files, edit the entry.
- [ ] **Step 3:** `npx vitest run && npm run build` → PASS.
- [ ] **Step 4:** Commit `feat(side-projects): game of life motion film and card loop`. **Do not push** — ask Laurent.
