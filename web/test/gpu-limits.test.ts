import { describe, expect, it } from 'vitest';
import { maxGpuSize } from '../src/engines/gpu-limits';

const SIZES = [512, 1024, 2048, 4096, 8192];

describe('maxGpuSize', () => {
  it('allows 8192 when both limits fit 8192² u32 cells (256 MiB)', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 2 ** 28, maxBufferSize: 2 ** 28 }, SIZES)).toBe(8192);
  });

  it('is bounded by the smaller of the two limits', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 2 ** 27, maxBufferSize: 2 ** 30 }, SIZES)).toBe(4096);
  });

  it('returns 0 when even the smallest size does not fit', () => {
    expect(maxGpuSize({ maxStorageBufferBindingSize: 1024, maxBufferSize: 1024 }, SIZES)).toBe(0);
  });
});
