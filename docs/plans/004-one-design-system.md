---
title: "One design system, and the views rebuilt to it"
number: 4
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-06
originating_proposal: 4
related_adrs: [4, 9, 11]
---

# Plan-004: One design system, and the views rebuilt to it

## Objective

Implements [RFC-004](../proposals/004-design-direction.md) under
[ADR-011](../decisions/011-one-design-system.md): one source for tokens,
words and marks, a component set, each view rebuilt to an approved specimen
within a checked text budget, a first explanation figure, and the films'
second pass. The sonic floor is RFC-005's. Wave 2's colour looks, channels
and printed key hints are built here; its other contracts stay in
[Plan-003](003-one-instrument-contracts.md).

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| Tokens | The one source and the CSS it generates; the check | `www/brand/tokens.json`, a generator under `www/brand/`, every surface's stylesheet, `make dev-check` |
| Words | The voice guide, the tagline and descriptor, spelling | `www/brand/voice.md`, the six rule sets that point to it, every surface's copy |
| Marks | The brand spec, the icon set, lockups, the social card | `www/brand/`, `www/docs/` theme, `www/landing/` |
| Specimens | Visual drafts for approval: type, grid, motion, components, each view's disclosure map | Pages published for review; approved ones summarised in `www/brand/` |
| Components | One look and behaviour per kind of control and surface | `apps/web/style.css`, `apps/web/*.js`, `apps/web/index.html` |
| Views | PERFORM, PATCH, EVOLVE, TASTE and the shell (bank, header, ? card, warm start) | `apps/web/`, their specs in `tests/web/`, their guide pages |
| Budget | The text-budget spec | `tests/web/`, from `docs/notes/text-2026-09/measure.js` |
| Films | The second pass | `www/video/` |

## Tasks

1. **Tokens** (part 1): `tokens.json` with colour (the docs' light palette
   included), type scale, spacing, radii, and motion durations and easings. A
   generator writes each surface's CSS: app, landing, docs theme, brand page,
   film stage, film kit. Hand copies are removed and the deep-amber drift is
   resolved. `make dev-check` fails on a colour, size or duration outside the
   tokens and on a raw hex in a rule.
   - *Progress (2026-09-30):* **colour and the font families are done.**
     `www/brand/tokens.json` holds the rack and Paper palettes, the families,
     and each surface's own shades and opacities; `make tokens`
     (`www/brand/tokens.py`) writes them into the app, the landing page, the
     docs theme, the brand page, the 404 and the film stage, and the kit and
     films read them with `ink()`. The deep-amber drift is resolved and the
     brand page's lamp is amber. `tokens.py --check` and `test_tokens.py` run
     in `make dev-check` and fail on a colour (hex, `rgb()`, `hsl()` or a
     named one) written outside the tokens in every file on its `SCANNED`
     list ([`www/brand/README.md`](../../www/brand/README.md#the-tokens)).
   - *Progress (2026-10-01):* **the type scale, spacing, radii and motion
     are done**, at prototype v2's approved values (Plan-005 task 1): six
     type roles on a 1.2 ratio with 11 px labels and a 12 px canvas floor,
     `--s1` to `--s7`, `--r1` to `--r3`, three durations and two easings,
     and the reduced-motion rule, generated into every surface. The app's
     stylesheet and scripts are on them, with each literal the scale has no
     step for marked `token-exempt:` and its reason. `tokens.py --check`
     counts literal font sizes, spacings, radii and durations per file
     against `www/brand/sizes-baseline.json`, a ratchet that only goes down,
     and fails when a token is redefined after its block.
   - *Progress (2026-10-06):* **every styled page is checked for colour**
     (#146), and `NOT_YET` in `tokens.py` is empty. The grammar figure fills
     its tiles with `--phos-a-10` and `--phos-b-10`, which on Paper are
     Paper's own green and amber; Paper has a `--bezel`, dark on purpose, for
     a film's ground; `www/brand/render.html` reads the brand page's tokens
     from a generated block. The live figures are held to the tokens, and
     the aliases of them, that every page loading them defines
     (`ON_EVERY`). On the Rack theme nothing renders differently on screen;
     in print, a figure's frame takes each theme's `--silk-mute`.
   - *Progress (2026-10-06):* **every surface is on the scale** (#145): the
     landing page, the docs theme and the live figures, the brand page and
     its raster source, the 404, the film stage and the films. The docs hold
     their prose, lede and headings as sizes of their own, and the films set
     their text on a frame tier, the scale's ratio continued past the page's
     steps (`--t-frame-n`); what has no step says why. The site's pages
     restate in rem the steps their prose and small print use, so their text
     still follows the reader's font size, and a live figure's text holds at
     11 px (`--t-micro`) on every page that loads it. `sizes-baseline.json`
     is empty.
   - *Still to do:* the films' drawing helpers (the kit's `textBlock()`, a
     film's `label()` or `txt()`) take a number for a label's size, which the
     check does not count, so those labels are not yet on the frame tier
     (#291).
2. **Voice guide** (part 2). Written 2026-09-30, as
   [`www/brand/voice.md`](../../www/brand/voice.md) under
   [ADR-013](../decisions/013-one-voice.md). It has a new line, American
   spelling and the spoken voice, and the copy sweep and the check follow.
   The original scope: `www/brand/voice.md` with its audiences, four
   registers, claims and spelling. ADR-004's copy rules, the `AGENTS.md` files,
   the docs-writer agent, the changelog skill and `VIEWS.md` point to it. The
   tagline goes everywhere the other three appear, and the descriptor is
   drafted for approval. Plan-003's banned-words check enforces its word table.
3. **Marks** (part 3): the lamp amber on the brand page; the docs header on
   the tracking ramp; the social card's stacked lockup with the descriptor;
   the spec amended for the docs' light theme. The icon set is extended to
   every action the app shows as a glyph and wired in, and a check fails on
   an emoji-presentation glyph in the UI.
4. **Specimens** (parts 4 and 5), each a visual page the maintainer approves:
   the type scale (a proposed 12 px canvas floor; TA20 found 10 px too small), the grid and density rule, the motion
   tokens, then the component set (primary, secondary, toggle, destructive,
   disclosure; knob, pad, bank row, card, toast, status line, empty state).
   Then each view's disclosure map and layout (what shows at rest, on
   approach, on request), including the shell's first visit, the ? card as a
   map of keys and gestures, and learning one act at a time. Prototype v2 is
   the approved specimen for every view's layout and disclosure, with Draft
   1's five choices as it sets them (2026-09-30; see
   [Plan-005](005-the-sound-at-the-centre.md)).
5. **Components and the budget**: the approved component set built once from
   the tokens. The text-budget spec is built from `measure.js`. For each view
   it fails on more than one sentence of guidance at rest, on an instruction
   shown on two surfaces, on a placeholder row, on a block over 25 words, or
   on a tooltip over eight words (proposed limits; the maintainer can change
   them here). It gates each view as that view is rebuilt.
6. **The views rebuilt**, one at a time, to their approved specimens, as the
   levels of one space (Plan-005). Each is
   built from the components, with Wave 2's colour looks (Plan-003 task 2),
   message channels and one onboarding surface (task 4), and printed key hints
   (from task 5). Each closes its findings:
   - the quality findings: PF-08, EV-04, EV-15, EV-19, PA-15, PA-16, PA-17,
     PA-22, TA15, TA20, CO4, CO8;
   - those Plan-003 handed over with its tasks 2 and 4: CO3, CO10, PA-08, TA6,
     SH8, EV-07, CO9, SH5, PF-05, TA11.
   Task 5's findings (CO11, PF-09, EV-13, EV-09, TA12, PA-12) close in
   Plan-003; the key hints are printed here. The view's guide
   page is checked against it (ADR-004), and its spec passes the text budget.
7. **One explanation figure** (part 8): the first causation candidate, in its
   own small proposal, on the shared graphics grammar: a generation's
   children beside their seeds, in place of the lineage log's sentences (the
   bank's Compare, Plan-005 task 4).
8. **The films' second pass** (part 7, and Plan-003 task 7):
   - `asr_check.py` targets a speaking rate of 176 (what speed 0.81 measured
     in the audition), reports the overall rate, and fails a film faster than
     185 (a proposed limit).
   - Every script moves to speed 0.81.
   - Each chapter opens with a figure.
   - Each film is cast from above the sonic floor, once RFC-005 lands.
   - Then re-voice, re-time, rehearse, record, review and publish. Where
     published films are stored is decided first (see the film runbook).

## Done when

- Every colour, size and duration comes from `tokens.json`, and the check
  runs in `make dev-check`.
- The voice guide is the one set of copy rules.
- The marks match the spec.
- Every view is built from the component set to an approved specimen.
- The text-budget spec passes for every view.
- The findings in task 6 are closed or deferred with a reason.
- One explanation figure has shipped.
- The six view films are published at the new voice and pace.
