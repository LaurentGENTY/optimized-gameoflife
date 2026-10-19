import { nightBackground, text } from '../render/canvas'
import { H, SCENE_BARS, type SceneId, W } from '../timeline'
import { lifeInLife } from './life-in-life'
import { native } from './native'
import { simd } from './simd'
import { threads } from './threads'
import { type Scene } from './types'

/** Stand-in for a scene not built yet, so every frame of the timeline renders. */
function placeholder(id: SceneId): Scene {
  return {
    id,
    figures: [],
    draw(ctx) {
      nightBackground(ctx)
      text(ctx, id, W / 2, H / 2, { size: 64, weight: 700, color: 'rgba(255,255,255,0.7)', align: 'center' })
    },
  }
}

const BUILT: Partial<Record<SceneId, Scene>> = { 'life-in-life': lifeInLife, native, simd, threads }

/** Scenes in timeline order. */
export const SCENES: Scene[] = (Object.keys(SCENE_BARS) as SceneId[]).map((id) => BUILT[id] ?? placeholder(id))

export function sceneById(id: SceneId): Scene {
  const scene = SCENES.find((s) => s.id === id)
  if (!scene) throw new Error(`unknown scene ${id}`)
  return scene
}
