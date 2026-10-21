// Renders every frame of the film to out/frames/<5-digit>.png, then the soundtrack to out/audio.wav.
// Resumable: frames already on disk are skipped, so an interrupted run just starts again.
// `node scripts/render.ts <first> <last>` renders only that inclusive range (a scene preview).
import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TOTAL_FRAMES } from '../src/timeline.ts'
import { openMotionPage, renderPng, root, writeAudio } from './browser.ts'

const framesDir = join(root, 'out', 'frames')
const PROGRESS_EVERY = 60

function clock(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const range = process.argv.slice(2).map(Number)
if (range.length !== 0 && (range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[0] > range[1] || range[1] >= TOTAL_FRAMES)) {
  console.error(`usage: node scripts/render.ts [<first> <last>], 0 <= first <= last < ${TOTAL_FRAMES}`)
  process.exit(2)
}
const [first, last] = range.length ? range : [0, TOTAL_FRAMES - 1]
const count = last - first + 1

await mkdir(framesDir, { recursive: true })
const todo: number[] = []
for (let i = first; i <= last; i++) {
  if (!existsSync(join(framesDir, `${String(i).padStart(5, '0')}.png`))) todo.push(i)
}
console.log(`${count - todo.length}/${count} frames already rendered, ${todo.length} to go`)

const motion = await openMotionPage()
let failed = false
try {
  const t0 = performance.now()
  for (const [n, i] of todo.entries()) {
    const png = await renderPng(motion.page, i)
    // Never keep a frame rendered after a page error: the resumed run will redo it.
    if (motion.failed()) throw new Error(`page error while rendering frame ${i}`)
    const file = join(framesDir, `${String(i).padStart(5, '0')}.png`)
    // Write then rename, so a crash mid-write never leaves a truncated PNG that resume would skip.
    await writeFile(`${file}.tmp`, png)
    await rename(`${file}.tmp`, file)
    const done = n + 1
    if (done % PROGRESS_EVERY === 0 || done === todo.length) {
      const elapsed = performance.now() - t0
      const eta = (elapsed / done) * (todo.length - done)
      console.log(`frame ${i} · ${done}/${todo.length} · elapsed ${clock(elapsed)} · ETA ${clock(eta)}`)
    }
  }
  await writeAudio(motion.page)
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await motion.close()
}
if (failed || motion.failed()) process.exitCode = 1
