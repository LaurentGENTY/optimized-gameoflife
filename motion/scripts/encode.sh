#!/usr/bin/env bash
# Encodes out/frames + out/audio.wav into the master, the web film, the screens loop and posters.
set -euo pipefail
cd "$(dirname "$0")/.."

FILM_BITRATE=1800k
# 2800k overshot the 3.5 MB budget (3.52 MB) once the satellites got brighter and larger.
LOOP_BITRATE=2700k

node scripts/check-outputs.ts --frames || {
  echo "out/frames is incomplete: run npm run render, then npm run check -- --frames" >&2
  exit 1
}
[[ -f out/audio.wav ]] || { echo "out/audio.wav is missing: run npm run render" >&2; exit 1; }
# render writes the soundtrack after the frames: a frame newer than it means a stale soundtrack.
newer=$(find out/frames -name '*.png' -newer out/audio.wav -print -quit)
[[ -z "$newer" ]] || {
  echo "out/audio.wav is older than $newer: run npm run still -- --audio (or npm run render)" >&2
  exit 1
}

ff() { ffmpeg -hide_banner -loglevel error -stats -y "$@"; }

echo "master"
ff -framerate 60 -i out/frames/%05d.png -i out/audio.wav -c:v libx264 -crf 12 -pix_fmt yuv420p -c:a flac out/film-master.mkv

# The PNGs are RGBA, which would make libvpx pick an alpha format browsers do not play: force
# yuv420p. -row-mt only spreads VP9 encoding across cores; it does not change the rate control.
echo "film, pass 1"
ff -framerate 60 -i out/frames/%05d.png -vf scale=1440:900,fps=30 \
  -c:v libvpx-vp9 -pix_fmt yuv420p -b:v "$FILM_BITRATE" -row-mt 1 -pass 1 -passlogfile out/film-vp9 -an -f null /dev/null
echo "film, pass 2"
ff -framerate 60 -i out/frames/%05d.png -i out/audio.wav -vf scale=1440:900,fps=30 \
  -c:v libvpx-vp9 -pix_fmt yuv420p -b:v "$FILM_BITRATE" -row-mt 1 -pass 2 -passlogfile out/film-vp9 \
  -c:a libopus -b:a 128k out/gameoflife-film.webm
rm -f out/film-vp9-*.log

# The screens' 10 s hold (frames 2760-3359, after their 2 s entrance) at 30 fps like the film, so the
# bitrate goes to 300 frames instead of 600. -t is an input option: an output -frames:v would count 30 fps frames.
loop() {
  ff -framerate 60 -start_number 2760 -t 10 -i out/frames/%05d.png -vf scale=1024:640,fps=30 -an \
    -c:v libvpx-vp9 -pix_fmt yuv420p -b:v "$LOOP_BITRATE" -row-mt 1 -pass "$1" -passlogfile out/loop-vp9 "${@:2}"
}
echo "loop, pass 1"
loop 1 -f null /dev/null
echo "loop, pass 2"
loop 2 out/gameoflife-loop.webm
rm -f out/loop-vp9-*.log

# This ffmpeg build has no WebP encoder: ffmpeg scales, cwebp encodes at the same quality 80.
poster() {
  ff -i "out/frames/$1.png" -vf scale=1024:640 "out/poster-$1.png"
  cwebp -quiet -q 80 "out/poster-$1.png" -o "$2"
  rm "out/poster-$1.png"
}
echo "posters"
poster 02280 out/gameoflife-film.webp
poster 02940 out/gameoflife-loop.webp

ls -l out/film-master.mkv out/gameoflife-film.webm out/gameoflife-loop.webm out/gameoflife-film.webp out/gameoflife-loop.webp
