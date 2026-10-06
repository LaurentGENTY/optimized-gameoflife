import { describe, expect, it } from 'vitest';
import { parseNativeReport, reportToJson } from '../src/bench/report';

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
