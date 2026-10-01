# Audit: PERFORM and its moments (`perform.js`, `own.js`, `stage.js`)

Tested on desktop (1440×900), iPhone 13 (390×664 visible, touch), iPhone SE (320×568),
360×740 touch, and iPhone 13 landscape (750×342), plus reduced motion. Evidence and scripts
are in `audit/perform/`: `measure2.js` (layout per viewport), `moments.js` (per-frame boxes
through offer/swap/take/pass), `home.js` (where the released sound lands), `knobs.js`,
`stage.js`, `zoomland.js`, `strip.js`, and the screenshots named below.

## Findings, ranked

### P0
1. **The draw loop double-booked frames.** Each frame could schedule two more, so draws
   multiplied and a settling spring ran many steps per frame. This was introduced by the
   settling work in this audit, and caught by sampling (a reset "sprang" in 68 ms).
   - Fixed: one frame booked at a time (`tick` checks `raf`), and the spring steps by
     elapsed time without catching up on idle.
   - Verified: about 1 draw per frame; the reset trace settles smoothly over about 600 ms.
2. **The phone didn't fit.** At 390×664 PERFORM was 1185 px tall, with Offer at y=969, two
   screens down. The 340 px knob grid and the guide pill sat over the knobs.
   - Fixed with a phone layout: the vessel takes the leftover room; six knobs in one row
     (46 px dials, value shown as a bubble while turning); pads in one row, lowest, in
     thumb reach; the guide pill reserved below.
   - Verified: no scroll at 390×664, 320×568, 360×740 and landscape 750×342. The well is
     the largest element: 307 / 211 / 340 / 206 px against a 66 px knob row.
3. **Landscape phones.** Fixed: vessel left, knobs and pads right, no scrolling
   (`@media (max-height:500px) and (orientation:landscape)`).
   - Verified: `v-landscape.png`, scroll 222/222.
4. **The canvas was clamped to at least 200 px tall,** so on short wells the vessel was
   clipped at the base. Fixed: size from the well's own layout box.

### P1
- **"Offer in" landed, then jumped back about 60 px.** At rest, the settled layout
  started from the pre-offer place. Fixed: each moment's last place is where rest begins.
  Verified for every moment, desktop and phone: Δ 0.0 px (offer in, swap, take
  offer→hero, the floor during take, pass).
- **Zoom landing into PERFORM.** `resize()` and `anchor()` read transformed boxes
  mid-zoom. Fixed: `clientWidth`/`clientHeight`, and an offset-chain anchor. Verified:
  taste/patch/evolve → perform lands within 0.3 px on desktop and 0.0 px on the phone.
- **The released sound went to the well's left edge,** not home, and was clipped by the
  canvas. It is now its own object (`flyHome`) that lands on its bank row (desktop centre
  Δ 0,0). On a phone it runs down the left margin, clear of the title (which fades
  earlier), to the bank button, which pulses.
- **The title and blurb popped at commit.** Now: they fade out during the take and in at
  rest; any other change of sound fades the head in.
- **The reflection and floor followed the departing sound.** They now belong to whichever
  sound is centred (the taken offer during a take); no floor jump.
- **Touch key hints on the canvas.** "hold B to peek" becomes "hold Peek" on touch
  (`body.touch` or a coarse pointer).
- **The hood on a phone covered the vessel's base** (the band BODY shapes). It now floats
  at the end of the well the control doesn't shape, then goes after 2.8 s. Identical
  modules collapse into one ("VCO ×2").
- **"How it works" on a phone** squeezed the well. The in-well "?" opens explain's own
  answer (`A.ask` on BRIGHT), with a sheet as a fallback.
- **The keys drawer on a phone hid the pads.** Open keys fold the knob row away and lift
  the pads above the drawer. Verified: `s-phone3.png`.
- **The own-sound card:**
  - Desktop: it covered the vessel. The vessel now moves right to make room
    (`cardW()` + MutationObserver; overlap 0 px).
  - Phone: the card pushed the loop off-screen. It is now an opaque sheet over the
    controls, with a close animation, removed on leaving PERFORM.
  - Phone: "Breed toward it" skipped its animation. The buds now fly to the bank button.
  - `.own-lines` has `pointer-events:none` and is clipped to its web.
- **Offer captions were clipped at the well's edge** ("let go to retur"). Captions are
  now clamped inside the well, with shorter wording on narrow wells.

### P2
- The pads looked live during a moment. Now `.busy`: dimmed and inert.
- A square focus ring showed after a touch. The dial's ring is round, and there is no ring
  after a touch (it returns on a key).
- The phone knob ends ("thin · heavy") drew over the dial. On a phone the value bubble
  replaces them; in landscape they are hidden.
- `setPointerCapture` could throw on synthetic pointers. It is now guarded.
- The hover readout was hidden under the card and the how panel. It now sits at the top
  centre.
- Stage mode's × was 40×40 on touch. It is now 44×44, and the "⇧F" key hint is hidden on
  touch.

## Show the mechanism (P3)

Built:
- **The shape follows the controls.**
  - BRIGHT and BODY stay exact.
  - GRIT, estimated: adds harmonics above ~700 Hz and roughens the edge.
  - SNAP, estimated: swells or softens the earliest layers.

  The live line while playing is the measured truth.
- **A reset springs back** with a visible overshoot, and the knob cell pulses.
- **Peek:** the offer's shape rises in place over the sound you hold (an amber dashed
  outline morphing from the held shape), so you see what would change, where it would
  change.
- **Swap:** the old offer folds back into the sound it grew from as the new one grows.
- **A change of sound** (bank, palette, keys) morphs the old shape into the new. A take
  arrives already in shape.
- **Played notes** light their fundamental and first five harmonics as bands at their
  pitch on the vessel, as in stage mode.
- **The layout settles:** opening the card or how-it-works slides the vessel over rather
  than jumping.

Proposed:
- The own-sound card's nearest faces could morph toward the dropped face on hover,
  showing the difference.
- MOTION could sway only the bands its LFO actually moves (needs the patch's target).
- Peek could also show B's live contour inside the in-place outline.

## For other owners
- **Core (landscape 750×342):** the "Prototype for approval" pill covers Peek and Take,
  and the guide pill overlaps the vessel. They need the short-screen hook (hide or move
  them).
- **`flow2.js` at 400 px:** its "ask" step hovers a knob while the own-sound sheet is up.
  That is by design; the test should close the sheet first.
