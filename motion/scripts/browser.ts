// Shared by still.ts and render.ts: serves the film with Vite and drives it in headless Chrome.
import { writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import { createServer } from 'vite'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The master's ceiling: the soundtrack must never get closer to clipping. */
const MAX_PEAK_DBFS = -1
const FONT_WEIGHTS = ['400', '600', '700']

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))))
    })
  })
}

/** Sample peak of a 16-bit PCM WAV (44-byte header), in dBFS. */
function peakDbfs(wav: Buffer): number {
  let peak = 0
  for (let o = 44; o + 1 < wav.length; o += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(o)))
  return 20 * Math.log10(peak / 32768)
}

export interface MotionPage {
  page: Page
  /** True once the page has thrown or logged an error: whatever it renders next is suspect. */
  failed(): boolean
  close(): Promise<void>
}

/** Starts Vite and Chrome, and returns the film's page once its fonts are ready. */
export async function openMotionPage(): Promise<MotionPage> {
  const port = await freePort()
  const server = await createServer({
    root,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  })
  await server.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(async (err) => {
    await server.close()
    throw err
  })
  const close = async () => {
    await browser.close()
    await server.close()
  }
  let failed = false
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 })
    page.on('pageerror', (err) => {
      failed = true
      console.error(`[pageerror] ${err.stack ?? err.message}`)
    })
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      failed = true
      console.error(`[console.error] ${msg.text()}`)
    })
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction(() => window.motionReady !== undefined)
    await page.evaluate(() => window.motionReady)
    await assertFontsLoaded(page)
    return { page, failed: () => failed, close }
  } catch (err) {
    await close()
    throw err
  }
}

/**
 * document.fonts.check() also passes when no face matches at all, so a silent fallback font could
 * slip into the film: require each weight's Space Grotesk face to be actually loaded.
 */
async function assertFontsLoaded(page: Page): Promise<void> {
  const missing = await page.evaluate((weights) => {
    const loaded = new Set<string>()
    document.fonts.forEach((face) => {
      if (face.family.replace(/["']/g, '') === 'Space Grotesk' && face.status === 'loaded') loaded.add(face.weight)
    })
    return weights.filter((w) => !loaded.has(w))
  }, FONT_WEIGHTS)
  if (missing.length > 0) throw new Error(`Space Grotesk is not loaded for weight(s) ${missing.join(', ')}`)
}

/** Renders frame `i` and returns the stage as PNG bytes. */
export async function renderPng(page: Page, i: number): Promise<Buffer> {
  // toDataURL, never getImageData: reading pixels back moves Chrome's canvas to software
  // rendering, which changes how every later frame is drawn.
  const url = await page.evaluate(async (frame) => {
    await window.renderFrame(frame)
    return document.querySelector<HTMLCanvasElement>('#stage')!.toDataURL('image/png')
  }, i)
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

/** Renders the soundtrack to out/audio.wav; throws if it peaks above the master's ceiling. */
export async function writeAudio(page: Page): Promise<void> {
  const t0 = performance.now()
  const wav = Buffer.from(await page.evaluate(() => window.renderAudioWav()), 'base64')
  const file = join(root, 'out', 'audio.wav')
  await writeFile(file, wav)
  const peak = peakDbfs(wav)
  console.log(`${file} (${Math.round(performance.now() - t0)} ms, peak ${peak.toFixed(2)} dBFS)`)
  if (peak > MAX_PEAK_DBFS) throw new Error(`audio peak ${peak.toFixed(2)} dBFS is over ${MAX_PEAK_DBFS} dBFS`)
}
