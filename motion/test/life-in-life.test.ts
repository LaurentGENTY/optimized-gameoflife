import { describe, expect, it } from 'vitest'
import { type Grid } from '../../web/src/grid'
import { lifeStep } from '../src/sim/life'
import { seedGrid } from '../src/sim/track'
import { FOCUS_GENS, GRID_RECT, META_SPAN, START, camera, poolings, toScreen } from '../src/scenes/life-in-life'
import { H, W } from '../src/timeline'

/** Live cells of `g` in the half-open box [x0, x1) × [y0, y1), as "x,y" strings. */
function liveIn(g: Grid, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.cells[(y - oy) * g.size + x - ox]) out.push(`${x},${y}`)
  return out
}

describe('life-in-life start cell', () => {
  it('belongs to a block alone in the opening view for the whole focus pull', () => {
    const seed = seedGrid('meta3x3', 6208)
    // Signals travel at most 1 cell per generation, so a crop with this margin evolves exactly.
    const margin = FOCUS_GENS + 16
    const ox = START.x - margin
    const oy = START.y - margin
    const side = 2 * margin
    let crop: Grid = { size: side, cells: new Uint8Array(side * side) }
    for (let y = 0; y < side; y++) crop.cells.set(seed.cells.subarray((oy + y) * seed.size + ox, (oy + y) * seed.size + ox + side), y * side)
    // Opening view at W/10 px per cell: 10 × 6.25 cells around the start cell.
    const block = [`${START.x},${START.y}`, `${START.x + 1},${START.y}`, `${START.x},${START.y + 1}`, `${START.x + 1},${START.y + 1}`]
    for (let gen = 0; gen <= FOCUS_GENS; gen++) {
      expect(liveIn(crop, ox, oy, START.x - 5, START.y - 3, START.x + 6, START.y + 4).sort(), `gen ${gen}`).toEqual(block.sort())
      crop = lifeStep(crop)
    }
  })
})

describe('life-in-life camera', () => {
  it('opens on the start cell at a tenth of the frame width', () => {
    const cam = camera(0)
    expect(cam.s).toBeCloseTo(W / 10)
    const p = toScreen(cam, START.x + 0.5, START.y + 0.5)
    expect(p.x).toBeCloseTo(W / 2)
    expect(p.y).toBeCloseTo(H / 2)
  })

  it('lands on the whole 3×3 metapixel grid by 5.5 s and holds', () => {
    for (const t of [5.5, 6]) {
      const cam = camera(t)
      const tl = toScreen(cam, META_SPAN.x0, META_SPAN.x0)
      const br = toScreen(cam, META_SPAN.x1, META_SPAN.x1)
      expect(tl.x).toBeCloseTo(GRID_RECT.x)
      expect(tl.y).toBeCloseTo(GRID_RECT.y)
      expect(br.x - tl.x).toBeCloseTo(GRID_RECT.w)
      expect(br.y - tl.y).toBeCloseTo(GRID_RECT.h)
    }
  })

  it('zooms out monotonically', () => {
    let prev = Infinity
    for (let f = 0; f <= 360; f++) {
      const { s } = camera(f / 60)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })
})

describe('life-in-life pooling', () => {
  const weight = (s: number, k: number) => poolings(s).find((p) => p.k === k)?.w ?? 0

  it('draws cells unpooled down to 1 px per cell', () => {
    expect(poolings(192)).toEqual([{ k: 1, w: 1 }])
    expect(poolings(1)).toEqual([{ k: 1, w: 1 }])
  })

  it('cross-fades so the image is continuous across each integer pooling step', () => {
    for (const q of [1.5, 2.25, 6.9]) expect(poolings(1 / q).reduce((a, p) => a + p.w, 0)).toBeCloseTo(1)
    for (const k of [1, 2, 3, 6]) {
      for (const kk of [k - 1, k, k + 1]) expect(weight(1 / (k - 1e-9), kk)).toBeCloseTo(weight(1 / (k + 1e-9), kk), 6)
    }
  })
})
