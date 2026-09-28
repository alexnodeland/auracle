#!/usr/bin/env bash
# A small 720p MP4 of a finished film, for sending round for review: uploads
# often stop at 30 MB, and an iPhone does not play the WebM. About 13 MB for
# five minutes.
#
#   www/video/tools/preview.sh <film>      -> www/video/out/<film>/<film>-preview.mp4
set -euo pipefail
F="${1:?usage: preview.sh <film>}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/www/video/out/$F/$F.mp4"
[ -f "$SRC" ] || { echo "no $SRC: record or render the film first" >&2; exit 1; }
FF="$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
# Low priority and two threads: this often runs while another film records.
nice -n 19 "$FF" -y -loglevel error -i "$SRC" -vf scale=1280:-2 \
  -c:v libx264 -preset veryfast -crf 26 -tune animation -threads 2 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart "$ROOT/www/video/out/$F/$F-preview.mp4"
ls -la "$ROOT/www/video/out/$F/$F-preview.mp4"
