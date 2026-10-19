import { describe, expect, it } from 'vitest'
import { ENGINES, gensPerSec } from '../src/data'
import { SceneLifecycle } from '../src/lifecycle'
import { SCENES, sceneById } from '../src/scenes'
import { lifeInLife } from '../src/scenes/life-in-life'
import { MAX_TRANSITION_FRAMES, TRANSITIONS, transitionAt } from '../src/scenes/transitions'
import { type Scene } from '../src/scenes/types'
import { FPS, SCENE_BARS, type SceneId, TOTAL_FRAMES, sceneAt, sceneStart } from '../src/timeline'

describe('scene registry', () => {
  it('lists every scene of the timeline, in timeline order', () => {
    expect(SCENES.map((s) => s.id)).toEqual(Object.keys(SCENE_BARS))
    for (const id of Object.keys(SCENE_BARS) as SceneId[]) expect(sceneById(id).id).toBe(id)
  })

  it('declares only figures the bench measured', () => {
    for (const scene of SCENES) {
      for (const ref of scene.figures) {
        expect(() => gensPerSec(ref), `${scene.id}: ${ref.engine}/${ref.preset}/${ref.size}`).not.toThrow()
        expect(gensPerSec(ref)).toBeGreaterThan(0)
      }
    }
  })

  it('shows all seven engines across the film', () => {
    const shown = new Set(SCENES.flatMap((s) => s.figures.map((f) => f.engine)))
    expect([...shown].sort()).toEqual([...ENGINES].sort())
  })

  it('covers the five seeds in the screens scene', () => {
    const presets = new Set(sceneById('screens').figures.map((f) => f.preset))
    expect([...presets].sort()).toEqual(['bugs', 'clown', 'diehard', 'guns', 'random'])
  })
})

const ORDER = Object.keys(SCENE_BARS) as SceneId[]
const FRAMES_PER_BAR = 2 * FPS
const cutOf = (id: SceneId) => Math.round(sceneStart(id) * FPS)
/** The portfolio loop is the whole screens scene, frames 2640–3239. */
const LOOP = { from: cutOf('screens'), to: cutOf('curves') }

describe('scene transitions', () => {
  it('last half a second at most, each', () => {
    expect(MAX_TRANSITION_FRAMES).toBe(FPS / 2)
    for (const tr of TRANSITIONS) expect((tr.out?.frames ?? 0) + (tr.in?.frames ?? 0), tr.into).toBeLessThanOrEqual(MAX_TRANSITION_FRAMES)
  })

  it('join every pair of scenes but native → simd, whose compilation glitch is the transition', () => {
    expect(TRANSITIONS.map((tr) => tr.into)).toEqual(ORDER.slice(1).filter((id) => id !== 'simd'))
  })

  it('cut on the bar line: the outgoing effect ends on the last frame of a scene, the incoming one starts on the first', () => {
    for (const tr of TRANSITIONS) {
      const cut = cutOf(tr.into)
      expect(cut % FRAMES_PER_BAR).toBe(0)
      const prev = ORDER[ORDER.indexOf(tr.into) - 1]
      for (let f = cut - (tr.out?.frames ?? 0); f < cut; f++) {
        expect(sceneAt(f).id).toBe(prev)
        expect(transitionAt(f)).toMatchObject({ fx: tr.out!.fx, side: 'out' })
      }
      for (let f = cut; f < cut + (tr.in?.frames ?? 0); f++) {
        expect(sceneAt(f).id).toBe(tr.into)
        expect(transitionAt(f)).toMatchObject({ fx: tr.in!.fx, side: 'in' })
      }
    }
  })

  it('peak at the cut: building up to the last frame before it, decaying after it', () => {
    for (const tr of TRANSITIONS) {
      const cut = cutOf(tr.into)
      if (tr.out) {
        const a = Array.from({ length: tr.out.frames }, (_, k) => transitionAt(cut - tr.out!.frames + k)!.amount)
        for (let k = 1; k < a.length; k++) expect(a[k]).toBeGreaterThan(a[k - 1])
        expect(a[0]).toBeGreaterThan(0)
        expect(a.at(-1)).toBe(1)
      }
      if (tr.in) {
        const a = Array.from({ length: tr.in.frames }, (_, k) => transitionAt(cut + k)!.amount)
        for (let k = 1; k < a.length; k++) expect(a[k]).toBeLessThan(a[k - 1])
        expect(a[0]).toBeLessThanOrEqual(1)
        expect(a.at(-1)).toBeGreaterThan(0)
      }
    }
  })

  it('leave every other frame alone', () => {
    const inWindows = TRANSITIONS.reduce((n, tr) => n + (tr.out?.frames ?? 0) + (tr.in?.frames ?? 0), 0)
    let touched = 0
    for (let f = 0; f < TOTAL_FRAMES; f++) if (transitionAt(f)) touched++
    expect(touched).toBe(inWindows)
  })

  it('never touch the portfolio loop (frames 2640–3239)', () => {
    expect(LOOP).toEqual({ from: 2640, to: 3240 })
    for (let f = LOOP.from; f < LOOP.to; f++) expect(transitionAt(f), `frame ${f}`).toBeNull()
  })
})

/** A scene that records its prepare/dispose calls; `dispose` only when `disposable`. */
function fakeScene(id: SceneId, log: string[], disposable: boolean): Scene {
  return {
    id,
    figures: [],
    async prepare() {
      await Promise.resolve()
      log.push(`prepare ${id}`)
    },
    ...(disposable ? { dispose: () => log.push(`dispose ${id}`) } : {}),
    draw() {},
  }
}

describe('scene lifecycle', () => {
  it('prepares a scene once while rendering stays in it', async () => {
    const log: string[] = []
    const a = fakeScene('life-in-life', log, true)
    const life = new SceneLifecycle()
    for (let i = 0; i < 3; i++) await life.enter(a)
    expect(log).toEqual(['prepare life-in-life'])
  })

  it('disposes a scene once rendering moves past it, and prepares it again on a rewind', async () => {
    const log: string[] = []
    const a = fakeScene('life-in-life', log, true)
    const b = fakeScene('native', log, false)
    const life = new SceneLifecycle()
    await life.enter(a)
    await life.enter(b)
    await life.enter(b)
    await life.enter(a)
    await life.enter(b)
    expect(log).toEqual(['prepare life-in-life', 'dispose life-in-life', 'prepare native', 'prepare life-in-life', 'dispose life-in-life'])
  })

  it('keeps a scene without dispose prepared', async () => {
    const log: string[] = []
    const a = fakeScene('life-in-life', log, true)
    const b = fakeScene('native', log, false)
    const life = new SceneLifecycle()
    await life.enter(b)
    await life.enter(a)
    await life.enter(b)
    expect(log).toEqual(['prepare native', 'prepare life-in-life', 'dispose life-in-life'])
  })

  it('lets an in-flight prepare finish before disposing', async () => {
    const log: string[] = []
    const a = fakeScene('life-in-life', log, true)
    const b = fakeScene('native', log, false)
    const life = new SceneLifecycle()
    const first = life.enter(a)
    await life.enter(b)
    await first
    expect(log).toEqual(['prepare life-in-life', 'dispose life-in-life', 'prepare native'])
  })
})

describe('life-in-life memory', () => {
  it('releases its simulation on dispose and needs prepare() again before drawing', async () => {
    await lifeInLife.prepare!()
    lifeInLife.dispose!()
    await expect(lifeInLife.draw({} as CanvasRenderingContext2D, sceneAt(0))).rejects.toThrow('prepare() has not run')
  })
})
