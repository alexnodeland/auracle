# Regenerating the app screenshots

The landing page, the product docs and the TASTE film show the **real app**,
not mockups, so the shots go stale whenever the surface changes. Two scripts:
[`capture-screens.mjs`](./capture-screens.mjs) drives the live app in a browser
and saves raw frames, and [`encode-screens.sh`](./encode-screens.sh) owns
everything after that — the crop rectangles and the encoder settings.

## Capture

```bash
make wasm                       # the shots must match the committed engine
make serve                      # http://localhost:8642
node www/capture-screens.mjs /tmp/raw
```

It uses the browser tests' Playwright (`tests/web/node_modules`, so `npm ci`
there first) at a **1440×900 viewport**. 1440×900 is not arbitrary: the app has
a 10px type floor and no page scrolling, so it lays out to fit whatever it is
given, and this is the smallest common desktop size at which the rack, the bank
and the node bank are all fully present.

Every figure on the site is capped inside the reading column, so a **full frame
is published small** — about 0.54× — and its UI labels are texture rather than
text. That is intended: a frame shows the *shape* of a view and its caption
carries what the labels would have said. **Anything whose detail is the point
is a crop**, published at the size it was cropped to and never upscaled. If you
find yourself wanting a frame to be bigger, the answer is a new crop rectangle
in `encode-screens.sh`, not a wider figure.

A run takes 12–15 minutes on a busy machine, most of it breeding, and logs each
step with its time. `--profile DIR` keeps the browser profile, so a second run
finds the session already taught and only re-shoots (about a minute);
`--only evolve,trust` re-shoots some.

### The session it teaches

A fresh session has no fitted model, so TASTE is empty and the bank has no
predictions — which shows the product at its least interesting. So the script
**teaches** one the way a person would: the three-pick warm start, then duels in
EVOLVE with EVOLVE POOL every ten picks, to at least 44 picks and three
generations (`--picks`, `--gens`) — where styles have separated. Every vote
comes from one consistent synthetic listener (dark and tonal over bright and
noisy, slow and sustained over short, read off the names the app gives patches
from their measured features): a coin-flip voter would teach the model nothing,
and TASTE would show noise where it should show a listener.

It then reloads, so the frames show the saved session as a person coming back
to it sees it, and does two pieces of grooming, both removing test debris
rather than dressing up the product:

- **Empty the HELD tray.** Automated runs leave held modules in it; a real
  session has a handful at most. Each `.tray-item` goes with its `✕`.
- **Pick a patch that shows the rack.** The camera auto-fits, so an 18-module
  patch fits at a zoom where `detail auto` has already dropped every knob, and
  a 1-module patch shows nothing. 6–10 modules is the range where plates,
  knobs, values and both cable colours are all legible. The script takes the
  highest-predicted evolution patch in that range with a modulation chain,
  rates it five stars, turns the minimap on, and zooms `⌘=` two steps above
  the fitted zoom — more while the knob labels are under the rack's 8px
  silkscreen floor — which fills the frame while the minimap shows the whole
  patch.

### Per-shot state

| Raw file | View | State |
|---|---|---|
| `play.png` | PATCH | that patch, tray empty, zoomed in |
| `nodebank.png` | PATCH | same, hovering `formant` in the node bank, the spec strip dragged open to fit its card (its 92px default at this size clips the "heard as" line) |
| `evolve.png` | EVOLVE | a duel dealt and heard, marked as an unbiased probe, the meter on a refit boundary, lineage log populated |
| `taste.png` | TASTE › MAP | styles separated, the bench patch's dot ringed |
| `styles.png` | TASTE › STYLES | — |
| `directions.png` | TASTE › DIRECTIONS | — |
| `trust.png` | TASTE › TRUST | — |
| `warmstart.png` | — | the three-pick card, nothing picked: **⋯** → *Re-run the three-pick warm start*, then dismissed with **SKIP**, which records nothing |
| `perform.png` | PERFORM | `Ceiling`, measured, a chord latched on HOLD, the first steps done, an offer waiting in B |

A shot of a broken app is worse than no shot, and the app logs its own failures
loudly, so any page error or `console.error` stops the run before the next
frame. Toasts are waited out rather than removed, the pointer is parked in the
menu bar, and `rects.json` beside the frames records where each crop's subject
landed.

## Encode

```bash
./www/encode-screens.sh /tmp/raw
```

This writes `www/landing/assets/screens/*.webp` and prints each asset's size
before and after. It encodes with `cwebp` (and crops with ImageMagick) when
both are installed; otherwise it falls back to Pillow through
[`encode-screens.py`](./encode-screens.py) — the same rectangles, q90, method 6,
but without `-sharp_yuv`, so check saturated type at 2×. Keep an eye on the
total: the landing page eagerly loads only the first showcase frame and
lazy-loads the rest, but the whole set still rides in the repo.

A crop rectangle is a claim about the layout, and the bank-row and rack-detail
ones about the session too: when either moves, check them against `rects.json`.
A crop that changes size changes the `width`/`height` of the pages showing it.
