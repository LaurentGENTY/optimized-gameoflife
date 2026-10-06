export interface GpuLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
}

export function maxGpuSize(limits: GpuLimits, sizes: readonly number[]): number {
  const maxBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  let best = 0;
  for (const s of sizes) if (s * s * 4 <= maxBytes && s > best) best = s;
  return best;
}
