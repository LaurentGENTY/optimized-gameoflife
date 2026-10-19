// 16-bit PCM WAV encoding of the rendered score, and the base64 hop out of the page.

const HEADER = 44

/** Interleaves `channels` (equal lengths, samples in [-1, 1], clamped) into a 16-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels.length
  if (n === 0) throw new Error('encodeWav needs at least one channel')
  const frames = channels[0].length
  if (channels.some((c) => c.length !== frames)) throw new Error('encodeWav: channels differ in length')
  const dataBytes = frames * n * 2
  const out = new Uint8Array(HEADER + dataBytes)
  const v = new DataView(out.buffer)
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  v.setUint32(4, HEADER - 8 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, n, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * n * 2, true)
  v.setUint16(32, n * 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  let o = HEADER
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true)
      o += 2
    }
  }
  return out
}

/** Base64 of `bytes`, built in chunks: a 15 MB WAV is far past String.fromCharCode's argument limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}
