# EVOLVE audit: prototype v2 (`prototype/evolve.js`)

Audited on desktop 1440×900, iPhone 13 (390×664 viewport, touch) and 360×740 (touch).
Evidence is in `audit/evolve/`. The harnesses are `measure.js` (fit and flight geometry),
`strip.js` (slowed pick frames) and `inputs.js` (touch, keys, reduced motion). All of
them run clean, with 0 page errors.

## Findings, fixed and verified

| # | Rank | Finding | Evidence (before) | Fix | Verified (after) |
|---|---|---|---|---|---|
| 1 | P1 | The kept sound's flight popped on its first frame. The flying canvas drew a square face box (268×268) over the card's 183×305 vessel: 85 px wider and 37 px shorter. The card's own copy also stayed drawn under it. | `before-report.json` flight | The flight is drawn with the card's exact vessel box, glow and line, and the card hides its copy while it flies. | Start jump **0.01 px**, end miss **0.02 px** (`after-report.json`) |
| 2 | P1 | On a phone (and below 980 px) the mini map is hidden, so the flight landed at the top-left corner: a flight to nowhere. | `before-*-afterpick.png`, `flightEnd` ≈ (95, 71) | When the map is away, the kept sound flies into TASTE's stop on the rail or bottom bar (where the map lives), and the stop pulses green. | Miss **0.02 px**; `strip-phone.png` frame 2 |
| 3 | P1 | The phone didn't fit. The view was 1,064 px tall in a 550 px viewport (iPhone 13), with B's Keep below the fold, stacked 240 px wells, and 38 px buttons. | `before-phone-rest.png` | One-screen layout: two wells side by side (tap to hear, swipe up to keep), a name and one Keep under each, the meter above, and "Another pair" and Evolve pool below. Space is reserved for the first-visit pill. | **550/550** (iPhone 13) and **626/626** (360×740): no scroll; Keep buttons **44 px** (`phone-3.png`) |
| 4 | P1 | Bred children landed off target. The transform maths used the row's top-left with a centre-origin scale, so each child would land about S/2 − 13 px (≈137 px) to the right of its row. | code, before | Centre-to-centre and size-to-size: 26 px lands on the 26 px row face. With the bank put away, the child flies into the bank button, which pulses. | Desktop miss **0.02 px** (26→26); phone **0.01 px** into the bank button |
| 5 | P1 | On the Presets tab (the default), the replaced sounds faded and then popped back, because that tab lists every preset whatever the pool holds. The mechanism contradicted itself. | code | Breeding switches the bank to the Pool tab, since the pool is what changes. Children join first, hidden until they land; the sounds liked least fade out of the list. | `after-desk-afterbreed.png` |
| 6 | P1 | A bred child's row didn't exist until it landed, so the flight aimed at the list's corner. | code | The child is added to the pool before its flight, its row face hidden, and the row scrolled into view first. | Measured with #4 |
| 7 | P1 | The next pair popped in at once after a pick or N. | `strip-desk` (before) | The pair rises out of the pool: A, then B 70 ms later (320 ms, the move token), and the names fade up. | `strip-desk.png` frame 4 |
| 8 | P1 | After a tap on touch, the other card stayed dimmed: attention followed `pointerenter` on touch too. | code | Attention dims only for a mouse. | `inputs.js` taps |
| 9 | P1 | On the phone, the sixth pick stacked two toasts (Kept, and "it fitted your taste") over the Keep buttons. | `strip-phone.png` frame 4 (before) | The first fit is said in the meter itself: "it has fitted your taste · SEE IT ⌥4", where the teaching meter lives. The toast is gone. | `fit-small-s.png`, `fit-desk-s.png` |
| 10 | P1 | The meter went stale when the model learned outside EVOLVE, for example from an offer taken in PERFORM. I introduced this mid-audit and fixed it. | harness | Outside learning redraws the meter and clears the stale "it guessed" line. The pick's own pip waits for its drop. | `after-desk-afterbreed.png` |
| 11 | P2 | The wells played on click but had no play affordance and weren't keyboard-reachable. | code | Wells are `role=button` with a tab stop and Enter/Space, a label ("Play Heartbeat"), and a ▶/■ glyph showing the play state. | `inputs.js`: "Enter on a focused well plays" |
| 12 | P2 | Swipe was horizontal on stacked cards: no affordance, and it fought vertical scrolling. | code | Swipe up to keep (the kept sound flies up and away): a "↑ keep" hint in each well on touch; the card lifts (capped at 36 px) with a green edge as you drag; a sideways move cancels; a short drag neither keeps nor plays; the well has `touch-action:none`, and the page doesn't need to scroll. | `inputs.js`: tap plays; short drag, sideways swipe do nothing; swipe up keeps; `mid.png` |
| 13 | P2 | The ask was pointer-only ("Keep the one you'd reach for."); key hints showed on touch. | code | On touch: "Tap to hear. Swipe one up to keep it." Key hints are hidden on touch, and phone labels are shorter. | `phone-3.png` |

Timing uses the tokens:
- flight 720 ms (a view move);
- arrival 320 ms and drop 360 ms (the move token);
- the "fair test" shuffle 380 ms, and the refit sweep 900 ms.

Reduced motion: every moment resolves at once, and no flight canvas is left behind (`inputs.js`).

## Show the mechanism: built

- **A fair test.** When a pair is dealt, a ring hops over a few random pool dots on the mini map before settling on A and B. The pair is visibly drawn out of the pool at random.
- **The passed sound sinks back into the pool** (fades, drops 10 px, shrinks), while the kept one lifts and flies to its place.
- **Where you have been teaching.** Your last six picks keep a quiet silk ring on the mini map; the newest glows, then settles.
- **The pick drops into the meter.** An amber drop leaves the landing point (the map dot, or TASTE's stop) and lights the next pip. Only then does the model say what it had guessed ("it guessed this · 64% ✓" / "it guessed the other · 58% ✗" / "it was only guessing").
- **Refit.** Every sixth pick, the pips flash in turn and the map's amber glow sweeps outward from the pick that completed the six. On narrow screens, TASTE's own tab takes the amber.
- **Breeding.** Each child buds from its nearest parent and lands on its own row in the Pool (or in the bank button on a phone), and the least-liked fade out of the list.

## Proposed, not built

- **The forecast as a balance:** after a pick, the two faces briefly lean by the model's split before the kept one leaves.
- **A fair test on a phone** (no mini map): a brief flurry of dots rising from the bottom bar's POOL/bank into the two wells.
- **Replaced sounds shrink into their map dots** on the mini map, not only fading from the bank.

## Cross-file issues (not mine to fix)

1. **core.js, toasts on a phone.** Toasts sit on the first-visit guide pill and near the foot. Two in a row stack over the controls. Suggest: at 700 px and below, show toasts just below the header, or one at a time, and avoid the guide.
2. **explain.js.** On touch, the "?" ask chip appears on every touch-down on a well, including during a swipe. Suggest: no chip for touch pointers during a drag, or show it only after a long press.
3. **core.js, bank tabs.** There is no API to switch bank tabs, so EVOLVE clicks the first `.btab` (fragile). Suggest `A.bankTab(id)`. Also no `"pool"` event; TASTE had to wrap `A.bankDraw` to notice pool growth.
4. **core.js, `A.faceCanvas`.** It always draws a square box, while large faces use a 0.6 aspect. Any flight that starts from a large vessel with `faceCanvas` will pop, as EVOLVE's did. Suggest an aspect or box option, used by every flight (PERFORM's take, own.js, TASTE).
5. **Flow harness.** At 400 px, `flow2.js`'s "ask" step times out hovering PERFORM's BODY knob (`page.hover`). That is PERFORM/explain territory on a phone, not EVOLVE.

## Round 2 (coordinator follow-ups)

| # | Rank | Finding | Fix | Verified |
|---|---|---|---|---|
| 14 | P0 | In phone landscape (844×390), the cards collapsed to 2 px wells; at 667×375 the view scrolled (438/257) with both Keeps below the fold. | Short-screen layout (`@media (max-height:500px)` and `body.short`): one control row (meter, then icon-only "another pair" and Evolve pool), then two cards, each a full-height well beside a column with the name and Keep. The ask becomes screen-reader only (the wells carry "↑ keep" and ▶). | 844×390: wells **282 px**, no scroll (344/344). 667×375: wells **267 px**, no scroll (329/329). Keeps 40 px, both in view; `lf844.png` |
| 15 | P1 | Between 981 and about 1200 px wide, the grid's implicit `auto` column grew to its content's min-width: at 1024 the duel was **1,110 px in a 676 px view**, so card B ran off screen. A and B also had unequal widths at 1440 (470 vs 536). | `minmax(0,1fr)` columns throughout; cards are size containers and stack name over buttons below 460 px; the foot never wraps, and the fair-test note hides at 1200 px and below. | All pairs are equal and inside the view at 1440, 1280, 1100, 1024, 844 and 390 px; no wrapped buttons |
| 16 | P1 | The rail's EVOLVE branch reached 28 px into the view and sat on card B's edge. | 12 px more right padding on desktop and tablet widths. | No overlap at 1440, 1280 or 1024 |
| 17 | P1 | Wells were sized with `getBoundingClientRect`, so they could read a scaled box mid-move. Flights also launched from the well's border box, 1 px off the canvas. | `clientWidth`/`clientHeight` for layout size; re-measure on `morphend`; flights launch from the canvas's own rect. | `side.js`: from PERFORM, TASTE and PATCH into EVOLVE, on desktop, phone and landscape, the canvas matches its well exactly (0 px), flights start within **0.01 px**, and land within **0.01–0.02 px** |
| 18 | P2 | Key hints showed on touch (5 visible at 844 px). | Hidden under `(hover:none) and (pointer:coarse)` and `body.touch`. | 0 visible hints on touch |
| 19 | P2 | On small wells, the lens forecast ("it guesses 65%") sat under the ▶ glyph. | It sits beside the letter. | Screenshots |

Re-run: `inputs.js` passes 15/15.

**Cross-file, for the shell:** at 667×375 (≤700 px and short), the ≤700 bottom-bar rail rules
still apply. The rail is a full-width bar at y 313–375 with its EVOLVE stop off-screen
(y 504), while `.view { bottom: 0 }` runs under it, so the bottom 54 px of EVOLVE (the
Keep buttons, y 327–367) sit beneath the bar. At 844×390 the right-edge rail is correct.
