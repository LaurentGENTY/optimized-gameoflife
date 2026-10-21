# gameoflife-motion

The motion design film of the project: a 78 s, 60 fps scene-by-scene animation (Vite page driven frame by frame, rendered through headless Chrome) of the Game of Life engines and their benchmark figures. Every number on screen comes from `bench/web.json` and `bench/native.json`. It also produces a 10 s loop used as the portfolio card.

## Prerequisites

- Node.js 22.18 or later: the scripts are plain `.ts` files run by `node` through its type stripping.
- Emscripten, with `emcc` on the `PATH`: the capture records the real app, whose WebAssembly
  engines are compiled by `npm --prefix ../web run wasm`.
- The web package built: `npm --prefix ../web install && npm --prefix ../web run wasm`
- Google Chrome (the capture and the render drive it headless).
- `ffmpeg` with libvpx-vp9 and libopus, and `cwebp` (the WebP posters).

## Pipeline

Run from this folder, in this order:

```sh
npm install
npm test                       # unit tests (data, timeline, scenes)
npm run capture                # records the live app, extracts public/app/*.jpg
npm run still -- 120 2700      # renders single frames to out/stills for a visual check
npm run still -- --audio       # also writes the synthesized soundtrack check
npm run render                 # renders every frame to out/frames/*.png (60 fps, 4680 frames)
npm run render -- 2520 3419    # renders only that frame range (a scene preview), then the soundtrack
npm run check -- --frames      # verifies the PNG sequence before encoding
npm run encode                 # master, gameoflife-film.webm, gameoflife-loop.webm and the posters
npm run check                  # verifies the final outputs against the deliverables
```

`npm run capture` re-records the live app, so scene 4's screen recording (`public/app/`, git-ignored) differs from one capture to the next: the film is not bit-reproducible across captures, only across renders of the same capture.

`npm run render` is resumable: frames already on disk are skipped, so an interrupted run just continues. A frame rendered after a page error is never kept.

## Outputs

All in `out/`:

- `gameoflife-film.webm` and `.webp`: 1440x900, 30 fps, VP9 + Opus, at most 20 MB.
- `gameoflife-loop.webm` and `.webp`: 1024x640, 30 fps, no audio, 10 s, at most 3.5 MB. The loop is frames 2760-3359, the screens scene's 10 s hold (after its 2 s entrance).

The published copies of the film live in `docs/media/`.
