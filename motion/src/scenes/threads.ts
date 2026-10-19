// Scene 4: the real app (wasm-mt, monitoring on, tile → thread overlay) in a tilted glass screen,
// 15 thread lanes lighting up one per pluck, then the plateau: 15 threads are slower than SIMD on 1.
import { mulberry32 } from '../../../web/src/random'
import { type FigureRef, gensPerSec } from '../data'
import { type P, type Rect, drawPerspective, nightBackground, text, withLayer } from '../render/canvas'
import { engineColor } from '../render/palette'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../timeline'
import {
  CAPTION_Y,
  GRID_RECT,
  type CounterState,
  ROLL_DURATION,
  beatBloom,
  caption,
  drawCounter,
  glass,
  machineLabel,
  mix,
  ownFigure,
  rollValue,
  smooth,
} from './sweep'
import { type Scene } from './types'

const WMT: FigureRef = { engine: 'wasm-mt', preset: 'random', size: 1024 }
const WSIMD: FigureRef = { engine: 'wasm-simd', preset: 'random', size: 1024 }

const SCENE_T = SCENE_BARS.threads * 2
/** One captured JPG per frame of the scene (`npm run capture`). */
export const APP_FRAMES = SCENE_T * FPS
const LANES = 15
const PLUCK_T = CUES.threadPlucks.map((c) => c - sceneStart('threads'))
/** The counter rolls in on the beat after the last lane lights up. */
export const COUNTER_T = PLUCK_T[LANES - 1] + 0.5

const BUSY_CAPTION = '15 threads · barriers every generation'
const END_CAPTION = 'more threads, less speed: barriers'

const frameOf = (t: number) => Math.round(t * FPS)

/** Capture frame shown at scene time `t`: frame n of public/app/ for scene frame n - 1. */
export function appFrameIndex(t: number): number {
  return Math.min(APP_FRAMES, Math.max(1, frameOf(t) + 1))
}

/** 0 before lane `k`'s pluck, 1 from its frame on (the note and the light land together). Compared in frames: no float drift on the cue. */
export function laneLevel(k: number, t: number): number {
  return frameOf(t) < frameOf(PLUCK_T[k]) ? 0 : 1
}

/** Null until the last lane is lit; then wasm-mt rolls up from 0 beside the (higher) wasm-simd figure. */
export function threadsCounter(t: number): CounterState | null {
  if (frameOf(t) < frameOf(COUNTER_T)) return null
  return {
    engine: WMT.engine,
    value: ownFigure(WMT.engine, rollValue(0, gensPerSec(WMT), t, COUNTER_T)),
    prev: { engine: WSIMD.engine, value: gensPerSec(WSIMD) },
  }
}

// ── The app capture ─────────────────────────────────────────────────────────

const MISSING = 'scene threads: the app capture public/app/0001.jpg…0720.jpg is missing, run npm run capture first'
const frameUrl = (n: number) => `${import.meta.env.BASE_URL}app/${String(n).padStart(4, '0')}.jpg`

let current: { n: number; img: HTMLImageElement } | null = null

/** Fully decoded before it is drawn, so no frame ever shows a half-loaded capture. */
async function appImage(n: number): Promise<HTMLImageElement> {
  if (current?.n === n) return current.img
  const img = new Image()
  img.src = frameUrl(n)
  try {
    await img.decode()
  } catch {
    throw new Error(`${MISSING} (frame ${n} failed to load)`)
  }
  current = { n, img }
  return img
}

// The dev server answers unknown paths with index.html, so check the type as well as the status.
async function assertCapture(): Promise<void> {
  for (const n of [1, APP_FRAMES]) {
    const res = await fetch(frameUrl(n), { method: 'HEAD' })
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error(MISSING)
  }
}

// The capture is 1440×900; the screen keeps that 16:10 ratio.
const APP_W = 960
const APP_H = 600
const APP_CENTER: P = { x: 575, y: 595 }
const FOCAL = 2400
const GLASS_PAD = 18

/** Corners (TL, TR, BR, BL) of a w×h screen turned `deg` around Y (right edge away), pushed back by `z`. */
function tiltQuad(w: number, h: number, deg: number, z: number): [P, P, P, P] {
  const a = (deg * Math.PI) / 180
  const proj = (x: number, y: number): P => {
    const k = FOCAL / (FOCAL + z + x * Math.sin(a))
    return { x: APP_CENTER.x + x * Math.cos(a) * k, y: APP_CENTER.y + y * k }
  }
  return [proj(-w / 2, -h / 2), proj(w / 2, -h / 2), proj(w / 2, h / 2), proj(-w / 2, h / 2)]
}

function quadPath(ctx: CanvasRenderingContext2D, q: readonly P[]): void {
  ctx.beginPath()
  ctx.moveTo(q[0].x, q[0].y)
  for (const p of q.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
}

/** The glass screen: glow and translucent frame as paths, the opaque capture inside, a faint sheen on top. */
function drawScreen(ctx: CanvasRenderingContext2D, img: HTMLImageElement, t: number, beat: number, color: string, focus: number): void {
  const enter = smooth(0, 1, t)
  const deg = 20 - 4 * smooth(0, SCENE_T, t)
  const z = 700 * (1 - enter)
  const alpha = smooth(0, 0.6, t)
  const inner = tiltQuad(APP_W, APP_H, deg, z)
  const outer = tiltQuad(APP_W + 2 * GLASS_PAD, APP_H + 2 * GLASS_PAD, deg, z)

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineJoin = 'round'
  quadPath(ctx, outer)
  ctx.shadowColor = color
  ctx.shadowBlur = 50 + 30 * (beatBloom(beat) - 0.55)
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  // On its own layer: the strips overlap by a pixel, so fading them one by one would show seams.
  withLayer(ctx, (l) => drawPerspective(l, img, inner), {
    alpha: alpha * (0.72 + 0.28 * focus),
    filter: focus < 1 ? `blur(${(1.6 * (1 - focus)).toFixed(2)}px)` : undefined,
  })

  ctx.save()
  ctx.globalAlpha = alpha
  quadPath(ctx, inner)
  ctx.clip()
  const sheen = ctx.createLinearGradient(inner[0].x, inner[0].y, inner[2].x, inner[2].y)
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)')
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.02)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = alpha * 0.6
  quadPath(ctx, inner)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = alpha
  text(ctx, 'live capture · monitoring on · wasm-mt · random · 1024²', outer[3].x + 8, outer[3].y + 56, { size: 30, weight: 400, color: 'rgba(255,255,255,0.62)' })
  ctx.restore()
}

// ── The 15 thread lanes ─────────────────────────────────────────────────────

const LANES_RECT: Rect = { x: 1140, y: 210, w: 680, h: 820 }
const LANE_PITCH = 48
const LANE_TOP = LANES_RECT.y + (LANES_RECT.h - (LANES - 1) * LANE_PITCH) / 2
const TRACK_X0 = LANES_RECT.x + 110
const TRACK_X1 = LANES_RECT.x + LANES_RECT.w - 40
const LANE_H = 20
/** A schematic generation: every thread works a slice of it, then waits at the barrier. */
const GEN_PERIOD = 0.25
const GEN_PX = 104
const SPEED = GEN_PX / GEN_PERIOD

/** Deterministic start offset and busy share of thread `k` in generation `g`: illustrative, not measured (the capture shows the real activity). */
function slice(g: number, k: number): { start: number; busy: number } {
  const rnd = mulberry32(0x7e4d + g * 97 + k * 7919)
  return { start: rnd() * 0.06, busy: 0.1 + rnd() * 0.2 }
}

const laneY = (k: number) => LANE_TOP + k * LANE_PITCH

function drawLanes(ctx: CanvasRenderingContext2D, t: number, color: string, alpha: number): void {
  if (alpha <= 0) return
  glass(ctx, LANES_RECT, { radius: 28, alpha })
  const xAt = (time: number) => TRACK_X1 - (t - time) * SPEED
  const levels = Array.from({ length: LANES }, (_, k) => laneLevel(k, t))
  const lit = levels.filter((v) => v > 0).length

  // Idle strings, vibrating for a moment when plucked.
  ctx.save()
  ctx.globalAlpha = alpha
  for (let k = 0; k < LANES; k++) {
    const y = laneY(k)
    const dt = t - PLUCK_T[k]
    const amp = dt >= 0 ? 9 * Math.exp(-dt * 7) * Math.cos(dt * 2 * Math.PI * 9) : 0
    ctx.strokeStyle = levels[k] > 0 ? mix(color, '#ffffff', 0.5 * Math.exp(-Math.max(0, dt) * 5)) : 'rgba(255,255,255,0.10)'
    ctx.globalAlpha = alpha * (levels[k] > 0 ? 0.35 + 0.65 * Math.exp(-dt * 4) : 1)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i <= 40; i++) {
      const x = TRACK_X0 + ((TRACK_X1 - TRACK_X0) * i) / 40
      const yy = y + amp * Math.sin((Math.PI * i) / 40)
      if (i === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
    const flash = dt >= 0 ? Math.exp(-dt * 6) : 0
    ctx.globalAlpha = alpha
    const label = levels[k] > 0 ? mix(mix(color, '#ffffff', 0.35), '#ffffff', flash) : 'rgba(255,255,255,0.28)'
    text(ctx, `T${k}`, LANES_RECT.x + 44, y + 10, { size: 28, weight: levels[k] > 0 ? 600 : 400, color: label })
  }
  ctx.restore()

  if (lit === 0) return
  // Busy slices of the lit lanes, then the barrier every thread waits at, across the lit lanes.
  const g1 = Math.floor(t / GEN_PERIOD)
  const g0 = Math.floor((t - (TRACK_X1 - TRACK_X0) / SPEED) / GEN_PERIOD)
  const paint = (l: CanvasRenderingContext2D) => {
    l.save()
    l.beginPath()
    l.rect(TRACK_X0, LANES_RECT.y, TRACK_X1 - TRACK_X0, LANES_RECT.h)
    l.clip()
    for (let k = 0; k < LANES; k++) {
      if (levels[k] <= 0) continue
      const dt = t - PLUCK_T[k]
      l.globalAlpha = levels[k]
      l.fillStyle = mix(color, '#ffffff', 0.15 + 0.6 * Math.exp(-dt * 5))
      const y = laneY(k)
      for (let g = g0; g <= g1; g++) {
        const { start, busy } = slice(g, k)
        const a = (g + start) * GEN_PERIOD
        const b = Math.min(t, a + busy * GEN_PERIOD)
        if (b <= a) continue
        l.beginPath()
        l.roundRect(xAt(a), y - LANE_H / 2, xAt(b) - xAt(a), LANE_H, 4)
        l.fill()
      }
    }
    l.globalAlpha = 1
    l.strokeStyle = mix(color, '#ffffff', 0.4)
    l.lineWidth = 2
    l.beginPath()
    for (let g = g0 + 1; g <= g1; g++) {
      const x = xAt(g * GEN_PERIOD)
      l.moveTo(x, laneY(0) - LANE_H)
      l.lineTo(x, laneY(lit - 1) + LANE_H)
    }
    l.stroke()
    l.restore()
  }
  withLayer(ctx, paint, { filter: 'blur(8px)', alpha: alpha * 0.7, op: 'lighter' })
  withLayer(ctx, paint, { alpha, op: 'lighter' })
}

export const threads: Scene = {
  id: 'threads',
  figures: [WMT, WSIMD],
  prepare: assertCapture,
  async draw(ctx, s) {
    const { t } = s
    const img = await appImage(appFrameIndex(t))
    const color = engineColor(WMT.engine)
    const counter = threadsCounter(t)
    const outro = smooth(COUNTER_T - 0.25, COUNTER_T + 0.15, t)

    nightBackground(ctx)
    drawScreen(ctx, img, t, s.beat, color, 1 - outro)
    drawLanes(ctx, t, color, smooth(0.6, 1.2, t) * (1 - outro))
    if (counter) {
      const landed = COUNTER_T + ROLL_DURATION
      withLayer(
        ctx,
        (l) =>
          drawCounter(l, counter, engineColor, {
            glow: t >= landed ? Math.exp(-(t - landed) * 5) : 0,
            // The wasm-simd line stays dimmer: it is the reference the threads fail to reach.
            prevAlpha: 0.65 * smooth(COUNTER_T, COUNTER_T + 0.4, t),
          }),
        { alpha: smooth(COUNTER_T, COUNTER_T + 0.25, t) },
      )
    }
    const capX = GRID_RECT.x + 26
    if (t < COUNTER_T) caption(ctx, BUSY_CAPTION, capX, CAPTION_Y, smooth(1, 1.4, t) * (1 - smooth(COUNTER_T - 0.3, COUNTER_T - 0.05, t)))
    else caption(ctx, END_CAPTION, capX, CAPTION_Y, smooth(COUNTER_T, COUNTER_T + 0.25, t))
    machineLabel(ctx)
  },
}
