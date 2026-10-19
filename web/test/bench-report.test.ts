import { describe, expect, it } from 'vitest';
import { mergeReports, parseNativeReport, reportToJson, type BenchReport } from '../src/bench/report';

describe('reportToJson', () => {
  it('round-trips the report with version and rows', () => {
    const r = {
      version: 1 as const,
      date: '2026-10-07T10:00:00.000Z',
      machine: { cores: 8, gpu: 'acme', userAgent: 'test' },
      guardGens: 32,
      rows: [{ engineId: 'a', presetId: 'random', size: 512, status: 'ok' as const, gensPerSec: 10 }],
    };
    expect(JSON.parse(reportToJson(r))).toEqual(r);
  });
});

describe('parseNativeReport', () => {
  it('accepts a well-formed native.json', () => {
    const n = { machine: 'M3', date: '2026-10-07', results: [{ variant: 'seq', presetId: 'random', size: 512, gensPerSec: 1200 }] };
    expect(parseNativeReport(n)).toEqual(n);
  });

  it('rejects malformed content instead of crashing the chart', () => {
    expect(parseNativeReport({ results: [{ variant: 'cuda', size: 'big' }] })).toBeNull();
    expect(parseNativeReport(null)).toBeNull();
  });
});

describe('mergeReports', () => {
  const machine = { cores: 8, gpu: 'acme', userAgent: 'test' };
  const report = (date: string, rows: BenchReport['rows'], m = machine): BenchReport => ({
    version: 1,
    date,
    machine: m,
    guardGens: 32,
    rows,
  });
  const row = (engineId: string, presetId: string, gensPerSec: number) => ({
    engineId,
    presetId,
    size: 1024,
    status: 'ok' as const,
    gensPerSec,
  });

  it('replaces a matching row in place, keeps the others and appends new rows', () => {
    const base = report('2026-10-06', [row('a', 'random', 1), row('b', 'random', 2), row('a', 'guns', 3)]);
    const extra = report('2026-10-19', [row('b', 'random', 20), row('a', 'bugs', 4)]);
    const merged = mergeReports(base, extra);
    expect(merged.rows).toEqual([row('a', 'random', 1), row('b', 'random', 20), row('a', 'guns', 3), row('a', 'bugs', 4)]);
    expect(merged.date).toBe('2026-10-19');
    expect(base.rows[1]!.gensPerSec).toBe(2);
  });

  it('throws when the machines differ', () => {
    const base = report('2026-10-06', []);
    expect(() => mergeReports(base, report('2026-10-19', [], { ...machine, cores: 4 }))).toThrow(/cores/);
    expect(() => mergeReports(base, report('2026-10-19', [], { ...machine, gpu: 'other' }))).toThrow(/gpu/);
  });
});
