import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import { FONT_FAMILY } from './render/canvas'
import { sceneById } from './scenes'
import { type SceneId, sceneAt } from './timeline'

declare global {
  interface Window {
    renderFrame(i: number): Promise<void>
    motionReady: Promise<void>
  }
}

// Canvas text does not trigger webfont loading, so each weight is requested explicitly.
window.motionReady = Promise.all(
  ([400, 600, 700] as const).map((w) => document.fonts.load(`${w} 64px ${FONT_FAMILY}`)),
).then(() => undefined)

const prepared = new Map<SceneId, Promise<void>>()

window.renderFrame = async (i: number): Promise<void> => {
  await window.motionReady
  if (!document.fonts.check(`700 64px ${FONT_FAMILY}`)) throw new Error('Space Grotesk is not loaded')
  const s = sceneAt(i)
  const scene = sceneById(s.id)
  if (!prepared.has(s.id)) prepared.set(s.id, scene.prepare?.() ?? Promise.resolve())
  await prepared.get(s.id)
  const canvas = document.querySelector<HTMLCanvasElement>('#stage')
  if (!canvas) throw new Error('#stage canvas not found')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  // Full reset: no transform, filter, alpha or pixels leak from the previous frame.
  ctx.reset()
  await scene.draw(ctx, s)
}
