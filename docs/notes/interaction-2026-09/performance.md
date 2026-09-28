# Responsiveness and performance: the response-time picture (RT)

Area: every gesture's time to acknowledgement, first result and completion, across PERFORM,
PATCH, EVOLVE and TASTE. The evidence is the rehearsal sidecars (`www/video/out/*/dry/*.json`,
their `late`, `logs` and `stamps`, and the run summaries in `out/*/dry.log`), the cut clips in
`www/video/films/*/shots.json`, stills, two frames from `view-perform.mp4`, and the code. I did
not run the app.

## 1. Summary

1. **The instrument answers the hand at once, but the engine does not.** Notes, knob turns
   (PATCH, PERFORM, XY), votes, duel ▶ and ⌘Z respond in 0–400 ms. Anything that needs a
   render walk or a measurement takes 4 s to 3 min.
2. **The worst offender is structural.** One engine thread runs uninterruptible wasm, and six
   long calls are not chunked: a generation's seeds, ⚡, offers, drifts, fits and the restore fit.
   A generation also holds the floor for 100–193 s. While it does, every PERFORM measurement,
   pressed Offer, spare and drift waits, and a vote's next pair can wait a whole seed (about
   19 s on average). The guide says "the rest of the instrument stays playable".
3. **PERFORM's first measurement (about 11 s, 16 s under load) is the most-met wait.** Every new
   patch shows six controls reading "measuring…". A newcomer lands on it straight after the
   warm start: it still read "measuring" 8.8 s after "teach it". The render farm that could cut
   it to about 3 s is shut down after boot.
4. **Waits are marked but not managed.** There is a lamp, a dim "BREEDING 1/10…" label and a
   static "growing an offer…". Nothing gives an ETA or lets you cancel, EVOLVE POOL's children
   appear only at the end, and a queued gesture never says what it is waiting behind. The
   worker's `busy`/`idle` messages reach main.js and are never shown.
5. **Strengths to keep:** sound-first edits (`live.param`), the ordered bench lane, the
   now/soon/later lanes with chunked measurement, stale-while-revalidate wirings, spare offers
   (0.15 s), carried wiring on Take, the vote deal ahead of the fit (17 ms), prefetched duel
   renders (30–40 ms to sound), and "opening X…" everywhere a patch is on its way.

## 2. Measured response times (the evidence table)

"Load?" marks numbers the brief warns may be inflated by a loaded machine. Engine-bound times
(anything that renders) varied 1.5–1.9× between runs of the same shot. For example, EVOLVE POOL
took 103 s in the 00:43 run of `ve-rhythm` and 165 s in the 01:52 run. `dry.log` shows a build
overlapping the 00:32 queue. UI-bound times (deal, duel ▶, bank open) did not vary.

| # | Gesture → event | Measured | Source | Load? |
|---|---|---|---|---|
| 1 | Boot → playable (veil down) / → pool filled | **not measured anywhere.** The film set-ups wait on `pool ≥ 40` without a stamp | every `shots.json` `setup` | — |
| 2 | Warm-start card ▶ → `.wi-play.playing` | 0.83 s | `tour/dry/to-first.json`, `until .wi-play.playing` took 0.83 | no |
| 3 | "teach it" → PERFORM shown | 0.31 s (6.52 → `taught` 6.83); 3.4 s on 09-27 (`composing/co-direction`) | to-first stamps | 09-27 run older build |
| 4 | "teach it" → toast "18 preferences learned…" | 2.6 s (→ `learned` 9.11); 1.5 s in the 00:20 run | to-first stamps, `tour/dry.log` | mild |
| 5 | "teach it" → landed pick's controls working | **> 8.8 s**: at 15.32 the status still read "Acid Line · measuring how this patch moves…" | to-first log `perform` | no |
| 6 | Bank row click → rack swapped (`rack-subject` changed) | 0.34 s (15.44 → `opened` 15.78) | `tour/dry/to-bank.json` | no |
| 7 | Preset click → bench, before "the player first" | 10.7 s | ui-audit `verify-preset-landed` | yes, pre-fix |
| 8 | TASTE map dot press → it plays (`live-label`) | 0.32 s / 1.13 s / 0.38 s | `view-taste/dry/vt-hear.json` (press end → `yes`/`maybe`/`dim`) | no |
| 9 | TASTE keyboard walk ⏎ → plays | ≈1.1 s (log `to-t2` 12.34 → `t2` 13.47) | `vt-together.json` | no |
| 10 | Preset clicked while in PERFORM → "measuring…" shown | 0.83 s (23.73 → `measuring` 24.56) | `view-perform/dry/vp-named.json` | no |
| 11 | … → controls wired ("controls reach") | **11.8 s** (→ `wired` 35.49); **16.3 s** in the 00:20 run | vp-named, `view-perform/dry.log` | 16.3 s yes |
| 12 | PATCH knob → sound | immediate: `live.param` before the engine, about 25 ms one-pole smoothing | `main.js:6089-6100`, `crates/auracle-wasm/src/live.rs:16-18` | — |
| 13 | PATCH knob released → model's-guess line settled ("re-measuring…" gone) | 0.71 s (path ends 8.20 → `ready2` 8.91); 1.7 s in the 00:21 run | `view-patch/dry/vp-change.json`, dry.log | 00:21 yes |
| 14 | Same, before the bench-lane fix | 5.3 s, and the knob snapped back (13 kHz → 1.78 kHz) | `vp-probe2.json` (00:46) | pre-fix |
| 15 | Insert: jack click → module drawn on the rack | 0.46 s (delay), ≈0.7 s (slew), ≈1.0 s (distortion) | `vp-add` `placed`, `vp-move` `wrapped`, `vp-together` `grit` | no |
| 16 | Bypass (menu) → rack redrawn → guess settled | ≈1.0 s → +0.94 s (`bypassed` 10.92, `ready3` 11.86) | vp-change | no |
| 17 | Unplug drag released → HELD tray → rack and guess | 0.35 s → 1.4 s | vp-change `pulled` 15.75, `ready4` 16.84 | no |
| 18 | ⌘Z → restored | 0.29 s (21.40 → `undone` 21.69) | vp-change | no |
| 19 | COMMIT → comparison dialog | 0.35 s | `vp-keep` `duel` | no |
| 20 | Drop an SVG → patch opened | 2.1 s after the drop gesture (10.51 → `opened` 12.62) | `vp-take` | no |
| 21 | Node-bank hover → "hear it here" playing | ≈0.7 s | `vp-add` log `pv` | no |
| 22 | **⚡ evolve from this → child on the bench** | **22.9 s** (10.63 → `benched` 33.48); 23.4 s (00:21); 74.2 s (09-27, `sounddesign/sd-evolve`) | `view-patch/dry/vp-lock.json`, dry.log | 74 s older build |
| 23 | **EVOLVE POOL → button back** | **191 s** (`ve-breed`), **165 s** (`ve-rhythm`), 157 s / 103 s (00:43 run), 193 s (00:05 run), 111 s (09-27 `co-evolve`), 173 s (ui-audit). About 100 s natively (RFC-001) | `view-evolve/dry/*.json`, dry.log | yes (1.6–1.9×) |
| 24 | Vote → next pair dealt | < 0.41 s every time ("deal ms" 410–434 **including a fixed 400 ms wait**); 17 ms by the code's own measure | `ve-duel`/`ve-breed` logs, `main.js:5086-5092` | no |
| 25 | Duel ▶ → sounding | 0.03–0.04 s | `ve-play` `until … took 0.03/0.04` | no |
| 26 | Sixth pick → refit done (lamp off) | 0.61–0.89 s at 6 picks; 2.1–2.4 s at 58 picks; about 4 s for a mature fit in the browser | `vt-open` `learned→lit`, `vt-wrong` `learned→fitted` (4 runs), `engine.rs:459` | slight |
| 27 | Offer pressed, spare waiting | ≤ 0.2 s (`until .pf-offer.ready` took 0.01); CHANGELOG 0.15 s | `vp-offer` `ready`, `vp-together` `ready` | no |
| 28 | **Offer pressed again after a pass (no spare)** | **10.9 s** (21.1 → `next` 31.97); 12.3 s in the 00:20 run | vp-offer, dry.log | 12.3 s yes |
| 29 | Search control (Grit) turned → offer in B | 4.3 s after release (≈19.9 → `offered` 24.26), a pre-fit grammar walk | `vp-honest` | no |
| 30 | Wander into the offer zone → offer in B | 4.5 s after the drag, 3.5 s of it the hands-off pause | `vp-wander` `offered` (3 runs: 11.26–12.26) | no |
| 31 | **Wander into drift → first glide** | **20.5–22.2 s** (12.75 → `drift` 33.2–34.9) | vp-wander, 3 runs | no (design cadence) |
| 32 | Take → toast; controls | toast ≤ 0.8 s; controls kept (carried wiring); "re-checking" still showing 3.6 s later; its end is not stamped | `vp-together` logs 15.60 / 18.41; `vp-offer` 37.26 | — |
| 33 | Roam → status | "measuring how this patch moves…" for ≥ 9.6 s (39.36 → 48.95) while the dials work | `vp-wander` logs, `vp-wander-01-paused.jpg` | no |
| 34 | Toasts after their cause | "Took B…" ≤ 0.8 s; "Passed on B…" immediate; "unplugged — …held below" 1.4 s (arrives with the bench reply); "18 preferences learned" 2.6 s; ⚡'s "…it's on the bench, play it" with the child's bench reply; "Gen 1: 10 new patches…" when the generation ends; "saved 3.1s take" immediate | as above | — |

### Waits the films cut because they were too long to watch

Each `clips` entry marks a place where the app made the camera wait:

| Film / shot | Cut over | Wait |
|---|---|---|
| view-evolve `ve-breed`, `ve-rhythm` | EVOLVE POOL | 165–191 s |
| view-patch `vp-lock` | ⚡ evolve from this | 22.9 s |
| view-perform `vp-wander` (2 cuts) | Wander's offer; the first drift | 4.5 s; 21.6 s |
| view-perform `vp-named` | a patch's measurement | 10.9 s |
| view-perform `vp-offer` | a second Offer | 10.9 s |
| view-perform `vp-honest` | a search-control offer | 4.3 s |
| view-patch `vp-change` (3 cuts) | the model's guess after a knob, a bypass and an unplug | 0.7 / 0.9 / 1.1 s |
| view-patch `vp-take` | the SVG import | 2.1 s |
| view-taste `vt-wrong` | a refit | 2.1 s |
| tour `to-first` | warm start → "learned" | 2.3 s |
| tour `to-bank`, view-evolve `ve-point`, view-taste `vt-open` | a bank open; "teach it"; a refit | ≤ 0.6 s (the cut barely moves, because "a cut never goes back") |

## 3. Where the time goes (architecture trace)

```
main thread ── postMessage ──► engine worker (one wasm Engine, uninterruptible calls)
  │ sound-first knob writes          lanes: now │ soon │ later   (worker.js:920-940)
  │ bench lane (ordered)             floor: one long job at a time (worker.js:943-966)
  │ busy/idle flags (never shown)    breathe(): answer `now` between pieces (worker.js:983-987)
  └► AudioWorklet (LivePoly, 4 voices; swap = ~6 ms fade + 1 voice/quantum ≈ 23 ms silent)
     farm workers: spawned for boot, then shut down (worker.js:1280 farmShutdown)
```

**What is chunked, and what is not.** A request can only be answered between two engine calls.

| Engine call (worker.js) | One uninterruptible piece | Lane | Holds the floor? |
|---|---|---|---|
| Boot fill (`fill_step(2)` / farm absorb) | 2 renders (about 1 s) | boot | — |
| `perform_wire` → `measure()` (:808-840) | **1 render (about 0.3–0.5 s)**, resumes from the memo | soon / later | yes, for the whole measurement (10–16 s) |
| `refine` → `breed()` (:842-878) | **one seed's whole walk**: 5–21 s natively, about 16–19 s on average in the browser (165–191 s / 10) | soon | **yes, for the whole generation (100–193 s)** |
| `refine_from` (⚡) (:1571-1590) | **the whole walk, about 23 s**; the step budget is scaled up to 4× by locks (`engine.rs:2302-2323`, `LOCK_SCALE_CAP`) | soon | no, but it blocks the thread outright |
| `perform_offer` (:1618-1621) | **whole walk, 20 steps (40 in roam): 4–11 s** | soon / later | no, blocks outright |
| `perform_drift` (:1602-1605) | whole walk, 8–40 steps | later | no, blocks outright |
| `fit` (:1446-1454) | whole MCMC: 0.6 s → about 4 s mature | later | no, blocks outright |
| Restore fit at boot (:1286-1300) | whole MCMC | — | — |
| `edit_*` → `postBench` (:710-733) | one phrase render (0.3–0.5 s) plus describe and utility | now | — |

**Root causes of the worst times:**

- **RC1 (the floor).** `pump()` starts no `soon`/`later` work while `floor` is set (`worker.js:958-966`),
  and `breed` holds it for the whole generation (`:1466`, `holdFloor(m, breed)`). For 2–3 minutes
  this parks all of the following:
  - a PERFORM measurement of any newly opened patch (soon);
  - a pressed Offer (soon);
  - spares, Wander's offers and drifts;
  - refits and re-measurements (later).
  Only `now` requests get through, and only between seeds.
- **RC2 (uninterruptible walks and fits).** Six calls run seconds to minutes as one wasm call.
  A `now` gesture that arrives meanwhile (▶, vote deal, bench open, structural edit, the bench
  re-render after a knob) waits for the rest of the call. The code knows this: main.js keeps
  `engineBusy` from `busy`/`idle` (`main.js:1273-1279`) only to pause render deadlines.
- **RC3 (parallelism is thrown away after boot).** The farm renders boot's 40 draws in parallel,
  then `farmShutdown()` (`worker.js:1280`, and main reaps on `farm_done`, `main.js:1102-1110`).
  Every later render is serial on the one engine thread. That covers PERFORM's 30–46
  measurement renders, every walk's proposals, and previews. Yet `perform_wire_plan` already
  lists a measurement's renders as independent jobs (`worker.js:813-826`), and `farm_render` is
  exactly that job.
- **RC4 (measurement is all-or-nothing).** `applyWired` runs once, at the end (`perform.js:915`).
  Until then every control reads "measuring…" and is inert (frame `rt_measuring.jpg`, Bell Jar:
  six "measuring…" sublabels, XY axes struck through). This is so even though the first round
  (the Jacobian, one render per knob) already says which knobs each control moves.
- **RC5 (one spare, only while B is empty).** `growSpare` returns if `state.offer` is set
  (`perform.js:803`). So the second Offer, the one a player makes after a pass, is always grown
  on demand: 10.9 s.
- **RC6 (Wander's re-measure asks as if the player did).** After a glide past `TRUST`,
  `stepGlide` calls `wire()` (`perform.js:1244`, `:1258`), and `wire()` asks without `bg` (`:693`). So it
  lands in `soon`, holds the floor, and a pressed Offer queues behind it. In roam, with a glide
  every 7–12 s and a measurement of about 11 s, the engine is nearly always measuring.
- **RC7 (the bench reply bundles the rack with the render).** For a structural op the worker
  sends `postLiveTree` first, so the sound changes early (`worker.js:1781-1790`). The rack
  description only arrives with `postBench`, after `edit_render`. The rack therefore redraws
  0.4–1.0 s after the gesture.
- **RC8 (the drift cadence starts late).** On entering drift, the first move waits
  `pace.period` (36 s at the left of the zone, 14 s at the right) counted from `lastMove`, plus
  `HANDS_OFF_MS` (`perform.js:64-83`, `:1752-1762`). Hence 21 s of "wander: drift" with nothing
  moving.

## 4. Flows walked (as a player meets them)

1. **First run.** Boot veil (bar, "heard n of 40 · k renderers"; no timing evidence). The warm
   start opens. ▶ on a card sounds in 0.83 s. After three picks and "teach it", PERFORM opens
   in 0.31 s and the "18 preferences learned" toast follows 2.6 s later. **Friction:** the pick
   under your fingers then reads "measuring how this patch moves…" on every control for a
   further 9 s or more. That makes the first impression of PERFORM six dead dials.
2. **Browsing in PERFORM.** A bank row shows "opening…" at once, and PERFORM names the patch
   0.8 s later. **Friction:** 11–16 s of "measuring…" on each patch not visited before. A revisit
   is instant from the persisted cache.
3. **Offers.** The first Offer is instant (a spare). Pass, then Offer again, and B reads
   "growing an offer…" for 10.9 s with no progress (frame `rt_growing.jpg`), while the Blend
   sublabel still reads "67% offer". Turning Grit (a search control) springs back, and a
   variant appears 4.3 s later.
4. **Wander.** Offer zone: a variant arrives 4.5 s after letting go (by design, after a 3.5 s
   hands-off pause). Drift zone: 21 s of nothing; the film cuts it. Roam: the status says
   "measuring how this patch moves…" for 10 s or more while the dials visibly work
   (`vp-wander-01-paused.jpg`).
5. **Editing in PATCH.** Knobs sound instantly, and the guess line says "re-measuring…" then
   settles 0.7 s after release. Insert, bypass and unplug redraw the rack after 0.4–1.0 s, and
   the guess settles 1–2 s after the gesture. ⌘Z takes 0.29 s. The film cut the guess's settle
   three times in one shot.
6. **⚡ evolve from this.** A toast reads "⚡ evolving around the locked controls…", the button
   is disabled and the lamp pulses. Then 23 s pass with nothing else: no progress, no cancel,
   and every other request queued behind the walk.
7. **EVOLVE.** A vote deals the next pair in under 0.4 s, and duel ▶ plays in 30–40 ms. Every
   sixth pick refits in 0.6–2.4 s, while the pair stays audible. **EVOLVE POOL:** the button
   dims to "BREEDING 1/10…" and a toast says "breeding a generation toward your taste…"
   (`ve-breed-01-evolve.jpg`). Then 103–193 s pass. Keep voting and the cards dim to 55 % with
   inert controls until the current seed ends, about 19 s on average (the next `duel` request
   waits for `refine_seed`). Switch to PERFORM and "measuring…" or "growing an offer…" last until
   the whole generation ends. All ten children appear at the end.
8. **TASTE.** A map dot press plays in 0.3–1.1 s. A refit after "see what changed ▸" takes
   0.6–2.4 s.

## 5. Findings (ranked)

### RT1 — EVOLVE POOL parks the rest of the instrument for 2–3 minutes, contrary to the guide
**P0 · responsiveness / truth**
- **Evidence**
  - `ve-breed.json`: `until #evolve-btn:not([disabled])` took 191 s; `ve-rhythm` took 165 s.
  - `worker.js:958-966`: no soon/later work runs while `floor` is set. `:1466`:
    `holdFloor(m, breed)`. `:867`: each `engine.refine_seed` is one call.
  - Guide `www/docs/src/views/evolve.md:105-109`: "The rest of the instrument stays playable
    while it runs: a ▶, a bench open or a pick is answered between one seed and the next."
- **What the player experiences.** Press EVOLVE POOL in EVOLVE, then keep picking, which the
  view invites. The pick is acknowledged at once (a toast and the forecast via `duel_pred`), but
  the next pair's `duel` request waits for the running seed. The cards sit at 55 % opacity with
  dead buttons for up to a seed (about 19 s on average, and longer on big patches), and no word
  explains it (`style.css:4085`, `main.js:4981-4988`). Opening a new patch in PERFORM shows
  "measuring…" on every control until the generation finishes. Pressing Offer shows "growing an
  offer…" for minutes. Keys and cached controls still play, so the app looks half-broken, not
  busy.
- **Principle.** Long work the player asked for must never block the player's next gesture, and
  the description must be true.
- **Recommendation**
  1. **Planned fix: RFC-001** (parallel walks on the farm, absorbed in job order with a breath
     between absorptions). It frees the engine worker for the whole generation and brings a
     generation from 100–193 s to about its slowest walk. Two gaps the RFC should close:
     - The farm no longer exists after boot (`worker.js:1280`). Spawn it on demand from the
       `WebAssembly.Module` main already holds (instantiation, not compilation), and reap it
       after 60 s idle. Do not keep N × 15 MB resident.
     - Answer the RFC's open question with "yes": land each child in the bank as it is absorbed,
       marked "new", and count them on the button.
  2. **Before RFC-001 lands**, make the floor yielding. At each seed boundary `breed` runs *one*
     queued `soon` job (a pressed Offer, the first measurement of the patch in the player's
     hands) before the next seed. The generation's own order is untouched: nothing it reads
     changes, because PERFORM requests carry their own tree.
  3. Add a **Stop** to the button between seeds: "stop — keep the 4 bred so far". Each
     `refine_seed` already inserts its child, so stopping early leaves a consistent pool.
  4. A dealing card that is waiting says so: "next pair after this seed…" in the meter line.
  5. Until 1–3 land, change the guide to "answered between seeds, up to about 20 s" (ADR-004
     prefers fixing the app; do both in order).
- **Effort:** M for 2–4, L for RFC-001. **Confidence:** high (floor semantics read directly;
  times measured).

### RT2 — ⚡ evolve from this is one 23 s uninterruptible call that blocks everything
**P0 · responsiveness**
- **Evidence**
  - `vp-lock.json`: `until … took 22.85`, `benched` 33.48. 23.4 s in the 00:21 run; 74.2 s in
    `sounddesign/sd-evolve` (09-27).
  - `worker.js:1571-1590`: a single `engine.refine_from`.
  - `main.js:12040-12048` (the toast and the disabled button only), and `main.js:1902`, whose
    comment says "the rack stays live while it breeds".
  - The step budget scales up to 4× with locks (`engine.rs:2302-2323`), so the more you lock,
    the longer you wait.
- **What the player experiences.** The knobs still sound, because `live.param` never needs the
  engine. But every bench re-render, structural edit, bank open, ▶ of an uncached patch, vote
  deal and PERFORM request queues silently for up to 23 s. The only signs are a toast that fades
  and a pulsing E.
- **Principle.** Acknowledge in 100 ms, show progress, allow cancel, never block the player.
- **Recommendation**
  1. **RFC-001's consequence:** run ⚡ as one farm job (`run_walk`), leaving the engine worker
     free. Also run 2–3 walks in parallel from the same seed with different RNG seeds and keep
     the best by E[u]. The latency is still one walk, and the result is better.
  2. In the interim, expose the walk as a stepper (`refine_from_begin` / `_step(n)` /
     `_finish`) so the worker breathes every about 10 steps.
  3. Show progress in the button ("⚡ 60/160…").
  4. Offer cancel as "stop — keep the best so far". The elite archive already holds it
     (`engine.rs:2326-2330`).
  5. Put the lock multiplier in the tooltip: "8 locked: about 4× longer".
- **Effort:** M (stepper, UI); L (farm). **Confidence:** high.

### RT3 — PERFORM's first measurement: 11–16 s of six dead controls, including a newcomer's first minute
**P1 · responsiveness / perceived performance**
- **Evidence**
  - `vp-named`: click 23.73 → `wired` 35.49 (16.3 s in the 00:20 run).
  - `to-first`: "measuring how this patch moves…" still showing 8.8 s after "teach it".
  - Frame `rt_measuring.jpg` (view-perform.mp4 at 83.5 s): every sublabel reads "measuring…"
    and the XY axis words are struck through.
  - `perform.js:666-695` (`wire`), `:915` (`applyWired`, only at the end).
  - `worker.js:808-840` (renders one at a time, serially).
- **What the player experiences.** Every patch not visited before is six inert dials for the
  length of a short phrase-loop, which is exactly where the warm start drops a first-time
  player. The keys play the raw patch meanwhile, which is good, but the view's whole idea (named
  controls) is absent.
- **Principle.** First result within 1 s for local work, and progressive disclosure of partial
  results.
- **Recommendation** (in order of payoff):
  1. **Ship pre-measured wirings for all 62 presets** in the build, keyed by `wireKey`, with
     `rev: 0`. Stale-while-revalidate (`perform.js:668-682`) already plays a stale wiring and
     re-measures in the background, so presets, warm-start picks and booth demos become instant.
     Generate them with a native example beside `preset_audit.rs`.
  2. **Farm the measurement.** `perform_wire_plan` jobs are pure renders. Send them to on-demand
     farm workers and `memo_insert` the results. That turns about 30 serial renders into about 8
     rounds on 4 workers, so about 3 s.
  3. **Progressive wiring.** Apply the controls after the Jacobian round with the sublabel
     "rough", then refine after verification. Reach-closing of a half (`HALF_OPEN`) waits for
     verification, so nothing claims more than it knows.
  4. **Pre-warm while choosing.** When the warm start opens, pre-measure its nine cards in
     `later` (booth's `prewarm` path exists: `worker.js:936-937`).
- **Effort:** S (1), M (2, 3). **Confidence:** high.

### RT4 — Offer on demand takes 4–11 s, and "again" always pays in full
**P1 · responsiveness**
- **Evidence**
  - `vp-offer`: pass, then press 21.1 → `next` 31.97 (12.3 s in the 00:20 run).
  - `vp-honest`: Grit turned → offer 4.3 s after release.
  - `perform.js:803` (no spare while `state.offer`), `:908-912` (steps 20 or 40), and
    `worker.js:1618-1621` (one call).
  - Frame `rt_growing.jpg`: B reads "growing an offer…", with no progress and no ETA.
- **What the player experiences.** The first Offer feels magical (0.15 s). The second, which is
  the natural rhythm of offer, pass, offer, feels broken. A search control springs back and
  something shows up 4–11 s later, often after the player has moved on.
- **Principle.** Prefetch the likely next request, and give feedback proportional to the wait.
- **Recommendation**
  1. **Keep one spare ahead even while B holds an offer.** Grow it in `later` once B's offer has
     been presented and hands have been off 2 s. "Again" then hands it over instantly, and the
     one after grows in the background.
  2. For **RFC-002** (planned: directed search offers), the tilt costs the same per step (the
     memo is shared), so latency is unchanged unless moved. Run it as a farm walk (RFC-001's
     `farm_walk` plus a tilt parameter). At pointerdown on a search control, start *both*
     directions on two farm workers and keep the one matching the release.
  3. Put progress in B: "growing toward grittier… 12/20", from a per-step count. The offer walk
     becomes a stepper like ⚡'s.
- **Effort:** S (1), M (2–3). **Confidence:** high for 1, medium for 2's timing.

### RT5 — Six uninterruptible engine calls block `now`; the queued gesture is never told why
**P1 · responsiveness / understandability**
- **Evidence**
  - `worker.js`: `fit` :1446, `refine_from` :1571, `perform_offer` :1618, `perform_drift` :1602,
    `refine_seed` :867, restore fit :1293-1298.
  - Main receives `busy`/`idle` (`main.js:1273-1279`) and uses it only to pause render
    deadlines (`main.js:3181`).
  - `tests/web/responsive.spec.js` checks only that a render overtakes a chunked measurement.
    No spec covers a gesture during a fit, an offer, ⚡ or a generation.
- **What the player experiences.** At random, a ▶, an open, a structural edit or a vote deal
  takes several seconds instead of 0.3 s, depending on what the engine happened to be doing:
  a refit, a spare offer grown in the background, a drift. Nothing says so.
- **Principle.** Predictable latency, and every waiting state visible.
- **Recommendation**
  1. Make it an engine-worker invariant, written into `web-runtime.md`: no single call longer
     than about 250 ms.
     - Walks (offer, drift, ⚡, seed) become steppers or farm jobs.
     - The fit becomes `fit_begin` / `fit_step(k sweeps)` / `fit_finish`, breathing between
       steps, or a farm job (the posterior is a function of log plus config; install it with a
       setter).
  2. Until then, whenever a `now` request has been waiting more than 300 ms while
     `engineBusy`, the requesting control shows the wait and its cause:
     "waiting for ⚡ (≈15 s)…", "after the refit…".
  3. Add specs: a vote, a ▶ and a bank open each answered within 1 s during a fit, an offer,
     ⚡ and a generation.
- **Effort:** M–L. **Confidence:** high.

### RT6 — Wander's drift does nothing for 21 s after you turn into it
**P1 · responsiveness / understandability**
- **Evidence**
  - `vp-wander` (3 runs): 12.75 → `drift` 33.2–34.9.
  - `perform.js:64-83` (period 36 → 14 s) and `:1752-1762` (waits `period` from `lastMove`,
    which the offer request reset).
  - Cut in the film (`wander4:knobs`).
- **What the player experiences.** The Wander dial moves into "drift" and the status says
  "wander: drift", but for 20 s nothing drifts, so the player concludes it does not work.
- **Principle.** A mode change gets an immediate first effect; the pace governs the repeats.
- **Recommendation**
  1. On entering a zone, the first move is requested after `HANDS_OFF_MS` (so about 4–6 s to the
     first glide including the walk). The period then applies from that move.
  2. Draw the time to the next move as a thin arc filling on the Wander dial, so waiting reads
     as intended.
- **Effort:** S. **Confidence:** high.

### RT7 — After a drift or roam, PERFORM says "measuring…" for ≥ 10 s while the dials work, and the re-measure jumps the queue
**P1 · perceived performance / truth**
- **Evidence**
  - `vp-wander` logs: "measuring how this patch moves… · paused — your hands are on it" at
    39.36, 46.61 and 48.95.
  - Still `vp-wander-01-paused.jpg`: the status reads measuring while Bright is labelled
    "cutoff" and turns.
  - `perform.js:1244`, `:1258` (`wire()` after a glide), `:693` (no `bg`, so the `soon` lane),
    `:1503` (the words for a patch with no wiring).
  - CHANGELOG "what the films found" says this now reads "re-checking". The 03:36 rehearsal
    still shows "measuring". The title reads "Glass Pad (edited)", so the drift appears to reach
    `patchChanged` as a new patch.
- **What the player experiences.** The words say "wait" while the hands say "works". Meanwhile
  a pressed Offer queues behind a measurement nobody asked for.
- **Principle.** Say what is true, and background work stays in the background lane.
- **Recommendation**
  1. Re-measure after a glide with `bg: true`, keeping the current wiring (`quiet`, as
     `revalidate()` does, `perform.js:697-703`), so the status reads "3 of 6 controls reach this
     patch · re-checking".
  2. Verify why the drifted tree arrives through `patchChanged`, and add a
     `perform_controls.spec` case: after a drift glide, `.pf-status` never contains "measuring".
- **Effort:** S. **Confidence:** medium on the cause (observed words, inferred path); high that
  the lane is wrong.

### RT8 — Structural edits redraw the rack only after a phrase render (0.4–1.0 s), and the guess after 1–2 s
**P2 · responsiveness**
- **Evidence**
  - `vp-add` `placed` 0.46 s; `vp-together` ≈1.0 s; `vp-change` bypass ≈1.0 s and guess
    +0.94 s; unplug guess 1.4 s.
  - Three cuts in `vp-change`.
  - `worker.js:1781-1790` (`postLiveTree` first, then `edit_revet` and `postBench`, which
    renders).
- **What the player experiences.** They click a jack and the sound changes, but the plate
  appears up to a second later. For about 1 s the eye and the ear disagree.
- **Principle.** Visible acknowledgement within 100 ms.
- **Recommendation**
  1. Split the reply. Phase 1 (`tree_json` plus `edit_describe()` plus `edit_vet_ok()`, no
     render) redraws the rack at once. Phase 2 (`bench`: buffer, φ, utility) settles the guess
     line.
  2. Animate the new plate in (120 ms), and keep "re-measuring…" on the guess only.
- **Effort:** S–M. **Confidence:** high.

### RT9 — Long work has no shared progress, ETA or cancel, and the lamp means three different things
**P2 · perceived performance / consistency**
- **Evidence**
  - `ve-breed-01-evolve.jpg`: "BREEDING 1/10…" is a dim label inside a disabled button at the
    top right, with a toast that times out.
  - `main.js:5162-5167`, `:12040-12048`: the ⚡ toast and the pulsing E (`style.css:233-245`)
    serve fits, generations and ⚡ alike.
  - B's "growing an offer…" is static (`rt_growing.jpg`).
- **What the player experiences.** They cannot tell whether a 3-minute generation is 10 % or
  90 % done, cannot stop it, and cannot tell a 2 s refit from a 3-minute generation by looking
  at the lamp.
- **Principle.** One concept, one place. Long work shows progress, a remaining time and a way
  out.
- **Recommendation**
  1. Add one **engine activity chip** in the menu bar beside PICKS / GENERATIONS. It shows only
     while something long runs:
     - "breeding 3/10 · about 1 min · stop";
     - "⚡ evolving · 40 % · stop";
     - "fitting to 58 picks…";
     - "measuring Bell Jar · 12/30".
     The ETA comes from this session's own per-seed and per-render durations.
  2. The lamp stays as the ambient sign.
  3. EVOLVE's button mirrors the chip.
  4. Children land as they are absorbed (RT1).
- **Effort:** M. **Confidence:** high.

### RT10 — The sixth-pick refit blocks the worker 0.6–2.4 s now, about 4 s when mature
**P2 · responsiveness**
- **Evidence**
  - `vt-open` `learned→lit`: 0.61 / 0.89 / 0.63 s.
  - `vt-wrong` `learned→fitted`: 2.06–2.37 s over 4 runs.
  - `engine.rs:459`: "~13 s → ~4 s in the browser" for a mature fit.
  - `main.js:5086-5092`: the deal is sent ahead of the fit.
- **What the player experiences.** The pick right after a refit is fine, because the deal goes
  first. But a ▶ SAMPLE of a cold render, the next vote's deal, or a bench open in the 2–4 s
  after it stalls.
- **Principle.** Background inference must not steal the foreground.
- **Recommendation.** As in RT5: chunk the fit into sweeps with a breath between them, or run
  it on a farm worker and install the posterior. Keep "fitting to your n picks…" in the activity
  chip (RT9).
- **Effort:** M. **Confidence:** medium (mature-fit number from the code comment, not a film).

### RT11 — TASTE map and bank opens: 0.3–1.1 s to sound, because opening is a render
**P2 · responsiveness**
- **Evidence**
  - `vt-hear`: 0.32 / 1.13 / 0.38 s.
  - `vt-together`: about 1.1 s.
  - `to-bank`: 0.34 s.
  - Opening is `edit_begin` → `postBench` (`worker.js:1472-1476`), a phrase render.
- **What the player experiences.** Pressing a dot is mostly quick, but sometimes a second of
  silence. Pressing along a path of dots feels uneven.
- **Principle.** Consistent under 150 ms to sound for "hear this".
- **Recommendation**
  1. If the candidate's audition buffer is resident (`renders` map), play it at press and let
     the bench swap underneath.
  2. Prefetch renders for the keyboard walk's next dot (the walk order is known) and for the
     map's hovered dot after 150 ms.
- **Effort:** S. **Confidence:** medium.

### RT12 — Boot time is not measured anywhere, and the tests' time budgets are too loose to hold the promises
**P2 · quality of evidence**
- **Evidence**
  - No sidecar or spec stamps boot → playable. Film set-ups wait on `pool ≥ 40` untimed.
  - `perform_instant.spec.js:33,38` allow 5 s for a revisit that the CHANGELOG calls "playable
    immediately", and 8 s after a reload.
  - `responsive.spec.js` has no numeric budget.
- **What the player experiences.** Regressions in the owner's first priority can land unnoticed.
- **Principle.** Measure what you promise.
- **Recommendation**
  1. Add `performance.mark`s in the app at boot start, veil down, first deal, first sound,
     filled, PERFORM wired, and bench open landed. Have `footage.mjs` log them into every
     sidecar (a `marks` block beside `stamps`).
  2. Add spec budgets on the CI machine:
     - playable ≤ 5 s with a warm cache;
     - revisit wired ≤ 0.5 s, and ≤ 1.5 s after a reload;
     - vote → deal ≤ 0.3 s;
     - duel ▶ ≤ 0.15 s;
     - a gesture during a generation answered ≤ 1 s (after RT1).
- **Effort:** S–M. **Confidence:** high.

### RT13 — Stale words about timing mislead both players and engineers
**P3 · truth**
- **Evidence**
  - `evolve.md:105` says "a minute or two on a laptop". Measured: 1.7–3.2 min, and about 100 s
    natively.
  - `perform.js:703-706` says a measurement "is one engine call of 10-30 s … cannot be
    interrupted". It has been chunked (`worker.js:790-840`).
  - `main.js:1902` says "the rack stays live while it breeds" (see RT2).
- **Recommendation.** Fix the comments now. Update the guide's figure after RFC-001, when it
  becomes "about N seconds".
- **Effort:** S. **Confidence:** high.

## 6. What the player sees while waiting (perceived performance)

| Slow path | Wait | What is shown now | Can keep playing? | Should be |
|---|---|---|---|---|
| Boot | unmeasured | bar, "heard n of 40 · k renderers" | after playable (8) | add marks (RT12) |
| Warm-start card ▶ | 0.8 s | `.wi-play` pending state | yes | ok |
| First measurement | 11–16 s | "measuring…" on all six controls; XY words struck | keys yes, controls no | shipped wirings, farm, progressive (RT3) |
| Re-measure after drift or roam | ≥ 10 s | "measuring how this patch moves…" (untrue) | yes | "re-checking", bg lane (RT7) |
| Offer on demand | 4–11 s | "growing an offer…", static | yes | spare ahead, progress count, farm (RT4) |
| Drift first move | 21 s | "wander: drift" | yes | first move at hands-off, arc on the dial (RT6) |
| Structural edit | 0.4–1.0 s rack, 1–2 s guess | "re-measuring…" on the guess | yes | two-phase reply (RT8) |
| ⚡ evolve from this | 23 s (up to 74) | a toast, disabled button, pulsing E | knobs yes; everything else queued | farm job, progress, stop (RT2) |
| EVOLVE POOL | 103–193 s | "BREEDING n/10…" dimmed; toast; E | keys yes; deals wait a seed; PERFORM work waits the whole run | RFC-001, yielding floor, stop, chip (RT1, RT9) |
| Refit | 0.6–4 s | E pulses; "fitting to your n picks…" in the guess line | yes, except requests queued behind it | chunk or farm (RT10) |
| Map dot / bank open | 0.3–1.1 s | "opening X…" on the row and in PATCH's caption; `.pf-name.pending` | yes | play the resident buffer first (RT11) |

## 7. Keep (must not be lost)

- **Sound first.** `live.param` writes the running voices before the engine hears of the edit
  (`main.js:6089-6100`), with about 25 ms smoothing and no recompile. Swaps are click-free,
  with about 23 ms of silence and the envelope carried (`live.rs:19-30`).
- **The bench lane.** One ordered lane, same-knob coalescing, held drags, and pending values
  drawn over replies (`main.js:10250-10330`).
- **The three lanes, the chunked measurement that resumes from the memo, `retire` and
  `promote`, and `heldForOpen`.** Together these removed the 18 s silent warm-start ▶ and the
  14 s dead controls after a Take.
- **Stale-while-revalidate wirings, persisted and keyed by content** (`perform.js:611-682`), and
  the **carried wiring on Take**.
- **Spare offers** (0.15 s Offer) and the claim-a-growing-offer rule.
- **The vote deals before the fit** (17 ms against 2722 ms), the **forecast shown at once**
  through `duel_pred`, and the **prefetched pair renders** (duel ▶ in 30–40 ms).
- **Progressive boot** at 8 patches, the farm, and the IndexedDB φ cache for restores.
- **"opening X…" wherever a patch is on its way**, and toasts that replace rather than queue.

## 8. Response-time budget (every gesture class)

Targets: **ack** (visible acknowledgement) ≤ 100 ms; **first** (first useful result) ≤ 1 s for
local work; **done** as stated, with progress and cancel beyond 3 s. "Measured" cites §2 rows.

| Gesture class | Ack | First | Done | Measured now | Verdict | Fix |
|---|---|---|---|---|---|---|
| Note (keys, MIDI, XY) | ≤ 10 ms audio | — | — | worklet, per quantum (not timed in films) | ok by design | — |
| Knob turn → sound (PATCH, PERFORM) | ≤ 30 ms | — | — | immediate plus 25 ms smoothing (row 12) | **ok** | — |
| Knob settle → guess line | 0 (the "re-measuring…" tag) | ≤ 1 s | — | 0.71 s (row 13) | **ok**, but blocked during long calls | RT5 |
| Structural edit (insert, bypass, unplug) | ≤ 100 ms rack | ≤ 150 ms sound | ≤ 1 s guess | rack 0.46–1.0 s, guess 1.3–2 s (rows 15–17) | **miss** (ack) | RT8 |
| ⌘Z / ⌘⇧Z | ≤ 100 ms | ≤ 300 ms | — | 0.29 s (row 18) | **ok** | — |
| Open a bank row / map dot → hear it | ≤ 100 ms ("opening…") | ≤ 150 ms sound | ≤ 500 ms rack | 0.32–1.13 s (rows 6, 8, 9) | **borderline** | RT11 |
| Preset or new patch → PERFORM controls | ≤ 100 ms ("measuring…") | ≤ 1 s preset, ≤ 3 s new | — | 11.8 s (16.3 loaded) (row 11) | **fail** | RT3 (ship wirings, farm, progressive) |
| Revisit a measured patch | 0 | ≤ 300 ms | — | spec allows 5 s / 8 s | **unverified** | RT12 |
| Warm start: card ▶ | ≤ 100 ms | ≤ 300 ms | — | 0.83 s (row 2) | **miss** | prefetch the 9 cards' renders when the dialog opens |
| Warm start: teach → PERFORM / "learned" | ≤ 100 ms | ≤ 3 s | — | 0.31 s / 2.6 s (rows 3–4) | **ok** | — |
| Warm start: landed pick → controls | — | ≤ 1 s | — | > 8.8 s (row 5) | **fail** | RT3 (shipped preset wirings) |
| Vote → next pair | ≤ 100 ms | ≤ 300 ms | — | < 0.41 s, 17 ms (row 24) | **ok**; **fail** during EVOLVE POOL (up to a seed) | RT1 |
| Duel ▶ | ≤ 100 ms | — | — | 30–40 ms (row 25) | **ok** | — |
| Sixth pick → map redrawn | 0 ("● it just learned") | — | ≤ 3 s | 0.6–2.4 s, mature about 4 s (row 26) | **ok / borderline** | RT10 |
| Offer (spare ready) | ≤ 100 ms | ≤ 300 ms | — | ≤ 0.2 s (row 27) | **ok** | — |
| Offer (grown on demand, "again") | ≤ 100 ms | progress | ≤ 3 s | 10.9 s (12.3 loaded) (row 28) | **fail** | RT4 (spare ahead), RFC-001 farm |
| Search control turned → offer | ≤ 100 ms (springs back plus toast) | progress | ≤ 3 s | 4.3 s, undirected (row 29) | **miss** | **RFC-002** (aim) plus farm, and pre-start at pointerdown (RT4) |
| Wander → offer zone | ≤ 100 ms | — | ≤ 5 s | 4.5 s (row 30) | **ok** | — |
| Wander → drift or roam first move | ≤ 100 ms | ≤ 6 s | — | 20.5–22.2 s (row 31) | **fail** | RT6 |
| Take | ≤ 100 ms | controls live 0 ms | re-check ≤ 5 s | toast ≤ 0.8 s, carried wiring; re-check end unstamped (row 32) | **ok** / unverified | RT12 stamp |
| COMMIT → comparison | ≤ 100 ms | ≤ 500 ms | — | 0.35 s (row 19) | **ok** | — |
| Import SVG / patch file | ≤ 100 ms | ≤ 2 s | — | 2.1 s (row 20) | **borderline** | two-phase reply (RT8) |
| Node-bank hover preview | ≤ 100 ms | ≤ 500 ms | — | ≈ 0.7 s (row 21) | **borderline** | farm the preview render |
| ⚡ evolve from this | ≤ 100 ms (+ progress) | progress | ≤ 10 s, nothing else blocked | 22.9 s, blocks all (row 22) | **fail** | **RFC-001** (farm job, parallel walks), stepper, stop (RT2) |
| EVOLVE POOL | ≤ 100 ms (+ progress) | first child ≤ 10 s | ≤ 30 s, nothing else blocked | 103–193 s; blocks PERFORM work throughout (row 23) | **fail** | **RFC-001** (parallel walks, children as absorbed), yielding floor, stop (RT1) |
| Toast after its cause (receipts) | ≤ 300 ms | — | — | ≤ 0.8 s; "unplugged" 1.4 s rides the render | **ok / miss** | RT8 moves it to phase 1 |
| Boot → playable | bar at once | ≤ 5 s warm cache / ≤ 10 s cold | pool filled ≤ 20 s | **unmeasured** (row 1) | **unknown** | RT12 |

**Planned fixes that already have accepted proposals**

- **RFC-001** (`docs/proposals/001-evolve-pool-parallel-walks.md`): walks on the farm, absorbed
  in job order.
  - It fixes RT1 and RT2 at the root, and the same `farm_walk` serves offers (RT4) and could
    serve fits (RT10).
  - Additions this review asks for:
    - an on-demand farm, because `farmShutdown` at boot means it does not exist when needed;
    - children shown as absorbed;
    - a stop that keeps what is bred;
    - spec budgets for gestures during a generation.
- **RFC-002** (`docs/proposals/002-directed-search-offers.md`): directed search offers.
  - It fixes what a search control *delivers*, not how long it takes. The tilt shares the
    memo, so latency stays at 4–11 s.
  - Pair it with RT4's two-direction pre-start on the farm, and progress in B that reports
    `moved` ("grittier by 0.8σ"). The wait then ends in an answer that matches the turn.
