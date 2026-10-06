import { panBy, zoomAt, type Camera } from '../render/camera';

export interface ViewportControl {
  get(): Camera | null;
  set(cam: Camera): void;
  fit(): void;
}

export function attachViewport(canvas: HTMLCanvasElement, view: ViewportControl): void {
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const cam = view.get();
      if (!cam) return;
      const r = canvas.getBoundingClientRect();
      view.set(zoomAt(cam, Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top));
    },
    { passive: false },
  );

  let last: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    last = { x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!last) return;
    const cam = view.get();
    if (cam) view.set(panBy(cam, ev.clientX - last.x, ev.clientY - last.y));
    last = { x: ev.clientX, y: ev.clientY };
  });
  const end = () => {
    last = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => view.fit());
}
