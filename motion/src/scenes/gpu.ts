// Scene 5: aerial view of the GPU at work. A 512² grid split into 32×32 workgroups of 16×16
// cells; dispatches sweep it in waves that come faster and faster until every tile is lit on the
// drop, where webgpu-naive lands. Then webgpu-tiled, slower despite its shared-memory tiles.
import { ENGINE_LABEL, type FigureRef, formatGps, gensPerSec, speedup } from '../data'
import { FONT_FAMILY, type P, drawPerspective, nightBackground, text, withLayer } from '../render/canvas'
import { engineColor } from '../render/palette'
import { SimTrack, seedGrid } from '../sim/track'
import { CUES, FPS, H, SCENE_BARS, W, sceneStart } from '../timeline'
import {
  CAPTION_Y,
  COUNTER_RECT,
  type CounterState,
  GRID_RECT,
  GenPair,
  ROLL_DURATION,
  beatBloom,
  caption,
  drawCounter,
  machineLabel,
  mix,
  ownFigure,
  rollValue,
  smooth,
} from './sweep'
import { type Scene } from './types'

const NAIVE: FigureRef = { engine: 'webgpu-naive', preset: 'random', size: 1024 }
const TILED: FigureRef = { engine: 'webgpu-tiled', preset: 'random', size: 1024 }
const BASELINE: FigureRef = { engine: 'native-seq', preset: 'random', size: 1024 }

export const DROP_T = CUES.gpuDrop - sceneStart('gpu')
export const TILED_T = CUES.gpuTiled - sceneStart('gpu')

/** The shaders' @workgroup_size(16, 16): one workgroup computes one 16×16 tile. */
export const TILE = 16
export const GPU_SIM = 512
export const TILES = GPU_SIM / TILE
const N = TILES * TILES

const frameOf = (t: number) => Math.round(t * FPS)
const DROP_F = frameOf(DROP_T)

export function speedupLabel(): string {
  return `×${Math.round(speedup(NAIVE))}`
}

export function speedupRef(): string {
  return `vs ${ENGINE_LABEL[BASELINE.engine]}`
}

// ── Dispatch schedule ───────────────────────────────────────────────────────

/** One generation: workgroups run in id order (x fastest), tile i done at start + dur·(i+1)/N. */
export interface Dispatch {
  start: number
  dur: number
}

/** `rate` dispatches a second from `from` to `to`, each centred on its note so the beat lands mid-wave. */
function tier(from: number, to: number, rate: number, dur: number): Dispatch[] {
  return Array.from({ length: Math.round((to - from) * rate) }, (_, j) => ({ start: from + j / rate - dur / 2, dur }))
}

/**
 * The build-up: dispatches on sixteenths (8 gen/s, already twice the fastest CPU sweep), then
 * thirty-seconds, then sixty-fourths. Each one ends before the next starts (the storage barrier
 * between generations). From the drop on, one dispatch per frame, ending on the frame.
 */
export const PRE_DISPATCHES: readonly Dispatch[] = [
  ...tier(0, 2, 8, 0.1),
  ...tier(2, 3, 16, 1 / 16),
  ...tier(3, DROP_T, 32, 1 / 40),
]

const doneAt = (d: Dispatch, i: number) => d.start + (d.dur * (i + 1)) / N

/** Generation shown by tile `i` at scene time `t`, and seconds since a workgroup last computed it. */
export function tileState(i: number, t: number): { gen: number; since: number } {
  let gen = 0
  let last = -Infinity
  for (const d of PRE_DISPATCHES) {
    const at = doneAt(d, i)
    if (at > t + 1e-9) break
    gen++
    last = at
  }
  // In frames: dispatch m covers [DROP_F + m - 1, DROP_F + m], so every tile is done on the frame.
  const nf = frameOf(t)
  if (nf >= DROP_F) {
    gen += nf - DROP_F + 1
    return { gen, since: (1 - (i + 1) / N) / FPS }
  }
  return { gen, since: t - last }
}

const GLOW_TIME = 0.08

/** How lit a tile is, from 1 when just computed down towards 0. */
export function tileLevel(since: number): number {
  return Math.exp(-since / GLOW_TIME)
}

// ── Counters ────────────────────────────────────────────────────────────────

/** The naive counter lands exactly on the drop. */
const ROLL_T = DROP_T - ROLL_DURATION

export function gpuCounters(t: number): { naive: CounterState | null; tiled: CounterState | null } {
  const f = frameOf(t)
  const naive =
    f < frameOf(ROLL_T)
      ? null
      : { engine: NAIVE.engine, value: f >= DROP_F ? gensPerSec(NAIVE) : ownFigure(NAIVE.engine, rollValue(0, gensPerSec(NAIVE), t, ROLL_T)) }
  const tiled = f < frameOf(TILED_T) ? null : { engine: TILED.engine, value: ownFigure(TILED.engine, rollValue(0, gensPerSec(TILED), t, TILED_T)) }
  return { naive, tiled }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** Source texture: 5 px per cell, a 4 px dark gap between workgroups. */
const PITCH = 5
const GAP = 4
const TILE_PX = TILE * PITCH + GAP
const SRC = TILES * TILE_PX

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number]

/** Antialiased coverage of a round dot (radius 0.42 cell, like drawCells) on a PITCH² stamp. */
const STAMP = (() => {
  const r = 0.42 * PITCH
  const c = PITCH / 2
  const out = new Float32Array(PITCH * PITCH)
  const SS = 4
  for (let y = 0; y < PITCH; y++)
    for (let x = 0; x < PITCH; x++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) if (Math.hypot(x + (sx + 0.5) / SS - c, y + (sy + 0.5) / SS - c) <= r) hit++
      out[y * PITCH + x] = hit / (SS * SS)
    }
  return out
})()

type Cam = { cx: number; cy: number; side: number; tilt: number }
const FOCAL = 2400
const LOW: Cam = { cx: 900, cy: 560, side: 2300, tilt: 42 }
const HIGH: Cam = { cx: 560, cy: 650, side: 920, tilt: 30 }
const DRIFT: Cam = { cx: 575, cy: 650, side: 960, tilt: 27 }

function lerpCam(a: Cam, b: Cam, e: number): Cam {
  return {
    cx: a.cx + (b.cx - a.cx) * e,
    cy: a.cy + (b.cy - a.cy) * e,
    side: Math.exp(Math.log(a.side) + (Math.log(b.side) - Math.log(a.side)) * e),
    tilt: a.tilt + (b.tilt - a.tilt) * e,
  }
}

/** Climbs from low over the tiles to the whole grid during the build-up, arriving on the drop. */
function camera(t: number): Cam {
  if (t < DROP_T) return lerpCam(LOW, HIGH, smooth(0, DROP_T, t))
  return lerpCam(HIGH, DRIFT, (t - DROP_T) / (SCENE_BARS.gpu * 2 - DROP_T))
}

/** Corners (TL, TR, BR, BL) of the grid plane, tilted `tilt` degrees about X with its top edge away. */
function planeQuad(c: Cam, pad = 0): [P, P, P, P] {
  const a = (c.tilt * Math.PI) / 180
  const h = c.side / 2 + pad
  const proj = (x: number, y: number): P => {
    const k = FOCAL / (FOCAL - y * Math.sin(a))
    return { x: c.cx + x * k, y: c.cy + y * Math.cos(a) * k }
  }
  return [proj(-h, -h), proj(h, -h), proj(h, h), proj(-h, h)]
}

let pair: GenPair | null = null
let src: { canvas: HTMLCanvasElement; img: ImageData; px: Uint32Array } | null = null
let proj: HTMLCanvasElement | null = null
const tileGen = new Int32Array(N)
const tileSince = new Float64Array(N)

const pack = (r: number, g: number, b: number) => (0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0

/** Paints every tile's live cells into the source texture, tinted by how recently it was computed. Returns the mean level. */
function paintTiles(t: number, hotGain: number): number {
  pair ??= new GenPair(new SimTrack(() => seedGrid('random', GPU_SIM)), GPU_SIM)
  if (!src) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SRC
    const img = new ImageData(SRC, SRC)
    src = { canvas, img, px: new Uint32Array(img.data.buffer) }
  }
  let g0 = Infinity
  for (let i = 0; i < N; i++) {
    const s = tileState(i, t)
    tileGen[i] = s.gen
    tileSince[i] = s.since
    g0 = Math.min(g0, s.gen)
  }
  pair.at(g0)

  const base = engineColor(NAIVE.engine)
  const lit = rgbOf(base)
  const dim = rgbOf(mix(base, '#05040f', 0.7))
  const hot = rgbOf(mix(base, '#ffffff', 0.55))
  const px = src.px
  px.fill(0xff000000)
  const lut = new Uint32Array(PITCH * PITCH)
  let sum = 0
  for (let i = 0; i < N; i++) {
    const level = tileLevel(tileSince[i])
    const heat = hotGain * Math.exp(-tileSince[i] / 0.03)
    sum += level
    const rgb = lit.map((v, k) => {
      const c = dim[k] + (v - dim[k]) * level
      return c + (hot[k] - c) * heat
    })
    // The tile's floor stays orange-tinted and faint, so the dots carry the light.
    const plateK = 0.015 + 0.05 * level + 0.06 * heat
    const plate = lit.map((v) => v * plateK)
    for (let k = 0; k < STAMP.length; k++) {
      const a = STAMP[k]
      lut[k] = pack(...(rgb.map((v, c) => Math.round(plate[c] + (v - plate[c]) * a)) as [number, number, number]))
    }
    const plateColor = lut[0]
    const cells = tileGen[i] > g0 ? pair.next : pair.prev
    const tx = i % TILES
    const ty = (i / TILES) | 0
    const x0 = tx * TILE_PX + GAP / 2
    const y0 = ty * TILE_PX + GAP / 2
    for (let r = 0; r < TILE * PITCH; r++) px.fill(plateColor, (y0 + r) * SRC + x0, (y0 + r) * SRC + x0 + TILE * PITCH)
    for (let cy = 0; cy < TILE; cy++) {
      const row = (ty * TILE + cy) * GPU_SIM + tx * TILE
      for (let cx = 0; cx < TILE; cx++) {
        if (!cells[row + cx]) continue
        const o = (y0 + cy * PITCH) * SRC + x0 + cx * PITCH
        for (let sy = 0; sy < PITCH; sy++) for (let sx = 0; sx < PITCH; sx++) px[o + sy * SRC + sx] = lut[sy * PITCH + sx]
      }
    }
  }
  src.canvas.getContext('2d')!.putImageData(src.img, 0, 0)
  return sum / N
}

function quadPath(ctx: CanvasRenderingContext2D, q: readonly P[]): void {
  ctx.beginPath()
  ctx.moveTo(q[0].x, q[0].y)
  for (const p of q.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
}

/** The tilted grid: glass plate, then the tiles projected once and added three times (wide bloom, near bloom, sharp). */
function drawGrid(ctx: CanvasRenderingContext2D, t: number, beat: number): void {
  const cam = camera(t)
  const dropPulse = t >= DROP_T ? Math.exp(-(t - DROP_T) * 3) : 0
  const hotGain = t < DROP_T ? 0.9 : 0.4 + 0.5 * dropPulse
  const mean = paintTiles(t, hotGain)
  const color = engineColor(NAIVE.engine)

  const outer = planeQuad(cam, 14)
  ctx.save()
  quadPath(ctx, outer)
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = 40 + 60 * mean
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  const q = planeQuad(cam)
  proj ??= document.createElement('canvas')
  if (proj.width !== ctx.canvas.width || proj.height !== ctx.canvas.height) {
    proj.width = ctx.canvas.width
    proj.height = ctx.canvas.height
  }
  const p = proj.getContext('2d')!
  p.reset()
  p.setTransform(ctx.getTransform())
  p.imageSmoothingQuality = 'high'
  drawPerspective(p, src!.canvas, q)
  // Haze on the far edge: depth without blurring the tiles the eye reads.
  p.globalCompositeOperation = 'destination-in'
  const fog = p.createLinearGradient(0, Math.min(q[0].y, q[1].y), 0, Math.max(q[2].y, q[3].y))
  fog.addColorStop(0, 'rgba(0,0,0,0.5)')
  fog.addColorStop(0.45, 'rgba(0,0,0,0.9)')
  fog.addColorStop(1, 'rgba(0,0,0,1)')
  p.fillStyle = fog
  p.fillRect(0, 0, W, H)

  const kick = t >= DROP_T ? (beatBloom(beat) - 0.55) / 0.35 : 0
  const bloom = 0.3 + 0.5 * mean + 0.25 * kick + 1.1 * dropPulse
  const add = (filter: string, alpha: number) => {
    if (alpha <= 0) return
    ctx.save()
    ctx.resetTransform()
    ctx.filter = filter
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(proj!, 0, 0)
    ctx.restore()
  }
  add('blur(40px)', 0.9 * dropPulse)
  add('blur(16px)', bloom * 0.6)
  add('blur(4px)', bloom * 0.8)
  add('none', 1)
}

/** The webgpu-tiled line under the naive figure: same panel, smaller figure. */
function drawTiled(ctx: CanvasRenderingContext2D, c: CounterState, alpha: number): void {
  if (alpha <= 0) return
  const r = COUNTER_RECT
  const x0 = r.x + 52
  const x1 = r.x + r.w - 52
  const color = engineColor(c.engine)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, r.y + 384)
  ctx.lineTo(x1, r.y + 384)
  ctx.stroke()
  text(ctx, ENGINE_LABEL[c.engine], x0, r.y + 456, { size: 36, weight: 600, color })
  ctx.font = `400 32px ${FONT_FAMILY}`
  const unitW = ctx.measureText(' gen/s').width
  text(ctx, ' gen/s', x1, r.y + 456, { size: 32, weight: 400, color: 'rgba(255,255,255,0.72)', align: 'right' })
  text(ctx, formatGps(c.value), x1 - unitW, r.y + 458, { size: 64, weight: 700, color: mix(color, '#ffffff', 0.15), align: 'right' })
  ctx.restore()
}

const POP = 0.08

/** ×118 over the panel, hot gradient like styleframe C2, popping in on the drop. */
function drawSpeedup(ctx: CanvasRenderingContext2D, t: number): void {
  if (frameOf(t) < DROP_F) return
  const u = t - DROP_T
  const scale = 1 + POP * Math.exp(-u * 10)
  const x = COUNTER_RECT.x + 46
  const y = 262
  ctx.save()
  ctx.font = `700 132px ${FONT_FAMILY}`
  const w = ctx.measureText(speedupLabel()).width
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, '#ff3d81')
  g.addColorStop(1, '#ff9e3d')
  ctx.shadowColor = '#ff9e3d'
  ctx.shadowBlur = 20 + 60 * Math.exp(-u * 4)
  // A gradient fill, which text() does not take; the size is far above the 28 px minimum.
  ctx.fillStyle = g
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(speedupLabel(), 0, 0)
  ctx.restore()
  text(ctx, speedupRef(), x + w * (1 + POP) + 24, y - 52, { size: 32, weight: 400, color: engineColor(BASELINE.engine) })
  text(ctx, 'random · 1024²', x + w * (1 + POP) + 24, y - 8, { size: 30, weight: 400, color: 'rgba(255,255,255,0.6)' })
}

const INTRO_CAPTION = `WebGPU · one workgroup per ${TILE}×${TILE} tile`
const TILED_CAPTION = 'shared-memory tiling: slower on Apple GPUs'

export const gpu: Scene = {
  id: 'gpu',
  figures: [NAIVE, TILED, BASELINE],
  draw(ctx, s) {
    const { t } = s
    nightBackground(ctx)
    drawGrid(ctx, t, s.beat)

    const { naive, tiled } = gpuCounters(t)
    if (naive) {
      const dropGlow = t >= DROP_T ? Math.exp(-(t - DROP_T) * 4) : 0
      // On a layer: the glass panel sets its own alpha, so a plain globalAlpha would not fade it.
      withLayer(ctx, (l) => drawCounter(l, naive, engineColor, { glow: dropGlow, prevAlpha: 0, panelFill: 'rgba(8,6,24,0.6)' }), {
        alpha: smooth(ROLL_T, ROLL_T + 0.15, t),
      })
    }
    if (tiled) drawTiled(ctx, tiled, smooth(TILED_T, TILED_T + 0.25, t))
    drawSpeedup(ctx, t)

    const capX = GRID_RECT.x + 26
    if (t < TILED_T) caption(ctx, INTRO_CAPTION, capX, CAPTION_Y, smooth(0.2, 0.5, t) * (1 - smooth(TILED_T - 0.3, TILED_T - 0.05, t)))
    else caption(ctx, TILED_CAPTION, capX, CAPTION_Y, smooth(TILED_T, TILED_T + 0.25, t))
    machineLabel(ctx)
  },
}
