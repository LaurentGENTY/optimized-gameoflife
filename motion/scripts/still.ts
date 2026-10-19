// Renders single frames of the film to PNG: `node scripts/still.ts <frame...>`; `--audio` also
// renders the soundtrack to out/audio.wav.
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out', 'stills')

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

/** The master's ceiling: the soundtrack must never get closer to clipping. */
const MAX_PEAK_DBFS = -1

/** Sample peak of a 16-bit PCM WAV (44-byte header), in dBFS. */
function peakDbfs(wav: Buffer): number {
  let peak = 0
  for (let o = 44; o + 1 < wav.length; o += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(o)))
  return 20 * Math.log10(peak / 32768)
}

const args = process.argv.slice(2)
const audio = args.includes('--audio')
const frames = args.filter((a) => a !== '--audio').map((a) => {
  const n = Number(a)
  if (!Number.isInteger(n) || n < 0) throw new Error(`frame must be a non-negative integer, got "${a}"`)
  return n
})
if (frames.length === 0 && !audio) {
  console.error('usage: node scripts/still.ts [--audio] <frame...>')
  process.exit(2)
}

const port = await freePort()
const server = await createServer({
  root,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
  await mkdir(outDir, { recursive: true })
  for (const frame of frames) {
    const t0 = performance.now()
    const url = await page.evaluate(async (i) => {
      await window.renderFrame(i)
      return document.querySelector<HTMLCanvasElement>('#stage')!.toDataURL('image/png')
    }, frame)
    const file = join(outDir, `${frame}.png`)
    await writeFile(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    console.log(`${file} (${Math.round(performance.now() - t0)} ms)`)
  }
  if (audio) {
    const t0 = performance.now()
    const wav = Buffer.from(await page.evaluate(() => window.renderAudioWav()), 'base64')
    const file = join(root, 'out', 'audio.wav')
    await writeFile(file, wav)
    const peak = peakDbfs(wav)
    console.log(`${file} (${Math.round(performance.now() - t0)} ms, peak ${peak.toFixed(2)} dBFS)`)
    if (peak > MAX_PEAK_DBFS) throw new Error(`audio peak ${peak.toFixed(2)} dBFS is over ${MAX_PEAK_DBFS} dBFS`)
  }
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exitCode = 1
