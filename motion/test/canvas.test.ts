import { describe, expect, it } from 'vitest'
import { DOT_FADE, dotWeight } from '../src/render/canvas'

describe('drawCells dots/density switch', () => {
  it('cross-fades the two paths over a band of cell sizes instead of switching at one size', () => {
    expect(dotWeight(DOT_FADE.from)).toBe(0)
    expect(dotWeight(DOT_FADE.to)).toBe(1)
    let prev = -1
    for (let px = 2; px <= 4; px += 0.01) {
      const w = dotWeight(px)
      expect(w).toBeGreaterThanOrEqual(prev)
      // Continuous: no step larger than the band slope allows.
      if (prev >= 0) expect(w - prev).toBeLessThanOrEqual(0.01 / (DOT_FADE.to - DOT_FADE.from) + 1e-9)
      prev = w
    }
  })

  it('leaves the fixed cell sizes of the other scenes on a single path', () => {
    // native and simd full view: 840 px for 256 cells; screens: at most 2.38 px per cell.
    expect(dotWeight(840 / 256)).toBe(1)
    expect(dotWeight(2.38)).toBe(0)
  })
})
