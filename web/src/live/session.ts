import type { Engine, FrameSource, TraceBatch } from '../engine';
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
  onTrace?(batch: TraceBatch): void;
}

export class Session {
  private engine: Engine | null = null;
  private runner: LiveRunner | null = null;
  // Incremented by every load so a slower, older load can detect it was superseded.
  private token = 0;
  // Play pressed before the engine finished loading; honoured once the runner exists.
  private playRequested = false;
  private loading = false;

  constructor(private readonly deps: SessionDeps) {}

  get playing(): boolean {
    return this.runner ? this.runner.playing : this.playRequested;
  }

  async load(config: SessionConfig): Promise<boolean> {
    const token = ++this.token;
    this.playRequested = false;
    this.loading = true;
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
      // A runner outlives its session while its last batch or step drains: silence it then.
      const current = () => token === this.token;
      this.runner = new LiveRunner(engine, {
        onFrame: (f) => current() && this.deps.onFrame(f),
        onStats: (s) => current() && this.deps.onStats(s),
        onError: (e) => current() && this.deps.onError(e),
        onTrace: (b) => current() && this.deps.onTrace?.(b),
      });
      this.deps.onFrame(first);
      if (this.playRequested) {
        this.playRequested = false;
        this.runner.play();
      }
      return true;
    } catch (err) {
      engine?.dispose();
      if (token === this.token) this.deps.onError(err);
      return false;
    } finally {
      if (token === this.token) {
        this.loading = false;
        this.playRequested = false;
      }
    }
  }

  play(): void {
    if (this.runner) this.runner.play();
    else if (this.loading) this.playRequested = true;
  }

  pause(): Promise<void> {
    this.playRequested = false;
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
