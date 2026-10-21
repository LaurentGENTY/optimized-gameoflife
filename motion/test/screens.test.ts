import { describe, expect, it } from 'vitest'
import { ENGINES, ENGINE_LABEL, formatGps, gensPerSec } from '../src/data'
import {
  BEAT_FRAMES,
  CENTER,
  DIEHARD_CAPTION,
  ENTRANCE_T,
  ENTRANCE_ZOOM,
  FLICKER,
  GAP,
  GLOBAL_CAPTION,
  LOOP_T,
  MOVE_T,
  RATE,
  SATS,
  SCENE_T,
  SCREENS,
  SPARK_T,
  camera,
  cellsRect,
  composition,
  numberRows,
  perimeterPoint,
  screenLayers,
  screenLines,
  screens,
  viewOf,
} from '../src/scenes/screens'
import { SimTrack, seedGrid } from '../src/sim/track'
import { CUES, FPS, H, SCENE_BARS, W, sceneStart } from '../src/timeline'

const PRESETS = ['random', 'guns', 'bugs', 'clown', 'diehard'] as const
const SCENE_FRAMES = SCENE_BARS.screens * 2 * FPS
const HOLD = { from: ENTRANCE_T * FPS, to: SCENE_FRAMES }
const holdFrames = Array.from({ length: HOLD.to - HOLD.from }, (_, k) => HOLD.from + k)
const sceneFrames = Array.from({ length: SCENE_FRAMES }, (_, f) => f)
const T = (f: number) => f / FPS
/** What a screen shows, as the generations it blends and their weights. */
const visible = (i: number, t: number) => screenLayers(SCREENS[i], t)
const strongest = (i: number, t: number) => [...visible(i, t)].sort((a, b) => b.w - a.w)[0].gen
const arrival = (k: number) => CUES.satellites[k] - sceneStart('screens')
const centreOf = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

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

  it('runs a 2 s entrance, then the 10 s hold that is the portfolio loop', () => {
    expect(SCENE_T).toBe(12)
    expect(ENTRANCE_T).toBe(2)
    expect(LOOP_T).toBe(10)
    expect(Number.isInteger(RATE * LOOP_T)).toBe(true)
    expect(sceneStart('screens') * FPS + HOLD.from).toBe(2760)
    expect(sceneStart('screens') * FPS + HOLD.to - 1).toBe(3359)
  })

  describe('layout', () => {
    it('packs a 760 px centre and four 368 px satellites with 24 px gaps', () => {
      expect([CENTER.w, CENTER.h]).toEqual([760, 760])
      for (const r of SATS) expect([r.w, r.h]).toEqual([368, 368])
      expect(GAP).toBe(24)
      const [guns, bugs, clown, diehard] = SATS
      expect(CENTER.x - (guns.x + guns.w)).toBe(GAP)
      expect(bugs.x - (CENTER.x + CENTER.w)).toBe(GAP)
      expect(clown.y - (guns.y + guns.h)).toBe(GAP)
      expect(diehard.y - (bugs.y + bugs.h)).toBe(GAP)
      expect([guns.y, bugs.y]).toEqual([CENTER.y, CENTER.y])
      expect(clown.y + clown.h).toBe(CENTER.y + CENTER.h)
      expect([clown.x, diehard.x]).toEqual([guns.x, bugs.x])
    })

    it('centres the block in the frame, under the caption', () => {
      const left = SATS[0].x
      const right = SATS[1].x + SATS[1].w
      expect(left).toBe(W - right)
      expect(CENTER.y + CENTER.h / 2).toBe(H / 2)
      expect(CENTER.y).toBeGreaterThan(140)
    })

    it('draws the cells inside the glass', () => {
      for (const r of [CENTER, ...SATS]) expect(inside(cellsRect(r), r)).toBe(true)
    })
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

    it('lays each figure next to its own label in the tile pill, label first', () => {
      SCREENS.forEach((s, i) => {
        const rows = numberRows(s, i === 0)
        const text = rows.map((r) => r.map((c) => c.s).join('|'))
        const [simd, gpu] = screenLines(s).figures
        // The centre has room for one row an engine; on a 368 px satellite the wasm-simd label wraps after its dot.
        if (i === 0) expect(text).toEqual([`${simd.label}|${simd.figure}`, `${gpu.label}|${gpu.figure}`])
        else expect(text).toEqual(['wasm-simd ·|' + simd.figure, '1 thread', `${gpu.label}|${gpu.figure}`])
        // Wrapped or not, the label reads exactly as ENGINE_LABEL.
        if (i > 0) expect(`${rows[0][0].s} ${rows[1][0].s}`).toBe(simd.label)
        for (const c of rows.flat()) expect(c.size).toBeGreaterThanOrEqual(28)
      })
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

    it('keeps every text fully on screen through the hold: nothing enters or leaves the loop', () => {
      for (const f of holdFrames) {
        const c = composition(T(f))
        expect(c.caption, `f=${f}`).toBe(1)
        expect(c.footer, `f=${f}`).toBe(1)
        for (const tile of c.tiles) expect(tile.labels, `f=${f}`).toBe(1)
      }
    })

    it('brings the captions in during the entrance', () => {
      const c = composition(0)
      expect(c.caption).toBe(0)
      expect(c.footer).toBe(0)
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
      for (const f of sceneFrames) {
        const layers = visible(i, T(f))
        expect(layers).toHaveLength(1)
        expect(layers[0].gen).toBe(Math.floor((f * RATE) / FPS) % 130)
      }
    })

    it('advances at most one generation per frame, at the same rate on every screen', () => {
      SCREENS.forEach((s, i) => {
        for (let f = 1; f < SCENE_FRAMES; f++) {
          const step = strongest(i, T(f)) - strongest(i, T(f - 1))
          // A restart (or the loop crossfade taking over) goes back; otherwise 0 or 1 generation.
          if (step >= 0) expect(step, `${s.preset} f=${f}`).toBeLessThanOrEqual(1)
        }
      })
    })

    it('animates every screen: its cells change within every second of the scene', () => {
      SCREENS.forEach((s, i) => {
        const track = new SimTrack(() => seedGrid(s.preset, s.size))
        const cellsAt = (t: number) => Array.from(track.at(strongest(i, t)).cells).join('')
        for (let t = 0; t + 1 <= SCENE_T; t += 1) {
          expect(cellsAt(t + 1) === cellsAt(t) && cellsAt(t + 0.5) === cellsAt(t), `${s.preset} static from t=${t}`).toBe(false)
        }
      })
    })

    it('crossfades with weights summing to 1, or fades out before a restart on the seed', () => {
      SCREENS.forEach((s, i) => {
        for (const f of sceneFrames) {
          const layers = visible(i, T(f))
          const sum = layers.reduce((a, l) => a + l.w, 0)
          if (s.g0 > 0) expect(sum, s.preset).toBeCloseTo(1, 9)
          else expect(sum, s.preset).toBeLessThanOrEqual(1)
          for (const l of layers) expect(l.gen).toBeGreaterThanOrEqual(0)
        }
      })
    })

    it('closes the loop: the hold repeats generation by generation, so its last frame leads into its first', () => {
      SCREENS.forEach((s, i) => {
        for (const f of holdFrames) expect(visible(i, T(f + LOOP_T * FPS)), `${s.preset} f=${f}`).toEqual(visible(i, T(f)))
        // The frame after the hold's last one is the hold's first one again.
        const step = strongest(i, T(HOLD.to)) - strongest(i, T(HOLD.to - 1))
        if (step >= 0) expect(step, s.preset).toBeLessThanOrEqual(1)
        expect(visible(i, T(HOLD.to))).toEqual(visible(i, T(HOLD.from)))
      })
    })
  })

  describe('entrance', () => {
    it('starts full-frame on Random and pulls back to the whole block by the end of the entrance', () => {
      const c0 = camera(0)
      expect(c0.zoom).toBeCloseTo(ENTRANCE_ZOOM, 9)
      expect(ENTRANCE_ZOOM).toBeGreaterThan(2.5)
      expect(ENTRANCE_ZOOM).toBeLessThan(2.7)
      // Random's cells cover the whole frame on the first frame: the GPU's dive lands on them.
      const r = cellsRect(CENTER)
      const map = (x: number, y: number) => ({ x: W / 2 + c0.x + c0.zoom * (x - W / 2), y: H / 2 + c0.y + c0.zoom * (y - H / 2) })
      const tl = map(r.x, r.y)
      const br = map(r.x + r.w, r.y + r.h)
      expect(tl.x).toBeLessThanOrEqual(0)
      expect(tl.y).toBeLessThanOrEqual(0)
      expect(br.x).toBeGreaterThanOrEqual(W)
      expect(br.y).toBeGreaterThanOrEqual(H)
      for (let f = 1; f <= HOLD.from; f++) expect(camera(T(f)).zoom, `f=${f}`).toBeLessThan(camera(T(f - 1)).zoom + 0.02)
      expect(camera(ENTRANCE_T).zoom).toBe(1)
      expect([camera(ENTRANCE_T).x, camera(ENTRANCE_T).y]).toEqual([0, 0])
    })

    it('brings each satellite out from behind the centre, arriving on its cue after a small bounce', () => {
      SATS.forEach((final, k) => {
        const A = arrival(k)
        const start = Math.round((A - MOVE_T) * FPS)
        const at = (f: number) => composition(T(f)).tiles[k + 1]
        if (start > 0) expect(at(start - 1).alpha, `satellite ${k} before its move`).toBe(0)
        // Behind the centre when it sets off.
        if (start >= 0) expect(inside(at(start).rect, CENTER), `satellite ${k} starts behind the centre`).toBe(true)
        expect(at(Math.round(A * FPS)).rect).toEqual(final)
        // A small bounce: it overshoots its spot by 2-10 % of the way, then settles on the cue.
        const way = Math.hypot(centreOf(final).x - centreOf(CENTER).x, centreOf(final).y - centreOf(CENTER).y)
        let far = 0
        for (let f = Math.max(0, start); f <= Math.round(A * FPS); f++) {
          const c = centreOf(at(f).rect)
          far = Math.max(far, Math.hypot(c.x - centreOf(CENTER).x, c.y - centreOf(CENTER).y))
        }
        if (k > 0) {
          expect(far / way, `satellite ${k}`).toBeGreaterThan(1.02)
          expect(far / way, `satellite ${k}`).toBeLessThan(1.1)
        }
        for (let f = Math.round(A * FPS); f < SCENE_FRAMES; f++) expect(at(f).rect).toEqual(final)
      })
    })

    it('lights each satellite like a neon tube on its cue: two short blinks, then steady', () => {
      expect(FLICKER.length / FPS).toBeLessThan(0.4)
      SATS.forEach((_, k) => {
        const a = Math.round(arrival(k) * FPS)
        const lit = (f: number) => composition(T(f)).tiles[k + 1].lit
        if (a > 0) expect(lit(a - 1)).toBe(0)
        const run = Array.from({ length: FLICKER.length }, (_, j) => lit(a + j))
        expect(run[0]).toBeGreaterThan(0.5)
        let blinks = 0
        for (let j = 1; j < run.length; j++) if (run[j] === 0 && run[j - 1] > 0) blinks++
        expect(blinks, `satellite ${k}`).toBe(2)
        for (let f = a + FLICKER.length; f < SCENE_FRAMES; f++) expect(lit(f)).toBe(1)
      })
    })

    it('runs a spark once around each satellite from its cue, and links it to the centre while it travels', () => {
      SATS.forEach((_, k) => {
        const A = arrival(k)
        const tile = (t: number) => composition(t).tiles[k + 1]
        const sparks = sceneFrames.map((f) => tile(T(f)).spark)
        const lit = sceneFrames.filter((f) => sparks[f] !== null)
        expect(lit[0]).toBe(Math.max(0, Math.round(A * FPS)))
        expect(lit.length).toBeLessThanOrEqual(Math.round(SPARK_T * FPS) + 1)
        for (let j = 1; j < lit.length; j++) {
          expect(lit[j]).toBe(lit[j - 1] + 1)
          expect(sparks[lit[j]]!).toBeGreaterThan(sparks[lit[j - 1]]!)
        }
        if (A - MOVE_T / 2 > 0) expect(tile(A - MOVE_T / 2).link).toBeGreaterThan(0.2)
        expect(tile(A).link).toBe(0)
      })
    })

    it('ends every entrance effect by the hold: no spark, link, blur or ignition left in the loop', () => {
      for (const f of holdFrames) {
        for (const tile of composition(T(f)).tiles) {
          expect(tile.spark).toBeNull()
          expect(tile.link).toBe(0)
          expect(tile.blur).toBe(0)
          expect(tile.alpha).toBe(1)
          expect(tile.lit).toBe(1)
        }
      }
    })
  })

  describe('the hold is the loop', () => {
    it('repeats exactly every 10 s: camera, tiles, neon, sweeps and the background bokeh', () => {
      for (const f of holdFrames) expect(composition(T(f + LOOP_T * FPS)), `f=${f}`).toEqual(composition(T(f)))
    })

    it('drifts the camera, so the hold is not a still', () => {
      const xs = holdFrames.map((f) => camera(T(f)).x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10)
    })

    it('pulses the neon borders on every beat with an exponential decay', () => {
      expect(BEAT_FRAMES).toBe(30)
      for (const f of holdFrames) {
        const n = composition(T(f)).tiles[0].neon
        const phase = (f - HOLD.from) % BEAT_FRAMES
        if (phase === 0) expect(n, `f=${f}`).toBeCloseTo(composition(T(HOLD.from)).tiles[0].neon, 12)
        else expect(n, `f=${f}`).toBeLessThan(composition(T(f - 1)).tiles[0].neon)
      }
    })

    it('sweeps the glass at most once per tile in the loop', () => {
      for (let i = 0; i < 5; i++) {
        const on = holdFrames.map((f) => composition(T(f)).tiles[i].sheen !== null)
        const starts = on.filter((v, j) => v && (j === 0 || !on[j - 1])).length
        expect(starts, `tile ${i}`).toBeLessThanOrEqual(1)
        expect(on[0] && on.at(-1), `tile ${i} sweeps across the seam`).toBe(false)
      }
    })
  })

  describe('spark path', () => {
    it('runs along the rounded glass edge and closes on itself', () => {
      const r = { x: 100, y: 200, w: 368, h: 368 }
      const radius = 18
      const p0 = perimeterPoint(r, radius, 0)
      const p1 = perimeterPoint(r, radius, 1)
      expect(p1.x).toBeCloseTo(p0.x, 9)
      expect(p1.y).toBeCloseTo(p0.y, 9)
      let prev = p0
      for (let k = 1; k <= 400; k++) {
        const p = perimeterPoint(r, radius, k / 400)
        // On the edge: within the box, and on one of its sides or corner arcs.
        expect(p.x).toBeGreaterThanOrEqual(r.x - 1e-9)
        expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1e-9)
        const side = Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.w), Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.h))
        const cx = Math.min(Math.max(p.x, r.x + radius), r.x + r.w - radius)
        const cy = Math.min(Math.max(p.y, r.y + radius), r.y + r.h - radius)
        const arc = Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius)
        expect(Math.min(side, arc)).toBeLessThan(1e-6)
        // Even speed: equal steps of s cover equal lengths.
        expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(((4 * 368) / 400) * 1.01)
        prev = p
      }
    })
  })
})
