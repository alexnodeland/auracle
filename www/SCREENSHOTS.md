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

From a fresh profile a run takes about 13 minutes on a busy four-core machine,
most of it breeding, and logs every step with its time. `--profile DIR` keeps
the browser profile, so a second run finds the session already taught and only
re-shoots (one to six minutes, depending on what the engine is still doing);
`--only evolve,trust` re-shoots some.

### The session it teaches

A fresh session has no fitted model, so TASTE is empty and the bank has no
predictions — which shows the product at its least interesting. So the script
**teaches** one the way a person would: the three-pick warm start, then duels in
EVOLVE with EVOLVE POOL every ten picks, to at least 44 picks and three
generations (`--picks`, `--gens`), where styles have separated — the committed
shots have three lenses each claiming about a third of the bank. Every vote
comes from one consistent synthetic listener (dark and tonal over bright and
noisy, slow and sustained over short, read off the names the app gives patches
from their measured features): a coin-flip voter would teach the model nothing,
and TASTE would show noise where it should show a listener.

It then reloads, so the frames show the saved session as someone coming back to
it sees it, waits for the engine's refit of that session and for PERFORM's
background measurements to finish (the engine is one thread, and a bank click
queues behind them), and does two pieces of grooming — both removing test
debris rather than dressing up the product:

- **Empty the HELD tray.** Automated runs leave held modules in it; a real
  session has a handful at most. Each `.tray-item` goes with its `✕`.
- **Pick a patch that shows the rack.** The camera auto-fits, so an 18-module
  patch fits at a zoom where `detail auto` has already dropped every knob, and
  a 1-module patch shows nothing. 6–10 modules is the range where plates,
  knobs, values and both cable colours are all legible. The script takes the
  highest-ranked evolution patch in that range with a modulation chain that the
  listener likes, rates it five stars, scrolls the rail so its row sits second
  (the bank-row crop's slot), turns the minimap on and zooms `⌘=` two steps
  above the fitted zoom — more while knob labels are under the rack's 8px
  silkscreen floor — then pans the few pixels that keep the frame's edges
  between rows of plates rather than through their titles.

### Per-shot state

| Raw file | View | State |
|---|---|---|
| `play.png` | PATCH | that patch, tray empty, zoomed in, minimap on |
| `nodebank.png` | PATCH | same, the node bank scrolled to SOURCES and `formant` hovered, the spec strip dragged open to fit its card (its 92px default at this size clips the "heard as" line) |
| `evolve.png` | EVOLVE | a duel dealt and heard, marked as an unbiased probe, the meter on a refit boundary, lineage log populated |
| `taste.png` | TASTE › MAP | styles separated, the PATCH patch's dot ringed |
| `styles.png` | TASTE › STYLES | — |
| `directions.png` | TASTE › DIRECTIONS | — |
| `trust.png` | TASTE › TRUST | — |
| `warmstart.png` | — | the three-pick card, nothing picked: **⋯** → *Re-run the three-pick warm start*, re-dealt until every row is two lines (the size the crop is cut to), dismissed with **SKIP**, which records nothing |
| `perform.png` | PERFORM | `Ceiling`, measured, a chord latched on HOLD, the first steps done, an offer waiting in B |

A shot of a broken app is worse than no shot, and the app logs its own failures
loudly, so any page error or `console.error` stops the run before the next
frame. Toasts are waited out rather than removed, the pointer is parked in the
menu bar, a style name too long for its chip is reported, and `rects.json`
beside the frames records where each crop's subject landed.

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

A crop rectangle is a claim about the layout, and rack-detail's about the patch
too: when either changes, check them against `rects.json`. A crop that changes
size changes the `width`/`height` of every page that shows it.
