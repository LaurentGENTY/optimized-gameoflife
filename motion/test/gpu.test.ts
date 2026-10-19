import { describe, expect, it } from 'vitest'
import { ENGINES, ENGINE_LABEL, type EngineId, formatGps, gensPerSec, speedup } from '../src/data'
import {
  DROP_T,
  GPU_SIM,
  PRE_DISPATCHES,
  TILE,
  TILES,
  TILED_T,
  gpu,
  gpuCounters,
  speedupLabel,
  speedupRef,
  tileLevel,
  tileState,
} from '../src/scenes/gpu'
import { CUES, FPS, SCENE_BARS, sceneStart } from '../src/timeline'

const NAIVE = { engine: 'webgpu-naive', preset: 'random', size: 1024 } as const
const TILED = { engine: 'webgpu-tiled', preset: 'random', size: 1024 } as const
const shown = (engine: EngineId) => formatGps(gensPerSec({ engine, preset: 'random', size: 1024 }))
const frames = Array.from({ length: SCENE_BARS.gpu * 2 * FPS }, (_, f) => f / FPS)
const N = TILES * TILES
const levels = (t: number) => Array.from({ length: N }, (_, i) => tileLevel(tileState(i, t).since))
const gens = (t: number) => Array.from({ length: N }, (_, i) => tileState(i, t).gen)
/** Fastest generation rate the CPU scenes put on screen (native OpenMP, wasm-simd, wasm-mt lanes: 0.25 s a generation). */
const CPU_MAX_GENS_PER_S = 4

describe('gpu scene', () => {
  it('declares the figures it shows, including the ×N baseline', () => {
    expect(gpu.figures).toEqual([NAIVE, TILED, { engine: 'native-seq', preset: 'random', size: 1024 }])
  })

  it('sits on its cues', () => {
    expect(DROP_T).toBe(CUES.gpuDrop - sceneStart('gpu'))
    expect(TILED_T).toBe(CUES.gpuTiled - sceneStart('gpu'))
  })

  it('tiles a 512² grid into 32×32 workgroups of 16×16 cells', () => {
    expect(TILE).toBe(16)
    expect(TILES * TILE).toBe(GPU_SIM)
    expect(GPU_SIM).toBe(512)
  })

  it('derives ×118 from the bench and names its baseline', () => {
    expect(speedupLabel()).toBe(`×${Math.round(speedup(NAIVE))}`)
    expect(speedupLabel()).toBe('×118')
    expect(speedupRef()).toBe(`vs ${ENGINE_LABEL['native-seq']}`)
  })

  describe('waves of workgroups', () => {
    it('lights tiles in waves before the drop: some lit, some dark on every frame', () => {
      for (const t of frames.filter((t) => t >= 0.1 && t < 3)) {
        const l = levels(t)
        expect(Math.min(...l), `t=${t}`).toBeLessThan(0.5)
        expect(Math.max(...l), `t=${t}`).toBeGreaterThan(0.5)
      }
    })

    it('has every tile lit on the drop frame and after it', () => {
      for (const t of frames.filter((t) => Math.round(t * FPS) >= Math.round(DROP_T * FPS))) {
        expect(Math.min(...levels(t)), `t=${t}`).toBeGreaterThanOrEqual(0.8)
      }
      const g = gens(DROP_T)
      expect(new Set(g).size).toBe(1)
    })

    it('runs one generation per frame after the drop, 15× the fastest CPU sweep', () => {
      const after = frames.filter((t) => t >= DROP_T)
      for (let k = 1; k < after.length; k++) expect(tileState(0, after[k]).gen - tileState(0, after[k - 1]).gen).toBe(1)
      expect(FPS / CPU_MAX_GENS_PER_S).toBeGreaterThanOrEqual(15)
    })

    it('is already faster than every CPU sweep before the drop', () => {
      for (let t = 0; t + 1 <= DROP_T; t += 0.5) {
        expect(tileState(0, t + 1).gen - tileState(0, t).gen, `t=${t}`).toBeGreaterThanOrEqual(2 * CPU_MAX_GENS_PER_S)
      }
      // A whole 512² generation in 0.1 s at most, where the CPU took 0.25 s for 256².
      for (const d of PRE_DISPATCHES) expect(d.dur).toBeLessThanOrEqual(0.1)
    })

    it('never lets a tile run ahead of the barrier: tiles are at most one generation apart', () => {
      for (const t of frames) {
        const g = gens(t)
        expect(Math.max(...g) - Math.min(...g), `t=${t}`).toBeLessThanOrEqual(1)
      }
    })

    it('moves its fronts: the computed share of the grid changes from frame to frame', () => {
      const fronts = new Set<number>()
      for (const t of frames.filter((t) => t < 2)) {
        const g = gens(t)
        const ahead = g.filter((v) => v > Math.min(...g)).length
        if (ahead > 0) fronts.add(ahead)
      }
      expect(fronts.size).toBeGreaterThanOrEqual(4)
    })
  })

  describe('counters', () => {
    const dropFrame = Math.round(DROP_T * FPS)
    const tiledFrame = Math.round(TILED_T * FPS)

    it('lands webgpu-naive on 22,198 exactly on the drop frame, not before', () => {
      expect(formatGps(gpuCounters(DROP_T).naive!.value)).toBe('22,198')
      expect(formatGps(gpuCounters((dropFrame - 1) / FPS).naive?.value ?? 0)).not.toBe('22,198')
      expect(gpuCounters(0).naive).toBeNull()
    })

    it('shows webgpu-tiled only from its cue, landing on 16,563 below the naive figure', () => {
      for (const t of frames.filter((t) => Math.round(t * FPS) < tiledFrame)) expect(gpuCounters(t).tiled, `t=${t}`).toBeNull()
      const end = gpuCounters(SCENE_BARS.gpu * 2 - 1 / FPS)
      expect(formatGps(end.tiled!.value)).toBe('16,563')
      expect(end.tiled!.value).toBeLessThan(end.naive!.value)
    })

    it('holds each GPU figure on screen at least 2 s', () => {
      const held = (pick: (t: number) => number | undefined, target: string) => frames.filter((t) => pick(t) !== undefined && formatGps(pick(t)!) === target).length / FPS
      expect(held((t) => gpuCounters(t).naive?.value, shown('webgpu-naive'))).toBeGreaterThanOrEqual(2)
      expect(held((t) => gpuCounters(t).tiled?.value, shown('webgpu-tiled'))).toBeGreaterThanOrEqual(2)
    })

    it('never shows another engine figure under a GPU label, even mid-roll', () => {
      for (const t of frames) {
        const { naive, tiled } = gpuCounters(t)
        for (const c of [naive, tiled]) {
          if (!c) continue
          for (const other of ENGINES) if (other !== c.engine) expect(formatGps(c.value), `t=${t} ${c.engine}`).not.toBe(shown(other))
        }
      }
    })
  })
})
