import { describe, expect, it } from 'vitest'
import { CREDITS, CUE_LAYERS, CUE_T, SUBTITLE, TICK_T, TITLE, blink, end, layerAlphas } from '../src/scenes/end'
import { CUES, FPS, SCENE_BARS, TOTAL_FRAMES, sceneAt, sceneStart } from '../src/timeline'

const LAST_T = (SCENE_BARS.end * 2 * FPS - 1) / FPS
const LAYERS = ['pulsar', 'url', 'built', 'names', 'title'] as const

describe('end scene', () => {
  it('shows the credits copy exactly', () => {
    expect(CREDITS).toEqual({
      names: 'Laurent Genty · Clément Bertin · Emeric Duchemin',
      built: 'Built on easypap by Raymond Namyst',
      url: 'laurentgenty.github.io/optimized-gameoflife',
    })
    expect(TITLE).toBe('Optimized Game of Life')
    expect(SUBTITLE).toBe('Life, simulated by Life')
    expect(end.figures).toEqual([])
  })

  it('is the last scene and its frame 4559 maps to its last instant', () => {
    expect(sceneAt(TOTAL_FRAMES - 1).id).toBe('end')
    expect(sceneAt(TOTAL_FRAMES - 1).t).toBeCloseTo(LAST_T)
  })

  it('takes the cues in scene time and dims every layer exactly once', () => {
    expect(CUE_T).toEqual(CUES.layersOff.map((c) => c - sceneStart('end')))
    expect(TICK_T).toBeCloseTo(CUES.finalTick - sceneStart('end'))
    expect(CUE_LAYERS.flat().sort()).toEqual([...LAYERS].sort())
  })

  it('dims the cue layers when their music layer stops, and not before', () => {
    CUE_LAYERS.forEach((layers, k) => {
      const c = CUE_T[k]
      for (const l of layers) {
        const a = (t: number) => layerAlphas(t)[l]
        // Fully faded in just before the cue (the first cue is the scene start itself).
        if (c > 1) expect(a(c - 0.01)).toBe(1)
        expect(a(c + 0.4)).toBeLessThan(a(c + 0.2))
        expect(a(c + 0.2)).toBeLessThan(1)
        expect(a(c + 1.6)).toBe(0)
      }
    })
  })

  it('dims each layer monotonically once its cue has passed', () => {
    CUE_LAYERS.forEach((layers, k) => {
      for (const l of layers) {
        let prev = Infinity
        for (let t = CUE_T[k] + 0.6; t <= LAST_T; t += 1 / FPS) {
          const a = layerAlphas(t)[l]
          expect(a).toBeLessThanOrEqual(prev + 1e-12)
          prev = a
        }
      }
    })
  })

  it('does not touch the other layers at a cue', () => {
    CUE_LAYERS.forEach((layers, k) => {
      if (k === 0) return
      const c = CUE_T[k]
      for (const l of LAYERS.filter((l) => !layers.includes(l) && !CUE_LAYERS.slice(0, k).flat().includes(l))) {
        expect(layerAlphas(c + 0.4)[l]).toBe(layerAlphas(c - 0.01)[l])
      }
    })
  })

  it('keeps the credits at least half opaque for two seconds or more', () => {
    for (const l of ['names', 'built', 'url'] as const) {
      const visible = Array.from({ length: LAST_T * FPS }, (_, f) => f / FPS).filter((t) => layerAlphas(t)[l] >= 0.5)
      expect(visible.length / FPS, l).toBeGreaterThanOrEqual(2)
    }
  })

  it('leaves only the lone cell, from the last cue to the final frame', () => {
    const settled = CUE_T[3] + 1
    expect(settled).toBeLessThan(TICK_T)
    for (let t = settled; t <= LAST_T + 1e-9; t += 1 / FPS) {
      const a = layerAlphas(t)
      for (const l of LAYERS) expect(a[l], `${l} at ${t}`).toBe(0)
      expect(a.cell).toBe(1)
    }
  })

  it('blinks once on the final tick and is back at rest on the last frame', () => {
    expect(blink(TICK_T - 0.01)).toBe(0)
    expect(blink(TICK_T + 0.05)).toBeCloseTo(1)
    expect(blink(LAST_T)).toBeLessThan(0.05)
    const peaks = Array.from({ length: SCENE_BARS.end * 2 * FPS }, (_, f) => blink(f / FPS)).filter((v, i, a) => v > 0.5 && v >= (a[i - 1] ?? 0) && v >= (a[i + 1] ?? 0))
    expect(peaks).toHaveLength(1)
  })
})
