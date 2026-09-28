#!/usr/bin/env bash
# Record, render and encode several walkthroughs, one after another, on a
# quiet machine, and leave each one reviewable:
#
#   www/video/tools/record_films.sh <film> <poster-seconds> [<film> <poster> ...]
#
# Films run strictly in turn: a recording needs the machine to itself, and a
# five-minute film's frame parts take about 4 GB, so each film's parts are
# deleted once its MP4 and WebM exist (they re-render deterministically). A
# 720p preview (preview.sh) is made for each. The first failure stops the run,
# so a disk-full or a broken take is not followed by more of the same.
# Progress goes to www/video/out/record_films.log, one "===" line per step.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
LOG="www/video/out/record_films.log"
mkdir -p www/video/out
free() { df -h . | tail -1 | awk '{print $4}'; }
[ $# -ge 2 ] && [ $(($# % 2)) -eq 0 ] || { echo "usage: record_films.sh <film> <poster> [<film> <poster> ...]" >&2; exit 2; }
while [ $# -ge 2 ]; do
  f=$1; poster=$2; shift 2
  echo "=== $(date -u +%T) $f (poster $poster), $(free) free" | tee -a "$LOG"
  www/video/tools/walkthrough.sh "$f" "$poster" >> "$LOG" 2>&1
  rc=$?
  out="www/video/out/$f"
  if [ $rc -ne 0 ] || [ ! -s "$out/$f.mp4" ] || [ ! -s "$out/$f.webm" ]; then
    echo "=== $(date -u +%T) $f failed (exit $rc); stopping. The log above says where." | tee -a "$LOG"
    exit 1
  fi
  rm -f "$out/picture.mkv" "$out/picture.ffconcat" "$out"/part-*.mkv
  www/video/tools/preview.sh "$f" >> "$LOG" 2>&1
  echo "=== $(date -u +%T) $f done: $f.mp4, $f.webm, $f-preview.mp4" | tee -a "$LOG"
done
echo "=== $(date -u +%T) all done, $(free) free" | tee -a "$LOG"
