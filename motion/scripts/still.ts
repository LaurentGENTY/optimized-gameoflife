// Renders single frames of the film to PNG: `node scripts/still.ts <frame...>`; `--audio` also
// renders the soundtrack to out/audio.wav.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openMotionPage, renderPng, root, writeAudio } from './browser.ts'

const outDir = join(root, 'out', 'stills')

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

const motion = await openMotionPage()
let failed = false
try {
  await mkdir(outDir, { recursive: true })
  for (const frame of frames) {
    const t0 = performance.now()
    const file = join(outDir, `${frame}.png`)
    await writeFile(file, await renderPng(motion.page, frame))
    console.log(`${file} (${Math.round(performance.now() - t0)} ms)`)
  }
  if (audio) await writeAudio(motion.page)
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await motion.close()
}
if (failed || motion.failed()) process.exitCode = 1
