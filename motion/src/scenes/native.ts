import { type FigureRef, gensPerSec } from '../data'
import { drawCells, nightBackground, withLayer } from '../render/canvas'
import { engineColor } from '../render/palette'
import { SimTrack, seedGrid } from '../sim/track'
import { CUES, H, SCENE_BARS, W, sceneStart } from '../timeline'
import {
  CAPTION_Y,
  type CounterState,
  GRID_RECT,
  GenPair,
  ROLL_DURATION,
  SIM_SIZE,
  TRAIL,
  bands,
  beatBloom,
  caption,
  drawCounter,
  glass,
  machineLabel,
  ownFigure,
  rollValue,
  scanLines,
  smooth,
  sweepPalette,
} from './sweep'
import { type Scene } from './types'

const SEQ: FigureRef = { engine: 'native-seq', preset: 'random', size: 1024 }
const OMP: FigureRef = { engine: 'native-omp_tiled', preset: 'random', size: 1024 }

const OMP_T = CUES.nativeOmp - sceneStart('native')
const DURATION = SCENE_BARS.native * 2
// One generation per two beats sequentially; each thread then sweeps its band in an eighth note.
const SEQ_PERIOD = 1
const OMP_PERIOD = 0.25
const THREADS = 15
const SEQ_GENS = Math.round(OMP_T / SEQ_PERIOD)
/** Generation shown when the scene ends; the simd scene carries on from it. */
export const NATIVE_END_GEN = SEQ_GENS + Math.round((DURATION - OMP_T) / OMP_PERIOD)
const GAP = 9
const SPLIT_TIME = 0.35

const ONE_BAND = bands(SIM_SIZE, 1)
const OMP_BANDS = bands(SIM_SIZE, THREADS)

export function nativeSweep(t: number): { gen: number; f: number; bands: number } {
  if (t < OMP_T) {
    const x = t / SEQ_PERIOD
    return { gen: Math.floor(x), f: x - Math.floor(x), bands: 1 }
  }
  const x = (t - OMP_T) / OMP_PERIOD
  return { gen: SEQ_GENS + Math.floor(x), f: x - Math.floor(x), bands: THREADS }
}

export function nativeCounter(t: number): CounterState {
  const seq = gensPerSec(SEQ)
  if (t < OMP_T) return { engine: 'native-seq', value: ownFigure(SEQ.engine, rollValue(0, seq, t, 0)) }
  // Rolls up from 0, not from 188: the new label must never sit over the old engine's figure.
  return { engine: 'native-omp_tiled', value: ownFigure(OMP.engine, rollValue(0, gensPerSec(OMP), t, OMP_T)), prev: { engine: 'native-seq', value: seq } }
}

let pair: GenPair | null = null
const shown = new Uint8Array(SIM_SIZE * SIM_SIZE)
const cut = new Int32Array(SIM_SIZE)
/** Per row: 0 not swept, 1 being swept, d + 1 swept d rows ago (afterglow), TRAIL + 2 swept long ago. */
const rowState = new Uint8Array(SIM_SIZE)
let sharp: HTMLCanvasElement | null = null

export const native: Scene = {
  id: 'native',
  figures: [SEQ, OMP],
  draw(ctx, s) {
    const { t } = s
    pair ??= new GenPair(new SimTrack(() => seedGrid('random', SIM_SIZE)), SIM_SIZE)
    const sw = nativeSweep(t)
    const list = sw.bands === 1 ? ONE_BAND : OMP_BANDS
    const engine = sw.bands === 1 ? SEQ.engine : OMP.engine
    const pal = sweepPalette(engineColor(engine))

    // Rows above each band's scan line already hold the next generation.
    const lines: number[] = []
    for (const [r0, r1] of list) {
      const pos = r0 + sw.f * (r1 - r0)
      const hot = Math.floor(pos)
      lines.push(pos)
      for (let y = r0; y < r1; y++) {
        cut[y] = y <= hot ? SIM_SIZE : 0
        rowState[y] = y > hot ? 0 : y === hot ? 1 : Math.min(TRAIL + 2, hot - y + 1)
      }
    }
    pair.at(sw.gen).compose(shown, cut)
    const colors = [pal.pending, pal.hot, ...pal.trail, pal.done]

    // Sharp dots drawn once off screen, then sliced into bands that drift apart on the OpenMP cue.
    sharp ??= Object.assign(document.createElement('canvas'), { width: W, height: H })
    const sctx = sharp.getContext('2d')!
    sctx.reset()
    drawCells(sctx, { size: SIM_SIZE, cells: shown }, GRID_RECT, {
      color: (_u, v) => colors[rowState[Math.floor(v * SIM_SIZE)]],
      bloom: 0,
    })
    const gap = sw.bands === 1 ? 0 : GAP * (1 - (1 - smooth(OMP_T, OMP_T + SPLIT_TIME, t)) ** 2)
    const spread = gap * (list.length - 1)
    const ch = GRID_RECT.h / SIM_SIZE
    const offset = (i: number) => i * gap - spread / 2
    const paintBands = (l: CanvasRenderingContext2D) => {
      list.forEach(([r0, r1], i) => {
        const sy = GRID_RECT.y + r0 * ch
        const sh = (r1 - r0) * ch
        l.drawImage(sharp!, GRID_RECT.x - 4, sy, GRID_RECT.w + 8, sh, GRID_RECT.x - 4, sy + offset(i), GRID_RECT.w + 8, sh)
      })
    }

    nightBackground(ctx)
    glass(ctx, { x: GRID_RECT.x - 18, y: GRID_RECT.y - 18 - spread / 2, w: GRID_RECT.w + 36, h: GRID_RECT.h + 36 + spread })
    // Same two-radius bloom as drawCells, applied once to the whole banded image.
    const bloom = beatBloom(s.beat)
    withLayer(ctx, paintBands, { filter: `blur(${Math.max(8, ch * 4)}px)`, alpha: Math.min(1, bloom * 0.6), op: 'lighter' })
    withLayer(ctx, paintBands, { filter: `blur(${Math.max(2, ch * 0.8)}px)`, alpha: Math.min(1, bloom * 0.8), op: 'lighter' })
    withLayer(ctx, paintBands, { op: 'lighter' })
    const ys = lines.map((pos, i) => GRID_RECT.y + pos * ch + offset(i))
    scanLines(ctx, ys, GRID_RECT.x - 10, GRID_RECT.x + GRID_RECT.w + 10, pal.done, sw.bands === 1 ? 1 : 0.85)

    const counter = nativeCounter(t)
    const landed = (counter.prev ? OMP_T : 0) + ROLL_DURATION
    drawCounter(ctx, counter, engineColor, {
      glow: t >= landed ? Math.exp(-(t - landed) * 5) : 0,
      prevAlpha: smooth(OMP_T, OMP_T + 0.4, t),
    })
    caption(ctx, '2020 · native C · 1024²', GRID_RECT.x + 26, CAPTION_Y)
    machineLabel(ctx)
  },
}

