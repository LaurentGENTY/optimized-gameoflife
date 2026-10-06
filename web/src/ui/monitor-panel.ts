import { overlayValues, threadColor } from '../monitor/colors';
import type { CpuMonitor, GpuMonitor } from '../monitor/model';
import { drawGantt, drawKernelTimeline, ganttLayout, hitTest, type GanttRect } from '../monitor/views';

export type OverlayMode = 'off' | 'thread' | 'heat';

export interface MonitorPanelOptions {
  cores: number;
  onOverlay(mode: OverlayMode): void;
}

const ROW_H = 10;
const LABEL_W = 26;
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export function createMonitorPanel(root: HTMLElement, opts: MonitorPanelOptions) {
  let rects: GanttRect[] = [];
  let mode: 'cpu' | 'gpu' = 'cpu';
  root.innerHTML = `
    <div class="cpu">
      <label>Overlay <select id="m-overlay"><option value="off">off</option><option value="thread">tile → thread</option><option value="heat">tile → duration (heat)</option></select></label>
      <p>Last iterations, one row per thread. Blank = tile skipped by lazy tiling.</p>
      <canvas id="m-gantt" height="160"></canvas>
      <p class="tip" id="m-tip"></p>
      <div class="activity" id="m-activity"></div>
      <p id="m-lost"></p>
      <p>Browsers do not expose which physical core runs a worker: rows are threads, not cores (navigator.hardwareConcurrency = ${opts.cores}).</p>
    </div>
    <div class="gpu" hidden>
      <p>Kernel time per generation (GPU timestamps).</p>
      <canvas id="m-kernel" height="120"></canvas>
      <p>No per-thread information on GPU: kernel time per generation only.</p>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const gantt = $<HTMLCanvasElement>('#m-gantt');
  const overlay = $<HTMLSelectElement>('#m-overlay');
  overlay.onchange = () => opts.onOverlay(overlay.value as OverlayMode);
  gantt.onmousemove = (ev) => {
    const r = gantt.getBoundingClientRect();
    const s = hitTest(rects, ((ev.clientX - r.left) * gantt.width) / r.width - LABEL_W, ((ev.clientY - r.top) * gantt.height) / r.height);
    $('#m-tip').textContent = s ? `thread ${s.thread} · tile ${s.tile} · iteration ${s.iteration} · ${(s.end - s.start).toFixed(3)} ms` : '';
  };

  return {
    showMode(m: 'cpu' | 'gpu') {
      mode = m;
      $('.cpu').hidden = m !== 'cpu';
      $('.gpu').hidden = m !== 'gpu';
    },
    overlayMode: (): OverlayMode => (mode === 'cpu' ? (overlay.value as OverlayMode) : 'off'),
    renderCpu(m: CpuMonitor) {
      const { spans, t0, t1 } = m.window();
      const width = gantt.clientWidth - LABEL_W;
      gantt.width = gantt.clientWidth;
      gantt.height = Math.max(ROW_H, m.threads * ROW_H);
      rects = ganttLayout(spans, m.threads, t0, t1, width, ROW_H);
      drawGantt(gantt.getContext('2d')!, rects, m.threads, width, ROW_H, LABEL_W);
      const act = $('#m-activity');
      act.replaceChildren();
      m.activity().forEach((pct, t) => {
        const label = document.createElement('span');
        label.textContent = `T${t}`;
        const bar = document.createElement('i');
        bar.style.width = `${pct}%`;
        bar.style.background = css(threadColor(t));
        const val = document.createElement('span');
        val.textContent = `${pct.toFixed(0)}%`;
        act.append(label, bar, val);
      });
      $('#m-lost').textContent = m.lost ? `${m.lost} tile records dropped (trace ring full between frames)` : '';
    },
    renderGpu(m: GpuMonitor) {
      const k = $<HTMLCanvasElement>('#m-kernel');
      k.width = k.clientWidth;
      drawKernelTimeline(k.getContext('2d')!, m.samples(), k.width, k.height);
    },
    overlayFor(m: CpuMonitor) {
      const tiles = m.latestTiles();
      const o = overlay.value as OverlayMode;
      return tiles && o !== 'off' ? { mode: o, tilesPerSide: tiles.tilesPerSide, values: overlayValues(o, tiles) } : null;
    },
  };
}
