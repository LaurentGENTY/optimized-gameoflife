import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const OUT = new URL('../../docs/media/', import.meta.url);

async function choose(page: Page, select: string, value: string, settleMs = 1200) {
  await page.selectOption(select, value);
  await page.waitForTimeout(settleMs);
}

async function play(page: Page, ms: number) {
  await page.click('#play');
  await page.waitForTimeout(ms);
  await page.click('#play');
  await page.waitForTimeout(300);
}

test.afterEach(async ({ page }, info) => {
  mkdirSync(OUT, { recursive: true });
  await page.close();
  await page.video()?.saveAs(new URL(`raw-${info.title}.webm`, OUT).pathname);
});

test('live', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await play(page, 2500); // wasm-seq, Gosper guns 512²
  await choose(page, '#engine', 'wasm-simd');
  await play(page, 2500);
  await choose(page, '#engine', 'wasm-mt', 1800);
  await choose(page, '#size', '1024');
  await choose(page, '#preset', 'random');
  await page.check('#monitoring');
  await page.waitForTimeout(1800);
  await page.selectOption('#m-overlay', 'thread');
  await play(page, 5000);
  await choose(page, '#engine', 'webgpu-naive', 1800);
  await play(page, 4000);
});

test('bench', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1000);
  await page.click('#t-bench');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    for (const i of document.querySelectorAll<HTMLInputElement>('#b-sizes input')) i.checked = ['512', '1024'].includes(i.value);
    for (const i of document.querySelectorAll<HTMLInputElement>('#b-engines input')) i.checked = !i.disabled;
  });
  await page.click('#b-run');
  await expect(page.locator('#b-run')).toHaveText('Run', { timeout: 600_000 });
  await page.waitForTimeout(3000);
  await page.locator('#bench-view table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
});
