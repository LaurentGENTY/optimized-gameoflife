export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  hatched?: boolean;
}

export interface ChartDatum {
  seriesId: string;
  size: number;
  value: number;
}

// Dark categorical palette, validated against the panel surface #15151c (all checks pass).
export const ENGINE_COLORS: Record<string, string> = {
  'wasm-seq': '#3987e5',
  'wasm-simd': '#d95926',
  'wasm-mt': '#199e70',
  'webgpu-naive': '#c98500',
  'webgpu-tiled': '#d55181',
};

export const NATIVE_SERIES: readonly ChartSeries[] = [
  { id: 'native-seq', label: 'C 2020 native — seq', color: '#008300', hatched: true },
  { id: 'native-omp_tiled', label: 'C 2020 native — OpenMP tiled', color: '#9085e9', hatched: true },
  { id: 'native-ocl', label: 'C 2020 native — OpenCL', color: '#e66767', hatched: true },
];

const SURFACE = '#15151c';
const INK = '#e6e6ea';
const MUTED = '#8a8a96';
const GRID = '#2a2a33';

export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)));
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e++) ticks.push(10 ** e);
  return ticks;
}

export function formatRate(v: number): string {
  const trim = (x: number) => (x >= 10 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());
  if (v >= 1e6) return `${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${trim(v / 1e3)}k`;
  return trim(v);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bar rising from the baseline, 4px rounded top corners.
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function buildChartSvg(o: {
  title: string;
  sizes: readonly number[];
  series: readonly ChartSeries[];
  data: readonly ChartDatum[];
  width: number;
  height: number;
}): string {
  const m = { top: 28, right: 12, bottom: 32, left: 52 };
  const plotW = o.width - m.left - m.right;
  const plotH = o.height - m.top - m.bottom;
  const base = m.top + plotH;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="100%" role="img" aria-label="${esc(o.title)}" font-family="system-ui, sans-serif" font-size="11">`;
  const title = `<text x="${m.left}" y="16" fill="${INK}" font-size="13" font-weight="600">${esc(o.title)}</text>`;
  const values = o.data.map((d) => d.value).filter((v) => v > 0);
  if (values.length === 0) {
    return `${head}${title}<text x="${o.width / 2}" y="${o.height / 2}" fill="${MUTED}" text-anchor="middle">No valid results</text></svg>`;
  }

  const ticks = logTicks(Math.min(...values), Math.max(...values));
  const lo = Math.log10(ticks[0]);
  const hi = Math.log10(ticks[ticks.length - 1]);
  const y = (v: number) => base - ((Math.log10(v) - lo) / (hi - lo)) * plotH;

  const parts: string[] = [head, title];
  const defs = o.series
    .filter((s) => s.hatched)
    .map(
      (s) =>
        `<pattern id="hatch-${esc(s.id)}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">` +
        `<rect width="6" height="6" fill="${s.color}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${SURFACE}" stroke-width="2"/></pattern>`,
    );
  if (defs.length) parts.push(`<defs>${defs.join('')}</defs>`);

  for (const t of ticks) {
    const ty = y(t);
    parts.push(`<line x1="${m.left}" x2="${m.left + plotW}" y1="${ty}" y2="${ty}" stroke="${GRID}"/>`);
    parts.push(`<text x="${m.left - 6}" y="${ty + 4}" fill="${MUTED}" text-anchor="end">${formatRate(t)}</text>`);
  }
  parts.push(`<text x="12" y="${m.top + plotH / 2}" fill="${MUTED}" transform="rotate(-90 12 ${m.top + plotH / 2})" text-anchor="middle">gens/s (log)</text>`);

  const groupW = plotW / o.sizes.length;
  o.sizes.forEach((size, gi) => {
    const present = o.series.filter((s) => o.data.some((d) => d.seriesId === s.id && d.size === size));
    const slot = Math.min(18, (groupW * 0.8) / Math.max(1, present.length));
    const barW = slot - 2; // 2px surface gap between adjacent bars
    const x0 = m.left + gi * groupW + (groupW - slot * present.length) / 2;
    present.forEach((s, si) => {
      const d = o.data.find((q) => q.seriesId === s.id && q.size === size)!;
      const top = y(d.value);
      const fill = s.hatched ? `url(#hatch-${esc(s.id)})` : s.color;
      parts.push(
        `<path class="bar" data-series="${esc(s.id)}" data-size="${size}" data-h="${(base - top).toFixed(2)}" d="${barPath(x0 + si * slot, barW, top, base)}" fill="${fill}">` +
          `<title>${esc(s.label)} · ${size}² · ${formatRate(d.value)} gens/s</title></path>`,
      );
    });
    parts.push(`<text x="${m.left + gi * groupW + groupW / 2}" y="${base + 18}" fill="${MUTED}" text-anchor="middle">${size}²</text>`);
  });
  parts.push(`<line x1="${m.left}" x2="${m.left + plotW}" y1="${base}" y2="${base}" stroke="${MUTED}"/>`);
  parts.push('</svg>');
  return parts.join('');
}
