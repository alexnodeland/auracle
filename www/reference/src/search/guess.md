# The model's guess: the next module

<p class="lede">For the patch in hand, the model guesses which module you would
add next. It renders up to eight of the modules that could go at the
output, in the structural design's order, scores each by the posterior's
draws of what it adds, and leads with the one whose lower bound is
highest.</p>

PATCH starts from nothing and grows a module at a time. The guess is the
model's answer to "what next?": GUESS · FILTER at the output, with its reason
in the model's italic. It lives in `auracle_session::guess` and reaches the
browser as `guess_plan`, `guess_rank`, `guess_skip` and `guess_take` on
`WasmEngine`. The design was chosen by measurement against synthetic
listeners, in the design note `docs/notes/suggest-2026-10/` in the repository;
this page is what was built from it.

## The candidates

Every edit the grammar allows that adds a module and takes none away,
at three kinds of socket (`guess_candidates`):

- **the output:** a processor inserted into the wire before the amp
  (`StructOp::Insert` at `node`), for each of the twenty processor kinds;
- **the root's modulation slot:** a modulation source when the slot is empty,
  a shaper or combiner when it is filled (`SetMod` at `node`);
- **every empty socket:** each of the six sources (`Replace` of a `Silence`
  leaf).

Each must pass `validate_tree` (the size, depth and modulation-depth
ceilings), and no raw module count of [φ_struct](../features/structural.md)
may fall while their sum rises. A patch that does not sound takes sources
only: a processor over an empty socket is silent too. The seven presets
measured (three of them in the table below) have 20 to 30 such candidates,
and an empty patch has six. A deeper wire is ranked only when asked for by
its module's key (`at`); the note found that deeper sockets add
candidates the model rates highly by extrapolating, not ones a listener
likes more.

At the grammar's ceiling there is no candidate, and the guess says so
(`full`).

## The score

Each candidate is rendered on the [audition phrase](../audition/phrase.md)
and standardized, $z_c$. The patch is $z_p$, its own standardized φ, or
$z_p = 0$, the pool's average sound, when it does not sound. Over the
posterior's weighted draws $\theta^{(s)}$, with the
[mixture utility](../taste/utility.md) $u$, the gain is

$$
g^{(s)} \;=\; u_{\theta^{(s)}}(z_c) - u_{\theta^{(s)}}(z_p),
\qquad
\bar g = \sum_s w_s\, g^{(s)},
\qquad
\sigma_g^2 = \sum_s w_s\, (g^{(s)} - \bar g)^2 ,
$$

and the candidates are ranked by the **lower bound** $\bar g - \sigma_g$,
best first, ties in the candidates' order. Each guess also carries the pick
forecast $p = \Pr(\text{you'd pick the patch with it over the patch})$, the
same number the app shows beside every prediction with its sure word.

**The top guess's lower bound can be negative.** The list leads with the
best bound, not with a module the model is sure will help: in the native
run measured below, 12 of the 18 first guesses had a bound under zero, with
forecasts from 49% to 76%. The words a guess is shown with have to allow for
that.

The lower bound was the best criterion the note measured at both stages: after
the warm start a listener would pick the patch with the guessed module over
the patch 66% of the time, and the guess truly helps 71% of the time; after 78
picks, 70% and 78%. A random module is picked 51% of the time, and the
grammar's own favorite 54%. The mean and the forecast trail the lower bound by
5 to 7 points at the warm start, where a few picks leave the posterior wide.

**There is no trust region.** A guess may sit far from every sound the player
has heard: after a warm start that picked the three brightest presets, the
first guess in an empty patch is noise, 4σ rougher than the pool's average,
at 73%. The maintainer decided the lower bound is the guard for now.

## Render order, and the floor

Rendering is the whole cost, so the candidates are rendered in the order the
structural design would rank them: by the posterior mean of the patch's audio
φ beside the candidate's structural φ, which needs no render (`guess_plan`).
A crew that stops early has rendered the likeliest.

`GUESS_FLOOR` (8) is how many the engine worker renders when there is no render
crew, one per turn with the player answered between them; `GUESS_BUDGET_MS`
(3 000) is how much rendering it spends before it ranks what it has. The
budget counts render time only, not the time the worker spends on the
player's requests between renders, and it is checked after each render, so it
can run over by one render. The note
measured the first eight in this order (its dout8) against rendering every
candidate: 66% against 66% picked at the warm start, 69% against 70% after 78
picks. On a crew the plan asks for all of them.

| Patch | Candidates | Renders, floor / all | CPU s native, floor / all | CPU s wasm, floor / all |
|---|---|---|---|---|
| An empty patch | 6 | 6 / 6 | 0.5 / 0.5 | 0.7 to 0.9 |
| Sub & Sparkle | 20 | 8 / 20 | 1.4 / 3.3 | 1.9 / 4.7 |
| Hornet | 30 | 8 / 30 | 1.4 / 5.2 | 1.9 / 6.6 |
| Ceiling, the heaviest | 30 | 8 / 30 | 3.3 / 12.2 | 4.0 / 14.1 |

One render's CPU time is a median 184 ms natively and 251 ms in wasm under
node. The plan and the ranking render nothing and cost 1 to 17 ms together.
Measured on 2026-10-01 on an Apple M3 Max that other jobs were sharing, by
`crates/auracle-session/examples/guess_cost.rs` and `guess_cost.mjs` in
`auracle-wasm`, after both warm starts the note used; the native run starts
each patch from a memo that holds only the patch. With no crew, the floor
fits the 3 s render budget in wasm on every preset measured but the two
heaviest
(Deadfall and Ceiling, 3.3 to 4.2 s), where the worker ranks the seven or so
it rendered in time. On a crew of six, every candidate of a preset would take
about five renders' time, under 2.5 s (derived, not measured).

## Why

A guess's reason is the largest part of its gain under the style most
responsible for its sound, with $\Delta z = z_c - z_p$ and that style's
posterior mean $\bar\theta$ (`GuessWhy::part`). The parts considered are:

- each of PERFORM's six [named directions](./perform.md#a-named-control-is-a-direction)
  $\hat e$: the gain's projection on it, $(\bar\theta^\top \hat e)(\hat e^\top
  \Delta z)$, named by the end word the guess moves toward ("it moves toward
  dark"). The projection is positive only when the move and the lean point
  the same way along $\hat e$, so the word names where the gain comes from.
  Summing $\bar\theta_j \Delta z_j$ over the direction's coordinates would
  not: for Bright, a centroid that rises while the rolloff falls further
  reads "toward dark", and a taste for the centroid alone gains from the
  rise;
- each structural coordinate the guess changes, $\bar\theta_j \Delta z_j$
  ("more drive").

The largest positive part is the reason, with how far the guess moves along
it in σ; a move under 0.005σ, which would print as 0.00σ, is never a reason.
When no part is positive, no part leans the player's way, and the guess has
no reason (`why` is null). For a patch that does not sound, the gain
is over the pool's average, but the reason measures the move from the average
sound with the patch's own structure, so it can name only what the guess
changes, never the amp envelope an empty patch keeps.

## A skip, and an undo

The ranking is a pure function of the tree, the posterior and the
standardizer, so what a player has turned down has to be remembered outside
it (`GuessMemory`):

- **A skip keeps that module's family away from that socket, for this
  patch.** The model cannot tell a wavefolder from a bitcrusher: both are
  one coordinate of φ, `n_drive`. Skipping one and being offered the other
  would be the same guess again. A socket is named so that it outlives other
  edits: `out`, the output; `mod:<uid>`, a module's slot; `in:<uid>`, an
  empty socket; `wire:<uid>`, a deeper wire.
- **Undoing a taken guess counts as a skip.** Taking a guess is an ordinary
  structural edit, so ⌘Z undoes it, and the tree it returns to would rank the
  same guess first again. When the patch in hand comes back to the tree a
  guess was taken on (compared by content, as patches always are), the guess
  is skipped. Opening a patch (another, or the same one again) or closing
  the bench forgets the guesses taken, so a later edit undone back to an old
  tree is not taken for an undo of a guess.
- **Only a current guess is taken.** A guess is checked against the patch as
  it is when it is taken (`guess_is_current`: the same edit, socket and family
  among its candidates now), and refused with a reason otherwise: a source
  ranked for an empty socket, sent after the player filled it, would wipe what
  they placed. The check renders nothing.
- **Per patch:** skips are kept by the pool id the patch was opened from, for
  the session; an import starts with none. Keep as new carries them, and the
  guesses taken, to the new sound: it is the same patch the player is working
  on.

Neither a take nor a skip is evidence. Both are logged in the implicit stream,
as a revert is, and stay out of the likelihood: a skip is confounded with
curiosity, and keep as new already records what the player thought of an
edit.

## When it is computed

- **Nothing before the warm start.** With no fitted posterior there is
  nothing to guess from (`no_taste`).
- **On a structural edit, a refit, or the player asking:** never per knob
  step. Every candidate contains the patch, so a turned knob changes every
  render. A ranking carries `observations`, the count the posterior holds, so
  a page can tell one from before a refit.
- **Deterministic.** The plan and the ranking draw no randomness, and the memo
  only saves renders (a hit is bit-identical to a miss), so a seeded session
  guesses the same whichever order the renders land in
  ([one random stream per consumer](../design/decisions.md)).
- **Keyed by stimulus.** A render's memo key is the content address under
  the engine's phrase, and each job's persistent key begins with the render
  namespace (`farm_key`). A row measured under another stimulus or another
  build is never absorbed, so it costs a render, never a wrong φ.

## The engine worker

The worker answers `guess` in its `later` lane: it plans, renders the first
`GUESS_FLOOR` candidates with `memo_render`, and ranks, posting the ranking
with the tree it ranked, or the error if the engine failed. A taken guess is `edit_structure` with the guess
attached (`guess_take`), and a skip is `guess_skip`. Raising a render crew for
a guess, as a generation raises one, comes with PATCH's view of it.
