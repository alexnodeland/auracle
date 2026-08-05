# Regenerating the app screenshots

The landing page and the product docs show the **real app**, not mockups, so
the shots go stale whenever the surface changes. This is the recipe. Capture is
manual because it needs a browser driving a live engine; everything after
capture is [`encode-screens.sh`](./encode-screens.sh), which owns the crop
rectangles and the encoder settings.

## Capture

```bash
make wasm                       # the shots must match the committed engine
make serve                      # http://localhost:8642
```

Then drive that URL in a browser (Playwright, or by hand) at a **1440×900
viewport**. 1440×900 is not arbitrary: the app has a 10px type floor and no page
scrolling, so it lays out to fit whatever it is given, and this is the smallest
common desktop size at which the rack, the bank and the node bank are all fully
present. Publish at 1:1 — see the note in `encode-screens.sh` about why these
frames are never scaled down.

Save raw PNGs into one directory as `play.png`, `evolve.png`, `taste.png`,
`styles.png`, `directions.png`, `trust.png`, `nodebank.png`, `warmstart.png`.

### The session state to capture in

A fresh session has no fitted model, so TASTE is empty and the bank has no
predictions — which shows the product at its least interesting. Use a session
that has been **taught**: several dozen picks and enough generations that
styles have separated. The committed shots were taken at 44 picks / 31
generations, where three style lenses each claim about a third of the bank.

Two pieces of grooming, both removing test debris rather than dressing up the
product:

- **Empty the HELD tray.** Automated runs leave dozens of held modules in it.
  A real session has a handful at most, and the empty state carries the
  explanatory line that a full tray hides. Click the `✕` on each `.tray-item`.
- **Pick a patch that shows the rack.** The camera auto-fits, so an 18-module
  patch fits at a zoom where `detail auto` has already dropped every knob, and
  a 1-module patch shows nothing. 6–10 modules is the range where plates,
  knobs, values and both cable colours are all legible. The committed shots use
  `Round Wash` (8 modules, 6 deep, one modulation chain) at two `⌘=` steps
  above the fitted zoom, which fills the frame while leaving the minimap
  showing the whole patch.

### Per-shot state

| Raw file | View | State |
|---|---|---|
| `play.png` | PLAY | `Round Wash` loaded, tray empty, zoomed in two steps |
| `nodebank.png` | PLAY | same, hovering `formant` in the node bank so its spec card is open |
| `evolve.png` | EVOLVE | a duel dealt, both waveforms drawn, lineage log populated |
| `taste.png` | TASTE › MAP | styles separated, a dot selected |
| `styles.png` | TASTE › STYLES | — |
| `directions.png` | TASTE › DIRECTIONS | — |
| `trust.png` | TASTE › TRUST | — |
| `warmstart.png` | PLAY | the three-pick card open, nothing picked yet — reachable from a taught session via **⋯** → *Re-run the three-pick warm start*, and dismissed with **SKIP**, which records nothing |

Before capturing, confirm the console is clean — a shot of a broken app is
worse than no shot, and the app logs its own failures loudly.

## Encode

```bash
./www/encode-screens.sh /path/to/raw/pngs
```

This writes `www/landing/assets/screens/*.webp` and prints the resulting sizes.
Keep an eye on the total: the landing page eagerly loads only the first
showcase frame and lazy-loads the rest, but the whole set still rides in the
repo.
