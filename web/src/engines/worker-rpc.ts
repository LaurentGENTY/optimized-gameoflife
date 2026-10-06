export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  terminate(): void;
}

type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export class WorkerRpc {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = (ev) => {
      const reply = ev.data as Reply;
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.value);
      else p.reject(new Error(reply.error));
    };
    worker.onerror = (ev) => {
      this.closed = true;
      this.failAll(new Error(`worker crashed: ${ev.message}`));
    };
  }

  call<T>(request: object, transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new Error('worker terminated'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.failAll(new Error('worker terminated'));
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
