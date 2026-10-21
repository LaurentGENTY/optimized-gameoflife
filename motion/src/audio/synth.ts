// Offline synthesis of the score: oscillators, seeded noise and envelopes only (no samples, no
// network), mixed through a sidechain pump, a reverb and a dotted-eighth delay, then a gentle
// compressor. Seeded noise keeps every render identical.
import { BEAT, DURATION, type NoteEvent } from './score'

/** The master's sample peak: under the −1 dBFS ceiling, with room for inter-sample peaks in the Opus encode. */
export const PEAK_DBFS = -1.5
/** The last seconds ramp to silence so the film ends on a clean zero. */
const FADE_OUT = 0.1

/** Normalises the peak of `channels` to PEAK_DBFS and fades their end out, in place. */
export function finishMaster(channels: Float32Array[], sampleRate: number): void {
  let peak = 0
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]))
  if (peak === 0) return
  const k = 10 ** (PEAK_DBFS / 20) / peak
  const fade = Math.max(1, Math.round(FADE_OUT * sampleRate))
  for (const c of channels) {
    const n = c.length
    for (let i = 0; i < n; i++) c[i] *= k * Math.min(1, (n - 1 - i) / fade)
  }
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Mix {
  ctx: OfflineAudioContext
  drums: AudioNode
  /** Everything melodic: ducked on each kick. */
  music: AudioNode
  pump: AudioParam
  sfx: AudioNode
  reverb: AudioNode
  delay: AudioNode
  noise: AudioBuffer
  rand: () => number
}

interface Out {
  pan?: number
  reverb?: number
  delay?: number
}

/** A VCA into `bus`, with optional pan and effect sends. */
function vca(m: Mix, bus: AudioNode, o: Out = {}): GainNode {
  const g = m.ctx.createGain()
  g.gain.value = 0
  let tail: AudioNode = g
  if (o.pan) {
    const p = m.ctx.createStereoPanner()
    p.pan.value = o.pan
    g.connect(p)
    tail = p
  }
  tail.connect(bus)
  for (const [amount, target] of [
    [o.reverb, m.reverb],
    [o.delay, m.delay],
  ] as const) {
    if (!amount) continue
    const s = m.ctx.createGain()
    s.gain.value = amount
    tail.connect(s).connect(target)
  }
  return g
}

/** Attack to `peak`, then an exponential decay to silence at `end`. */
function percussive(p: AudioParam, t: number, attack: number, peak: number, end: number): void {
  p.setValueAtTime(0, t)
  p.linearRampToValueAtTime(peak, t + attack)
  p.exponentialRampToValueAtTime(1e-4, end)
  p.setValueAtTime(0, end)
}

function osc(m: Mix, type: OscillatorType, f: number, t: number, end: number, dest: AudioNode, detune = 0): OscillatorNode {
  const o = m.ctx.createOscillator()
  o.type = type
  o.frequency.value = f
  o.detune.value = detune
  o.connect(dest)
  o.start(t)
  o.stop(end)
  return o
}

function noise(m: Mix, t: number, end: number, dest: AudioNode): AudioBufferSourceNode {
  const s = m.ctx.createBufferSource()
  s.buffer = m.noise
  s.loop = true
  s.connect(dest)
  s.start(t, m.rand() * m.noise.duration)
  s.stop(end)
  return s
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode {
  const b = ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = f
  b.Q.value = q
  b.connect(dest)
  return b
}

type Voice = (m: Mix, e: NoteEvent) => void

const VOICES: Record<NoteEvent['voice'], Voice> = {
  drone(m, e) {
    const t = e.time
    const end = t + e.dur
    // An open A minor voicing; its filter opens over the title and closes as the kick comes in.
    const g = vca(m, m.music, { reverb: 0.5 })
    const lp = filter(m.ctx, 'lowpass', 250, 0.8, g)
    lp.frequency.setValueAtTime(250, t)
    lp.frequency.exponentialRampToValueAtTime(1800, t + e.dur * 0.6)
    lp.frequency.exponentialRampToValueAtTime(400, end)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(e.gain, t + 2.5)
    g.gain.setValueAtTime(e.gain, end - 1.5)
    g.gain.linearRampToValueAtTime(0, end)
    const notes = [0, 7, 12, 15, 19].map((d) => (e.pitch ?? 45) + d)
    notes.forEach((n, i) => {
      const p = m.ctx.createStereoPanner()
      p.pan.value = -0.6 + (1.2 * i) / (notes.length - 1)
      const v = m.ctx.createGain()
      v.gain.value = 0.09
      v.connect(p).connect(lp)
      for (const d of [-7, 7]) osc(m, 'sawtooth', hz(n), t, end, v, d)
    })
  },

  kick(m, e) {
    const t = e.time
    const end = t + e.dur
    const out = vca(m, m.drums)
    percussive(out.gain, t, 0.002, e.gain, end)
    const body = osc(m, 'sine', 160, t, end, out)
    body.frequency.setValueAtTime(160, t)
    body.frequency.exponentialRampToValueAtTime(50, t + 0.08)
    body.frequency.exponentialRampToValueAtTime(40, end)
    // The click that lets the kick cut through small speakers.
    const click = vca(m, m.drums)
    percussive(click.gain, t, 0.001, 0.25 * e.gain, t + 0.015)
    noise(m, t, t + 0.02, filter(m.ctx, 'highpass', 2500, 0.7, click))
    // Sidechain pump: the melodic bus ducks under every kick and swells back.
    m.pump.setTargetAtTime(0.5, t, 0.003)
    m.pump.setTargetAtTime(1, t + 0.04, 0.07)
  },

  hats(m, e) {
    const t = e.time
    const end = t + e.dur
    const open = e.dur > 0.1
    const out = vca(m, m.drums, { pan: open ? 0.2 : -0.15, reverb: open ? 0.1 : 0 })
    percussive(out.gain, t, 0.001, e.gain, end)
    noise(m, t, end, filter(m.ctx, 'highpass', open ? 7000 : 8500, 0.7, out))
  },

  bass(m, e) {
    const t = e.time
    const end = t + e.dur
    const f = hz(e.pitch ?? 33)
    const out = vca(m, m.music)
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(e.gain, t + 0.004)
    out.gain.linearRampToValueAtTime(0.7 * e.gain, t + 0.6 * e.dur)
    out.gain.exponentialRampToValueAtTime(1e-4, end)
    out.gain.setValueAtTime(0, end)
    const lp = filter(m.ctx, 'lowpass', 900, 5, out)
    lp.frequency.setValueAtTime(1000, t)
    lp.frequency.exponentialRampToValueAtTime(160, end)
    osc(m, 'sawtooth', f, t, end, lp)
    const sub = m.ctx.createGain()
    sub.gain.value = 0.8
    sub.connect(out)
    osc(m, 'sine', f, t, end, sub)
  },

  lead(m, e) {
    const t = e.time
    const end = t + e.dur
    const f = hz(e.pitch ?? 69)
    const out = vca(m, m.music, { reverb: 0.25, delay: 0.2 })
    // Gated rather than decaying: the riser's notes get as short as 25 ms and must still carry.
    const release = Math.min(0.03, e.dur / 3)
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(e.gain, t + 0.003)
    out.gain.linearRampToValueAtTime(0.7 * e.gain, end - release)
    out.gain.linearRampToValueAtTime(0, end)
    // Brighter as it gets louder, so the riser opens up as it climbs.
    const bright = Math.min(8000, 1200 + 12000 * e.gain)
    const lp = filter(m.ctx, 'lowpass', bright, 2, out)
    lp.frequency.setValueAtTime(bright, t)
    lp.frequency.exponentialRampToValueAtTime(bright * 0.3, end)
    // Three detuned saws spread left, centre, right.
    ;[-0.5, 0, 0.5].forEach((pan, i) => {
      const p = m.ctx.createStereoPanner()
      p.pan.value = pan
      const v = m.ctx.createGain()
      v.gain.value = 0.4
      v.connect(p).connect(lp)
      osc(m, 'sawtooth', f, t, end, v, (i - 1) * 10)
    })
  },

  pluck(m, e) {
    const t = e.time
    const end = t + e.dur
    const n = e.pitch ?? 69
    // Lanes light top to bottom while the notes climb: pan them across the stereo field with the pitch.
    const out = vca(m, m.music, { pan: Math.max(-0.7, Math.min(0.7, (n - 74) / 20)), reverb: 0.35, delay: 0.3 })
    percussive(out.gain, t, 0.002, e.gain, end)
    const lp = filter(m.ctx, 'lowpass', 5000, 1, out)
    lp.frequency.setValueAtTime(5000, t)
    lp.frequency.exponentialRampToValueAtTime(700, end)
    osc(m, 'triangle', hz(n), t, end, lp)
    const h = m.ctx.createGain()
    h.gain.value = 0.3
    h.connect(lp)
    osc(m, 'sine', 2 * hz(n), t, end, h)
  },

  reveal(m, e) {
    const t = e.time
    const end = t + e.dur
    // Open fifths in pairs a few cents apart: a slow glassy shimmer as OTCA appears.
    const out = vca(m, m.sfx, { reverb: 0.6, delay: 0.25 })
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(e.gain, t + 0.4)
    out.gain.exponentialRampToValueAtTime(1e-4, end)
    for (const d of [0, 7, 12, 19, 24]) {
      const v = m.ctx.createGain()
      v.gain.value = 0.12
      v.connect(out)
      for (const c of [-4, 4]) osc(m, 'sine', hz((e.pitch ?? 69) + d), t, end, v, c)
    }
  },

  glitch(m, e) {
    const t = e.time
    const end = t + e.dur
    const out = vca(m, m.sfx, { delay: 0.15 })
    const sq = osc(m, 'square', 400, t, end, filter(m.ctx, 'bandpass', 2000, 0.6, out))
    out.gain.setValueAtTime(0, t)
    // Stuttering 25 ms steps of random pitch and level, some of them dropped out.
    const STEP_S = 0.025
    for (let k = 0; t + k * STEP_S < end; k++) {
      const at = t + k * STEP_S
      sq.frequency.setValueAtTime(200 + 2800 * m.rand(), at)
      const on = m.rand() > 0.3
      out.gain.setValueAtTime(on ? e.gain * (0.4 + 0.6 * m.rand()) * (1 - (at - t) / e.dur) : 0, at)
    }
    out.gain.setValueAtTime(0, end)
  },

  laser(m, e) {
    const t = e.time
    const end = t + e.dur
    // A zap that sweeps across the stereo field like the laser across the grid.
    const out = vca(m, m.sfx, { reverb: 0.2, delay: 0.35 })
    percussive(out.gain, t, 0.002, e.gain, end)
    const p = m.ctx.createStereoPanner()
    p.pan.setValueAtTime(-0.6, t)
    p.pan.linearRampToValueAtTime(0.6, end)
    p.connect(out)
    const lp = filter(m.ctx, 'lowpass', 6000, 1, p)
    for (const type of ['sawtooth', 'sine'] as const) {
      const o = osc(m, type, 3000, t, end, lp)
      o.frequency.setValueAtTime(3000, t)
      o.frequency.exponentialRampToValueAtTime(150, end)
    }
  },

  whoosh(m, e) {
    const t = e.time
    const end = t + e.dur
    const peak = t + 0.45 * e.dur
    // Satellites land left, right, left, right.
    const pan = Math.round(t / BEAT) % 2 === 0 ? -0.45 : 0.45
    const out = vca(m, m.sfx, { pan, reverb: 0.4 })
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(e.gain, peak)
    out.gain.exponentialRampToValueAtTime(1e-4, end)
    const bp = filter(m.ctx, 'bandpass', 600, 1.5, out)
    bp.frequency.setValueAtTime(600, t)
    bp.frequency.exponentialRampToValueAtTime(6000, peak)
    bp.frequency.exponentialRampToValueAtTime(2500, end)
    noise(m, t, end, bp)
    // A glass ping as the screen lands.
    const ping = vca(m, m.sfx, { pan, reverb: 0.5 })
    percussive(ping.gain, peak, 0.002, 0.25 * e.gain, end)
    for (const n of [96, 103]) osc(m, 'sine', hz(n), peak, end, ping)
  },

  impact(m, e) {
    const t = e.time
    const end = t + e.dur
    const boom = vca(m, m.sfx, { reverb: 0.4 })
    percussive(boom.gain, t, 0.003, e.gain, end)
    const o = osc(m, 'sine', 110, t, end, boom)
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(32, t + Math.min(0.9, e.dur))
    const air = vca(m, m.sfx, { reverb: 0.6 })
    const airEnd = t + Math.min(0.8, e.dur)
    percussive(air.gain, t, 0.002, 0.45 * e.gain, airEnd)
    const lp = filter(m.ctx, 'lowpass', 2000, 0.7, air)
    lp.frequency.setValueAtTime(2000, t)
    lp.frequency.exponentialRampToValueAtTime(200, airEnd)
    noise(m, t, airEnd, lp)
  },

  tick(m, e) {
    const t = e.time
    const out = vca(m, m.sfx, { reverb: 0.3 })
    const end = t + Math.min(0.08, e.dur)
    percussive(out.gain, t, 0.001, e.gain, end)
    osc(m, 'sine', 1760, t, end, out)
    const h = m.ctx.createGain()
    h.gain.value = 0.4
    h.connect(out)
    osc(m, 'sine', 3520, t, end, h)
  },
}

/** A stereo room: seeded noise under an exponential decay. */
function impulse(ctx: BaseAudioContext, seconds: number, rand: () => number): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate)
  const b = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    // −60 dB at the end of the buffer.
    for (let i = 0; i < n; i++) d[i] = (2 * rand() - 1) * Math.exp((-6.9 * i) / n)
  }
  return b
}

/** Renders the score to a stereo buffer the length of the film, normalised and faded out. */
export async function renderScore(score: NoteEvent[], sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(DURATION * sampleRate), sampleRate })
  const rand = mulberry32(0x60f11fe)

  // Master: a rumble filter, then a gentle glue compressor.
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -12
  comp.knee.value = 8
  comp.ratio.value = 2.5
  comp.attack.value = 0.005
  comp.release.value = 0.12
  comp.connect(ctx.destination)
  const master = filter(ctx, 'highpass', 25, 0.7, comp)

  const bus = (level: number) => {
    const g = ctx.createGain()
    g.gain.value = level
    g.connect(master)
    return g
  }
  const drums = bus(1)
  const sfx = bus(0.8)
  const pump = ctx.createGain()
  pump.connect(bus(0.8))

  const reverbIn = ctx.createGain()
  const conv = ctx.createConvolver()
  conv.buffer = impulse(ctx, 2.2, rand)
  reverbIn.connect(conv).connect(bus(0.35))

  // Ping-pong dotted-eighth delay, darkened on every repeat.
  const delayIn = ctx.createGain()
  const dl = ctx.createDelay(1)
  const dr = ctx.createDelay(1)
  dl.delayTime.value = dr.delayTime.value = 0.75 * BEAT
  const fb = ctx.createGain()
  fb.gain.value = 0.35
  const dark = filter(ctx, 'lowpass', 3000, 0.7, fb)
  const panL = ctx.createStereoPanner()
  const panR = ctx.createStereoPanner()
  panL.pan.value = -0.6
  panR.pan.value = 0.6
  const delayOut = bus(0.4)
  delayIn.connect(dl)
  dl.connect(panL).connect(delayOut)
  dl.connect(dr)
  dr.connect(panR).connect(delayOut)
  dr.connect(dark)
  fb.connect(dl)

  const noiseBuf = ctx.createBuffer(1, 2 * sampleRate, sampleRate)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = 2 * rand() - 1

  const m: Mix = { ctx, drums, music: pump, pump: pump.gain, sfx, reverb: reverbIn, delay: delayIn, noise: noiseBuf, rand }
  for (const e of score) VOICES[e.voice](m, e)

  const out = await ctx.startRendering()
  finishMaster([out.getChannelData(0), out.getChannelData(1)], sampleRate)
  return out
}
