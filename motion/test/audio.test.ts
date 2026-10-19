import { describe, expect, it } from 'vitest'
import { type Layer, type NoteEvent, SFX, buildScore } from '../src/audio/score'
import { PEAK_DBFS, finishMaster } from '../src/audio/synth'
import { bytesToBase64, encodeWav } from '../src/audio/wav'
import { PRE_DISPATCHES } from '../src/scenes/gpu'
import { CUES, sceneStart } from '../src/timeline'

const score = buildScore()
const of = (voice: NoteEvent['voice']) => score.filter((e) => e.voice === voice)
const sounds = (e: NoteEvent, from: number, to: number) => e.time < to && e.time + e.dur > from
const times = (voice: NoteEvent['voice']) => of(voice).map((e) => e.time)
const first = (voice: Layer) => Math.min(...times(voice))
const lastEnd = (voice: Layer) => Math.max(...of(voice).map((e) => e.time + e.dur))

describe('score', () => {
  it('is pure and sorted by time', () => {
    expect(buildScore()).toEqual(score)
    for (let i = 1; i < score.length; i++) expect(score[i].time).toBeGreaterThanOrEqual(score[i - 1].time)
  })

  it('keeps every event inside the 76 s film with a positive length and gain', () => {
    for (const e of score) {
      expect(e.time).toBeGreaterThanOrEqual(0)
      expect(e.dur).toBeGreaterThan(0)
      expect(e.time + e.dur).toBeLessThanOrEqual(76)
      expect(e.gain).toBeGreaterThan(0)
      expect(e.gain).toBeLessThanOrEqual(1)
    }
  })

  it('adds one layer per engine tier, each on its scene start', () => {
    expect(times('drone')).toEqual([0])
    expect(lastEnd('drone')).toBe(6)
    expect(first('kick')).toBe(sceneStart('native'))
    expect(first('hats')).toBeGreaterThanOrEqual(sceneStart('simd'))
    expect(first('hats')).toBeLessThan(sceneStart('simd') + 1)
    expect(first('bass')).toBeGreaterThanOrEqual(sceneStart('threads'))
    expect(first('bass')).toBeLessThan(sceneStart('threads') + 1)
    expect(first('lead')).toBe(sceneStart('gpu'))
  })

  it('has no lead before 34 and no bass before 22', () => {
    expect(of('lead').every((e) => e.time >= 34)).toBe(true)
    expect(of('bass').every((e) => e.time >= 22)).toBe(true)
  })

  it('builds the GPU riser on the dispatch schedule the waves use', () => {
    const riser = of('lead').filter((e) => e.time < CUES.gpuDrop)
    const centres = PRE_DISPATCHES.map((d) => sceneStart('gpu') + d.start + d.dur / 2)
    expect(riser.map((e) => e.time)).toEqual(centres)
    // A crescendo: every note at least as loud as the one before.
    for (let i = 1; i < riser.length; i++) expect(riser[i].gain).toBeGreaterThanOrEqual(riser[i - 1].gain)
    expect(of('hats').filter((e) => e.time >= sceneStart('gpu') && e.time < CUES.gpuDrop).map((e) => e.time)).toEqual(centres)
  })

  it('plays only the kick and SFX in the breakdown [64, 68)', () => {
    const inBreak = score.filter((e) => sounds(e, 64, 68))
    expect(inBreak.some((e) => e.voice === 'kick')).toBe(true)
    for (const e of inBreak) expect(e.voice === 'kick' || (SFX as readonly string[]).includes(e.voice)).toBe(true)
  })

  it('stops the layers one by one: lead, bass, hats, kick', () => {
    const order: Layer[] = ['lead', 'bass', 'hats', 'kick']
    order.forEach((voice, k) => {
      const off = CUES.layersOff[k]
      expect(lastEnd(voice)).toBeLessThanOrEqual(off)
      // Still playing in the bar before its cue (the lead's bar before 68 is the breakdown).
      const until = voice === 'lead' ? CUES.reversal : off
      expect(of(voice).some((e) => e.time >= until - 2 && e.time < until)).toBe(true)
    })
  })

  it('plucks once per thread lane and whooshes once per satellite', () => {
    expect(times('pluck')).toEqual([...CUES.threadPlucks])
    expect(times('pluck')).toHaveLength(15)
    expect(times('whoosh')).toEqual([...CUES.satellites])
    expect(times('whoosh')).toHaveLength(4)
  })

  it('puts each SFX on its cue', () => {
    expect(times('reveal')).toEqual([CUES.reveal])
    expect(times('glitch')).toEqual([CUES.compile])
    expect(times('laser')).toEqual([CUES.simdLaser])
    expect(times('tick')).toEqual([CUES.finalTick])
    const impacts = of('impact')
    expect(impacts.map((e) => e.time)).toEqual(expect.arrayContaining([CUES.gpuDrop, CUES.reversal]))
    // The drop's impact is the loudest one.
    const drop = impacts.find((e) => e.time === CUES.gpuDrop)!
    for (const e of impacts) expect(e.gain).toBeLessThanOrEqual(drop.gain)
  })
})

describe('encodeWav', () => {
  it('writes a 16-bit PCM RIFF header', () => {
    const wav = encodeWav([new Float32Array(4), new Float32Array(4)], 48000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const ascii = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4))
    expect(wav.length).toBe(44 + 16)
    expect(ascii(0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(ascii(8)).toBe('WAVE')
    expect(ascii(12)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(28, true)).toBe(48000 * 4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(16)
  })

  it('interleaves the channels and clamps out-of-range samples', () => {
    const wav = encodeWav([Float32Array.of(1, 2, 0), Float32Array.of(-1, -2, 0.5)], 44100)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const s = (i: number) => view.getInt16(44 + 2 * i, true)
    expect([s(0), s(1), s(2), s(3), s(4), s(5)]).toEqual([32767, -32768, 32767, -32768, 0, 16384])
  })

  it('rejects channels of different lengths', () => {
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 48000)).toThrow()
  })
})

describe('bytesToBase64', () => {
  it('matches Node’s encoder, across chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 37) % 256)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  })
})

describe('finishMaster', () => {
  it('brings the peak to the ceiling and fades the end to silence', () => {
    const sr = 1000
    const l = Float32Array.from({ length: sr }, (_, i) => 1.7 * Math.sin(i / 3))
    const r = Float32Array.from({ length: sr }, (_, i) => 0.4 * Math.cos(i / 5))
    finishMaster([l, r], sr)
    const peak = Math.max(...l.map(Math.abs), ...r.map(Math.abs))
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1)
    expect(20 * Math.log10(peak)).toBeCloseTo(PEAK_DBFS, 1)
    expect(Math.abs(l[sr - 1])).toBe(0)
    expect(Math.abs(r[sr - 1])).toBe(0)
  })

  it('leaves a silent buffer silent', () => {
    const c = new Float32Array(100)
    finishMaster([c], 100)
    expect(c.every((v) => v === 0)).toBe(true)
  })
})
