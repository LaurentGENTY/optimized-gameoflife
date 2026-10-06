// Validated dark categorical palette (same as the benchmark chart).
export const THREAD_HUES: readonly string[] = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
];

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

// Threads beyond 8 reuse a hue at 60% brightness: hue + lightness, never a generated hue.
export function threadColor(t: number): [number, number, number] {
  const [r, g, b] = rgb(THREAD_HUES[t % 8]);
  const k = t >= 8 ? 0.6 : 1;
  return [r * k, g * k, b * k];
}

const HEAT_LO = rgb('#2a1408');
const HEAT_HI = rgb('#ff9a5a');

export function heatColor(v: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, v));
  return [0, 1, 2].map((i) => HEAT_LO[i] + (HEAT_HI[i] - HEAT_LO[i]) * c) as [number, number, number];
}

export function overlayValues(
  mode: 'thread' | 'heat',
  tiles: { thread: Float32Array; durationMs: Float32Array },
): Float32Array {
  if (mode === 'thread') return Float32Array.from(tiles.thread);
  let max = 0;
  for (const d of tiles.durationMs) if (d > max) max = d;
  return tiles.durationMs.map((d) => (d < 0 ? -1 : max > 0 ? d / max : 0));
}
