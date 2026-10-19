import { readFileSync, writeFileSync } from 'node:fs';
import { mergeReports, type BenchReport } from '../src/bench/report';
import { expect, test } from '@playwright/test';

// BENCH_SIZES="512,1024" npm run bench:headless → writes ../bench/web.json
// BENCH_PRESETS=bugs,clown BENCH_MERGE=1 adds those rows to the existing file instead of replacing it.
test('benchmark every engine', async ({ page }) => {
  const sizes = (process.env.BENCH_SIZES ?? '512,1024').split(',');
  const presets = process.env.BENCH_PRESETS?.split(',').filter(Boolean);
  if (presets?.length) await page.addInitScript((ids) => (window.__benchPresets = ids), presets);
  await page.goto('/');
  await page.click('#t-bench');
  await page.evaluate((wanted) => {
    for (const i of document.querySelectorAll<HTMLInputElement>('#b-sizes input')) i.checked = wanted.includes(i.value);
    for (const i of document.querySelectorAll<HTMLInputElement>('#b-engines input')) i.checked = !i.disabled;
  }, sizes);
  await page.click('#b-run');
  await expect(page.locator('#b-run')).toHaveText('Run', { timeout: 1_700_000 });
  const report = await page.evaluate(() => window.__benchReport);
  expect(report, 'benchmark produced no report (see the bench view message)').toBeTruthy();
  const file = new URL('../../bench/web.json', import.meta.url);
  const out = process.env.BENCH_MERGE === '1' ? mergeReports(JSON.parse(readFileSync(file, 'utf8')) as BenchReport, report!) : report;
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  expect(report!.rows.filter((r) => r.status !== 'ok')).toEqual([]);
});
