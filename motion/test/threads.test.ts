import { describe, expect, it } from 'vitest'
import { ENGINES, formatGps, gensPerSec } from '../src/data'
import { APP_FRAMES, COUNTER_T, appFrameIndex, laneLevel, threads, threadsCounter } from '../src/scenes/threads'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../src/timeline'

const shown = (engine: (typeof ENGINES)[number]) => formatGps(gensPerSec({ engine, preset: 'random', size: 1024 }))
const frames = Array.from({ length: SCENE_BARS.threads * 2 * FPS }, (_, f) => f / FPS)

describe('threads scene', () => {
  it('declares the figures it shows', () => {
    expect(threads.figures).toEqual([
      { engine: 'wasm-mt', preset: 'random', size: 1024 },
      { engine: 'wasm-simd', preset: 'random', size: 1024 },
    ])
  })

  it('shows capture frame n = scene frame + 1, one JPG per frame of the scene', () => {
    expect(APP_FRAMES).toBe(SCENE_BARS.threads * 2 * FPS)
    frames.forEach((t, f) => expect(appFrameIndex(t)).toBe(f + 1))
  })

  it('lights lane Tk exactly on the k-th thread pluck, and keeps it lit', () => {
    expect(CUES.threadPlucks).toHaveLength(15)
    CUES.threadPlucks.forEach((cue, k) => {
      const at = cue - sceneStart('threads')
      expect(laneLevel(k, at - 1 / FPS), `T${k} before its pluck`).toBe(0)
      expect(laneLevel(k, at), `T${k} on its pluck`).toBeGreaterThan(0)
      for (const t of frames.filter((t) => t >= at + 0.1 && t < COUNTER_T)) expect(laneLevel(k, t)).toBe(1)
    })
  })

  it('shows no counter until the last lane is lit', () => {
    const last = CUES.threadPlucks[14] - sceneStart('threads')
    expect(COUNTER_T).toBeGreaterThan(last)
    for (const t of frames.filter((t) => t < COUNTER_T)) expect(threadsCounter(t)).toBeNull()
  })

  it('rolls wasm-mt from 0 to 3,644 next to the wasm-simd figure, which stays higher', () => {
    expect(threadsCounter(COUNTER_T)?.value).toBe(0)
    const end = threadsCounter(SCENE_BARS.threads * 2 - 1 / FPS)!
    expect(end.engine).toBe('wasm-mt')
    expect(formatGps(end.value)).toBe('3,644')
    expect(end.prev).toEqual({ engine: 'wasm-simd', value: gensPerSec({ engine: 'wasm-simd', preset: 'random', size: 1024 }) })
    expect(formatGps(end.prev!.value)).toBe('5,359')
  })

  it('never pairs the wasm-mt label with another engine figure, even mid-roll', () => {
    for (const t of frames) {
      const c = threadsCounter(t)
      if (!c) continue
      for (const other of ENGINES) if (other !== 'wasm-mt') expect(formatGps(c.value), `t=${t}`).not.toBe(shown(other))
    }
  })
})
