import type { Engine, FrameSource, TraceBatch } from '../engine';

export interface LiveStats {
  generation: number;
  gensPerSec: number;
}

export interface LiveCallbacks {
  onFrame(frame: FrameSource): void;
  onStats(stats: LiveStats): void;
  onError(error: unknown): void;
  onTrace?(batch: TraceBatch): void;
}

// Batches are resized to last ~4-16 ms so pause and frame requests stay responsive.
const MIN_BATCH_MS = 4;
const MAX_BATCH_MS = 16;
const MAX_BATCH = 1 << 16;

// An engine whose step resolves through microtasks only would otherwise starve
// rAF, input and timers. MessageChannel yields a macrotask without setTimeout's 4 ms clamp.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

export class LiveRunner {
  private _generation = 0;
  private running = false;
  private loop: Promise<void> | null = null;
  private frameWanted = true;
  private batch = 1;
  private readonly statsIntervalMs: number;

  constructor(
    private readonly engine: Engine,
    private readonly cb: LiveCallbacks,
    opts: { statsIntervalMs?: number } = {},
  ) {
    this.statsIntervalMs = opts.statsIntervalMs ?? 500;
  }

  get generation(): number {
    return this._generation;
  }

  get playing(): boolean {
    return this.running;
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async pause(): Promise<void> {
    this.running = false;
    await this.loop;
    this.loop = null;
  }

  async step(): Promise<void> {
    await this.pause();
    try {
      await this.engine.step(1);
      this._generation += 1;
      this.cb.onStats({ generation: this._generation, gensPerSec: 0 });
      await this.emitFrame();
    } catch (err) {
      this.cb.onError(err);
    }
  }

  private async emitFrame(): Promise<void> {
    this.cb.onFrame(await this.engine.frame());
    if (this.engine.trace && this.cb.onTrace) {
      const batch = await this.engine.trace();
      if (batch) this.cb.onTrace(batch);
    }
  }

  requestFrame(): void {
    this.frameWanted = true;
  }

  private async run(): Promise<void> {
    let windowStart = performance.now();
    let windowGens = 0;
    try {
      while (this.running) {
        const t0 = performance.now();
        await this.engine.step(this.batch);
        const dt = performance.now() - t0;
        this._generation += this.batch;
        windowGens += this.batch;
        if (dt < MIN_BATCH_MS) this.batch = Math.min(this.batch * 2, MAX_BATCH);
        else if (dt > MAX_BATCH_MS) this.batch = Math.max(1, this.batch >> 1);

        if (this.frameWanted) {
          this.frameWanted = false;
          await this.emitFrame();
        }

        const elapsed = performance.now() - windowStart;
        if (elapsed >= this.statsIntervalMs) {
          this.cb.onStats({ generation: this._generation, gensPerSec: (windowGens * 1000) / elapsed });
          windowStart = performance.now();
          windowGens = 0;
        }
        await yieldToEventLoop();
      }
    } catch (err) {
      this.running = false;
      this.cb.onError(err);
    }
  }
}
