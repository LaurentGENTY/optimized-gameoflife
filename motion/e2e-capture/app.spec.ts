import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const OUT = fileURLToPath(new URL('../out/', import.meta.url))
const FRAMES = join(OUT, 'app-frames')
const SIZE = { width: 1440, height: 900 }
const PLAY_MS = 13_000

async function choose(page: Page, select: string, value: string, settleMs = 1200) {
  await page.selectOption(select, value)
  await page.waitForTimeout(settleMs)
}

/**
 * Encodes timestamped screencast JPEGs to a constant 60 fps webm, each frame held until the next
 * one arrived. Playwright's own recorder needs a private ffmpeg download; the system ffmpeg
 * (already required by `npm run capture`) does the job.
 */
function encode(frames: { data: Buffer; timestamp: number }[], endMs: number, out: string): void {
  rmSync(FRAMES, { recursive: true, force: true })
  mkdirSync(FRAMES, { recursive: true })
  const list = ['ffconcat version 1.0']
  frames.forEach((f, i) => {
    const name = `${String(i).padStart(5, '0')}.jpg`
    writeFileSync(join(FRAMES, name), f.data)
    const next = i + 1 < frames.length ? frames[i + 1].timestamp : endMs
    list.push(`file '${name}'`, `duration ${((next - f.timestamp) / 1000).toFixed(6)}`)
  })
  // The concat demuxer ignores the last duration unless the last file is listed again.
  list.push(`file '${String(frames.length - 1).padStart(5, '0')}.jpg'`)
  writeFileSync(join(FRAMES, 'list.ffconcat'), list.join('\n') + '\n')
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(FRAMES, 'list.ffconcat'),
      '-fps_mode', 'cfr', '-r', '60', '-c:v', 'libvpx-vp9', '-crf', '16', '-b:v', '0', '-row-mt', '1',
      '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', out],
    { stdio: 'inherit' },
  )
  rmSync(FRAMES, { recursive: true, force: true })
}

// wasm-mt, random 1024², monitoring with the tile → thread overlay: the frames scene 4 shows.
test('app', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => crossOriginIsolated), 'wasm-mt needs cross-origin isolation').toBe(true)
  await choose(page, '#engine', 'wasm-mt', 1800)
  await choose(page, '#size', '1024')
  await choose(page, '#preset', 'random')
  await page.check('#monitoring')
  await page.waitForTimeout(1800)
  await page.selectOption('#m-overlay', 'thread')
  await page.waitForTimeout(600)

  // Recording starts on the Play click, so the clip's t = 0 is the first generation.
  const frames: { data: Buffer; timestamp: number }[] = []
  await page.screencast.start({ size: SIZE, quality: 92, onFrame: ({ data, timestamp }) => void frames.push({ data, timestamp }) })
  await page.click('#play')
  await page.waitForTimeout(PLAY_MS)
  const endMs = Date.now()
  await page.screencast.stop()
  await page.click('#play')

  expect(frames.length, 'screencast delivered too few frames').toBeGreaterThan(PLAY_MS / 100)
  expect(endMs - frames[0].timestamp).toBeGreaterThanOrEqual(PLAY_MS)
  mkdirSync(OUT, { recursive: true })
  encode(frames, endMs, join(OUT, 'app.webm'))
})
