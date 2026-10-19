// Scene 6: five glass screens. Random pops in the centre, in bloom; four sparse seeds float
// around it in depth of field. Each screen carries its own wasm-simd and webgpu-naive figures
// at 1024², and the cells glow in the colour of whichever engine wins on that seed.
// These 10 s are also the muted portfolio loop: everything here is periodic over the scene.
import { type Grid } from '../../../web/src/grid'
import { type EngineId, type FigureRef, formatGps, gensPerSec, MACHINE_LABEL } from '../data'
import { FONT_FAMILY, type Rect, drawCells, nightBackground, text } from '../render/canvas'
import { engineColor } from '../render/palette'
import { SimTrack, seedGrid } from '../sim/track'
import { CUES, FPS, H, SCENE_BARS, W, sceneStart } from '../timeline'
import { beatBloom, caption, glass, mix, smooth } from './sweep'
import { type Scene } from './types'

export const LOOP_T = SCENE_BARS.screens * 2
/**
 * Generations a second, the same on every screen: the screens show seeds, not engines, so no
 * screen may look faster than another. 520 a loop, a multiple of Diehard's 130.
 */
export const RATE = 52

const PAIR: readonly EngineId[] = ['wasm-simd', 'webgpu-naive']
const PAIR_LABEL: Record<string, string> = { 'wasm-simd': 'wasm-simd 1 thread', 'webgpu-naive': 'webgpu-naive' }

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
   * Side of the window shown, centred on the board, when the seed stays in the middle of it:
   * the whole 128² board would draw Clown and Diehard a few pixels wide.
   */
  view?: number
}

export const SCREENS: readonly ScreenDef[] = [
  { preset: 'random', name: 'Random 50%', size: 256, g0: 80, cycle: 520, fade: 0.6 },
  { preset: 'guns', name: 'Gosper guns', size: 256, g0: 300, cycle: 520, fade: 0.6 },
  // The tagalongs cross half the board in 260 generations, just before reaching its edge.
  { preset: 'bugs', name: 'LWSS tagalongs', size: 256, g0: 22, cycle: 260, fade: 0.4 },
  // The clown settles into a still life around generation 200: start over to keep it alive.
  { preset: 'clown', name: 'Clown', size: 128, g0: 0, cycle: 260, fade: 0.3, view: 64 },
  // Diehard dies at generation 130, then is seeded again.
  { preset: 'diehard', name: 'Diehard', size: 128, g0: 0, cycle: 130, fade: 0, view: 64 },
]

export const GLOBAL_CAPTION = 'sparse seeds: lazy tiling skips inactive tiles'
export const DIEHARD_CAPTION = ['board dies at gen 130 —', 'lazy tiling skips empty tiles'] as const

const ref = (engine: EngineId, preset: string): FigureRef => ({ engine, preset, size: 1024 })

/** The figures under a screen, from the bench, in the order wasm-simd then webgpu-naive. */
export function screenLines(s: ScreenDef): { name: string; units: string; figures: string[] } {
  return {
    name: s.name,
    units: 'gen/s · 1024²',
    figures: PAIR.map((e) => `${PAIR_LABEL[e]} · ${formatGps(gensPerSec(ref(e, s.preset)))}`),
  }
}

/** The engine with the higher figure on this seed: its colour lights the cells. */
function winner(s: ScreenDef): EngineId {
  const [a, b] = PAIR.map((e) => gensPerSec(ref(e, s.preset)))
  return a >= b ? PAIR[0] : PAIR[1]
}

// ── Time ────────────────────────────────────────────────────────────────────

const frameOf = (t: number) => Math.round(t * FPS)

/**
 * Generations a screen shows at scene time `t`, with their weights. Counted in frames, so the
 * mapping repeats exactly every LOOP_T: frame 599 leads into frame 0 like any other pair.
 */
export function screenLayers(s: ScreenDef, t: number): { gen: number; w: number }[] {
  const cycleFrames = (s.cycle * FPS) / RATE
  const fc = ((frameOf(t) % cycleFrames) + cycleFrames) % cycleFrames
  const i = Math.floor((fc * RATE) / FPS)
  const end = cycleFrames / FPS
  const w = s.fade > 0 ? smooth(end - s.fade, end, fc / FPS) : 0
  const layers = [{ gen: s.g0 + i, w: 1 - w }]
  const incoming = s.g0 + i - s.cycle
  if (w > 0 && incoming >= 0) layers.push({ gen: incoming, w })
  return layers
}

const RISE = 0.12
const DECAY = 0.3
const satCue = (k: number) => CUES.satellites[k] - sceneStart('screens')

/**
 * A satellite's glass whoosh on its cue: a short rise just before, then an exponential decay.
 * Time is taken modulo the loop, so the first satellite's rise sits at the end of the scene
 * and the loop seam stays continuous.
 */
export function satellitePulse(k: number, t: number): number {
  const d = (((frameOf(t) - frameOf(satCue(k))) / FPS) % LOOP_T + LOOP_T) % LOOP_T
  if (d > LOOP_T - RISE) return smooth(LOOP_T - RISE, LOOP_T, d)
  return Math.exp(-d / DECAY)
}

/** Slow camera drift on a Lissajous path whose period is the loop. */
export function drift(t: number): { x: number; y: number; zoom: number } {
  const a = (2 * Math.PI * t) / LOOP_T
  return { x: 16 * Math.sin(a), y: 10 * Math.sin(2 * a), zoom: 1 + 0.015 * Math.sin(a + Math.PI / 3) }
}

// ── Layout (1920 × 1200) ────────────────────────────────────────────────────

const CENTER: Rect = { x: 660, y: 170, w: 600, h: 600 }
const SAT = 320
const SIDE = 120
/** Satellites' glass rects, in cue order: guns top-left, bugs top-right, clown bottom-left, diehard bottom-right. */
const SATS: readonly Rect[] = [
  { x: SIDE, y: 130, w: SAT, h: SAT },
  { x: W - SIDE - SAT, y: 130, w: SAT, h: SAT },
  { x: SIDE, y: 612, w: SAT, h: SAT },
  { x: W - SIDE - SAT, y: 612, w: SAT, h: SAT },
]
/** Satellites sit behind the centre: they follow the drift less (parallax). */
const SAT_PARALLAX = 0.45

type Seg = { s: string; size: number; weight: 400 | 600 | 700; color: string }

/** One line of differently styled segments, aligned as a whole at x. */
function line(ctx: CanvasRenderingContext2D, segs: Seg[], x: number, y: number, align: 'left' | 'right' | 'center'): void {
  ctx.save()
  const widths = segs.map((g) => {
    ctx.font = `${g.weight} ${g.size}px ${FONT_FAMILY}`
    return ctx.measureText(g.s).width
  })
  ctx.restore()
  const total = widths.reduce((a, b) => a + b, 0)
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2
  segs.forEach((g, k) => {
    text(ctx, g.s, cx, y, { size: g.size, weight: g.weight, color: g.color })
    cx += widths[k]
  })
}

const DIM_TEXT = 'rgba(255,255,255,0.62)'

/** Name and units, then one line per engine: label in its colour, figure in bold. */
function labels(ctx: CanvasRenderingContext2D, s: ScreenDef, x: number, y: number, align: 'left' | 'right' | 'center', big: boolean): number {
  const l = screenLines(s)
  const [nameSize, unitSize, figSize, gap] = big ? [44, 32, 38, 50] : [32, 28, 30, 40]
  line(
    ctx,
    [
      { s: l.name, size: nameSize, weight: 700, color: '#ffffff' },
      { s: `   ${l.units}`, size: unitSize, weight: 400, color: DIM_TEXT },
    ],
    x,
    y,
    align,
  )
  PAIR.forEach((e, k) => {
    const [label, figure] = l.figures[k].split(' · ')
    const c = engineColor(e)
    line(
      ctx,
      [
        { s: `${label} · `, size: figSize - 2, weight: 400, color: c },
        { s: figure, size: figSize, weight: 700, color: mix(c, '#ffffff', 0.25) },
      ],
      x,
      y + gap * (k + 1),
      align,
    )
  })
  return y + gap * PAIR.length
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const views = new Map<number, Grid>()

/** The centred `s.view`² window of `g` (the whole grid without a view); valid until the next call. */
export function viewOf(s: ScreenDef, g: Grid): Grid {
  const n = s.view
  if (!n || n >= g.size) return g
  let out = views.get(n)
  if (!out) views.set(n, (out = { size: n, cells: new Uint8Array(n * n) }))
  const o = (g.size - n) >> 1
  for (let y = 0; y < n; y++) out.cells.set(g.cells.subarray((o + y) * g.size + o, (o + y) * g.size + o + n), y * n)
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

function screenCells(ctx: CanvasRenderingContext2D, s: ScreenDef, r: Rect, t: number, opts: { bloom: number; dim: number; blur: number; color: string }): void {
  const color = cellColor(opts.color)
  screenLayers(s, t).forEach((l, k) => {
    if (l.w <= 0.001) return
    drawCells(ctx, viewOf(s, trackFor(s, k).at(l.gen)), r, { color, bloom: opts.bloom, dim: opts.dim * l.w, blur: opts.blur })
  })
}

/** The glass of a screen, its border lit by `glow` in `color`. */
function screenGlass(ctx: CanvasRenderingContext2D, r: Rect, color: string, glow: number, shadow: number): void {
  const pad = 12
  const g = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = shadow
  glass(ctx, g, { radius: 18, fill: 'rgba(255,255,255,0.03)' })
  ctx.restore()
  if (glow <= 0.002) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, glow)
  ctx.shadowColor = color
  ctx.shadowBlur = 30
  ctx.strokeStyle = mix(color, '#ffffff', 0.5)
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.roundRect(g.x, g.y, g.w, g.h, 18)
  ctx.stroke()
  ctx.restore()
}

const SHEEN_T = 0.45

/** A diagonal band of light sweeping across a satellite's glass after its cue. */
function sheen(ctx: CanvasRenderingContext2D, r: Rect, sinceCue: number): void {
  if (sinceCue < 0 || sinceCue > SHEEN_T) return
  const p = sinceCue / SHEEN_T
  const x = r.x - r.w * 0.4 + p * r.w * 1.8
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(r.x - 12, r.y - 12, r.w + 24, r.h + 24, 18)
  ctx.clip()
  const g = ctx.createLinearGradient(x - 90, r.y, x + 90, r.y + r.h * 0.5)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, `rgba(255,255,255,${0.16 * (1 - p)})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.fillRect(r.x - 12, r.y - 12, r.w + 24, r.h + 24)
  ctx.restore()
}

function drawSatellite(ctx: CanvasRenderingContext2D, k: number, t: number, beat: number): void {
  const s = SCREENS[k + 1]
  const base = SATS[k]
  const e = satellitePulse(k, t)
  const color = engineColor(winner(s))
  // The whoosh brings the satellite forward and into focus for a moment, then it settles back.
  const scale = 1 + 0.04 * e
  const r: Rect = {
    x: base.x + (base.w * (1 - scale)) / 2,
    y: base.y + (base.h * (1 - scale)) / 2,
    w: base.w * scale,
    h: base.h * scale,
  }
  screenGlass(ctx, r, color, 0.9 * e, 12 + 30 * e)
  screenCells(ctx, s, r, t, { bloom: 0.45 * beatBloom(beat) + 0.9 * e, dim: 0.8 + 0.2 * e, blur: 1.2 * (1 - e), color })
  sheen(ctx, r, (frameOf(t) - frameOf(satCue(k))) / FPS)

  const right = k % 2 === 1
  const bottom = labels(ctx, s, right ? base.x + base.w : base.x, base.y + base.h + 50, right ? 'right' : 'left', false)
  if (s.preset === 'diehard') {
    DIEHARD_CAPTION.forEach((c, j) => text(ctx, c, base.x + base.w, bottom + 42 + 36 * j, { size: 28, weight: 400, color: DIM_TEXT, align: 'right' }))
  }
}

function drawCenter(ctx: CanvasRenderingContext2D, t: number, beat: number): void {
  const s = SCREENS[0]
  const color = engineColor(winner(s))
  const kick = (beatBloom(beat) - 0.55) / 0.35
  screenGlass(ctx, CENTER, color, 0.25 + 0.2 * kick, 50 + 30 * kick)
  screenCells(ctx, s, CENTER, t, { bloom: beatBloom(beat) * 1.15, dim: 1, blur: 0, color })
  labels(ctx, s, CENTER.x + CENTER.w / 2, CENTER.y + CENTER.h + 66, 'center', true)
}

export const screens: Scene = {
  id: 'screens',
  figures: SCREENS.flatMap((s) => PAIR.map((e) => ref(e, s.preset))),
  draw(ctx, s) {
    const { t, beat } = s
    nightBackground(ctx)
    const d = drift(t)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(d.zoom, d.zoom)
    ctx.translate(-W / 2, -H / 2)
    ctx.save()
    ctx.translate(d.x * SAT_PARALLAX, d.y * SAT_PARALLAX)
    for (let k = 0; k < SATS.length; k++) drawSatellite(ctx, k, t, beat)
    ctx.restore()
    ctx.save()
    ctx.translate(d.x, d.y)
    drawCenter(ctx, t, beat)
    ctx.restore()
    ctx.restore()

    // Static, outside the drift: the caption and the machine stay put.
    ctx.save()
    ctx.font = `600 44px ${FONT_FAMILY}`
    const cw = ctx.measureText(GLOBAL_CAPTION).width
    ctx.restore()
    caption(ctx, GLOBAL_CAPTION, (W - cw) / 2, 92)
    // Centred: the bottom corners carry the satellites' labels.
    text(ctx, MACHINE_LABEL, W / 2, H - 50, { size: 28, weight: 400, color: 'rgba(255,255,255,0.45)', align: 'center' })
  },
}
