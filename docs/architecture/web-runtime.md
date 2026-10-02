---
title: "The web runtime: threads, lanes and the bench"
last_updated: 2026-10-01
related_adrs: [1, 2, 7, 12]
---

# The web runtime: threads, lanes and the bench

## Purpose

For anyone changing `apps/web`. How the instrument is split across threads,
how requests reach the engine and in what order, and the invariants that keep
a player's gestures correct under load. `apps/web/README.md` has the longer
history of each choice.

## Overview

```text
 main thread (main.js, perform.js, midi.js, booth.js)
   │  views, bank, rack SVG, toasts, persistence, the bench lane
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
  first measurement of the patch in their hands).
- **later**: work nobody is waiting on (refits, re-measurements, spare
  offers, Wander's drift, booth pre-warms, the model's guess, the cable
  probe).

Queueing cannot help a request that arrives while a long call is *running*,
so long jobs are cut into pieces (`measure`) and `breathe` between pieces,
answering every `now` request that arrived meanwhile. One long job holds the
floor at a time. A hidden PERFORM's measurement drops to `later`.

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
or the main thread's in-flight queue deadlocks.

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
  `perform_record`. These are `now`-lane replies. In wasm at five lenses
  the ratings add under 2 ms at rest, and about 4 ms while a generation is
  open with the pool over size, when what its end would retire is ranked
  too (`crates/auracle-wasm/examples/pick_belief.mjs`; its native twin is
  `pick_belief.rs`).
- **With every views post** (`tasteViews`: a refit, a generation, an
  edit's commit, an import, the warm start), so the seeds are current after
  any of them.
- **On `refine_child` and `pinned`**, which change the pool or its pins and
  so the seeds and what may be replaced.

Main keeps the latest as `views.ratings` and draws nothing from it yet
(Plan-005 draws picks as directions and moves the glows per pick from it).
`views.ranked` and `views.map` still change only when views are posted. A pick
in EVOLVE reaches the worker when its undo window closes, so its ratings
arrive then, not at the click.

**`seeds` and `may_replace` describe a generation opened now.** At rest that
is the next press of EVOLVE POOL, and they are what to mark. While a
generation is open or a ⚡ walk is out, a press would wait its turn (see
[The worker's lanes](#the-workers-lanes)), so they describe one that has not
started. What the running generation will replace is `refine_child`'s
`retiring`; its seeds are the last `seeds` posted before it opened, and
each child's seed comes with it in the lineage `refine_child` carries. Read
`ratings.may_replace` and `ratings.seeds` only at rest.

## The model's guess and the cable probe

Two Plan-005 task 9 surfaces the page does not call yet (PATCH's task 7 draws
them). Both are about the patch in hand, and each reply carries the tree it
was computed for (`edit_tree_json`), so a page that has moved on drops it, as
it drops a stale pre-placement audition.

- **`guess`** (`later`, holds the floor; `{token, at?}`): the module the model
  guesses the player would add next
  ([reference](../../www/reference/src/search/guess.md)). `guessRun` asks the
  engine what it owes (`guess_plan`: the patch first if unmeasured, then the
  output's candidates in render order), renders the first `GUESS_FLOOR` (8)
  with `memo_render`, one per turn, breathing between them as PERFORM's
  measurement does, stops rendering once `GUESS_BUDGET_MS` (3 s) of rendering
  is spent, and posts `guess` with `{token, tree, data}`: the ranking
  (`guess_rank`), or `{reason}` (`no_taste` before the first fit, `full` at
  the grammar's ceiling, `no_patch` with nothing open). It gives way to work
  the player asks for and resumes from the memo. `at`, a module's key, ranks
  that deeper socket instead of the output's. Rendering the candidates on a
  crew (`farm_render`, then `memo_absorb`; each job's `cache` is its key in
  the farm's store) is not wired yet.
- **`edit_structure` with `guess`**: takes a guess (`guess_take`), the same
  edit with the same replies, remembered so that a later edit back to the
  tree before it (⌘Z) counts as a skip.
- **`guess_skip`** (`now`; `{token, guess}`): keeps that guess's family away
  from its socket for this patch, and answers `guess_skipped` with `{token,
  ok}`. Skips and takes are logged, never evidence.
- **`cable_levels`** (`later`; `{token}`): every audio cable of the patch in
  hand, measured on one render of the phrase (`edit_cable_levels`), keyed as
  the rack draws them (`from`, `to`, and both uids), in the live meter's dB
  scale; posted as `cable_levels` with `{token, tree, levels}`. One render
  (a median 160 to 206 ms in wasm), so it is asked once an edit settles; while notes
  sound, the worklet's meter reads the cables live.

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
  with the ranked rows and `refine_retiring`; the bank shows the child at
  once in a "new · gen N" group at the top of the pool, without re-sorting
  the ranked rows. Nothing is retired until the finish.
- **Progress.** `refine_progress` carries the jobs absorbed, the total and an
  estimate (`eta`, ms) from this session's own walk times.
- **Judged at the start.** Admission and the finish's retirements rank
  under the posterior the generation opened with (`judge` in `engine.rs`),
  not the one picks made meanwhile have reweighted, so which children are
  kept does not depend on when those picks landed.
- **Stop** (`refine_stop`, answered on arrival) calls `refine_finish`: the
  generation ends with the children absorbed so far, the lowest unpinned
  members are retired (a child bred early can be among them), and
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
  edit. Outside PATCH, where ▶ is out of sight, the dock's label says Space
  waits (`paintLiveLabel`: "▶ waiting for the edit…" in `#live-wait`, a
  polite live region over the name, outside its ellipsis) within the
  same frame as the press.
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
them the engine wires the six. The page sends none yet, so every wiring it
measures, caches and ships is the six's. The palette's panel (Plan-005 task 5)
will ask for the controls placed on it. Each wiring in the reply carries its
palette `index`, and the panel must name a control back by it (an aimed
offer's `control`, a graft's `k`), not by its position, which follows the
order asked; and `wireKey` must then hold the set asked for as well as the
patch.

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
`dealsOut` counts deals not yet answered; a taken-back pick leaves a deal
still out to become the next pair. With the table waiting, an answer that may
not go up is dealt again, and after three tries goes up anyway, so a pool too
small to deal anything else cannot leave the cards dimmed. An answer holding a
cut sound is the exception: it is always dealt again (`holdsCut`). That ends,
because each deal excludes the cuts made before it was asked for, so only a
cut made while a deal is out brings one back. `placePair` is the one place a pair goes
up: anything owed to a pair being shown belongs there.

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

## The job slot

Long work has one home, in the menu bar beside GENERATIONS: "⚡ breeding
3/10 · about 40 s", "⚡ evolving Glass Pad", "refitting your taste map…",
with **stop** where the job can be stopped. It shows only while such a job
runs, and the wordmark's E is lit exactly while it shows: both are drawn from
`lampJobs` (`lampOn`/`lampOff`, one count per job kind) in `renderJobSlot`.
EVOLVE POOL is its own progress bar while it breeds, with a stop beside it.

## Toasts

One lane, bottom right, one visible toast with a counter. A later toast with
the same `replace` key takes the earlier one's place; a refusal (`urgent`)
jumps the queue (and honours `replace` too); an undo keeps its full window,
and when the window closes its button is removed. Read the comment above
`note()` before adding a toast.

## ⌘Z

A teaching act with an undo window (a pick from EVOLVE or PATCH's strip, a
cut) registers how to take itself back (`holdTakeBack` in `main.js`) and
leaves when its window closes. ⌘Z takes back the newest one in any view; only
with none left does it reach the bench's edit undo, and only in PATCH.
Elsewhere it changes nothing and says so. The sixth pick's refit is sent when
that pick commits (`settleFit`), so it keeps its window too.

## Modes

- `?film` hides chrome that must not be on camera (the film chip).
- Booth mode (the ⋯ menu) plays itself when idle and hides links out of the
  instrument.
- `window.__aur` is the debugging handle; browser tests wrap `Worker` instead
  of relying on test-only hooks.

## References

- `apps/web/README.md` § Architecture
- [ADR-001](../decisions/001-one-random-stream-per-consumer.md),
  [ADR-002](../decisions/002-trees-serialize-in-declaration-order.md)
- [`testing.md`](testing.md) for the specs that pin these behaviours
