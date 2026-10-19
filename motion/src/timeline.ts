export const BPM = 120
export const FPS = 60
export const W = 1920
export const H = 1200

export type SceneId = 'life-in-life' | 'native' | 'simd' | 'threads' | 'gpu' | 'screens' | 'curves' | 'end'

/** Scene lengths in bars, in timeline order (object key order is the playback order). */
export const SCENE_BARS: Record<SceneId, number> = {
  'life-in-life': 3,
  native: 4,
  simd: 4,
  threads: 6,
  gpu: 5,
  screens: 5,
  curves: 7,
  end: 4,
}

const BEATS_PER_BAR = 4
const FRAMES_PER_BAR = (BEATS_PER_BAR * 60 * FPS) / BPM
const SECONDS_PER_BAR = (BEATS_PER_BAR * 60) / BPM

const ORDER = Object.keys(SCENE_BARS) as SceneId[]

// Integer frame bounds avoid float drift at scene boundaries.
const START_FRAME = {} as Record<SceneId, number>
let acc = 0
for (const id of ORDER) {
  START_FRAME[id] = acc
  acc += SCENE_BARS[id] * FRAMES_PER_BAR
}

export const TOTAL_FRAMES = acc

/** Shared cue sheet in seconds from the film start: visuals and audio both sync on it. */
export const CUES: {
  reveal: number
  nativeOmp: number
  compile: number
  simdLaser: number
  threadPlucks: readonly number[]
  gpuDrop: number
  gpuTiled: number
  satellites: readonly number[]
  curvesScaling: number
  reversal: number
  layersOff: readonly number[]
  finalTick: number
} = {
  reveal: 3,
  nativeOmp: 10,
  compile: 14,
  simdLaser: 16,
  threadPlucks: Array.from({ length: 15 }, (_, i) => 24 + i * 0.5),
  gpuDrop: 38,
  gpuTiled: 41,
  satellites: [44, 44.5, 45, 45.5],
  curvesScaling: 58,
  reversal: 64,
  layersOff: [68, 70, 72, 74],
  finalTick: 75.5,
}

export function sceneStart(id: SceneId): number {
  return START_FRAME[id] / FPS
}

export function sceneAt(frame: number): { id: SceneId; t: number; p: number; beat: number } {
  if (!Number.isInteger(frame) || frame < 0 || frame >= TOTAL_FRAMES) {
    throw new RangeError(`frame must be an integer in [0, ${TOTAL_FRAMES}), got ${frame}`)
  }
  let id = ORDER[0]
  for (const candidate of ORDER) {
    if (START_FRAME[candidate] > frame) break
    id = candidate
  }
  const t = (frame - START_FRAME[id]) / FPS
  return { id, t, p: t / (SCENE_BARS[id] * SECONDS_PER_BAR), beat: (t * BPM) / 60 }
}
