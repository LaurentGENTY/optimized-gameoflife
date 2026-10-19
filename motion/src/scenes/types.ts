import { type FigureRef } from '../data'
import { type SceneId, sceneAt } from '../timeline'

export interface Scene {
  id: SceneId
  /** Every bench figure the scene shows, so a test can check they all exist before rendering. */
  figures: FigureRef[]
  /** Runs once before the first draw (build canvases, load images). Never touch the DOM at import. */
  prepare?(): Promise<void>
  draw(ctx: CanvasRenderingContext2D, s: ReturnType<typeof sceneAt>): void | Promise<void>
}
