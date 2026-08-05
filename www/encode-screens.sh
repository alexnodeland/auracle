#!/usr/bin/env bash
# Crop and encode raw app captures into the site's screenshot assets.
#
# The *capture* step is manual and documented in SCREENSHOTS.md — it needs a
# browser driving the real app. This script owns everything after that, so the
# crop rectangles and the encoder settings are recorded rather than remembered.
#
#   ./encode-screens.sh <dir-of-raw-1440x900-pngs>
#
# Raw inputs expected in that directory (see SCREENSHOTS.md for the state each
# one is captured in):
#   play.png  evolve.png  taste.png  styles.png  directions.png
#   trust.png  nodebank.png  warmstart.png
set -euo pipefail

RAW="${1:?usage: encode-screens.sh <dir-of-raw-pngs>}"
OUT="$(cd "$(dirname "$0")" && pwd)/landing/assets/screens"
mkdir -p "$OUT"

command -v magick >/dev/null || { echo "need ImageMagick (magick)" >&2; exit 1; }
command -v cwebp  >/dev/null || { echo "need cwebp (brew install webp)" >&2; exit 1; }

# `-preset text -sharp_yuv -q 90`, and both halves of that matter. The app is
# saturated 10–11px type on near-black: default 4:2:0 chroma subsampling smears
# the amber and green glyphs specifically, which `-sharp_yuv` fixes, and the
# `text` preset spends its bit budget on edges rather than on the flat
# faceplates. Checked against the source at 2× magnification — the mono
# numerals on the knobs (`8.23 Hz`, `+4.0 dB`) are indistinguishable, at 30% of
# the lossless size.
enc() { cwebp -quiet -preset text -sharp_yuv -q 90 "$1" -o "$2"; }

# Full frames. Captured at 1440×900 CSS pixels. The landing page's showcase
# caps its container at 1440 and shows them near 1:1; the books cap every figure
# inside the reading column and so show them at about 0.54×, where the app's
# 10px type is texture rather than text. That is why the detail figures below
# are *crops* rather than shrunken frames — a figure that has to be read gets
# there by showing less, never by being published larger.
for f in play evolve taste styles directions trust nodebank; do
  enc "$RAW/$f.png" "$OUT/$f.webp"
done
mv "$OUT/taste.webp"      "$OUT/taste-map.webp"
mv "$OUT/styles.webp"     "$OUT/taste-styles.webp"
mv "$OUT/directions.webp" "$OUT/taste-directions.webp"
mv "$OUT/trust.webp"      "$OUT/taste-trust.webp"
mv "$OUT/nodebank.webp"   "$OUT/node-bank.webp"

# Detail figures, cropped 1:1 out of the same captures. These are the ones a
# reader is meant to be able to read; each lands at its captured size.
crop() { magick "$RAW/$1" -crop "$2" +repage "$OUT/tmp.png"; enc "$OUT/tmp.png" "$OUT/$3"; rm -f "$OUT/tmp.png"; }

# The node bank's spec card: one sentence, the port map, the parameters it will
# arrive with, what the model believes, and the "heard as" line.
crop nodebank.png  950x108+266+576  spec-card.webp
# Rack detail: knobs at true positions in musical units, green audio cables,
# amber modulation cables with named destinations. Positioned clear of the
# minimap, which sits bottom-left of the frame.
crop play.png      560x300+460+250  rack-detail.webp
# The teaching meter, with the unbiased-probe note beside it.
crop evolve.png    1172x60+266+58   teach-meter.webp
# The bank rail: three banks, per-row prediction, stars, save.
crop play.png      252x720+0+52     bank.webp
# One row out of that rail, for the page that names its parts one at a time.
crop play.png      252x70+0+447     bank-row.webp
# The three-pick warm start, cropped to the card. The rest of the frame is the
# app behind a scrim and carries nothing.
crop warmstart.png 760x464+340+218  warm-start.webp
# The DIRECTIONS plot on its own. The landing page shows this beside a column
# of prose, in about 700px — a full frame at that width is 0.46× and unreadable,
# so the figure there is the panel rather than the app around it.
crop directions.png 1160x621+266+140 directions-detail.webp

echo
printf '%-28s %8s\n' "asset" "bytes"
for f in "$OUT"/*.webp; do printf '%-28s %8s\n' "$(basename "$f")" "$(wc -c <"$f" | tr -d ' ')"; done
printf '%-28s %8s\n' "TOTAL" "$(cat "$OUT"/*.webp | wc -c | tr -d ' ')"
