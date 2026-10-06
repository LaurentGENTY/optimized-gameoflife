import { expect, test } from '@playwright/test';

test('every engine matches wasm-seq in Chrome', async ({ page }) => {
  await page.goto('/?selftest');
  await expect(page).toHaveTitle(/^selftest: (pass|fail)$/, { timeout: 150_000 });
  const results = await page.evaluate(() => window.__selftest ?? []);
  const failures = results.filter((r) => !r.ok).map((r) => `${r.engineId} ${r.testCase.presetId} ${r.testCase.size}: ${r.error ?? `${r.actual} != ${r.expected}`}`);
  expect(failures).toEqual([]);
  expect(new Set(results.map((r) => r.engineId))).toEqual(new Set([
    'wasm-simd',
    'wasm-mt',
    'wasm-mt-trace',
    'webgpu-naive',
    'webgpu-tiled',
    'webgpu-naive-trace',
    'webgpu-tiled-trace',
  ]));
});
