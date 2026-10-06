// GPU timestamps can be zero or non-monotonic on some drivers; such passes are skipped.
const MAX_PLAUSIBLE_NS = 10_000_000_000n;

export function kernelSamples(timestamps: BigUint64Array, count: number, firstIteration: number): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const begin = timestamps[2 * i];
    const end = timestamps[2 * i + 1];
    const ns = end - begin;
    if (begin === 0n || end <= begin || ns > MAX_PLAUSIBLE_NS) continue;
    out.push(firstIteration + i, Number(ns) / 1e6);
  }
  return Float64Array.from(out);
}
