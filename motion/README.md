# gameoflife-motion

The motion design film of the project: an 76 s, 60 fps scene-by-scene animation (Vite page driven frame by frame, rendered through headless Chrome) of the Game of Life engines and their benchmark figures. Every number on screen comes from `bench/web.json` and `bench/native.json`. It also produces a 10 s loop used as the portfolio card.

## Prerequisites

- The web package built, since the capture records the real app:
  `npm --prefix ../web install && npm --prefix ../web run wasm`
- `ffmpeg` (with libvpx-vp9 and libopus), `cwebp`, and Google Chrome.

## Pipeline

Run from this folder, in this order:

```sh
npm install
npm test                       # unit tests (data, timeline, scenes)
npm run capture                # records the live app, extracts public/app/*.jpg
npm run still -- 120 2700      # renders single frames to out/stills for a visual check
npm run still -- --audio       # also writes the synthesized soundtrack check
npm run render                 # renders every frame to out/frames/*.png (60 fps, 4560 frames)
npm run check -- --frames      # verifies the PNG sequence before encoding
npm run encode                 # master, gameoflife-film.webm, gameoflife-loop.webm and the posters
npm run check                  # verifies the final outputs against the deliverables
```

`npm run render` is resumable: frames already on disk are skipped, so an interrupted run just continues. A frame rendered after a page error is never kept.

## Outputs

All in `out/`:

- `gameoflife-film.webm` and `.webp`: 1440x900, 30 fps, VP9 + Opus, at most 20 MB.
- `gameoflife-loop.webm` and `.webp`: 1024x640, no audio, 10 s, at most 3.5 MB. The loop is frames 2640-3239, the screens scene.

The published copies of the film live in `docs/media/`.
