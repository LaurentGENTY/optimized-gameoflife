import { describe, expect, it } from 'vitest';
import { ganttLayout, hitTest } from '../src/monitor/views';

const spans = [
  { thread: 0, tile: 5, iteration: 0, start: 100, end: 150 },
  { thread: 1, tile: 6, iteration: 0, start: 150, end: 200 },
];

describe('gantt layout', () => {
  it('puts each thread on its own row and scales time to the width', () => {
    const r = ganttLayout(spans, 2, 100, 200, 200, 10);
    expect(r[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 10 });
    expect(r[1]).toMatchObject({ x: 100, y: 10, w: 100, h: 10 });
  });

  it('keeps very short spans visible (at least 1px wide)', () => {
    const r = ganttLayout([{ thread: 0, tile: 0, iteration: 0, start: 100, end: 100.0001 }], 1, 100, 200, 200, 10);
    expect(r[0].w).toBe(1);
  });

  it('finds the span under the cursor', () => {
    const r = ganttLayout(spans, 2, 100, 200, 200, 10);
    expect(hitTest(r, 120, 15)?.tile).toBe(6);
    expect(hitTest(r, 20, 5)?.tile).toBe(5);
    expect(hitTest(r, 20, 15)).toBeNull();
  });
});
