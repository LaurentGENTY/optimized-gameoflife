import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// BENCH_SIZES="512,1024" npm run bench:headless → writes ../bench/web.json
test('benchmark every engine', async ({ page }) => {
  const sizes = (process.env.BENCH_SIZES ?? '512,1024').split(',');
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
  writeFileSync(new URL('../../bench/web.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  expect(report!.rows.filter((r) => r.status !== 'ok')).toEqual([]);
});
