# Optimized Game of Life

Conway's Game of Life optimized in C (sequential, AVX, OpenMP, OpenCL) on the [easypap](https://gforgeron.gitlab.io/easypap/) framework, then compiled for the browser one technology at a time and benchmarked against the native build.

**[▶ Live demo](https://laurentgenty.github.io/optimized-gameoflife/)** (needs a WebGPU browser: recent Chrome / Edge, Safari 26+)

## Native kernels

The kernels live in [`easypap-se/kernel/c/life.c`](easypap-se/kernel/c/life.c) and [`easypap-se/kernel/ocl/life.cl`](easypap-se/kernel/ocl/life.cl): sequential, AVX, OpenMP and OpenCL variants, with *lazy tiling* (only tiles with a changed neighbour are recomputed). The full write-up, in French, is in [`Rapport_Prog_multicoeur_GPU.pdf`](Rapport_Prog_multicoeur_GPU.pdf).

## In the browser

The same C code is compiled with Emscripten, one engine per native technology. Code in `web/`.

| Native | Browser |
|---|---|
| `seq` | `wasm-seq`: the sequential C kernel compiled to WASM (scalar, one-byte cells), reference engine |
| AVX | `wasm-simd`: tiled C + lazy tiling + SIMD (SSE2 intrinsics → WASM SIMD128, 16 cells per instruction), 1 thread |
| OpenMP | `wasm-mt`: the same kernel on a pthread pool (Web Workers) |
| OpenCL | `webgpu-naive` / `webgpu-tiled`: the OpenCL kernel rewritten in WGSL (naive, and tiled in workgroup shared memory) |

Every engine is checked against `wasm-seq` (same grid hash after N generations) before it is measured, and the `?selftest` page checks all of them.

### Results (generations per second, higher is better)

Measured on an Apple M5 Pro MacBook (15 cores).

- **Browser**: built-in benchmark run in headless Chrome (`npm run bench:headless`, output in `bench/web.json`). 50 warm-up generations, runs calibrated to last about 1 s, median of 3.
- **Native**: `bench/run-native.sh` (output in `bench/native.json`), no warm-up, median of 3 runs of at least 1 s. On Apple Silicon the AVX intrinsics go through [SIMDe](https://github.com/simd-everywhere/simde) (AVX → NEON translation): this is not native AVX.

**1024² grid, 50 % random**

| Engine | gens/s |
|---|---:|
| Native C, sequential (`omp` on 1 thread) | 188 |
| Native C, tiled OpenMP + lazy (`omp_tiled`, 15 threads) | 633 |
| `wasm-seq` | 548 |
| `wasm-simd` (1 thread) | 5,359 |
| `wasm-mt` (15 threads) | 3,644 |
| `webgpu-naive` | 22,198 |
| `webgpu-tiled` | 16,563 |

**1024² grid, 4 Gosper guns (sparse pattern)**

| Engine | gens/s |
|---|---:|
| Native C, sequential (`omp` on 1 thread) | 301 |
| Native C, tiled OpenMP + lazy (`omp_tiled`, 15 threads) | 2,050 |
| `wasm-seq` | 506 |
| `wasm-simd` (1 thread) | 26,900 |
| `wasm-mt` (15 threads) | 5,434 |
| `webgpu-naive` | 19,000 |
| `webgpu-tiled` | 14,700 |

### What the port taught

- **Sequential C compiled to WASM beats native sequential C (548 vs 188 gens/s).** They are not the same kernel: `wasm-seq` is a scalar loop over one-byte cells, while the native variant goes through the "AVX" function (9 values broadcast into a 256-bit register, a single cell read back, four-byte cells), itself translated to NEON by SIMDe on this Mac.
- **The native lazy tiling had transposed tile indices**: `updateNextIter` marks tile (row, column) but neighbours are read at (column, row), so each tile looked at the neighbourhood of its mirror tile. With the 4 guns, laid out symmetrically, the bug is hidden (same final grid as the full computation); it breaks the result on the OTCA metapixel. The port fixes the indexing, and tests with off-diagonal spaceships would have caught it.
- **Two native sequential variants do not measure what they claim**: `seq` always stops after one iteration (`compute_new_state` returns a local flag that is never updated) and `tiled` skips the last row and column of tiles. The native sequential baseline is therefore `omp` limited to 1 thread.
- **The OpenCL kernel evolved the border cells**, while the sequential version kept them fixed. It could not be measured: reading its result back fails (unfinished code, host buffer never allocated).
- **On a sparse pattern, 1 thread beats the GPU** thanks to lazy tiling (`wasm-simd`: 214k gens/s on the guns at 512², vs 70k for WebGPU).
- **WebGPU shared-memory tiling is slower than the naive version** on Apple GPUs, probably because the GPU caches already do that work.
- **`wasm-mt` plateaus**: two barriers and one atomic counter per tile at every generation, for little work. The Monitoring mode Gantt chart shows it (10 to 30 % activity per thread at 1024²). It only beats `wasm-simd` at 2048² on a random grid, never on the guns.

### Limitations

- Browser monitoring shows **threads**, not cores: browsers do not expose which core a worker runs on. The real per-CPU view is easypap's (`-m`, see below).
- No native EasyView on macOS: the `fxt` trace library is not in Homebrew.
- Numbers depend on measurement conditions (headless Chrome, visible tab; a hidden tab is throttled, and the benchmark then cancels itself).

## Run

From `web/`:

```bash
npm install && npm run dev      # http://localhost:5173 (WebGPU required)
npm test                        # unit tests (Node)
npm run e2e                     # self-test of every engine in Chrome
npm run bench:headless          # benchmark → bench/web.json
```

Native easypap (macOS, Apple Silicon: `brew install pkgconf hwloc sdl2_image sdl2_ttf libomp simde`), from the repository root:

```bash
make -C easypap-se
(cd easypap-se && ./run -k life -v omp_tiled -s 1024 -a random -ts 32 -m)   # GUI with per-CPU activity
bash bench/run-native.sh                                                     # → bench/native.json
```

## Credits

Laurent Genty, Clément Bertin and Emeric Duchemin. Built on [easypap](https://gforgeron.gitlab.io/easypap/) by Raymond Namyst.
