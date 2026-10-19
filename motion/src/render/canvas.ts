import { type Grid } from '../../../web/src/grid'
import { H, W } from '../timeline'
import { NIGHT } from './palette'

export type P = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const FONT_FAMILY = '"Space Grotesk"'
export const MIN_TEXT_SIZE = 28

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Deep night radial gradient, slightly brighter above the centre (DA C). */
export function nightBackground(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.resetTransform()
  const g = ctx.createRadialGradient(W / 2, H / 2 - 40, 60, W / 2, H / 2, W * 0.67)
  g.addColorStop(0, NIGHT[1])
  g.addColorStop(0.55, '#0a0820')
  g.addColorStop(1, NIGHT[0])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

// Offscreen layers are pooled by nesting depth: allocating a full-frame canvas per call is costly.
const layerPool: HTMLCanvasElement[] = []
let layerDepth = 0

export interface LayerOpts {
  filter?: string
  alpha?: number
  op?: GlobalCompositeOperation
}

/** Paints on a transparent full-size layer that shares `ctx`'s transform, then runs `use` with it. */
function onLayer(
  ctx: CanvasRenderingContext2D,
  paint: (l: CanvasRenderingContext2D) => void,
  use: (layer: HTMLCanvasElement) => void,
): void {
  const { width, height } = ctx.canvas
  const c = (layerPool[layerDepth] ??= newCanvas(width, height))
  if (c.width !== width || c.height !== height) {
    c.width = width
    c.height = height
  }
  const l = c.getContext('2d')!
  l.reset()
  l.setTransform(ctx.getTransform())
  layerDepth++
  try {
    paint(l)
    use(c)
  } finally {
    layerDepth--
  }
}

function composite(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, opts: LayerOpts): void {
  ctx.save()
  ctx.resetTransform()
  // The filter is applied once to the whole layer: a filter set per cell draw call loses the context.
  ctx.filter = opts.filter ?? 'none'
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.globalCompositeOperation = opts.op ?? 'source-over'
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
}

export function withLayer(
  ctx: CanvasRenderingContext2D,
  paint: (l: CanvasRenderingContext2D) => void,
  opts: LayerOpts = {},
): void {
  onLayer(ctx, paint, (layer) => composite(ctx, layer, opts))
}

// Colour strings from `color()` are parsed once; heat() yields a few hundred distinct values at most.
const rgbCache = new Map<string, [number, number, number]>()
let probe: CanvasRenderingContext2D | null = null

function toRgb(css: string): [number, number, number] {
  let rgb = rgbCache.get(css)
  if (rgb) return rgb
  let s = css
  if (!/^#[0-9a-f]{6}$/i.test(s)) {
    probe ??= newCanvas(1, 1).getContext('2d')!
    probe.fillStyle = '#000000'
    probe.fillStyle = css
    s = String(probe.fillStyle)
  }
  if (s.startsWith('#')) {
    rgb = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]
  } else {
    const [r, g, b] = (s.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number)
    rgb = [r, g, b]
  }
  rgbCache.set(css, rgb)
  return rgb
}

export interface CellOpts {
  /** Colour of the cell at normalised grid position (u, v) in [0, 1]. */
  color: (u: number, v: number) => string
  /** Bloom intensity (alpha of the glow layers); 0 disables it. Pulse it with the generations. */
  bloom: number
  /** Overall opacity, used to push satellites back. Defaults to 1. */
  dim?: number
  /** Depth-of-field blur of the sharp layer, in device px. Defaults to 0. */
  blur?: number
}

const MIN_DOT_PX = 3

function paintDots(l: CanvasRenderingContext2D, grid: Grid, rect: Rect, color: CellOpts['color']): void {
  const n = grid.size
  const cw = rect.w / n
  const ch = rect.h / n
  const r = Math.max(Math.min(cw, ch) * 0.42, 0.6)
  // One path per colour keeps the fill calls to a few hundred for a 256² grid.
  const paths = new Map<string, Path2D>()
  for (let y = 0; y < n; y++) {
    const row = y * n
    const cy = rect.y + (y + 0.5) * ch
    const v = (y + 0.5) / n
    for (let x = 0; x < n; x++) {
      if (!grid.cells[row + x]) continue
      const c = color((x + 0.5) / n, v)
      let p = paths.get(c)
      if (!p) paths.set(c, (p = new Path2D()))
      const cx = rect.x + (x + 0.5) * cw
      p.moveTo(cx + r, cy)
      p.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }
  for (const [c, p] of paths) {
    l.fillStyle = c
    l.fill(p)
  }
}

let densityCanvas: HTMLCanvasElement | null = null

/** Below 3 px per cell, dots alias: draw a box-filtered density image (alpha = live fraction). */
function paintDensity(l: CanvasRenderingContext2D, grid: Grid, rect: Rect, devScale: number, color: CellOpts['color']): void {
  const n = grid.size
  const tw = Math.max(1, Math.min(n, Math.ceil(rect.w * devScale)))
  const th = Math.max(1, Math.min(n, Math.ceil(rect.h * devScale)))
  const acc = new Float32Array(tw * th * 4)
  const binX = new Int32Array(n)
  const binY = new Int32Array(n)
  const countX = new Int32Array(tw)
  const countY = new Int32Array(th)
  for (let i = 0; i < n; i++) {
    binX[i] = Math.floor((i * tw) / n)
    binY[i] = Math.floor((i * th) / n)
    countX[binX[i]]++
    countY[binY[i]]++
  }
  for (let y = 0; y < n; y++) {
    const row = y * n
    const by = binY[y] * tw
    const v = (y + 0.5) / n
    for (let x = 0; x < n; x++) {
      if (!grid.cells[row + x]) continue
      const [r, g, b] = toRgb(color((x + 0.5) / n, v))
      const k = (by + binX[x]) * 4
      acc[k] += r
      acc[k + 1] += g
      acc[k + 2] += b
      acc[k + 3]++
    }
  }
  const img = new ImageData(tw, th)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const k = (y * tw + x) * 4
      const live = acc[k + 3]
      if (!live) continue
      img.data[k] = acc[k] / live
      img.data[k + 1] = acc[k + 1] / live
      img.data[k + 2] = acc[k + 2] / live
      img.data[k + 3] = (255 * live) / (countX[x] * countY[y])
    }
  }
  densityCanvas ??= newCanvas(tw, th)
  if (densityCanvas.width !== tw || densityCanvas.height !== th) {
    densityCanvas.width = tw
    densityCanvas.height = th
  }
  densityCanvas.getContext('2d')!.putImageData(img, 0, 0)
  l.imageSmoothingEnabled = true
  l.imageSmoothingQuality = 'high'
  l.drawImage(densityCanvas, rect.x, rect.y, rect.w, rect.h)
}

/**
 * Live cells of `grid` in `rect` as glowing dots added with `lighter`, plus a two-radius bloom.
 * All filters run once per layer, never per cell.
 */
export function drawCells(ctx: CanvasRenderingContext2D, grid: Grid, rect: Rect, opts: CellOpts): void {
  const m = ctx.getTransform()
  const devScale = Math.hypot(m.a, m.b)
  const cellDev = (rect.w / grid.size) * devScale
  const dim = opts.dim ?? 1
  const paint = (l: CanvasRenderingContext2D) =>
    cellDev >= MIN_DOT_PX ? paintDots(l, grid, rect, opts.color) : paintDensity(l, grid, rect, devScale, opts.color)
  onLayer(ctx, paint, (layer) => {
    if (opts.bloom > 0) {
      const near = Math.max(2, cellDev * 0.8)
      const far = Math.max(8, cellDev * 4)
      composite(ctx, layer, { filter: `blur(${far}px)`, alpha: Math.min(1, opts.bloom * 0.6) * dim, op: 'lighter' })
      composite(ctx, layer, { filter: `blur(${near}px)`, alpha: Math.min(1, opts.bloom * 0.8) * dim, op: 'lighter' })
    }
    const blur = opts.blur ?? 0
    composite(ctx, layer, { filter: blur > 0 ? `blur(${blur}px)` : 'none', alpha: dim, op: 'lighter' })
  })
}

function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight }
  if (img instanceof HTMLVideoElement) return { w: img.videoWidth, h: img.videoHeight }
  const { width, height } = img as { width: unknown; height: unknown }
  if (typeof width !== 'number' || typeof height !== 'number') throw new TypeError('unsupported image source')
  return { w: width, h: height }
}

/** Projective map of the unit square onto quad (TL, TR, BR, BL) — Heckbert's square-to-quad. */
function squareToQuad([p0, p1, p2, p3]: readonly [P, P, P, P]): (u: number, v: number) => P {
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x
    b = p2.x - p1.x
    c = p0.x
    d = p1.y - p0.y
    e = p2.y - p1.y
    f = p0.y
    g = 0
    h = 0
  } else {
    const dx1 = p1.x - p2.x
    const dx2 = p3.x - p2.x
    const dy1 = p1.y - p2.y
    const dy2 = p3.y - p2.y
    const den = dx1 * dy2 - dx2 * dy1
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
    a = p1.x - p0.x + g * p1.x
    b = p3.x - p0.x + h * p3.x
    c = p0.x
    d = p1.y - p0.y + g * p1.y
    e = p3.y - p0.y + h * p3.y
    f = p0.y
  }
  return (u, v) => {
    const w = g * u + h * v + 1
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }
  }
}

const STRIPS = 64

/** Unit normal of segment a→b, oriented towards `side`. */
function normalTowards(a: P, b: P, side: P): P {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
  return n.x * (side.x - a.x) + n.y * (side.y - a.y) >= 0 ? n : { x: -n.x, y: -n.y }
}

const shift = (p: P, n: P, d: number): P => ({ x: p.x + n.x * d, y: p.y + n.y * d })

function clipTo(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
  ctx.clip()
}

/**
 * Draws `img` into the quad (top-left, top-right, bottom-right, bottom-left) by column slicing:
 * 64 vertical strips on the projective column positions, each split into two affine triangles
 * so both the top and bottom edges stay straight. Each triangle overlaps its successor by 1
 * device px to hide antialiasing seams: invisible on opaque sources, so draw translucent glass
 * fills as paths rather than through this.
 */
export function drawPerspective(ctx: CanvasRenderingContext2D, img: CanvasImageSource, quad: [P, P, P, P]): void {
  const { w: iw, h: ih } = sourceSize(img)
  if (iw <= 0 || ih <= 0) return
  const map = squareToQuad(quad)
  const m = ctx.getTransform()
  const d = 1 / Math.max(1e-6, Math.hypot(m.a, m.b))
  for (let i = 0; i < STRIPS; i++) {
    const u0 = i / STRIPS
    const u1 = (i + 1) / STRIPS
    const sx0 = u0 * iw
    const sw = (u1 - u0) * iw
    const t0 = map(u0, 0)
    const t1 = map(u1, 0)
    const b0 = map(u0, 1)
    const b1 = map(u1, 1)
    const last = i === STRIPS - 1
    // Source columns past the strip feed the overlap into the next strip.
    const extra = last ? 0 : Math.ceil((sw * d) / (Math.hypot(t1.x - t0.x, t1.y - t0.y) || 1)) + 1
    const sDraw = Math.min(sw + extra, iw - sx0)

    // Upper-left triangle (t0, t1, b0): source (sx0,0)→t0, +u→t1, +v→b0. Overlaps across the diagonal.
    const nd = normalTowards(t1, b0, b1)
    ctx.save()
    clipTo(ctx, [t0, shift(t1, nd, d), shift(b0, nd, d)])
    ctx.transform((t1.x - t0.x) / sw, (t1.y - t0.y) / sw, (b0.x - t0.x) / ih, (b0.y - t0.y) / ih, t0.x, t0.y)
    ctx.drawImage(img, sx0, 0, sDraw, ih, 0, 0, sDraw, ih)
    ctx.restore()

    // Lower-right triangle (t1, b1, b0): +u runs along the bottom edge, +v along the right edge.
    const nr = normalTowards(t1, b1, { x: 2 * t1.x - t0.x, y: 2 * t1.y - t0.y })
    ctx.save()
    clipTo(ctx, last ? [t1, b1, b0] : [shift(t1, nr, d), shift(b1, nr, d), b0])
    ctx.transform(
      (b1.x - b0.x) / sw,
      (b1.y - b0.y) / sw,
      (b1.x - t1.x) / ih,
      (b1.y - t1.y) / ih,
      b0.x + t1.x - b1.x,
      b0.y + t1.y - b1.y,
    )
    ctx.drawImage(img, sx0, 0, sDraw, ih, 0, 0, sDraw, ih)
    ctx.restore()
  }
}

export interface TextOpts {
  size: number
  weight: 400 | 600 | 700
  color: string
  align?: CanvasTextAlign
}

/** Space Grotesk text; refuses sizes under 28 px on the 1920 px master (legibility on the 1024 px loop). */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, opts: TextOpts): void {
  if (opts.size < MIN_TEXT_SIZE) {
    throw new RangeError(`text size ${opts.size}px is below the ${MIN_TEXT_SIZE}px minimum: "${s}"`)
  }
  ctx.save()
  ctx.font = `${opts.weight} ${opts.size}px ${FONT_FAMILY}`
  ctx.fillStyle = opts.color
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(s, x, y)
  ctx.restore()
}
