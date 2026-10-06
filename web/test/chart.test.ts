import { describe, expect, it } from 'vitest';
import { buildChartSvg, formatRate, logTicks, type ChartSeries } from '../src/bench/chart';

const SERIES: ChartSeries[] = [
  { id: 'a', label: 'Engine A', color: '#3987e5' },
  { id: 'b', label: 'Engine <B>', color: '#d95926' },
  { id: 'n', label: 'Native', color: '#008300', hatched: true },
];

function bars(svg: string) {
  return [...svg.matchAll(/<path class="bar" data-series="([^"]+)" data-size="(\d+)" data-h="([\d.]+)"/g)].map((m) => ({
    series: m[1],
    size: Number(m[2]),
    h: Number(m[3]),
  }));
}

const base = { title: 'Random 50%', sizes: [512, 1024], series: SERIES, width: 600, height: 300 };

describe('chart helpers', () => {
  it('logTicks covers the range with powers of ten', () => {
    expect(logTicks(3, 2500)).toEqual([1, 10, 100, 1000, 10000]);
    expect(logTicks(100, 100)).toEqual([100, 1000]);
  });

  it('formatRate is compact', () => {
    expect([0.5, 12, 1234, 35000, 1.5e6].map(formatRate)).toEqual(['0.5', '12', '1.2k', '35k', '1.5M']);
  });
});

describe('buildChartSvg', () => {
  it('draws one bar per datum, taller for faster engines', () => {
    const svg = buildChartSvg({
      ...base,
      data: [
        { seriesId: 'a', size: 512, value: 100 },
        { seriesId: 'b', size: 512, value: 10000 },
        { seriesId: 'a', size: 1024, value: 30 },
      ],
    });
    const b = bars(svg);
    expect(b).toHaveLength(3);
    const h = (s: string, size: number) => b.find((x) => x.series === s && x.size === size)!.h;
    expect(h('b', 512)).toBeGreaterThan(h('a', 512));
    expect(h('a', 512)).toBeGreaterThan(h('a', 1024));
  });

  it('gives each bar a tooltip and escapes labels', () => {
    const svg = buildChartSvg({ ...base, data: [{ seriesId: 'b', size: 512, value: 1234 }] });
    expect(svg).toContain('<title>Engine &lt;B&gt; · 512² · 1.2k gens/s</title>');
    expect(svg).not.toContain('Engine <B>');
  });

  it('fills hatched series with a pattern', () => {
    const svg = buildChartSvg({ ...base, data: [{ seriesId: 'n', size: 1024, value: 50 }] });
    expect(svg).toMatch(/<pattern id="hatch-n"/);
    expect(svg).toContain('fill="url(#hatch-n)"');
  });

  it('shows a message instead of an empty plot when there is no data', () => {
    const svg = buildChartSvg({ ...base, data: [] });
    expect(bars(svg)).toHaveLength(0);
    expect(svg).toContain('No valid results');
  });
});
