import { threadColor } from './colors';
import type { TileSpan } from './model';

export interface GanttRect {
  x: number;
  y: number;
  w: number;
  h: number;
  span: TileSpan;
}

export function ganttLayout(
  spans: readonly TileSpan[],
  threads: number,
  t0: number,
  t1: number,
  width: number,
  rowH: number,
): GanttRect[] {
  const scale = t1 > t0 ? width / (t1 - t0) : 0;
  void threads;
  return spans.map((span) => ({
    x: (span.start - t0) * scale,
    y: span.thread * rowH,
    w: Math.max(1, (span.end - span.start) * scale),
    h: rowH,
    span,
  }));
}

export function hitTest(rects: readonly GanttRect[], x: number, y: number): TileSpan | null {
  for (const r of rects) if (x >= r.x && x <= r.x + r.w && y >= r.y && y < r.y + r.h) return r.span;
  return null;
}

const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export function drawGantt(
  ctx: CanvasRenderingContext2D,
  rects: readonly GanttRect[],
  threads: number,
  width: number,
  rowH: number,
  labelW: number,
): void {
  ctx.clearRect(0, 0, width + labelW, threads * rowH);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let t = 0; t < threads; t++) {
    ctx.fillStyle = '#8a8a96';
    ctx.fillText(`T${t}`, 2, t * rowH + rowH / 2);
    ctx.fillStyle = t % 2 ? '#1a1a22' : '#16161d';
    ctx.fillRect(labelW, t * rowH, width, rowH);
  }
  for (const r of rects) {
    ctx.fillStyle = css(threadColor(r.span.thread));
    // 1px surface gap between neighbouring tiles of the same thread.
    ctx.fillRect(labelW + r.x, r.y + 1, Math.max(1, r.w - 1), r.h - 2);
  }
}

export function drawKernelTimeline(
  ctx: CanvasRenderingContext2D,
  samples: readonly { iteration: number; ms: number }[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (samples.length < 2) return;
  const max = Math.max(...samples.map((s) => s.ms));
  ctx.strokeStyle = '#3987e5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = (i / (samples.length - 1)) * width;
    const y = height - 4 - (s.ms / max) * (height - 16);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#8a8a96';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(`max ${max.toFixed(3)} ms / generation`, 4, 10);
}
