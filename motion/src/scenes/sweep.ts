// Shared pieces of the "one engine sweeps the grid" scenes (native, simd): the rolling
// gen/s counter, the scan lines and the grid where computed rows already show the next generation.
import { ENGINES, ENGINE_LABEL, type EngineId, MACHINE_LABEL, formatGps, gensPerSec } from '../data'
import { FONT_FAMILY, type Rect, text, withLayer } from '../render/canvas'
import { type SimTrack } from '../sim/track'
import { H, W } from '../timeline'

export const ROLL_DURATION = 0.6

/** Side of the simulated grid; the figures on screen are the 1024² measurements. */
export const SIM_SIZE = 256
/** Full view of the grid, left of the counter panel. */
export const GRID_RECT: Rect = { x: 160, y: 200, w: 840, h: 840 }
/** Caption baseline, above the grid even once native's bands spread it out. */
export const CAPTION_Y = 90

/** Ease-out count-up from `from` to `to` starting at `start`; returns `to` itself once landed, so no rounding drift. */
export function rollValue(from: number, to: number, t: number, start: number, dur = ROLL_DURATION): number {
  const u = (t - start) / dur
  if (u <= 0) return from
  if (u >= 1) return to
  return from + (to - from) * (1 - (1 - u) ** 3)
}

/**
 * A rolling counter for `engine` passes through other engines' figures (0 → 633 crosses 188):
 * nudges the value up past any of them, so a label never sits over another engine's exact figure.
 */
export function ownFigure(engine: EngineId, v: number): number {
  const taken = new Set(ENGINES.filter((e) => e !== engine).map((e) => formatGps(gensPerSec({ engine: e, preset: 'random', size: 1024 }))))
  while (taken.has(formatGps(v))) v += 1
  return v
}

/** `count` contiguous row ranges [r0, r1) covering `n` rows, like OpenMP's static schedule. */
export function bands(n: number, count: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => [Math.round((i * n) / count), Math.round(((i + 1) * n) / count)])
}

export interface CounterState {
  engine: EngineId
  value: number
  /** The figure the counter showed before, kept on screen as a smaller line. */
  prev?: { engine: EngineId; value: number }
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const smooth = (a: number, b: number, t: number) => {
  const u = clamp01((t - a) / (b - a))
  return u * u * (3 - 2 * u)
}

/** Mixes a `#rrggbb` colour towards another by `k` in [0, 1]. */
export function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`
}

/** Bloom pulse on every beat, decaying within it (the kick). */
export function beatBloom(beat: number): number {
  return 0.55 + 0.35 * Math.exp(-4 * (beat - Math.floor(beat)))
}

/**
 * Generations g and g + 1 of a track, copied so both can be shown at once (the rows already
 * swept show g + 1). Frames render in order, so the track only ever steps forward in practice.
 */
export class GenPair {
  private gen = -1
  readonly prev: Uint8Array
  readonly next: Uint8Array

  constructor(
    private readonly track: SimTrack,
    readonly size: number,
  ) {
    this.prev = new Uint8Array(size * size)
    this.next = new Uint8Array(size * size)
  }

  at(gen: number): this {
    if (gen !== this.gen) {
      this.prev.set(this.track.at(gen).cells)
      this.next.set(this.track.at(gen + 1).cells)
      this.gen = gen
    }
    return this
  }

  /** Writes into `out`: row y shows g + 1 left of column `cut[y]`, g from there on. */
  compose(out: Uint8Array, cut: Int32Array): void {
    const n = this.size
    for (let y = 0; y < n; y++) {
      const row = y * n
      const c = Math.min(n, Math.max(0, cut[y]))
      out.set(this.next.subarray(row, row + c), row)
      out.set(this.prev.subarray(row + c, row + n), row + c)
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, radius)
}

/** DA C glass: a faint translucent fill and a thin light border. */
export function glass(ctx: CanvasRenderingContext2D, r: Rect, opts: { radius?: number; fill?: string; alpha?: number } = {}): void {
  ctx.save()
  ctx.globalAlpha = opts.alpha ?? 1
  roundRect(ctx, r, opts.radius ?? 18)
  ctx.fillStyle = opts.fill ?? 'rgba(255,255,255,0.035)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Glowing horizontal scan lines from x0 to x1, one per y, added with `lighter`. */
export function scanLines(ctx: CanvasRenderingContext2D, ys: number[], x0: number, x1: number, color: string, alpha = 1): void {
  if (alpha <= 0 || ys.length === 0) return
  const stroke = (l: CanvasRenderingContext2D, width: number, style: string) => {
    l.strokeStyle = style
    l.lineWidth = width
    l.lineCap = 'round'
    l.beginPath()
    for (const y of ys) {
      l.moveTo(x0, y)
      l.lineTo(x1, y)
    }
    l.stroke()
  }
  withLayer(ctx, (l) => stroke(l, 10, color), { filter: 'blur(12px)', alpha, op: 'lighter' })
  withLayer(ctx, (l) => stroke(l, 2.5, mix(color, '#ffffff', 0.6)), { alpha, op: 'lighter' })
}

/** Caption on a dark glass pill, so it stays readable over cells. */
export function caption(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, alpha = 1): void {
  if (alpha <= 0) return
  const size = 44
  ctx.save()
  ctx.font = `600 ${size}px ${FONT_FAMILY}`
  const w = ctx.measureText(s).width
  ctx.restore()
  glass(ctx, { x: x - 26, y: y - size - 6, w: w + 52, h: size + 34 }, { radius: 40, fill: 'rgba(8,6,24,0.72)', alpha })
  ctx.save()
  ctx.globalAlpha = alpha
  text(ctx, s, x, y, { size, weight: 600, color: '#ffffff' })
  ctx.restore()
}

export const COUNTER_RECT: Rect = { x: 1100, y: 370, w: 720, h: 500 }

/**
 * The big gen/s counter in its glass panel: engine label, rolling figure, units and grid size,
 * and the previous figure as a smaller line. `glow` flashes the figure when it lands.
 */
export function drawCounter(
  ctx: CanvasRenderingContext2D,
  c: CounterState,
  color: (e: EngineId) => string,
  opts: { glow: number; prevAlpha: number; panelFill?: string },
): void {
  const r = COUNTER_RECT
  const x = r.x + 52
  glass(ctx, r, { radius: 28, fill: opts.panelFill ?? 'rgba(255,255,255,0.035)' })
  text(ctx, ENGINE_LABEL[c.engine], x, r.y + 92, { size: 40, weight: 600, color: color(c.engine) })
  ctx.save()
  ctx.shadowColor = color(c.engine)
  ctx.shadowBlur = 24 + 40 * opts.glow
  text(ctx, formatGps(c.value), x - 6, r.y + 268, { size: 168, weight: 700, color: mix(color(c.engine), '#ffffff', 0.15 + 0.35 * opts.glow) })
  ctx.restore()
  text(ctx, 'gen/s · random · 1024²', x, r.y + 328, { size: 36, weight: 400, color: 'rgba(255,255,255,0.72)' })
  if (c.prev && opts.prevAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = opts.prevAlpha
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, r.y + 384)
    ctx.lineTo(r.x + r.w - 52, r.y + 384)
    ctx.stroke()
    text(ctx, ENGINE_LABEL[c.prev.engine], x, r.y + 448, { size: 32, weight: 400, color: color(c.prev.engine) })
    text(ctx, `${formatGps(c.prev.value)} gen/s`, r.x + r.w - 52, r.y + 448, { size: 32, weight: 600, color: color(c.prev.engine), align: 'right' })
    ctx.restore()
  }
}

/** Cell colours of a sweeping engine: swept, being swept (with a short afterglow), not swept yet. */
export interface SweepPalette {
  done: string
  hot: string
  pending: string
  /** trail[d - 1] colours the swept row d rows behind the scan line. */
  trail: string[]
}

export const TRAIL = 8

export function sweepPalette(c: string): SweepPalette {
  return {
    done: c,
    hot: mix(c, '#ffffff', 0.75),
    pending: mix(c, '#05040f', 0.6),
    trail: Array.from({ length: TRAIL }, (_, i) => mix(c, '#ffffff', 0.55 * (1 - (i + 1) / (TRAIL + 1)))),
  }
}

export function machineLabel(ctx: CanvasRenderingContext2D): void {
  text(ctx, MACHINE_LABEL, W - 100, H - 64, { size: 28, weight: 400, color: 'rgba(255,255,255,0.45)', align: 'right' })
}
