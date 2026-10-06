import { describe, expect, it } from 'vitest';
import { createGrid, hashCells } from '../src/grid';
import { CpuWorkerEngine } from '../src/engines/cpu-worker-engine';
import { createSimHandler, type SimReply, type SimRequest } from '../src/engines/sim-handler';
import { WasmSim } from '../src/engines/wasm-sim';
import { WorkerRpc, type WorkerLike } from '../src/engines/worker-rpc';

// Runs the real worker-side handler in-process, asynchronously, like a Worker would.
class InProcessWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly handle: (req: SimRequest) => Promise<SimReply>) {}
  postMessage(message: unknown): void {
    void this.handle(message as SimRequest).then((reply) =>
      this.onmessage?.({ data: reply } as MessageEvent),
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

class SilentWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

const wasmSeqWorker = () => new InProcessWorker(createSimHandler((g) => WasmSim.create('seq', g)));

describe('CpuWorkerEngine over wasm-seq', () => {
  it('runs generations and returns frames and hashes', async () => {
    const g = createGrid(12);
    for (const [x, y] of [[3, 2], [4, 3], [2, 4], [3, 4], [4, 4]]) g.cells[y * 12 + x] = 1;
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await engine.init(g);
    await engine.step(4);
    const frame = await engine.frame();
    expect(frame.kind).toBe('cpu');
    if (frame.kind !== 'cpu') return;
    expect(frame.size).toBe(12);
    expect(frame.cells[3 * 12 + 4]).toBe(1); // glider head moved from (3,2) to (4,3)
    expect(await engine.hash()).toBe(hashCells(frame.cells));
    engine.dispose();
  });

  it('returns frames as copies that do not alias engine memory', async () => {
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await engine.init(createGrid(8));
    const before = await engine.hash();
    const frame = await engine.frame();
    if (frame.kind === 'cpu') frame.cells.fill(1);
    expect(await engine.hash()).toBe(before);
    engine.dispose();
  });

  it('rejects step before init', async () => {
    const engine = new CpuWorkerEngine('wasm-seq', wasmSeqWorker());
    await expect(engine.step(1)).rejects.toThrow(/before init/);
  });
});

describe('WorkerRpc', () => {
  it('rejects pending and later calls when the worker crashes', async () => {
    const worker = new SilentWorker();
    const rpc = new WorkerRpc(worker);
    const pending = rpc.call({ op: 'step', n: 1 });
    worker.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(pending).rejects.toThrow(/worker crashed: out of memory/);
    await expect(rpc.call({ op: 'hash' })).rejects.toThrow(/terminated/);
  });

  it('terminate rejects pending calls and is idempotent', async () => {
    const worker = new SilentWorker();
    const rpc = new WorkerRpc(worker);
    const pending = rpc.call({ op: 'hash' });
    rpc.terminate();
    rpc.terminate();
    await expect(pending).rejects.toThrow(/terminated/);
    expect(worker.terminated).toBe(true);
  });
});
