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
#   play.png  perform.png  evolve.png  taste.png  styles.png  directions.png
#   trust.png  nodebank.png  warmstart.png
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
frame play.png       play.webp
frame perform.png    perform.webp
frame evolve.png     evolve.webp
frame taste.png      taste-map.webp
frame styles.png     taste-styles.webp
frame directions.png taste-directions.webp
frame trust.png      taste-trust.webp
frame nodebank.png   node-bank.webp

# Detail figures, cropped 1:1 out of the same captures. These are the ones a
# reader is meant to be able to read; each lands at its captured size, and the
# pages that show them carry that size in their width/height attributes — so a
# rectangle that changes size changes those too. capture-screens.mjs writes
# rects.json beside the frames: where each subject actually landed.

# The node bank's spec card: one sentence, the port map, the parameters it will
# arrive with, what the model believes, and the "heard as" line. Exactly the
# strip (#spec-dock), border to border, opened to fit the card.
crop nodebank.png  927x133+266+598  spec-card.webp
# Rack detail: knobs at true positions in musical units, green audio cables,
# amber modulation cables with named destinations. Positioned clear of the
# minimap, which sits bottom-left of the frame. The one rectangle that depends
# on the patch as well as the layout: re-aim it when the PATCH shot changes.
crop play.png      560x300+448+188  rack-detail.webp
# The teaching meter (#duel-mid, 1160x56) with 6px either side and 2px above
# and below, and the line saying how the pair was dealt inside it.
crop evolve.png    1172x60+260+59   teach-meter.webp
# The bank rail: its head, the three banks, and nine rows with per-row
# prediction, stars and save — cut in the gap under the ninth.
crop play.png      252x720+0+49     bank.webp
# One row out of that rail, for the page that names its parts one at a time:
# the rail's second slot, which is where the capture scrolls the bench row.
crop play.png      252x70+0+269     bank-row.webp
# The three-pick warm start, cropped to the card, border to border. The rest of
# the frame is the app behind a scrim and carries nothing.
crop warmstart.png 760x468+340+216  warm-start.webp
# The DIRECTIONS plot on its own. The landing page shows this beside a column
# of prose, in about 700px — a full frame at that width is 0.46× and unreadable,
# so the figure there is the panel rather than the app around it. The panel is
# 639 tall now; its last 18px are empty and stay out of the figure.
crop directions.png 1160x621+266+140 directions-detail.webp

echo
printf '%-26s %9s %9s\n' "asset" "before" "after"
for f in "$OUT"/*.webp; do
  n="$(basename "$f")"
  was="$(awk -v n="$n" '$1 == n { print $2 }' "$BEFORE")"
  printf '%-26s %9s %9s\n' "$n" "${was:--}" "$(wc -c <"$f" | tr -d ' ')"
done
printf '%-26s %9s %9s\n' "TOTAL" "$(awk '{ s += $2 } END { print s + 0 }' "$BEFORE")" "$(cat "$OUT"/*.webp | wc -c | tr -d ' ')"
