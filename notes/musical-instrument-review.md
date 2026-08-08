# What Auracle is, and what it is not yet

*A design review: missed opportunities, unseen use cases, and the gaps between
"a synthesizer that searches for your sound" and the system as built.
Written against the tree at `bb0c7f5`. Everything below was checked in code,
not just in the docs; file references are given where a claim could be doubted.*

---

## The verdict, first

This is the most honest research codebase I have read. Design questions get
settled by paired-seed measurements instead of taste; retracted beliefs stay in
the record with the reasoning that killed them; the locks are *exactly*
Metropolis-within-Gibbs rather than approximately something; loudness,
standardization, and vetting each carry the incident that motivated them. The
engineering under the instrument — click-free swaps with envelope carry,
sample-accurate arp on the audio thread, zero-allocation rendering — is craft,
not scaffolding.

And yet the tagline makes a promise the mathematics cannot currently keep.
**"Searches for your sound" implies your sound is a *place* — and the utility
model can only represent *directions*.** That is the deepest of three
structural gaps, each of which sits squarely on one of the three stated
criteria:

1. **Mathematically rigorous** — the utility is convex, so a sweet spot is
   unrepresentable at any K. (§1)
2. **A real instrument** — the model has never heard you *play*. Taste is
   elicited on one four-note, single-velocity phrase, while velocity itself
   has no port in the compiled voice. (§2)
3. **Musical** — the grammar has no clock. Nothing in a patch can know the
   tempo, two modulators cannot be phase-related, and a filter envelope cannot
   sustain. (§3)

None of these needs a new architecture. All three are extensions *inside* the
existing frame — new likelihood terms, new φ blocks under the existing stimulus
tag, new grammar productions under the existing append-only codec. That is the
review's real conclusion: the foundation is right, and it is being pointed at a
narrower target than it can hit.

---

## Part I — Three structural gaps

### §1. Taste cannot have a sweet spot

The utility is

$$u(x) = \max_{k} \; \theta_k^\top z(x),$$

a maximum of affine functions, hence **convex** in z. A convex function attains
its maximum on the boundary of any region, never in the interior. But the
canonical statement of musical taste is an interior optimum: *bright, but not
harsh; present attack, but not clicky; wide, but folds to mono.* On nearly
every perceptual axis, preference is an inverted U. No lens, and no number of
lenses, can express one.

The codebase knows this. `misspecified_user_is_learned_partially_and_detectably`
in `auracle-taste` constructs an ideal-point listener
$u^* = -\sum_j w_j(\varphi_j - c_j)^2$ and notes in a comment that the model
"provably cannot represent this user at any K." What the test frames as a
bounded misspecification, I would frame as the central modelling gap — because
its fingerprints are on the *measurements*:

- The pool **widens** over a session rather than concentrating (open-questions,
  the SMC entry). With a convex utility this is what must happen: the tilted
  search is always rewarded at the extremes, and only the grammar prior and the
  vet gate push back.
- β is documented as the one conservatism dial, but with a linear objective a
  larger β does not sharpen the search around a preferred *sound* — it
  accelerates the walk toward the feature-space boundary.

**The fix that fits the product's story: ideal-point experts.**

$$u(x) = \max_k \Big( c_k - \big(z(x)-\mu_k\big)^\top \Lambda_k \big(z(x)-\mu_k\big) \Big), \qquad \Lambda_k \succeq 0 \ \text{diagonal}.$$

Each lens becomes a *sound*: a location $\mu_k$ in φ-space, a tolerance
$\Lambda_k^{-1/2}$ per axis, a height $c_k$. Everything downstream improves in
interpretability, not just fit:

- The TASTE map gains a literal target: $\mu_k$ is a dot the search is heading
  toward, per style. "What it learned" becomes "where it's going."
- $\Lambda_{k,j} \to 0$ recovers "this axis doesn't matter to style k" — the
  linear model's *only* honest statement — so nothing expressible is lost.
- The Boltzmann target $\pi_\beta \propto p\,e^{\beta u}$ acquires interior
  modes, and β becomes what the docs already say it is: a concentration dial.
- Duels still work across islands: $P(A \succ B) = \sigma(u(A) - u(B))$ on the
  mixture utility, exactly as now. The likelihood layer does not change at all.

Every site is still a continuous scalar, so the fugue single-site MH machinery
is untouched; the cost is site count ($2dK + K$ extra sites — real, given the
"48 sweeps per site" tension already on record, and an argument for the K=3 cap
that `style_share` is currently collecting evidence for). A cheaper half-step —
appending $z_j^2$ coordinates to φ and staying linear — buys per-axis concavity
inside the current model, at the price of unconstrained signs (a positive
square coefficient is convexity again) and a muddier story. I would go straight
to the ideal-point form: it is the version of the model that matches the
tagline.

The gates to run it through already exist and are the strongest asset here:
θ-recovery closed loop, the 48-seed paired climb, and — the one the fused-prior
episode proved matters most — the disagreement between them. Add one synthetic
user: the ideal-point listener from the misspecification test, promoted from
adversary to spec.

### §2. The instrument the model hears is not the instrument you play

The live path is velocity-sensitive, polyphonic, MIDI-driven, with glide and an
arpeggiator. The path every preference is elicited on is a fixed 5.05-second,
four-note phrase — three of the notes are C — at **one velocity**, in **mono**,
with **one RNG draw** for every stochastic modulator. The taste model is a
model of your taste *in that phrase*.

It is worse than an elicitation gap, because the gap runs all the way down into
the grammar:

- **Velocity has no port.** The compiled voice takes exactly two external
  inputs, `pitch` and `gate` (`compile.rs`). Velocity→cutoff — arguably the
  single most idiomatic modulation route on any subtractive synth — is not
  under-measured; it is *inexpressible*. Live velocity is an output-gain
  multiplier (`live.rs`), which is to a velocity mapping what a volume knob is
  to an envelope.
- **Keytracking is a compiler constant** (`KEYTRACK_AMT = 0.5`), explicitly not
  a genome field. Every patch in the space tracks the keyboard identically;
  keyboard behaviour is neither evolvable nor learnable.
- **φ cannot see playing even where the phrase exercises it.** Twelve of
  fifteen audio coordinates are whole-phrase means; register-dependence is one
  level ratio across one octave; nothing measures modulation *rate* (a 0.3 Hz
  swell and a 6 Hz wobble have no separating axis — "I love slow evolution and
  hate fast wobble" has nowhere to live); nothing above C5 is ever rendered, so
  a patch that aliases into garbage at C6 is indistinguishable from one that
  holds together.

For a musician, playability under the hands *is* most of what separates a
keeper from a preset-browser casualty. Right now that judgement enters the
system only as an un-modelled reason behind a star.

**The fix has three rungs, and the first two are cheaper than they look.**

1. **Performance inputs as typed modulation sources.** Add `Velocity` and
   `KeyPos` as `ModNode` leaves (later: `Wheel`, `Pressure`). The mod sort
   already exists precisely to route control signals into named destinations;
   these are two new leaves in an append-only categorical, not a
   representation change. The compiler grows ports; the live path already has
   the values in hand. At a stroke, velocity→anything and keytrack→anything
   become grammar sites — evolvable, lockable, learnable.

2. **A stimulus battery instead of one phrase.** Render each candidate under a
   small *fixed* set of stimuli — the current phrase, a soft/loud velocity
   pair, a low/high register pair, a staccato repetition — and let φ carry a
   block per stimulus. The `:p2` stimulus-tag machinery was built for exactly
   this migration and the docs say so; comparability survives because the
   battery is a property of the session, exactly as the phrase is now.

   This also **dissolves the per-style-phrase circularity** recorded in
   open-questions rather than answering it. The circle exists only because a
   phrase must be *chosen*, and choosing uses an inference from φ, which the
   phrase defines. A fixed battery chooses nothing: measure everything, always,
   and let θ (or Λ, after §1) decide which stimuli matter to which style. The
   bass style stops needing a bassline picked *for* it when the bass register's
   coordinates are always present to be cared about. Render cost scales
   linearly with battery size and the farm is already stateless and indexed —
   this is what it was built for.

3. **Role as a declared covariate, not an inference.** The deep version of
   context-dependence — "great bass, terrible pad" — is currently
   unrepresentable: the active lens is chosen by $\arg\max_k$ over the
   candidate's *own* features, a function of the patch, never of intent. The
   honest v2 is an intent chip the user can set ("hunting a bass"), entering
   the likelihood as an observed covariate gating lens membership or shifting
   per-role intercepts. Declared context has no circularity, costs one UI
   affordance, and is the only way "what I want right now" ever reaches the
   model. (The per-session pickiness latent $\tau_s$ is precedent: the design
   already believes sessions have observable-in-principle context.)

Also in this bucket, smaller: `mod_at_source` was measured, measured *well*,
and dropped on cold-start variance — after §2.2 multiplies the rows, re-run
that decision; a mod-rate coordinate (log-Hz mean over active modulators) is
one column and gives the wobble axis a home; a fundamental-tracking check
(does the patch sound the pitch it was sent?) would catch the ring-mod/shifter
patches that currently score as tracking correctly.

### §3. The grammar has no clock

Search the term language for musical time and you find one object: `Euclid`,
free-running at its own BPM knob. Beyond that — nothing. Delay time is a free
0–1 knob; LFO, S&H, and Euclid rates are unrelated clocks; two modulators in
one patch cannot be phase- or tempo-related even by accident, because each owns
an independent oscillator. The dock has a BPM field; it syncs the arp and
nothing else. A dotted-eighth delay against the arpeggiator — the first patch
anyone builds on a synth with a delay — is not expressible.

The musically-rigorous fix is a **prior over a tempo lattice**, and it is
pretty:

- Give the patch one ambient clock (the session/host tempo — the arp's BPM,
  until a plugin shell provides a real one).
- Rated parameters (LFO rate, delay time, Euclid clock) draw from a **mixture**:
  with probability $\lambda$, a categorical over musical subdivisions
  $r \in \{4, 2, 1, \tfrac{3}{4}, \tfrac{1}{2}, \tfrac{3}{8}, \tfrac{1}{3},
  \tfrac{1}{4}, \dots\}$ of the beat; with probability $1-\lambda$, the current
  free continuous draw.

  $$p(\text{rate}) = \lambda \sum_r w_r \, \delta_{r \cdot \text{tempo}} + (1-\lambda)\, p_{\text{free}}(\text{rate})$$

- To MH this is one more Bernoulli and one more categorical site — the codec
  is append-only, old genomes decode to the free branch, and `from_trace`
  needs no new machinery. To the listener it means evolved delays land *on the
  grid by default and off it by choice*, which is exactly the right prior for
  a musical instrument: the lattice is where the probability mass belongs, and
  the escape hatch keeps dub and ambience reachable.

Two siblings of the same idea:

- **Harmonicity priors.** Ring-mod (and any future FM production) has a
  carrier:modulator ratio whose musical character is decided by its rational
  height — low-integer ratios are harmonic, irrational ones clangorous. The
  same mixture trick, with the lattice replaced by low-height rationals
  (Stern–Brocot by level), makes evolved ring-mod patches *tonal by default,
  metallic by choice*. Today that knob is uniform noise and ring-mod earns its
  2% prior weight by mostly sounding accidental.
- **A sustain stage for the mod envelope.** `ModNode::Env` is attack/decay
  only, so ADSR→cutoff — *the* subtractive filter gesture — is inexpressible
  while the amp has a full ADSR. One appended continuous site.

The fan-out entry in open-questions ends: *"Re-open this when a listener wants
something the tree cannot say."* For time, that sentence is already satisfied —
the listener is anyone with a delay pedal and a drummer. Tempo needs no
fan-out; it is context, not wiring. Ship the lattice long before the genome
migration.

---

## Part II — Evidence the system already has and does not use

The decisions log rejects *implicit* signals, with good reasons. But three
channels below are explicit — the user is telling you something with intent —
and one is a designed-experiment opportunity the acquisition measurement never
tested.

**1. A knob-stop is an argmax observation.** A user grabs cutoff, sweeps it,
and lets go. Where they let go is not a duel and not a star: it is a statement
that, *along that one-dimensional slice of patch space, utility peaked where
the finger stopped.* Formally, for path points $x_{t_1} \dots x_{t_n}$ sampled
from the drag and stop point $x^*$:

$$P(\text{stop at } x^*) = \frac{e^{u(x^*)}}{\sum_i e^{u(x_{t_i})}}$$

— a Plackett–Luce top-1 likelihood over the trajectory, one more factor in the
same fit. It is a *local* observation (dense information about one axis near
one patch — precisely what duels between unrelated pool members cannot give),
and under the ideal-point model of §1 it is even better: a stop is a direct
reading of the projection of $\mu_k$ onto the swept axis. The infrastructure is
embarrassingly ready: `ImplicitEvent` already logs edits and reverts with raw φ
before/after, the engine's own doc comment calls the revert "the single most
informative row," and — the docs' claim that implicit signals are "not
recorded" is simply out of date. Provenance-tag it, forecast it, calibrate it
by provenance exactly as heard-vs-asserted edit duels are — the machinery for
*earning trust in a new channel* is the part this repo already does better
than anyone.

**2. Designed duels — the acquisition question that was never asked.** BALD
tied uniform pairing, thrice, and the conclusion was sound — *for pairing
within the pool.* But choosing which existing candidates to compare is the
weak form of active learning. The strong form is choosing what the pair
*differs by*: generate B as a single-site perturbation of A and ask. In
Bradley–Terry, one duel's Fisher information about θ is

$$\mathcal{I} = p(1-p)\,(z_A - z_B)(z_A - z_B)^\top$$

— the experimenter controls the *direction* $(z_A - z_B)$. Uniform pool pairs
differ in everything at once, so each answer smears credit across forty
coordinates; a matched pair isolates one. This is not BALD with a different
score — it is moving from observational to experimental design, and the
measured tie does not cover it. It is also musically kinder: "same patch,
brighter?" is an easy, fast, low-fatigue question, where two unrelated sounds
force a whole-gestalt judgement. The refinement machinery already generates
single-site neighbours forty times per ⚡ press; dealing one occasionally as a
duel is plumbing, not research. (The existing `random_check` stream stays as
the unbiased calibration sample — this proposal only competes with the other
90% of deals.)

**3. Keep/kill is being fed one-sided, today.** `teaching.md` says no surface
emits keep/kill. The code disagrees: `cutRow` in `main.js` records
`kept:false` when a cut's undo window expires — and *nothing ever records
`kept:true`*. A likelihood fitted on one-sided data learns that the threshold
τ sits below everything surviving, which is to say, noise. Either wire keeps
(a pin is philosophically "keep"; the docs' argument that a pin records no
observation is principled, but *bank promotion* is as explicit as a signal
gets) or gate the kill emission off until grid/radio mode lands. The current
state is the worst of both.

**4. Two parameters the likelihood layer is missing.** A fitted inverse
temperature on the BT sigmoid would separate "consistent listener" from "large
‖θ‖" — today consistency can only be expressed through a norm the prior was
explicitly calibrated to resist. And a per-item residual (a patch random
effect) would give the one diagnostic the docs admit is missing: an estimate
of *how much of taste φ actually spans*, rather than inferring it from a skill
score stuck at zero.

**5. Calibration-gated autonomy is the radio-mode math, and it is already
half-built.** The model forecasts every duel before the vote and tracks its
Brier skill. That is exactly the statistic that licenses delegation: when
check-duel skill is high, let the machine auto-resolve its confident duels and
spend the human only on the uncertain ones, with expected regret bounded by
the measured calibration. "It stops guessing and starts proposing" becomes
"it starts *filtering*" — the lean-back mode, derived rather than vibed.

---

## Part III — Unseen use cases: what else this machinery is

Each of these is the existing mathematics pointed somewhere new, ordered by
value-per-novelty.

**Sound matching — "make it sound like this."** Featurize any audio the user
hums, plays, or drops in; the target
$u_{\text{match}}(x) = -\|z(x) - z_{\text{target}}\|^2_\Lambda$ is an
ideal-point expert with $\mu$ *known*, so after §1 this is not a feature — it
is a constructor call. The full pipeline (render → vet → φ → Boltzmann →
refine) works unchanged; only the utility's source differs. This is the single
most requested workflow in sound design ("that pad on that record"), no tool
does it well, and Auracle is uniquely shaped for it because search-toward-a-φ
is already its whole body. It also solves cold start: a hummed target is worth
fifty duels.

**Macros from the taste geometry.** An evolved patch has dozens of knobs and
the performance surface exposes them one mouse-drag at a time. The taste model
knows which *directions* matter: per-lens θ (or $z - \mu_k$, after §1) is a
ranked list of utility-relevant feature directions, and the surrogate's
finite-difference sensitivity of $u$ to each *parameter site* is one refinement
walk's worth of renders. Distill the top three into auto-named macro knobs
("darker–brighter", "tighter–washier", "more style-B") on every patch. This is
the taste model earning its keep *live*, and it is the beginning of an answer
to the controller problem in Part IV.

**Lineage as a performance axis.** Every candidate carries its parent chain,
and most refinement edits are parameter moves — exactly interpolable. "Scrub
along the lineage" is a morph slider with the semantics *play the evolution*:
parameter edits lerp smoothly through the live handles (no recompile), and
structural edits become crossfade points through the already-click-free swap
machinery. No other synth can offer this control because no other synth has a
lineage. (General patch morphing between unrelated trees is ill-posed; this
version is well-posed precisely because the genome's edit history is the path.)

**Profiles as social objects.** The export format — raw observation log plus
standardizer — is already the right substrate for everything hierarchical:
*blending* (concatenate two logs; per-session τ already absorbs each rater's
threshold), *taste-swap* (evolve my bank against your posterior — a duet mode
that is one profile-load away), and, at the horizon, a *population prior*
(partial pooling of θ across consenting users, which is also the principled
answer to cold start: a new user begins at the population posterior instead of
indifference). The privacy story stays clean because the unit of sharing is
the profile file the user already holds.

**The same theorems, one level up.** A typed PCFG over pattern combinators —
note-sets, Euclid masks, transforms, concatenation — with taste fitted on
φ_rhythm is *literally the same mathematics* evolving riffs and arp patterns
instead of timbres. The arpeggiator is already in the audio thread; its
pattern is four enum values begging to be a genome. I flag this as horizon,
not backlog: it doubles the surface area of the product, and the instrument
should win at timbre first. But it is the answer to "what else could this
be" — Auracle is not a synth architecture, it is a *taste-directed search
architecture over typed term algebras*, and timbre is its first instrument.

**The plugin (planned, so one note only).** The stimulus battery of §2 is what
makes the plugin worth having: DAW users judge patches in a mix, and a taste
model that has only ever heard solo C-major phrases will embarrass itself
there. Sequence the battery before or with the shell. And when the shell
exists, `numberOfInputs: 0` should not survive it — comp, duck, gate and
vocoder all take a typed control input that today can only be internal; give
them the host's sidechain and Auracle becomes a mix processor that evolves,
which is a second product hiding in six productions.

---

## Part IV — The performance surface (the "real instrument" audit)

The instrument core is genuinely good — and the controller surface stops at
the edge of the audition workflow. The complete live-input inventory today:
note on/off, velocity (→ gain only), pitch bend (hardwired ±2), CC 64
(mis-implemented, below), CC 123. That's all. No mod wheel, no aftertouch, no
CC mapping or MIDI learn, no MPE (worse: `stat & 0xf0` merges all channels, so
an MPE controller's per-note bends bend the whole keyboard), no clock in, no
polyphony control (hardcoded 4), no per-patch performance state (arp/glide/uni
are global), and unison's detune/spread are hardcoded `0.4, 0.8` while
`LivePoly::set_unison` sits there accepting both as parameters.

Priorities, if the criterion is "real instrument":

1. **Fix the sustain pedal.** Pedal-up calls `panic()`, killing notes still
   physically held. Pedal technique is currently unusable, and it's a
   several-line fix (release pedal-held notes only).
2. **Route the channel nibble.** Either ignore channels correctly (per-channel
   note tracking) or detect MPE and do per-note bend. Today's behaviour is the
   one choice that's wrong for both kinds of controller.
3. **Mod wheel + aftertouch as `ModNode` leaves** — same production as §2's
   velocity, same payoff: the grammar learns *how you want to be able to
   lean*.
4. **MIDI learn on any rack knob**, then macros (Part III) on top.
5. Un-hardcode: bend range (read RPN 0), unison detune/spread, voice count.
6. Surface the arp the engine already has: the Rust side supports divisions
   the UI never offers, and two documented features ("order played," 1/32)
   don't exist in either.

---

## Part V — Defects found on the way (fix regardless of direction)

Real bugs:

- **`sample_with_rng` cannot produce `Silence`** (`prior.rs`): the match over
  seven weights has arms `0..=4, _ => Formant`, so index 6 lands on `Formant`.
  The classic-layer sampler disagrees with `model()` about which trees exist —
  the exact property the adjacent comment demands.
- **`Silence` is also unreachable through the edit vocabulary**: `NodeKind`
  has 26 variants and no `Silence`, so `Replace` can't create the unplugged
  socket the prior was carefully argued into representing.
- **Sustain pedal panic** (above).
- **`record_keep` is only ever emitted with `kept:false`** — one-sided
  likelihood feeding (Part II.3), while `teaching.md` claims the channel is
  entirely dormant.
- **Silent MIDI failure**: denied permission and missing API both leave the
  chip at `midi —` with no message — the docs' own "a control that can't act
  says so" law, violated at the front door.
- **Refinement enforces no size ceiling**: `check_ceilings` runs on the
  hand-edit path only; `refine_one` clamps domains but nothing bounds refined
  size (depth is bounded only by the prior's zero mass past `max_depth`).

Documentation drift (the docs' candour is a load-bearing feature of this
project; these are where it has silently gone stale):

- φ is **41**-dimensional in code (15 + 26); notation.md, introduction.md and
  structural.md all say 40 (25 structural, `n_silence` missing from the list),
  and the K-cap site arithmetic downstream inherits the error.
- likelihoods.md: implicit signals "not recorded" — contradicted by
  `ImplicitEvent` (promotes, plays, dwell-ms, edits, reverts, with φ).
- edits.md: "there is no separate mutation vocabulary" — at code level MH uses
  fugue's subtree regeneration, not `StructOp`; the shared thing is the state
  space and address scheme, and the reachability claim survives for a
  different reason than the one given.
- grammar.md/compilation.md: "two warning-class pairings" vs. fourteen entries
  in the actual `Warn` allowlist; "6 kinds" vs. 7 sources; "three categorical
  orders are wire format" vs. eleven.
- edits.md: "depth 4 is up to sixteen leaves" — `ModNode::depth` is 1-based,
  so eight; and the prior's `max_mod_depth = 2` and the ceiling's
  `MAX_MOD_DEPTH = 4` are in different units on the pages that compare them.
- playing.md documents arp patterns and divisions that don't exist in code;
  the node-bank doc says eight groups, `NB_GROUPS` has ten; stale `lib.rs`
  module docs still describe K=1 and the rejected per-session latent design.
- Subtle, worth a line in posterior.md: between fits, SIS reweights the newest
  observation at full weight against draws whose baked-in weights carry the
  *last* fit's recency profile — the SIS target and the MCMC target are not
  the same discounted likelihood. Benign at current scale; document it before
  it isn't.

---

## Priorities

If I could only sequence it:

1. **Ideal-point utility** (§1). It is the identity of the product — the
   difference between "evolves toward brighter" and "searches for your sound."
   Gates already exist; the misspecification test becomes the spec.
2. **Velocity into the grammar + the stimulus battery** (§2.1–2.2). The
   instrument and the model finally meet; the per-style-phrase question
   dissolves instead of being answered.
3. **Matched-pair duels and the knob-stop likelihood** (Part II.1–2). Cheapest
   information per user-second in the whole design space, and the provenance
   /calibration machinery to keep them honest is already built.
4. **The tempo lattice** (§3). One Bernoulli and one categorical per rated
   knob, and evolved patches start landing on the grid.
5. **The performance-surface audit** (Part IV), sustain-pedal fix first.
6. Then the use cases, in Part III's order — sound matching first, because
   after (1) it is nearly free, and it is the feature that explains the
   product to a musician in five seconds.

The thing this project has that nothing adjacent has is the discipline to
measure its way out of its own opinions. Every proposal above is written to be
killed or confirmed by the same harness that killed BALD and the fused prior.
That harness — not any single feature — is why I would bet on this instrument.
