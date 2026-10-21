// Checks the film's outputs against the deliverables: `--frames` before encoding (the PNG sequence),
// no flag after encoding (the master, film and loop, through ffprobe). Exits 1 naming each failure.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FPS, TOTAL_FRAMES } from '../src/timeline.ts'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
const MB = 1_000_000
const FILM_S = TOTAL_FRAMES / FPS
const frameName = (i: number) => `${String(i).padStart(5, '0')}.png`

interface Probe {
  streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[]
  format: { duration?: string; size?: string }
}

const failures: string[] = []
function check(name: string, ok: boolean, actual: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${actual})`)
  if (!ok) failures.push(name)
}

function checkFrames(): void {
  const dir = join(out, 'frames')
  const pngs = new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [])
  const expected = Array.from({ length: TOTAL_FRAMES }, (_, i) => frameName(i))
  const missing = expected.filter((f) => !pngs.has(f))
  const wanted = new Set(expected)
  const extra = [...pngs].filter((f) => !wanted.has(f))
  const empty = expected.filter((f) => pngs.has(f) && statSync(join(dir, f)).size === 0)
  check(`frames: exactly ${TOTAL_FRAMES} PNGs`, pngs.size === TOTAL_FRAMES, `${pngs.size} PNGs`)
  check(`frames: ${frameName(0).slice(0, 5)}-${frameName(TOTAL_FRAMES - 1).slice(0, 5)} all present`, missing.length === 0, `missing ${missing.slice(0, 5).join(' ') || 'none'}`)
  check('frames: no unexpected PNG', extra.length === 0, `extra ${extra.slice(0, 5).join(' ') || 'none'}`)
  check('frames: no empty PNG', empty.length === 0, `empty ${empty.slice(0, 5).join(' ') || 'none'}`)
}

function probe(file: string): Probe | null {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    encoding: 'utf8',
  })
  if (r.status !== 0) return null
  return JSON.parse(r.stdout) as Probe
}

function checkVideo(
  label: string,
  file: string,
  want: { width: number; height: number; fps?: string; duration?: [number, number]; audio: 'none' | 'one' | 'some'; maxMB?: number },
): void {
  const p = probe(join(out, file))
  check(`${label}: ${file} readable by ffprobe`, p !== null, p ? 'ok' : 'missing or unreadable')
  if (!p) return
  const video = p.streams.filter((s) => s.codec_type === 'video')
  const audio = p.streams.filter((s) => s.codec_type === 'audio').length
  const v = video[0]
  check(`${label}: one video stream`, video.length === 1, `${video.length}`)
  check(`${label}: ${want.width}x${want.height}`, v?.width === want.width && v?.height === want.height, `${v?.width}x${v?.height}`)
  if (want.fps) check(`${label}: ${want.fps} fps`, v?.r_frame_rate === want.fps, `${v?.r_frame_rate}`)
  if (want.duration) {
    const [target, tol] = want.duration
    const d = Number(p.format.duration)
    check(`${label}: ${target} s ± ${tol}`, Math.abs(d - target) <= tol, `${d} s`)
  }
  const audioOk = want.audio === 'none' ? audio === 0 : want.audio === 'one' ? audio === 1 : audio >= 1
  check(`${label}: audio streams ${want.audio}`, audioOk, `${audio}`)
  if (want.maxMB) {
    const size = Number(p.format.size)
    check(`${label}: <= ${want.maxMB} MB`, size <= want.maxMB * MB, `${(size / MB).toFixed(2)} MB`)
  }
}

function checkPoster(label: string, file: string, width: number, height: number): void {
  const p = probe(join(out, file))
  check(`${label}: ${file} readable by ffprobe`, p !== null, p ? 'ok' : 'missing or unreadable')
  if (!p) return
  const v = p.streams.find((s) => s.codec_type === 'video')
  check(`${label}: ${width}x${height}`, v?.width === width && v?.height === height, `${v?.width}x${v?.height}`)
}

if (process.argv.includes('--frames')) {
  checkFrames()
} else {
  checkVideo('master', 'film-master.mkv', { width: 1920, height: 1200, fps: '60/1', duration: [FILM_S, 0.1], audio: 'some' })
  checkVideo('film', 'gameoflife-film.webm', { width: 1440, height: 900, fps: '30/1', duration: [FILM_S, 0.1], audio: 'one', maxMB: 20 })
  checkVideo('loop', 'gameoflife-loop.webm', { width: 1024, height: 640, fps: '30/1', duration: [10, 0.05], audio: 'none', maxMB: 3.5 })
  checkPoster('film poster', 'gameoflife-film.webp', 1024, 640)
  checkPoster('loop poster', 'gameoflife-loop.webp', 1024, 640)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nall checks passed')
