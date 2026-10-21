import { type Grid } from '../../../web/src/grid'
import { buildGrid } from '../../../web/src/patterns/presets'
import { lifeStep } from './life'

/** Builds the grid of a web preset; throws if `size` is below the preset's `minSize`. */
export function seedGrid(presetId: string, size: number): Grid {
  return buildGrid(presetId, size)
}

/**
 * Deterministic access to "generation g of a simulation", whatever the order
 * the frames are requested in. Stepping forward is incremental; asking for an
 * earlier generation restarts from `seed()`.
 *
 * Two buffers are reused, so the Grid returned by `at()` is only valid until
 * the next `at()` call that changes generation: copy `cells` if you need to
 * keep it. `seed()` must return a fresh grid each call and be deterministic.
 */
export class SimTrack {
  private cur: Grid
  private spare: Grid | null = null
  private gen = 0

  constructor(private readonly seed: () => Grid) {
    this.cur = seed()
  }

  at(gen: number): Grid {
    if (!Number.isInteger(gen) || gen < 0) throw new RangeError(`generation must be a non-negative integer, got ${gen}`)
    if (gen < this.gen) {
      // Reuse the buffer we are about to drop as the spare one.
      this.spare = this.cur
      this.cur = this.seed()
      this.gen = 0
    }
    while (this.gen < gen) {
      const next = lifeStep(this.cur, this.spare ?? undefined)
      this.spare = this.cur
      this.cur = next
      this.gen++
    }
    return this.cur
  }
}
