import type { TraceBatch } from '../engine';

export interface TileSpan {
  thread: number;
  tile: number;
  iteration: number;
  start: number;
  end: number;
}

type CpuBatch = Extract<TraceBatch, { kind: 'cpu' }>;
type GpuBatch = Extract<TraceBatch, { kind: 'gpu' }>;

export class CpuMonitor {
  private spans: TileSpan[] = [];
  private _threads = 0;
  private tilesPerSide = 0;
  private _lost = 0;

  constructor(private readonly keepIterations = 4) {}

  get threads(): number {
    return this._threads;
  }

  get lost(): number {
    return this._lost;
  }

  push(b: CpuBatch): void {
    this._threads = b.threads;
    this.tilesPerSide = b.tilesPerSide;
    this._lost += b.lost;
    for (let i = 0; i < b.records.length; i += 5) {
      this.spans.push({
        thread: b.records[i],
        tile: b.records[i + 1],
        iteration: b.records[i + 2],
        start: b.records[i + 3],
        end: b.records[i + 4],
      });
    }
    const last = this.spans.at(-1)?.iteration;
    if (last !== undefined) this.spans = this.spans.filter((s) => s.iteration > last - this.keepIterations);
  }

  window(): { spans: TileSpan[]; t0: number; t1: number; iterations: number[] } {
    if (this.spans.length === 0) return { spans: [], t0: 0, t1: 0, iterations: [] };
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const s of this.spans) {
      t0 = Math.min(t0, s.start);
      t1 = Math.max(t1, s.end);
    }
    const iterations = [...new Set(this.spans.map((s) => s.iteration))].sort((a, b) => a - b);
    return { spans: this.spans, t0, t1, iterations };
  }

  // Latest iteration only: -1 marks tiles skipped by lazy tiling.
  latestTiles(): { tilesPerSide: number; thread: Float32Array; durationMs: Float32Array } | null {
    const last = this.spans.at(-1)?.iteration;
    if (last === undefined) return null;
    const n = this.tilesPerSide * this.tilesPerSide;
    const thread = new Float32Array(n).fill(-1);
    const durationMs = new Float32Array(n).fill(-1);
    for (const s of this.spans) {
      if (s.iteration !== last) continue;
      thread[s.tile] = s.thread;
      durationMs[s.tile] = s.end - s.start;
    }
    return { tilesPerSide: this.tilesPerSide, thread, durationMs };
  }

  // Busy share inside each iteration's own [first start, last end]: gaps between step()
  // calls (frame readback, Step clicks) are not idle time of the kernel.
  activity(): number[] {
    const busy = new Array<number>(this._threads).fill(0);
    const bounds = new Map<number, [number, number]>();
    for (const s of this.spans) {
      busy[s.thread] += s.end - s.start;
      const b = bounds.get(s.iteration);
      if (!b) bounds.set(s.iteration, [s.start, s.end]);
      else bounds.set(s.iteration, [Math.min(b[0], s.start), Math.max(b[1], s.end)]);
    }
    let total = 0;
    for (const [a, b] of bounds.values()) total += b - a;
    return busy.map((x) => (total > 0 ? Math.min(100, (x / total) * 100) : 0));
  }

  clear(): void {
    this.spans = [];
    this._lost = 0;
  }
}

export class GpuMonitor {
  private data: { iteration: number; ms: number }[] = [];
  private _lost = 0;

  constructor(private readonly keep = 240) {}

  get lost(): number {
    return this._lost;
  }

  push(b: GpuBatch): void {
    this._lost += b.lost;
    for (let i = 0; i < b.samples.length; i += 2) this.data.push({ iteration: b.samples[i], ms: b.samples[i + 1] });
    if (this.data.length > this.keep) this.data = this.data.slice(-this.keep);
  }

  samples(): { iteration: number; ms: number }[] {
    return this.data;
  }

  clear(): void {
    this.data = [];
    this._lost = 0;
  }
}
