---
title: "The web runtime: threads, lanes and the bench"
last_updated: 2026-10-06
related_adrs: [1, 2, 7, 12, 15, 17, 18]
---

# The web runtime: threads, lanes and the bench

## Purpose

For anyone changing `apps/web`. How the instrument is split across threads,
how requests reach the engine and in what order, and the invariants that keep
a player's gestures correct under load. `apps/web/README.md` has the longer
history of each choice.

## Overview

```text
 main thread (main.js, shell.js, perform.js, midi.js, booth.js)
   │  the levels, bank, rack SVG, toasts, persistence, the bench lane
   │
   ├── postMessage ──► engine worker (worker.js + WasmEngine)
   │                      lanes: now │ soon │ later ; long jobs breathe
   │                      └── farm workers (farm.js): boot's renders, and
   │                          walks (a generation, ⚡) on a crew raised on demand
   │
   └── AudioWorklet (live-audio.js + LivePoly)
          N compiled voices of the current patch, the arpeggiator, the limiter
```

- **Main thread** draws everything and owns every piece of persisted UI state.
  It never runs the engine.
- **Engine worker** owns `WasmEngine`. Every call there can take seconds
  (renders, MCMC), and wasm cannot be interrupted.
- **Farm workers** render pool draws in parallel from the indexed draw stream,
  and the worker folds them in stream order, so the pool matches the serial
  path's. Boot's crew is reaped when boot ends. A generation's walks and ⚡
  evolve from this run on a crew raised on demand (see
  [The farm on demand](#the-farm-on-demand)).
- **AudioWorklet** plays the patch under the player's hands: `LivePoly`, a
  voice per note, allocation-free per quantum, no clock.

## The levels

PERFORM, PATCH, EVOLVE, TASTE and LEARNING are levels of one space
(Plan-008, RFC-006). `shell.js` (`createShell(host)`, created at the top of
`main.js`) owns where you are; the rules are `levels.js`, pure and
unit-tested (`tests/levels.test.mjs`):

- **`show(level, {chosen, focus})`** shows one level's section (the others
  `.hidden`), sets `body[data-level]`, names it in the header's `#where` (a
  polite live region), lights its stop on the rail (`aria-current=location`),
  saves it as `auracle-view` and puts it in the address's hash
  (`history.replaceState`, so Back still leaves the instrument). Then it calls
  `host.levelChanged(prev, next, {chosen})`, where main keeps every side effect
  a move has: disarming a module in hand, taking back a waiting ▶, closing
  Compare and a figure, PERFORM's `show`/`hide`, PATCH's `refitRack` and
  `patchView.shown`/`hidden`, the toast lane, the film chip (a `chosen` move
  outranks the tour's note) and TASTE's `setView`. `showView(name)` is a
  one-line wrapper the app's own moves use (after the warm start, PERFORM's
  "show me the knob", booth mode).
- **The start level** is the hash if it names a level, else the saved one
  (a saved `"play"`, PATCH's name before the levels, opens PATCH), else
  PERFORM (`startLevel`). PERFORM's controls arrive with `perform.js`, which
  shows them when it is built.
- **The keys** (ADR-017) are taken in the capture phase, before any control's
  own handler: ⌥↑/⌥↓ step along the axis (from EVOLVE, measured from
  PERFORM), ⌥← goes to EVOLVE and ⌥→ back, ⌥1–5 by `event.code`. A text field
  keeps them (`typing`), and so does any modal dialog showing (`host.blocked`:
  a connected, visible `[aria-modal="true"]`, which is the warm start, the
  commit pair, the ? card, PERFORM's stage mode and explain's lesson); a
  non-modal panel does not. ⌥ alone is `preventDefault`ed on keydown and
  keyup, or Firefox and Edge on Windows open the window's menu. The wordmark's
  click is a move like the others (`show("perform")`, the address replaced),
  its `href` kept for a middle click.
  A focused stop walks the rail with the plain arrows and Home/End, taken on
  the rail so EVOLVE's ←/→ never hear them.
- **A move is instant.** The morph that carries the held sound's face from one
  level to the next is PR C3, and so is each level's `anchor()`.

### The model view

Holding ⌥ (220 ms, `MODEL_HOLD_MS`) or pressing **MODEL** (`#model-btn`,
280 ms for a hold) raises what the model believes over whatever level shows
(Plan-008 §2.5). `shell.js` owns the gesture and the DOM: `body.model-view`,
MODEL's `aria-pressed` (true only for a tapped view), and the tag
(`#model-tag`, a status; its words are `host.modelTag()`, `words.modelTag`
from the counts TASTE's line uses). A hold never ends a tapped view. The
timer starts in the same capture listener as the level keys, under the same
rules (a text field and a modal dialog keep ⌥), and any other keydown while it
counts cancels it, so ⌥↑ never flashes the view; a level key while ⌥ holds the
view up ends it before moving. ⌥'s keyup, the window's `blur` and Esc end it
(Esc any view, held or tapped, once nothing nearer took the press: the shell
hears Esc last, on the window in the bubble phase, and leaves a press a
closer used, which says so with `preventDefault` or stops it on its way; at
every level, a bank row's ★, PATCH's chain, PERFORM's well modes, the ? card,
the scope and picture panels and TASTE's selected point among them). Main does the rest in
`host.modelViewChanged(on)` (`modelViewChanged`), engine facts only:

- **The bank** redraws through `flipBank`: under the view, once fitted, the
  pool's rest (New keeps birth order) stands in `views.ranked`'s order (by
  posterior mean); at rest, in id order, the order the sounds joined. Each row
  that moved glides from where it was (FLIP, `--d-move`; under reduced motion
  it jumps). CSS shows each row's `.bi-pct` and `.bi-u` only under the view.
- **TASTE**: `taste.setModelView(on)` drives the TASTE side of its toggle
  while the view is up and restores the player's choice after.
- **EVOLVE**: `askPairGuess` sends `duel_pred` with `pre: true` (the `now`
  lane; the worker echoes `a`, `b` and `pre`), and the reply is drawn on the
  card it favours only if the pair on the table is still the one asked about.
  It is asked when the view comes up, on each `placePair`, and again on
  `fitted`, so a refit between deal and pick cannot leave an old number; a pick
  clears it. The cards' style badges show only under the view.
- **PERFORM**: nothing per control; no engine call yet says a control's lean.

## The worker's lanes

Requests are served in three lanes, most urgent first and first come, first
served within a lane (`laneOf` in `worker.js`):

- **now**: the player's gestures and everything that must stay in order with
  them (edits, votes, opens, auditions, saves, logs). A render main asks for
  in the background (`render` with `bg`: the sounds of a pair just dealt)
  waits here behind every gesture, and before one starts the worker lets in
  anything that arrived during the last call (`serveNow`). It also lets
  `soon` work waiting to start go first (not a serial generation's
  `breed_step`s), and runs between that job's pieces. A `now` render of the
  same id supersedes it.
- **soon**: long work the player asked for (a generation, a pressed offer, the
  first measurement of the patch in their hands, a control's figure, the
  lesson on filters).
- **later**: work nobody is waiting on (refits, re-measurements, spare
  offers, Wander's drift, booth pre-warms, the model's guess, the cable
  probe).

Queueing cannot help a request that arrives while a long call is *running*,
so long jobs are cut into pieces and `breathe` between pieces, answering every
`now` request that arrived meanwhile. One long job holds the floor at a time.
A hidden PERFORM's measurement drops to `later`, and goes last there
(`idleOnly` in `worker.js`): a measurement nobody is waiting on (that one, one
of a patch PERFORM has left, a re-check, a pre-warm) starts only when nothing
else in `later` is ready, and at each breath gives way to anything that has
arrived there, resuming from the memo. It also waits for, and gives way to,
a face the player is looking at and waiting on in the faces lane (`seen`:
PATCH's outline of the patch without the selected module, Plan-008 C2b),
which it held back 15 s on a 16-core M3 Max when it did not. Back in sight, PERFORM gives the player
back what was theirs (`promote`, to `soon`): a first measurement, a Take's
(its controls play on the wiring carried over and the ones it lost read
listening… until it lands) and a control just placed; one asked in the
background (a re-check, a pre-warm) stays there. The app opens at PERFORM, so the
sound it boots with is being measured when the player first goes to PATCH or
opens another sound; held on the floor, that measurement kept PATCH's cable
probe, the model's guess and every face lookup waiting for all of its thirty-odd
renders (1 to 46 s on a 16-core M3 Max, by the sound, and over a minute on
a CI runner). The jobs cut this way are
PERFORM's measurement (`measure`, a render at a time), the model's guess and
PERFORM's offers and drifts (`walkRun`, an MH step, one proposal and so at
most one render, at a time; below).

So a `now` request waits for the one call in progress when it arrives, then
for the `now` requests queued ahead of it (first come, first served), and
then runs. With the worker instrumented at `AURACLE_CPU_THROTTLE=4` on a
16-core M3 Max (the farm slowed fourfold too), the calls it can wait behind
took:

- a render of a measurement or of the guess's floor: 0.5 to 3.1 s, by the
  sound;
- a step of an offer or a drift: up to 2.1 s;
- a background render of a dealt pair's sound: up to 1.6 s (1.7 s at 6×);
- a cable probe: up to 0.95 s (3.6 s at 6×);
- a refit, one MCMC call: 0.75 s;
- a preset's insert (an open's, which is a `now` request ahead of it, or a
  booth pre-warm's): up to 1.4 s (1.8 s at 6×); the warm start inserts nine
  in one call, 8 s;
- with no farm (`?farm=0`), while the bank fills, one step of the fill, which
  renders until two draws are admitted: 0.2 to 0.9 s unthrottled.

On CI the waits seen had the same shape: an edit answered 1.35 s after the
drag that made it (#174, #182), and an unplug's tree in the voices 2.2 to
2.9 s after the click (#176), each behind one call. The rule is held by
`apps/web/tests/worker-lanes.test.mjs`, which runs the worker's own
`yieldToQueue`, `serveNow`, `breathe`, `holdFloor`, `guessRun` and
`measure` over a stub engine: a request posted during a render is delivered
at the job's next breath and answered before the next render. And end to
end by `tests/worker/lanes.test.mjs`, which runs `worker.js` itself over the
built engine and posts the request while a given engine call runs: during
PERFORM's measurement, the guess's renders and a spare offer's steps, the
request is handed over when that call ends, before any other, and answered
before the job's next one.

### Offers and drifts are jobs

An offer is 20 steps (40 in *roam*), times up to four under locks, and an aimed
one may walk up to three times: 12 renders for a drift, 20 to 60 for an offer,
and past 120 for a roam offer that is aimed and locked. As one wasm call they kept the worker deaf for all of them, and it
did not matter which lane they were in, because the lane decides when a call
*starts*. A spare offer grown in the background (`later`) therefore stood in
front of a pick (`perform_record`, `now`), a Keep, a ▶ and a bench open: the
first spare took 62 s on a CI runner, and everything the player did in that
minute waited (`perform_teaches`, `perform_recentre` and `perform_next` timed
out on it).

Now `perform_offer` and `perform_drift` begin a **job** in the engine
(`perform_offer_begin`, `perform_drift_begin`: a handle) and `walkRun` advances
it one step at a time (`perform_job_step`), `breathe`ing between steps, and
asks for the reply when it is done (`perform_job_finish`). It holds the floor
like `measure` does, with these rules:

- A player's request waits for the step in progress, at most one render. A
  gesture that is several round trips to the worker (a Keep) waits for one
  step per trip.
- A spare or Wander's drift (`later`) gives the floor up when long work the
  player asked for is waiting (a pressed Offer, a measurement), goes back to
  the front of `later` with its job intact (ahead of anything waiting in `later`
  and of the faces lane below it, which only starts when nothing above it is
  ready and the floor is free), and resumes after it. A claim on a
  spare (`promote`) stops it giving way, and a claimed spare that had already
  given way goes to the front of `soon`.
- `retire` (the page left the patch, or a turn replaced an aimed offer) stops a
  walk that is running at its next step, drops one that is paused, and answers
  `retired`, instead of walking to the end for nothing.
- A binary without the jobs (a stale cache) takes the one call, as it always
  did.

What this does not do is shorten an offer: a pressed Offer still takes its
renders, and on a slow machine that is a wait the player sees (B counts the
seconds). It stops the wait being everyone's.

**Determinism** ([ADR-001](../decisions/001-one-random-stream-per-consumer.md)).
A job takes one draw of the session's PERFORM stream when it begins and walks
on a generator of its own seeded from it, and it reads the target (the tilted
prior, the posterior, the standardizer, β) as it stood when it began, and
says in its reply what was true then (`taste`, how far it `moved`). The render
memo is not part of that target: it is a shared, bounded cache that keeps
changing under the job, and it only saves renders (a hit is bit-identical to a
miss).
Which step ran when, what the player recorded meanwhile, and what other walk
was begun or paused beside it change nothing it finds. The engine's own
`offer`, `offer_toward` and `drift` are the job run to the end on a caller's
generator, so stepping and not stepping are one walk
(`a_stepped_walk_is_the_walk`; in the bindings
`a_stepped_offer_gives_the_reply_the_one_call_gives`).

A generation (`refine`) and ⚡ (`refine_from`) are **walk jobs**: they run on
the farm and never hold the floor, so every lane is served while they run.
What waits for a walk job instead of for the floor (`blocked` in
`worker.js`): a refit waits for a generation and for ⚡ (each is bred and
admitted under the posterior it started under), and the two take turns — a
generation waits for the running one or for ⚡, and ⚡ for a generation or
another ⚡ — so the `refine` stream is drawn in the order they were asked for
and a ⚡ child never lands inside a generation. Main disables each button
while the other runs, with the reason on hover. Neither starts before boot's
crew is gone.

**Every request gets a reply.** Bench edits get `bench` or `edit_rejected`,
or the main thread's in-flight queue deadlocks. The few requests that are
never answered, by design, are listed in [The worker's replies](#the-workers-replies).

## The worker's replies

Every request main posts to the engine worker goes out through `send` in
`main.js`, which numbers it: `rid`, counted from 1 on each page, assigned
there and nowhere else. Every reply the worker sends in answer carries that
number back as `re`, so a reply names the request it answers whatever its
type. A request with several replies marks all but its last with
`more: true`:

| Request | Its replies, the last one last |
| --- | --- |
| `edit_structure`, `edit_set_tree` | `tree_json` (the tree for the voices, ahead of its render; not for an undo or a redo with no makeup known), then `bench`; or `edit_rejected` alone |
| `edit_begin` | `bench_opening`, then `bench` (or `bench_missing`) |
| `load_preset` that opens (`open`) | `preset_loaded`, then `bench_opening` |
| `warm_start` | `warm_first`, then `warm_done` |
| `perform_record` | `perform_recorded`, then `status` |
| `readmit_held` | `readmitted`, then `held_sounds` (when the sound was let back in) |
| `refine` | `pool_trimmed` (when a restored pool was over size), `refine_progress` and `refine_child` as the generation goes, then `refined` |
| `refine_from` | `evolve_started`, then `evolved_from` |

A request whose handler throws is answered with `engine_error`, carrying its
`re`. What the worker says of its own accord carries no `re`: `busy` and
`idle`, a log line, a crew wanted or reaped (`farm_want`, `farm_done`), the
boot's fill (`fill_progress`, `repaired`, `playable`, `filled`, a restore's
`audition_clip`, `restore_failed` and `fitted`, and `boot_failed` once `ready`
has gone: `init` itself is answered by `ready`, or by `boot_failed` before
it), a face that was `pending` when its `faces` request was answered, the
sound of your own re-ranked when the presets' file lands (`own_sound` with
`presets`), and the `engine_error` for a rejection nothing awaited
(`request: null`).

The reply path in `worker.js` is one function, `emit`, behind three names,
so the echo cannot be forgotten:

- **`post`** is the reply to the request whose handler is running.
  `runMessage` names that request (`answering`) for the synchronous part of
  its handler and restores it before it returns, so every case in
  `dispatch`, and what it calls in the same turn (`postBench`,
  `postLiveTree`, `engineError`), is stamped without saying so.
- **`answer(m, …)`** is the reply to `m` from anywhere else: after an
  `await` (PERFORM's measurement and walks, the guess, a control's figure,
  the boot's `ready`), from a farm message or a timer (a generation's
  children and `refined`, ⚡'s child: each holds its request as `to`), or
  on another request's behalf.
- **`news`** is what nobody asked for. It is never stamped.

A request the worker cancels or supersedes is still answered with its
number:

- a figure or a lesson put away while it waits (`explain_cancel`) gets its
  own reply with `error: "cancelled"`;
- an offer or a drift retired while it waits gets `perform_offered` or
  `perform_drifted` with `error: "retired"`, and one retired while it walks
  gets the same at its next step;
- a measurement retired or demoted, a walk that gives way, and a guess back
  from its crew phase are the same request queued again, and answer it when
  they finish;
- a stopped generation answers its `refine` with `refined`, and a stopped ⚡
  its `refine_from` with `evolved_from` (`reason: "stopped"`);
- one render of an id answers everyone who asked (`renderJoined`): a
  background render asked for while one of the same id is queued (the
  player's, or another in the background) is not queued again, and the
  player's takes the place of a queued background one. Its one reply's `re`
  lists every number it answers;
- a request that arrives before the engine is up gets `not_ready`, and is
  never run. It names the request as `engine_error` does (`request`, its
  `re`, and PERFORM's `req`), and main sees to what waited on it
  (`notReady` in `main.js`): the preset list is asked again, a face when a
  slot next wants it, and a PERFORM question is answered as one the engine
  could not run (`perform.requestFailed`, through `releaseRequest`), so a
  measurement's "listening…" or "re-checking" and an offer growing are let
  go. Nothing failed, so no toast says so.

Never answered, by design: `log_edit`, `log_event`, `duel_shown` and
`set_style_name` (main waits on none of them), `farm_lost` and `farm_ports`
(the farm's plumbing), and the
requests that act on others, whose effect is the other request's own last
reply: `promote`, `retire`, `explain_cancel`, `refine_stop` and
`refine_from_stop`.

Main still matches a reply by what it is about (an id, a `token`, PERFORM's
`req`); `re` names the request itself. The browser specs read it, through
the fixture's `app.replyTo` and `app.answered` (`tests/web/AGENTS.md`).
`apps/web/tests/worker-protocol.test.mjs` runs `send` and the reply path as
written, the bench's cases, a generation's replies and `not_ready` (the
worker's answer and main's `notReady`) among them, and holds
the never-answered list (the fixture's `UNANSWERED`) to the worker both
ways: each request on it posts no reply of its own, and each one the
worker's source leaves unanswered is on it (a case that hands its request
to a helper is checked through the helper; the worker's own queued work,
`face_lookup`, `face_render` and `breed_step`, is never sent by main).

## The ratings after each pick

A pick reweights the posterior's draws in the engine (importance sampling,
no refit), so the model's ratings of the pool move with every pick. The
worker says so with a `ratings` field (`engineRatings`, from
`WasmEngine::belief`): every pool member's posterior mean, std and lens in
ranked order, the `seeds` EVOLVE POOL would breed from if pressed now, and
what that generation `may_replace`. No new message and no new lane: it rides
on replies that already exist. (`ratings`, not `belief`, on the web side:
`belief` in `main.js` is the bench's guess.)

- **On a pick's reply:** the `status` that answers `record_duel`,
  `record_keep` and `record_stars` (`null` when `recorded` is false: the
  engine took nothing, so nothing moved), and the `status` that follows
  `perform_record`. These are `now`-lane replies. A `perform_record`
  request carries `asOf`, the newest pool id main had shown when the answer
  was given (`newestSeenId` in `main.js`, via PERFORM's `host.newestId`): a
  Take waits eight seconds before it is sent, and a sound kept as new in
  that window is not judged by it (`Engine::record_tree_duel_as_of`). In wasm at five lenses
  the ratings add under 2 ms at rest, and about 4 ms while a generation is
  open with the pool over size, when what its end would retire is ranked
  too (`crates/auracle-wasm/examples/pick_belief.mjs`; its native twin is
  `pick_belief.rs`).
- **With every views post** (`tasteViews`: a refit, a generation, an
  edit's commit, an import, the warm start), so the seeds are current after
  any of them.
- **On `refine_child` and `pinned`**, which change the pool or its pins and
  so the seeds and what may be replaced.

Main keeps the latest as `views.ratings`. Pointing at EVOLVE POOL marks its
`seeds` and `may_replace` in the bank (`evolveMarks` in `main.js`), and TASTE
draws from it (`taste.js`, Plan-005 task 6): the `status` that answers `record_duel` draws an
arrow from the sound passed to the sound picked (its `vote` and `choseA`), and
every halo on the map moves to the ratings it carries, in one tween; a views
post settles every halo and every place at once. LEARNING's arrow (which way
liking rises on the map) turns with the same ratings. `views.ranked` and
`views.map` still change only when views are posted, so the bank's numbers
(shown under the model view) follow the last refit. A pick in EVOLVE reaches the worker when its undo
window closes, so its ratings arrive then, not at the click; picks made while
TASTE is hidden are drawn in turn when it opens.

## Taste over time, kept by the page

The engine keeps no history of its ratings, its map or its θ, so the page
keeps what it was sent (`taste-geom.js`: `recordEntry`, `attachStyles`,
`entryView`). One entry per change: each `status` with `ratings` (a pick, a
star, a cut, a PERFORM answer), and each views post with a new map (a refit,
or a generation when the engine's generation count moved), with the engine's
pick count (not TAUGHT, which also counts picks inside their undo window), the
observation count, whether a fit existed and the pick's
two sounds. Maps are kept once and referenced. After each `status` with
`ratings`, main asks for `styles` (a `later`-lane request, 0.6 to 12 ms by the
lenses) and the reply is kept with the entry whose observation count it
names; every surface's `views.styles` takes it too, so LEARNING's bars move
per pick. The history is bounded to the last 200 entries and saved with the
session as `ui.taste` (`{v: 1, maps, entries, names}`), JS-owned like the rest
of `ui`; a reset drops it, and `readHistory` drops one this build cannot read.
A refit's, a generation's or an opened file's moment keeps the styles of the
views post that brought it (`setStyles`); the worker answers a `styles`
request a fit has overtaken, or one queued behind a burst that finds no new
observation, with none, so θ is never credited to the wrong moment. TASTE's
track draws from the history, and LEARNING's REPLAY steps through its
`styles`, crediting each step to what it was. `ratings.direction`
(`Belief::direction`, `auracle_session::liking_direction`) is which way liking
rises on the last map drawn, fitted by the engine; LEARNING only draws it. A
`status` for a PERFORM answer the engine didn't take carries `recorded: false`
and no ratings, and keeps no moment.
Every views post also carries `features` (`WasmEngine::pool_features`: each
pool member's z), which LEARNING shades its small map by while a weight is
pointed at.

## The forecasts and the math's numbers

The `calibration` reply main asks for after every `status` carries, beside the
summary, every forecast it scores (`forecasts`, `WasmEngine::forecasts`: each
pair's `p_a`, the answer, whether it was a fair test, and its provenance) and
the numbers LEARNING's math states (`facts`, `WasmEngine::model_facts`: φ's
audio and structural halves, the draws the model holds, its styles, their cap
and the observations per style). Every views post carries `facts` too, since a
fit changes how many styles it was allowed. The forecasts persist in the
engine; main keeps the latest of each and draws them only in LEARNING.

**`seeds` and `may_replace` describe a generation opened now.** At rest that
is the next press of EVOLVE POOL, and they are what to mark. While a
generation is open or a ⚡ walk is out, a press would wait its turn (see
[The worker's lanes](#the-workers-lanes)), so they describe one that has not
started. What the running generation will replace is `refine_child`'s
`retiring` (said *will be replaced*: it only grows, one per child admitted).
A save, a preset or a kept edit joining the pool can change it too
(`eviction_order` passes over saved sounds and sounds kept as new before
their first pick, and a new member moves the lowest), so while a generation is open the `pinned`, `preset_loaded` and
`committed` replies carry `retiring` as well (`openRetiring` in
`worker.js`), and main repaints the marks from it.
Its seeds come with its progress: every `refine_progress` carries `seeds`,
`refine_jobs`' parents in job order (job `i` walks from `seeds[i]`). Main
used to take the last `ratings.seeds` posted before the generation opened,
which `next_seeds` and `refine_jobs` share a rule with, but with no boot
crew a generation can open between fill batches, and `fill_step` posts no
ratings, so that copy could be stale. Each walk's seed also comes with it as
`refine_child`'s `seed` (the job's `parent_id`), which for a child it
admitted is also its lineage event's parent. Read `ratings.may_replace` and
`ratings.seeds` only at rest.

While a ⚡ walk is out (no generation open), the bank marks its seed and the
first `pool + 1 − pool_target` of `ratings.may_replace` (one with the pool at
size): ⚡'s child is trimmed against at once when it is absorbed
(`evict_to_size` with the seed protected), lowest first by
`eviction_order`, which passes over a seed in flight, and `may_replace` ranks
the same way.

## The model's guess and the cable probe

Two Plan-005 task 9 surfaces, drawn by PATCH (task 7, `apps/web/patch.js`).
Both are about the patch in hand, and each reply carries the tree it
was computed for (`edit_tree_json`), so a page that has moved on drops it, as
it drops a stale pre-placement audition.

- **`guess`** (`later`; `{token, at?}`): the module the model
  guesses the player would add next
  ([reference](../../www/reference/src/search/guess.md)). It runs in two
  phases, and only the second holds the floor:
  - `guessCrewPhase`, detached from the pump (one guess's at a time): it plans first, and a refusal (`no_taste`, `full`) or
    a guess the memo already holds raises no crew. Otherwise, where a walk
    crew can be had
    (`crewUp`; not while a generation or ⚡ walks; while boot's crew is
    filling the pool the guess waits for it to finish, `blocked`, as a
    generation does, rather than rank only the floor's eight), it plans every candidate (`guess_plan` with limit 0) and hands
    them out one `farm_render` per idle worker (the farm's `job`, its `done`
    routed by `guessDone`; a lost worker gives its job back, `guessLost`),
    absorbing each with `memo_absorb` as it lands, for at most
    `GUESS_BUDGET_MS` (3 s) of wall-clock time from when the crew is up
    (`crewRenders`). The crew's idle timer starts when it ends. It renders
    nothing on the worker's thread, so it must not stop `soon` work starting:
    held on the floor, it made a pressed Offer, `refine` and the measurement
    of the sound in hand wait for a crew's spawn and its renders (about 4 s,
    up to 18 s). When it ends the guess goes back to the front of `later`.
  - `guessRun`, holding the floor: renders with `memo_render` whatever of the
    first `GUESS_FLOOR` (8) is still owed (nothing after a crew that rendered
    them; all of them with none), one per turn, breathing between them as
    PERFORM's measurement does, and stops rendering once `GUESS_BUDGET_MS` of
    render time is spent (render time only, checked after each render, so it
    can run over by one).
  
  It posts `guess` with `{token, tree, data}`: the ranking (`guess_rank`,
  over every candidate after a crew, the first eight without), or `{reason}`
  (`no_taste` before the first fit, `full` at the grammar's ceiling,
  `no_patch` with nothing open). It gives way to work the player asks for and
  resumes from the memo. `at`, a module's key, ranks that deeper socket
  instead of the output's: PATCH sends it for "What goes here?" (the
  selection's ⋯, or Q on a module, Plan-008 C2b), keeps asking for that place
  until a structural edit or Esc on the ghost, and drops a ranking made for
  another place than the one now asked about. PATCH keeps one `guess` out at
  a time, asks once the bench settles after an open or a structural edit, a
  refit or a skip (never after a knob turn alone), and drops a ranking made
  on a structure it has since left.
- **`edit_structure` with `guess`**: takes a guess (`guess_take`), the same
  edit with the same replies, remembered so that a later edit back to the
  tree before it (⌘Z) counts as a skip. A guess no longer current for the
  patch (ranked on an earlier tree) is refused with `edit_rejected` and its
  reason. A crash in `guessRun` still answers: `guess` with `{token, error}`.
- **`guess_skip`** (`now`; `{token, guess}`): keeps that guess's family away
  from its socket for this patch, and answers `guess_skipped` with `{token,
  ok}`. Skips and takes are logged, never evidence.
- **`cable_levels`** (`later`; `{token}`): every audio cable of the patch in
  hand, measured on one render of the phrase (`edit_cable_levels`), keyed as
  the rack draws them (`from`, `to`, and both uids), in the live meter's dB
  scale; posted as `cable_levels` with `{token, tree, levels}`. One render
  (a median 160 to 206 ms in wasm), so it is asked once an edit settles; while notes
  sound, the worklet's meter reads the cables live. PATCH asks once the bench
  has settled (`benchSettled`, no knob held, about 450 ms after an edit's
  reply, and 1.2 s after an open or PATCH coming into view, `ARRIVE_MS`, so
  a click on another sound is not left waiting behind a render) and only
  while PATCH is shown, with at most one probe at the
  engine (one asked meanwhile waits for its answer, then measures the tree
  on screen), keys each level by the cable's `from>to`, and drops a reply whose `tree` is not the bench's
  (`benchTreeJson`), asking again. At rest a cable's light is its measured
  level (patch.js `restLevel`, read by `buildRack` and `repaintMeasuredFlow`);
  a structure not measured yet is unlit, with hollow marks.

PATCH's own module (`patch.js`, created as `patchView` in main.js) also holds
a patch from nothing (NEW PATCH: one `edit_set_tree` that sets the root to an
empty `Silence` socket and keeps the amp; CLEAR, BACK TO ‹name›) and the module
sheet on touch, whose sliders write through `sendEdit` and the one ordered
lane, holding `knobDragging` while a finger is down so no knob is rebuilt
under it. It reaches main.js only through the host it is handed, and main
calls it back at a handful of points: `onWorker` (its three replies),
`benchLanded`, `rackBuilt` and `platesMoved`, `rejected`, `refit`,
`committed`, and `shown`/`hidden`. A new patch opens the catalog and leaving
it closes it (`host.openCatalog`/`closeCatalog`); the sheet's figure is the
bench's face (`host.paintFace`, captioned from `host.benchState`), and AUDIO
IN's and CAPTURE's lane buttons are in the sheet as buttons that press the
lane's own on the rack, so there is one of each.

### PATCH's canvas

PATCH is the specimen's canvas (Plan-008 C2a) over the same SVG rack
(`buildRack`), so every hook on it (`g.mod-group[data-key]`, `[data-addr]`,
`.jack`, the motion system's records) is unchanged:

- **The plates** are drawn at the specimen's scale: `PLATE_W` steps 84–240
  with one row of up to four knobs (`PLATE_COLS`), a 30-unit head
  (`PLATE_HEAD`), 56-unit rows (`KNOB_ROW`), 22-unit knobs (`KNOB_R` 11),
  56 units between layers (`LAYER_GAP`), and a fit that stops at 1.25×
  (`FIT_MAX`), so a four-module patch opens near 1× at 1440 px and its rack
  type prints at its tokens' sizes. The setting that names a module's kind
  (`plateSetting`: a `mode`/`wave`/`kind`/`table`/`type` enum) is the control
  in the head (`.plate-set`); the body draws the rest (`bodyKnobs`, which
  `moduleBox`, `knobPos` and `bodyBottom` share), each knob's value then its
  label, a setting as its printed value (`enumShown`) over a dotted rule. The
  amp's head draws `paintEnvFig` from its four knobs (repainted in
  `paintKnob`). ⋯ and the lock sit in a pocket on the plate's top edge
  (`WELL_Y`), which is why `STACK_GAP` is 36. Automatic detail switches to
  compact under 0.45× (`LOD_LINE`: where a 22-unit knob stops being a target;
  no longer scaled by the frame's height), with its 8% band below the line.
  Above it, where the silkscreen floor takes the readouts (`data-illegible`
  `value`), the names and head settings print larger, as compact draws them
  (`svg.lod-compact`), and every knob stays a control. Compact keeps AUDIO
  IN's and CAPTURE's lanes. Audio cables
  are level S-curves (`wirePathD`); a cable into a module placed behind its
  source by hand takes a right-angle run below both instead. Which of the two
  a cable is, is decided where its plates come to rest: the rack's motion
  (`startRackMotion`) hands `wirePathD` the layout at rest beside each
  frame's, so a cable stays a curve while a slide takes its end past its
  source (the amp out from under an insert, or back on ⌘Z; #228). A
  two-input module's input labels sit outside the plate (`addJack`'s
  `outside`), and plain `in`/`out` are not printed (they stay the jacks'
  accessible names).

- **The head** is `renderSubject`: the cap's family (a preset's category, only
  while unedited), the name, and the subtitle the rack counts (patch.js
  `counts`: not the amp, not an empty socket; modulators apart) with the
  layout's words and the states the caption carried. The edit bar
  (`syncEditBar`) shows while the bench is edited (`wb.dirty` or an edit in
  the lane); its count is `undoStack.length`, the stack being emptied at every
  open, so it is what ⌘Z would take back. **Undo to as opened**
  (`revertToOpened`) is one `edit_set_tree` to `undoStack[0]` with `restore`,
  offered only while the bench is settled and the stack still reaches the
  open (`undoTrimmed`); `settleRestore` settles it as that many undos in a row
  (`restorePending.all`), newest first, so the redo stack holds them in order,
  and only then says so (`sayReverted`; the toast's UNDO retires on the next
  step or restore, `retireRevertUndo`). It waits for `benchSettled`, not just
  the lane: with an open on its way the stack is the leaving sound's, and a
  restore then would land that tree under the arriving id. `revertRefusal`
  is the reason, shown as ↺'s tooltip (`aria-disabled`, so a press still
  arrives and says it). `requestRestore` (⌘Z) waits the same way; a restore
  queued during an open is dropped with the lane (`dropLane`).
  Each continuous knob's value as opened is kept by node identity
  (`openedKnobs`, `lockIdOf`) for its pale pointer (`paintWas`).
- **The face at OUT** is `#rack-play` itself, an HTML button the camera places
  (`placeOutFace`, from `applyView`) over the box `buildRack` leaves past the
  amp (`rackOut`; the layout's width grows by `OUT_ZONE`, and `contentBox`
  counts it, so every fit shows it). Its slot is the bench's face
  (`setFaceSlot(..., "out", {tree: benchTreeJson})`), so it is never an
  estimate, and its press is the rack's ▶ (`playBench`, `playWaitCancel`).
- **Fits** keep the well's own chrome clear (`fitBox`): the top line
  (`PT_TOP_LINE`), the foot (`PT_FOOT`) and, while open, the catalog
  (`catalogReserve`), as they keep the scope's corner (`scopeReserve`).
- **The selection** (`plateSel`, set by a press on bare panel in the rack's
  pan handler, by the focus arriving on a plate, and by `focusPlate`) marks
  both of a module's groups `.selected`; the readout (`renderSpecDock` into
  `#pt-read`) follows the plate under the pointer (`plateHover`) or the
  selected one, and a module pointed at in the catalog (`specSubject`). The
  thing in hand renders into the well's top line (`#pick-chip`'s
  `#pick-armed`), with `pickFeedback` naming the socket under the pointer.
  The selection follows the module across rebuilds (`plateSelUid`), not its
  key. The belief line (`#belief-row`) is on the same top line, empty without
  a guess, and yields to the module guess and the thing in hand (CSS `:has`).
  The scope is off until asked for (`scopeState.mode` defaults to `off`).
- **The catalog** is `#nodebank` inside the frame: `nbSetCollapsed` is its
  open and closed, never saved (`buildNodeBank` closes it at every start);
  `openCatalog`/`closeCatalog`; closing it puts down a module in hand and a
  ⋯ handoff (`cancelPending`). A pointer's ✕ lets the focus go
  (`closeCatalog(false)`); the keyboard's returns it to ADD MODULE. The lean
  (`.sd-model`, `.sp-model`) shows under `body.model-view` only; the
  keyboard's card stands beside the catalog. How many sounds it says carry a
  module's coordinate ("In 12 of 40 sounds", and below `NB_SUPPORT_MIN`
  the dash) is `poolSupport` (`support.js`) over the ranked rows'
  s-expressions, cut sounds aside: a sound counts once for a coordinate,
  however many of its modules it has.
- **The keys** (the rack's keydown): `platesInOrder` (by `rackBoxes`, x then
  y, the guess plate among them) for ←/→, `plateToward` for ↑/↓, Enter into a
  plate's controls (which walk only that plate's), F2 or the menu key for
  `openStructMenu`. Esc closes one thing a press. Whatever floats spends
  it (`escFloats`: a handoff, a bank row's ★, the comparison, the lineage
  pop-up, the ⋯ menu, the scope or picture panel, the bank tour, KEYS ⋯, a
  context menu; main's Esc chain closes all that are open together, and
  the two panels and the context menu hear Esc nowhere else), and so does
  the touch sheet (it stops the event in patch.js); then the first of
  `escSteps` that is open: the layout menu, the shelf, TEACH, the evolve
  menu, the selection, then the catalog. `escBusy` reads both lists, so a
  new patch's Esc waits while anything on them is open, and the two cannot
  drift. The global Home/End focus the first and last plate only with the
  focus on the canvas or nowhere, and never under a modal (`modalUp`);
  ⇧Home is `fitAll`.
- **The foot**: the camera's corner (`#pt-fit`, `#pt-zoom-out`/`in`,
  `#rack-map-btn`, the layout's menu `#pt-laymenu` with `setLayoutMode`),
  SET ASIDE (`renderTray` fills the shelf `#tray` and the catalog's
  `#nb-aside` from one `trayItemEl`), and TEACH (`setTeach` folds or unfolds
  `#play-duel` over the well; `renderPlayDuel` shows its chip while a pair is
  dealt). The well's edges (`syncEdges`, `nudgeRack`) count the plates whose
  middles lie past the view.
- **First steps** are per level (guide.js `levels`, `setLevel` from
  `levelChanged`), and so is ×: `auracle-guide` keeps `closed` as the levels
  closed (an old `closed: true` reads as PERFORM's). PATCH's four tick in
  `playBench` and `firstNotePlayed` (play it), `sendEdit`, `setLock` and
  `startEvolveFrom`; a dismissed bench tour (`auracle-bench-tour`) counts the
  last three done and a sound already played (`auracle-played`) the first
  (`markDone`). TEACH's chip counts the picks to the first refit, and
  `renderNextStep` says nothing about them while a pair is dealt.

## Faces

Every row, chip and card draws its sound's face (Plan-005 task 3; the guide's
`faces.md`, the reference's `features/faces.md`): the render's spectrum in 40
bands × 12 slices (`auracle_features::face`), drawn against the bank.

- **Taken in the featurization.** The face is computed inside
  `featurize_memo` from the render φ is measured on and rides on the memo row
  (`CachedFeatures::face`), so farm rows (`farm_render`), walk results
  (`farm_walk`) and offers carry it without a render of their own. It is not
  part of φ. In wasm it costs 2.5 ms against a 201 ms featurization
  (`crates/auracle-wasm/examples/face_cost.mjs`).
- **Filed by the worker under `"<ns>/<render key>"`**, as a farm row is
  (`face_key` for a pool member, `farm_key` for a tree). The memo is an LRU a
  generation's walks churn, so the worker copies a face out the first time it
  is asked for and keeps it in memory (`faceMem`) and in its own IndexedDB
  store (`auracle-faces`), stamped with the namespace as the render cache is
  (`faceStoreOpen`): a build whose renders differ never reads another's.
- **`faces`** (now lane; main → worker): `{ids, trees: [{ref, tree} | {ref,
  preset} | {ref, memo}], render}`. A `memo` is a render key already in the
  engine's memo: PATCH's guess names the render of each candidate
  (`Guess::key`), and its face is read with `face_of_key`, which never
  renders (a row evicted since is `failed`). Answered at once from memory alone, with `{type:
  "faces", items: [{id | ref, key, face}], pending, failed}`. The pending
  are looked up in `later` (**`face_lookup`**: the memo through `face_of` and
  `face_of_tree`, a resident audition, the store), each posted as a `faces`
  as it is found. With `render`, what none of them has is queued as
  **`face_render`** in the **faces lane**, below `later` (`FACES`), so a
  refit, a guess or a cable probe always goes first, and blocked until boot
  has finished (`blocked`: half a second each, they would slow the fill);
  each is answered as it lands, or in `failed` (a tree that does not vet).
  One render per key: a job carries every asker (`asks`), and a later asker
  for the same key joins it rather than being queued again, so a preset's
  row, that preset's row in the pool and the bench (an unedited preset's
  tree is the preset's) are all answered by the one render (before #153 the
  second was left unanswered). Each asker keeps its own source (its id, tree
  or memo row), and the render is made from the first, in the order they
  asked, that can still say what to render (`faceFromAsks`): a pool member
  cut since it asked (its `face_key` is empty) and a memo row the memo has
  let go are passed over, and a render that gives nothing is not made again
  for the others, whose key is the same.
  Rendering a pool member for its face does not make it resident, so it
  evicts no audition. A preset is asked by index (`preset_tree_json`), so its
  face does not insert it into the bank. Every request is answered; a
  `not_ready` or an `engine_error` for one makes main ask again when a slot
  next wants it.
  PATCH's "without this module" outline (Plan-008 C2b) asks the same way, by
  tree, with `seen` on its entry: the patch the structure menu's verb would
  leave without the selected module (`withoutTree`), rendered for its face at
  the front of the faces lane (moved there, with everyone on it, if it was
  already waiting) and
  ahead of a measurement nobody is waiting on (`seenFaceWaiting`, in
  `nextLong` and in `measure`'s breaths). It still waits for `soon` work, the
  rest of `later` (the guess, the cable probe, a refit) and PERFORM's own
  measurement of the sound it plays.
- **`face_cancel`** (now; `{refs, ids}`): what is still waiting for a slot
  that left the view (a preset row scrolled past, the PRESETS tab left, or
  PATCH's selection moved on before its "without" face was rendered) is
  taken off the render it waits on and out of waiting lookups, and answered
  as `faces` with `cancelled`; a render is dropped once nobody is left on it,
  so another slot waiting on the same key still gets its face. Main asks
  again when the slot comes back into view.
- **After a `render`**, the worker posts the buffer first; the face, if main
  hasn't been sent it, is looked up in `later` (`faceAfterRender`), from the
  stored audition (not the PCM main is sent: `audition_pcm` limits). No face
  work runs in the render's turn; a face's render already running (about half
  a second) can still hold up a render that arrives during it.
- **Main whitens and draws** (`faces.js`, `faceRestat`, `paintFaces` in
  `main.js`): the bank's mean per band and pooled spread over the faces of the
  rows the bank shows, recomputed when that set changes (once a frame) and
  drawn against only when it has moved more than 0.25 dB in a band or 1% of
  the spread. One renderer draws a face at every size (`vessel.js`
  `drawVessel`); a slot shows it drawn once per bank as an image (a PNG data
  URL); after the bank changes, the bank's rows in view are redrawn the next
  frame and the rest when the page is idle. A slot is fixed-size and present
  whether or not its face has arrived, so no name moves for it.
- **Large faces** (Plan-008 C1): PERFORM's sound in hand and B, and each
  EVOLVE card, are slots too (`FACE_SIZE` `well`, `wellb`, `evolve`), drawn
  once per bank at a fixed size with the glow and the floor's reflection
  (`FACE_OPTS`, through `drawVessel`) and scaled by the well that holds them
  (`FACE_FLUID`: no fixed size on the slot, the image contained in it), at
  2× at most and in a cache of their own (`faceWellCache`, 24), apart from the
  bank's 400 thumbnails. B's
  is drawn in the model's amber, smaller, on the same floor line as the held
  face's, so the two stand side by side in the well.
- **Stage mode** (`stageDraw` in `perform.js`) draws the sound in hand's
  face (`host.faceOf(tree)`: the face and the bank) with `drawVessel` at full
  height, with its glow and reflection, on a still layer drawn again only
  when the face, the bank or the size changes; what sounds is drawn over it
  on a second canvas (`st-trail`), measured as a face is (`createLiveMeter`:
  the analyser's time-domain samples through the face's Hann frame and band
  weights, in buffers made once) against the same bank, fading like phosphor
  and cleared in silence.
- **TASTE's map** draws each sound as its face (`host.drawFace`, main's
  `drawMapFace`), sized by the model's doubt, from a small canvas drawn once
  per bank and size; a dot until the face lands, and the map is redrawn as
  faces do.

## A control's figure and the lesson on filters

Explain anything (Plan-005 task 10, `apps/web/explain.js`): a control's
figure is what the engine measured on the sound in hand, never a recipe
([reference](../../www/reference/src/search/explain.md)).

- **`explain`** (`soon`; `{token, tree, made, turned, k}`): PERFORM's
  `explainOf(i)` gives the performed tree and two sets of knob overrides,
  the control at its center (`made`) and turned (`turned`, absent when
  nothing turns it). The worker holds the floor and renders each with
  `explain_render` (featurize, then `auracle_features::explain::portrait`,
  and `along`, the render's place on palette control `k`), breathing
  between the two, and answers `explain` with `{token, tree, k, made,
  turned}` or `{…, error}`. A render that does not vet answers `{error}` in
  its place. The page keys replies by the control, the tree, both override
  sets and the wiring's words, keeps one request out at a time (a key
  asked for meanwhile is not queued; the answer asks for its control's
  current key when the reply lands), and leaves a turn in progress to its
  300 ms follow timer, so a drag never stacks renders in `soon`: walks
  yield to `soon`, and a pile of figures there would hold a generation up.
- **`explain_lesson`** (`soon`; `{token, tree, overrides, cutoff}`): one
  `lesson_filter` render, the performed state with the grammar's lowpass at
  `cutoff` on its output (none: the sound as it is; no room for one more
  module: after the voice, `placement: "after"`), answered with `{token,
  tree, cutoff, data, buffer, sampleRate}` (`buffer` transferred, empty when
  `data.error`). The page keeps one out at a time and sends the latest
  cutoff when it lands; after a failed plain render, or a tree it cannot
  read, it asks nothing more.

- **`explain_cancel`** (`{kind}`, answered on arrival, never queued): an
  answer or the lesson put away. Every `explain` or `explain_lesson` request
  of that kind still waiting is taken out of its lane and answered with
  `error: "cancelled"` (the page keeps nothing for it), so none stands in
  `soon` ahead of what the player asks next; one already rendering
  finishes. With nothing open the page sends neither request.

Neither touches the pool, the bench or the log. An open figure follows its
control (perform.js calls `host.controlTurned`, and the figure asks again
once the turn has rested for 300 ms) and closes when its view does, and when
booth mode's attract starts (`host.attractStarted`). A long
press on a control on a touch screen asks (`host.askHold`) instead of
sweeping; with a mouse it still sweeps.

## The breed job

EVOLVE POOL is ten walks (`refine_seeds`), each a pure function of the
generation's shared context and its own job
([ADR-007](../decisions/007-generations-breed-in-parallel.md)). `breedOpen`
calls `refine_jobs`, stringifies the context **once** (about 2 MB, mostly the
posterior's draws) and hands every job to the crew; each farm worker gets the
context once per generation (`walk_context`), and `farm_walk` keeps the
parsed context keyed by that exact text. Results that land early are held
until their turn and absorbed **in job order** with `refine_absorb`, one per
turn (`genStep`), so the pool is the serial path's whichever worker finished
first.

- **Children as they land.** Each absorbed job is posted as `refine_child`
  with the ranked rows, the lineage, `refine_retiring`, the engine's reason
  when it bred nothing (`last_refine_reason`) and the job's seed; the bank
  shows the child at once in a "new · generation N" group at the top of the
  pool, without re-sorting the ranked rows, with its seed and what changed
  from the lineage, and EVOLVE POOL says what the walk came back as. Where
  the seed's row is in view, the child buds from it into its row, and a
  child the engine refused (`not_admitted`) buds beside it and fades
  (`budFrom`, `fadeBeside`). A bud flies between two rows' places as they
  were when it left, so when the bank is drawn again (the next child of a
  burst) every bud in flight lands at once (`landFlights`). Nothing is
  retired until the finish; then the
  bank lists what was replaced by name (the engine drops the trees).
- **Progress.** `refine_progress` carries the jobs absorbed, the total, an
  estimate (`eta`, ms) from this session's own walk times, and the
  generation's `seeds`.
- **Judged at the start.** Admission and the finish's retirements rank
  under the posterior the generation opened with (`judge` in `engine.rs`),
  not the one picks made meanwhile have reweighted, so which children are
  kept does not depend on when those picks landed.
- **Stop** (`refine_stop`, answered on arrival) calls `refine_finish`: the
  generation ends with the children absorbed so far, the lowest members
  not kept (saved, or kept as new and not yet in a pick) are retired (a child bred early can be among them), and
  walks still running are dropped (the crew is reaped at once if nothing else
  is walking, which gives the cores back).
- **Fallback.** With no crew (width 0, a spawn that failed, every worker
  lost) or for a walk a worker could not run (`farm_walk` answered `""`, or a
  five-minute watchdog), the job is walked in the engine worker with
  `refine_seed`, which runs the engine's own copy of the same job: the same
  child. Each such walk is a `soon` piece (`breed_step`), and a deal waits for
  the walk in progress, which the cards say.

⚡ evolve from this is one walk over the same path: `refine_from_job`, a farm
walk (at the front of the queue), `refine_from_absorb`. The job is drawn
**before** the worker waits for a crew, so nothing dispatched during a cold
crew's handshake can draw from the `refine` stream first (ADR-001). From the
draw until absorb or stop the engine exempts the seed from eviction. Stop
(`refine_from_stop`) answers at once, drops the job (`refine_from_cancel`) and
drops the walk's result. With no crew, or a walk no worker could run, the
engine walks the job it already drew (`refine_from_walk`): the same child, not
stoppable, and main is told so (`evolve_started` with `stoppable: false`)
before the walk starts. A generation also brings a pool restored over size
back to size before it opens (`poolTrim`), posting `pool_trimmed` so main
drops and names the rows.

Breed toward it (a sound of your own, Plan-005 task 11) is a generation over
the same path: `refine` with `toward: true` makes `breedOpen` call
`refine_toward_jobs` instead of `refine_jobs`. Its context carries the target
(`toward`), so `farm_walk` and the engine's fallback walk the same tilted
target, and its parents are the pool members nearest the sound. It queues,
absorbs and stops as EVOLVE POOL does. When it opens nothing, `refined` says
why in `reason` (`Engine::own_breed_blocked`): `untaught` (no fitted taste,
also set as the flag EVOLVE POOL's refusal carries), `no_sound`, or
`stale_sound` (a sound saved under coordinates φ no longer has).

The sound itself arrives as `own_sound_set`: the page's decoded file, mixed to
mono, as a `Float32Array` with its `sampleRate` and the file's `name`.
`own_sound_set`, `own_sound` and `own_sound_clear` all reply `own_sound`, and
all three are `soon` requests in one lane, so they are answered in the order
they were asked: a clear never overtakes the set before it
(`apps/web/tests/worker-lanes.test.mjs`). `soon`, because the analysis is one
uninterruptible call. For 30 s of sound it takes 0.16 s at 44.1 kHz, 0.31 s
at 48, 0.52 s at 96 and 0.94 s at 192 (`examples/own_cost.mjs`, wasm under
node), and gestures queued first go first.

What the page sends, and what each reply asks of it:

- **Mono, at most 120 s, at most 48 kHz.** The engine measures at most the
  first 30 s of sound and refuses more than 120 s (`too_long`: the page cuts
  the file and sends it again). wasm-bindgen copies the samples into linear
  memory, which never shrinks: two minutes at 48 kHz grow it by about 42 MB,
  at 192 kHz by 108 MB. So the page downsamples anything above 48 kHz, which
  also bounds the analysis near a third of a second.
- **`too_short`** is under half a second of sound once trimmed: a one-shot
  that short does not measure the coordinates a file is placed by
  (`FILE_MIN_SECONDS`). The card says so; there is nothing to retry.
- **`ok: false`** for any reason leaves the sound brought before in place.
  The card asks `own_sound` to redraw what is kept.

The first own-sound request starts a fetch of `perform-wirings.json` and does
not wait for it: until it lands only pool members are named as nearest, and
when it lands it goes to `own_presets_set` and the sound in hand, if any, is
posted again (`own_sound` with `presets: true`), re-ranked. The UI does not
send any of these yet.

## The farm on demand

The engine worker asks main for a crew (`farm_want`); main spawns the workers
from the `WebAssembly.Module` it keeps (`sharedModule`: compiled at boot where
boot had a farm, otherwise by the first crew; an instantiation per worker
after that, not a compile) and answers with their ports (`farm_ports`), or
with none, and the worker then walks the jobs itself. Width is `walkWidth()` in
`main.js`: boot's rule (leave the UI and audio threads a core each, at most
6, at most 2 on a small-memory device), but at least one worker where there
are two cores, because one worker already takes the walk off the engine
worker. `?farm=N` sets both widths; `?farm=0` is the serial path. The crew is
reaped after 60 s with nothing to walk (`farm_done` with its crew id; main
terminates those workers), so N × ~15 MB is not kept resident.

### The render cache's store

Each farm worker opens the render cache's store (`auracle-renders`,
`render-store.js`) when it is handed the phrase, and reads a row before it
renders a job that wants no audio and writes one after. **The engine worker
opens the store first, once, before any crew is handed the phrase**
(`renderStoreReady`, started at `init` whatever the width; boot's crew waits
for it in `farmBoot`, a walk crew in `crewUp`, before main is asked to spawn
it): it creates the store on a first visit, clears it when its stamp is
another build's namespace or it holds more than its cap, stamps it with this
build's, and closes it. So every crew's opens find it stamped and only read.
When each worker of a crew created and stamped it itself, their writes queued
behind one another's first renders, and on a first visit at width 6 the veil
waited about 1.5 s for them (#200). Where the engine worker cannot open it,
the farm workers create and stamp it as they did before, at that cost. **A
crew waits for the stamp `RENDER_STAMP_MS` (2 s) at most.** On a first visit
the stamp was done 42 to 53 ms after `init`, most of that importing
`render-store.js`. The bound is for an open that never answers, as one does
queued behind a deletion of the store that another tab's connections hold
pending: without it the veil would stay up for good. Past it the crew is
handed the phrase and opens the store itself, as it did before #200, and an
open that answers later still stamps the store if it needs it and is closed.
`tests/render-store.test.mjs` runs the two workers' code as written, in that
order, over a stand-in IndexedDB.

## The bench lane

Every edit to the patch on the bench (knobs, bypass, unplug, insert, ⌘Z) goes
through one ordered lane in `main.js`:

- edits to one control coalesce, and distinct edits are sent in order;
- the rack draws the player's unconfirmed values over any reply, so a drag
  starts from the value last set, never a stale reply;
- a value-only redraw repaints knobs in place, and no knob is rebuilt under a
  held pointer (`knobDragging`);
- an undo retires the toast of what it undid;
- KEEP AS NEW (`commitOnSettle`) and the bench's ▶ (`playOnSettle`) pressed while
  anything is in the lane wait for it to settle; ▶ also waits for a patch
  still opening (`benchSettled`). The bench's phrase buffer is replaced only
  by an edit's reply, so until then it is the sound from before the edit. A
  waiting ▶ is lit `.pending` at once, and is taken back by a second press,
  any stop or other ▶ (`stopAudition`, `awaitRender`, `cdPlay`, the node
  bank's preview), an open or a failed one, and leaving the view it was
  pressed in. In every view, Space is the bench's ▶ whenever a patch is on
  the bench (`toggleAudition`): PERFORM and EVOLVE play the edited patch and
  wait for an edit in flight as PATCH does, and with ▶ disabled Space says
  why rather than playing the bank's render of the patch from before any
  edit. The menu bar's ▶ beside the sound in hand (`#inhand-play`) is that
  same press, and wears the rack's waiting ring at every level; outside PATCH,
  where the rack's ▶ is out of sight, the sound in hand also says Space waits
  (`paintLiveLabel`: "▶ waiting for the edit…" in `#live-wait`, a polite live
  region in the name's place, outside its ellipsis) within the same frame as
  the press. A bench phrase is played under the key `"inhand"`, so both ▶s
  light while it sounds (`data-hear`).
- Space is the transport even with a drawn control focused (a rack knob, a
  PERFORM control, the XY pad): only a native button, or a control whose own
  handler used the key (`defaultPrevented`), keeps it. A rack setting's chip
  is a button: reached with the keyboard it cycles on Space or Enter (⇧
  back), and a pointer click leaves no focus on it (the document's click
  handler blurs it as it does a native button), so Space after a click plays.
- A selector the voices cannot take as a parameter (`wave`, `fkind`, `dmode`,
  `rmode`; `LIVE_INDEX_SITES` are live) reaches them with the bench reply,
  after its render, not early as a structural edit does: only the render
  measures the makeup the new tree plays at. Sent early, it could carry only
  the previous tree's, which put a held note up to 27 dB hot or 29 dB quiet
  over the presets' 355 selector changes, and no estimate cheaper than the
  render came within 3 dB often enough
  (`crates/auracle-wasm/examples/selector_makeup.rs`).
- A whole-tree edit (`edit_set_tree`) reaches the voices early at a makeup
  that is known: the page's (`makeup`: a Take sends the offer's, measured as
  it grew), or the engine's memo of that exact tree (`edit_known_makeup`: an
  undo or a redo lands on a tree measured when it was made). An undo or a
  redo with neither (`restore`) waits for its render; any other rewrite
  still goes early at the previous tree's makeup, which the reply corrects.

An open reaches the voices before the bench. Opening is a render (the bench's
buffer) on the engine's one thread, behind whatever render is running there,
but the voices need only the tree and its makeup: the worker posts them first
(`bench_opening`, from a clicked preset's insert and from `edit_begin`), and
`main.js` remembers each preset's (`auracle-voiced-presets` in localStorage,
keyed by the build), so a preset opened before goes into the voices, and
PERFORM, from the click, without the engine (`voiceEarly`). Until the bench
reply lands, `earlyOpen` holds that state: the old rack's knobs do not write
into the voices (`voicesAheadOfRack`), edits still landing on the old rack do
not take the voices back, a subject reply for an earlier open leaves them
alone, and PERFORM refuses a Keep, Take or Back, saying why, until the bench
lands (`host.openLanding`; a tree committed then would land on the rack being
replaced). An early open unmutes the voices (it is a vetted pool member). The
reply is matched by sound (`treeSound`, uids aside), vets the patch and mutes
it if it fails; an open that does not land (a failed insert, a patch gone
from the bank, the player moved on) puts the voices back (`unvoiceEarly`),
muted if the bench's last vet failed.

## PERFORM on the main thread

`perform.js` asks the worker to measure the patch (`perform_wire`), caches
wirings by tree text (`wireKey`), keeps the old wiring working while a new one
is measured ("re-checking"), and compares trees by text to tell a new
structure from new knob values. That comparison is why trees must serialize in
one key order ([ADR-002](../decisions/002-trees-serialize-in-declaration-order.md)).
A kept wiring is stamped with the observation count and the render namespace
the worker reports in its `ready` (`cache_namespace`: the stimulus,
`RENDER_EPOCH` and the quiver version), because it holds φ; a stamp that no
longer matches (a refit, or a new build whose DSP or featurizer measures
differently) is played at once and re-measured.

A `perform_wire` request may carry `controls`, indices into the engine's
palette of eighteen (`perform::PALETTE`), and the worker passes them to every
binding of the measurement (`perform_wire_plan`, `perform_wire_known`); without
them the engine wires the six. The page asks for the controls on the player's
panel (`state.panel`, at most eight, saved as `perf.panel` with the session):
nothing for the six, so their request, key and shipped file are what they
were, and otherwise the panel's set in palette order (`setOf`), so the answer
depends on the set and not on the order the panel shows it in. Each wiring in
the reply carries its palette `index`, and the page lays it on the panel by
that index (`alignWiring`) and names a control back by it (an aimed offer's
`control`, a graft's `k`, `indexAt`), never by its position. `wireKey` holds
the set as well as the patch (`#controls=` and the set, empty for the six),
and for a sound with an AUDIO IN the audition clip, on the patch's part
before the set (`wireKeyOf`: `patch|clip:<id>#controls=<set>`). A
placed control is measured lazily, on the sound in hand and only in sight
(`measurePanel`), borrowing what other sets of that patch measured
(`borrowWiring`) meanwhile; a measurement of a set the panel has since left is
cached and not played. Changing the panel rebuilds the deck (`setPanel`), never
under a held pointer (`panelLater`).

The cache persists across reloads (`auracle-perform-wirings` in
localStorage). It is written 1.5 s after a measurement lands, and at once when
the page is hidden or left (`flushWirings` on `pagehide` and
`visibilitychange`), as the session is (`saveOnLeave`): leaving cancels the
timer, and a reload, a closed tab or a booth's visitor reset in those 1.5 s
used to throw a measurement away, so the patch was measured again after the
reload. The presets `main.js` remembers for opening early
(`auracle-voiced-presets`, above) are written the same way (`flushVoiced`).
Hiding a tab with nothing waiting writes nothing. A write replaces the stored
copy with the tab's own, so with two tabs open the last one to write wins.

Every preset's wiring ships with the app in `apps/web/perform-wirings.json`,
measured natively through the same `WasmEngine` surface the worker uses
(`make perform-wirings`, the `preset_wirings` example) and keyed at load by the
same `wireKey`. The player's own cache is asked first, then the file. A first
measurement waits for the file at most `SHIPPED_WAIT_MS` (3 s), so a stalled
fetch cannot hold a patch on *listening…*; a file that lands later still
serves the presets opened after it. A shipped
wiring is always re-measured in the background (it was taken under the
standardizer of the shipped seed's pool, not the session's, whose seed is its
own; the shipped seed deals the same pool natively and in wasm, pinned by
`boot_agrees`, so the file is what a wasm engine booted from it would measure). A stale file wires controls to the wrong
knobs until that re-check lands, and the re-check then re-centres them, so
`make test` guards it two ways. `shipped_preset_wirings_are_current` compares
fingerprints of each preset and of the measurement's named inputs (phrase,
render namespace, feature names, controls, PERFORM's constants), rendering
nothing.
`shipped_preset_wirings_measure_the_same_today` covers what no fingerprint
sees (feature maths, loudness normalization, vetting, compiler and DSP, the
standard pool's fill, PERFORM's solver): it boots the standard engine and
re-measures a sample of the file natively, the standardizer, every eighth
preset's standardized φ and two presets' whole wiring, in about ten seconds on
four cores. A change that moves nothing in the sample can still pass. Any φ
change owes `make perform-wirings`.
While the warm start is open, `main.js` pre-warms its nine cards
(`perform.prewarm(tree, {fresh: true})`, trees from the file, no pool
inserts), one at a time in `later`, once the pool is full.

**The layout** (Plan-008 C1) is the specimen's well and panel: `.pf-left`
(the head, and the well with the held face, B, Blend, XY and How it works)
and `.pf-right` (CONTROLS, the deck, the hood, the pad row). The well has one
mode at a time (`setWellMode`: face, xy, how). Blend and Wander keep their
slots in `knobs` after the panel's controls (MIDI's and the keys'
`setControl`), wherever they are drawn: Blend a native range input under the
faces (`makeBlend`, shown only while B holds an offer), Wander the first cell
of the pad row; Freeze is a tap or Enter on Wander (`toggleHold`). PASS is
`passOffer`, the pass Next makes before it grows another. The moved bar shows
exactly when `movedFromHome()` (a `movedOn` reason for any knob, or a
structure other than home's), checked where `renderHood` already runs each
frame a knob moves, in a slot the head keeps, so nothing moves when it does.
Touch (what velocity plays) is a row of the Arrange panel. The pad keys
(ADR-018) are a `keydown` listener in `perform.js`: only while PERFORM shows,
never while typing, under a modal dialog (`host.blocked`, main's `modalUp`,
the same rule as the level keys) or with ⌘, Ctrl or ⌥; ↵ only with nothing
focused (a focused named control takes its own Enter and stops it). The first
steps are added to the guide pill (`guide.js`, `host.guide`), which keeps what
was done as `auracle-guide` and migrates `auracle-perform-steps` into it.

A continuous knob turned in PATCH reaches the voices as a parameter, never as
a new tree, so PERFORM hears it separately: `sendEdit` calls
`perform.knobSet` (PERFORM's base and home take the value at once), and the
edit's reply calls `perform.followTree` (its tree text follows, so a first
measurement, Keep and offers start from the edited patch). PATCH draws an
amber "performed" pointer only where `perform.movedOn` names a reason: a
control or expression offset, a Wander or Back glide, or a drift not yet kept.

## Timing marks

The app marks its own moments with `performance.mark("auracle:<name>")`:
`boot-start`, `veil-down`, `first-sound`, `pool-full`, `perform-wired` (with
how: shipped, cached or measured), `patch-opened`, `pair-dealt` and `fitted`.
`window.__aur.marks()` lists them in the page's clock. The film recorder
(`www/video/tools/footage.mjs`) writes them into every rehearsal sidecar as a
`perf` block beside `stamps` (`at0` is the page's clock at the shot's t = 0),
and `tests/web/budgets.spec.js` holds the budgets they measure.

## EVOLVE's next pair

While a pair is on the table, `main.js` deals the next one (`duel` with
`ahead: true`, echoed in the reply) once the table's own two sounds are
resident, and fetches the new pair's renders in the background (`bg`, as the
table's own are). The worker does not render a pair in the deal's turn: it
used to (`prefetch_render`), and a preset clicked just after a reload waited
out four renders before it opened. A pick or ↻ swaps it in
synchronously (`placePair`); the pair is re-checked at that moment against
cuts and replacements made since, and against the pair just put away
(`aheadUsable`). Only with nothing waiting does a pick wait for a deal, and a
deal already out (asked for ahead) is the one it waits for: no second deal
is asked for.

Every deal's reply goes through `onDealt`, whichever request asked for it:
the first to land while the table waits goes up, any other waits as the next
pair. The worker answers deals in the order they were asked, so pairs go up
in the order they were dealt whatever the timing (a seeded session shows the
same pairs, [ADR-001](../decisions/001-one-random-stream-per-consumer.md)).
`dealsOut` counts deals not yet answered. A taken-back pick (`retractVote`)
puts its pair back on the table, and which pair is next depends on what went
up in its place. If a pair did (the one dealt ahead, or a deal that landed
inside the undo window), that pair waits as the next one when `aheadUsable`
allows, since the player has seen it. Then the deal asked for behind it, if
one was, is thrown away unseen: overwritten if it has landed, dropped by
`onDealt` when it lands, because a pair already waits. The pair after it is
dealt when it goes up. When `aheadUsable` refuses it (as when it is the
pick's own pair, put up again by a pool too small to deal another), nothing
is thrown away: a deal behind it that has landed stays the next pair, and
one still out becomes it. If nothing went up, the deal the table was waiting
on lands with the pair back on the table and becomes the next pair. A
retraction asks for a deal only when no pair waits and none is out. With the
table waiting, an answer that may not go up is dealt again, and after three
tries goes up anyway, so a pool too small to deal anything else cannot leave
the cards dimmed. An answer holding a cut sound is the exception: it is
always dealt again (`holdsCut`). That ends, because each deal excludes the
cuts made before it was asked for, so only a cut made while a deal is out
brings one back. `placePair` is the one place a pair goes up: anything owed
to a pair being shown belongs there.

The worker deals with `deal_duel_ex`, which does not count the pair as shown;
`placePair` tells it which pair went up (`duel_shown`). So a deal thrown away
unseen (the engine re-dealt the pair on the table, a side was cut or
replaced, a retraction put the old pair back) moves neither the check-probe
cadence nor the repeat and exposure penalties: under a choosing rule the
unbiased probes stay one in `duel_check_every` of the pairs the player saw.

## Audio

`live-audio.js` builds the worklet as a blob with the wasm-bindgen glue
inlined behind a TextDecoder polyfill, and transfers raw wasm bytes for a
synchronous compile inside the worklet. A patch swap compiles one voice per
quantum while that node is muted. Levels follow one policy
(`auracle-wasm/src/level.rs`) for auditions and live play.

## AUDIO IN

The player's input in a patch (Plan-007 task 4,
[ADR-015](../decisions/015-audio-in.md)) is `audio-in.js` on the main thread,
the voices' input in the worklet, and the clip in the engine.

- **Permission.** `queueStruct` (every structural gesture's funnel) calls
  `audioIn.added()` when the op carries an `AudioIn`, inside the gesture; that
  is the only place the app asks `getUserMedia` for a grant. Opening a sound
  that listens asks nothing: the input opens if `navigator.permissions` says
  the microphone is granted, and otherwise the module shows ALLOW INPUT. A
  refusal keeps the node, silent.
- **Inputs.** The engine's `input` knob is a slot (1 to 8); the slot → device
  list is JS-owned (`auracle-inputs` in localStorage). `renderRack` calls
  `audioIn.follow(rack)` on every redraw, which opens one `getUserMedia`
  stream per device the bench reads and closes the rest. Chrome and Edge
  answer an unconstrained ask with the pseudo-device `default`, which
  `realId` resolves to the real input (its group, else its label) before it
  is numbered. Each stream's one
  source node fans out to an analyser per device (every module's meter), the
  worklet's input, and the clip's capture. `devicechange` and a track's
  `ended` silence what read a device that went, and reopen it when it is back.
- **The square.** The meter loop (rAF, only while a stream is open) reads
  each analyser's time buffer, one `FACE_FRAME` long, for the level and,
  above −60 dBFS, for the live face: `createLiveMeter().measure` (faces.js)
  into the face's bands, eased (0.6 old, 0.4 new), drawn by `drawVessel` on
  a canvas in the plate's square against the bank's `faceStats` in
  `--phos-a`, through `host.faceStats`/`host.faceColor`. The lane's
  `data-face` says whether it drew (`live`) or not (`none`: silence, or no
  stats under four faces); the level bar runs up the square's left edge.
- **The voices.** The worklet node has two two-channel inputs: the first is the voices', the second the recorder's (below). `audio-in.js`
  connects the source of the bench's first AUDIO IN to the first (`LivePoly` binds one
  input stream that every AUDIO IN reads). Main posts `monitor {on}` to the
  worklet, on only while monitoring is on and an input is connected. On, the
  processor writes each quantum of the input into `LivePoly` (`input_ptr`,
  `write_input`) before `process_ptr`, for A and B, and calls
  `set_open(true)`; off, it writes nothing, calls `clear_input` and
  `set_open(false)`. The input view into wasm memory is re-made whenever
  `view.buffer !== wasm.memory.buffer` or the pointer moved, checked every
  quantum, and nothing is allocated per quantum. Monitoring is never saved,
  and it ends when the bench has no AUDIO IN left.
- **The open voice.** Every patch ends in its amp envelope, gated by the keys,
  so a patch that listens would be silent with no key down. `LivePoly` builds
  such a patch one voice longer and `set_open(true)` holds that voice at C4,
  outside the keys' allocation (no key, unison, arp or `all_off` takes it), in
  the parameter table, carried across swaps like a held note. A patch that
  does not listen has none.
- **The clip.** On first listen (the voices' input over −50 dBFS and the
  session's clip still the reference, and no capture refused since) or NEW CLIP, `audio-in.js` records 6 s
  of the source through a one-shot `auracle-tap` worklet node (it ends its
  processor once its take is handed back, or dropped when the capture is cut
  short) and posts
  `set_audition_clip {samples, channels, sampleRate}` (transferred) to the
  engine worker, in the `now` lane. The reply is `audition_clip` with `ok`,
  the engine's `note`, `clip`, `remeasured` and `unmeasured`, `farmResent`
  (how many farm workers were handed the new phrase) and, when listeners were
  measured again, `views` and `status`; main applies them and saves the
  session, which carries the clip. Restores and `ready` post `audition_clip`
  with the status only.
- **The farm's phrase.** The phrase carries the clip, so the worker sends the
  `phrase` handshake again to the crew standing after a clip is taken
  (`farmResendPhrase`), and in a staged restore right after
  `import_session_deferred_v2` installs a captured clip, before any bank job
  goes out (port messages are ordered). A crew raised later gets the current
  phrase in `farmSetup`. `farm.js` keeps its open render store when the
  namespace is unchanged (the namespace never sees the clip).

### TRACK and CAPTURE

- **One tracked voice.** A patch with a TRACK builds its open voice as the
  lead (it tracks the input; its tracker's gate opens it) and every key's
  voice as a follower (`compile_follower`). The lead renders its quantum
  first and copies its tracked signals per frame (`read_tracks`); each
  follower sets its feeds from that copy before each of its frames.
- **Recording** (`takes.js`). RECORD first lends the input the AUDIO IN
  under its CAPTURE reads (`audioIn.lend(slot)`, the slot found from the
  CAPTURE's key, which may ask for permission). `audio-in.js` opens it and
  connects it to the worklet's second input, the recorder's: the lent input
  when there is one, else the bench's, so the voices go on reading the
  bench's own. `lend` answers `{ready, release}`; RECORD waits on `ready`
  (the line says *opening input…*) and starts only on `{ok: true}`, or says
  why it can't (`TAKE_INPUT`: refused, missing, failed, unsupported,
  unplugged). Then it posts `take_start {key, buf}` to the worklet, `buf` a
  `Float32Array` main allocated for the whole take (transferred), and while
  RECORD is lit the worklet copies the second input into it each quantum,
  whether or not MONITOR is on: a copy is all a recording costs the render
  thread. `take_stop {key}` (STOP, or the engine's `take_seconds` and a
  quarter of a second) hands it back, `take_done {key, buf, frames}`, and
  main sends it to the engine worker as `render_take {id, tree, key,
  samples, channels, sampleRate}` (transferred, `now` lane). The worker plays
  it through one voice of the sound, its key held at C4 and the CAPTURE's
  record gate raised, and encodes the take (`render_take` in `live.rs`: the
  take the live recorder would have made, bit for bit), replying
  `take_rendered {id, take}`, or no take with a `code`. That used to run in
  the worklet's port handler: a 4 s take's encode is 6.3 ms and the
  recorder's render up to 0.7 ms a quantum (`examples/take_cost.mjs`), a
  glitch for everything on the render thread; in the worker it is about
  70 ms nobody hears. No frames copied (a STOP before the first quantum) is
  no take. `take_error {code}` says why the worklet has none (`failed`). On
  the bench the take goes out
  as `edit_structure` with `set_take`, through the bench lane, and only to the
  sound it was recorded for: RECORD remembers `wb.subjectId`, and a move to
  another sound stops it and drops the take (`benchMoved`).
- **Kept safe.** After a restore that held sounds back, main asks
  `held_sounds` (each with its term and the key of the capture to record
  again) and lists them at the foot of the pool. RECORD AGAIN records from
  the saved term the same way, lending the input that term's CAPTURE reads,
  and sends `readmit_held {id, take}`; the reply `readmitted` carries the
  views when the sound is back.

## The job slot

Long work has one home, in the menu bar just left of the sound in hand:
"⚡ breeding 3/10 · about 40 s", "⚡ evolving Glass Pad", "refitting your
taste map…", with **stop** where the job can be stopped. It shows only while
such a job runs, and the round lamp after the wordmark (`#wm-lamp`) is lit
exactly while it shows: both are drawn from `lampJobs` (`lampOn`/`lampOff`,
one count per job kind) in `renderJobSlot`. GENERATIONS (`#gen-count`) is on
EVOLVE's cap line.
EVOLVE POOL is its own progress bar while it breeds, with a stop beside it.

## Toasts

One lane, bottom right, one visible toast with a counter. A later toast with
the same `replace` key takes the earlier one's place; a refusal (`urgent`)
jumps the queue (and honours `replace` too), and the toast it interrupts
comes back behind it with a fresh window unless it was already fading; an
undo keeps its full window, and when the window closes its button is
removed. A plain remark that has waited more than 9 s (`TOAST_STALE_MS`) is
dropped when its turn comes, and with more than three waiting the plain
remark nearest the front of the queue is cut (a queue position, not an age:
`replace` and `urgent` reorder it); with none, the undo nearest the front,
and a refusal last of all. An undo and a refusal are never dropped for their
age.

A toast that reports a change to the player's sounds (`bank: true`: a sound
joined or left the pool, or was saved or released) has its turn whatever
comes after it, since for a replaced sound it is the only place the sound is
named (#129, #183). It is never dropped for its age; the cut neither takes
it nor counts it among the three, so a burst of them each shows in turn, and
holds the lane until each has had its window (eight cuts in a row are about
a minute of toasts); a later toast on its `replace` key does not take its
place, and waits its turn at the back when it has no other toast on that key
to replace; and a refusal on its key interrupts it as it would any toast,
rather than removing it. It still takes the place of an earlier toast on its
own key that is not one of these (the warm start's result, a keep's after
its reveal). Its caller can still take it down when what it says stops being
true (an undone cut).

The queue is `apps/web/toasts.js` (`createToastLane`, unit-tested in
`apps/web/tests/toasts.test.mjs`); read its rules before adding a toast.

## ⌘Z

A teaching act with an undo window (a pick from EVOLVE or PATCH's TEACH, a
cut) registers how to take itself back (`holdTakeBack` in `main.js`) and
leaves when its window closes. ⌘Z takes back the newest one at any level; only
with none left does it reach the bench's edit undo, and only in PATCH.
Elsewhere it changes nothing and says so. The sixth pick's refit is sent when
that pick commits (`settleFit`), so it keeps its window too.

## Modes

- `?film` hides chrome that must not be on camera (the film chip).
- `?seed=N` (any whole number, taken modulo 2³² exactly; anything else is
  said in the console and ignored) is the session's random seed
  (`seedOverride` in `main.js`, read at boot beside `?farm`, never saved).
  Without it every boot draws one from `Math.random`. The engine derives
  every stream from it (fills, pairs, evolution, PERFORM; a fit from it and
  its number of picks: ADR-001), so a fresh session with the same random
  seed deals the same pool at any farm width, under the same names however
  many sounds `playable` caught (`Engine::fix_names`), and what follows
  repeats when the same requests reach the engine in the same order. Timing
  can still move it: a deal made while the pool is filling depends on how
  far it has got, and each PERFORM walk takes its draw when it begins. A
  saved session comes back as it was saved; only what is dealt after boot
  follows it. A reset is a fresh start: Reset your taste and the booth's
  next visitor reload without `?seed` (`reloadAfresh`), keeping the rest of
  the address, so they deal a new pool. The page's own draws stay random on
  purpose: which side of the table a sound stands on (`placePair`), the warm
  start's nine cards (`warmSample`) and the sides of the keep-as-new
  comparison, each there against position bias. Nothing on screen names the
  random seed or says how a session began, and a seeded pair is still dealt
  at random by the engine, so the copy holds either way. A browser spec on
  the shared fixture that names no seed of its own seeds both
  (`tests/web/fixtures.js` `SEED`: `?seed=` and the page's Math.random, as
  the films seed it), so it starts from the same pool, warm start and sides
  on every run; the nightly flake hunt boots those unseeded. A spec that
  names its own `random:` seed keeps it, and a spec not yet on the fixture
  boots unseeded.
- Booth mode (the ⋯ menu) plays itself when idle and hides links out of the
  instrument.
- `window.__aur` is the debugging handle; browser tests wrap `Worker` instead
  of relying on test-only hooks.

## References

- `apps/web/README.md` § Architecture
- [ADR-001](../decisions/001-one-random-stream-per-consumer.md),
  [ADR-002](../decisions/002-trees-serialize-in-declaration-order.md)
- [`testing.md`](testing.md) for the specs that pin these behaviours
