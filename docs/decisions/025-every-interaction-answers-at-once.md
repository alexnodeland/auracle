---
title: "Every interaction answers at once, on the slowest machine we support"
number: 25
status: accepted
author: Claude Code
created: 2026-10-06
originating_proposal: null
superseded_by: null
---

# ADR-025: Every interaction answers at once, on the slowest machine we support

## Status

Accepted by the maintainer on 2026-10-06 (#297): "we should hold the latency
standard to a very high degree, expecting near instantaneous or
instantaneous interaction", and "not only input and perform, but across the
whole app. All should be as instantaneous as possible." It amends two ADRs
where this one applies to them (Amends, below):

- [ADR-022](022-a-slow-runner-makes-a-test-slower-never-wrong.md), on where
  speed budgets are judged. Its three kinds of timing assertion stand.
- [ADR-012](012-motion-shows-what-the-engine-does.md), on a predicted value:
  it is drawn as a guess until it is measured.

This is a standard the app does not yet meet. #297's issues make it true, one
at a time (Consequences).

## Context

On 2026-10-06 the maintainer reported what the instrument does on an Intel
MacBook Air in Firefox and on an M-series MacBook Pro. A restore took over two
minutes (#285). Faces never drew (#287). Playing crackled (#288). PERFORM's
controls took seconds to answer, on both machines (#290).

Each was a response that waited on the engine: a render, a measurement, a fit,
or a round trip behind one. A phrase render is about 240 ms in wasm on an M3
Max and 1 to 1.2 s on the Air, and a gesture that waits on one is as slow as
the machine under it. The speed budgets (ADR-022) recorded some of this and
had no standard to be read against: each limit was a number someone had
chosen for one spec, judged at `AURACLE_CPU_THROTTLE=1` on a hosted runner,
not on a machine like the Air.

So a read-only audit walked every interaction in PERFORM, EVOLVE, PATCH,
TASTE and the shell, 162 of them, and found where a visible or audible
response waits on the engine. #297 holds the plan it produced: an issue for
each place, its instant path, and a budget for it. The maintainer's standard
above is what those issues are written to.

## Decision

1. **The reference machine** is an Intel MacBook Air in Firefox: 4 threads, so
   `farmWidth` gives 2 renderers, and a CPU 4 to 5 times slower than an
   M-series one. What holds on the Air holds on the maintainer's M-series
   laptop too.
2. **Three targets.**
   - **Direct manipulation** (a knob or slider drag, the XY pad, a key, a MIDI
     note or CC, Peek, Blend) is heard at the next audio quantum after the
     event and seen in the next frame. Nothing between the event and the
     voices waits on the engine worker.
   - **Every other input shows what it asked for within 100 ms:** the sound
     playing, the controls live, the rack drawn, the pair dealt, the offer in
     B.
   - **A background result never moves what is under the hand.** It waits
     while a control is held, or was touched in the last 1.5 s, or while the
     pointer is over the region it would move (the bank, the map, the rack,
     LEARNING's bars). It applies on pointer-leave or after 1 s of rest, with
     motion that shows it ([ADR-012](012-motion-shows-what-the-engine-does.md)).
3. **The answer is the thing, not a sign.** A pending state ("opening…", a
   dimmed ▶) counts only where the player asked for work that takes time: a
   generation, ⚡, a recording, a clip capture. Elsewhere a pending state is an
   interim step, with an issue open for the answer.
4. **How an answer comes before the work.** In this order of preference:
   - precomputed in idle time (on the farm, never on the engine thread,
     cancelled by the player's next gesture);
   - cached or shipped (the presets' wirings, and as #297's issues land their
     makeup, rack descriptions and faces, which `make perform-wirings` writes
     under one fingerprint);
   - predicted from the tree.

   The measurement then refines it in the background, through a rebase that
   moves nothing under the hand. A value the engine predicted but has not
   measured is a guess under ADR-012 and is marked as one until its
   measurement lands. Marking it never delays it.
5. **The engine thread stays free.** No call on the engine worker may hold a
   gesture longer than one render: long work (a fit, a measurement, a walk, an
   insert batch) runs on the farm or in pieces that breathe. A `now` request
   waits for at most the one call in progress.
6. **Measured, not assumed.**
   - Each interaction that matters has an `app.budget`, measured on the slow
     profile: the wasm slowed 4 times in the engine worker and in every farm
     worker, `?farm=2`, and the page throttled 4 times in Chromium. #299 builds
     it (Consequences).
   - From #299, the nightly *Speed budgets* job judges them there, and a
     Firefox run does the same with the engine and the farm slowed.
   - Budgets stay budgets: they are judged where budgets are judged, never as
     gate assertions (ADR-022). What "under the hand" forbids is asserted in
     the gate, as a state or an order.
7. **In review,** a change that adds a wait on a render, a measurement, a fit
   or a round trip between a gesture and its answer is a finding. A new
   interaction lands with its budget.

## Amends

- **ADR-022:** where budgets are judged. They were judged at
  `AURACLE_CPU_THROTTLE=1` on the hosted runner. They are judged on the slow
  profile from #299, and the profile slows the farm as well as the engine.
  ADR-022's three kinds of timing assertion, and "a slow runner may make a test
  slower, never wrong", stand.
- **ADR-012:** applies to predictions. A predicted wiring, an analytic filter
  curve or a forecast drawn before its measurement is drawn as a guess, with
  words that say so, until the engine's measurement replaces it.

## Consequences

- **The standard comes before the profile that holds it.** Until #299 lands
  there is no slow profile. What is measured today is a run of one spec with
  `app.boot({ slowEngine: 4, query: "?farm=2" })` under
  `AURACLE_CPU_THROTTLE=4`: that slows the engine's wasm and the page, and
  leaves the farm's workers at full speed. The page's throttle is a Chromium
  one, so a Firefox run is #299's too. The nightly job still judges at
  `AURACLE_CPU_THROTTLE=1` until #299 changes it, and ADR-022's account of
  where budgets are judged is true until then.
- **#297's issues make the standard true, one budget at a time.** #299 lands
  first, because every other budget is measured on its profile. Each limit
  that moves (a click to its controls live, from 1,000 ms to 100 ms) is
  lowered in the issue that makes it true, never ahead of it: a limit the
  app cannot yet meet keeps the nightly's issue (#221) open, which is noise
  and not a standard. A limit that is not a latency (the re-center glide, a recording's
  length) stays as it is.
- **The render itself is #298.** The plan answers from what is precomputed,
  cached, shipped or predicted. The maintainer: "These solutions are okay for
  now, but they don't get at the core of the problem." #298 profiles the render
  path and makes the engine faster. It runs beside the shell work and holds
  none of it.
- **A predicted answer is drawn as one.** A wiring borrowed from a relative or
  predicted from a table is a guess until the measurement lands, and is
  marked so (the reach arcs dashed amber). The guess is shown at once, never
  held for its mark.
- **A background result waits for the hand.** One hold rule serves the whole
  app (decision 2). A result that lands is applied by the same rule everywhere
  a control, a row or a bar could move under the pointer, and the gate asserts
  it as a state or an order, as ADR-022 asks.
- `AGENTS.md` carries the standard as rule 10. `docs/process.md` § Review and
  `tests/web/AGENTS.md` (where budgets are written) say the review finding and
  the profile.
