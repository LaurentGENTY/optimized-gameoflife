import { describe, expect, it } from 'vitest'
import { ENGINES, type EngineId, formatGps, gensPerSec } from '../src/data'
import { NATIVE_END_GEN, native, nativeCounter, nativeSweep } from '../src/scenes/native'
import { LASER_WIDTH, MARKER_RATE, laserAt, laserStep, markerAt, simd, simdCounter } from '../src/scenes/simd'
import { ROLL_DURATION, type CounterState, bands, rollValue } from '../src/scenes/sweep'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../src/timeline'

const shown = (engine: EngineId) => formatGps(gensPerSec({ engine, preset: 'random', size: 1024 }))
const sceneFrames = (id: 'native' | 'simd') => Array.from({ length: SCENE_BARS[id] * 2 * FPS }, (_, f) => f / FPS)

/** Seconds during which `engine`'s exact figure is on screen, as the main counter or the previous-figure line. */
function heldFor(counter: (t: number) => CounterState, engine: EngineId, times: number[]): number {
  const target = shown(engine)
  const lines = (c: CounterState) => (c.prev ? [c, c.prev] : [c])
  return times.filter((t) => lines(counter(t)).some((l) => l.engine === engine && formatGps(l.value) === target)).length / FPS
}

/** The main counter never shows another engine's exact figure under its own label. */
function expectNoBorrowedFigure(counter: (t: number) => CounterState, times: number[]): void {
  for (const t of times) {
    const c = counter(t)
    const s = formatGps(c.value)
    for (const other of ENGINES) if (other !== c.engine) expect(s, `t=${t} ${c.engine} shows ${other}'s figure`).not.toBe(shown(other))
  }
}

describe('rollValue', () => {
  it('holds the start value before the roll and lands exactly on the target after it', () => {
    expect(rollValue(188, 632.78, 3.9, 4)).toBe(188)
    expect(rollValue(188, 632.78, 4 + ROLL_DURATION, 4)).toBe(632.78)
    expect(rollValue(188, 632.78, 7, 4)).toBe(632.78)
  })

  it('counts up monotonically, ease-out (more than half way at mid-roll)', () => {
    let last = -Infinity
    for (let t = 0; t <= ROLL_DURATION + 0.1; t += 1 / FPS) {
      const v = rollValue(0, 5358.78, t, 0)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    expect(rollValue(0, 1000, ROLL_DURATION / 2, 0)).toBeGreaterThan(500)
  })
})

describe('bands', () => {
  it('splits 256 rows into 15 contiguous bands of 17 or 18 rows', () => {
    const b = bands(256, 15)
    expect(b).toHaveLength(15)
    expect(b[0][0]).toBe(0)
    expect(b[14][1]).toBe(256)
    b.forEach(([r0, r1], i) => {
      if (i > 0) expect(r0).toBe(b[i - 1][1])
      expect(r1 - r0).toBeGreaterThanOrEqual(17)
      expect(r1 - r0).toBeLessThanOrEqual(18)
    })
  })
})

describe('native scene', () => {
  const omp = CUES.nativeOmp - sceneStart('native')

  it('declares the figures it shows', () => {
    expect(native.figures).toEqual([
      { engine: 'native-seq', preset: 'random', size: 1024 },
      { engine: 'native-omp_tiled', preset: 'random', size: 1024 },
    ])
  })

  it('shows 188 gen/s for the sequential C, then rolls to the OpenMP figure on its cue', () => {
    expect(formatGps(nativeCounter(2).value)).toBe('188')
    expect(nativeCounter(omp - 1 / FPS).engine).toBe('native-seq')
    expect(nativeCounter(omp).engine).toBe('native-omp_tiled')
    expect(formatGps(nativeCounter(5.67).value)).toBe(shown('native-omp_tiled'))
    expect(nativeCounter(5.67).prev).toEqual({ engine: 'native-seq', value: gensPerSec({ engine: 'native-seq', preset: 'random', size: 1024 }) })
  })

  it('holds each figure on screen at least 2 s', () => {
    for (const e of ['native-seq', 'native-omp_tiled'] as const) expect(heldFor(nativeCounter, e, sceneFrames('native'))).toBeGreaterThanOrEqual(2)
  })

  it('never pairs an engine label with another engine figure, even mid-roll', () => {
    expect(nativeCounter(omp).value).toBe(0)
    expectNoBorrowedFigure(nativeCounter, sceneFrames('native'))
  })

  it('sweeps one band before the cue and 15 after, generations never going back', () => {
    expect(nativeSweep(omp - 1 / FPS).bands).toBe(1)
    expect(nativeSweep(omp).bands).toBe(15)
    let last = 0
    for (const t of sceneFrames('native')) {
      const { gen, f } = nativeSweep(t)
      expect(gen).toBeGreaterThanOrEqual(last)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      last = gen
    }
    expect(nativeSweep(SCENE_BARS.native * 2).gen).toBe(NATIVE_END_GEN)
  })
})

describe('simd scene', () => {
  const laser = CUES.simdLaser - sceneStart('simd')

  it('declares the figures it shows', () => {
    expect(simd.figures).toEqual([
      { engine: 'wasm-seq', preset: 'random', size: 1024 },
      { engine: 'wasm-simd', preset: 'random', size: 1024 },
    ])
  })

  it('shows wasm-seq at 548 gen/s, then rolls to the wasm-simd figure on the laser cue', () => {
    expect(formatGps(simdCounter(1).value)).toBe('548')
    expect(simdCounter(laser - 1 / FPS).engine).toBe('wasm-seq')
    expect(simdCounter(laser).engine).toBe('wasm-simd')
    expect(formatGps(simdCounter(4.33).value)).toBe('5,359')
  })

  it('holds each figure on screen at least 2 s', () => {
    for (const e of ['wasm-seq', 'wasm-simd'] as const) expect(heldFor(simdCounter, e, sceneFrames('simd'))).toBeGreaterThanOrEqual(2)
  })

  it('never pairs an engine label with another engine figure, even mid-roll', () => {
    expect(simdCounter(laser).value).toBe(0)
    expectNoBorrowedFigure(simdCounter, sceneFrames('simd'))
  })

  it('marks the laser itself while it is slow', () => {
    expect(MARKER_RATE).toBe(8)
    for (let tau = 0; tau < 1; tau += 1 / FPS) {
      const { row, col } = laserAt(tau)
      expect(markerAt(tau)).toEqual({ row, col })
    }
  })

  it('keeps the 16-dot marker travelling across the grid through the whole hold', () => {
    const end = SCENE_BARS.simd * 2 - laser
    // Sampled every 0.25 s: two whole generations at full speed, the period that froze the old marker.
    const samples: { row: number; col: number }[] = []
    for (let tau = 0; tau <= end - 1 / FPS; tau += 0.25) samples.push(markerAt(tau))
    for (let i = 1; i < samples.length; i++) expect(samples[i], `sample ${i}`).not.toEqual(samples[i - 1])
    expect(new Set(samples.map((p) => p.col)).size).toBeGreaterThanOrEqual(8)
    // Frame by frame through the full-speed hold it rides the scan line down the whole grid,
    // a few rows per frame (a sweep, not a strobe), wrapping at each new generation.
    const rows = new Set<number>()
    const cols = new Set<number>()
    let prev = markerAt(2).row
    for (let f = 1; 2 + f / FPS < end; f++) {
      const m = markerAt(2 + f / FPS)
      expect(m.row).toBe(laserAt(2 + f / FPS).row)
      const step = (m.row - prev + 256) % 256
      expect(step).toBeGreaterThanOrEqual(1)
      expect(step).toBeLessThanOrEqual(24)
      prev = m.row
      rows.add(m.row)
      cols.add(m.col)
    }
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThanOrEqual(220)
    expect(cols.size).toBe(16)
    // Each step is one 16-cell instruction slot of the row.
    for (const c of cols) expect(c % LASER_WIDTH).toBe(0)
  })

  it('steps the 16-cell laser one instruction at a time, slowly at first, then accelerating', () => {
    expect(LASER_WIDTH).toBe(16)
    expect(laserStep(0)).toBe(0)
    // The first second shows the instructions one by one, one per sixteenth note: half a 256-cell row.
    expect(laserStep(0.999)).toBe(7)
    expect(laserStep(1)).toBe(8)
    let last = 0
    for (let tau = 0; tau < 6; tau += 1 / FPS) {
      const k = laserStep(tau)
      expect(Number.isInteger(k)).toBe(true)
      expect(k).toBeGreaterThanOrEqual(last)
      last = k
    }
    // At full speed a whole 256² generation (4096 instructions) takes an eighth note.
    expect(laserStep(5.25) - laserStep(5)).toBeCloseTo(4096, -1)
  })
})
