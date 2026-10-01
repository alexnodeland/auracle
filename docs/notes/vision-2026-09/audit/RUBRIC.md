# Prototype v2 audit: rubric (read this first)

Prototype: `../prototype` (in a scratch copy). Build with `python3 build.py`, which writes
`preview.html` (a full document) and `auracle-vision.html` (the artifact).
Test tools in `prototype/`: `check.js` (one screenshot, optional page script),
`frames.js` (slowed transition frames), `flow2.js` (end-to-end run). Playwright lives
in `tests/web/node_modules/playwright`,
and `require('…/playwright').devices['iPhone 13']` gives real phone emulation with touch.

Test on three viewports, every time:
- **Desktop:** 1440×900.
- **Phone:** iPhone 13 (390×844, `hasTouch`, `isMobile`).
- **Small phone:** 360×740 with `hasTouch`.

Use real input: `page.mouse`, `page.keyboard`, `page.touchscreen.tap`. For swipes and
pinches, dispatch touch pointer events. `A.slow = N` slows every view transition and
PERFORM's offer moments, so frames can be caught.

## What to find (rank each finding)

- **P0 broken:** an interaction fails, throws, or strands the user (focus lost, overlay
  stuck, a view blank, a key swallowed).
- **P1 wrong:** an animation that doesn't line up. A travelling object must start exactly
  where its source is drawn and land exactly where its destination is drawn. Measure the
  jump in px between the last moving frame and the first resting frame. Anything over
  2 px is a finding.
  - Also P1: motion that contradicts meaning (wrong direction, wrong colour role),
    timing outside the motion tokens (90/180/320 ms; view moves about 620 ms), a state
    change with no feedback, hover-only information unreachable by touch, and on a phone
    a primary action below the fold or scrolling more than needed.
- **P2 polish:** overlap, clipping, truncation, misalignment to the 4 px grid,
  inconsistent spacing or type, contrast, focus rings, touch targets under 44 px, labels
  under 12 px.
- **P3 opportunity:** a place where meaning could be encoded as motion or shape instead
  of words, in the spirit of the maintainer's principle, "show the mechanism".
  Examples: the offer growing from its parent; children budding; a note lighting its pitch.

## The phone

For each view, measure:
- the scroll height against the viewport;
- how many screens it takes to reach the primary action;
- whether the sound, its main controls and the primary action fit in the first screen;
- thumb reach (primary actions in the lower half);
- any gesture with no visible affordance.

The target: no scrolling for the core loop (play, turn, offer, pick) on a 390×844 phone.

## Rules

- Own only the files your brief names. Don't edit others; report cross-file issues.
- Other auditors build at the same time. If an error comes from a file you don't own,
  rebuild and retry.
- Keep evidence. Put screenshots and frame strips in a scratch folder per area (not kept here).
- The house style: precision instrument; two phosphors (green = sound, amber = model,
  red = danger, silk = you); no third colour; canvas labels ≥ 12 px; text budget (one
  sentence of guidance at rest); dashed amber = a guess; reduced motion honoured.
- Deliver `audit/<area>.md`:
  - findings, ranked, each with evidence, the fix made (or why not), and verification;
  - then the P3 opportunities you built and the ones you only propose.

  Reply with a 10-line summary.
