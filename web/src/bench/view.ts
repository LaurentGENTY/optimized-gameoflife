import { getPreset } from '../patterns/presets';
import { visibleEngines } from '../engines/registry';
import { buildChartSvg, ENGINE_COLORS, formatRate, NATIVE_SERIES, type ChartDatum, type ChartSeries } from './chart';
import type { BenchReport, NativeReport } from './report';
import { BENCH_PRESETS } from './run';

function engineSeries(): ChartSeries[] {
  return visibleEngines().map((e) => ({ id: e.id, label: e.label, color: ENGINE_COLORS[e.id] ?? '#8a8a96' }));
}

export function renderBenchView(
  root: HTMLElement,
  report: BenchReport | null,
  native: NativeReport | null,
  progress: string | null,
): void {
  root.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Benchmark — generations per second (higher is better)';
  root.append(h);
  const info = document.createElement('p');
  info.className = 'machine';
  info.textContent = report
    ? `${report.machine.cores} logical cores · ${report.machine.gpu} · ${new Date(report.date).toLocaleString('en')} · guard: hash vs wasm-seq after ${report.guardGens} gens`
    : 'Pick engines and sizes in the panel, then Run. Rendering is paused while measuring.';
  root.append(info);
  if (progress) {
    const p = document.createElement('p');
    p.className = 'stats';
    p.textContent = progress;
    root.append(p);
  }
  if (!report) return;

  // Only native variants that were actually measured (OpenCL could not run natively).
  const measured = new Set(native?.results.map((r) => `native-${r.variant}`));
  const series = [...engineSeries(), ...NATIVE_SERIES.filter((n) => measured.has(n.id))];
  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const s of series) {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.backgroundColor = s.color;
    if (s.hatched) sw.className = 'hatched';
    item.append(sw, s.label);
    legend.append(item);
  }
  root.append(legend);

  const charts = document.createElement('div');
  charts.className = 'charts';
  for (const presetId of BENCH_PRESETS) {
    const rows = report.rows.filter((r) => r.presetId === presetId);
    if (rows.length === 0) continue;
    const sizes = [...new Set(rows.map((r) => r.size))].sort((a, b) => a - b);
    const data: ChartDatum[] = rows
      .filter((r) => r.status === 'ok' && r.gensPerSec)
      .map((r) => ({ seriesId: r.engineId, size: r.size, value: r.gensPerSec! }));
    for (const n of native?.results ?? [])
      if (n.presetId === presetId && sizes.includes(n.size))
        data.push({ seriesId: `native-${n.variant}`, size: n.size, value: n.gensPerSec });
    const box = document.createElement('div');
    box.className = 'chart';
    // buildChartSvg escapes every label; the SVG is generated locally from numbers.
    box.innerHTML = buildChartSvg({ title: getPreset(presetId).label, sizes, series, data, width: 560, height: 280 });
    charts.append(box);
  }
  root.append(charts);

  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const t of ['engine', 'pattern', 'size', 'gens/s', 'Gcells/s', 'runs (ms)', 'status']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.append(th);
  }
  const body = table.createTBody();
  for (const r of report.rows) {
    const row = body.insertRow();
    const cells = [
      r.engineId,
      r.presetId,
      `${r.size}²`,
      r.gensPerSec ? formatRate(r.gensPerSec) : '—',
      r.gcellsPerSec ? r.gcellsPerSec.toFixed(2) : '—',
      r.runsMs ? r.runsMs.map((ms) => ms.toFixed(0)).join(' / ') : '—',
      r.status === 'ok' ? 'ok' : r.status === 'invalid' ? 'INVALID (hash mismatch, excluded)' : `error: ${r.error}`,
    ];
    for (const c of cells) row.insertCell().textContent = c;
  }
  root.append(table);
}
