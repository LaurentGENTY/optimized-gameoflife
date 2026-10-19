import { describe, expect, it } from 'vitest'
import { ENGINES, ENGINE_LABEL, formatGps, gensPerSec } from '../src/data'
import {
  DIEHARD_CAPTION,
  GLOBAL_CAPTION,
  LOOP_T,
  RATE,
  SCREENS,
  drift,
  satellitePulse,
  screenLayers,
  screenLines,
  screens,
  viewOf,
} from '../src/scenes/screens'
import { SimTrack, seedGrid } from '../src/sim/track'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../src/timeline'

const PRESETS = ['random', 'guns', 'bugs', 'clown', 'diehard'] as const
const LAST = SCENE_BARS.screens * 2 * FPS - 1
const frames = Array.from({ length: LAST + 1 }, (_, f) => f / FPS)
const frameAt = (t: number) => Math.round(t * FPS)
/** What a screen shows, as the generations it blends and their weights. */
const visible = (i: number, t: number) => screenLayers(SCREENS[i], t)
const strongest = (i: number, t: number) => [...visible(i, t)].sort((a, b) => b.w - a.w)[0].gen

describe('screens scene', () => {
  it('declares wasm-simd and webgpu-naive at 1024² for each of the five seeds', () => {
    expect(screens.figures).toEqual(
      PRESETS.flatMap((preset) => [
        { engine: 'wasm-simd', preset, size: 1024 },
        { engine: 'webgpu-naive', preset, size: 1024 },
      ]),
    )
  })

  it('puts Random in the centre and the satellites in cue order: guns, bugs, clown, diehard', () => {
    expect(SCREENS.map((s) => s.preset)).toEqual(PRESETS)
    expect(SCREENS.map((s) => s.size)).toEqual([256, 256, 256, 128, 128])
    expect(CUES.satellites).toHaveLength(4)
  })

  it('loops over exactly the 10 s of the scene', () => {
    expect(LOOP_T).toBe(SCENE_BARS.screens * 2)
    expect(Number.isInteger(RATE * LOOP_T)).toBe(true)
  })

  describe('labels', () => {
    it('shows each seed with its two figures, straight from the bench', () => {
      SCREENS.forEach((s) => {
        const simd = formatGps(gensPerSec({ engine: 'wasm-simd', preset: s.preset, size: 1024 }))
        const gpu = formatGps(gensPerSec({ engine: 'webgpu-naive', preset: s.preset, size: 1024 }))
        expect(screenLines(s).figures).toEqual([
          { label: ENGINE_LABEL['wasm-simd'], figure: simd },
          { label: ENGINE_LABEL['webgpu-naive'], figure: gpu },
        ])
        expect(screenLines(s).units).toBe('gen/s · 1024²')
      })
      expect(screenLines(SCREENS[4]).figures[0]).toEqual({ label: 'wasm-simd · 1 thread', figure: '381,473' })
      expect(screenLines(SCREENS[0]).figures[1]).toEqual({ label: 'webgpu-naive', figure: '22,198' })
    })

    it('never shows another engine figure under a label (ten distinct, own figures)', () => {
      for (const s of SCREENS) {
        for (const [k, engine] of (['wasm-simd', 'webgpu-naive'] as const).entries()) {
          const shown = screenLines(s).figures[k].figure
          for (const other of ENGINES) {
            if (other === engine) continue
            const theirs = (() => {
              try {
                return formatGps(gensPerSec({ engine: other, preset: s.preset, size: 1024 }))
              } catch {
                return null
              }
            })()
            expect(shown, `${s.preset} ${engine}`).not.toBe(theirs)
          }
        }
      }
    })

    it('explains the sparse figures: one scene caption and one under Diehard', () => {
      expect(GLOBAL_CAPTION).toBe('sparse seeds: lazy tiling skips inactive tiles')
      expect(DIEHARD_CAPTION.join(' ')).toBe('board dies at gen 130 — lazy tiling skips empty tiles')
    })

    it('tells the truth about Diehard: its 128² board is empty from generation 130', () => {
      const track = new SimTrack(() => seedGrid('diehard', 128))
      expect(track.at(129).cells.some((c) => c !== 0)).toBe(true)
      expect(track.at(130).cells.every((c) => c === 0)).toBe(true)
    })

    it('keeps the same text on every frame: nothing enters or leaves during the loop', () => {
      const first = SCREENS.map((s) => screenLines(s))
      for (const t of frames.filter((_, f) => f % 37 === 0)) expect(SCREENS.map((s) => screenLines(s)), `t=${t}`).toEqual(first)
    })
  })

  describe('simulations', () => {
    it('crops Clown and Diehard to a window that never cuts off a live cell', () => {
      for (const s of SCREENS.filter((s) => s.view)) {
        const track = new SimTrack(() => seedGrid(s.preset, s.size))
        for (let g = 0; g < s.g0 + s.cycle; g++) {
          const all = track.at(g).cells.reduce((a, c) => a + c, 0)
          const shown = viewOf(s, track.at(g)).cells.reduce((a, c) => a + c, 0)
          expect(shown, `${s.preset} gen ${g}`).toBe(all)
        }
      }
    })

    it('frames Clown and Diehard tightly: the cells they reach over a cycle span 3/4 of the window', () => {
      for (const s of SCREENS.filter((s) => s.view)) {
        const track = new SimTrack(() => seedGrid(s.preset, s.size))
        const xs = new Set<number>()
        const ys = new Set<number>()
        for (let g = 0; g < s.g0 + s.cycle; g++) {
          const v = viewOf(s, track.at(g))
          v.cells.forEach((c, i) => {
            if (!c) return
            xs.add(i % v.size)
            ys.add(Math.floor(i / v.size))
          })
        }
        const span = Math.max(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1)
        expect(span / s.view!.size, s.preset).toBeGreaterThanOrEqual(0.75)
      }
    })

    it('restarts Diehard every 130 generations', () => {
      const i = SCREENS.findIndex((s) => s.preset === 'diehard')
      for (const t of frames) {
        const layers = visible(i, t)
        expect(layers).toHaveLength(1)
        expect(layers[0].gen).toBe(Math.floor((frameAt(t) * RATE) / FPS) % 130)
      }
    })

    it('advances at most one generation per frame, at the same rate on every screen', () => {
      SCREENS.forEach((s, i) => {
        for (let f = 1; f <= LAST; f++) {
          const step = strongest(i, f / FPS) - strongest(i, (f - 1) / FPS)
          // A restart (or the loop crossfade taking over) goes back; otherwise 0 or 1 generation.
          if (step >= 0) expect(step, `${s.preset} f=${f}`).toBeLessThanOrEqual(1)
        }
      })
    })

    it('animates every screen: its cells change within every second of the scene', () => {
      SCREENS.forEach((s, i) => {
        const track = new SimTrack(() => seedGrid(s.preset, s.size))
        const cellsAt = (t: number) => Array.from(track.at(strongest(i, t)).cells).join('')
        for (let t = 0; t + 1 <= LOOP_T; t += 1) {
          expect(cellsAt(t + 1) === cellsAt(t) && cellsAt(t + 0.5) === cellsAt(t), `${s.preset} static from t=${t}`).toBe(false)
        }
      })
    })

    it('crossfades with weights summing to 1, or fades out before a restart on the seed', () => {
      SCREENS.forEach((s, i) => {
        for (const t of frames) {
          const layers = visible(i, t)
          const sum = layers.reduce((a, l) => a + l.w, 0)
          if (s.g0 > 0) expect(sum, s.preset).toBeCloseTo(1, 9)
          else expect(sum, s.preset).toBeLessThanOrEqual(1)
          for (const l of layers) expect(l.gen).toBeGreaterThanOrEqual(0)
        }
      })
    })

    it('closes the loop: the last frame leads into the first, generation by generation', () => {
      SCREENS.forEach((s, i) => {
        const first = visible(i, 0)
        expect(first, s.preset).toEqual([{ gen: s.g0, w: 1 }])
        const last = strongest(i, LAST / FPS)
        if (s.g0 > 0) {
          // Crossfaded screens: the incoming layer is one generation before the first frame's.
          expect(last, s.preset).toBe(s.g0 - 1)
        } else {
          // Restarting screens end their last cycle and start again on the seed, as they do mid-scene.
          expect(last, s.preset).toBe(s.cycle - 1)
        }
      })
    })
  })

  describe('composition loop', () => {
    it('drifts the camera on a 10 s period, so the last frame sits next to the first', () => {
      const a = drift(0)
      const b = drift(LAST / FPS)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1)
      expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.001)
      // It does move.
      const far = drift(LOOP_T / 4)
      expect(Math.hypot(far.x - a.x, far.y - a.y)).toBeGreaterThan(8)
    })

    it('pulses satellite k on its cue frame, and the pulse wraps across the loop seam', () => {
      CUES.satellites.forEach((cue, k) => {
        const at = cue - sceneStart('screens')
        expect(satellitePulse(k, at), `satellite ${k} on its cue`).toBeCloseTo(1, 6)
        expect(satellitePulse(k, at + 1)).toBeLessThan(0.2)
      })
      for (let k = 0; k < 4; k++) {
        expect(Math.abs(satellitePulse(k, LAST / FPS) - satellitePulse(k, 0)), `satellite ${k} at the seam`).toBeLessThan(0.1)
      }
      // At rest away from the cues: the second half of the loop is calm.
      for (const t of frames.filter((t) => t > 4 && t < LOOP_T - 0.5)) {
        for (let k = 0; k < 4; k++) expect(satellitePulse(k, t)).toBeLessThan(0.01)
      }
    })
  })
})
