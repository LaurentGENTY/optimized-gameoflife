import { describe, expect, it } from 'vitest';
import { fitCamera, panBy, screenToCell, zoomAt } from '../src/render/camera';

describe('camera', () => {
  it('fit centers the grid in the viewport', () => {
    const cam = fitCamera(100, 800, 400);
    expect(cam.zoom).toBe(4);
    expect(screenToCell(cam, 400, 200)).toEqual([50, 50]);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const cam = fitCamera(100, 800, 400);
    const before = { x: cam.x + 123 / cam.zoom, y: cam.y + 77 / cam.zoom };
    const z = zoomAt(cam, 2, 123, 77);
    expect(z.zoom).toBe(8);
    expect(z.x + 123 / z.zoom).toBeCloseTo(before.x);
    expect(z.y + 77 / z.zoom).toBeCloseTo(before.y);
  });

  it('clamps zoom between 1/64 and 64', () => {
    const cam = fitCamera(100, 800, 400);
    expect(zoomAt(cam, 1e6, 0, 0).zoom).toBe(64);
    expect(zoomAt(cam, 1e-6, 0, 0).zoom).toBe(1 / 64);
  });

  it('panBy moves the view opposite to the drag', () => {
    const cam = fitCamera(100, 800, 400);
    expect(panBy(cam, 40, -8)).toEqual({ zoom: 4, x: cam.x - 10, y: cam.y + 2 });
  });
});
