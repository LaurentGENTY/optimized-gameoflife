import { describe, expect, it } from 'vitest';
import { heatColor, overlayValues, threadColor, THREAD_HUES } from '../src/monitor/colors';

describe('monitor colors', () => {
  it('uses the 8 validated hues, then darker variants', () => {
    expect(THREAD_HUES).toHaveLength(8);
    const [r, g, b] = threadColor(0);
    const [r8, g8, b8] = threadColor(8);
    expect(r8).toBeCloseTo(r * 0.6);
    expect(g8).toBeCloseTo(g * 0.6);
    expect(b8).toBeCloseTo(b * 0.6);
  });

  it('heat goes from dark to bright on one hue', () => {
    const lo = heatColor(0).reduce((a, b) => a + b);
    const hi = heatColor(1).reduce((a, b) => a + b);
    expect(hi).toBeGreaterThan(lo);
  });

  it('builds overlay values, keeping skipped tiles at -1', () => {
    const tiles = { thread: Float32Array.from([2, -1, 0]), durationMs: Float32Array.from([4, -1, 1]) };
    expect(Array.from(overlayValues('thread', tiles))).toEqual([2, -1, 0]);
    expect(Array.from(overlayValues('heat', tiles))).toEqual([1, -1, 0.25]);
  });
});
