// The web package's ambient types for its generated Emscripten modules, outside this tsconfig.
/// <reference path="../../../web/src/engines/wasm/life-module.d.ts" />
import { WasmSim } from '../../../web/src/engines/wasm-sim'
import { type Grid } from '../../../web/src/grid'
import { type Rect, drawCells, nightBackground, text } from '../render/canvas'
import { heat } from '../render/palette'
import { seedGrid } from '../sim/track'
import { CUES, FPS, H, W, sceneStart } from '../timeline'
import { type Scene } from './types'

const GRID_SIZE = 6208
const META = 2048
/** The 3×3 metapixels of the `meta3x3` preset cover [1, 6145)² (see web/src/patterns/presets.ts). */
export const META_SPAN = { x0: 1, x1: 1 + 3 * META }

/**
 * A block on the left edge of the centre ("on") metapixel. The metapixel interior is all
 * LWSS streams, so no cell near its centre lives two seconds; this block is the one an offline search
 * found alone in the opening view through the whole focus pull (checked by the scene test).
 */
export const START = { x: 2204, y: 3170 }

const ZOOM_END = 5.5
const FOCUS_START = 0.25
const FOCUS_END = 1.25
export const FOCUS_GENS = Math.ceil((FOCUS_END * FPS) / 2)

/** Final framing: the 3×3 grid in the upper part of the frame, the title below it. */
const GRID_SIDE = 880
export const GRID_RECT: Rect = { x: (W - GRID_SIDE) / 2, y: 40, w: GRID_SIDE, h: GRID_SIDE }

const S0 = W / 10
const S1 = GRID_SIDE / (META_SPAN.x1 - META_SPAN.x0)
const C0 = { x: START.x + 0.5, y: START.y + 0.5 }
// World point at the frame centre once GRID_RECT is filled.
const C1 = {
  x: META_SPAN.x0 + (W / 2 - GRID_RECT.x) / S1,
  y: META_SPAN.x0 + (H / 2 - GRID_RECT.y) / S1,
}
// Zooming about this fixed point takes C0 at scale S0 to C1 at scale S1: the camera never
// pans on its own, so the start cell drifts smoothly instead of being yanked to its final place.
const FIX = { x: (C1.x * S1 - C0.x * S0) / (S1 - S0), y: (C1.y * S1 - C0.y * S0) / (S1 - S0) }

export interface Camera {
  /** Pixels per cell. */
  s: number
  /** World point at the frame centre. */
  cx: number
  cy: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (a: number, b: number, t: number) => {
  const u = clamp01((t - a) / (b - a))
  return u * u * (3 - 2 * u)
}

/** Exponential zoom-out (log-space lerp, sine-eased) from the start cell to the 3×3 grid. */
export function camera(t: number): Camera {
  const e = (1 - Math.cos(Math.PI * clamp01(t / ZOOM_END))) / 2
  const s = Math.exp(Math.log(S0) + (Math.log(S1) - Math.log(S0)) * e)
  const k = S0 / s
  return { s, cx: FIX.x + (C0.x - FIX.x) * k, cy: FIX.y + (C0.y - FIX.y) * k }
}

export function toScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: W / 2 + (wx - cam.cx) * cam.s, y: H / 2 + (wy - cam.cy) * cam.s }
}

// Colour sweeps the palette along the grid diagonal; quantised so drawCells batches a few paths.
const LEVELS = 48
const PALETTE = Array.from({ length: LEVELS + 1 }, (_, i) => heat(0.06 + (0.88 * i) / LEVELS))
function colorAt(wx: number, wy: number): string {
  const d = (wx + wy - 2 * META_SPAN.x0) / (2 * (META_SPAN.x1 - META_SPAN.x0))
  return PALETTE[Math.round(clamp01(d) * LEVELS)]
}

let seed: Grid | null = null
let sim: WasmSim | null = null
let simGen = 0

/** Cells at generation `gen`, stepping the real wasm-simd engine forward; a rewind restarts from the seed. */
async function cellsAt(gen: number): Promise<Uint8Array> {
  if (!seed) throw new Error('life-in-life: prepare() has not run')
  if (!sim || gen < simGen) {
    sim?.dispose()
    sim = null
    // create() copies the seed into wasm memory, so the seed stays pristine for later rewinds.
    sim = await WasmSim.create('simd', seed)
    simGen = 0
  }
  if (gen > simGen) {
    sim.step(gen - simGen)
    simGen = gen
  }
  return sim.cells()
}

const windowBufs = [new Uint8Array(0), new Uint8Array(0)]
let poolX = new Int32Array(0)

/**
 * The square part of the grid covering the camera view, so drawCells never walks or rasterises
 * the 38 M cells off screen, max-pooled by `k` (a pooled cell is alive if any of its k×k cells
 * is): plain averaging under 1 px per cell would fade the sparse metapixel wiring to black.
 * `span` is the window side in grid cells; `slot` picks the buffer so two poolings can coexist.
 */
function visible(cells: Uint8Array, cam: Camera, k: number, slot: 0 | 1): { grid: Grid; x0: number; y0: number; span: number } {
  const n = GRID_SIZE
  const want = Math.ceil(Math.max(W, H) / cam.s) + 2
  if (k === 1 && want >= n) return { grid: { size: n, cells }, x0: 0, y0: 0, span: n }
  const m = Math.ceil(Math.min(want, n) / k)
  const span = m * k
  // span may exceed n by less than k: the window then starts just before the grid.
  const x0 = Math.min(n - span, Math.max(0, Math.floor(cam.cx - span / 2)))
  const y0 = Math.min(n - span, Math.max(0, Math.floor(cam.cy - span / 2)))
  if (windowBufs[slot].length < m * m) windowBufs[slot] = new Uint8Array(m * m)
  const out = windowBufs[slot].subarray(0, m * m)
  if (k === 1) {
    for (let y = 0; y < m; y++) out.set(cells.subarray((y0 + y) * n + x0, (y0 + y) * n + x0 + m), y * m)
    return { grid: { size: m, cells: out }, x0, y0, span }
  }
  out.fill(0)
  const xa = Math.max(0, x0)
  const xb = Math.min(n, x0 + span)
  if (poolX.length < n) poolX = new Int32Array(n)
  for (let x = xa; x < xb; x++) poolX[x] = Math.floor((x - x0) / k)
  for (let y = Math.max(0, y0); y < Math.min(n, y0 + span); y++) {
    const src = y * n
    const dst = Math.floor((y - y0) / k) * m
    for (let x = xa; x < xb; x++) if (cells[src + x]) out[dst + poolX[x]] = 1
  }
  return { grid: { size: m, cells: out }, x0, y0, span }
}

/**
 * Poolings to draw with their weights. Max-pooling thickens features by up to k px, so a bare
 * integer k would pop at each step: q cells per px cross-fades pooling floor(q) into floor(q)+1.
 */
export function poolings(s: number): { k: number; w: number }[] {
  const q = 1 / s
  if (q <= 1) return [{ k: 1, w: 1 }]
  const k = Math.floor(q)
  const w = q - k
  return w > 0 ? [{ k, w: 1 - w }, { k: k + 1, w }] : [{ k, w: 1 }]
}

const ONE: Grid = { size: 1, cells: Uint8Array.of(1) }

function drawTitle(ctx: CanvasRenderingContext2D, t: number): void {
  const reveal = CUES.reveal - sceneStart('life-in-life')
  const a = smooth(reveal, reveal + 0.6, t)
  const b = smooth(reveal + 0.25, reveal + 0.85, t)
  if (a <= 0) return
  // Night scrim under the text: the zoom still fills the frame with cells when the title lands.
  ctx.save()
  const g = ctx.createLinearGradient(0, GRID_RECT.y + GRID_RECT.h - 140, 0, H)
  g.addColorStop(0, 'rgba(5,4,15,0)')
  g.addColorStop(0.6, 'rgba(5,4,15,0.82)')
  g.addColorStop(1, 'rgba(5,4,15,0.9)')
  ctx.globalAlpha = a
  ctx.fillStyle = g
  ctx.fillRect(0, GRID_RECT.y + GRID_RECT.h - 140, W, H)
  ctx.globalAlpha = a
  text(ctx, 'Optimized Game of Life', W / 2, 1036 + (1 - a) * 12, { size: 88, weight: 700, color: '#ffffff', align: 'center' })
  ctx.globalAlpha = b
  text(ctx, 'Life, simulated by Life', W / 2, 1102 + (1 - b) * 12, { size: 40, weight: 400, color: 'rgba(255,255,255,0.72)', align: 'center' })
  ctx.restore()
}

export const lifeInLife: Scene = {
  id: 'life-in-life',
  figures: [],
  async prepare() {
    seed = seedGrid('meta3x3', GRID_SIZE)
  },
  async draw(ctx, s) {
    const frame = Math.round(s.t * FPS)
    const gen = Math.floor(frame / 2)
    const cells = await cellsAt(gen)
    const cam = camera(s.t)

    nightBackground(ctx)

    // Bloom pulses on the beat, decaying within it.
    const beatFrac = s.beat - Math.floor(s.beat)
    const bloom = 0.55 + 0.35 * Math.exp(-4 * beatFrac)

    // Focus pull: at first only the start cell is sharp, the rest dim and out of focus.
    const focus = smooth(FOCUS_START, FOCUS_END, s.t)
    poolings(cam.s).forEach(({ k, w }, slot) => {
      const { grid, x0, y0, span } = visible(cells, cam, k, slot as 0 | 1)
      const tl = toScreen(cam, x0, y0)
      drawCells(ctx, grid, { x: tl.x, y: tl.y, w: span * cam.s, h: span * cam.s }, {
        color: (u, v) => colorAt(x0 + u * span, y0 + v * span),
        bloom,
        dim: w * (0.16 + 0.84 * focus),
        blur: Math.min(28, cam.s * 0.15) * (1 - focus),
      })
    })
    if (focus < 1 && cells[START.y * GRID_SIZE + START.x]) {
      const p = toScreen(cam, START.x, START.y)
      const c = colorAt(START.x, START.y)
      drawCells(ctx, ONE, { x: p.x, y: p.y, w: cam.s, h: cam.s }, { color: () => c, bloom: 1.1, dim: 1 - focus })
    }

    drawTitle(ctx, s.t)
  },
}
