#!/usr/bin/env bash
# Encodes out/frames + out/audio.wav into the master, the web film, the screens loop and posters.
set -euo pipefail
cd "$(dirname "$0")/.."

FILM_BITRATE=1800k

node scripts/check-outputs.ts --frames || {
  echo "out/frames is incomplete: run npm run render, then npm run check -- --frames" >&2
  exit 1
}
[[ -f out/audio.wav ]] || { echo "out/audio.wav is missing: run npm run render" >&2; exit 1; }

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

echo "loop"
ff -framerate 60 -start_number 2640 -i out/frames/%05d.png -frames:v 600 -vf scale=1024:640 -an \
  -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 2200k -row-mt 1 out/gameoflife-loop.webm

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
