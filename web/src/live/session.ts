import type { Engine, FrameSource } from '../engine';
import type { Grid } from '../grid';
import { LiveRunner, type LiveStats } from './runner';

export interface SessionConfig {
  engineId: string;
  presetId: string;
  size: number;
}

export interface SessionDeps {
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
  onFrame(frame: FrameSource): void;
  onStats(stats: LiveStats): void;
  onError(error: unknown): void;
}

export class Session {
  private engine: Engine | null = null;
  private runner: LiveRunner | null = null;
  // Incremented by every load so a slower, older load can detect it was superseded.
  private token = 0;

  constructor(private readonly deps: SessionDeps) {}

  get playing(): boolean {
    return this.runner?.playing ?? false;
  }

  async load(config: SessionConfig): Promise<boolean> {
    const token = ++this.token;
    await this.teardown();
    let engine: Engine | null = null;
    try {
      const grid = this.deps.buildGrid(config.presetId, config.size);
      engine = this.deps.createEngine(config.engineId);
      await engine.init(grid);
      if (token !== this.token) {
        engine.dispose();
        return false;
      }
      const first = await engine.frame();
      if (token !== this.token) {
        engine.dispose();
        return false;
      }
      this.engine = engine;
      this.runner = new LiveRunner(engine, {
        onFrame: (f) => this.deps.onFrame(f),
        onStats: (s) => this.deps.onStats(s),
        onError: (e) => this.deps.onError(e),
      });
      this.deps.onFrame(first);
      return true;
    } catch (err) {
      engine?.dispose();
      if (token === this.token) this.deps.onError(err);
      return false;
    }
  }

  play(): void {
    this.runner?.play();
  }

  pause(): Promise<void> {
    return this.runner?.pause() ?? Promise.resolve();
  }

  step(): Promise<void> {
    return this.runner?.step() ?? Promise.resolve();
  }

  requestFrame(): void {
    this.runner?.requestFrame();
  }

  async dispose(): Promise<void> {
    this.token++;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const runner = this.runner;
    const engine = this.engine;
    this.runner = null;
    this.engine = null;
    await runner?.pause();
    engine?.dispose();
  }
}
