import { type EngineId, speedRank } from '../data'

export const NIGHT = ['#05040f', '#1a1240'] as const

const STOPS: readonly [number, number, number][] = [
  [0x4c, 0xc9, 0xf0], // CPU cyan
  [0xb1, 0x4c, 0xff], // violet
  [0xff, 0x3d, 0x81], // magenta
  [0xff, 0x9e, 0x3d], // GPU orange
]

const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')

/** Cold-to-hot ramp: 0 is the slowest engine's colour, 1 the fastest's. */
export function heat(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const [a, b] = [STOPS[i], STOPS[i + 1]]
  return `#${a.map((v, k) => hex(v + (b[k] - v) * f)).join('')}`
}

let rank: EngineId[] | null = null

/** An engine keeps the same colour in every scene, set by its speed rank on random/1024. */
export function engineColor(id: EngineId): string {
  rank ??= speedRank()
  const r = rank.indexOf(id)
  if (r < 0) throw new Error(`unknown engine ${id}`)
  return heat(r / (rank.length - 1))
}
