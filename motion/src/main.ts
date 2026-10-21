import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import { buildScore } from './audio/score'
import { renderScore } from './audio/synth'
import { bytesToBase64, encodeWav } from './audio/wav'
import { SceneLifecycle } from './lifecycle'
import { FONT_FAMILY } from './render/canvas'
import { sceneById } from './scenes'
import { applyTransition, transitionAt } from './scenes/transitions'
import { sceneAt } from './timeline'

declare global {
  interface Window {
    renderFrame(i: number): Promise<void>
    /** The film's soundtrack as a base64 16-bit stereo WAV. */
    renderAudioWav(): Promise<string>
    motionReady: Promise<void>
  }
}

// Canvas text does not trigger webfont loading, so each weight is requested explicitly.
window.motionReady = Promise.all(
  ([400, 600, 700] as const).map((w) => document.fonts.load(`${w} 64px ${FONT_FAMILY}`)),
).then(() => undefined)

const lifecycle = new SceneLifecycle()

window.renderFrame = async (i: number): Promise<void> => {
  await window.motionReady
  if (!document.fonts.check(`700 64px ${FONT_FAMILY}`)) throw new Error('Space Grotesk is not loaded')
  const s = sceneAt(i)
  const scene = sceneById(s.id)
  await lifecycle.enter(scene)
  const canvas = document.querySelector<HTMLCanvasElement>('#stage')
  if (!canvas) throw new Error('#stage canvas not found')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  // Full reset: no transform, filter, alpha or pixels leak from the previous frame.
  ctx.reset()
  await scene.draw(ctx, s)
  const fx = transitionAt(i)
  if (fx) applyTransition(ctx, fx)
}

window.renderAudioWav = async (): Promise<string> => {
  const buf = await renderScore(buildScore())
  return bytesToBase64(encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate))
}
