// Renders single frames of the film to PNG: `node scripts/still.ts <frame...>`.
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

const frames = process.argv.slice(2).map((a) => {
  const n = Number(a)
  if (!Number.isInteger(n) || n < 0) throw new Error(`frame must be a non-negative integer, got "${a}"`)
  return n
})
if (frames.length === 0) {
  console.error('usage: node scripts/still.ts <frame...>')
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
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exitCode = 1
