// Scene 8: the end card echoes the opening. The title and credits sit around one cell, inside a
// pulsar; the music's layers stop at CUES.layersOff and each stop dims one element, until the
// single cell remains and blinks once on the last tick.
import { type Grid } from '../../../web/src/grid'
import { drawCells, nightBackground, text } from '../render/canvas'
import { heat } from '../render/palette'
import { lifeStep } from '../sim/life'
import { CUES, H, W, sceneStart } from '../timeline'
import { beatBloom, clamp01, mix, smooth } from './sweep'
import { type Scene } from './types'

export const TITLE = 'Optimized Game of Life'
export const SUBTITLE = 'Life, simulated by Life'
/** Credits copy, exact (Global Constraints). */
export const CREDITS = {
  names: 'Laurent Genty · Clément Bertin · Emeric Duchemin',
  built: 'Built on easypap by Raymond Namyst',
  url: 'laurentgenty.github.io/optimized-gameoflife',
} as const

const START = sceneStart('end')
/** Cue times in seconds since the scene start: lead, bass, hats, kick. */
export const CUE_T = CUES.layersOff.map((c) => c - START)
export const TICK_T = CUES.finalTick - START

const CENTER = { x: W / 2, y: H / 2 }
const FADE_IN = 0.5
/**
 * Ring-out of each stop, in seconds. The first cue is the scene start, so a layer dimmed at a
 * cue must stay legible for a while after it: the lead and bass ring out, the kick cuts short.
 */
const RING_OUT = [1.5, 1.6, 1.6, 1.0] as const

export type Layer = 'pulsar' | 'url' | 'built' | 'names' | 'title'

/** Which layer each music stop dims: the lead (cue 0) takes the pulsar, the kick (cue 3) the title and the demo URL. */
export const CUE_LAYERS: readonly (readonly Layer[])[] = [['pulsar'], ['built'], ['names'], ['title', 'url']]

/** Brightness pulse of the lone cell on the last tick: sharp attack, exponential release. */
export function blink(t: number): number {
  const u = t - TICK_T
  if (u < 0) return 0
  return u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) * 9)
}

const fadeIn = (t: number, delay: number) => smooth(delay, delay + FADE_IN, t)

/** Opacity of every element at scene time `t` (seconds). The lone cell is never dimmed. */
export function layerAlphas(t: number): Record<Layer | 'cell', number> {
  const off = (k: number) => 1 - smooth(CUE_T[k], CUE_T[k] + RING_OUT[k], t)
  return {
    pulsar: off(0),
    built: fadeIn(t, 0.1) * off(1),
    names: fadeIn(t, 0) * off(2),
    url: fadeIn(t, 0.1) * off(3),
    title: fadeIn(t, 0) * off(3),
    cell: 1,
  }
}

// 13×13 pulsar (period 3) in a 17×17 field; its centre is empty, which is where the lone cell sits.
const PULSAR = [
  '..OOO...OOO..',
  '.............',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '..OOO...OOO..',
  '.............',
  '..OOO...OOO..',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '.............',
  '..OOO...OOO..',
]
const FIELD = 17
const PITCH = 20
const PULSAR_PERIOD = 3

/** The three phases of the pulsar, built from the real rules on first use. */
let phases: Grid[] | null = null
function pulsarPhase(i: number): Grid {
  if (!phases) {
    const g: Grid = { size: FIELD, cells: new Uint8Array(FIELD * FIELD) }
    const o = (FIELD - 13) / 2
    PULSAR.forEach((row, y) => [...row].forEach((c, x) => (g.cells[(y + o) * FIELD + x + o] = c === 'O' ? 1 : 0)))
    phases = [g]
    for (let k = 1; k < PULSAR_PERIOD; k++) phases.push(lifeStep(phases[k - 1]))
  }
  return phases[i % PULSAR_PERIOD]
}

const CELL_COLOR = mix(heat(0.62), '#ffffff', 0.35)
const CELL_PX = 44

function drawLoneCell(ctx: CanvasRenderingContext2D, flash: number): void {
  const one: Grid = { size: 1, cells: Uint8Array.of(1) }
  const rect = (px: number) => ({ x: CENTER.x - px / 2, y: CENTER.y - px / 2, w: px, h: px })
  const bloom = 1 + 0.6 * flash
  drawCells(ctx, one, rect(CELL_PX), { color: () => CELL_COLOR, bloom, dim: 0.8 + 0.2 * flash })
  if (flash > 0.01) drawCells(ctx, one, rect(CELL_PX * (1 + 0.8 * flash)), { color: () => '#ffffff', bloom: 0.9, dim: 0.5 * flash })
}

function drawPulsar(ctx: CanvasRenderingContext2D, alpha: number, beat: number): void {
  if (alpha <= 0) return
  const side = FIELD * PITCH
  drawCells(ctx, pulsarPhase(Math.floor(beat)), { x: CENTER.x - side / 2, y: CENTER.y - side / 2, w: side, h: side }, {
    color: (u, v) => heat(0.06 + 0.88 * clamp01((u + v) / 2)),
    bloom: beatBloom(beat),
    dim: alpha,
  })
}

function drawTexts(ctx: CanvasRenderingContext2D, a: Record<Layer | 'cell', number>): void {
  const line = (s: string, y: number, alpha: number, o: Parameters<typeof text>[4]) => {
    if (alpha <= 0) return
    ctx.save()
    ctx.globalAlpha = alpha
    text(ctx, s, W / 2, y + (1 - alpha) * 10, { ...o, align: 'center' })
    ctx.restore()
  }
  line(TITLE, 316, a.title, { size: 88, weight: 700, color: '#ffffff' })
  line(SUBTITLE, 384, a.title, { size: 40, weight: 400, color: 'rgba(255,255,255,0.72)' })
  line(CREDITS.names, 820, a.names, { size: 44, weight: 600, color: '#ffffff' })
  line(CREDITS.built, 890, a.built, { size: 36, weight: 400, color: 'rgba(255,255,255,0.72)' })
  line(CREDITS.url, 960, a.url, { size: 40, weight: 600, color: heat(0.9) })
}

export const end: Scene = {
  id: 'end',
  figures: [],
  draw(ctx, s) {
    nightBackground(ctx)
    const a = layerAlphas(s.t)
    drawPulsar(ctx, a.pulsar, s.beat)
    drawLoneCell(ctx, blink(s.t))
    drawTexts(ctx, a)
  },
}
