import { describe, expect, it } from 'vitest'
import { ENGINES, formatGps, gensPerSec, speedRank, speedup } from '../src/data'

describe('data layer', () => {
  it('reads web figures', () => {
    expect(Math.round(gensPerSec({ engine: 'webgpu-naive', preset: 'random', size: 1024 }))).toBe(22198)
    expect(Math.round(gensPerSec({ engine: 'wasm-simd', preset: 'guns', size: 1024 }))).toBe(26900)
  })

  it('throws on a missing figure', () => {
    expect(() => gensPerSec({ engine: 'native-seq', preset: 'clown', size: 1024 })).toThrow(
      'no bench figure for native-seq/clown/1024',
    )
  })

  it('ranks engines by speed on random/1024', () => {
    expect(speedRank()).toEqual([
      'native-seq',
      'wasm-seq',
      'native-omp_tiled',
      'wasm-mt',
      'wasm-simd',
      'webgpu-tiled',
      'webgpu-naive',
    ])
    expect([...speedRank()].sort()).toEqual([...ENGINES].sort())
  })

  it('computes speedups against native-seq', () => {
    expect(Math.round(speedup({ engine: 'webgpu-naive', preset: 'random', size: 1024 }))).toBe(118)
  })

  it('formats gens/s with en-US grouping', () => {
    expect(formatGps(22198.4)).toBe('22,198')
  })

  it.each(['bugs', 'clown', 'diehard'])('resolves wasm-simd and webgpu-naive on %s', (preset) => {
    for (const engine of ['wasm-simd', 'webgpu-naive'] as const) {
      expect(gensPerSec({ engine, preset, size: 1024 })).toBeGreaterThan(0)
    }
  })
})
