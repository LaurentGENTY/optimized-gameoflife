import { describe, expect, it } from 'vitest';
import { initWebGPU } from '../src/render/gpu';

const fakeAdapter = (requestDevice: () => Promise<unknown>) => ({
  features: new Set<string>(),
  limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 28 },
  info: { vendor: 'acme', architecture: 'rdna', description: '' },
  requestDevice,
});

describe('initWebGPU', () => {
  it('explains when the browser has no WebGPU', async () => {
    const r = await initWebGPU({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not support WebGPU/);
  });

  it('explains when no adapter is available', async () => {
    const r = await initWebGPU({ gpu: { requestAdapter: async () => null } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no GPU adapter/);
  });

  it('explains when device creation fails', async () => {
    const adapter = fakeAdapter(async () => {
      throw new Error('limits too high');
    });
    const r = await initWebGPU({ gpu: { requestAdapter: async () => adapter } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/limits too high/);
  });

  it('returns the device and a readable adapter label', async () => {
    const device = { lost: new Promise(() => {}) };
    const r = await initWebGPU({ gpu: { requestAdapter: async () => fakeAdapter(async () => device) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.device).toBe(device);
      expect(r.label).toBe('acme rdna');
      expect(r.timestamps).toBe(false);
    }
  });

  it('still succeeds when the adapter exposes no info (older Chromium)', async () => {
    const adapter = { ...fakeAdapter(async () => ({})), info: undefined };
    const r = await initWebGPU({ gpu: { requestAdapter: async () => adapter } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe('unknown GPU');
  });
});
