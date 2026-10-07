---
title: "Every interaction answers at once, on the reference machine"
number: 25
status: accepted
author: Claude Code
created: 2026-10-06
originating_proposal: null
superseded_by: null
---

# ADR-025: Every interaction answers at once, on the reference machine

## Status

Accepted by the maintainer on 2026-10-06, in the operator's session (#297):
"we should hold the latency standard to a very high degree, expecting near
instantaneous or instantaneous interaction", and "not only input and perform,
but across the whole app. All should be as instantaneous as possible." That
holds on an older Intel MacBook Air in Firefox as well as an M-series MacBook
Pro. It amends one ADR and applies another:

- [ADR-022](022-a-slow-runner-makes-a-test-slower-never-wrong.md), amended:
  where speed budgets are judged. Its three kinds of timing assertion stand.
- [ADR-012](012-motion-shows-what-the-engine-does.md), applied, not amended: a
  predicted or borrowed value is a guess until it is measured.

#297 numbers its decisions D1 to D14, and this ADR cites them where they bear
on it. The maintainer's are D1, D3, D4, D8, D9, D12 and D14. The operator's
(D2, D5, D6, D7, D10, D11 and D13) were taken under the standard and stand
until the maintainer changes them; each is marked as the operator's where it
is cited.

This is a standard the app does not yet meet. #297's issues make it true, one
at a time (Consequences).

## Context

On 2026-10-06 the maintainer reported what the instrument does on an Intel
MacBook Air in Firefox and on an M-series MacBook Pro. A restore took over two
minutes (#285). Faces never drew (#287). Playing crackled (#288). PERFORM's
controls took seconds to answer, on both machines (#290).

Each was a response that waited on the engine: a render, a measurement, a fit,
or a round trip behind one. A phrase render is about 240 ms in wasm on an M3
Max and about 1 to 1.2 s on the Air (a figure #299 confirms by measuring), and
a gesture that waits on one is as slow as the machine under it. The speed
budgets (ADR-022) recorded some of this and had no standard to be read
against: each limit was a number chosen for one spec, and they are judged at
`AURACLE_CPU_THROTTLE=1` on a hosted runner, at whatever speed it runs, with
the farm at the runner's width and never slowed.

So a read-only audit walked every interaction in PERFORM, EVOLVE, PATCH,
TASTE and the shell, 162 of them, and found where a visible or audible
response waits on the engine. #297 holds the plan it produced: an issue for
each place, its instant path, and a budget for it. The maintainer's standard
above is what those issues are written to.

## Decision

1. **The reference machine** is a 2018 or 2019 MacBook Air: an Intel 1.6 GHz
   dual-core i5 (2 cores, 4 threads), in Firefox. `farmWidth` gives it 2
   renderers. Budgets are judged on the reference profile in both Chromium and
   Firefox (D10, the operator's). A device with fewer threads, and so no farm
   renderers, keeps the same rules: its precompute runs on the engine thread in
   idle `later`, which yields to the player's work.
2. **Three targets.**
   - **Direct manipulation** (a knob or slider drag, the XY pad, a key, a MIDI
     note or CC, Peek, Blend) is heard at the next audio quantum after the
     event and seen in the next frame. Nothing between the event and the
     voices waits on the engine worker. The target includes the audio thread:
     its work per quantum stays under half a quantum on the reference machine.
     #288 and #298 make that true, and #299 judges it nightly with the gate of
     `live_cost.mjs` (#288; not yet on `main`).
   - **Every other input shows what it asked for within 100 ms:** the sound
     playing, the controls live, the rack drawn, the pair dealt, the offer in
     B. 100 ms is the default. Each interaction's own limit is a row of #297's
     budget table, and two are longer by decision: the boot veil is down
     within 1 s on a return and 2 s on a first visit, with the keys sounding
     when it drops (D9, the maintainer's); the first Offer after a sound is
     taken in is handed over within 100 ms from 3 s after, with B showing its
     growth count until then (D5, the operator's; #302). Work the player
     asked to take time is decision 3's.
   - **A background result never moves what is under the hand.** A background
     result is one the player did not ask for at that moment: a measurement or
     a face landing, a refit's posterior, a spare offer. One rule serves the
     whole app (D8, the maintainer's):
     - a control is held while it is held, and for 1.5 s after it is
       released: a result waits, and applies when that time is up;
     - a region (the bank, the map, the rack, LEARNING's bars) is held while
       the pointer is over it: a result waits, and applies on pointer-leave or
       after 1 s of rest.
3. **The answer is the thing, not a sign.** A pending state ("opening…", a
   dimmed ▶) counts only where the player asked for work that takes time: a
   generation, ⚡, a recording, a clip capture. Elsewhere a pending state is an
   interim step, with an issue open for the answer.
4. **How an answer comes before the work.** From any of these, none preferred
   to another:
   - precomputed in idle time, on the farm or on the engine thread in idle
     `later`, which yields to the player's work. A precompute is dropped when
     what it was for is gone: an edit replaces the sound, a row leaves view;
   - cached or shipped: the presets' wirings, and as #297's issues land their
     makeup, rack descriptions and faces, which `make perform-wirings` writes
     under one fingerprint (D13, the operator's);
   - borrowed from a relative the engine has measured: the parent of a bred
     child, the source of an edit or a taken offer (D1, the maintainer's);
   - predicted from the tree, from a shipped table of each module kind's knobs
     and their effects on φ (D1).

   The measurement then refines it in the background, through a rebase that
   moves nothing under the hand. A borrowed or predicted value is a guess
   under ADR-012 (D2, the operator's) and is marked as one, in words and in a
   mark that cannot be read as another state's, until its measurement lands.
   Marking it never delays it.
5. **The engine thread stays free.** No call on the engine worker may hold a
   gesture longer than one render: long work (a fit, a measurement, a walk, an
   insert batch) runs on the farm or in pieces that breathe. A `now` request
   waits for at most the one call in progress. That is the worst case behind
   one call, not an interaction's limit, which is decision 2's. The issues
   that move work to the farm (#300's refit, #302's walks) shrink it.
6. **Measured, not assumed.**
   - Each interaction that matters has an `app.budget`, measured on the
     reference profile: the wasm slowed in the engine worker and in every farm
     worker until a phrase render takes about what it takes on the reference
     machine, `?farm=2`, and, in Chromium, the page throttled (Firefox has no
     throttle for a page). #299 builds it, and sets the slowdown on each runner
     from a calibration render at the job's start.
   - From #299, the nightly *Speed budgets* job judges them in Chromium, and a
     nightly Firefox run does the same with the engine and the farm slowed
     (D10, the operator's).
   - Budgets stay budgets: they are judged where budgets are judged, never as
     gate assertions (ADR-022). What "under the hand" forbids is asserted in
     the gate, as a state or an order.
7. **In review,** a change that adds, between a gesture and its answer, a wait
   on a render, a measurement, a fit, or a round trip behind one is a finding.
   A round trip with none of those behind it is allowed (#307 draws the rack
   one round trip after an edit, and #309 relies on the same). A new
   interaction lands with its budget.

## Amends

- **ADR-022:** where budgets are judged. They are judged today at
  `AURACLE_CPU_THROTTLE=1` on the hosted runner, which ADR-022 kept at 1 so a
  throttle would not replace a spec's own slowed engine worker (#166). That
  reason no longer holds: the fixture serves a spec's `workerPrefix` after its
  own slowed engine. #299 changes the job, to the reference profile, with the
  farm slowed as well as the engine. ADR-022's three kinds of timing
  assertion, and "a slow runner may make a test slower, never wrong", stand.

It also applies ADR-012 and changes nothing in it. A borrowed or predicted
wiring, and the filter curve #314 draws before the lesson's render, are drawn
as guesses, with words that say so, until the engine's measurement replaces
them.

## Consequences

- **The standard comes before the profile that holds it.** Until #299 lands
  there is no reference profile, and no spec or job measures one. What can be
  done by hand is to run a spec under `AURACLE_CPU_THROTTLE=4`, which slows the
  engine's wasm and throttles the page (Chromium only), with
  `query: "?farm=2"` in its `app.boot` for two renderers. The farm's workers
  stay at full speed, so work moved onto the farm looks free there, and
  `slowEngine: 4` adds nothing, since `app.boot` takes the larger of it and the
  throttle. The nightly job judges at `AURACLE_CPU_THROTTLE=1` today, and
  ADR-022's account of where budgets are judged is true until #299 changes it.
- **#297's issues make the standard true, one budget at a time.** #299 lands
  first, because every other budget is measured on its profile. Each limit is
  a row of #297's budget table, 100 ms by default, and moves in the issue that
  makes it true (a click to its controls live, from 1,000 ms to 100 ms), never
  ahead of it: a limit the app cannot yet meet keeps the nightly's issue (#221)
  open, which is noise and not a standard. A limit that is not a latency (the
  re-center glide, a recording's length) stays as it is.
- **The render itself is #298.** The plan answers from what is precomputed,
  cached, shipped, borrowed or predicted. The maintainer: "These solutions are
  okay for now, but they don't get at the core of the problem." #298 profiles
  the render path and makes the engine faster. It runs beside the shell work
  and holds none of it.
- **A borrowed or predicted answer is not yet drawn as a guess.** A borrowed
  wiring exists today: a Take plays on `carryWiring`, and it is not marked as
  a guess. Marking a borrowed or predicted wiring is #290's work, in a mark
  that cannot be read as PERFORM's dashed amber, which already means a control
  this patch's knobs can't reach (D2). ADR-012 names dashed amber as the
  convention for a guess, and that use in PERFORM is why #290 does not take
  it. The guess is shown at once, never held for its mark.
- **A background result waits for the hand.** The hold rule (decision 2) is
  applied by #304 for a measurement landing on a control, #312 for the bank,
  EVOLVE's table and the bench, and #315 for TASTE and LEARNING. The gate
  asserts it as a state or an order, as ADR-022 asks.
- `AGENTS.md` carries the standard as rule 10. `docs/process.md` § Review and
  `.claude/agents/reviewer.md` say the review finding. `apps/web/AGENTS.md`
  points to the hold rule beside its ADR-012 bullet, and `tests/web/AGENTS.md`
  (where budgets are written) says the profile.
