import { mulberry32 } from '../../../web/src/random'
import { type FigureRef, gensPerSec } from '../data'
import { type Rect, drawCells, nightBackground, text, withLayer } from '../render/canvas'
import { engineColor } from '../render/palette'
import { SimTrack, seedGrid } from '../sim/track'
import { CUES, FPS, sceneStart } from '../timeline'
import { NATIVE_END_GEN } from './native'
import {
  CAPTION_Y,
  type CounterState,
  GRID_RECT,
  GenPair,
  ROLL_DURATION,
  SIM_SIZE,
  TRAIL,
  beatBloom,
  caption,
  clamp01,
  drawCounter,
  glass,
  machineLabel,
  mix,
  ownFigure,
  rollValue,
  scanLines,
  smooth,
  sweepPalette,
} from './sweep'
import { type Scene } from './types'

const WSEQ: FigureRef = { engine: 'wasm-seq', preset: 'random', size: 1024 }
const WSIMD: FigureRef = { engine: 'wasm-simd', preset: 'random', size: 1024 }

const COMPILE_T = CUES.compile - sceneStart('simd')
const LASER_T = CUES.simdLaser - sceneStart('simd')
const GLITCH_TIME = 0.5
/** wasm-seq sweeps a generation per beat. */
const WSEQ_PERIOD = 0.5
/**
 * The laser starts on this row, among live cells rather than on the always-dead border row;
 * the wasm-seq sweep is phased so that it hands over exactly there.
 */
const LASER_ROW0 = 40
const WSEQ_PHASE = LASER_ROW0 / SIM_SIZE
const LASER_GEN0 = NATIVE_END_GEN + Math.round((LASER_T - COMPILE_T) / WSEQ_PERIOD)

/** Cells computed by one 128-bit SIMD instruction (u8 lanes). */
export const LASER_WIDTH = 16
const STEPS_PER_ROW = SIM_SIZE / LASER_WIDTH
const STEPS_PER_GEN = STEPS_PER_ROW * SIM_SIZE
// First second: one instruction per sixteenth note, each step readable, half a row in view.
const R0 = 8
// Full speed: a generation per eighth note, 17 rows a frame, so the sweep (and the marker
// riding it) still reads as motion at 60 fps instead of strobing between a few rows.
const R1 = STEPS_PER_GEN / 0.25
const ACCEL = Math.log(R1 / R0)

function laserRate(tau: number): number {
  if (tau < 1) return R0
  if (tau < 2) return R0 * Math.exp(ACCEL * (tau - 1))
  return R1
}

/** Instructions run `tau` seconds after the laser cue: constant, then exponential ramp, then full speed. */
export function laserStep(tau: number): number {
  if (tau <= 0) return 0
  if (tau < 1) return Math.floor(R0 * tau)
  if (tau < 2) return Math.floor(R0 + (R0 / ACCEL) * (Math.exp(ACCEL * (tau - 1)) - 1))
  return Math.floor(R0 + (R1 - R0) / ACCEL + R1 * (tau - 2))
}

/** The marker steps to the next 16-cell slot of its row once per sixteenth note (the hi-hats). */
export const MARKER_RATE = 8

type Pos = { row: number; col: number }

/** Row and first column of the instruction the laser runs `tau` seconds after its cue. */
export function laserAt(tau: number): Pos & { gen: number } {
  const k = LASER_ROW0 * STEPS_PER_ROW + laserStep(tau)
  const within = k % STEPS_PER_GEN
  return {
    gen: LASER_GEN0 + Math.floor(k / STEPS_PER_GEN),
    row: Math.floor(within / STEPS_PER_ROW),
    col: (within % STEPS_PER_ROW) * LASER_WIDTH,
  }
}

/**
 * Where the 16-dot marker is drawn. It rides the laser's row, i.e. the scan line, and steps
 * slot by slot along it once per sixteenth note. While the laser runs one instruction per
 * sixteenth note this is the laser itself. At full speed a sixteenth note is exactly one
 * generation, so sampling the laser's own column per note would freeze the marker in place.
 */
export function markerAt(tau: number): Pos {
  return {
    row: laserAt(tau).row,
    col: (Math.floor(tau * MARKER_RATE) % STEPS_PER_ROW) * LASER_WIDTH,
  }
}

export function simdCounter(t: number): CounterState {
  const seq = gensPerSec(WSEQ)
  if (t < LASER_T) return { engine: 'wasm-seq', value: ownFigure(WSEQ.engine, rollValue(0, seq, t, COMPILE_T)) }
  // Rolls up from 0, not from 548: the new label must never sit over the old engine's figure.
  return { engine: 'wasm-simd', value: ownFigure(WSIMD.engine, rollValue(0, gensPerSec(WSIMD), t, LASER_T)), prev: { engine: 'wasm-seq', value: seq } }
}

type Cam = { x: number; y: number; side: number }
const FULL: Cam = { x: GRID_RECT.x, y: GRID_RECT.y, side: GRID_RECT.w }
const ZOOM_CELL = 12
const ZOOM_SIDE = SIM_SIZE * ZOOM_CELL
// Zoomed on the left edge with the laser row above the counter panel: the first second's
// 8 instructions (128 cells) all stay in view.
const ZOOM: Cam = { x: 96, y: 300 - (LASER_ROW0 + 0.5) * ZOOM_CELL, side: ZOOM_SIDE }

function lerpCam(a: Cam, b: Cam, e: number): Cam {
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    side: Math.exp(Math.log(a.side) + (Math.log(b.side) - Math.log(a.side)) * e),
  }
}

/** Zooms in before the laser cue, holds for its first second, zooms back out as it speeds up. */
function camera(t: number): Cam {
  const L = LASER_T
  if (t < L) return lerpCam(FULL, ZOOM, smooth(L - 1, L, t))
  return lerpCam(ZOOM, FULL, smooth(L + 1, L + 2, t))
}

let pair: GenPair | null = null
const shown = new Uint8Array(SIM_SIZE * SIM_SIZE)
const cut = new Int32Array(SIM_SIZE)
/** Per row: 0 not swept, 1 being swept, d + 1 swept d rows ago, TRAIL + 2 swept long ago. */
const rowState = new Uint8Array(SIM_SIZE)
const markerCells = new Uint8Array(LASER_WIDTH)
const scratch: HTMLCanvasElement[] = []

function setRows(hot: number): void {
  for (let y = 0; y < SIM_SIZE; y++) rowState[y] = y > hot ? 0 : y === hot ? 1 : Math.min(TRAIL + 2, hot - y + 1)
}

/**
 * Sixteen dots lit together on the cells one instruction computes, inside a white bracket.
 * Both keep a minimum size, so the bar stays legible over 3 px cells in the full view.
 */
function drawLaser(ctx: CanvasRenderingContext2D, cam: Cam, row: number, col: number, color: string, flash: number): void {
  const cell = cam.side / SIM_SIZE
  const cy = cam.y + (row + 0.5) * cell
  const dots = (l: CanvasRenderingContext2D, r: number, style: string) => {
    l.fillStyle = style
    l.beginPath()
    for (let i = 0; i < LASER_WIDTH; i++) {
      const cx = cam.x + (col + i + 0.5) * cell
      l.moveTo(cx + r, cy)
      l.arc(cx, cy, r, 0, Math.PI * 2)
    }
    l.fill()
  }
  withLayer(ctx, (l) => dots(l, Math.max(5, cell * 0.7), color), { filter: `blur(${Math.max(6, cell * 1.2)}px)`, alpha: Math.min(1, 0.9 * flash), op: 'lighter' })
  withLayer(ctx, (l) => dots(l, Math.max(2.2, cell * 0.44), mix(color, '#ffffff', 0.75)), { op: 'lighter' })
  const pad = Math.max(6, cell * 0.2)
  const h = Math.max(18, cell * 1.4)
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.roundRect(cam.x + col * cell - pad, cy - h / 2, LASER_WIDTH * cell + 2 * pad, h, h / 2)
  ctx.stroke()
  ctx.restore()
}

const INSET: Rect = { x: 1100, y: 900, w: 720, h: 150 }
const INSET_PITCH = 40

/**
 * Magnified copy of the marked instruction under the counter, for the full view where the
 * cells are 3 px: its 16 cells as big dots, live ones white-hot, all lit on each step,
 * tied to the marker on the grid by a leader line.
 */
function drawInset(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, cells: Uint8Array, color: string, flash: number, alpha: number): void {
  if (alpha <= 0) return
  const r = INSET
  const y0 = r.y + 104
  const x0 = r.x + (r.w - (LASER_WIDTH - 1) * INSET_PITCH) / 2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(r.x, r.y + r.h / 2)
  ctx.stroke()
  ctx.restore()
  // Dark fill: the inset fades in while zoomed-in cells may still sit behind it.
  glass(ctx, r, { radius: 24, fill: 'rgba(8,6,24,0.8)', alpha })
  ctx.save()
  ctx.globalAlpha = alpha
  text(ctx, '1 instruction · 16 cells', r.x + 40, r.y + 50, { size: 28, weight: 400, color: 'rgba(255,255,255,0.6)' })
  ctx.restore()
  const dots = (l: CanvasRenderingContext2D, rad: number, live: boolean | null, style: string) => {
    l.fillStyle = style
    l.beginPath()
    for (let i = 0; i < LASER_WIDTH; i++) {
      if (live !== null && !!cells[i] !== live) continue
      const cx = x0 + i * INSET_PITCH
      l.moveTo(cx + rad, y0)
      l.arc(cx, y0, rad, 0, Math.PI * 2)
    }
    l.fill()
  }
  withLayer(ctx, (l) => dots(l, 16, null, color), { filter: 'blur(10px)', alpha: alpha * Math.min(1, 0.7 * flash), op: 'lighter' })
  withLayer(
    ctx,
    (l) => {
      dots(l, 13, false, mix(color, '#05040f', 0.15))
      dots(l, 13, true, mix(color, '#ffffff', 0.8))
    },
    { alpha, op: 'lighter' },
  )
}

function canvasLike(i: number, src: HTMLCanvasElement): HTMLCanvasElement {
  const c = (scratch[i] ??= document.createElement('canvas'))
  if (c.width !== src.width || c.height !== src.height) {
    c.width = src.width
    c.height = src.height
  }
  return c
}

/**
 * Compilation glitch: displaced horizontal slices and a magenta/cyan channel split, seeded by the
 * frame so every render of a frame is identical.
 */
function glitch(ctx: CanvasRenderingContext2D, amount: number, frame: number): void {
  if (amount <= 0) return
  const src = ctx.canvas
  const { width, height } = src
  const copy = canvasLike(0, src)
  const cctx = copy.getContext('2d')!
  cctx.reset()
  cctx.drawImage(src, 0, 0)
  const tint = (i: number, color: string) => {
    const c = canvasLike(i, src)
    const t = c.getContext('2d')!
    t.reset()
    t.drawImage(copy, 0, 0)
    t.globalCompositeOperation = 'multiply'
    t.fillStyle = color
    t.fillRect(0, 0, width, height)
    t.globalCompositeOperation = 'destination-in'
    t.drawImage(copy, 0, 0)
    return c
  }
  const rnd = mulberry32(0xc0de + frame)
  ctx.save()
  ctx.resetTransform()
  for (let y = 0; y < height; ) {
    const h = 6 + Math.floor(rnd() * 70)
    if (rnd() < 0.15 + 0.5 * amount) {
      const dx = (rnd() - 0.5) * 320 * amount
      ctx.drawImage(copy, 0, y, width, h, dx, y, width, h)
    }
    y += h
  }
  const split = 8 + 28 * amount
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.55 * amount
  ctx.drawImage(tint(1, '#ff3d81'), split, 0)
  ctx.drawImage(tint(2, '#4cc9f0'), -split, 0)
  ctx.restore()
}

export const simd: Scene = {
  id: 'simd',
  figures: [WSEQ, WSIMD],
  draw(ctx, s) {
    const { t } = s
    pair ??= new GenPair(new SimTrack(() => seedGrid('random', SIM_SIZE)), SIM_SIZE)
    const laserOn = t >= LASER_T
    const engine = laserOn ? WSIMD.engine : WSEQ.engine
    const pal = sweepPalette(engineColor(engine))
    const cam = camera(t)
    const zoom = clamp01((cam.side - FULL.side) / (ZOOM_SIDE - FULL.side))
    const cell = cam.side / SIM_SIZE

    let gen: number
    let lineRow: number
    let laser: { row: number; col: number } | null = null
    let insetLater: (() => void) | null = null
    if (!laserOn) {
      const x = (t - COMPILE_T) / WSEQ_PERIOD + WSEQ_PHASE
      gen = NATIVE_END_GEN + Math.floor(x)
      lineRow = (x - Math.floor(x)) * SIM_SIZE
      const hot = Math.floor(lineRow)
      cut.fill(SIM_SIZE, 0, hot + 1)
      cut.fill(0, hot + 1)
      setRows(hot)
    } else {
      const at = laserAt(t - LASER_T)
      gen = at.gen
      laser = { row: at.row, col: at.col }
      lineRow = laser.row + 0.5
      cut.fill(SIM_SIZE, 0, laser.row)
      cut.fill(0, laser.row)
      cut[laser.row] = laser.col + LASER_WIDTH
      setRows(laser.row)
    }
    pair.at(gen).compose(shown, cut)
    const colors = [pal.pending, pal.hot, ...pal.trail, pal.done]
    // On the laser row only the cells left of the instruction are swept.
    const color = (u: number, v: number) => {
      const y = Math.floor(v * SIM_SIZE)
      if (laser && y === laser.row) {
        const x = Math.floor(u * SIM_SIZE)
        return x < laser.col ? pal.done : x < laser.col + LASER_WIDTH ? pal.hot : pal.pending
      }
      return colors[rowState[y]]
    }

    nightBackground(ctx)
    const rect: Rect = { x: cam.x, y: cam.y, w: cam.side, h: cam.side }
    glass(ctx, { x: rect.x - 18, y: rect.y - 18, w: rect.w + 36, h: rect.h + 36 })
    drawCells(ctx, { size: SIM_SIZE, cells: shown }, rect, { color, bloom: beatBloom(s.beat) })

    // A fast laser blurs into a scan line; the sequential sweep is one all along.
    const lineAlpha = laser ? clamp01((laserRate(t - LASER_T) - 400) / 4000) : 1
    scanLines(ctx, [cam.y + lineRow * cell], cam.x - 10, cam.x + cam.side + 10, pal.done, lineAlpha)
    if (laser) {
      const tau = t - LASER_T
      const { row: mRow, col: mCol } = markerAt(tau)
      // Bright on the cue, then a smaller flash on every step.
      const sinceStep = tau - Math.floor(tau * MARKER_RATE) / MARKER_RATE
      const flash = 1 + 1.5 * Math.exp(-tau * 6) + 0.6 * Math.exp(-sinceStep * 14)
      drawLaser(ctx, cam, mRow, mCol, pal.done, flash)
      markerCells.set(shown.subarray(mRow * SIM_SIZE + mCol, mRow * SIM_SIZE + mCol + LASER_WIDTH))
      const end = { x: cam.x + (mCol + LASER_WIDTH) * cell + Math.max(6, cell * 0.2), y: cam.y + (mRow + 0.5) * cell }
      insetLater = () => drawInset(ctx, end, markerCells, pal.done, flash, 1 - smooth(0, 0.6, zoom))
    }

    // Under the counter panel, so the leader never crosses the figure while the camera zooms out.
    insetLater?.()
    const counter = simdCounter(t)
    const landed = (laserOn ? LASER_T : COMPILE_T) + ROLL_DURATION
    drawCounter(ctx, counter, engineColor, {
      glow: t >= landed ? Math.exp(-(t - landed) * 5) : 0,
      prevAlpha: smooth(LASER_T, LASER_T + 0.4, t),
      panelFill: zoom > 0 ? `rgba(8,6,24,${(0.82 * zoom).toFixed(3)})` : undefined,
    })
    if (!laserOn) caption(ctx, 'compiled to WebAssembly', GRID_RECT.x + 26, CAPTION_Y, 1 - smooth(LASER_T - 0.2, LASER_T, t))
    else caption(ctx, '16 cells per instruction', GRID_RECT.x + 26, CAPTION_Y, smooth(LASER_T, LASER_T + 0.25, t))
    machineLabel(ctx)

    glitch(ctx, (1 - clamp01((t - COMPILE_T) / GLITCH_TIME)) ** 2, Math.round(t * FPS))
  },
}
