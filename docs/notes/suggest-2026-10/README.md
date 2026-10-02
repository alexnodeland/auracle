# The next module: how the model could suggest one, October 2026

The design note for [RFC-006](../../proposals/006-the-sound-at-the-centre.md)
Open question 2, "How the model suggests the next module in an empty or
growing patch", which [Plan-005](../../plans/005-the-sound-at-the-centre.md)
task 9(d) asks for before any code. It is a design for the maintainer to
decide on. Nothing in the engine changed: two measurement examples were added,
and every design below is built from machinery that exists today.

*Status (2026-10-01): decided (section 9) and built, as the model's guess:
`crates/auracle-session/src/guess.rs`, its wasm bindings and the worker's
`guess` message; the reference's
[The model's guess](../../../www/reference/src/search/guess.md) describes it.
The tables below stay as measured, on quiver-dsp 0.3.3; Plan-005's
"Measured (task 9d)" has the built guess's cost on 0.4.0.*

Measured on 2026-10-01 at `7b43ef2`, with quiver-dsp 0.3.3 (the workspace
`Cargo.toml`, and `QUIVER_DSP_VERSION` in `auracle-features/src/cache.rs`), on
an Apple M3 Max (12 performance and 4 efficiency cores) that other jobs were
sharing: the load average ran between 26 and 41 throughout. Quiver 0.4.0 moves
φ slightly. These results compare costs and rankings, which a slight move in φ
should not change much; they were not re-run on 0.4.0. Dated, and not kept
current.

## Files

| File | What it is |
| --- | --- |
| [`census.txt`](census.txt) | The output of `suggest_census`: the run every table below quotes, with the machine's load before and after |
| [`wasm.txt`](wasm.txt) | The output of `suggest_cost.mjs` |
| `crates/auracle-session/examples/suggest_census.rs` | Builds the candidates, the taste profiles and every design; times each; grades each against synthetic listeners |
| `crates/auracle-wasm/examples/suggest_cost.mjs` | The same candidates rendered in wasm under node, the browser's speed class |

To run them again:

```
cargo run --release -p auracle-session --example suggest_census -- --ops /tmp/suggest_ops.json
make wasm
node crates/auracle-wasm/examples/suggest_cost.mjs /tmp/suggest_ops.json
```

The census took 9 minutes on this machine under load. Its quality numbers are
seeded and come out the same on every run. Its costs are each thread's CPU
time, which a busy machine inflates far less than the wall clock.

## In short

- **Recommended: render the candidates at the output and rank them by a lower
  bound on the gain.** For a patch, try every module the grammar allows at the
  output (and in an empty socket, and on the root's mod slot), render each on
  the audition phrase, and rank by the posterior's mean gain over the patch
  minus one standard deviation. Against seven synthetic listeners on eleven
  patches, the listener would pick the patch with the suggested module over the
  patch without it 66% of the time after the warm start and 70% after 78 picks,
  and the suggestion truly helps 71% and 78% of the time. A random module is
  picked 51% of the time and helps 44%. The catalog, which ignores taste, is
  picked 54% and helps 65%.
- **It costs renders, so it runs on the render farm.** An empty patch has 6
  candidates and a preset 19 to 29. In wasm one render takes 231 ms of CPU
  (the median), so a preset's set is 4.4 to 13.2 s on one thread: far past the
  3 s budget on the engine worker. Spread over a crew of six it is about 0.9 to
  2.3 s (derived). Rendering the candidates in the structural design's order
  and stopping after eight loses almost nothing (66% and 69% pick), which is
  the fallback for a crew of one or two.
- **Not recommended:**
  - structural φ alone (no render) barely beats random (56% and 54%);
  - the walk's proposal distribution, tilted by taste, picks the same module
    as the untilted grammar on every patch and profile measured: a catalog;
  - the offer's walk rewrites the patch rather than adding to it: of 66 walks,
    63 added modules but only 2 added exactly one and took none away, and three
    walks cost about 55 renders.
- **The suggestion follows taste.** Two warm starts that picked the three
  darkest and the three brightest of the same nine presets get a different top
  suggestion on all eleven patches.
- **It can say why in one line,** from an exact decomposition of the gain: the
  PERFORM direction or structural family that carries it, and the pick forecast
  the app already shows ("59% · leaning").

## 1. What exists

### The genome and its grammar

A patch is a `PatchTree`: an amp envelope (`AmpEnv`) and one audio term
(`AudioNode`). The output stage (amp ADSR, VCA, limiter, stereo out) is added
by the compiler and is not a node, so it can be neither suggested nor removed.
The rack draws it as the amp plate, whose ⋯ menu is "Add a module at the
output".

The modules a hand can place are `NodeKind::ALL` in `auracle-grammar/src/mutate.rs`:

- **6 sources** (VCO, supersaw, noise, wavetable, pluck, formant) and
  **`Silence`**, the empty socket;
- **20 processors:** the mix, 14 one-input effects, and 5 more two-input kinds
  (ring mod, compressor, ducker, gate, vocoder);
- **modulation** (`ModKind`): 6 sources (LFO, envelope, S&H, follower, euclid,
  steps), 4 shapers that wrap a slot (quantize, slew, rectify, hold), and 6
  combiners (min, max, and, or, xor, switch).

A structural edit is a `StructOp`: `Replace`, `Insert`, `Delete`, `SetMod`,
`SwapMix`, and the explicit-fragment forms `ReplaceTree`, `InsertTree` and
`SetModTree`. `Insert` puts a processor into the wire between a node and its
parent: the old subtree becomes the new module's primary input. Every new
module arrives with audible defaults (`default_node`, now `default_fragment`),
and a two-input kind brings its own second branch: a triangle VCO for the mix,
a sine an octave up for the ring mod, a pluck as the key of the compressor,
ducker and gate, and a supersaw carrier with a formant modulator for the
vocoder (the carrier is now the chain; see "Found along the way"). A source
cannot go into a wire; it can only `Replace` an empty socket.

The ceilings are `MAX_SIZE` (24 modules), `MAX_DEPTH` (6, which is
`PRIOR_MAX_DEPTH` + 1) and `MAX_MOD_DEPTH` (3), all checked by
`validate_tree`.

**There is no empty tree.** The smallest patch is a lone `Silence` leaf. It
renders silence, the vet refuses it (`edit_vet_silent`), and so it has a
structural φ but no audio φ. A processor over it is silent too.

**The walk does not insert.** A refinement or offer walk is fugue's
single-site Metropolis kernel (`EvolutionChain::step`): it picks one trace
site at random, and a structural site (`#leaf`, `#src`, `#op`, `#mod`) is
redrawn from the tilted prior with the subtree below it regenerated ("subtree
regeneration MH", `prior.rs`). Putting one module into a wire and keeping the
chain, the move a player makes, is not one step of the walk.

### φ

φ is 18 audio features (`AudioFeatures::NAMES`, each tagged `:p2` for the
audition phrase) and 26 structural ones (`StructFeatures::NAMES`).

- **The audio half needs a render** of the whole phrase: centroid, rolloff,
  flatness, flux, the crest and attack, the tail, the bass fraction, the motion
  bands, and the rest.
- **The structural half needs none** (`struct_features`, microseconds): 19
  module counts, `mod_density`, `mod_depth_mean`, the three amp coordinates,
  `chain_balance` and `frac_sidechained`.

Most counts are **families**: `n_filter` is the filter, EQ and vocoder;
`n_drive` the wavefolder, distortion, bitcrusher and ring mod; `n_time` the
delay, granulator and pitch shifter; `n_mod_fx` the chorus, phaser, flanger,
tremolo and vibrato; `n_dynamics` the compressor, ducker and gate; `n_rand` the
S&H and the step sequencer; `n_mod_shape` the four shapers; `n_mod_logic` the
euclid and the six combiners. `n_mix` is not in φ. So structurally the model
cannot tell a distortion from a wavefolder, and where a module sits moves only
`chain_balance` and `frac_sidechained`.

### The taste model

- **The posterior** (`TastePosterior`, `auracle-taste/src/model.rs`) is `KEEP`
  (500) weighted draws of θ for up to `k_styles` (5) lenses, one more lens for
  every 20 observations. A sound's utility is `u = max_k θ_k · z`, with z its
  standardized φ.
- **After every pick** the draws are reweighted, and `Engine::belief` posts the
  ratings, the next generation's seeds and what it may replace (Plan-005 task
  9a). `Engine::ranked` sorts the pool by the posterior mean.
- **For any φ,** `Engine::explain_phi` gives the exact decomposition of its
  utility under its lens; it is what the guess above the rack shows
  (`edit_utility`, `edit_explain`). `TastePosterior::prob_prefers` is the pick
  forecast behind "59% · leaning".
- **Aimed offers** walk `π ∝ p_grammar · exp(β·(f + γ·s·ê·z))`
  (`TiltedFitness`), with γ = `AIM_GAMMA` (1.0) and up to `AIM_WALKS` (3)
  walks, `perform.rs`. ê is one of PERFORM's six named directions
  (`CONTROLS`: Bright, Snap, Motion, Body, Grit, Space), each with a low and a
  high word (dark and bright, bloom and snap, still and restless, thin and
  full, smooth and rough, close and far). A patch's controls are wired through
  its Jacobian `∂z/∂p` (`JACOBIAN_STEP` 0.08).
- **The walks' prior is tilted by taste** (`Engine::biased_prior`): each
  structural θ, shrunk by its own σ, multiplies its kinds' weights by
  `exp(η·θ)`, clamped to [0.25, 4], with η = `proposal_tilt` (0.6).

### What the app shows today

Nothing in the app proposes a module. Four surfaces answer "what if I place
this?", and none asks "what should I place?":

- **The next-step chip** (`renderNextStep`, `#nextstep`) is about the taste
  loop, not the patch: play, teach it, it refits, breed a generation, see the
  New group. It never names a module.
- **The module rail's lean and the spec dock** (`nbPaintTheta`, `specParts`)
  show θ of the module's family coordinate under the dominant style, with its
  σ, in five states: not measured, not fitted, too few sounds (under
  `NB_SUPPORT_MIN`, 5), a guess (|θ| under σ), and settled. They say when
  several modules share one coordinate.
- **The priced socket** (`socketPrice`), while a module is in hand, is the
  utility of one more of its count: θ divided by the standardizer's scale
  (`phi_scale`), under the bench's lens. It prices what, not where, and it
  refuses a placement that would take modules out. This is design (a), for one
  module the player already chose, on one coordinate.
- **The pre-placement audition** (`preview_op`, on ▶ or `PREVIEW_DWELL_MS`
  (600 ms) of dwell) renders the bench with the placement, on a clone, and
  plays its first `PREVIEW_SECONDS` (2 s). One is in flight at a time and a
  stale reply is dropped. This is design (b)'s render, for one candidate.

## 2. The empty patch, and what the model knows there

- **The first suggestion is a source.** In an empty patch the six sources in
  its socket are the only additions that make a sound. Leaving everything else
  out is a choice the census makes, not a measurement: a mix or a vocoder over
  the empty socket would sound, because each brings a source of its own. (A
  vocoder no longer does: its carrier is the chain, here the empty socket.)
- **There is no audio φ to compare against,** so an empty patch is compared
  with the pool's average sound. In standardized φ that is z = 0, where every
  lens rates 0, so a candidate's gain is its own rating and its forecast is
  "over your pool's average".
- **The amp envelope stays.** The census clears a patch by putting `Silence` at
  its root and keeping its amp, which is three structural coordinates. What
  clearing keeps is an open question below.
- **Before the warm start the model knows nothing.** There is no posterior, so
  there is nothing to suggest from but the grammar's own weights (the catalog
  below).
- **After the warm start it knows 18 picks:** three of nine presets, each
  beating the other six. That fits one lens (K = 1 + 18/20), a linear θ over
  all 44 coordinates. A player who starts a patch from nothing early on meets
  the model here, and it is where the designs differ most.
- **After 78 picks** (the warm start and 60 more) it has four lenses.

## 3. The designs

Each design ranks the same candidates: every edit the grammar allows that adds
a module and removes none. A processor at every wire (`Insert` at every node
key), a source in every empty socket (`Replace` of a `Silence` leaf), a
modulator in every empty mod slot and a shaper on every filled one (`SetMod`).
Each must pass `validate_tree`, and every module of the patch must survive it.
A preset has 54 to 119 such candidates.

- **(a) Structural only.** φ' is the patch's own audio φ beside the
  candidate's structural φ. For an empty patch the audio half is the pool's
  mean, which is z = 0. Rank by the posterior mean of `u(φ')`. No render. It is
  the priced socket, summed over every coordinate a placement moves, and run
  for every module at once.
- **(b) Render and score.** Render each candidate on the phrase
  (`featurize_memo`) and score its full φ against the patch's, over the
  posterior's draws of the gain `u(cand) − u(patch)`. Four criteria were
  measured: the mean; the mean plus one standard deviation (an optimistic,
  exploring bound); the mean minus one (a conservative bound, LCB); and the pick
  forecast `prob_prefers`. **b-full** renders every candidate. **b-out** renders
  only those at the output (`Insert` at `node`), in an empty socket, and on the
  root's mod slot: 6 for an empty patch, 19 to 29 for a preset.
- **(c) The walk's proposal.**
  - **c-tilt** ranks each candidate by its kind's probability under the prior
    the walks use, tilted by taste (`Engine::walk_context().prior`). No render.
    **The catalog** is the same ranking under the untilted prior: the module the
    grammar would most often draw, whoever is playing.
  - **c-walk** runs PERFORM's offer walk (`Engine::offer`, 20 steps) from the
    patch three times and reads off what its children added.
- **(d) Hybrid.** Rank by (a), render its top m, re-rank those by a (b)
  criterion. **d4** and **d8** shortlist from every candidate. **dout** is the
  same over b-out's candidates only: what a render crew leaves if it renders
  the output's candidates in (a)'s order and stops after m.

(a), (b) and (d) are functions of the tree, the posterior and the
standardizer, and draw no randomness. c-walk draws from the walk's stream and
gives a different answer per seed.

## 4. How it was measured

- **The session** is the app's: a pool of 40 from `shipped::boot`'s seed
  (20260928), the default config (`mcmc_samples` 10,000), refit every sixth pick
  as the app does (`FIT_EVERY`).
- **The patches:** the second preset of each family (Sub & Sparkle, Hornet,
  Tine, Detune Dream, Dub Echo, Deadfall, Ceiling); Detune Dream and Sub &
  Sparkle cleared; a lone saw with Detune Dream's amp; and a saw into a filter.
- **Two named warm starts** take the nine presets the app would show (one per
  family, then a second keys and a second pad; the app picks those two at
  random) and pick the three darkest (First Bass, Cathedral, Noise Wash) or the
  three brightest (Flint, Folded Lead, Bell Jar) by centroid. They test whether
  a suggestion follows taste.
- **Seven synthetic listeners** grade the designs. Listener 0 is
  `offer_census`'s; the others like or dislike three audio qualities and two
  structural ones, drawn at random. Each runs the warm start (picking its own
  three, by its true utility, without noise, which flatters the warm stage
  slightly), is graded there, then answers 60 more random pairs and is graded
  again. Grading reads the listener's true utility of the suggested patch: how
  often it would pick it over the patch (the logistic of the true gain), how
  often the gain is positive, and the regret against the best candidate, in the
  spread of its true utility over the pool.

That is 77 cases per stage. The gaps between rendered and unrendered designs
are large next to that; the gaps between (b)'s criteria are not, except LCB
against the mean at the warm start.

## 5. Cost

### The budget

PATCH is interactive. The interaction review's time budget
([`spec.html`](../interaction-2026-09/spec.html), "The time budget") gives a
structural edit's guess 1 s, and an offer a first result within 300 ms (a
spare) or progress, and 3 s to finish. A suggestion is closest to an offer, so
its budget here is:

- **at once:** "listening…" where the suggestion will appear;
- **within 3 s** of the patch settling: the suggestion;
- **on the engine worker, never more than one render at a time.** Long work
  there is cut into pieces that let gestures through between them
  ([`web-runtime.md`](../../architecture/web-runtime.md), "The worker's
  lanes"), so a gesture behind a suggestion waits at most one render: about
  230 ms in wasm, the wait the pre-placement audition already imposes.

### Measured

Render counts are exact. Times are CPU time of the thread doing the work,
because other jobs shared the machine: wall time ran 1.18 times CPU time for
the native renders and 1.53 times for the wasm ones. One render's CPU time:

| | Median | Quartiles | Source |
| --- | --- | --- | --- |
| Native | 154 ms | 129–220 ms | `census.txt`, 486 renders |
| wasm under node | 231 ms | 198–311 ms | `wasm.txt`, 243 renders |

wasm is about 1.5 times native. The two heaviest presets (Deadfall and
Ceiling) take 409 and 455 ms a render in wasm, about twice the median. The
wasm figure is measured through `preview_op`, which also keeps, levels and
trims the audio, so a φ-only render on the farm (`farm_render` without audio)
is somewhat cheaper.

Each design, for one patch: an empty one (Detune Dream or Sub & Sparkle,
cleared) and the seven presets, the native figures from `census.txt` under
the dark warm start and listener 0, the wasm b-out figures from `wasm.txt`:

| Design | Renders, empty / preset | Native CPU, empty / preset | wasm CPU, one thread, empty / preset |
| --- | --- | --- | --- |
| (a) structural, c-tilt | 0 / 0 | under 7 ms / under 7 ms | under 10 ms (derived) |
| (b) b-out | 6 / 19 to 29 | 0.4 to 0.5 s / 2.6 to 11.5 s | 0.8 s / 4.4 to 13.2 s (measured) |
| (d) d4 | 4 / 4 | 0.3 s / 0.5 to 1.6 s | 0.5 s / 0.8 to 1.8 s (derived) |
| (d) d8, dout8 | 6 / 7 to 8 | 0.5 s / 0.9 to 3.2 s | 0.8 s / 1.5 to 3.6 s (derived) |
| (c) c-walk, three walks | 71 to 74 / 49 to 56 | 10 to 13 s / 7 to 22 s | about 1.5 times native |

"Derived" multiplies the render count by that patch's wasm median.

### On the render farm

The farm's `farm_render` is stateless: it renders any tree on any phrase and
returns its features, which the engine takes into its memo with `memo_absorb`.
So candidates can render on the crew a generation already raises, and the
engine worker only scores them (milliseconds). The crew is `walkWidth()` in
`main.js`: the cores less two, at most 6, at most 2 on a device with 4 GB or
less, and at least 1 with two cores. Spread over a crew of W, a set of k
renders takes about ⌈k/W⌉ renders' time (derived, not measured):

| Design | Crew of 6 | Crew of 2 | Crew of 1 |
| --- | --- | --- | --- |
| b-out, empty patch (6) | 0.14 s | 0.4 s | 0.8 s |
| b-out, preset (19 to 29) | 0.9 to 2.3 s | 2.3 to 6.8 s | 4.4 to 13.2 s |
| dout8, preset | 0.4 to 0.9 s | 0.8 to 1.8 s | 1.5 to 3.6 s |

Not measured: a cold crew's start (`farm_want`, the spawn, the handshake),
which a generation already pays and which is reaped 60 s after its last job;
and the crew's renders contending with each other and with the audio thread.

### What fits

- **(a) and c-tilt** fit anywhere, even the `now` lane.
- **b-out** fits only on a crew of five or six: on six it finishes in 0.9 to
  2.3 s for these presets. On the engine worker alone it takes 4 to 13 s, which
  no lane can hide.
- **dout8** (the output's candidates in (a)'s order, the first eight) fits a
  crew of two in 0.8 to 1.8 s, and a crew of one or the engine worker alone,
  at one render a piece, in 1.5 to 3.6 s (the two heaviest presets run past
  3 s).
- **An empty patch** fits everywhere: 6 renders.
- **c-walk** does not fit: each walk renders about 18 proposals in turn.

## 6. Quality

### Against the listeners' true taste

Seven listeners on eleven patches (`census.txt`, "The listeners' truth").
"Pick" is how often the listener would pick the patch with the suggested
module over the patch, "helps" how often its true gain is positive, and
"regret" how far below the best candidate the suggestion falls, in the
listener's spread of ratings over the pool.

| Design | Warm start: pick | helps | regret | 78 picks: pick | helps | regret |
| --- | --- | --- | --- | --- | --- | --- |
| A random candidate | 51.0% | 44% | 0.98 | 51.0% | 44% | 0.98 |
| The catalog, and c-tilt | 53.7% | 65% | 0.94 | 53.7% | 65% | 0.94 |
| (a) structural | 55.5% | 42% | 0.84 | 53.5% | 52% | 0.90 |
| (d) d8, by LCB | 59.0% | 55% | 0.80 | 68.3% | 74% | 0.53 |
| (b) b-full, by the mean | 60.3% | 61% | 0.73 | 66.4% | 74% | 0.54 |
| (b) b-out, by the mean | 61.1% | 62% | 0.71 | 65.9% | 71% | 0.60 |
| (b) b-out, by the forecast | 59.5% | 60% | 0.77 | 67.5% | 75% | 0.55 |
| (b) b-out, optimistic bound | 63.9% | 68% | 0.66 | 62.2% | 68% | 0.71 |
| (b) b-full, by LCB | 64.4% | 68% | 0.68 | 68.4% | 75% | 0.50 |
| **(b) b-out, by LCB** | **66.0%** | **71%** | **0.66** | **70.4%** | **78%** | **0.49** |
| (d) dout8, by LCB | 65.9% | 70% | 0.66 | 69.4% | 78% | 0.55 |
| (d) dout4, by LCB | 60.9% | 60% | 0.75 | 66.8% | 70% | 0.60 |
| The true best candidate | 88.0% | 99% | 0 | 88.0% | 99% | 0 |

What this says:

- **Rendering is what makes a suggestion worth taking.** Every ranking of (b)
  is picked 60% to 66% of the time at the warm start and 62% to 70% after 78
  picks, against 51% for random and 54% for the catalog. The structural design
  helps less often than random at the warm start (42% against 44%): the half
  of φ it cannot see is where most of the listeners' taste is.
- **The output is enough.** On the presets b-out renders about a third of
  b-full's candidates (181 of 526) and does as well or better: the deeper
  sockets add candidates the model rates highly by extrapolating, not ones the
  listener likes more.
- **A lower bound is the safe criterion.** It is best or tied at both stages.
  The optimistic bound helps at the warm start and costs after teaching; the
  mean and the forecast trail the lower bound at the warm start by 5 to 7
  points.
- **The hybrid fails when it matters most.** d8 is close to b-full after 78
  picks, but at the warm start (a)'s shortlist misses b-full's best a quarter of
  the time (recall at 8 is 0.73), and d8 drops to 59%. The warm start is when
  most players first meet the empty patch.
- **Stopping early in (a)'s order is safe at eight.** dout8 matches b-out at
  both stages, and dout4 does not.
- **The model is still far from the truth.** The listeners' own best candidate
  is picked 88% of the time; the best design reaches 70%.

### Does it follow taste?

The dark and bright warm starts, over the same eleven patches
(`census.txt`, "Taste"):

| Design | Top suggestion differs | Overlap of the top three | Kinds suggested, dark / bright |
| --- | --- | --- | --- |
| (b) b-out, by LCB | 11 of 11 | 0.07 | 5 / 4 |
| (b) b-full, by the mean | 11 of 11 | 0.04 | 5 / 5 |
| (a) structural | 11 of 11 | 0.20 | 3 / 2 |
| c-tilt | 0 of 11 | 0.91 | 2 / 2 |
| The catalog | 0 of 11 | 1.00 | 2 / 2 |

The tilted walk proposal and the catalog suggest the same thing to both: a
filter at the output on every patch with a source, a VCO in every empty one.
The tilt does move the walks' kind weights (the dark and bright c-tilt
rankings correlate at 0.99, not 1), but it is shrunk by σ and clamped to
[0.25, 4], and it never moves the filter's lead in the grammar's weights.
**A walk's proposal is a catalog.**

The rendered design follows taste, and repeats itself within one: after the
dark warm start b-out suggests a filter at the output on six of the eleven
patches, and after the bright one a bitcrusher on seven. Both are honest:
each of the three dark picks has a filter, and two of the bright ones (Folded
Lead and Bell Jar) have a wavefolder, which lifts the whole drive family. A
skip has to account for it (see below).

### The structural design as a shortlist

How often b-full's best (by the forecast) is in (a)'s top m (`census.txt`,
"Recall"):

| m | 1 | 2 | 4 | 8 | 16 |
| --- | --- | --- | --- | --- | --- |
| Warm start (7 listeners) | 0.26 | 0.39 | 0.65 | 0.73 | 0.82 |
| After 78 picks | 0.16 | 0.29 | 0.57 | 0.69 | 0.79 |

### What it would say

Every suggestion can say why in one line, and truthfully, because each part
of the line is something the engine computes:

- **the direction:** the gain under the candidate's lens is exactly
  `θ · (z_cand − z_patch)`, so it splits by coordinate. Its largest part is
  either one of PERFORM's six directions (its word is the control's low or high
  word, from the measured Δz along it) or one structural coordinate;
- **the lean:** that part is positive because θ and the move agree in sign,
  which is what "as your picks lean" claims;
- **the forecast:** `prob_prefers(z_cand, z_patch)` with the app's sure word
  (`sureWord` in `apps/web/words.js`: under 5 points from even, a hunch; under
  20, leaning; else fairly sure).

Lines the census printed for b-out by LCB (`census.txt`), raw:

- dark, Sub & Sparkle: "filter at the output: it moves toward dark (−1.06σ),
  as your picks lean · 59% over the patch · leaning"
- dark, Hornet: "reverb at the output: it moves toward still (−1.98σ), as your
  picks lean · 67% over the patch · leaning"
- bright, Hornet: "bitcrush at the output: your picks lean toward more drive ·
  60% over the patch · leaning"
- bright, Detune Dream cleared: "noise in node: it moves toward rough
  (+4.06σ), as your picks lean · 73% over your pool's average · fairly sure"
- listener 0, Detune Dream: "gate at the output: your picks lean toward less
  chain_balance · 77% over the patch · fairly sure"

In the model's voice (`www/brand/voice.md`: lowercase, third person, a
percentage always with its word), the first might read as below, where 59% is
the forecast that you'd pick the patch with the filter over the patch as it
is. The copy is the maintainer's to set.

> *with a filter here it leans darker, as your picks do · 59% · leaning*

Three gaps before it can ship:

- **Structural coordinates need player words.** The control words exist; the
  family words mostly do too (drive, filter, reverb, time). `chain_balance`,
  `frac_sidechained`, `mod_density` and `mod_depth_mean` have none, and the
  last example above cannot be shown as it is.
- **The ranking and the number differ.** It ranks by the lower bound and shows
  the forecast, so a lower-ranked suggestion can show a higher percentage. Both
  are true; the line has to say which is which, or show the bound.
- **A far source can lead.** After the bright warm start the first suggestion
  in an empty patch is noise, 4σ rougher than the pool's average sound,
  "fairly sure", from 18 picks. That is the posterior extrapolating, and the
  lower bound does not stop it. A limit on how far a suggestion may sit from
  the pool is a refinement this note did not measure.

## 7. Edge cases

- **The output module.** "At the output" means `Insert` at `node`, just before
  the amp. Effects there sit before the amp envelope, so a reverb's tail is cut
  at note-off (`insert_for`'s doc in `perform.rs`). The rendered designs
  measure that; the structural design reads θ on `n_reverb` instead. Both
  show in the census's lines. The dark profile's reverb on Hornet "moves toward
  still": measured on the render, a reverb there smooths the motion more than
  it adds space. Listener 6's reverb says "your picks lean toward more reverb",
  the structural lean, honestly named.
- **The grammar's ceiling.** A saw under five filters is depth 6
  (`MAX_DEPTH`): no processor can be inserted anywhere (0 of the 156 edits
  tried), and only the 36 modulator edits remain. A tree of 23 modules has 322
  processor edits left, and at 24 (`MAX_SIZE`) it has none. The suggestion then
  says why: nothing more fits, and a module has to come out first. Mod slots
  have their own ceiling (`MAX_MOD_DEPTH`).
- **Skip.** A skip removes that suggestion, and the next one shows. Two
  facts shape what a skip should mean:
  - the model cannot tell a family apart: one coordinate covers the wavefolder,
    distortion, bitcrusher and ring mod. After the bright warm start the top
    suggestion is in that family on nine of the eleven patches, so "fold" after
    a skipped "bitcrush" would be the same suggestion again as far as taste
    goes. A skip should remove the family at that socket;
  - the ranking is a pure function of the tree and the posterior, so a skip has
    to be remembered outside it, keyed by something that survives other edits:
    the socket (the output itself, or the uid of the node it sits above, as
    `Uid` outlives structural edits) and the family.

  How long it lasts is open below. A skip is not evidence: it is logged, as
  reverts are (`log_edit_event`), and stays out of the likelihood, for the same
  reason (it is confounded with curiosity).
- **Undo.** Taking a suggestion is an ordinary structural edit through the
  bench lane, so ⌘Z undoes it (ADR-009's one undo). The tree then returns, and
  the ranking with it, so the suggestion just undone would come straight back.
  Undoing a taken suggestion should count as skipping it.
- **Determinism.** (a), (b) and (d) need no random stream (ADR-001). A walk
  would need its own.
- **AUDIO IN** ([RFC-008](../../proposals/008-audio-in.md),
  [ADR-015](../../decisions/015-audio-in.md)), when it exists:
  - **never suggested.** It asks for a device and a permission, and a
    suggestion must not;
  - **its patches suggest like any other:** each AUDIO IN node renders with its
    audition clip, so the rendered designs need no change;
  - **Track and Capture** are suggested only where an AUDIO IN already
    feeds the socket;
  - its kind joins the structural counts, which is a φ change
    (`make revalidate`).
- **Edits invalidate the renders,** a knob turn included, because every
  candidate contains the patch. Recomputing is a full set of renders, so it
  should wait for a structural edit, a refit, or the player asking, not follow
  every knob.

## 8. Recommendation

**b-out ranked by LCB, rendered on the render farm, in (a)'s order, within
the 3 s budget,** with dout8 as the floor when the crew is small or absent:

- **Quality:** the best design measured at both stages: 66% pick and 71%
  helps at the warm start, 70% and 78% after 78 picks, against 51% and 44%
  for a random module and 54% and 65% for the catalog.
- **Cost:** 6 renders for an empty patch (0.8 s of wasm CPU on one thread,
  about 0.15 s on a crew of six) and 19 to 29 for a preset (4.4 to 13.2 s on
  one thread, about 0.9 to 2.3 s on a crew of six, derived). On a crew of one
  or two, or with none, it renders the output's candidates in (a)'s order and
  ranks what it has after eight (dout8: 66% and 69% pick, 0.8 to 3.6 s).
- **Never on the engine worker in bulk.** The worker scores (milliseconds) and
  absorbs renders the crew made; it never holds the floor for a render set.
- **One caveat travels with it.** The lower bound does not stop the model
  extrapolating from a few picks: after the bright warm start the first
  suggestion in an empty patch is noise, 4σ rougher than the pool's average,
  "fairly sure", from 18 picks. Whether to keep suggestions within the range of
  sounds the player has heard is open (below), and unmeasured.

### What task 9(d) would build

The engine (`auracle-session`, a new `suggest.rs`), pure functions of the tree,
the posterior and the memo:

- `suggest_candidates(tree) -> Vec<SuggestCandidate>`: the output's candidates
  (`Insert` at `node` for every processor kind that keeps the chain, `SetMod`
  on the root's slot, `Replace` in every empty socket), each validated and
  adding only, with its kind, family and key;
- `Engine::suggest_order(tree, &mut candidates)`: (a)'s order, so a crew that
  stops early has rendered the likeliest;
- `Engine::rank_suggestions(tree, candidates, skipped) -> Vec<Suggestion>`: for
  each candidate the memo holds, the gain's mean, its LCB and the forecast;
  skipped families at their socket and silent candidates out; best first. Each
  `Suggestion` carries its `StructOp`, kind, family, socket, LCB, forecast, and
  its why (the direction or coordinate, the word, how far it moved, the lens).

The bindings (`auracle-wasm`), structures crossing as JSON serialized from
their types (ADR-002), each with its caller in `worker.js` and the smoke test
proving the binary exports it (`crates/auracle-wasm/AGENTS.md`), then
`make wasm`:

- `suggest_jobs() -> String`: the bench's candidates in render order, as
  `[{op, tree}]`, or a reason (no taste yet, at the ceiling);
- the farm's existing `farm_render` on the crew, and the engine's existing
  `memo_absorb` for each result;
- `suggest_rank(skipped_json) -> String`: the ranked list from what the memo
  holds, with how many candidates were rendered of how many.

The worker (`worker.js`): a `suggest` request with a token, in the `later` lane.
It hands the jobs to the crew (raising one if needed, as a generation does),
absorbs results as they land, and posts `suggestion` once all are in or 3 s
have passed. A bench edit's new token makes an old reply stale, as the
pre-placement audition already does. With no crew it renders dout8 itself with
the existing `memo_render`, one render a piece, as PERFORM's measurement
already does, so a gesture waits at most one render.

### What task 7 would build

Task 7 needs none of the engine work:

- **an empty patch:** clear sets the root to `Silence`, keeping the amp, as an
  undoable edit (`edit_set_tree_apply`);
- **remove with undo:** `Delete` exists;
- **the place a suggestion will sit,** and its skip state.

With 9(d), PATCH would show the suggestion **at its socket**:

- the suggested module as a dashed amber plate, the convention for a guess,
  with its line in the model's voice and the forecast with its word;
- TRY places it, SKIP shows the next, and both are reachable without a pointer;
- before the first fit, no suggestion, and the socket says the model needs a
  few picks first;
- while the renders run, the plate says listening… and draws no guess
  (ADR-012: nothing is drawn that the engine has not produced).

## 9. Open for the maintainer

*Decided (2026-10-01), by the maintainer:*

- **The design:** the recommendation (section 8). The output's candidates are
  rendered on the farm and ranked by the lower bound; with no farm, dout8;
  nothing before the warm start (item 3). No trust region for now (item 7):
  the lower bound is the guard.
- **The word (item 1):** the model's guess, so no new word. The chip reads
  GUESS · FILTER, and its reason is the model's italic line, in the third
  person, like every other guess. "Suggestion" stays on the Not list.
- **A skip (item 4):** keeps that module's family away from that socket for
  this patch. Undoing a taken guess counts as a skip.
- **Taken as recommended:** taking a guess is not evidence (item 5); it is
  recomputed on structural edits, refits and request (item 6); clearing keeps
  the amp envelope (item 2); deeper sockets on request only (item 9).
- **Still open:** tuning the new module's knobs along the taste (item 8),
  until it is measured.

The questions as they were put:

1. **The word.** The word table in `www/brand/voice.md` lists "suggestion"
   under Not for an offer. The RFC says the model "suggests". A suggestion
   needs its own row, and its silk label (TRY, NEXT, or another).
2. **What clearing keeps.** The amp envelope (assumed here), a neutral one, or
   the last cleared patch's? It is three structural coordinates, and it changes
   the first suggestion.
3. **Before the warm start:** no suggestion (recommended), or the catalog
   labeled as not a guess.
4. **How long a skip lasts:** until the patch changes structure, until the next
   refit, or for the session.
5. **Whether taking a suggestion is evidence.** PERFORM counts a take or pass
   heard for a second as a pick. Here the recommendation is no: the existing
   keep-as-new comparison already records what the player thought of the edit.
6. **When to recompute:** on structural edits, refits and request only
   (recommended), or after every settle.
7. **A trust region:** whether to keep suggestions within the pool's range of
   φ, so a source 4σ from anything heard cannot lead. Not measured.
8. **Tuning the new module's knobs** along the taste with the Jacobian
   (`∂z/∂p · θ`) before it is offered: two renders per knob more, and not
   measured.
9. **Deeper sockets.** b-full's extra candidates did not help here; a socket
   the player points at could still be ranked on request, as the audition
   renders one today.

## Found along the way

- **`StructOp::Insert` with a vocoder dropped the chain** it landed on:
  `default_node` built the vocoder's carrier and modulator fresh and ignored
  the input it was handed. `InsertTree`, which the app's insertions and
  PERFORM's grafts use, kept the chain as the carrier. It was not fixed here,
  and the census left such edits out. **Fixed since,** in PR #90: `Insert` and
  `Replace` (which had the same fault) seat the kind's default module with
  `graft`, the splice `InsertTree` uses, so the chain is the vocoder's carrier
  and keeps every module. A vocoder at each wire, where the size and depth
  limits allow, now qualifies as a candidate; the tables above were measured
  before the fix, without one.
- **PERFORM's graft is a hand-made suggestion.** `insert_for` puts a neutral EQ
  on the output so Bright and Body have something to turn. The same ranking
  with the aimed criterion (`γ·s·ê·Δz` in place of taste) would measure which
  module a search control needs, rather than naming one.
