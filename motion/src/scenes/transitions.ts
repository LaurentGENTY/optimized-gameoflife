// Transitions at the cuts between scenes. Every cut falls on a bar line (scene start); an effect
// may build up over the outgoing scene's last frames and decay over the incoming scene's first
// ones, applied over the finished frame so the scenes themselves stay untouched outside it.
import { nightBackground, withLayer } from '../render/canvas'
import { FPS, type SceneId, sceneStart } from '../timeline'

/** `night`: fade through the night background. `bloom`: the frame overexposes into its own glow. */
export type Fx = 'night' | 'bloom'

export interface Side {
  fx: Fx
  frames: number
}

export interface Transition {
  /** The scene starting on the cut. */
  into: SceneId
  /** Effect over the last frames before the cut. */
  out?: Side
  /** Effect over the first frames from the cut on. */
  in?: Side
}

export const MAX_TRANSITION_FRAMES = FPS / 2

/**
 * native → simd has no entry: simd opens on its compilation glitch (spec), which is that cut.
 * screens is the portfolio loop (frames 2640–3239), so nothing may draw over it: the cut into it
 * builds up in the GPU scene only, the cut out of it plays in the curves scene only.
 */
export const TRANSITIONS: readonly Transition[] = [
  // The title card dips to night, and 2020 comes up out of it on the first kick.
  { into: 'native', out: { fx: 'night', frames: 12 }, in: { fx: 'night', frames: 15 } },
  // threads fades its glass screen in from night by itself.
  { into: 'threads', out: { fx: 'night', frames: 15 } },
  // Into the GPU riser: a flash across the cut.
  { into: 'gpu', out: { fx: 'bloom', frames: 10 }, in: { fx: 'bloom', frames: 18 } },
  // The drop's glow swells and pushes in, then the five screens land clean on the downbeat.
  { into: 'screens', out: { fx: 'bloom', frames: 20 } },
  // The curves open on a flash that fades into their empty axes.
  { into: 'curves', in: { fx: 'bloom', frames: 18 } },
  // The chart drains to night, and the end card's pulsar ignites out of it.
  { into: 'end', out: { fx: 'night', frames: 15 }, in: { fx: 'bloom', frames: 12 } },
]

export interface FxState {
  fx: Fx
  side: 'out' | 'in'
  /** Strength in (0, 1]: 1 on the last frame before the cut. */
  amount: number
}

const CUTS = TRANSITIONS.map((tr) => ({ tr, cut: Math.round(sceneStart(tr.into) * FPS) }))

/** The effect on `frame`, or null for a frame no transition touches. */
export function transitionAt(frame: number): FxState | null {
  for (const { tr, cut } of CUTS) {
    if (tr.out && frame >= cut - tr.out.frames && frame < cut) {
      const u = (frame - (cut - tr.out.frames) + 1) / tr.out.frames
      return { fx: tr.out.fx, side: 'out', amount: u * u }
    }
    if (tr.in && frame >= cut && frame < cut + tr.in.frames) {
      // Starts just under the peak, so the strongest frame is the one before the cut.
      const v = (frame - cut + 1) / (tr.in.frames + 1)
      return { fx: tr.in.fx, side: 'in', amount: (1 - v) ** 2 }
    }
  }
  return null
}

/** Night at the peak of a fade: the cut hides under it, yet no frame goes fully blank. */
const NIGHT_DEPTH = 0.9

/** How far the outgoing frame zooms in at the peak of a bloom. */
const PUSH = 0.05

function bloom(ctx: CanvasRenderingContext2D, st: FxState): void {
  const a = st.amount
  const { width: w, height: h } = ctx.canvas
  if (st.side === 'out') {
    const k = 1 + PUSH * a
    withLayer(
      ctx,
      (l) => {
        l.translate(w / 2, h / 2)
        l.scale(k, k)
        l.translate(-w / 2, -h / 2)
        l.drawImage(ctx.canvas, 0, 0)
      },
      { op: 'copy' },
    )
  }
  // The frame's own light, blurred and added back. contrast(2) zeroes every channel under 25 %,
  // so only what is bright blooms: the night background would otherwise double into a haze.
  withLayer(ctx, (l) => l.drawImage(ctx.canvas, 0, 0), { filter: 'contrast(2) blur(36px)', alpha: a, op: 'lighter' })
  withLayer(ctx, (l) => l.drawImage(ctx.canvas, 0, 0), { filter: 'contrast(2) blur(10px)', alpha: 0.6 * a, op: 'lighter' })
  // A violet glow from the centre (palette mid-tone, not white: no grey fog), so a sparse frame flashes too.
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6)
  g.addColorStop(0, `rgba(177,76,255,${0.32 * a})`)
  g.addColorStop(1, 'rgba(177,76,255,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** Draws the effect over the finished frame. */
export function applyTransition(ctx: CanvasRenderingContext2D, st: FxState): void {
  ctx.save()
  ctx.resetTransform()
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (st.fx === 'night') {
    ctx.globalAlpha = NIGHT_DEPTH * st.amount
    nightBackground(ctx)
  } else {
    bloom(ctx, st)
  }
  ctx.restore()
}
