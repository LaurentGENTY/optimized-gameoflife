import type { CpuSim } from '../engine';
import type { Grid } from '../grid';

export type SimRequest =
  | { id: number; op: 'init'; size: number; cells: Uint8Array }
  | { id: number; op: 'step'; n: number }
  | { id: number; op: 'frame' }
  | { id: number; op: 'hash' };

export type SimReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export function createSimHandler(
  createSim: (grid: Grid) => Promise<CpuSim>,
): (req: SimRequest) => Promise<SimReply> {
  let sim: CpuSim | null = null;
  const need = (): CpuSim => {
    if (!sim) throw new Error('engine used before init');
    return sim;
  };
  return async (req) => {
    try {
      switch (req.op) {
        case 'init':
          sim?.dispose();
          sim = null;
          sim = await createSim({ size: req.size, cells: req.cells });
          return { id: req.id, ok: true, value: null };
        case 'step':
          need().step(req.n);
          return { id: req.id, ok: true, value: null };
        case 'frame':
          return { id: req.id, ok: true, value: need().cells().slice() };
        case 'hash':
          return { id: req.id, ok: true, value: need().hash() };
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export function serveSimInWorker(createSim: (grid: Grid) => Promise<CpuSim>): void {
  const handle = createSimHandler(createSim);
  // Serialize requests so a step can never run while init is still awaiting the module.
  let queue: Promise<void> = Promise.resolve();
  self.onmessage = (ev: MessageEvent<SimRequest>) => {
    queue = queue.then(async () => {
      const reply = await handle(ev.data);
      const transfer = reply.ok && reply.value instanceof Uint8Array ? [reply.value.buffer as ArrayBuffer] : [];
      self.postMessage(reply, { transfer });
    });
  };
}
