# Audit: TASTE and LEARNING (`prototype/taste.js`, `prototype/model.js`)

Viewports:
- desktop 1440×900;
- laptop 1024×768;
- iPhone 13 (390×664 of content, touch);
- 360×740 (touch);
- landscape phone 844×390 (touch).

Evidence is in `audit/taste/`; the scripts are `measure.js`, `plate.js`, `func.js`, `think.js`, `shots.js` and `land.js`.

## Findings, ranked, all fixed

| # | Rank | Finding | Evidence | Fix | Verified |
|---|---|---|---|---|---|
| 1 | P1 | **TASTE's map was laid out for a box 12% larger than its well.** Its ResizeObserver fires mid-zoom and measured `getBoundingClientRect()`, which includes the zoom's scale: the canvas was 1169×586 inside a 1044×523 well. Faces near the right and bottom edges were cut off at rest, and the zoom's vessel landed 12–18 px off its ring. | `measure.js` before: desk 17.4 px, phone 11.6 px | `resize()` uses layout size (`clientWidth` / `clientHeight`) | Every landing is 0.0 px on desktop, iPhone and 360: PERFORM↔TASTE and TASTE↔LEARNING, both ways |
| 2 | P0 | **Touch on TASTE couldn't audition.** The canvas's focus handler (meant for the keyboard) selected the sound in hand on every tap, and the click was then retargeted to the well. A tap held the sound immediately, with no card, and hover was the only way to preview. | Event trace: `focus` before `click:well` | Only `:focus-visible` starts keyboard mode. A tap auditions and shows a docked card; tapping the same face again, or "Hold it", holds it; tapping empty map closes the card. `touch-action: manipulation` stops double-tap zoom eating the second tap. Touch picks the nearest face within 26 px (faces are 20–24 px on a phone). | `func.js`: all tap checks pass |
| 3 | P1 | **The TASTE map was crushed on a phone.** The two-line 52 px title, the two-line footnote and a 72 px bottom pad left the map about 240 px for 62 overlapping faces. | `phone-row.png` | A one-line 28 px header, a one-line footnote, faces sized to the room (`sqrt(area/n) × 0.5`, clamped 20–32 px), and margins that follow width and height | `phone-row2.png`: the map fills the screen, with no page scroll |
| 4 | P1 | **LEARNING was 2.4 screens tall on an iPhone,** with the arrow below the fold. | `shots.js`: scrollH 1298 / 550 | The phone order is the arrow first, then the six weights that weigh most (the other twelve behind "All 18 weights"), then forecasts and export. The header is one line. | 933 / 550 (1.7 screens); the arrow and weights sit in the first 1.3 screens |
| 5 | P1 | **Watch-it-think had the effect before its cause.** Every bar grew at 900 ms, whether or not its light had arrived, and the arrow swung at the same time as the bars. | `think.js` bar start times | Each bar moves only when its light lands on its tip (1.14–1.59 s). Bars without a light settle after the last light. The arrow swings once the bars settle, leaving its old heading as a fading dashed ghost. | The start-time log is in order; `think-grid.png` |
| 6 | P1 | **On a phone, watch-it-think drew in the wrong place once the room scrolled:** the overlay used viewport coordinates inside a scrolling container. A pick seen on arrival also played below the fold. | Code review, then phone frames | The overlay uses the room's content coordinates and scroll height. On arrival, the evidence is scrolled into view before the sequence plays. A mover whose row is collapsed sends its light to "All 18 weights". | The phone sequence lands on its bars |
| 7 | P1 | **The landscape phone (844×390) collapsed** TASTE's map and LEARNING's map to 25 px. | `land.js` before | A short-screen mode (`@media (max-height: 500px)` and `body.short`): a one-line header, the TASTE map filling the height, and LEARNING side by side (six weights beside the map and forecasts; export and the math via ⌘K) | TASTE map 290 px, LEARNING map 141 px, no page scroll (`land-*-after.png`) |
| 8 | P2 | **Button sizes and the phone-only disclosure were silently ignored.** Views append their styles to `<head>`, but the core stylesheet sits later in `<body>` and wins every tie. On desktop, "All 18 weights" showed, and the heights of Replay, Copy and the plate buttons didn't apply. | `func.js` | Selectors scoped one level up (`.md .md-more`, `.ts-plate .ts-sm`, and so on) | Desktop: no disclosure; Replay is 28 px; the card's buttons are 40 px on touch |
| 9 | P2 | **The plate could cover its own face** on a phone when docked. | `plate.js`: 1 face on the iPhone (2 px) | The card docks bottom or top, whichever clears the face | 0 faces covered on desktop, laptop, iPhone and 360 |
| 10 | P2 | **The desktop weight list scrolled inside itself,** hiding two rows. | Screenshot | Rows shrink before the list scrolls (`grid-auto-rows: minmax(17px, 24px)`) | 0 px overflow |
| 11 | P2 | **The cold footnote** was the long version on a phone, because `syncText` ran before the first layout. | `phone-row2.png` | `resize()` re-syncs the text | Short on a phone, full on desktop |
| 12 | P2 | **Key hints showed on touch** (the plate's Space and ↵, Replay's R). | Coordinator's note | `body.touch` hides them | kbds visible: 0 |

## Opportunities built (show the mechanism)

- **Arriving at TASTE after picks:** each sound you kept pulses green where it sits (the cause), then amber rings open or close where the model's liking moved most (the effect). The pulses wait for the zoom to land.
- **The in-hand ring glides** from the old sound to the new one when you hold another: your hand moving.
- **Under the lens, the arrow on the TASTE map itself:** where liking rises, fitted by least squares on the map's own positions, the same computation as LEARNING's arrow.
- **A generation is its own moment on the time track:** its own slot and diamond, after the picks that led to it, rather than sitting on the last pick's tick.
- **The bars move when their light arrives,** the arrow turns only after the weights settle, and its old heading stays as a ghost.
- **A new forecast drops into the calibration strip** and rings once where it lands.

## Proposed, not built

- The time track's ticks could carry tiny faces of the kept sound on approach, so scrubbing shows what you kept at each step.
- The approach plate could draw a thin line to its face when it can't sit beside it (top or bottom dock on touch).
- LEARNING's map could show the evidence pair's two dots joined by a line during watch-it-think, linking the weights to where the two sounds sit.

## Cross-file, not mine

- **The first-visit guide says "Press A to play …" on touch devices** (`core.js`), where there is no key to press. It should say "Tap the vessel" or similar when `body.touch`. The guide pill also floats over the bottom of every view on a phone.
- **Every view's `<style>` loses ties to the core stylesheet,** which sits later in `<body>`. Other views likely have the same silent overrides as finding 8. The cleaner fix is to put the core stylesheet in `<head>` first (template and build).
- **In `flow2.js` at 400 px, the "ask" step's `page.hover` over PERFORM's BODY knob times out** (PERFORM or explain on a phone), while the 1440 run is clean.
- **TASTE → PERFORM landed 22–62 px off before this pass, and now measures 0.0 px.** Its `from` is TASTE's anchor, which was the mis-sized map.
