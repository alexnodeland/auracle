# The instrument's shape: one loop, four surfaces

A working spec for the layout pass that adds PERFORM and reorders what is
already there. It exists so that the redesign stays one decision rather than
forty local ones. Screenshots behind every claim were taken headless from the
app at 1440×900 (see the playthrough video and the audit captures that went
with this change).

## The loop

Auracle is one loop said four ways, and the four views are its verbs, in the
order a musician meets them:

| View | Verb | The question it answers | Math it rests on |
|---|---|---|---|
| **PERFORM** | play it | *what can this sound do under my hands?* | ∂φ/∂knob (named controls), the locked MH walk (Wander) |
| **PATCH** | shape it | *what is this sound made of?* | the typed PCFG, trace addresses, locks |
| **EVOLVE** | choose | *which of these is closer?* | Bradley–Terry duels, the Boltzmann target |
| **TASTE** | understand | *what has it learned about me?* | the max-of-experts posterior, calibration |

PERFORM is the default view. Everything else is one level deeper, and each
view discloses its own mathematics only on request.

## Three levels, everywhere

Every view is built from the same three levels, and nothing at level 3 may
occupy space at rest.

1. **The sound.** The patch's name, its play button, the thing you touch (knobs,
   rack, cards, map). Largest, first, always visible.
2. **What you do to it.** The verbs of that view, grouped by concern and
   weighted by frequency: one primary action per view, amber, rightmost.
3. **Why, and how it works.** Explanations, model internals, catalogue,
   settings. Behind a disclosure (`?`, `▾`, hover, a collapsed rail), never a
   permanent row of instructions.

## Rules the audit produced

- **One teaching surface per view.** PATCH had four (the "6 quick picks" pill,
  the model's-guess line, the TEACH strip, the coach card). Keep the slim TEACH
  strip; fold the guess into the patch header as a small badge; the pill and
  coach card go once dismissed or once the first pick is made.
- **No placeholder rows.** A strip whose resting content is an instruction
  ("point at a module…", "anything you unplug is held here…") is level 3 and
  appears only when it has content. The info strip becomes a floating card on
  hover; HELD appears when something is held.
- **Nothing overlays the thing you touch.** The scope occupied the rack
  frame's lower-right quarter permanently, which is why an eight-module patch
  rendered at a third of its natural size. What shipped: it defaults to its
  small size (still in the frame, resizable). Moving it into the header is the
  intended end state and not yet done.
- **Settings follow their switch.** The arpeggiator's six controls show when ARP
  is on; unison's when UNI is on.
- **Toolbars are grouped by concern.** PATCH's ten equal-weight buttons become:
  edit state (appears only when edited: *compare · keep · revert*), view (one
  `view ▾` menu: detail, belief, map), locks (shown on hover of the rack, with a
  count when any are set), and the primary *⚡ evolve from this*.
- **Performance never blocks.** Nothing reachable from PERFORM opens a modal.
  The edit-comparison ritual that interrupts *evolve from this* in PATCH is
  offered in PERFORM as a non-blocking chip (Keep / Back), because a player in
  the middle of a phrase cannot answer a dialog.
- **The math is one click from anything it explains.** A named control's `?`
  shows the knobs it moves and the measured purity; Wander's shows the walk's
  temperature and locks; a duel's shows the forecast. Never at rest.

## PERFORM, concretely

- Header: patch name, play, save; a compact scope; the Wander dial.
- Body: eight named controls in a row — **Bright, Snap, Motion, Body, Grit,
  Space, Blend, Wander** — each bipolar around where the sound is now, each with
  a thin outer ring showing where the sound *measures* on that axis.
  Long-press plays a two-second sweep of it.
- Pads: **Keep · Back · Offer · Take · Peek · Hold**.
- Below: the keybed, shared with every view.
- A named control that the patch cannot reach by knobs (measured: Grit and
  Space on most presets) is drawn as a *search* control in amber, and turning it
  asks evolution for an offer rather than moving knobs.
