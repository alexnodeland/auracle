#!/usr/bin/env bash
# Record several walkthroughs, then finish them (score, mix, render, encode),
# and leave each one reviewable:
#
#   www/video/tools/record_films.sh [--draft] [--shot a,b] <film> <poster-seconds> [<film> <poster> ...]
#
# Two phases. First every film is recorded, one after another: that is the
# only part that needs a quiet machine and the one browser, and it ends with
# a "quiet window over" line in the log, after which builds and tests can run
# again. Then each film is finished in turn, using every core.
#
#   --draft     finish with a fast MP4 and the 720p preview only (no WebM),
#               for review; re-run a film without it, with --no-record
#               (walkthrough.sh FILM POSTER --no-record), before publishing
#   --shot a,b  re-record only these shots in every film named (reuse the rest)
#
# A five-minute film's frame parts take about 4 GB, so each film's parts are
# deleted once it is encoded (they re-render deterministically from the takes).
# A 720p preview (FILM-preview.mp4) is made for each. The first failure stops
# the run, so a disk-full or a broken take is not followed by more of the same.
# Progress goes to www/video/out/record_films.log, one "===" line per step.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
LOG="www/video/out/record_films.log"
mkdir -p www/video/out
free() { df -h . | tail -1 | awk '{print $4}'; }
DRAFT=(); SHOTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) DRAFT=(--draft); shift ;;
    --shot) SHOTS=(--shot "$2"); shift 2 ;;
    *) break ;;
  esac
done
[ $# -ge 2 ] && [ $(($# % 2)) -eq 0 ] || { echo "usage: record_films.sh [--draft] [--shot a,b] <film> <poster> [<film> <poster> ...]" >&2; exit 2; }
PAIRS=("$@")

# Phase 1: record, strictly one at a time.
for ((i = 0; i < ${#PAIRS[@]}; i += 2)); do
  f=${PAIRS[i]}; poster=${PAIRS[i + 1]}
  echo "=== $(date -u +%T) recording $f, $(free) free" | tee -a "$LOG"
  if ! www/video/tools/walkthrough.sh "$f" "$poster" --record-only ${SHOTS[@]+"${SHOTS[@]}"} >> "$LOG" 2>&1; then
    echo "=== $(date -u +%T) recording $f failed; stopping. The log above says where." | tee -a "$LOG"
    exit 1
  fi
done
echo "=== $(date -u +%T) quiet window over: every take is recorded" | tee -a "$LOG"

# Phase 2: finish each film.
for ((i = 0; i < ${#PAIRS[@]}; i += 2)); do
  f=${PAIRS[i]}; poster=${PAIRS[i + 1]}
  out="www/video/out/$f"
  echo "=== $(date -u +%T) finishing $f" | tee -a "$LOG"
  www/video/tools/walkthrough.sh "$f" "$poster" --no-record ${DRAFT[@]+"${DRAFT[@]}"} >> "$LOG" 2>&1
  rc=$?
  if [ $rc -ne 0 ] || [ ! -s "$out/$f.mp4" ] || [ ! -s "$out/$f-preview.mp4" ] || { [ ${#DRAFT[@]} -eq 0 ] && [ ! -s "$out/$f.webm" ]; }; then
    echo "=== $(date -u +%T) $f failed (exit $rc); stopping. The log above says where." | tee -a "$LOG"
    exit 1
  fi
  rm -f "$out/picture.mkv" "$out/picture.ffconcat" "$out"/part-*.mkv
  echo "=== $(date -u +%T) $f done: $f.mp4$([ ${#DRAFT[@]} -eq 0 ] && echo ", $f.webm"), $f-preview.mp4" | tee -a "$LOG"
done
echo "=== $(date -u +%T) all done, $(free) free" | tee -a "$LOG"
