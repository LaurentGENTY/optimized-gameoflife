// The film's score as a list of note events: an electronic track that goes from ambient to techno
// with one layer per engine tier (kick: native C, hats: SIMD, bass: threads, lead: GPU). Every
// time comes from the timeline's scene starts and cue sheet, so sound and picture share one clock.
import { PRE_DISPATCHES } from '../scenes/gpu'
import { TRANSITIONS } from '../scenes/transitions'
import { BPM, CUES, FPS, TOTAL_FRAMES, sceneStart } from '../timeline'

export type Layer = 'drone' | 'kick' | 'hats' | 'bass' | 'lead' | 'pluck'
export type Sfx = 'reveal' | 'glitch' | 'laser' | 'whoosh' | 'impact' | 'tick'

export interface NoteEvent {
  /** Seconds from the film start. */
  time: number
  voice: Layer | Sfx
  /** Seconds; the voice is silent again by `time + dur`. */
  dur: number
  /** Linear peak level in (0, 1]. */
  gain: number
  /** MIDI note number, for the pitched voices. */
  pitch?: number
}

export const SFX: readonly Sfx[] = ['reveal', 'glitch', 'laser', 'whoosh', 'impact', 'tick']

export const DURATION = TOTAL_FRAMES / FPS
export const BEAT = 60 / BPM
export const BAR = 4 * BEAT
const EIGHTH = BEAT / 2
const STEP = BEAT / 4

const GPU = sceneStart('gpu')
const SCREENS = sceneStart('screens')
/** Kick and SFX only from the curves' reversal until the end card. */
const BREAK: readonly [number, number] = [CUES.reversal, sceneStart('end')]
const [LEAD_OFF, BASS_OFF, HATS_OFF, KICK_OFF] = CUES.layersOff

/** Times `from + offset + k·step` in [from, to). Steps are powers of two, so the sums are exact. */
function grid(from: number, to: number, step: number, offset = 0): number[] {
  const out: number[] = []
  for (let k = 0; from + offset + k * step < to - 1e-9; k++) out.push(from + offset + k * step)
  return out
}

/** The drop's six seconds are the loudest of the film; the screens and curves sit just under. */
const energy = (t: number) => (t < SCREENS ? 1 : 0.68)

/** Gentle fade of a layer over the end card, down to 60 % of its level by the time it stops at `off`. */
const outro = (t: number, off: number) => (t < BREAK[1] ? 1 : 1 - (0.4 * (t - BREAK[1])) / (off - BREAK[1]))

// i–VI–III–VII in A minor, a chord a bar from the bass entry: the riser climbs over C and G and
// the drop lands on the tonic. Triads as MIDI notes around A2.
const PROGRESSION: readonly (readonly number[])[] = [
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [48, 52, 55], // C
  [43, 47, 50], // G
]

/** The chord sounding at `t`; from the reversal on the track rests on the tonic. */
function chordAt(t: number): readonly number[] {
  if (t >= CUES.reversal) return PROGRESSION[0]
  const k = Math.floor((t - sceneStart('threads')) / BAR + 1e-9)
  return PROGRESSION[((k % 4) + 4) % 4]
}

/** Chord tones of `chord` in [lo, hi], ascending. */
function tonesIn(chord: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (let m = lo; m <= hi; m++) if (chord.some((c) => (m - c) % 12 === 0)) out.push(m)
  return out
}

function drone(): NoteEvent[] {
  return [{ time: 0, voice: 'drone', dur: sceneStart('native'), gain: 0.45, pitch: 45 }]
}

function kick(): NoteEvent[] {
  // Half time while native-seq takes a second a generation, four on the floor once OpenMP lands.
  const times = [...grid(sceneStart('native'), CUES.nativeOmp, 2 * BEAT), ...grid(CUES.nativeOmp, KICK_OFF, BEAT)]
  return times.map((time) => ({ time, voice: 'kick', dur: 0.45, gain: 0.5 * outro(time, KICK_OFF) }))
}

const hat = (time: number, open: boolean, gain: number): NoteEvent => ({ time, voice: 'hats', dur: open ? 0.18 : 0.04, gain })

/** The GPU build-up: one note per dispatch of the waves on screen, louder as they come faster. */
function riser(): { time: number; spacing: number; p: number }[] {
  const centres = PRE_DISPATCHES.map((d) => GPU + d.start + d.dur / 2)
  return centres.map((time, i) => ({
    time,
    spacing: (centres[i + 1] ?? CUES.gpuDrop) - time,
    p: (time - GPU) / (CUES.gpuDrop - GPU),
  }))
}

function hats(): NoteEvent[] {
  const out: NoteEvent[] = []
  // wasm-seq (two generations a second): open hats on the offbeats.
  for (const t of grid(sceneStart('simd'), CUES.simdLaser, BEAT, EIGHTH)) out.push(hat(t, true, 0.5))
  // The SIMD laser and the threads: eighths, the offbeat ones open.
  const eighths = (from: number, to: number, off: number) => {
    for (const t of grid(from, to, EIGHTH)) {
      const open = Math.round((t - from) / EIGHTH) % 2 === 1
      out.push(hat(t, open, (open ? 0.5 : 0.2) * outro(t, off)))
    }
  }
  eighths(CUES.simdLaser, GPU, HATS_OFF)
  // The riser: a roll on every dispatch, swelling, over the open offbeat hats that keep the groove.
  for (const r of riser()) {
    const offbeat = Math.abs(((r.time - GPU) / EIGHTH) % 2 - 1) < 1e-9
    out.push(offbeat ? hat(r.time, true, 0.5) : { time: r.time, voice: 'hats', dur: Math.min(0.04, 0.8 * r.spacing), gain: 0.1 + 0.3 * r.p })
  }
  // From the drop: sixteenths, the offbeat eighth open.
  for (const t of grid(CUES.gpuDrop, BREAK[0], STEP)) {
    const s = Math.round((t - CUES.gpuDrop) / STEP) % 4
    out.push(hat(t, s === 2, (s === 2 ? 0.32 : s === 0 ? 0.16 : 0.11) * energy(t)))
  }
  eighths(BREAK[1], HATS_OFF, HATS_OFF)
  return out
}

function bass(): NoteEvent[] {
  const out: NoteEvent[] = []
  const note = (time: number, dur: number, gain: number, octave = 0): NoteEvent => ({
    time,
    voice: 'bass',
    dur,
    gain,
    pitch: chordAt(time)[0] - 12 + 12 * octave,
  })
  // The threads and the riser: offbeat eighths, out of the kick's way.
  for (const t of grid(sceneStart('threads'), CUES.gpuDrop, BEAT, EIGHTH)) out.push(note(t, 0.2, 0.3))
  // From the drop: a rolling bass on the three sixteenths between kicks, the last one an octave up.
  for (const t of grid(CUES.gpuDrop, BREAK[0], STEP)) {
    const s = Math.round((t - CUES.gpuDrop) / STEP) % 4
    if (s !== 0) out.push(note(t, 0.1, 0.42 * energy(t), s === 3 ? 1 : 0))
  }
  for (const t of grid(BREAK[1], BASS_OFF, BEAT, EIGHTH)) out.push(note(t, 0.2, 0.3 * outro(t, BASS_OFF)))
  return out
}

/** Sixteenth steps of the lead's stabs in a bar: 3-3-2 twice. */
const STAB_STEPS = [0, 3, 6, 8, 11, 14]

function lead(): NoteEvent[] {
  const out: NoteEvent[] = []
  // The riser: an arpeggio on the chord, climbing about an octave while the dispatches speed up.
  riser().forEach((r, j) => {
    const tones = tonesIn(chordAt(r.time), 57, 84)
    const base = Math.floor(r.p * (tones.length - 4))
    out.push({ time: r.time, voice: 'lead', dur: 0.8 * r.spacing, gain: 0.25 + 0.45 * r.p, pitch: tones[base + (j % 4)] })
  })
  // From the drop: chord stabs an octave above the bass's triad.
  for (const bar of grid(CUES.gpuDrop, Math.min(BREAK[0], LEAD_OFF), BAR)) {
    for (const s of STAB_STEPS) {
      const time = bar + s * STEP
      for (const m of chordAt(time)) out.push({ time, voice: 'lead', dur: 0.18, gain: 0.36 * energy(time), pitch: m + 12 })
    }
  }
  return out
}

/** One pluck a thread lane, up the A minor pentatonic as the lanes light. */
function plucks(): NoteEvent[] {
  const PENTA = [0, 3, 5, 7, 10]
  return CUES.threadPlucks.map((time, i) => ({
    time,
    voice: 'pluck',
    dur: 1.2,
    gain: 0.32,
    pitch: 57 + 12 * Math.floor(i / 5) + PENTA[i % 5],
  }))
}

function sfx(): NoteEvent[] {
  const out: NoteEvent[] = [
    { time: CUES.reveal, voice: 'reveal', dur: 3, gain: 0.45, pitch: 69 },
    { time: CUES.compile, voice: 'glitch', dur: 0.45, gain: 0.35 },
    { time: CUES.simdLaser, voice: 'laser', dur: 0.4, gain: 0.3 },
    { time: CUES.gpuDrop, voice: 'impact', dur: 2.5, gain: 0.9 },
    { time: CUES.reversal, voice: 'impact', dur: 3, gain: 0.6 },
    { time: CUES.finalTick, voice: 'tick', dur: 0.4, gain: 0.25 },
  ]
  for (const time of CUES.satellites) out.push({ time, voice: 'whoosh', dur: 0.7, gain: 0.3 })
  // A soft impact under each bloom flash of the transitions, unless a cue already hits there.
  for (const tr of TRANSITIONS) {
    if (tr.out?.fx !== 'bloom' && tr.in?.fx !== 'bloom') continue
    const time = sceneStart(tr.into)
    if (out.some((e) => e.voice === 'impact' && Math.abs(e.time - time) < BEAT)) continue
    out.push({ time, voice: 'impact', dur: 1.5, gain: 0.2 })
  }
  return out
}

export function buildScore(): NoteEvent[] {
  return [...drone(), ...kick(), ...hats(), ...bass(), ...lead(), ...plucks(), ...sfx()].sort((a, b) => a.time - b.time)
}
