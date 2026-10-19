import { describe, expect, it } from 'vitest'
import { ENGINES, ENGINE_LABEL, type EngineId, formatGps, gensPerSec, speedup } from '../src/data'
import {
  END_T,
  LABEL_GAP,
  LAZY_CAPTION,
  LAZY_T,
  REVERSAL_CAPTION,
  REVERSAL_T,
  SCALING_SIZES,
  SCALING_T,
  crossings,
  curves,
  dodge,
  logTicks,
  raceAlpha,
  raceLayout,
  raceProgress,
  scalingLayout,
  scalingProgress,
  slopeLayout,
  slopeProgress,
  speedLabel,
} from '../src/scenes/curves'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../src/timeline'

const ref = (engine: EngineId, preset: string, size: number) => ({ engine, preset, size })
const key = (r: { engine: string; preset: string; size: number }) => `${r.engine}/${r.preset}/${r.size}`
const frames = Array.from({ length: SCENE_BARS.curves * 2 * FPS }, (_, f) => f / FPS)
const WEB: EngineId[] = ['wasm-seq', 'wasm-simd', 'wasm-mt', 'webgpu-naive', 'webgpu-tiled']
const NATIVE: EngineId[] = ['native-seq', 'native-omp_tiled']

function expectApart(ys: number[], gap: number) {
  const s = [...ys].sort((a, b) => a - b)
  for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(gap - 1e-9)
}

describe('curves scene', () => {
  it('declares every figure it draws: race at 1024², scaling 512–2048², guns at 1024²', () => {
    const want = new Set([
      ...ENGINES.map((e) => key(ref(e, 'random', 1024))),
      ...[...WEB, ...NATIVE].flatMap((e) => [512, 1024, 2048].map((s) => key(ref(e, 'random', s)))),
      ...ENGINES.map((e) => key(ref(e, 'guns', 1024))),
    ])
    const got = curves.figures.map(key)
    expect(new Set(got)).toEqual(want)
    expect(got).toHaveLength(want.size)
    for (const f of curves.figures) expect(Number.isFinite(gensPerSec(f))).toBe(true)
  })

  it('sits on its cues', () => {
    expect(SCALING_T).toBe(CUES.curvesScaling - sceneStart('curves'))
    expect(REVERSAL_T).toBe(CUES.reversal - sceneStart('curves'))
    expect(END_T).toBe(SCENE_BARS.curves * 2)
    expect(SCALING_SIZES).toEqual([512, 1024, 2048])
  })

  describe('(a) the race', () => {
    it('labels every engine with its speedup over native C sequential, from the bench', () => {
      const { lines } = raceLayout()
      expect(lines.map((l) => l.engine).sort()).toEqual([...ENGINES].sort())
      for (const l of lines) {
        const sp = speedup(ref(l.engine, 'random', 1024))
        expect(l.speedup).toBe(speedLabel(sp))
        expect(l.speedup).toBe(`×${sp < 10 ? sp.toFixed(1) : Math.round(sp)}`)
      }
      expect(lines.find((l) => l.engine === 'webgpu-naive')!.speedup).toBe('×118')
    })

    it('fans out in the real speed order: the faster engine ends higher', () => {
      const { lines } = raceLayout()
      const byY = [...lines].sort((a, b) => b.end.y - a.end.y).map((l) => l.engine)
      const bySpeed = [...ENGINES].sort((a, b) => gensPerSec(ref(a, 'random', 1024)) - gensPerSec(ref(b, 'random', 1024)))
      expect(byY).toEqual(bySpeed)
      const origin = lines[0].start
      for (const l of lines) expect(l.start).toEqual(origin)
    })

    it('keeps the labels apart', () => {
      expectApart(raceLayout().lines.map((l) => l.labelY), LABEL_GAP)
    })

    it('holds the landed ×N labels fully opaque at least 2 s', () => {
      const held = frames.filter((t) => raceProgress(t) === 1 && raceAlpha(t) === 1).length / FPS
      expect(held).toBeGreaterThanOrEqual(2)
    })

    it('draws the fan on from the origin from the first frame, easing out', () => {
      expect(raceProgress(0)).toBe(0)
      expect(raceProgress(1 / FPS)).toBeGreaterThan(0)
      const p = frames.filter((t) => t < SCALING_T).map(raceProgress)
      for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1])
      expect(raceProgress(1)).toBeGreaterThan(0.5)
      expect(raceProgress(SCALING_T - 1)).toBe(1)
    })
  })

  describe('(b) scaling', () => {
    it('plots the 7 engines at 512², 1024², 2048² on log-log axes', () => {
      const { lines } = scalingLayout()
      expect(lines.map((l) => l.engine).sort()).toEqual([...ENGINES].sort())
      for (const l of lines) {
        expect(l.points).toHaveLength(3)
        // Equal steps in x for each doubling.
        expect(l.points[1].x - l.points[0].x).toBeCloseTo(l.points[2].x - l.points[1].x, 6)
        // Log y: the pixel drop between two sizes is proportional to the log of the figure ratio.
        const v = SCALING_SIZES.map((s) => gensPerSec(ref(l.engine, 'random', s)))
        const k = (l.points[1].y - l.points[0].y) / Math.log10(v[0] / v[1])
        expect((l.points[2].y - l.points[1].y) / Math.log10(v[1] / v[2])).toBeCloseTo(k, 6)
      }
    })

    it('keeps tick labels few and readable: 100, 1k, 10k, 100k', () => {
      expect(logTicks(scalingLayout().range).map((t) => t.label)).toEqual(['100', '1k', '10k', '100k'])
    })

    it('labels each line at its end without overlaps', () => {
      const { lines } = scalingLayout()
      for (const l of lines) expect(l.label).toBe(ENGINE_LABEL[l.engine])
      expectApart(lines.map((l) => l.labelY), LABEL_GAP)
    })

    it('starts drawing on the scaling cue, left to right', () => {
      expect(scalingProgress(SCALING_T)).toBe(0)
      expect(scalingProgress(SCALING_T + 1 / FPS)).toBeGreaterThan(0)
      expect(scalingProgress(REVERSAL_T - 1)).toBe(1)
    })
  })

  describe('(c) the reversal', () => {
    it('slopes from Random to Guns at 1024², every figure from the bench', () => {
      const { lines } = slopeLayout()
      expect(lines.map((l) => l.engine).sort()).toEqual([...ENGINES].sort())
      for (const l of lines) {
        expect(l.left.text).toBe(`${ENGINE_LABEL[l.engine]}  ${formatGps(gensPerSec(ref(l.engine, 'random', 1024)))}`)
        expect(l.right.text).toBe(`${formatGps(gensPerSec(ref(l.engine, 'guns', 1024)))}  ${ENGINE_LABEL[l.engine]}`)
      }
      expectApart(lines.map((l) => l.left.y), LABEL_GAP)
      expectApart(lines.map((l) => l.right.y), LABEL_GAP)
    })

    it('has wasm-simd cross both GPU lines: below them on Random, above on Guns', () => {
      const { lines } = slopeLayout()
      const at = (e: EngineId) => lines.find((l) => l.engine === e)!
      for (const gpu of ['webgpu-naive', 'webgpu-tiled'] as const) {
        expect(at('wasm-simd').a.y).toBeGreaterThan(at(gpu).a.y)
        expect(at('wasm-simd').b.y).toBeLessThan(at(gpu).b.y)
      }
      const c = crossings()
      expect(c.map((x) => x.engine).sort()).toEqual(['webgpu-naive', 'webgpu-tiled'])
      for (const x of c) {
        expect(x.s).toBeGreaterThan(0)
        expect(x.s).toBeLessThan(1)
      }
    })

    it('draws on from the reversal cue and holds both crossings at least 2 s', () => {
      expect(slopeProgress(REVERSAL_T)).toBe(0)
      expect(slopeProgress(REVERSAL_T + 1 / FPS)).toBeGreaterThan(0)
      for (const x of crossings()) {
        const shown = frames.filter((t) => slopeProgress(t) >= x.s).length / FPS
        expect(shown, x.engine).toBeGreaterThanOrEqual(2)
      }
    })

    it('captions the reversal, then lazy tiling, each on screen for 2 s', () => {
      expect(REVERSAL_CAPTION).toBe('sparse pattern: 1 CPU thread beats the GPU')
      expect(LAZY_CAPTION).toBe('lazy tiling')
      expect(LAZY_T).toBeGreaterThan(REVERSAL_T)
      expect(END_T - LAZY_T - 0.25).toBeGreaterThanOrEqual(2)
    })
  })

  it('dodge keeps each label as close to its anchor as the gaps allow, inside the bounds', () => {
    const out = dodge([0, 100, 102, 104, 200].map((y) => ({ y })), 40, 0, 220)
    // The 100/102/104 cluster centres on its anchors: 62, 102, 142.
    expect(out.map((o) => o.labelY)).toEqual([0, 62, 102, 142, 200])
    const squeezed = dodge([210, 211, 212].map((y) => ({ y })), 40, 0, 220)
    expect(squeezed.map((o) => o.labelY)).toEqual([140, 180, 220])
  })
})
