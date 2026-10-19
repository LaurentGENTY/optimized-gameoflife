import webBench from '../../bench/web.json'
import nativeBench from '../../bench/native.json'

export type EngineId =
  | 'native-seq'
  | 'native-omp_tiled'
  | 'wasm-seq'
  | 'wasm-simd'
  | 'wasm-mt'
  | 'webgpu-naive'
  | 'webgpu-tiled'

export const ENGINES: readonly EngineId[] = [
  'native-seq',
  'native-omp_tiled',
  'wasm-seq',
  'wasm-simd',
  'wasm-mt',
  'webgpu-naive',
  'webgpu-tiled',
]

export const ENGINE_LABEL: Record<EngineId, string> = {
  'native-seq': 'Native C · sequential',
  'native-omp_tiled': 'Native C · OpenMP ×15',
  'wasm-seq': 'wasm-seq',
  'wasm-simd': 'wasm-simd · 1 thread',
  'wasm-mt': 'wasm-mt · 15 threads',
  'webgpu-naive': 'webgpu-naive',
  'webgpu-tiled': 'webgpu-tiled',
}

export const MACHINE_LABEL = 'Apple M5 Pro · 15 cores'

export interface FigureRef {
  engine: EngineId
  preset: string
  size: number
}

// Native variants are named after the C kernels; only these two appear in the film.
const NATIVE_VARIANT: Record<string, EngineId> = {
  seq: 'native-seq',
  omp_tiled: 'native-omp_tiled',
}

const key = (engine: string, preset: string, size: number): string => `${engine}/${preset}/${size}`

const figures = new Map<string, number>()

for (const row of webBench.rows) {
  if (row.status === 'ok') figures.set(key(row.engineId, row.presetId, row.size), row.gensPerSec)
}
for (const row of nativeBench.results) {
  const engine = NATIVE_VARIANT[row.variant]
  if (engine) figures.set(key(engine, row.presetId, row.size), row.gensPerSec)
}

export function gensPerSec(ref: FigureRef): number {
  const v = figures.get(key(ref.engine, ref.preset, ref.size))
  if (v === undefined || !Number.isFinite(v)) {
    throw new Error(`no bench figure for ${ref.engine}/${ref.preset}/${ref.size}`)
  }
  return v
}

const BASELINE: FigureRef = { engine: 'native-seq', preset: 'random', size: 1024 }

/** Engines ordered slowest to fastest on random/1024; drives the cold-to-hot colour ramp. */
export function speedRank(): EngineId[] {
  const at = (engine: EngineId) => gensPerSec({ engine, preset: 'random', size: 1024 })
  return [...ENGINES].sort((a, b) => at(a) - at(b))
}

export function speedup(ref: FigureRef): number {
  return gensPerSec(ref) / gensPerSec(BASELINE)
}

export function formatGps(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}
