// Scene 7: the curves, the proof. (a) A race of generations over 1 s on random 1024², a fan of
// light from the origin with each engine's ×N. (b) From the scaling cue, gen/s against grid size,
// 512² to 2048², log-log. (c) From the reversal (the music drops to the kick), a slope chart
// Random → Guns at 1024² where wasm-simd on one thread climbs over both GPU lines.
import { ENGINES, ENGINE_LABEL, type EngineId, type FigureRef, formatGps, gensPerSec, speedup } from '../data'
import { FONT_FAMILY, type P, nightBackground, text, withLayer } from '../render/canvas'
import { engineColor } from '../render/palette'
import { CUES, H, SCENE_BARS, sceneStart } from '../timeline'
import { CAPTION_Y, beatBloom, caption, clamp01, machineLabel, mix, smooth } from './sweep'
import { type Scene } from './types'

export const SCALING_T = CUES.curvesScaling - sceneStart('curves')
export const REVERSAL_T = CUES.reversal - sceneStart('curves')
export const END_T = SCENE_BARS.curves * 2

export const SCALING_SIZES = [512, 1024, 2048] as const
export const REVERSAL_CAPTION = 'sparse pattern: 1 CPU thread beats the GPU'
export const LAZY_CAPTION = 'lazy tiling'
/** Once Guns has landed, so the reason comes after the result. */
export const LAZY_T = REVERSAL_T + 1.5

/** Vertical distance between two label baselines: 30–34 px text plus air. */
export const LABEL_GAP = 44

const ref = (engine: EngineId, preset: string, size: number): FigureRef => ({ engine, preset, size })
const RACE = ENGINES.map((e) => ref(e, 'random', 1024))
const SCALING = ENGINES.map((e) => SCALING_SIZES.map((s) => ref(e, 'random', s)))
const GUNS = ENGINES.map((e) => ref(e, 'guns', 1024))
const GPU: readonly EngineId[] = ['webgpu-naive', 'webgpu-tiled']
const HERO: EngineId = 'wasm-simd'

const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3

// ── Labels ──────────────────────────────────────────────────────────────────

/**
 * Spreads labels vertically, at least `gap` apart: overlapping labels merge into a cluster
 * centred on its anchors (styleframe C2's dodge, centred rather than pushed down), kept in [lo, hi].
 * Returns the items in anchor order, each with its `labelY`.
 */
export function dodge<T extends { y: number }>(items: T[], gap: number, lo: number, hi: number): (T & { labelY: number })[] {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const groups: { items: T[]; top: number }[] = []
  const place = (g: T[]) => {
    const mean = g.reduce((s, it, i) => s + it.y - i * gap, 0) / g.length
    return Math.min(Math.max(mean, lo), hi - (g.length - 1) * gap)
  }
  for (const it of sorted) {
    let g = { items: [it], top: place([it]) }
    while (groups.length > 0) {
      const prev = groups[groups.length - 1]
      if (g.top >= prev.top + prev.items.length * gap) break
      groups.pop()
      const merged = [...prev.items, ...g.items]
      g = { items: merged, top: place(merged) }
    }
    groups.push(g)
  }
  return groups.flatMap((g) => g.items.map((it, i) => ({ ...it, labelY: g.top + i * gap })))
}

/** ×N as in styleframe C2: one decimal under ×10. */
export function speedLabel(sp: number): string {
  return `×${sp < 10 ? sp.toFixed(1) : Math.round(sp)}`
}

// ── (a) The race ────────────────────────────────────────────────────────────

const RACE_BOX = { L: 220, R: 1160, T: 380, B: 1010 }
const RACE_START = 0
const RACE_DUR = 1.4

/** Share of the 1 s race drawn at scene time `t`. */
export function raceProgress(t: number): number {
  return easeOut((t - RACE_START) / RACE_DUR)
}

/** Opacity of the race chart: it gives way to the scaling chart on the cue. */
export function raceAlpha(t: number): number {
  return 1 - smooth(SCALING_T - 0.35, SCALING_T, t)
}

export interface RaceLine {
  engine: EngineId
  start: P
  end: P
  speedup: string
  labelY: number
}

/** Generations computed against time: a straight line from the origin to (1 s, gen/s). */
export function raceLayout(): { lines: RaceLine[]; max: number } {
  const { L, R, T, B } = RACE_BOX
  const max = Math.max(...RACE.map(gensPerSec)) * 1.1
  const raw = RACE.map((f) => ({
    engine: f.engine,
    start: { x: L, y: B },
    end: { x: R, y: B - (gensPerSec(f) / max) * (B - T) },
    speedup: speedLabel(speedup(f)),
    y: B - (gensPerSec(f) / max) * (B - T),
  }))
  return { lines: dodge(raw, LABEL_GAP, T, B + 12), max }
}

// ── (b) Scaling ─────────────────────────────────────────────────────────────

const SCALE_BOX = { L: 360, R: 1180, T: 230, B: 980 }
const DRAW_DUR = 1.6

export function scalingProgress(t: number): number {
  return easeOut((t - SCALING_T) / DRAW_DUR)
}

export interface Range {
  lo: number
  hi: number
  T: number
  B: number
}

const logY = (v: number, r: Range) => r.B - ((Math.log10(v) - Math.log10(r.lo)) / (Math.log10(r.hi) - Math.log10(r.lo))) * (r.B - r.T)

/** Powers of ten inside the range, as 100 / 1k / 10k / 100k. */
export function logTicks(r: Range): { v: number; y: number; label: string }[] {
  const out: { v: number; y: number; label: string }[] = []
  for (let e = Math.ceil(Math.log10(r.lo)); 10 ** e <= r.hi; e++) {
    const v = 10 ** e
    out.push({ v, y: logY(v, r), label: e >= 3 ? `${10 ** (e - 3)}k` : String(v) })
  }
  return out
}

export interface ScalingLine {
  engine: EngineId
  points: P[]
  label: string
  y: number
  labelY: number
}

export function scalingLayout(): { lines: ScalingLine[]; range: Range } {
  const { L, R, T, B } = SCALE_BOX
  const all = SCALING.flat().map(gensPerSec)
  // Half a decade-ish of air above and below the extreme figures.
  const range: Range = { lo: Math.min(...all) / 2, hi: Math.max(...all) * 2, T, B }
  const x = (size: number) => L + (Math.log2(size / SCALING_SIZES[0]) / Math.log2(SCALING_SIZES[2] / SCALING_SIZES[0])) * (R - L)
  const raw = SCALING.map((refs) => {
    const points = refs.map((f) => ({ x: x(f.size), y: logY(gensPerSec(f), range) }))
    return { engine: refs[0].engine, points, label: ENGINE_LABEL[refs[0].engine], y: points[points.length - 1].y }
  })
  return { lines: dodge(raw, LABEL_GAP, T, B), range }
}

// ── (c) The reversal ────────────────────────────────────────────────────────

const SLOPE_BOX = { XL: 700, XR: 1220, T: 300, B: 980 }
const SLOPE_DUR = 1.2

export function slopeProgress(t: number): number {
  return easeOut((t - REVERSAL_T) / SLOPE_DUR)
}

export interface SlopeLine {
  engine: EngineId
  a: P
  b: P
  left: { text: string; y: number }
  right: { text: string; y: number }
}

function slopeRange(): Range {
  const all = [...RACE, ...GUNS].map(gensPerSec)
  return { lo: Math.min(...all) / 1.6, hi: Math.max(...all) * 1.6, T: SLOPE_BOX.T, B: SLOPE_BOX.B }
}

export function slopeLayout(): { lines: SlopeLine[] } {
  const { XL, XR, T, B } = SLOPE_BOX
  const r = slopeRange()
  const base = ENGINES.map((e, i) => {
    const va = gensPerSec(RACE[i])
    const vb = gensPerSec(GUNS[i])
    return { engine: e, a: { x: XL, y: logY(va, r) }, b: { x: XR, y: logY(vb, r) }, va, vb }
  })
  const left = new Map(dodge(base.map((l) => ({ engine: l.engine, y: l.a.y })), LABEL_GAP, T, B).map((d) => [d.engine, d.labelY]))
  const right = new Map(dodge(base.map((l) => ({ engine: l.engine, y: l.b.y })), LABEL_GAP, T, B).map((d) => [d.engine, d.labelY]))
  return {
    lines: base.map((l) => ({
      engine: l.engine,
      a: l.a,
      b: l.b,
      left: { text: `${ENGINE_LABEL[l.engine]}  ${formatGps(l.va)}`, y: left.get(l.engine)! },
      right: { text: `${formatGps(l.vb)}  ${ENGINE_LABEL[l.engine]}`, y: right.get(l.engine)! },
    })),
  }
}

/** Where wasm-simd's line crosses each GPU line: `s` is the share of the way from Random to Guns. */
export function crossings(): { engine: EngineId; s: number; at: P }[] {
  const { lines } = slopeLayout()
  const hero = lines.find((l) => l.engine === HERO)!
  return GPU.map((engine) => {
    const g = lines.find((l) => l.engine === engine)!
    // Straight lines in screen space: solve hero.a.y + s·dh = g.a.y + s·dg.
    const s = (g.a.y - hero.a.y) / (hero.b.y - hero.a.y - (g.b.y - g.a.y))
    return { engine, s, at: { x: hero.a.x + s * (hero.b.x - hero.a.x), y: hero.a.y + s * (hero.b.y - hero.a.y) } }
  })
}

// ── Drawing ─────────────────────────────────────────────────────────────────

interface Stroke {
  pts: P[]
  style: (l: CanvasRenderingContext2D) => string | CanvasGradient
  alpha: number
  width: number
}

/** `pts` cut at x = `xCut` (the lines run left to right). */
function cutAt(pts: P[], xCut: number): P[] {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]]
    if (q.x <= xCut) {
      out.push(q)
      continue
    }
    if (p.x < xCut) {
      const k = (xCut - p.x) / (q.x - p.x)
      out.push({ x: xCut, y: p.y + k * (q.y - p.y) })
    }
    break
  }
  return out
}

function strokePaths(l: CanvasRenderingContext2D, strokes: Stroke[], widthScale: number): void {
  l.lineCap = 'round'
  l.lineJoin = 'round'
  for (const s of strokes) {
    if (s.pts.length < 2 || s.alpha <= 0) continue
    l.globalAlpha = Math.min(1, s.alpha)
    l.strokeStyle = s.style(l)
    l.lineWidth = s.width * widthScale
    l.beginPath()
    l.moveTo(s.pts[0].x, s.pts[0].y)
    for (const p of s.pts.slice(1)) l.lineTo(p.x, p.y)
    l.stroke()
  }
}

/** DA C glowing lines: a wide blurred pass and a sharp core, both added with `lighter`. */
function glowLines(ctx: CanvasRenderingContext2D, strokes: Stroke[], bloom: number, alpha = 1): void {
  if (alpha <= 0) return
  withLayer(ctx, (l) => strokePaths(l, strokes, 4), { filter: 'blur(12px)', alpha: Math.min(1, bloom) * alpha, op: 'lighter' })
  withLayer(ctx, (l) => strokePaths(l, strokes, 1), { alpha, op: 'lighter' })
}

function dot(ctx: CanvasRenderingContext2D, p: P, color: string, r: number, alpha: number): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'lighter'
  ctx.shadowColor = color
  ctx.shadowBlur = r * 4
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = mix(color, '#ffffff', 0.7)
  ctx.beginPath()
  ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function hline(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, style: string): void {
  ctx.strokeStyle = style
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, y)
  ctx.lineTo(x1, y)
  ctx.stroke()
}

/** A thin elbow from a line end to its dodged label, only when the label had to move. */
function leader(ctx: CanvasRenderingContext2D, from: P, x: number, y: number, color: string, alpha: number): void {
  if (Math.abs(from.y - y) < 4 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha * 0.55
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.restore()
}

const DIM_TEXT = 'rgba(255,255,255,0.55)'
const AXIS = 'rgba(255,255,255,0.08)'

function drawRace(ctx: CanvasRenderingContext2D, t: number, beat: number, alpha: number): void {
  if (alpha <= 0) return
  const { L, R, T, B } = RACE_BOX
  const { lines } = raceLayout()
  const u = raceProgress(t)
  ctx.save()
  ctx.globalAlpha = alpha
  for (let i = 0; i <= 4; i++) hline(ctx, L, R, B - (i * (B - T)) / 4, AXIS)
  text(ctx, 'generations computed', L, T - 34, { size: 30, weight: 400, color: DIM_TEXT })
  text(ctx, '0 s', L, B + 52, { size: 30, weight: 400, color: DIM_TEXT, align: 'center' })
  text(ctx, '1 s', R, B + 52, { size: 30, weight: 400, color: DIM_TEXT, align: 'center' })
  ctx.restore()

  const tip = (l: RaceLine): P => ({ x: l.start.x + u * (l.end.x - l.start.x), y: l.start.y + u * (l.end.y - l.start.y) })
  const strokes: Stroke[] = lines.map((l) => ({
    pts: [l.start, tip(l)],
    width: 3,
    alpha: 1,
    // Fades in from the origin like the styleframe's fan of light.
    style: (c) => {
      const g = c.createLinearGradient(l.start.x, l.start.y, l.end.x, l.end.y)
      g.addColorStop(0, `${engineColor(l.engine)}00`)
      g.addColorStop(1, engineColor(l.engine))
      return g
    },
  }))
  if (u > 0) glowLines(ctx, strokes, beatBloom(beat), alpha)
  for (const l of lines) dot(ctx, tip(l), engineColor(l.engine), 7, u > 0 ? alpha : 0)

  const labelA = smooth(0.85, 1, u) * alpha
  if (labelA <= 0) return
  const xs = R + 40
  for (const l of lines) {
    const c = engineColor(l.engine)
    leader(ctx, { x: R + 10, y: l.end.y }, xs - 8, l.labelY, c, labelA)
    ctx.save()
    ctx.globalAlpha = labelA
    text(ctx, l.speedup, xs, l.labelY + 12, { size: 36, weight: 700, color: c })
    text(ctx, ENGINE_LABEL[l.engine], xs + 118, l.labelY + 11, { size: 30, weight: 400, color: 'rgba(255,255,255,0.78)' })
    ctx.restore()
  }
  drawHeadline(ctx, lines, labelA)
}

/** ×118 in the hot gradient (styleframe C2), with what it compares against. */
function drawHeadline(ctx: CanvasRenderingContext2D, lines: RaceLine[], alpha: number): void {
  const top = [...lines].sort((a, b) => a.end.y - b.end.y)[0]
  const x = 160
  const y = 230
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `700 132px ${FONT_FAMILY}`
  const w = ctx.measureText(top.speedup).width
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  g.addColorStop(0, '#ff3d81')
  g.addColorStop(1, '#ff9e3d')
  ctx.shadowColor = '#ff9e3d'
  ctx.shadowBlur = 30
  // A gradient fill, which text() does not take; the size is far above the 28 px minimum.
  ctx.fillStyle = g
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(top.speedup, x, y)
  ctx.shadowBlur = 0
  text(ctx, `${ENGINE_LABEL[top.engine]} vs ${ENGINE_LABEL['native-seq']}`, x + w + 32, y - 54, { size: 34, weight: 600, color: '#ffffff' })
  text(ctx, 'generations in 1 s · random · 1024²', x + w + 32, y - 8, { size: 30, weight: 400, color: 'rgba(255,255,255,0.7)' })
  ctx.restore()
}

function drawScaling(ctx: CanvasRenderingContext2D, t: number, beat: number, alpha: number): void {
  if (alpha <= 0) return
  const { L, R, T, B } = SCALE_BOX
  const { lines, range } = scalingLayout()
  const u = scalingProgress(t)
  const axisA = alpha * smooth(SCALING_T - 0.2, SCALING_T + 0.15, t)
  ctx.save()
  ctx.globalAlpha = axisA
  for (const tick of logTicks(range)) {
    hline(ctx, L, R, tick.y, AXIS)
    text(ctx, tick.label, L - 28, tick.y + 11, { size: 30, weight: 400, color: DIM_TEXT, align: 'right' })
  }
  for (const [i, s] of SCALING_SIZES.entries()) {
    const x = lines[0].points[i].x
    ctx.strokeStyle = AXIS
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, T)
    ctx.lineTo(x, B)
    ctx.stroke()
    text(ctx, `${s}²`, x, B + 56, { size: 32, weight: 600, color: 'rgba(255,255,255,0.75)', align: 'center' })
  }
  text(ctx, 'gen/s', L - 28, T - 30, { size: 30, weight: 400, color: DIM_TEXT, align: 'right' })
  ctx.restore()
  caption(ctx, 'random · gen/s vs grid size · log-log', 160, CAPTION_Y, axisA)

  if (u <= 0) return
  const xCut = L + u * (R - L)
  const strokes: Stroke[] = lines.map((l) => ({ pts: cutAt(l.points, xCut), width: 3, alpha: 1, style: () => engineColor(l.engine) }))
  glowLines(ctx, strokes, beatBloom(beat), alpha)
  for (const l of lines) {
    const pts = cutAt(l.points, xCut)
    for (const p of l.points) if (p.x <= xCut) dot(ctx, p, engineColor(l.engine), 6, alpha)
    dot(ctx, pts[pts.length - 1], engineColor(l.engine), 7, alpha)
  }
  const labelA = smooth(0.9, 1, u) * alpha
  if (labelA <= 0) return
  const xs = R + 44
  for (const l of lines) {
    const c = engineColor(l.engine)
    leader(ctx, { x: R + 12, y: l.y }, xs - 10, l.labelY, c, labelA)
    ctx.save()
    ctx.globalAlpha = labelA
    text(ctx, l.label, xs, l.labelY + 11, { size: 30, weight: 600, color: c })
    ctx.restore()
  }
}

/** How lit each line stays through the breakdown: the hero, the two GPUs it beats, the rest. */
function focus(e: EngineId): number {
  if (e === HERO) return 1
  return GPU.includes(e) ? 0.6 : 0.2
}

function drawSlope(ctx: CanvasRenderingContext2D, t: number, beat: number): void {
  if (t < REVERSAL_T) return
  const { XL, XR, T, B } = SLOPE_BOX
  const { lines } = slopeLayout()
  const u = slopeProgress(t)
  const axisA = smooth(REVERSAL_T, REVERSAL_T + 0.3, t)
  ctx.save()
  ctx.globalAlpha = axisA
  for (const x of [XL, XR]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, T - 20)
    ctx.lineTo(x, B + 10)
    ctx.stroke()
  }
  text(ctx, 'Random 50%', XL, B + 62, { size: 34, weight: 600, color: 'rgba(255,255,255,0.8)', align: 'center' })
  text(ctx, 'Gosper guns', XR, B + 62, { size: 34, weight: 600, color: 'rgba(255,255,255,0.8)', align: 'center' })
  text(ctx, 'gen/s · 1024² · log scale', 160, H - 64, { size: 28, weight: 400, color: 'rgba(255,255,255,0.45)' })
  ctx.restore()

  const xCut = XL + u * (XR - XL)
  const kick = (beatBloom(beat) - 0.55) / 0.35
  // Dim lines first, then the GPUs, then wasm-simd on top so its crossing reads over them.
  const order = [...lines].sort((a, b) => focus(a.engine) - focus(b.engine))
  const strokes: Stroke[] = order.map((l) => ({
    pts: cutAt([l.a, l.b], xCut),
    width: l.engine === HERO ? 5 : 3,
    alpha: focus(l.engine),
    style: () => engineColor(l.engine),
  }))
  if (u > 0) glowLines(ctx, strokes, 0.7 + 0.5 * kick)
  // The hero gets a second, wider glow that pulses on the kick.
  const hero = lines.find((l) => l.engine === HERO)!
  if (u > 0) {
    const heroStroke = strokes[order.indexOf(hero)]
    withLayer(ctx, (l) => strokePaths(l, [heroStroke], 6), {
      filter: 'blur(26px)',
      alpha: 0.45 + 0.4 * kick,
      op: 'lighter',
    })
  }
  for (const l of order) {
    const pts = cutAt([l.a, l.b], xCut)
    const f = focus(l.engine)
    const c = engineColor(l.engine)
    dot(ctx, l.a, c, l.engine === HERO ? 8 : 6, f * axisA)
    if (u > 0) dot(ctx, pts[pts.length - 1], c, l.engine === HERO ? 8 : 6, f)
  }

  for (const x of crossings()) {
    if (u < x.s) continue
    // Scene time at which the drawn head passed the crossing (inverse of the ease-out).
    const crossedAt = REVERSAL_T + (1 - Math.cbrt(1 - x.s)) * SLOPE_DUR
    const ring = clamp01((t - crossedAt) / 0.6)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 1 - ring
    ctx.strokeStyle = mix(engineColor(HERO), '#ffffff', 0.5)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x.at.x, x.at.y, 10 + 70 * ring, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    dot(ctx, x.at, mix(engineColor(HERO), '#ffffff', 0.4), 9 + 3 * kick, 1)
  }

  const leftA = axisA
  const rightA = smooth(0.9, 1, u)
  for (const l of lines) {
    const f = focus(l.engine)
    const isHero = l.engine === HERO
    const c = isHero ? mix(engineColor(l.engine), '#ffffff', 0.2) : engineColor(l.engine)
    const size = isHero ? 34 : 30
    const weight = isHero ? 700 : 400
    // Dimmed labels stay readable: every engine is named on both sides.
    const textA = Math.max(f, 0.5)
    leader(ctx, { x: XL - 12, y: l.a.y }, XL - 26, l.left.y, c, leftA * textA)
    leader(ctx, { x: XR + 12, y: l.b.y }, XR + 26, l.right.y, c, rightA * textA)
    ctx.save()
    ctx.globalAlpha = leftA * textA
    text(ctx, l.left.text, XL - 32, l.left.y + 11, { size, weight, color: c, align: 'right' })
    ctx.globalAlpha = rightA * textA
    text(ctx, l.right.text, XR + 32, l.right.y + 11, { size, weight, color: c })
    ctx.restore()
  }

  caption(ctx, REVERSAL_CAPTION, 160, CAPTION_Y, smooth(REVERSAL_T + 0.1, REVERSAL_T + 0.35, t))
  // Over wasm-simd's Guns figure: the reason it wins.
  caption(ctx, LAZY_CAPTION, XR + 32, hero.right.y - 52, smooth(LAZY_T, LAZY_T + 0.25, t))
}

export const curves: Scene = {
  id: 'curves',
  figures: [...RACE, ...SCALING.flat().filter((f) => f.size !== 1024), ...GUNS],
  draw(ctx, s) {
    const { t, beat } = s
    nightBackground(ctx)
    drawRace(ctx, t, beat, raceAlpha(t))
    // The reversal is a cut: the scaling chart is gone within a few frames of the breakdown.
    if (t >= SCALING_T - 0.2) drawScaling(ctx, t, beat, 1 - smooth(REVERSAL_T - 0.1, REVERSAL_T, t))
    drawSlope(ctx, t, beat)
    machineLabel(ctx)
  },
}
