import { type Scene } from './scenes/types'
import { type SceneId } from './timeline'

/**
 * Runs each scene's prepare() before its first draw, and its dispose() once rendering moves to
 * another scene, so a heavy scene (Life in Life's 6208² WASM grid) does not stay in memory for
 * the rest of the film. A disposed scene is prepared again if rendering comes back to it.
 */
export class SceneLifecycle {
  private readonly prepared = new Map<SceneId, Promise<void>>()
  private active: Scene | null = null

  async enter(scene: Scene): Promise<void> {
    const prev = this.active
    this.active = scene
    if (prev && prev !== scene && prev.dispose) {
      // A prepare still in flight would otherwise rebuild what dispose() just freed.
      await this.prepared.get(prev.id)?.catch(() => undefined)
      prev.dispose()
      this.prepared.delete(prev.id)
    }
    if (!this.prepared.has(scene.id)) this.prepared.set(scene.id, scene.prepare?.() ?? Promise.resolve())
    await this.prepared.get(scene.id)
  }
}
