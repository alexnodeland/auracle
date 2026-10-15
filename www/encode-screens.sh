#!/usr/bin/env bash
# Crop and encode raw app captures into the site's screenshot assets.
#
# The *capture* is `capture-screens.mjs` (see SCREENSHOTS.md) — a browser
# driving the real app. This script owns everything after that, so the crop
# rectangles and the encoder settings are recorded rather than remembered.
#
#   ./encode-screens.sh <dir-of-raw-1440x900-pngs>
#
# Raw inputs expected in that directory (see SCREENSHOTS.md for the state each
# one is captured in):
#   perform.png  play.png (PATCH)  evolve.png  taste.png  learning.png
#   cmdk.png (⌘K open)  warmstart.png
#
# Encoder: cwebp (with ImageMagick for the crops) when both are installed,
# otherwise Pillow through encode-screens.py. ENCODER=pillow forces the second.
set -euo pipefail

RAW="${1:?usage: encode-screens.sh <dir-of-raw-pngs>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/landing/assets/screens"
mkdir -p "$OUT"

if [ "${ENCODER:-}" != pillow ] && command -v magick >/dev/null && command -v cwebp >/dev/null; then
  # `-preset text -sharp_yuv -q 90`, and both halves of that matter. The app is
  # saturated 10–11px type on near-black: default 4:2:0 chroma subsampling
  # smears the amber and green glyphs specifically, which `-sharp_yuv` fixes,
  # and the `text` preset spends its bit budget on edges rather than on the
  # flat faceplates. Checked against the source at 2× magnification — the mono
  # numerals on the knobs (`8.23 Hz`, `+4.0 dB`) are indistinguishable, at 30%
  # of the lossless size.
  enc() { cwebp -quiet -preset text -sharp_yuv -q 90 "$1" -o "$2"; }
  crop() { magick "$RAW/$1" -crop "$2" +repage "$OUT/tmp.png"; enc "$OUT/tmp.png" "$OUT/$3"; rm -f "$OUT/tmp.png"; }
else
  # Pillow: the same rectangles, WebP q90 at method 6. It has no `-sharp_yuv`
  # or `-preset text`, so check the crops at 2× — see encode-screens.py.
  command -v python3 >/dev/null || { echo "need cwebp + ImageMagick, or python3 with Pillow" >&2; exit 1; }
  echo "encoding with Pillow (no cwebp/magick found, or ENCODER=pillow)" >&2
  enc() { python3 "$HERE/encode-screens.py" "$1" "$2"; }
  crop() { python3 "$HERE/encode-screens.py" "$RAW/$1" "$OUT/$3" "$2"; }
fi

BEFORE="$(mktemp)"
trap 'rm -f "$BEFORE"' EXIT
for f in "$OUT"/*.webp; do
  [ -e "$f" ] && printf '%s %s\n' "$(basename "$f")" "$(wc -c <"$f" | tr -d ' ')"
done >"$BEFORE"

# Full frames. Captured at 1440×900 CSS pixels. The landing page's showcase
# caps its container at 1440 and shows them near 1:1; the books cap every figure
# inside the reading column and so show them at about 0.54×, where the app's
# 10px type is texture rather than text. That is why the detail figures below
# are *crops* rather than shrunken frames — a figure that has to be read gets
# there by showing less, never by being published larger.
frame() { enc "$RAW/$1" "$OUT/$2"; }
frame perform.png    perform.webp
frame play.png       play.webp
frame evolve.png     evolve.webp
frame taste.png      taste-map.webp
frame learning.png   learning.webp
frame cmdk.png       cmdk.webp

# Detail figures, cropped 1:1 out of the same captures. These are the ones a
# reader is meant to be able to read; each lands at its captured size, and the
# pages that show them carry that size in their width/height attributes — so a
# rectangle that changes size changes those too. capture-screens.mjs writes
# rects.json beside the frames: where each subject actually landed.
#
# Not made here since the shell (Plan-008): spec-card.webp and node-bank.webp,
# whose shot (the old node bank's spec strip) went with the strip. They stay
# as they were until the catalog's card has a shot of its own. Kept too, for
# the TASTE film until it is re-made: taste-trust.webp (its forecast scene)
# and taste-styles.webp and taste-directions.webp (its reading scene), shots
# of TASTE's old tabs, which the shell retired, so nothing here makes them.

# Rack detail: knobs at true positions in musical units, green audio cables,
# amber modulation cables with named destinations. Clear of the minimap,
# which sits bottom-left of the frame. The one rectangle that depends on the
# patch as well as the layout: re-aim it when the PATCH shot changes.
crop play.png      560x300+540+370  rack-detail.webp
# The bank (Plan-008 PR B): its head (the three tabs and Find a sound) and
# its rows, at rest, from under the menu bar (56px) to the keys bar.
crop play.png      280x766+0+56     bank.webp
# One row out of it, the one on the bench, its actions showing, for the page
# that names its parts: rects.json's play.row, from the bank's left edge.
crop play.png      280x40+0+317     bank-row.webp
# The three-pick warm start, cropped to the card, border to border. The rest of
# the frame is the app behind a scrim and carries nothing.
crop warmstart.png 760x473+340+214  warm-start.webp
# LEARNING's panels on their own: what it weighs, where liking rises and its
# forecasts. The landing page shows this beside a column of prose, in about
# 700px, where a whole 1440px frame is 0.46× and unreadable.
crop learning.png  1016x607+304+195 learning-detail.webp

echo
printf '%-26s %9s %9s\n' "asset" "before" "after"
for f in "$OUT"/*.webp; do
  n="$(basename "$f")"
  was="$(awk -v n="$n" '$1 == n { print $2 }' "$BEFORE")"
  printf '%-26s %9s %9s\n' "$n" "${was:--}" "$(wc -c <"$f" | tr -d ' ')"
done
printf '%-26s %9s %9s\n' "TOTAL" "$(awk '{ s += $2 } END { print s + 0 }' "$BEFORE")" "$(cat "$OUT"/*.webp | wc -c | tr -d ' ')"
