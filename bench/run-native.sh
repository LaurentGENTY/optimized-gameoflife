#!/usr/bin/env bash
# Measures the 2020 easypap life kernels natively and writes bench/native.json
# (format: NativeReport in web/src/bench/report.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/easypap-se"

# The 2020 `seq` variant stops after one iteration (its change flag is never set),
# so the native sequential baseline is the `tiled` variant. OpenCL is not usable (see README).
VARIANTS=("tiled:seq" "omp_tiled:omp_tiled")
read -r -a SIZES <<< "${SIZES:-512 1024 2048 4096}"

run_once() { # easypap-variant size pattern iters -> "iterations_done milliseconds"
  local extra=()
  [ "$1" = omp_tiled ] && extra=(-ts 32)
  ./bin/easypap -k life -v "$1" -s "$2" -a "$3" -i "$4" -n ${extra[@]+"${extra[@]}"} 2>&1 | python3 "$ROOT/bench/parse-perf.py"
}

results=()
for pair in "${VARIANTS[@]}"; do
  variant=${pair%%:*}
  id=${pair##*:}
  for size in "${SIZES[@]}"; do
    for pattern in random guns otca_off; do
      [ "$pattern" = otca_off ] && [ "$size" -lt 2176 ] && continue
      iters=16
      while :; do
        out=$(run_once "$variant" "$size" "$pattern" "$iters") || { echo "skip $variant $size $pattern" >&2; continue 2; }
        done_iters=${out% *}
        ms=${out#* }
        # Stop growing once a run lasts 1 s, or when the kernel ended early on a stable grid.
        if [ "${ms%.*}" -ge 1000 ] || [ "$done_iters" -lt "$iters" ] || [ "$iters" -ge 1048576 ]; then break; fi
        iters=$((iters * 2))
      done
      rates=()
      for _ in 1 2 3; do
        out=$(run_once "$variant" "$size" "$pattern" "$iters") || { echo "skip $variant $size $pattern" >&2; continue 2; }
        done_iters=${out% *}
        ms=${out#* }
        rates+=("$(python3 -c "print($done_iters * 1000 / $ms)")")
      done
      median=$(printf '%s\n' "${rates[@]}" | sort -g | sed -n 2p)
      results+=("{\"variant\": \"$id\", \"presetId\": \"${pattern/_/-}\", \"size\": $size, \"gensPerSec\": $median}")
      echo "$variant $size $pattern: $median gens/s ($iters iterations)" >&2
    done
  done
done

machine="$(sysctl -n machdep.cpu.brand_string) · $(sysctl -n hw.ncpu) cores"
{
  printf '{\n  "machine": "%s",\n  "date": "%s",\n  "results": [\n' "$machine" "$(date +%F)"
  last=$((${#results[@]} - 1))
  for i in "${!results[@]}"; do
    sep=","
    [ "$i" -eq "$last" ] && sep=""
    printf '    %s%s\n' "${results[$i]}" "$sep"
  done
  printf '  ]\n}\n'
} > "$ROOT/bench/native.json"
echo "wrote bench/native.json" >&2
