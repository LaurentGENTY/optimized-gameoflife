import { describe, expect, it } from 'vitest'
import { CUES, FPS, SCENE_BARS, TOTAL_FRAMES, sceneAt, sceneStart } from '../src/timeline'

describe('timeline', () => {
  it('lasts 39 bars at 120 BPM and 60 fps: 78 s', () => {
    expect(TOTAL_FRAMES).toBe(4680)
    expect(TOTAL_FRAMES / FPS).toBe(78)
  })

  it('maps frames to scenes', () => {
    expect(sceneAt(0).id).toBe('life-in-life')
    expect(sceneAt(360).id).toBe('native')
    expect(sceneAt(4679).id).toBe('end')
  })

  it('reports time, progress and beats since the scene start', () => {
    const s = sceneAt(360 + 90)
    expect(s.t).toBeCloseTo(1.5)
    expect(s.p).toBeCloseTo(1.5 / 8)
    expect(s.beat).toBeCloseTo(3)
  })

  it('places scenes on bar boundaries: the screens run 12 s, frames 2640-3359', () => {
    expect(sceneStart('screens')).toBe(44)
    expect(SCENE_BARS.screens * 2).toBe(12)
    expect(sceneStart('curves')).toBe(56)
    expect(sceneAt(sceneStart('screens') * FPS).id).toBe('screens')
    expect(sceneAt(sceneStart('screens') * FPS - 1).id).toBe('gpu')
    expect(sceneAt(3359).id).toBe('screens')
    expect(sceneAt(3360).id).toBe('curves')
  })

  it('keeps the satellites on the four beats from the screens start', () => {
    expect(CUES.satellites).toEqual([44, 44.5, 45, 45.5])
  })

  it('derives every cue after the screens from its scene start, so a longer scene moves them all', () => {
    expect(CUES.curvesScaling).toBe(sceneStart('curves') + 4)
    expect(CUES.reversal).toBe(sceneStart('curves') + 10)
    expect(CUES.layersOff).toEqual([0, 2, 4, 6].map((d) => sceneStart('end') + d))
    expect(CUES.finalTick).toBe(sceneStart('end') + 7.5)
    expect([CUES.curvesScaling, CUES.reversal, ...CUES.layersOff, CUES.finalTick]).toEqual([60, 66, 70, 72, 74, 76, 77.5])
  })

  it('keeps every cue inside the film', () => {
    const times = Object.values(CUES).flat()
    expect(CUES.threadPlucks).toHaveLength(15)
    expect(CUES.threadPlucks[14]).toBe(31)
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(TOTAL_FRAMES / FPS)
    }
  })

  it('rejects frames outside the film', () => {
    expect(() => sceneAt(-1)).toThrow(RangeError)
    expect(() => sceneAt(TOTAL_FRAMES)).toThrow(RangeError)
  })
})
