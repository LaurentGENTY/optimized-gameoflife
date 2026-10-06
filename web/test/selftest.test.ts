import { describe, expect, it } from 'vitest';
import type { Engine } from '../src/engine';
import { createGrid } from '../src/grid';
import { runSelfTest } from '../src/selftest/selftest';
import { BrokenEngine, FakeEngine } from './fakes';

function deps(make: Record<string, () => FakeEngine>) {
  const created: FakeEngine[] = [];
  return {
    created,
    deps: {
      referenceId: 'ref',
      engineIds: Object.keys(make).filter((id) => id !== 'ref'),
      createEngine: (id: string): Engine => {
        const e = make[id]();
        created.push(e);
        return e;
      },
      buildGrid: (_p: string, size: number) => createGrid(size),
    },
  };
}

const CASE = { presetId: 'random', size: 16, gens: 10 };

describe('runSelfTest', () => {
  it('passes an engine whose hash matches the reference', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), good: () => new FakeEngine() });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'good', ok: true, expected: '10', actual: '10' });
  });

  it('flags an engine whose hash differs', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), bad: () => new BrokenEngine() });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'bad', ok: false, expected: '10', actual: '11' });
  });

  it('records an engine that throws and still disposes every engine', async () => {
    const { deps: d, created } = deps({
      ref: () => new FakeEngine(),
      boom: () => {
        const e = new FakeEngine();
        e.initError = new Error('no adapter');
        return e;
      },
    });
    const [r] = await runSelfTest(d, [CASE]);
    expect(r).toMatchObject({ engineId: 'boom', ok: false, actual: null, error: 'no adapter' });
    expect(created.every((e) => e.disposed)).toBe(true);
  });

  it('returns one row per engine and case', async () => {
    const { deps: d } = deps({ ref: () => new FakeEngine(), a: () => new FakeEngine(), b: () => new FakeEngine() });
    const rows = await runSelfTest(d, [CASE, { ...CASE, gens: 3 }]);
    expect(rows.map((r) => `${r.engineId}:${r.testCase.gens}`)).toEqual(['a:10', 'b:10', 'a:3', 'b:3']);
  });
});
