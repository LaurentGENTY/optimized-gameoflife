import { beforeAll, describe, expect, it } from 'vitest';
import { createGrid } from '../src/grid';
import { WebGpuEngine } from '../src/engines/webgpu-engine';

beforeAll(() => {
  // Node has no WebGPU globals; the engine only reads these flag values.
  Object.assign(globalThis, {
    GPUBufferUsage: { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 },
  });
});

// Minimal device whose error scopes report the given error on the first pop of that filter.
function fakeDevice(failing: { filter: GPUErrorFilter; message: string } | null) {
  const scopes: GPUErrorFilter[] = [];
  const destroyed: string[] = [];
  let n = 0;
  const device = {
    createShaderModule: () => ({}),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => {
      const id = `buf${n++}`;
      return { id, destroy: () => destroyed.push(id) };
    },
    createBindGroup: () => ({}),
    queue: { writeBuffer: () => {}, onSubmittedWorkDone: async () => {} },
    pushErrorScope: (filter: GPUErrorFilter) => scopes.push(filter),
    popErrorScope: async () => {
      const filter = scopes.pop();
      return failing && failing.filter === filter ? { message: failing.message } : null;
    },
  };
  return { device: device as unknown as GPUDevice, destroyed, scopes };
}

describe('WebGpuEngine.init', () => {
  it('rejects with a readable error when the GPU runs out of memory, and frees what it allocated', async () => {
    const { device, destroyed, scopes } = fakeDevice({ filter: 'out-of-memory', message: 'Not enough memory' });
    const engine = new WebGpuEngine('webgpu-naive', device, '');
    await expect(engine.init(createGrid(16))).rejects.toThrow(/16×16 grid.*Not enough memory/);
    expect(destroyed.length).toBe(3);
    expect(scopes).toEqual([]);
    await expect(engine.step(1)).rejects.toThrow(/before init/);
  });

  it('rejects on validation errors too', async () => {
    const { device } = fakeDevice({ filter: 'validation', message: 'Buffer size exceeds the limit' });
    const engine = new WebGpuEngine('webgpu-naive', device, '');
    await expect(engine.init(createGrid(16))).rejects.toThrow(/Buffer size exceeds the limit/);
  });

  it('initializes normally when no error scope reports anything', async () => {
    const { device } = fakeDevice(null);
    const engine = new WebGpuEngine('webgpu-naive', device, '');
    await engine.init(createGrid(16));
    expect((await engine.frame()).size).toBe(16);
  });
});
