# Audit: PATCH and explain-anything (prototype v2)

Files owned and changed: `prototype/patch.js`, `prototype/explain.js`.

Tested on desktop (1440×900), iPhone 13 (390×844, touch), a small phone (360×740,
touch) and a phone on its side (844×390, touch), with real mouse, keyboard and
touch pointer events, and with reduced motion. Scripts and evidence are in
`audit/patch/`:
- `base.js` (baseline);
- `land.js` (zoom landing);
- `verify_patch.js` and `verify_explain.js`;
- screenshots named `d-*`, `phone-*`, `v-*` and `e-*`.

The end-to-end run (`flow2.js`) is clean at 1440 px. It fails at 400 px, because of
another file (cross-file item 2).

## Findings, ranked

### P1: the zoom into PATCH landed 283 px away, and the rack stayed cramped (fixed)

- **Cause:** `layout()` sized the rack from `well.getBoundingClientRect()`, which
  includes the zoom's scale transform. The ResizeObserver fires mid-zoom, so the
  rack was laid out at 86% width (898 px in a 1044 px well) and stayed that way.
  The travelling vessel landed where the view was first laid out, then PATCH drew
  it 283 px left and 60 px up (`base.js` output, "landing").
- **Fix:** size from `clientWidth`/`clientHeight`, which transforms don't affect.
- **Verified:** `land.js` measures the core's own anchor call against the
  after-move anchor: 0 px on desktop, iPhone 13 and 360×740, from PERFORM and from
  TASTE.
- **The same bug elsewhere:** see cross-file item 1.

### P1: on a phone, the zoom landed off-screen (fixed)

- **Cause:** the rack (806 px) pans in a 364 px well, and OUT sits at its right end.
  The vessel landed at x ≈ 700, and the view opened on the sources.
- **Fix:** `show()` scrolls the rack to its OUT end. You zoom in through the sound,
  so you arrive where it is, then read leftward.
- **Verified:** `scrollLeft` = max on show; the landing jump is 0 px.

### P1: a phone had no way to ask (fixed)

- **Cause:** the only affordance was a 20×20 px "?" chip that appeared after a tap,
  also mid-swipe.
- **Fix:** hold to ask.
  - A finger held still for 480 ms on anything askable fills a ring around it
    (a conic ring, 340 ms after a 140 ms delay, so taps and swipes never show it),
    then the answer opens.
  - The click that ends the hold is absorbed, so holding a bank row doesn't also
    play it.
  - The first three early lifts show the ring half-filled and fading: the gesture
    is shown, not described.
  - The hover chip is mouse-only.
- **Verified** (`verify_explain.js`):
  - a short tap: no answer, a hint ring;
  - holding a knob: the answer "Bright · what it does";
  - holding the in-hand face: "Reese · its face", with its play click absorbed;
  - a swipe: no ring, no chip;
  - no chip on touch.

### P1: lesson step 2 overflowed a phone (fixed)

- **Cause:** 714 px of content in 609 px (iPhone 13) and in 679 px (360×740), so the
  Play button and step navigation needed scrolling.
- **Fix:** on a phone, the vessel sits beside the text (88×132 px), and step 2 keeps
  only the instruction. On short screens the lesson goes horizontal.
- **Verified:** iPhone 13 450/450, 360×740 474/474, 844×390 351/351 (scroll height
  against client height).

### P2: suggestion plates truncated their own label (fixed)

"MOD ENV suggest…", "FILTER sugg…". The name is now on the first line and
"suggested" on its own line. Verified: no truncation (`ghostTrunc: false`).

### P2: the closed catalogue sheet peeked above the phone's bottom bar (fixed)

Its closed state is now translated past the bar and `visibility: hidden` once it
closes. Verified: `visibility: hidden` when closed.

### P2: touch targets (fixed)

- **Knobs:** as narrow as 30 px; they are now at least 44×44 on coarse pointers
  (measured 44).
- **Audio-input mode buttons:** 20 px tall; now 32 px, and the device select 36 px.
  The input plate grows to 186 px on touch.

### P2: a panned rack gave no sign of plates off-screen (fixed; the phone review asked)

- Each edge fades and shows a count ("‹ 5"). Tapping it centres the next plate
  beyond that edge.
- **Verified** on iPhone 13: "‹5" at OUT, "‹2" after one tap.

### P2: answers covered the bank row they answered, with no link back (fixed)

- A bank row's answer now opens to its right, so the list stays readable.
- Every desktop answer has a caret on the edge facing its target, at the target's
  centre.
- **Verified:** row → right; SPACE → below; in-hand face → below.

### P2: an added module could land off-screen on a phone (fixed)

It now scrolls into view and pulses.

### P2: short screens, 844×390 (fixed in my files)

- PATCH's header compresses, and the rack keeps 40 px of headroom instead of 72.
- The start choice goes side by side.
- The catalogue fits.
- The answer popover and lesson scroll only if they have to; both fit, measured.

### P2: key hints on touch (fixed)

Hidden in PATCH, the answers and the lesson on `body.touch` and on
`(pointer: coarse)`. Verified: 0 visible `kbd` in PATCH on iPhone 13.

## Checked and working

- Hover and focus light the path to OUT, and light travels along it.
- The "without it" dashed outline and band dimming work.
- Modulation dashes flow at the set rate, and target pointers swing by depth; with
  reduced motion they are still ranges.
- Edited plates show "turned", with the Compare · Keep · Revert bar. Compare hides
  the estimate, and Revert clears it.
- New patch: the choice, the catalogue, a click on the suggestion to add it,
  Esc back.
- Keyboard:
  - arrows move between plates, Home/End jump to the ends;
  - Space plays;
  - Enter picks the start and adds the suggestion;
  - Esc exits;
  - "?" on a focused knob asks, and Esc returns focus to the knob.
- Reduced motion: no errors, static end states.

## P3, show the mechanism: built

1. **A turned knob reshapes the vessel.** The OUT vessel gains a dashed
   "estimated" outline: the measured shape plus each turned module's estimated
   change, from the same effect and tone models the "without it" ghost uses. Turn
   FILTER's cutoff down and the top visibly narrows.
2. **A suggestion grows out of the jack it would plug into.** Its dashed amber cable
   draws in from the target's jack (320 ms), then the plate scales out from its
   facing edge: its right side for audio, its top for a modulator.
3. **One input, many plates.** Plates sharing an input fan out from one source jack
   labelled with the device ("in 1"). The same pulse reaches every plate at once;
   approaching one lights the whole fan.
4. **An added module lights what it adds.** For 1.4 s the bands where the
   estimated spectrum changed glow on the vessel, and the signal light flows from
   the new plate to OUT.
5. **The lesson's cutoff is drawn on the vessel.** A silk line at the cutoff's
   height (the vessel's vertical axis is frequency), with everything the filter
   removes dimmed above it. The filter's horizontal axis and the vessel's vertical
   one meet.
6. **Answers follow their value.** An open knob answer redraws its figure and
   sentence as the knob turns, for example "Cuts above 1.7 kHz: the top narrows."
7. **The hold is the question.** The filling ring on touch.

## P3: proposed, not built

- **A modulator's sweep on the vessel:** an LFO on a filter's cutoff breathes the
  top of the OUT vessel at its rate.
- **Level marks that fill** with the estimated relative level per cable, labelled
  estimated until the app measures it.
- **The pair figure** could replay the pool's actual random draw for the current
  pair.
- **A knob answer's mini vessel** could show the live contour while the sound plays.

## Cross-file issues for their owners

1. **P1, `perform.js:308`, `taste.js:98` and `evolve.js:85`: the same bug as
   PATCH's.** Each sizes its canvas from `getBoundingClientRect()`. If a
   ResizeObserver fires during a zoom, the canvas is sized at the scaled rect, and
   stays wrong until the next resize. Use `clientWidth`/`clientHeight`.
2. **P1, `own.js`: `.own-lines` blocks PERFORM's knobs on narrow screens.** After a
   sound is brought in, the overlay sits on top of the knobs at 400×860, so
   `elementFromPoint` at BODY's centre returns `own-lines`. That is why `flow2.js`'s
   hover at 400 px times out. It needs `pointer-events: none`, or a position that
   doesn't cover the controls.
3. **Shell, at 844×390:** the first-visit guide pill and the "Prototype for
   approval" pill cover the bottom of PATCH's 206 px well, and the 78 px keybed takes
   a fifth of the height.
4. **PERFORM on a phone:** a "?" button now sits top-left in the well. It could open
   the vessel's answer (`A.ask(".inhand")`), so there is one way to ask, not two.
