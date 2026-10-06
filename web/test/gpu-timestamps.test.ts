import { describe, expect, it } from 'vitest';
import { kernelSamples } from '../src/engines/gpu-timestamps';

describe('kernelSamples', () => {
  it('turns begin/end pairs in ns into [iteration, ms] samples', () => {
    const ts = BigUint64Array.from([1_000_000n, 1_500_000n, 2_000_000n, 2_250_000n]);
    expect(Array.from(kernelSamples(ts, 2, 10))).toEqual([10, 0.5, 11, 0.25]);
  });

  it('drops zero, negative and absurd durations instead of plotting them', () => {
    const ts = BigUint64Array.from([0n, 0n, 5n, 3n, 0n, 20_000_000_000n, 100n, 1_100n]);
    expect(Array.from(kernelSamples(ts, 4, 0))).toEqual([3, 0.001]);
  });

  it('keeps zero-length passes: browsers quantize timestamps (100 µs in Chrome by default)', () => {
    const ts = BigUint64Array.from([1_000_000n, 1_000_000n, 2_000_000n, 2_100_000n]);
    expect(Array.from(kernelSamples(ts, 2, 0))).toEqual([0, 0, 1, 0.1]);
  });
});
