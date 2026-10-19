import { describe, expect, it } from 'vitest'
import { CUES, FPS, SCENE_BARS, TOTAL_FRAMES, sceneAt, sceneStart } from '../src/timeline'

describe('timeline', () => {
  it('lasts 38 bars at 120 BPM and 60 fps', () => {
    expect(TOTAL_FRAMES).toBe(4560)
  })

  it('maps frames to scenes', () => {
    expect(sceneAt(0).id).toBe('life-in-life')
    expect(sceneAt(360).id).toBe('native')
    expect(sceneAt(4559).id).toBe('end')
  })

  it('reports time, progress and beats since the scene start', () => {
    const s = sceneAt(360 + 90)
    expect(s.t).toBeCloseTo(1.5)
    expect(s.p).toBeCloseTo(1.5 / 8)
    expect(s.beat).toBeCloseTo(3)
  })

  it('places scenes on bar boundaries', () => {
    expect(sceneStart('screens')).toBe(44)
    expect(SCENE_BARS.screens * 2).toBe(10)
    expect(sceneAt(sceneStart('screens') * FPS).id).toBe('screens')
    expect(sceneAt(sceneStart('screens') * FPS - 1).id).toBe('gpu')
  })

  it('keeps every cue inside the film', () => {
    const times = Object.values(CUES).flat()
    expect(CUES.threadPlucks).toHaveLength(15)
    expect(CUES.threadPlucks[14]).toBe(31)
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(76)
    }
  })

  it('rejects frames outside the film', () => {
    expect(() => sceneAt(-1)).toThrow(RangeError)
    expect(() => sceneAt(TOTAL_FRAMES)).toThrow(RangeError)
  })
})
