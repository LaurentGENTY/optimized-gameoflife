import { SCENE_BARS, type SceneId } from '../timeline'
import { curves } from './curves'
import { end } from './end'
import { gpu } from './gpu'
import { lifeInLife } from './life-in-life'
import { native } from './native'
import { screens } from './screens'
import { simd } from './simd'
import { threads } from './threads'
import { type Scene } from './types'

const BY_ID: Record<SceneId, Scene> = { 'life-in-life': lifeInLife, native, simd, threads, gpu, screens, curves, end }

/** Scenes in timeline order. */
export const SCENES: Scene[] = (Object.keys(SCENE_BARS) as SceneId[]).map((id) => BY_ID[id])

export function sceneById(id: SceneId): Scene {
  return BY_ID[id]
}
