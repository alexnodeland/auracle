# Directions the design has not raised

<p class="lede">The counterpart to the open questions. An open question is a
decision this design put on the table and has not settled; what follows was
never on the table. Written down so that <em>not considered</em> and
<em>considered and rejected</em> stop looking alike from the outside.</p>

Everything here came out of a review pass in August 2026 that read the books and
the crates and asked what the architecture already supports that nobody has
argued about. **Nothing on this page has been decided**, and several entries
name the reason they might be wrong.

## Why this is a fourth register

| Page | Holds | The state it records |
|---|---|---|
| [Decisions log](./decisions.md) | A choice, and what it beat | Settled |
| [Milestones](./milestones.md) | A deliverable and the gate that closed it | Done, or not |
| [Open questions](./open-questions.md) | Questions this design raised | Unsettled, and named |
| **This page** | Possibilities this design never raised | Unexamined |

The rule for leaving this page is what keeps it from becoming a wishlist. An
entry **graduates into [open questions](./open-questions.md)** as soon as
someone can state the measurement that would settle it, and into the
[decisions log](./decisions.md) once it is made. An entry that can be stated as
neither is speculation and should be deleted rather than kept.

Each entry therefore names three things: the machinery that **already exists**,
what stands in the way, and what would settle it. Most of these are one shell
or one substitution away from working, which is the reason they are worth a
page rather than an issue.

| # | Direction | Leans on |
|---|---|---|
| [1](#1-the-register-is-gated-on-evidence-that-cannot-arrive) | An evidence path for the questions that need real sessions | `Profile` = log + standardizer |
| [2](#2-target-directed-search-make-it-sound-like-this) | Search toward a **reference sound** rather than toward a fitted taste | The target consumes $u$ as a black box |
| [3](#3-declared-context-and-the-circularity-it-dissolves) | **Declared** context, which dissolves the per-style-phrase loop | `presets::CATEGORIES`, `SessionConfig::phrase` |
| [4](#4-radio-is-a-throughput-fix-not-the-third-mode) | Radio as the fix for observation *volume*, not as the third mode | The keep/kill likelihood, already fitted |
| [5](#5-the-bank-does-not-leave-the-browser) | A multisample export, as the cheap exit into a DAW | Deterministic headless rendering |
| [6](#6-the-machine-loop-stops-when-the-tab-closes) | Refinement that runs while nobody is watching | The native harnesses, the render farm |
| [7](#7-explanation-stops-at-the-coefficients) | **Counterfactual** explanation — the edit with the largest predicted gain | Trace addresses, the structural edit ops |
| [8](#8-the-maps-axes-could-be-learned-rather-than-principal) | A map whose axes are style lenses rather than principal components | `TasteMap`, and its own `converged` flag |
| [9](#9-auracle-taste-is-domain-independent-and-welded-to-a-synth) | The taste crate as a general preference-learning library | φ enters by name, and nothing else is audio |
| [10](#10-the-measurements-are-a-result-and-results-travel) | The measurements as published results | The changelog already holds them |

---

## 1. The register is gated on evidence that cannot arrive

The fit-cost entry in [open questions](./open-questions.md) says this in as many
words: it is "open for want of *data* rather than for want of an instrument",
and `Engine::style_shares` was built to collect exactly the rows that bear on it
— the ones where `k == k_styles`. Behind it sits the question the K cap is a
proxy for, which is whether a listener ever uses five lenses at all.

Those rows are on other people's machines, and there is no path off them.
[Persistence](../persistence.md#where-the-browser-keeps-it) is unambiguous:
IndexedDB under the page's origin, no account, no server, nothing transmitted,
and the only backup that exists is a profile the user exported by hand.

So a project whose method is *close the question by measuring it* has a class of
questions it cannot close. That is a structural fact about the architecture, not
a backlog item, and it is the single most consequential thing on this page.

**The mechanism already exists.** A [`Profile`](../persistence.md) is the log
plus its standardizer — self-contained, portable, raw $\varphi$ stored by name,
already exposed as *⋯ → Save taste profile*. What is missing is a
**destination**, not a format.

**What this must not become.** The decisions log rejects implicit signals, and
the guide is explicit that listen time, replays and hovers are not recorded.
That decision is about what the *model* is allowed to learn from, and it should
survive this entry untouched. The property worth keeping is **nothing leaves
without a deliberate gesture at a file the user can read** — which an opt-in
donation of an exported profile satisfies and telemetry does not. A donation
path that is a button plus a place to send the file (an issue attachment is
sufficient; no server is required) keeps every word of
[persistence](../persistence.md) true.

**What it would close, and what it opens.** Directly: the K-cap question, whose
evidence is the rows where `k == k_styles`. Indirectly, and worth more, a
**population prior on $\theta$**. Cold start today is 40 coordinates starting
from a prior mean of zero, against which the [three-pick warm
start](../../docs/teaching.html#the-warm-start) buys 18 observations in thirty
seconds. A hierarchical prior fitted across donated profiles is the only
available lever that moves the *starting point* rather than the rate — and
because the stack underneath is a probabilistic programming language, a
hierarchical prior is a model that can be *written* rather than an inference
engine that has to be built.

**Two reasons it might be wrong, both worth stating before it is built.** A
donated corpus is self-selected — it answers *how many lenses does an
enthusiast use*, which is not the question. And a population prior asserts that
other listeners' preferences are evidence about yours, which is close to the
assumption the [max-of-experts design](../taste/utility.md) already refused at
the level of one listener's islands; refusing it within a person and accepting
it across people needs an argument, not an analogy.

**What would settle it.** Cross-validation on donated profiles: does a
population-prior warm start beat the three-pick warm start on held-out duels
over a session's first hundred observations? That is an offline measurement
with no live user in it, and it can be run the day a corpus exists.

## 2. Target-directed search: "make it sound like this"

Every path through this system learns a utility. But the
[Boltzmann target](../search/target.md) consumes $u$ as a black box:

$$\pi(x) \;\propto\; p_{\text{grammar}}(x)\cdot\exp\!\big(\beta\, u(x)\big)$$

Nothing in the search requires $u$ to be *fitted*. Substituting a distance to a
reference vector,

$$u_{\text{ref}}(x) \;=\; -\lVert \varphi(x) - \varphi_{\text{ref}} \rVert_W$$

turns the whole apparatus — MH in trace space, reversible jump, vetting, the
pool, and [locks as exact conditional
refinement](../search/locks.md) — into a *matcher*, with no new algorithm.
Locks are what make it more than a novelty: *match this, and leave my filter
section alone* is a conditional match, which is a thing the machinery already
does exactly rather than heuristically.

This is the most common real sound-design task, and it is the one shape of it
the instrument cannot express today.

**The distance can only be over the audio half, and that is a feature.** A
recording a user brings has no term, so it has no
[φ_struct](../features/structural.md) at all — 25 of the 40 coordinates are
simply not defined for it, and $W$ has to zero them. That is the right
behaviour rather than a limitation: *sound like this, by whatever means*, with
the grammar prior left to supply the parsimony that keeps the means sane. A
match that also scored structure would be asking the search to reproduce a
topology the reference never had.

**What actually stands in the way is φ_audio's stimulus dependence.** $\varphi$
is measured under the [standard phrase](../audition/phrase.md); the
[`:p2` tag](../audition/phrase.md#the-p2-stimulus-tag) exists precisely because
a coordinate's meaning is relative to the stimulus that produced it, and a
reference clip is not that phrase. Twelve of the fifteen
[φ_audio](../features/audio.md) coordinates are whole-phrase statistics and
survive the mismatch with a caveat about pitch content; the three
**segment-local** ones (`held_centroid_std`, `high_ratio`,
`chord_flatness_delta`) find their roles by property — first note, highest
note, first chord — and arbitrary audio may have none of them. The imputation
is already honest, since an absent coordinate reads as *no evidence*, but here
the absence lands on the axes describing timbral motion and register, which is
where a listener's "sounds like" often lives.

The honest form is therefore a **partial** match with the matched subset named
on screen, rather than a match that quietly scores twelve coordinates and calls
it a likeness.

**What would settle it.** No human is needed for the first pass: hold out a
patch from the prior, treat its $\varphi$ as the reference, and measure how far
refinement closes the distance against a random-restart baseline over paired
seeds — the same shape as the existing `search_health` measurements. If that
fails, the idea is dead before any UI is drawn.

## 3. Declared context, and the circularity it dissolves

The [per-style audition phrase](./open-questions.md) entry is blocked on a
loop, and the entry states it precisely: a style is *discovered* — an inference
from $\varphi$ — and $\varphi$ is measured under a phrase, so a phrase chosen
by style makes the stimulus depend on an inference that depends on the
stimulus.

That loop is a property of **discovery**, not of per-context stimulus. It
disappears entirely if the context is **declared**: *I am hunting a bass
tonight* is a statement, not an inference, and a phrase chosen by it depends on
nothing that was measured. Comparability holds by the argument the entry
already makes — the phrase is a property of the `SessionConfig`, so everything
in a pool is auditioned under one stimulus and duels stay apples-to-apples.

The declared context also already exists, half-built and discarded at the model
boundary: `presets::CATEGORIES` is a seven-way family label (`bass`, `lead`,
`keys`, `pad`, `texture`, `perc`, `weird`) carried by all 61 presets, used for
copy and for spanning the [warm start](../../docs/teaching.html#the-warm-start),
and read by nothing downstream.

**What it costs.** The utility becomes $u(x \mid c)$, and there are two shapes
for that. Appending a context block to $\varphi$ keeps the model linear and
lets a single coefficient mean *brightness matters more to me in a lead*; a
per-context set of lens weights is the heavier design, multiplying the
coefficients that must be paid for by evidence, which is the resource the cold
start is already short of. The first is the one that fits the model that
exists.

The cost that will actually bite is historical: an observation becomes a
judgement about a *(patch, context)* pair, and every vote already in every log
has no context. Under the [by-name imputation
rule](../persistence.md#names-not-indices) that reads as the standardizer's
mean, which is honest and weak — the correct behaviour, and still a real
dilution of a user's history the first time it ships.

**This does not close the open question; it reroutes it.** Per-*style* phrases
stay exactly as open as they are. What changes is that the per-*context* half
of the value — a bassline for basses, a chord swell for pads — becomes
reachable without answering the circularity at all.

## 4. Radio is a throughput fix, not the third mode

[Grid and radio remain open](./milestones.md), and keep/kill is a fitted
likelihood with no surface. The usual reading is *two modes left to build*.
There is a sharper one.

The two unbuilt modes are the ones that produce observations in **bulk** — grid
judges a generation at a time, radio never stops — and radio in particular
produces them at the rate of *listening* rather than at the rate of deciding. A
duel costs concentrated attention and a session yields tens of them. That
difference is not a matter of degree for this model, because several of its
mechanisms are denominated in observation counts:

- **Recency** weights a vote $h$ places back by $w_h = 0.5^{\,h/150}$. A user
  whose entire history is a few hundred observations lives inside the first
  half-life, and forgetting — built, documented and
  [figured](../../docs/teaching.html#recency) — never does anything.
- **K grows with evidence**, so the multi-modal taste the
  [max-of-experts design](../taste/utility.md) exists to represent needs enough
  log to discover a second lens at all.
- **[Calibration](../taste/calibration.md)** is a Brier skill score against
  0.5, plus random check duels. Its error bars are a sample-size problem.

So radio is not the third mode. It is what makes the model's own dynamics
*observable*, and it should be ranked on that rather than on effort.

**The counter-argument, which is real.** Keep/kill is the weakest signal per
observation, and radio would flood the log with it. Worse, recency is
denominated in **log positions**, so a flood of cheap observations pushes a
considered duel past the half-life faster in wall-clock terms — the unit
silently changes meaning when the observation *rate* changes. If radio ships,
the recency weight probably has to become per-signal-kind, or be denominated in
time rather than in positions. That is a modelling decision hiding inside a UI
mode, and finding it before building is most of the value of writing this entry
down.

## 5. The bank does not leave the browser

What comes out today is a WAV of your own playing, a patch file, and a profile.
Everything a musician does next happens in a DAW. [Lineage](./lineage.md) names
the intended shells — `nih-plug` VST3/CLAP, then AUv3 — and neither is started.

There is a cheaper exit that does not wait on a plugin, and the
[determinism contract](../runtime.md) is what makes it nearly free: $\varphi$ —
and the render it comes from — is a pure function of $(\text{term},
\text{spec})$, which is the property `render_key` and `RENDER_EPOCH` already
assert. A **multisample export** — a grid of offline renders across pitch and
velocity, plus an SFZ mapping, which is a plain-text format — puts any patch in
the bank into every DAW that loads a sampler, today, with no audio-thread work
and no shell.

A second, smaller one: the genome *is* a term with a compiler, so *export this
patch as quiver source* costs a printer and makes a patch inspectable, diffable
and portable to a native host.

**What it does not solve, and the entry should not pretend otherwise.** A
multisample is a snapshot of an instrument, not the instrument. Per-note
modulation, the arpeggiator, anything that responds to how it is played, and
the [live parameter handles](../architecture/addresses.md) that make the rack
worth touching do not survive sampling. This is a bridge that gets patches used
while the real answer is built, and its value is entirely in being available
years earlier.

## 6. The machine loop stops when the tab closes

The [two-loop architecture](../architecture/two-loops.md) describes a
machine-paced loop that evaluates thousands of candidates against what it has
learned. It does that only while a page is open and a person is sitting there.

Every piece of an offline mode exists. The harnesses (`search_health`,
`learn_synthetic`, `closed_loop_sweep`) run the real grammar → render → vet →
featurize pipeline natively; the [render farm](../runtime.md#the-render-farm)
already parallelizes; a `Profile` already round-trips. *Leave it running and
come back to a pool that has been refined for an hour* needs a shell, not an
algorithm.

Two things are worth saying before anyone builds it. The pool would be refined
against a $\theta$ that is stale by exactly as long as you were away — fine,
because $\theta$ moves slower than the pool does, but it should be stated
rather than discovered. And a browser tab cannot do this: background timers are
throttled and the tab may simply be discarded. So this is a **native**
direction, and it is the first argument for a non-web shell that is not a
plugin.

## 7. Explanation stops at the coefficients

The TASTE view reports the [map](../../docs/views/taste.html#map), the
[style lenses](../../docs/views/taste.html#styles),
[$\theta$ with credible intervals](../../docs/views/taste.html#directions) and
the calibration diagram. That is already more than the genre offers, and it is
*descriptive*: it says what the model believes, not what to do about this
patch.

The next rung is **counterfactual**, and [trace
addresses](../architecture/addresses.md) make it close to free. Enumerate the
[structural edit ops](../genome/edits.md) at every node plus a knob write at
every parameter site, score each result with the fitted $u$, and report the
argmax: *this patch sits 0.8 below your best; the single largest predicted gain
is `node/0#cut` +0.3*. Every ingredient — the address scheme, the ops, the
utility, the compiler that guarantees the result is playable — is built and
tested.

**Two caveats that decide whether it ships honestly.** $u$ is a *fitted*
quantity with uncertainty, so an argmax over it is an argmax over a surrogate —
the same move the [`RefineKeep::Best` measurement](./open-questions.md) found to
be lower-variance rather than better. A suggestion without its interval
overclaims in exactly the way this project's TRUST surfaces exist to prevent.
And a confidently-signed suggestion that is wrong is the failure a user
notices and does not forgive, which argues for reporting the top few with
intervals rather than one imperative.

This is also the concrete cash-out of the README's claim against
star-a-generation synths — that they cannot tell you *why*. Coefficients are an
answer to that. A named edit is the answer a person asked for.

## 8. The map's axes could be learned rather than principal

The [taste map](../../docs/views/taste.html) projects with PCA over standardized
$\varphi$ — top two principal axes by power iteration — and `TasteMap` carries
a `converged: [bool; 2]` flag *because the top two eigenvalues can near-tie*.
The doc comment names the reason: the brightness cluster is three genuine
measurements of one perceptual thing. The map is already honest about being
potentially unstable.

An alternative is to project onto **learned** directions instead: the top two
style lens vectors $\theta_k$ (orthogonalized), or utility against posterior
standard deviation. Those axes are stable against the eigenvalue tie by
construction, and — the part that matters for a surface inviting someone to
recognise territory — they are *nameable*: "more like your style 1" is a thing
a person can hold, and "the first principal axis of a standardized feature
matrix" is not.

**Not obviously better, and the reason is worth keeping.** A learned axis moves
when the model does, so the territory changes meaning between fits. That is a
different instability, moved from the solver to the model — arguably worse for
a map, arguably better because it is *explicable* and can be announced.

**What would settle it.** Measure the rotation of each projection's axes
between consecutive fits over a session and compare. That is a small
instrumentation on top of `TasteMap` and a number, not an opinion.

## 9. `auracle-taste` is domain-independent and welded to a synth

Strip the words. The crate learns a scalar utility over $\R^d$ from three
observation kinds — pairwise comparisons, ordinal ratings against fitted
cutpoints, and a threshold decision — with a max-of-experts form for
multi-modal preference, recency weighting, a calibration report, and a
[synthetic-user harness](./milestones.md#the-synthetic-user-and-why-m3-was-a-gate)
that falsifies the whole thing headlessly.

None of that is about audio. The only audio-shaped thing is $\varphi$, and it
enters **by name** through `FitSet::build` — the same property that makes
profiles survive a feature-set change makes the crate indifferent to what the
features measure. Fonts, colour ramps, shader parameters, recipes,
hyperparameters: the model does not know the difference.

**The reason to wait is real and should be the stated one.** Extraction is an
API commitment, and the project is 0.x with a save format that still moves;
publishing a crate whose serialization is not settled buys a migration
obligation to strangers. That is a *timing* argument, which is a much better
reason than "no time", and it means the entry has a trigger: revisit at 1.0, or
when a second consumer actually exists.

## 10. The measurements are a result, and results travel

The [acquisition](../search/acquisition.md) entry is a well-powered null. BALD
ties uniform random pairing on cosine similarity to $\theta^*$, on rank
correlation and on excess nats across three regimes at 20 CRN-paired seeds,
while beating dueling
Thompson (t = 2.9 to 6.9) throughout. The literature on preference elicitation
is full of acquisition functions and nearly empty of properly paired nulls, and
a null is the result a practitioner most needs and least often finds.

The [fused brightness prior](./open-questions.md) is the same kind of thing: two
gates that disagreed, with a general reason attached — a VIF is a fact about
*patches*, and fusing coefficients asserts something about *people*, which does
not follow.

Neither needs any work. They are written, sourced, and reproducible from a
checkout. What is missing is a destination, and the gap between "recorded in a
changelog" and "somewhere a person searching for the answer will find it" is
the entire distance.

---

## Uses this was not designed for

Not directions so much as observations about what the engine already is.

**Sound *sets*, not sounds.** A style lens plus a diversity constraint
generates a coherent *family*: twelve UI sounds in one voice, a game's one-shot
set, an earcon family that a person can learn. The engine is closer to this
than it looks — the pool already holds diverse candidates, the map already
measures spread, and what is missing is a set-level objective (maximize total
utility subject to a pairwise $\varphi$ distance floor), which is a submodular
selection over the pool rather than a new search. It is also a different
product with a different buyer.

**A teaching artifact.** This reference is most of a course on typed MH,
reversible jump, Boltzmann targets, ordinal likelihoods and calibration, with a
runnable instrument attached and — the part no course has — negative results
with their measurements.

**Sound design without a modular interface.** Every gesture the instrument
*requires* reduces to *which of these two*. That is an accessibility property
rather than a beginner property, and it is not claimed anywhere.

**An instrument for a real empirical question.** Whether one listener's timbre
preference is multi-modal at all is testable, `style_shares` is already the
recording of it, and the answer is interesting whichever way it falls. Blocked
on [§1](#1-the-register-is-gated-on-evidence-that-cannot-arrive), like
everything else here that needs people.

## One risk, which is not a direction

This reference is ~5,100 lines of Markdown against 38,518 lines of Rust
(measured the day this page was written, and this page is 429 of the former),
beside a user guide, a brand spec and a changelog that carries measurement
tables. That ratio is why this project is good, and it is also a wall.
[`CONTRIBUTING.md`](https://github.com/alexnodeland/auracle/blob/main/CONTRIBUTING.md)
invites contributions and enforces `make check` and `make site-check`. What it
does not say is which parts of the *unwritten* bar are negotiable — whether a
contributor changing a default is expected to arrive with a paired-seed
measurement, whether a new φ coordinate needs a VIF table, whether an open
question may be closed by argument.

Either answer is fine. A project may reasonably be a single-author artifact
with the door decoratively open. The ambiguity is the thing that deters, and
it costs one paragraph to remove.
