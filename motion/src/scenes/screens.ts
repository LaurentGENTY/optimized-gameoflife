// Scene 6: five glass screens. The GPU's dive lands full-frame on Random; the camera pulls back
// while the four sparse seeds slide out from behind it, one a beat, each lighting up like a neon
// tube. Each screen carries its own wasm-simd and webgpu-naive figures at 1024², and its tube and
// cells glow in the colour of whichever engine wins on that seed. After the 2 s entrance comes the
// 10 s hold, which is also the muted portfolio loop: everything in it repeats every LOOP_T.
import { type Grid } from '../../../web/src/grid'
import { ENGINE_LABEL, type EngineId, type FigureRef, formatGps, gensPerSec, MACHINE_LABEL } from '../data'
import { FONT_FAMILY, type P, type Rect, drawCells, nightBackground, text, withLayerPasses } from '../render/canvas'
import { engineColor } from '../render/palette'
import { SimTrack, seedGrid } from '../sim/track'
import { BPM, CUES, FPS, H, SCENE_BARS, W, sceneStart } from '../timeline'
import { caption, clamp01, mix, smooth } from './sweep'
import { type Scene } from './types'

export const SCENE_T = SCENE_BARS.screens * 2
/** The pull-back and the four arrivals; the hold (the loop) starts here. */
export const ENTRANCE_T = 2
export const LOOP_T = SCENE_T - ENTRANCE_T
/**
 * Generations a second, the same on every screen: the screens show seeds, not engines, so no
 * screen may look faster than another. 520 a loop, a multiple of Diehard's 130.
 */
export const RATE = 52

const PAIR: readonly EngineId[] = ['wasm-simd', 'webgpu-naive']

export interface ScreenDef {
  preset: string
  name: string
  /** Side of the simulated grid; the figures are the 1024² measurements. */
  size: number
  /** Generation shown on the scene's first frame. */
  g0: number
  /** Generations before the screen starts over; divides RATE · LOOP_T so the loop closes. */
  cycle: number
  /**
   * Seconds of crossfade at the end of a cycle. With g0 > 0 the incoming layer runs the
   * generations just before g0, so the next cycle continues it; with g0 = 0 the screen fades out.
   */
  fade: number
  /**
   * Window shown (side and top-left cell) when the seed stays in one spot of the board: the
   * whole 128² board would draw Clown and Diehard a few pixels wide. Fitted to the cells' extent
   * over the whole cycle, with a few cells of margin.
   */
  view?: { size: number; x: number; y: number }
}

export const SCREENS: readonly ScreenDef[] = [
  { preset: 'random', name: 'Random 50%', size: 256, g0: 80, cycle: 520, fade: 0.6 },
  { preset: 'guns', name: 'Gosper guns', size: 256, g0: 300, cycle: 520, fade: 0.6 },
  // The tagalongs cross half the board in 260 generations, just before reaching its edge.
  { preset: 'bugs', name: 'LWSS tagalongs', size: 256, g0: 22, cycle: 260, fade: 0.4 },
  // The clown settles into blinkers around generation 175: it runs 50-179, past its 3-cell seed
  // (a near-empty screen on the 1024 px card), then crossfades back. Cells span x 42-88, y 44-87.
  { preset: 'clown', name: 'Clown', size: 128, g0: 50, cycle: 130, fade: 0.3, view: { size: 52, x: 40, y: 40 } },
  // Diehard dies at generation 130, then is seeded again. Its cells span x 58-75, y 60-82.
  { preset: 'diehard', name: 'Diehard', size: 128, g0: 0, cycle: 130, fade: 0, view: { size: 30, x: 52, y: 56 } },
]

export const GLOBAL_CAPTION = 'sparse seeds: lazy tiling skips inactive tiles'
export const DIEHARD_CAPTION = ['board dies at gen 130 —', 'lazy tiling skips empty tiles'] as const

const ref = (engine: EngineId, preset: string): FigureRef => ({ engine, preset, size: 1024 })

/** The figures of a screen, from the bench, in the order wasm-simd then webgpu-naive. */
export function screenLines(s: ScreenDef): { name: string; units: string; figures: { label: string; figure: string }[] } {
  return {
    name: s.name,
    units: 'gen/s · 1024²',
    figures: PAIR.map((e) => ({ label: ENGINE_LABEL[e], figure: formatGps(gensPerSec(ref(e, s.preset))) })),
  }
}

/** The engine with the higher figure on this seed: its colour lights the cells and the tube. */
function winner(s: ScreenDef): EngineId {
  const [a, b] = PAIR.map((e) => gensPerSec(ref(e, s.preset)))
  return a >= b ? PAIR[0] : PAIR[1]
}

const DIM_TEXT = 'rgba(255,255,255,0.62)'

export interface Cell {
  s: string
  size: number
  weight: 400 | 600 | 700
  color: string
}

/**
 * The figures pill of a screen, row by row: label, then figure. The centre has room for one row an
 * engine; on a 368 px satellite "wasm-simd · 1 thread  381,473" is 400 px at the 28 px minimum, so a
 * label that does not fit wraps after its dot and its figure stays on the first line.
 */
export function numberRows(s: ScreenDef, big: boolean): Cell[][] {
  const l = screenLines(s)
  return PAIR.flatMap((e, k) => {
    const c = engineColor(e)
    const label = (str: string): Cell => ({ s: str, size: big ? 32 : 28, weight: 400, color: c })
    const figure: Cell = { s: l.figures[k].figure, size: big ? 40 : 30, weight: 700, color: mix(c, '#ffffff', 0.3) }
    const parts = l.figures[k].label.split(' · ')
    if (big || parts.length === 1) return [[label(l.figures[k].label), figure]]
    return [[label(`${parts[0]} ·`), figure], [label(parts.slice(1).join(' · '))]]
  })
}

// ── Time ────────────────────────────────────────────────────────────────────

const frameOf = (t: number) => Math.round(t * FPS)
const mod = (a: number, n: number) => ((a % n) + n) % n
const ENTRANCE_F = ENTRANCE_T * FPS
const LOOP_F = LOOP_T * FPS
/** Frames into the loop. Everything in the hold is a function of this, so it repeats exactly. */
const loopFrame = (f: number) => mod(f - ENTRANCE_F, LOOP_F)
export const BEAT_FRAMES = (60 / BPM) * FPS

/**
 * Generations a screen shows at scene time `t`, with their weights. Counted in frames: each cycle
 * divides the 600 frames of the hold, so the mapping repeats exactly every LOOP_T.
 */
export function screenLayers(s: ScreenDef, t: number): { gen: number; w: number }[] {
  const cycleFrames = (s.cycle * FPS) / RATE
  const fc = mod(frameOf(t), cycleFrames)
  const i = Math.floor((fc * RATE) / FPS)
  const end = cycleFrames / FPS
  const w = s.fade > 0 ? smooth(end - s.fade, end, fc / FPS) : 0
  const layers = [{ gen: s.g0 + i, w: 1 - w }]
  const incoming = s.g0 + i - s.cycle
  if (w > 0 && incoming >= 0) layers.push({ gen: incoming, w })
  return layers
}

// ── Layout (1920 × 1200) ────────────────────────────────────────────────────

export const GAP = 24
const SIDE = 760
const SAT = (SIDE - GAP) / 2
const BLOCK_X = (W - (SIDE + 2 * (SAT + GAP))) / 2
/** The glass of the centre screen; the block is centred on the frame. */
export const CENTER: Rect = { x: BLOCK_X + SAT + GAP, y: (H - SIDE) / 2, w: SIDE, h: SIDE }
/** Satellites' glass in cue order: guns top-left, bugs top-right, clown bottom-left, diehard bottom-right. */
export const SATS: readonly Rect[] = [
  { x: BLOCK_X, y: CENTER.y, w: SAT, h: SAT },
  { x: CENTER.x + SIDE + GAP, y: CENTER.y, w: SAT, h: SAT },
  { x: BLOCK_X, y: CENTER.y + SAT + GAP, w: SAT, h: SAT },
  { x: CENTER.x + SIDE + GAP, y: CENTER.y + SAT + GAP, w: SAT, h: SAT },
]
const RADIUS = 18
const INSET = 10

/** Where a screen's cells go inside its glass. */
export function cellsRect(r: Rect): Rect {
  return { x: r.x + INSET, y: r.y + INSET, w: r.w - 2 * INSET, h: r.h - 2 * INSET }
}

const centreOf = (r: Rect): P => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

// ── Camera ──────────────────────────────────────────────────────────────────

/** Random's cells overflow the frame at this zoom: the GPU's dive ends on exactly this view. */
export const ENTRANCE_ZOOM = 2.6

const easeOutCubic = (u: number) => 1 - (1 - clamp01(u)) ** 3

/** Slow Lissajous drift on the loop's period, faded in over the entrance. */
function drift(t: number): { x: number; y: number; zoom: number } {
  const amp = smooth(0, ENTRANCE_T, t)
  const a = (2 * Math.PI * loopFrame(frameOf(t))) / LOOP_F
  return { x: amp * 14 * Math.sin(a), y: amp * 8 * Math.sin(2 * a), zoom: 1 + amp * 0.01 * Math.sin(a) }
}

/** Zoom about the frame centre (the centre screen's centre) and offset, in px. */
export function camera(t: number): { zoom: number; x: number; y: number } {
  const e = easeOutCubic(t / ENTRANCE_T)
  const pull = t >= ENTRANCE_T ? 1 : ENTRANCE_ZOOM * (1 - e) + e
  const d = drift(t)
  return { zoom: pull * d.zoom, x: d.x, y: d.y }
}

// ── Neon ────────────────────────────────────────────────────────────────────

/** A neon tube starting up, frame by frame: two short blinks, then steady. */
export const FLICKER: readonly number[] = [1, 1, 0.85, 0, 0, 0.35, 1, 1, 1, 0.9, 0, 0, 0.55, 1, 1, 0.85, 1, 1]

function ignition(f: number, on: number): number {
  const j = f - on
  if (j < 0) return 0
  return j < FLICKER.length ? FLICKER[j] : 1
}

/** The kick: every beat, then an exponential decay until the next one. Counted from the hold start. */
function kick(f: number): number {
  return Math.exp((-5 * mod(f - ENTRANCE_F, BEAT_FRAMES)) / BEAT_FRAMES)
}

const NEON_REST = 0.55

/** Point at `s` (0-1, clockwise from the top edge's left end) along a rounded rect, at even speed. */
export function perimeterPoint(r: Rect, radius: number, s: number): P {
  const sw = r.w - 2 * radius
  const sh = r.h - 2 * radius
  const arc = (Math.PI * radius) / 2
  const total = 2 * sw + 2 * sh + 4 * arc
  let d = mod(s, 1) * total
  // Four sides, each followed by its corner arc, clockwise from the top.
  const sides = [
    { len: sw, from: { x: r.x + radius, y: r.y }, dir: { x: 1, y: 0 }, c: { x: r.x + r.w - radius, y: r.y + radius }, a0: -Math.PI / 2 },
    { len: sh, from: { x: r.x + r.w, y: r.y + radius }, dir: { x: 0, y: 1 }, c: { x: r.x + r.w - radius, y: r.y + r.h - radius }, a0: 0 },
    { len: sw, from: { x: r.x + r.w - radius, y: r.y + r.h }, dir: { x: -1, y: 0 }, c: { x: r.x + radius, y: r.y + r.h - radius }, a0: Math.PI / 2 },
    { len: sh, from: { x: r.x, y: r.y + r.h - radius }, dir: { x: 0, y: -1 }, c: { x: r.x + radius, y: r.y + radius }, a0: Math.PI },
  ]
  for (const side of sides) {
    if (d <= side.len) return { x: side.from.x + side.dir.x * d, y: side.from.y + side.dir.y * d }
    d -= side.len
    if (d <= arc || side === sides[3]) {
      const a = side.a0 + Math.min(d, arc) / radius
      return { x: side.c.x + radius * Math.cos(a), y: side.c.y + radius * Math.sin(a) }
    }
    d -= arc
  }
  return sides[0].from
}

// ── Composition: everything that moves, as a pure function of time ──────────

/** A satellite slides out from behind the centre over MOVE_T and settles on its cue. */
export const MOVE_T = 0.5
/** One lap of the spark around a satellite's glass, from its cue. */
export const SPARK_T = 0.45
const START_SCALE = 0.55
/** ease-out-back with a ~5 % overshoot: the small bounce on arrival. */
const BACK = 1.2
const backOut = (u: number) => 1 + (BACK + 1) * (u - 1) ** 3 + BACK * (u - 1) ** 2
const DOF_BLUR = 5
const CENTRE_IGNITE_F = 6
const CENTRE_SPARK = { from: 9, frames: 42 }
const SHEEN_F = 27
const FLASH_F = 30
/** The glass sweep of the hold: one wave across the block, left to right, mid-loop. */
const WAVE = { at: 4.4 * FPS, spread: 0.6 * FPS, frames: 54 }
/** Where each satellite's spark sets off: the corner that faces the centre. */
const SPARK_FROM = [0.5, 0.75, 0.25, 0] as const

export interface TileState {
  rect: Rect
  /** Opacity of the glass and cells. */
  alpha: number
  /** Depth-of-field blur of the cells, in px, while a satellite is still behind. */
  blur: number
  /** Tube ignition, 0 (off) to 1 (steady). */
  lit: number
  /** Tube brightness: ignition times the beat pulse. */
  neon: number
  /** Spark progress around the glass, or null when there is none. */
  spark: number | null
  /** Glass sweep progress, or null. */
  sheen: number | null
  /** Strength of the neon link drawn from the centre while the satellite travels. */
  link: number
  labels: number
  /** Cell bloom. */
  bloom: number
}

export interface Bokeh {
  x: number
  y: number
  r: number
  a: number
  color: string
}

export interface Composition {
  camera: { zoom: number; x: number; y: number }
  tiles: TileState[]
  caption: number
  footer: number
  bokeh: Bokeh[]
}

/** Seeded PRNG (mulberry32): the bokeh is the same on every render. */
function prng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BOKEH_COLORS = ['#ff9e3d', '#ff3d81', '#b14cff', '#b14cff', '#4cc9f0']
const BOKEH_BASE = (() => {
  const r = prng(2020)
  return Array.from({ length: 26 }, () => ({
    x: r() * W,
    y: r() * H,
    r: 10 + 26 * r() ** 2,
    a: 0.04 + 0.07 * r(),
    color: BOKEH_COLORS[Math.floor(r() * BOKEH_COLORS.length)],
    orbit: 10 + 22 * r(),
    phase: 2 * Math.PI * r(),
    // Whole turns per loop, so every disc is back in place when the loop closes.
    turns: r() < 0.5 ? 1 : -1,
  }))
})()

function bokehAt(f: number): Bokeh[] {
  const a = (2 * Math.PI * loopFrame(f)) / LOOP_F
  return BOKEH_BASE.map((b) => ({
    x: b.x + b.orbit * Math.cos(b.turns * a + b.phase),
    y: b.y + b.orbit * 0.6 * Math.sin(b.turns * a + b.phase),
    r: b.r,
    a: b.a,
    color: b.color,
  }))
}

const cellBloom = (f: number) => 0.55 + 0.35 * Math.exp((-4 * mod(f - ENTRANCE_F, BEAT_FRAMES)) / BEAT_FRAMES)

/** The hold's glass wave, by the tile's place in the block. */
function waveSheen(f: number, r: Rect): number | null {
  if (f < ENTRANCE_F) return null
  const u = (centreOf(r).x - BLOCK_X) / (W - 2 * BLOCK_X)
  const j = loopFrame(f) - WAVE.at - Math.round(u * WAVE.spread)
  return j >= 0 && j < WAVE.frames ? j / WAVE.frames : null
}

function centreState(f: number, t: number): TileState {
  const lit = ignition(f, CENTRE_IGNITE_F)
  const j = f - CENTRE_SPARK.from
  // The GPU's drop still glows on Random as the scene opens.
  const boost = 1.1 * (1 - smooth(0, 1.2, t))
  return {
    rect: CENTER,
    alpha: 1,
    blur: 0,
    lit,
    neon: lit * (NEON_REST + (1 - NEON_REST) * kick(f)),
    spark: j >= 0 && j < CENTRE_SPARK.frames ? j / CENTRE_SPARK.frames : null,
    sheen: waveSheen(f, CENTER),
    link: 0,
    labels: 1,
    bloom: cellBloom(f) * 1.15 + boost,
  }
}

function satelliteState(k: number, f: number, t: number): TileState {
  const final = SATS[k]
  const A = CUES.satellites[k] - sceneStart('screens')
  const fA = frameOf(A)
  const m0 = A - MOVE_T
  const u = clamp01((t - m0) / MOVE_T)
  let rect = final
  if (u < 1) {
    const p = backOut(u)
    const from = centreOf(CENTER)
    const to = centreOf(final)
    const side = final.w * (START_SCALE + (1 - START_SCALE) * Math.min(1, p))
    const c = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p }
    rect = { x: c.x - side / 2, y: c.y - side / 2, w: side, h: side }
  }
  const lit = ignition(f, fA)
  const js = f - fA
  const jh = f - fA - 3
  return {
    rect,
    alpha: clamp01((t - m0) / 0.2),
    blur: DOF_BLUR * (1 - u) ** 2,
    lit,
    neon: lit * (NEON_REST + (1 - NEON_REST) * kick(f)),
    spark: js >= 0 && js < SPARK_T * FPS ? js / (SPARK_T * FPS) : null,
    sheen: jh >= 0 && jh < SHEEN_F ? jh / SHEEN_F : waveSheen(f, final),
    link: t < m0 || t >= A ? 0 : smooth(m0, m0 + 0.08, t) * (1 - smooth(m0 + 0.1, A, t)),
    labels: smooth(A - 0.05, A + 0.3, t),
    // A flash on ignition, gone before the hold so the loop never sees it.
    bloom: cellBloom(f) * 0.75 + (js >= 0 && js < FLASH_F ? 0.6 * (1 - js / FLASH_F) ** 2 : 0),
  }
}

/** The whole scene state at scene time `t`. Pure, so the loop can be checked frame by frame. */
export function composition(t: number): Composition {
  const f = frameOf(t)
  return {
    camera: camera(t),
    tiles: [centreState(f, t), ...SATS.map((_, k) => satelliteState(k, f, t))],
    // Once the pulled-back block clears the caption band (zoom about 1.24, t ≈ 0.95).
    caption: smooth(0.95, 1.4, t),
    footer: smooth(1.1, 1.6, t),
    bokeh: bokehAt(f),
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const views = new Map<number, Grid>()

/** The `s.view` window of `g` (the whole grid without a view); valid until the next call. */
export function viewOf(s: ScreenDef, g: Grid): Grid {
  const v = s.view
  if (!v) return g
  const n = v.size
  if (v.x < 0 || v.y < 0 || v.x + n > g.size || v.y + n > g.size) throw new RangeError(`${s.preset}: view outside the ${g.size}² board`)
  let out = views.get(n)
  if (!out) views.set(n, (out = { size: n, cells: new Uint8Array(n * n) }))
  for (let y = 0; y < n; y++) out.cells.set(g.cells.subarray((v.y + y) * g.size + v.x, (v.y + y) * g.size + v.x + n), y * n)
  return out
}

const tracks = new Map<string, SimTrack>()

/** One track per screen and layer: the crossfade's incoming layer never rewinds the main one. */
function trackFor(s: ScreenDef, layer: number): SimTrack {
  const key = `${s.preset}/${layer}`
  let tr = tracks.get(key)
  if (!tr) tracks.set(key, (tr = new SimTrack(() => seedGrid(s.preset, s.size))))
  return tr
}

/** Cells of a screen: the engine colour, warmer towards the top-left like light on glass. */
function cellColor(base: string): (u: number, v: number) => string {
  const steps = Array.from({ length: 8 }, (_, k) => mix(base, '#ffffff', 0.28 * (1 - k / 7)))
  return (u, v) => steps[Math.min(7, Math.floor(((u + v) / 2) * 8))]
}

const tileColor = (i: number) => engineColor(winner(SCREENS[i]))

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius = RADIUS): void {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, radius)
}

/** Clips to everything but the centre's glass: the satellites start out behind it. */
function clipOutsideCentre(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.rect(-W, -H, 3 * W, 3 * H)
  ctx.roundRect(CENTER.x, CENTER.y, CENTER.w, CENTER.h, RADIUS)
  ctx.clip('evenodd')
}

/** Smoked glass: dark enough to hide what is behind it, with a faint top light and a thin edge. */
function drawGlass(ctx: CanvasRenderingContext2D, r: Rect, color: string, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  roundRect(ctx, r)
  ctx.fillStyle = 'rgba(7,5,20,0.86)'
  ctx.fill()
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w * 0.4, r.y + r.h)
  g.addColorStop(0, `${mix(color, '#ffffff', 0.6)}14`)
  g.addColorStop(0.45, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

function drawTile(ctx: CanvasRenderingContext2D, i: number, tile: TileState, t: number): void {
  if (tile.alpha <= 0) return
  const s = SCREENS[i]
  const color = tileColor(i)
  drawGlass(ctx, tile.rect, color, tile.alpha)
  const cells = cellsRect(tile.rect)
  const shade = cellColor(color)
  screenLayers(s, t).forEach((l, k) => {
    if (l.w <= 0.001) return
    drawCells(ctx, viewOf(s, trackFor(s, k).at(l.gen)), cells, { color: shade, bloom: tile.bloom, dim: tile.alpha * l.w, blur: tile.blur })
  })
}

/** The link from the centre's edge to the satellite's centre, or null while it is still behind. */
function linkSegment(sat: Rect): [P, P] | null {
  const a = centreOf(CENTER)
  const b = centreOf(sat)
  const d = { x: b.x - a.x, y: b.y - a.y }
  // Leaves the centre where the first of its half-extents is reached along the way.
  const exit = Math.min(Math.abs(CENTER.w / 2 / (d.x || 1e-9)), Math.abs(CENTER.h / 2 / (d.y || 1e-9)))
  if (exit >= 1) return null
  return [{ x: a.x + d.x * exit, y: a.y + d.y * exit }, b]
}

/** A spark lapping the glass: a white-hot head and a trail that thins and cools behind it. */
function paintSpark(l: CanvasRenderingContext2D, r: Rect, color: string, from: number, p: number): void {
  const env = Math.min(1, p / 0.08, (1 - p) / 0.2)
  const TRAIL = 0.16
  const N = 28
  const head = from + p
  l.lineCap = 'round'
  for (let j = 0; j < N; j++) {
    const s0 = head - TRAIL * (1 - j / N)
    const s1 = head - TRAIL * (1 - (j + 1) / N)
    const a = perimeterPoint(r, RADIUS, s0)
    const b = perimeterPoint(r, RADIUS, s1)
    const k = (j + 1) / N
    l.globalAlpha = env * k ** 1.6
    l.strokeStyle = mix(color, '#ffffff', 0.35 + 0.6 * k)
    l.lineWidth = 2 + 5 * k
    l.beginPath()
    l.moveTo(a.x, a.y)
    l.lineTo(b.x, b.y)
    l.stroke()
  }
  const h = perimeterPoint(r, RADIUS, head)
  l.globalAlpha = env
  l.fillStyle = color
  l.beginPath()
  l.arc(h.x, h.y, 13, 0, 2 * Math.PI)
  l.fill()
  l.fillStyle = '#ffffff'
  l.beginPath()
  l.arc(h.x, h.y, 6, 0, 2 * Math.PI)
  l.fill()
}

/**
 * Every tube, spark and link on one layer, composited as neon: a wide halo that spills on the
 * night, a near glow, and the tube itself (coloured body, white-hot core). Blur radii follow the
 * camera zoom, so the glow keeps its proportions during the pull-back.
 */
function drawNeon(ctx: CanvasRenderingContext2D, c: Composition): void {
  const z = c.camera.zoom
  withLayerPasses(
    ctx,
    (l) => {
      c.tiles.forEach((tile, i) => {
        const color = tileColor(i)
        l.save()
        if (i > 0) clipOutsideCentre(l)
        if (tile.link > 0) {
          const seg = linkSegment(tile.rect)
          if (seg) {
            l.globalAlpha = tile.link
            l.lineCap = 'round'
            for (const [w, col] of [
              [7, color],
              [2.2, mix(color, '#ffffff', 0.85)],
            ] as const) {
              l.strokeStyle = col
              l.lineWidth = w
              l.beginPath()
              l.moveTo(seg[0].x, seg[0].y)
              l.lineTo(seg[1].x, seg[1].y)
              l.stroke()
            }
          }
        }
        if (tile.neon > 0) {
          l.globalAlpha = tile.neon * tile.alpha
          roundRect(l, tile.rect)
          l.strokeStyle = color
          l.lineWidth = i === 0 ? 7 : 6
          l.stroke()
          l.strokeStyle = mix(color, '#ffffff', 0.82)
          l.lineWidth = 2.2
          l.stroke()
        }
        if (tile.spark !== null) paintSpark(l, tile.rect, color, i === 0 ? 0 : SPARK_FROM[i - 1], tile.spark)
        l.restore()
      })
    },
    [
      { filter: `blur(${Math.round(44 * z)}px)`, alpha: 0.5, op: 'lighter' },
      { filter: `blur(${Math.round(13 * z)}px)`, alpha: 0.9, op: 'lighter' },
      { filter: `blur(${(3 * z).toFixed(1)}px)`, alpha: 0.8, op: 'lighter' },
      { alpha: 1, op: 'lighter' },
    ],
  )
}

/** A soft band of light sweeping diagonally across the glass. */
function drawSheen(ctx: CanvasRenderingContext2D, r: Rect, p: number, strength: number): void {
  const x = r.x - r.w * 0.5 + p * r.w * 2
  const band = r.w * 0.28
  ctx.save()
  roundRect(ctx, r)
  ctx.clip()
  ctx.translate(x, r.y + r.h / 2)
  ctx.rotate(-0.42)
  const g = ctx.createLinearGradient(-band, 0, band, 0)
  const a = strength * Math.sin(Math.PI * p)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.fillRect(-band, -r.h * 1.5, 2 * band, r.h * 3)
  ctx.restore()
}

function widthOf(ctx: CanvasRenderingContext2D, c: Cell): number {
  ctx.font = `${c.weight} ${c.size}px ${FONT_FAMILY}`
  return ctx.measureText(c.s).width
}

function pill(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.h / 2, 22))
  ctx.fillStyle = 'rgba(6,4,18,0.74)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1.2
  ctx.stroke()
}

const PILL_MARGIN = 16

/** Name pill (top-left) and figures pill (bottom, on the outer side) of screen i. */
function drawLabels(ctx: CanvasRenderingContext2D, i: number, r: Rect, alpha: number): void {
  if (alpha <= 0) return
  const s = SCREENS[i]
  const big = i === 0
  ctx.save()
  ctx.globalAlpha = alpha

  // Name; the centre also carries the units every figure on screen is in.
  const name: Cell = { s: s.name, size: big ? 40 : 28, weight: 700, color: '#ffffff' }
  const units: Cell = { s: screenLines(s).units, size: 28, weight: 400, color: DIM_TEXT }
  const pad = big ? 22 : 16
  const nameW = widthOf(ctx, name) + (big ? 22 + widthOf(ctx, units) : 0)
  const nh = name.size + (big ? 26 : 20)
  pill(ctx, { x: r.x + PILL_MARGIN, y: r.y + PILL_MARGIN, w: nameW + 2 * pad, h: nh })
  const nb = r.y + PILL_MARGIN + nh / 2 + name.size * 0.36
  text(ctx, name.s, r.x + PILL_MARGIN + pad, nb, name)
  if (big) text(ctx, units.s, r.x + PILL_MARGIN + pad + widthOf(ctx, name) + 22, nb, units)

  // Figures: labels left, figures right-aligned in one column, the pill on the tile's bottom edge.
  const rows = numberRows(s, big)
  const lineH = (row: Cell[]) => Math.max(...row.map((c) => c.size)) * (big ? 1.25 : 1.1)
  const vpad = big ? 14 : 9
  const h = rows.reduce((a, row) => a + lineH(row), 0) + 2 * vpad
  const margin = big ? PILL_MARGIN : 10
  const labelW = Math.max(...rows.map((row) => widthOf(ctx, row[0])))
  const figW = Math.max(...rows.filter((row) => row[1]).map((row) => widthOf(ctx, row[1])))
  const w = big ? labelW + 40 + figW + 2 * pad : r.w - 2 * margin
  const x = r.x + margin
  const y = r.y + r.h - margin - h
  pill(ctx, { x, y, w, h })
  let by = y + vpad
  for (const row of rows) {
    by += lineH(row)
    const base = by - lineH(row) * 0.26
    text(ctx, row[0].s, x + (big ? pad : 12), base, row[0])
    if (row[1]) text(ctx, row[1].s, x + w - (big ? pad : 12), base, { ...row[1], align: 'right' })
  }
  ctx.restore()
}

/** Out-of-focus lights far behind the screens: they follow the camera a third as much (parallax). */
function drawBokeh(ctx: CanvasRenderingContext2D, c: Composition): void {
  const k = 1 + (c.camera.zoom - 1) * 0.3
  withLayerPasses(
    ctx,
    (l) => {
      for (const b of c.bokeh) {
        // A lens's out-of-focus disc: flat, with a slightly brighter rim.
        l.globalAlpha = b.a
        l.fillStyle = b.color
        l.strokeStyle = b.color
        l.lineWidth = 2
        l.beginPath()
        l.arc(W / 2 + c.camera.x * 0.35 + k * (b.x - W / 2), H / 2 + c.camera.y * 0.35 + k * (b.y - H / 2), b.r * k, 0, 2 * Math.PI)
        l.fill()
        l.globalAlpha = b.a * 1.2
        l.stroke()
      }
    },
    [{ filter: 'blur(3px)', alpha: 1, op: 'lighter' }],
  )
}

export const screens: Scene = {
  id: 'screens',
  figures: SCREENS.flatMap((s) => PAIR.map((e) => ref(e, s.preset))),
  draw(ctx, s) {
    const { t } = s
    const c = composition(t)
    nightBackground(ctx)
    drawBokeh(ctx, c)

    ctx.save()
    ctx.translate(W / 2 + c.camera.x, H / 2 + c.camera.y)
    ctx.scale(c.camera.zoom, c.camera.zoom)
    ctx.translate(-W / 2, -H / 2)
    ctx.save()
    clipOutsideCentre(ctx)
    for (let k = 1; k < c.tiles.length; k++) drawTile(ctx, k, c.tiles[k], t)
    ctx.restore()
    drawTile(ctx, 0, c.tiles[0], t)
    drawNeon(ctx, c)
    c.tiles.forEach((tile) => {
      if (tile.sheen !== null && tile.alpha > 0) drawSheen(ctx, tile.rect, tile.sheen, t < ENTRANCE_T ? 0.2 : 0.12)
    })
    c.tiles.forEach((tile, i) => drawLabels(ctx, i, tile.rect, tile.labels * tile.alpha))
    const die = c.tiles[4]
    ctx.save()
    ctx.globalAlpha = die.labels
    DIEHARD_CAPTION.forEach((line, j) =>
      text(ctx, line, SATS[3].x + SATS[3].w, SATS[3].y + SATS[3].h + 48 + 36 * j, { size: 28, weight: 400, color: DIM_TEXT, align: 'right' }),
    )
    ctx.restore()
    ctx.restore()

    // Static, outside the camera: the caption and the machine stay put.
    ctx.save()
    ctx.font = `600 44px ${FONT_FAMILY}`
    const cw = ctx.measureText(GLOBAL_CAPTION).width
    ctx.restore()
    caption(ctx, GLOBAL_CAPTION, (W - cw) / 2, 92, c.caption)
    ctx.save()
    ctx.globalAlpha = c.footer
    text(ctx, MACHINE_LABEL, W / 2, H - 46, { size: 28, weight: 400, color: 'rgba(255,255,255,0.45)', align: 'center' })
    ctx.restore()
  },
}
