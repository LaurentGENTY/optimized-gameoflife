export type GpuInit =
  | { ok: true; adapter: GPUAdapter; device: GPUDevice; label: string; timestamps: boolean }
  | { ok: false; reason: string };

export async function initWebGPU(nav: object = navigator): Promise<GpuInit> {
  const gpu = (nav as { gpu?: GPU }).gpu;
  if (!gpu) {
    return {
      ok: false,
      reason: 'This browser does not support WebGPU. Use a recent desktop Chrome or Edge, or Safari 26+.',
    };
  }
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return {
      ok: false,
      reason: 'WebGPU is enabled but no GPU adapter is available (hardware acceleration off or GPU blocklisted).',
    };
  }
  const timestamps = adapter.features.has('timestamp-query');
  // adapter.info is missing on older Chromium; read it outside the device try block.
  const { vendor = '', architecture = '', description = '' } = adapter.info ?? {};
  const label = description || [vendor, architecture].filter(Boolean).join(' ') || 'unknown GPU';
  try {
    const device = await adapter.requestDevice({
      requiredFeatures: timestamps ? ['timestamp-query'] : [],
      // Large grids need the adapter's real limits, not the WebGPU defaults.
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    return { ok: true, adapter, device, label, timestamps };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not create a WebGPU device: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
