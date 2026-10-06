import type { Engine } from '../engine';
import type { Grid } from '../grid';

export interface SelfTestCase {
  presetId: string;
  size: number;
  gens: number;
}

export interface SelfTestResult {
  engineId: string;
  testCase: SelfTestCase;
  expected: string;
  actual: string | null;
  ok: boolean;
  error?: string;
}

export interface SelfTestDeps {
  referenceId: string;
  engineIds: readonly string[];
  createEngine(id: string): Engine;
  buildGrid(presetId: string, size: number): Grid;
}

// 100 is deliberately not a multiple of the 16×16 workgroup.
export const SELFTEST_CASES: readonly SelfTestCase[] = [
  { presetId: 'random', size: 100, gens: 37 },
  { presetId: 'random', size: 256, gens: 100 },
  { presetId: 'guns', size: 256, gens: 300 },
  { presetId: 'random', size: 1024, gens: 50 },
];

async function hashAfter(engine: Engine, grid: Grid, gens: number): Promise<string> {
  try {
    await engine.init(grid);
    await engine.step(gens);
    return await engine.hash();
  } finally {
    engine.dispose();
  }
}

export async function runSelfTest(deps: SelfTestDeps, cases: readonly SelfTestCase[]): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  for (const testCase of cases) {
    const grid = deps.buildGrid(testCase.presetId, testCase.size);
    const expected = await hashAfter(deps.createEngine(deps.referenceId), grid, testCase.gens);
    for (const engineId of deps.engineIds) {
      try {
        const actual = await hashAfter(deps.createEngine(engineId), grid, testCase.gens);
        results.push({ engineId, testCase, expected, actual, ok: actual === expected });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ engineId, testCase, expected, actual: null, ok: false, error });
      }
    }
  }
  return results;
}
