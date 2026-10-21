import { createGrid, type Grid } from '../../../web/src/grid'

/**
 * One B3/S23 generation. Border cells are never alive (same semantics as the
 * web `wasm-seq` engine). Never mutates `g`; writes into `out` when given
 * (must be a distinct grid of the same size) so callers can double-buffer.
 */
export function lifeStep(g: Grid, out: Grid = createGrid(g.size)): Grid {
  const n = g.size
  if (out === g || out.size !== n) throw new RangeError('lifeStep: out must be a distinct grid of the same size')
  const src = g.cells
  const dst = out.cells
  dst.fill(0)
  for (let y = 1; y < n - 1; y++) {
    const row = y * n
    for (let x = 1; x < n - 1; x++) {
      const i = row + x
      const sum =
        src[i - n - 1] + src[i - n] + src[i - n + 1] + src[i - 1] + src[i + 1] + src[i + n - 1] + src[i + n] + src[i + n + 1]
      // Cells are 0/1 so the neighbour sum is exact; the border row/column are always 0.
      dst[i] = sum === 3 || (sum === 2 && src[i] !== 0) ? 1 : 0
    }
  }
  return out
}
