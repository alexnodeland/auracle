# Prototype v2 on a phone: holistic review

Review only; no source files edited. Measured 17:50 to 18:10 on 30 September, after the
other five forks' first fixes landed. Evidence is in `audit/mobile/`. Scripts:
- `measure.js`: layout, scroll depth, above-the-fold, touch targets and tiny text,
  per device and view;
- `gestures.js` and `gestures2.js`: real touch through CDP for drags, pinches and swipes;
  taps; slowed frames.

Devices:
- iPhone 13 as Playwright ships it (390×664, the Safari viewport);
- iPhone 13 full height (390×844);
- iPhone SE (375×667);
- 360×740;
- landscape (844×390).

All with touch.

## Where it stands

Portrait is in good shape. PERFORM, EVOLVE, TASTE and PATCH each fit in **one screen**
on every portrait size, including the SE (`row-iphone13.png`, `strip-se.png`):
- **PERFORM:** the sound, all six controls, and Offer/Peek/Take/Pass are all visible.
- **EVOLVE:** both cards sit side by side, so a real A/B works on a phone, and both Keep
  buttons and Evolve pool are visible.

What passes, with real touch:
- **Pinch** zooms both ways (PERFORM → PATCH → PERFORM → TASTE).
- **Knob drags** work (BRIGHT 0.50 → 0.86) without scrolling the page.
- **Swipe up to keep** works; a downward swipe and a tap don't pick, and a tap plays.
- **Offer → take** grows, fills and lands.
- **Stage mode** plays by tap and leaves by ×.
- **The palette** opens from the search icon.
- **The first-visit guide** says "Tap the sound to hear Reese" on touch.
- **No page errors.**

## P0: broken

1. **Landscape phone is unusable** (`strip-landscape.png`; `measure.json` "landscape").
   - **What happens:** 844×390 falls into the ≤980 px "tablet" layout. The header (56) and
     the keys bar (64) leave 334 px for the stage.
     - PERFORM: the knob grid draws *through* the sound's name, the well is cut off, and
       the sound is 1.5 screens down.
     - EVOLVE: both cards collapse to zero height (no vessel visible), and the names overlap
       "Another pair".
     - The first-visit pill and the prototype pill sit on the well.
   - **Owner:** `style.css` (shell), plus the view CSS in `perform.js` and `evolve.js`.
   - **Fix:** a phone-landscape layout, `@media (max-height: 500px) and (orientation: landscape)`:
     - header 44 px;
     - the rail as a slim left column, or kept as the bottom bar with icons only;
     - the keys hidden behind the Keys stop;
     - PERFORM: the vessel on the left half, the six knobs in a 3×2 grid on the right, and
       the pads in one row under the knobs;
     - EVOLVE: two cards side by side, full height;
     - the guide pill and the prototype pill hidden.

   This is the natural posture for playing, so it deserves a designed layout, not a
   squeeze.

## P1: wrong

2. **Toasts cover the core loop for 7 s** (`h-perform-toast.png`, `h-evolve-after.png`).
   - **What happens:** the toast stack sits at the stage's bottom centre, 16 px above the
     bar.
     - PERFORM: "Took Ceiling…" (491–546 px) covers the Offer/Peek/Take/Pass row
       (502–550). A tap on Peek hits the toast (hit chain `SPAN<DIV.toast`). You can't
       offer again until it leaves.
     - EVOLVE: "Kept …" (492–546) covers "Another pair" and "Evolve pool" (504–548).
   - **Owner:** `style.css` (`.toasts` under ≤700 px) and `core.js` (`A.toast`).
   - **Fix:** on a phone, show toasts at the top, just under the header, over the name
     area rather than the action row. Or make the toast a slim chip above the guide line,
     with the undo on the chip, and never over `.pf-pads` or `.ev-foot`. Either way,
     drop "⌘Z" from its button on touch.
3. **The keys drawer squeezes PERFORM's layout** (`h-keys-playing.png`).
   - **What happens:** with Keys open, the view shrinks and the knob grid rides up over
     the well. The BODY knob draws on top of the vessel, and BRIGHT and SNAP overlap the
     well's corners.
   - **Owner:** `style.css` and `perform.js`.
   - **Fix:** when `keys-open`, keep the well and the pads and hide the knob grid, or
     collapse it to one row of six small knobs, so the layout reflows instead of
     overlapping. Playing and seeing the sound is the point; the knobs can wait for the
     drawer to close.
   - **P3 with it:** a played key should light its pitch band on the PERFORM vessel, as
     stage mode already does.
4. **The bank sheet's handle is a promise it doesn't keep** (`strip-sheets.png`, frames 1–2).
   - **What happens:**
     - The sheet draws a grabber, but a real touch drag of 260 px down leaves it open
       (`gestures.log`).
     - Tapping a row puts that sound in hand ("Acid Line"), but the sheet stays open over
       the well. You picked a sound you can't see, and must find the scrim to close it.
   - **Owner:** `core.js` (bank) and `style.css`.
   - **Fix:**
     - Drag down on the handle or head to dismiss, following the finger, and close past
       30%.
     - On a row tap, close the sheet and fly the row's face into the header chip and on
       into the well: the sound you picked visibly arrives. That is a show-the-mechanism
       moment, and it ends the sheet in one gesture.
5. **Keyboard hints on touch mislead** (`strip-h.png`, `strip-sheets.png`).
   - **What happens:** "⌘Z" on every undo toast, "SPACE" and "↵" on TASTE's approach
     plate, "⇧F" on the stage button, "⌥" on the MODEL toggle, "N" and "B" in pad
     labels, "1"/"2" on EVOLVE's play buttons, and "ESC" on PATCH's "Back to Reese".
     A phone has none of these keys.
   - **Owner:** `style.css` (one rule), plus copy strings in each view.
   - **Fix:** `@media (hover: none) and (pointer: coarse) { kbd { display: none } }`, and
     swap words where a key is the instruction ("hold B to peek" → "hold Peek", which
     PERFORM's canvas already does in places).
6. **On a phone, the sound isn't the largest thing on PERFORM** (`row-iphone13.png`, `strip-se.png`).
   - **What happens:** the well is about 130–170 px tall on 390×664. The knob grid gets
     about 190 px and the pads 48. The offer then grows into a 172 px well, so B is only
     a little over 100 px tall. This inverts the brief's first rule.
   - **Owner:** `perform.js`.
   - **Fix:**
     - Give the well about 40% of the usable height (about 220 px on 664).
     - Shrink the knobs to 48 px dials with the name only (the value on touch); two rows
       fit in about 150 px.
     - Put the name and eyebrow on one line (26 px name).
     - Keep the pads at 48 px.

     Arithmetic on 550 usable px: name 36 + well 220 + knobs 150 + pads 48 + gaps 40 =
     494. It fits without scrolling.
7. **The previous sound's flight crosses the title** (`strip-offer-take.png`, frames 5–6).
   - **What happens:** on a take, the phone sends the old sound to the header's bank icon
     at the top left. Its path runs straight across "Reese" (the vessel sits on the "e").
   - **Owner:** `perform.js`.
   - **Fix:** arc the path through the well's upper-left corner and up behind the header,
     at z below the header text. Or fade it into the bank icon from the well's edge, and
     pulse the icon when it lands.
8. **"How it works" on a phone crowds a 170 px well** (`strip-h.png`, shot 3).
   - **What happens:** the "?" in the well's corner opens the response figure. It takes
     the left 196 px of a 362 px well, with axis labels at 12 px, and the vessel shrinks
     beside it.
   - **Owner:** `perform.js` (and `explain.js` has the same figure).
   - **Fix:** below 700 px, open it as the ask bottom sheet, the same component explain
     uses. Or swap the knob grid for the figure while it's open, so the vessel keeps its
     size.

## P2: polish

9. **Touch targets under 44 px** (`measure.json` "smallList"):
   - the header's play button in the in-hand chip, 26×26: it is the *global play*, so the
     most-used control, and the smallest;
   - MODEL toggle 25×30;
   - search 35×34; bank 34×34; notes 34×34;
   - Share 34×34; the well's "?" 32×32; the stage button 64×32;
   - the guide's × 24×24; the ask chips 20×20;
   - "Colour by taste" 140×30;
   - PATCH's knob hit areas 30×49; "How to read this" 151×24.

   **Fix:** 44×44 hit areas (padding or `::after` extenders) without growing the drawn
   size. Owners: `style.css`, `perform.js`, `explain.js`, `taste.js`, `patch.js`.
10. **The bottom bar's labels are 9 px** ("LEARNING", "TASTE", "PERFORM", "PATCH",
    "EVOLVE", "KEYS"), under the 12 px floor. Six items at 390 px leave 65 px each.
    **Fix:** 11 px silk caps (the label size), with a tighter letter-spacing of .08em.
    Owner: `style.css`.
11. **The bottom bar flattens the space it is meant to explain.** The rail's vertical
    zoom axis (out ↑ / in ↓, EVOLVE to the side) becomes six equal tabs.
    **Fix:** order them as depth, LEARNING · TASTE · **PERFORM** · PATCH, with EVOLVE set
    apart after a hairline and KEYS last. Slide the active indicator with the zoom
    morph, the same distance and easing. A pinch then visibly moves the indicator, which
    ties the gesture to the map of the space. Owner: `style.css` and `core.js`.
12. **A tap in the 2 px gap between keys plays nothing.** The pointerdown target is
    `.keybed`, not a key. **Fix:** on the keybed, map `clientX` to the nearest key
    instead of relying on `closest("[data-semi]")`. Owner: `core.js`.
13. **The keys drawer shows the computer-keyboard letters** (A S D F G H J K L ;) on touch
    (`h-keys-playing.png`). **Fix:** hide them under `(hover: none)`, keep the octave
    names. Owner: `core.js` and `style.css`.
14. **PATCH's rack starts scrolled to OUT** (scrollLeft 442 of 806), with no sign that
    three modules sit to the left. A clipped "…le" label peeks in at the bottom left
    (`strip-se.png`, shot 4). **Fix:** fade the rack's left edge, add a "← 3 modules"
    chip, and flash the signal light from the leftmost source on arrival, so the eye
    follows it right to OUT. Owner: `patch.js`.
15. **The lens banner** ("still guessing · it fits after 6 picks") sits over the share
    button and the right of the name (`strip-sheets.png`, shot 4). Its knob captions add
    a third text line to every knob. **Fix:** on a phone, dock the banner under the
    header as a full-width 28 px strip, and show a knob's lean as the amber arc only,
    with the words on approach. Owner: `style.css` and `perform.js`.
16. **The toast lands on the first-visit guide** (both at the bottom left). **Fix:** the
    toast placement in item 2 fixes this too.

## P3: show the mechanism, phone-specific

17. **Choosing from the bank:** the row's face flies up into the header chip and down into
    the well (item 4). It is the "you picked this" moment, and it closes the sheet.
18. **Keys light the vessel:** each held key lights its pitch band on PERFORM's vessel,
    the same code as stage mode (item 3). "The vessel is a keyboard on its side" then
    holds everywhere, not only in stage.
19. **Pinch drives the bottom bar's indicator:** as fingers spread, the indicator slides
    toward PATCH in proportion before the level commits, a preview of where you are
    going (item 11).
20. **Swipe up to keep:** the card follows the finger up, and its face lifts out of the
    card toward the TASTE stop as you drag. Release past the threshold and it flies the
    rest of the way, as the tap-Keep flight already does. Today the card moves but the
    face doesn't lead.
21. **Breeding on a phone:** the children bud over the cards and fly to the header's bank
    icon, which is right. Add a count badge on the bank icon ("+6") that holds until the
    sheet is opened, so the new sounds can be found.

## Things that already read well on a phone (keep them)

- **The zoom morph:** the vessel shrinks into its ring on the map and grows back
  (`strip-zoom.png`).
- **The pick flight goes to the TASTE stop** in the bottom bar, since the mini map is
  hidden (`strip-fly-breed.png`, frames 2–3).
- **Breeding's children fly to the bank icon** (`strip-fly-breed.png`, frames 4–6).
- **The offer grows from its parent:** "B · HEARTBEAT", "hold Peek"
  (`strip-offer-take.png`, frames 1–3).
- **Stage mode:** full bleed, "tap to play · × to leave" (`strip-sheets.png`, shot 6).
- **LEARNING's watch-it-think** is on the first screen: the kept and passed faces, and
  light into the bars (`strip-h.png`, shot 5).
