# Shell and navigation audit (core.js, style.css, template.html)

Tested with real input on:
- desktop at 1440×900, plus header widths 1280, 1100, 1024, 981, 900 and 760;
- iPhone 13 (390×844, touch);
- a small phone (360×740, touch);
- landscape phones at 844×390, 750×342 and 667×375.

Evidence is in `audit/shell/`. The harnesses there are `trans.js`, `interrupt.js`, `desk.js`, `phone.js`, `phone2.js`, `views.js` and `strip.js`. Final state: all pass, with no page errors.

## Findings, fixed

| # | P | Finding | Evidence | Fix | Verified |
|---|---|---|---|---|---|
| 1 | P0 | Rapid level changes left several views on and visible at once. After four quick moves, PERFORM, TASTE and EVOLVE were all showing. A stale `onfinish` from an earlier move ran its `done()` against the next move's views. | `interrupt.js` before | Each move has a sequence number, and only the current one may settle. `settle()` enforces exactly one view on and cancels every animation and inline style. `finish()` detaches `onfinish`. | `interrupt.js`: at gaps of 0, 40, 120 and 300 ms, one view is on, `morphing` is false, and zoom still works |
| 2 | P1 | The travelling vessel landed 17 to 146 px from where the new view then drew it: PATCH 146, PERFORM 53–62, TASTE 17. A view measures itself (ResizeObserver plus `getBoundingClientRect`) on its first show, and the zoom animation had already scaled it to 86% or 112%, so it laid out at the wrong size and stayed that way. | `trans.js` before | The zoom now starts two frames after the new view is shown, once layout and the ResizeObserver have run. The new view is held at opacity 0 until then, and the landing anchor is read after measurement. | `trans.js`: all 16 measurable pairs land at 0.0 px, desktop and phone, and every start measures 0.0 |
| 3 | P1 | From EVOLVE, ⌥↑ and ⌥↓ stepped from the wrong level: index 1, which became TASTE after LEARNING was added. | code | `A.zoom` measures from PERFORM when on EVOLVE. | manual |
| 4 | P2 | The "no further" rail nod animated `transform` and dropped the rail's `translateY(-50%)`, jumping it by half its height. | code | It animates the `translate` property instead. | manual |
| 5 | P0 | Landscape phones fell into the tablet layout. At 667×375 they got half the phone bar, off screen. | coordinator, `short-*.png` | Short-screen layout (`max-height: 500px`, landscape, sets `body.short`):<br>• compact header;<br>• a right-edge rail of 44 px stops in depth order, with EVOLVE and the keys set apart, above everything;<br>• keys as a drawer that stops at the rail;<br>• the guide in the header's empty middle;<br>• bank as a left drawer.<br>The phone rules now require a height of 501 px or more, so short screens always get this layout. `--nav-h: 0px`. | 667×375, 750×342 and 844×390: rail on screen, all stops 44 px, view ends at the rail, no sideways scroll |
| 6 | P1 | The phone bank sheet: a decorative grabber that couldn't be dragged, and a row tap that left the sheet up with the stage hidden. | coordinator | A real grabber (drag down more than 80 px closes it, or tap it). Tapping a sound closes any overlaid bank (sheet or drawer), and its face flies from the row and lands exactly in the view's `anchor()` (`A.takeUp`, with `A.morphing` held during the flight). | `phone2.js`: landing is 0 px off the well, the sheet is closed, `morphing` ends |
| 7 | P1 | On touch there was no way to star, save or cut from the bank: actions appeared only on hover. | `phone.js` | Under `(hover: none)`, the live row (the one you just took up) shows its actions at 44 px. | `phone.js`: tap the live row's save, and Saved = 1 |
| 8 | P1 | Toasts on phones sat on the guide, then on the core-loop controls, for 7 s. | coordinator, `phone2.js` | On phones, toasts drop from under the header. A toast is `pointer-events: none` except its Undo, so taps pass through to the controls beneath. On desktop, toasts sit above the guide's line. | `desk.js` and `phone2.js`: no control is intercepted, and the toast is clear of the guide and bar |
| 9 | P1 | Keyboard hints showed on touch (⌘Z, SPACE, ↵, ⇧F, ⌥, N, B, 1/2, ESC), as did keybed letters. | coordinator | `body.touch` (coarse pointer) hides every `kbd` and keybed letter, keeping the octave label. | `phone2.js`: 0 visible `kbd` |
| 10 | P1 | The keys drawer covered the stage, and its scrim blocked the view you were playing. | `phone.js` | While open, the view's bottom lifts by the drawer's height, and there's no scrim for keys. | `phone2.js`: overlap 0 px |
| 11 | P1 | The phone keybed was 22 keys at 760 px, scrolling sideways; taps in the 2 px gaps hit nothing; one finger at a time; no glissando. | `phone.js` | Phones show an octave and a third (10 white keys, 35 px each), with 44 px octave buttons. The seams are drawn inside each key, and a tap in one lands on the nearest key. Each pointer is its own note (chords), and sliding plays each key in turn. The octave change slides the letters. | `phone2.js` (seam tap plays), `phone.js` (two fingers, two notes), `desk.js` (glissando `[0,2,4,5,7]`) |
| 12 | P2 | Touch targets under 44 px: the header's play (26), icon buttons (34), MODEL and search (30/34), and row actions (24). The bar's labels were 9 px. | `phone2.js` | 44 px on coarse pointers. Bar labels are 11 px, title case. | `phone2.js`: header and bar targets all at least 44 px |
| 13 | P2 | The phone bar flattened depth into six equal tabs. | coordinator | The bar is ordered LEARNING, TASTE, PERFORM, PATCH, joined by a line (the zoom axis). EVOLVE and Keys each sit behind a divider. | `p-bar-crop.png` |
| 14 | P2 | The lens banner covered PERFORM's share button on phones. | coordinator | On phones the lens line sits above the bar (it is non-interactive); a toggled lens says its line and goes quiet after 3.2 s, leaving the amber. | `phone2.js` |
| 15 | P1 | Cascade: the core CSS (in the body) beat the views' head styles on ties. | coordinator (TASTE) | All of `style.css` is inside `@layer base`, so the views' unlayered rules win. | `views.js` before and after: SSIM 0.99 on everything but EVOLVE, which deals a random pair, and phone TASTE, where its own rules now apply as intended |
| 16 | P2 | The palette ranked by insertion order ("gla" gave "Go to EVOLVE" first) and didn't give focus back. Notes didn't give focus back either. | `desk.js` | Ranked: a prefix beats a word start, which beats a substring, which beats scattered letters; groups are ordered by their best hit. Focus returns on close for the palette and notes. Palette rows are 48 px on touch. | `desk.js` |
| 17 | P2 | Bank tabs had no keyboard movement or `aria-controls`; the Pool count included cut sounds; re-renders dropped focus. | code | Arrow keys move between tabs, with `aria-controls`; counts exclude cuts; focus is restored after each redraw. | `desk.js` |
| 18 | P2 | The phone bar's indicator started 2.9 px off at 360 px (measured before the fonts loaded). | `phone.js small` | Re-measured on `fonts.ready` and on resize. | 0.0 px |
| 19 | P2 | The guide's copy was keyboard-only on touch. | coordinator | Under `body.touch`: "Tap a key to play Reese" (a note or a tap counts), "Pinch in: Reese among every sound", "Hold MODEL to see what the model thinks" (MODEL now supports press-and-hold like ⌥, and a tap toggles), and "Evolve: keep the one you'd reach for". | `phone.js` |

## API added for the views

- `A.pool` is still a Set; its `add` and `delete` emit `"pool"` with `{added}` or `{deleted}`.
- `A.poolAdd` and `A.poolDelete` wrap those.
- `A.bankTab(id)` switches bank tabs.
- `A.faceCanvas(p, w, {h, pad, margin})` draws in any box; the old square call is unchanged.
- `A.flyFace(p, from, to, {land})` moves a face between two rects; with `land`, it arrives exactly in a tall box.
- `A.takeUp(p, srcCanvas)` puts a sound in hand and flies its face to the current view's anchor.
- `A.teach(n, fromElementOrRect)` sends a spark to TAUGHT before the count rolls.
- `A.dust(canvas, {reverse})` breaks a face into dust, or gathers it back.
- `A.roll(el, text)` changes a number with a roll.
- `A.seen(el)` returns an element's rect if it is on screen.
- `A.TOUCH`, and the body classes `touch` and `short`.
- `A._fly` holds the last flight's rects, for tests.

## Meaning, built

- **A puck on the rail:** a light travels from the level you left to the one you are entering, turning the corner at PERFORM for EVOLVE. The destination lights when the puck lands.
- **The phone bar:** a green line slides to the current level, and a pinch in progress leans it toward the level it would reach, then lets it return.
- **The header's level name** arrives from the direction of the move: from below zooming in, from above zooming out, from the side for EVOLVE.
- **The lens rises out of the MODEL toggle:** the veil is lit from it, and the tag grows from it.
- **Saving** drops the face onto the Saved tab, or the bank button on a phone, and the count swells.
- **Cutting** turns the face to dust while the rows close over the gap (FLIP); undo gathers the dust back into it.
- **The bank's rows glide** to new places when they re-sort, for example when the lens ranks them by liking.
- **Starring or cutting** sends an amber spark to TAUGHT, and the count rolls up; taking it back rolls it down.
- **Taking a sound from the bank** flies its face from the row into your hands.
- **A guide step done** swells its pip before the next step arrives.
- **Breeding** leaves a green "+N" badge on the bank and the Pool tab until you look.

## Proposed, not built

- The rail's hover labels could show each level's current contents as tiny faces (TASTE: the halos' count; PATCH: its module count).
- TAUGHT could fill a six-pip ring toward the next refit instead of showing a bare number.

## Cross-file findings, for routing

- **own.js** (P1): at 400×860 the brought-in sound's card (`.own-name` and the card) covers PERFORM's BODY knob, so it can't be pointed at or pressed (`flow2.js` at 400: hover timed out; `elementFromPoint` returns `.own-name`).
- **explain.js** (P2): the ask chip ("?") hangs past the right end of bank rows (`d-bank3.png`).
- **evolve.js** (P2): at 1440 the two cards abut with no gap, and KEEP A crowds card B's title (`layer/cmp-desk-evolve.png`). Views may pass their source to `A.teach(1, element)` to get the spark to TAUGHT: EVOLVE's kept card, PERFORM's offer on Take and Pass.
- **taste.js** (P3, check): with the core layered, its footer renders in Jost, not Plex Mono (`layer/cmp-phone-taste.png`). Confirm that's intended.
- **All views:** in `body.short` (landscape phones), lay the view out for a stage about 296 px tall with 58 px taken by the rail on the right. PERFORM's head is off the first screen at 844×390 (`p-land.png`).
