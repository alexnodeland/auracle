# The instrument this could be — a comprehensive design review

*Missed opportunities, unseen use cases, UX and design gaps, and the dimensions
of musicality Auracle could grow into. Written against the tree at `bb0c7f5`
from a full read of all five crates, the app layer, both books, and the design
record. Every claim below was checked in code, not just in docs; where a claim
could be doubted, the file is named. This supersedes the first-pass review that
previously lived at this path.*

---

## Contents

- [Part I — The verdict](#part-i--the-verdict)
- [Part II — Three structural gaps](#part-ii--three-structural-gaps)
  - [§1. Taste cannot have a sweet spot](#1-taste-cannot-have-a-sweet-spot)
  - [§2. The model has never heard you play](#2-the-model-has-never-heard-you-play)
  - [§3. The grammar has no clock](#3-the-grammar-has-no-clock)
- [Part III — The dimensions of musicality: an atlas](#part-iii--the-dimensions-of-musicality-an-atlas)
- [Part IV — The UX: where the design meets the loop](#part-iv--the-ux-where-the-design-meets-the-loop)
- [Part V — Applications: who else this serves](#part-v--applications-who-else-this-serves)
- [Part VI — The performance-surface audit](#part-vi--the-performance-surface-audit)
- [Part VII — Defects and documentation drift](#part-vii--defects-and-documentation-drift)
- [Part VIII — A phased roadmap](#part-viii--a-phased-roadmap)

---

## Part I — The verdict

This is the most honest research codebase I have read. Design questions get
settled by paired-seed measurements instead of taste; retracted beliefs stay in
the record with the reasoning that killed them; the locks are *exactly*
Metropolis-within-Gibbs rather than approximately something; loudness,
standardization and vetting each carry the incident that motivated them. The
UI copy holds the same standard — four distinct kinds of "no data" on a spec
card, a calibration meter that shows hit-rate only to demonstrate how
misleading it is, an eviction message routed through one function so a preset
load can never narrate itself without also narrating what it destroyed. The
craft under the instrument — click-free swaps with envelope carry, a
sample-accurate arp on the audio thread, zero-allocation rendering — is real.

And yet the tagline makes a promise the mathematics cannot currently keep.
**"Searches for your sound" implies your sound is a *place* — and the utility
model can only represent *directions*.** That is the deepest of three
structural gaps, each sitting squarely on one of the three stated criteria:

1. **Mathematically rigorous** — the utility is convex, so a sweet spot is
   unrepresentable at any K (§1).
2. **A real instrument** — the model has never heard you *play*: taste is
   elicited on one four-note, single-velocity phrase, while velocity itself has
   no port in the compiled voice (§2).
3. **Musical** — the grammar has no clock: nothing in a patch can know the
   tempo, two modulators cannot be phase-related, and a filter envelope cannot
   sustain (§3).

Around those three sit two wider findings this review develops for the first
time. First, **musicality has more dimensions than timbre**, and the current φ,
grammar and stimulus jointly cover perhaps four of the thirteen that matter to
musicians; Part III maps all thirteen and what each would take. Second, **the
teaching loop's UX is economically upside down**: the most efficient signal in
the app (the 3-of-9 warm start, ~0.6 observations per user-second) runs once
and never again, while the dominant workflow (serial A/B listening at ~0.08
obs/sec) has no batching, no instant comparison, and no acknowledgement that
its own trustworthiness horizon is roughly two hundred duels away. Part IV
takes the loop apart as an economy.

None of this needs a new architecture. Everything below is an extension
*inside* the existing frame — new likelihood terms, new φ blocks under the
existing stimulus-tag machinery, new grammar productions under the append-only
codec, new surfaces over data the engine already logs. That is the review's
real conclusion: the foundation is right, and it is currently pointed at a
narrower target than it can hit.

---

## Part II — Three structural gaps

### §1. Taste cannot have a sweet spot

The utility is

$$u(x) = \max_{k} \; \theta_k^\top z(x),$$

a maximum of affine functions, hence **convex** in z. A convex function attains
its maximum on the boundary of any region, never in the interior. But the
canonical statement of musical taste is an interior optimum: *bright, but not
harsh; present attack, but not clicky; wide, but folds to mono.* On nearly
every perceptual axis, preference is an inverted U. No lens, and no number of
lenses, can express one.

The codebase knows. `misspecified_user_is_learned_partially_and_detectably` in
`auracle-taste` constructs an ideal-point listener
$u^* = -\sum_j w_j(\varphi_j - c_j)^2$ and notes that the model "provably
cannot represent this user at any K." What the test frames as a bounded
misspecification, this review frames as the central modelling gap, because its
fingerprints are on the measurements: the pool **widens** over a session rather
than concentrating (the open-questions SMC entry), and with a convex objective
that is what must happen — the tilted search is always rewarded at the
extremes, and only the grammar prior and the vet gate push back. β, documented
as the one conservatism dial, does not concentrate the search around a
preferred *sound*; it accelerates the walk toward the feature-space boundary.

**The fix, fully specified.** Give each lens a concave quadratic term with
sign-constrained curvature:

$$u_k(z) = c_k + b_k^\top z \;-\; \sum_j \lambda_{k,j}\, z_j^2,
\qquad \lambda_{k,j} \ge 0,$$

and keep $u = \max_k u_k$. Properties worth stating precisely:

- **The current model is the $\lambda = 0$ slice.** Every lens with all
  curvatures at zero is exactly today's linear expert, so nothing expressible
  is lost, monotone axes stay monotone ("more sub is always better" within the
  audible range is a real preference), and K = 1, λ = 0 is exactly the shipped
  BLR. Migration is not a re-interpretation of history; old fits are a
  subspace of new fits.
- **The sweet spot is derived, not fitted.** Where $\lambda_{k,j} > 0$, lens
  k's preferred value on axis j is $\mu_{k,j} = b_{k,j}/2\lambda_{k,j}$ with
  tolerance $\lambda_{k,j}^{-1/2}$. The TASTE map gains a literal target — a
  dot the search is heading toward, per style — and "what it learned" becomes
  "where it is going." This is the version of the model that matches the
  tagline.
- **Implementation is feature augmentation plus a positivity constraint.**
  Append $-z_j^2$ columns and give their coefficients a half-normal prior
  (mass near zero, so an axis *defaults* to "no curvature — direction only"
  and buys curvature only from evidence). Every site is still a continuous
  scalar; the fugue single-site MH machinery, the likelihood layer, the
  cross-island duel semantics ($P(A \succ B) = \sigma(u_A - u_B)$ on the
  mixture), and post-hoc label alignment (align on the concatenated
  $(b_k, \lambda_k)$) are all untouched.
- **Prior calibration follows the existing discipline.** $\sigma_\theta =
  1/(\sqrt{d}\,s_K)$ exists to hold prior utility variance at one unit across
  the K schedule; the half-normal scale on λ needs the same treatment (choose
  it so the quadratic term's prior contribution to $\mathrm{Var}(u)$ is a
  fixed small fraction — the constant deserves the same named-and-greppable
  status as `MAX_NORMAL_SD`).
- **Cost is site count, and it interacts with the K-cap question.** Curvature
  doubles per-lens sites (2d + 1 per lens). At the shipped K = 5 that is
  ~410 sites against a fixed 10 000-step budget — untenable at "48 sweeps per
  site" already on record. But the open-questions register is *already*
  collecting `style_share` evidence for capping K at 3; at K = 3 the
  curvature-augmented model costs ~246 sites, roughly today's 206. The two
  decisions should be made together, and the ideal-point gain is the argument
  the K-cap entry was waiting for.
- **The Boltzmann target acquires interior modes**, and β becomes what
  target.md already says it is: a concentration dial. Prediction, falsifiable
  with the existing harness: pool-widening should reduce or reverse under a
  fitted concave utility, and the catastrophic tail of refinement should
  shrink.

The gates already exist and are this project's strongest asset: θ-recovery
closed loop, the 48-seed paired climb, calibration, and — the thing the
fused-prior episode proved matters most — the *disagreement* between them. Add
one synthetic user: the ideal-point listener from the misspecification test,
promoted from adversary to spec.

**Corollary, nearly free once curvature exists: sound matching.** A target
utility $u_{\text{match}}(z) = -\|z - z^*\|^2_\Lambda$ is an ideal-point lens
whose optimum is *known* rather than fitted. Featurize any audio the user
hums, plays or drops in — the φ pipeline is indifferent to where samples came
from — and the entire machinery (render → vet → φ → Boltzmann → refine) works
unchanged with the utility's source swapped. "Make it sound like this" is the
single most requested workflow in sound design, no tool does it well, and
after this section it is a constructor call. It is also a cold-start solvent:
a hummed target is worth fifty duels. (Part V returns to this; the corpus
version — a *folder* of references defining a house style — is the same
mathematics with a mixture of targets.)

### §2. The model has never heard you play

The live path is velocity-sensitive, polyphonic, MIDI-driven, with glide and
an arpeggiator. The path every preference is elicited on is a fixed
5.05-second, four-note phrase — three of the notes are C — at **one
velocity**, in **mono**, with **one RNG draw** for every stochastic modulator.
The taste model is a model of your taste *in that phrase*.

It is worse than an elicitation gap, because the gap runs all the way down
into the grammar:

- **Velocity has no port.** The compiled voice takes exactly two external
  inputs, `pitch` and `gate` (`compile.rs`). Velocity→cutoff — arguably the
  single most idiomatic modulation route on any subtractive synth — is not
  under-measured; it is *inexpressible*. Live velocity is an output-gain
  multiplier (`live.rs`), which is to a velocity mapping what a volume knob is
  to an envelope.
- **Keytracking is a compiler constant** (`KEYTRACK_AMT = 0.5`), explicitly
  not a genome field. Every patch in the space tracks the keyboard
  identically; keyboard behaviour is neither evolvable nor learnable.
- **φ cannot see playing even where the phrase exercises it.** Twelve of
  fifteen audio coordinates are whole-phrase means; register dependence is one
  level ratio across one octave; nothing measures modulation *rate*; nothing
  above C5 is ever rendered, so a patch that aliases into garbage at C6 is
  indistinguishable from one that holds together.

For a musician, playability under the hands *is* most of what separates a
keeper from a preset-browser casualty. Right now that judgement enters the
system only as the un-modelled reason behind a star.

**The fix has three rungs.**

**2.1 Performance inputs as typed modulation sources.** Add `Velocity` and
`KeyPos` as `ModNode` leaves (later `Wheel`, `Pressure` — see Part VI). The
modulation sort exists precisely to route control signals into named
destinations; these are two new leaves in an append-only categorical, not a
representation change. The compiler grows ports; the live path already has the
values in hand. At a stroke, velocity→anything and keytrack→anything become
grammar sites — evolvable, lockable, learnable, and displayed on the rack like
every other cable. (`KeyPos` also subsumes the hardcoded `KEYTRACK_AMT`: the
constant becomes the compiler default for patches without the leaf, so no
migration is forced.)

**2.2 A stimulus battery instead of one phrase.** Render each candidate under
a small *fixed* set of stimuli, and let φ carry a block per stimulus:

| Stimulus | What it isolates |
|---|---|
| the current phrase (unchanged) | continuity of every existing coordinate |
| the same held note at low and high velocity | touch response, per axis |
| a low sustain (C2) and a high sustain (C6) | register consistency; aliasing at the top; mud at the bottom |
| a staccato repetition (6 × 120 ms) | retrigger behaviour, attack consistency, click energy |

The payoff is not the raw blocks — it is the **derived difference
coordinates**, which are the playability axes musicians actually mean:

$$\varphi^{\text{touch}}_j = \varphi_j(\text{ff}) - \varphi_j(\text{pp}),
\qquad
\varphi^{\text{register}}_j = \varphi_j(\text{C6}) - \varphi_j(\text{C2})$$

"Does brightness follow my touch" is a *coordinate* now
($\varphi^{\text{touch}}_{\text{centroid}}$), and so is "does it hold together
across the keyboard." Choosing the battery's velocities at the extremes is the
D-optimal choice for identifying those slopes under a fixed render budget —
the same experimental-design logic §4 of Part IV applies to duels.

Feasibility is better than it looks. Comparability survives because the
battery, like the phrase, is a property of the session; the `:p2` stimulus-tag
machinery was built for exactly this migration and the imputation of absent
coordinates is now honest (the `FitSet` fix in #55). Render cost is the real
bill — roughly 3× for the table above (the added stimuli are shorter than the
phrase) — and two-tier featurization contains it: the refinement surrogate
scores on the base phrase alone (it is a surrogate; its job is ranking), and
the full battery runs only on pool entrants, exactly where vetting already
concentrates its cost. The farm is stateless and indexed; this is what it was
built for.

**This dissolves the per-style-phrase question rather than answering it.** The
circularity recorded in open-questions exists because a phrase must be
*chosen*, and choosing uses an inference from φ, which the phrase defines. A
fixed battery chooses nothing: measure everything, always, and let θ (or λ,
after §1) decide which stimuli matter to which style. The bass style stops
needing a bassline picked *for* it when the bass register's coordinates are
always present to be cared about.

**2.3 Role as a declared covariate, not an inference.** The deep version of
context-dependence — "great bass, terrible pad" — is currently
unrepresentable: the active lens is chosen by $\arg\max_k$ over the
candidate's *own* features, a function of the patch, never of intent. The
honest v2 is an intent the user can declare ("hunting a bass"), entering the
likelihood as an observed covariate — a per-role intercept, or a role prior
over lens membership — with no circularity because declared context is data,
not inference. The per-session pickiness latent $\tau_s$ is precedent: the
design already believes sessions have context. The natural UI is one chip row
above the duel deck, default "any," remembered per session; and the preset
categories (`bass, lead, keys, pad, texture, perc, weird`) already name the
vocabulary.

Also in this bucket, smaller: `mod_at_source` was measured, measured *well*,
and dropped on cold-start variance — after 2.2 multiplies the rows, that
decision deserves a re-run. A mod-rate coordinate (log-Hz mean over active
modulators) is one column and gives the wobble axis a home. A
fundamental-tracking check (does the patch sound the pitch it was sent?) would
catch the ring-mod and shifter patches that currently score as tracking
correctly.

### §3. The grammar has no clock

Search the term language for musical time and you find one object: `Euclid`,
free-running at its own BPM knob. Delay time is a free 0–1 knob; LFO, S&H and
Euclid rates are unrelated clocks; two modulators in one patch cannot be
phase- or tempo-related even by accident, because each owns an independent
oscillator. The dock has a BPM field; it syncs the arpeggiator and nothing
else. A dotted-eighth delay against the arp — the first patch anyone builds on
a synth with a delay — is not expressible.

The musically-rigorous fix is a **prior over a tempo lattice**:

- Give the patch one ambient clock. Today that is the dock's BPM; in a plugin
  shell it is the host transport. The clock is *context*, like pitch and gate
  — it needs no fan-out and no genome migration.
- Rated parameters (LFO rate, delay time, Euclid clock) draw from a mixture:
  with probability $\lambda$, a categorical over musical subdivisions
  $r \in \{4, 2, 1, \tfrac34, \tfrac12, \tfrac38, \tfrac13, \tfrac14, \dots\}$
  of the beat; with probability $1-\lambda$, the current free continuous draw:

  $$p(\text{rate}) = \lambda \sum_r w_r \, \delta_{r \cdot \text{tempo}}
    \;+\; (1-\lambda)\, p_{\text{free}}(\text{rate})$$

- To MH this is one more Bernoulli and one more categorical site per rated
  knob; the codec is append-only, old genomes decode to the free branch, and
  `from_trace` needs no new machinery. To the listener it means evolved delays
  land *on the grid by default and off it by choice* — the lattice is where
  the probability mass belongs in a musical instrument, and the escape hatch
  keeps dub and ambience reachable.
- **Phase becomes meaningful the moment two modulators share a clock**, and
  deserves its own knob: a synced LFO with a phase-offset site can be the
  quarter-note-late twin of another, which is the entire grammar of movement
  in a techno patch. Free-running modulators cannot say it at any parameter
  setting.

Two siblings of the same idea:

- **Harmonicity priors.** Ring-mod (and any future FM production) has a
  carrier:modulator ratio whose musical character is decided by its rational
  height — low-integer ratios are harmonic, irrational ones clangorous. The
  same mixture trick with the lattice replaced by low-height rationals
  (Stern–Brocot by level) makes evolved ring-mod *tonal by default, metallic
  by choice*. Today that knob is uniform noise, and ring-mod earns its 2%
  prior weight by mostly sounding accidental.
- **A sustain stage for the mod envelope.** `ModNode::Env` is attack/decay
  only, so ADSR→cutoff — *the* subtractive filter gesture — is inexpressible
  while the amp has a full ADSR. One appended continuous site.

The fan-out entry in open-questions ends: *"Re-open this when a listener wants
something the tree cannot say."* For time, that sentence is already satisfied —
the listener is anyone with a delay pedal and a drummer. Tempo needs no
fan-out; it is context, not wiring. Ship the lattice long before the genome
migration.

---

## Part III — The dimensions of musicality: an atlas

The question "what dimensions of musicality could come out of this" deserves a
systematic answer, not an anecdotal one. Below are thirteen dimensions a
musician would recognize as *what an instrument is like*, each with: what
exists today, what is missing, and the concrete move — feature axis, grammar
site, stimulus, or likelihood — that would open it. The three gaps of Part II
reappear here deliberately; this is the map they live on.

**1. Timbre — spectral color.** *The strong suit.* Centroid, rolloff,
flatness, flux, ZCR, crest, band balance — carefully axis-engineered
(log-frequency so "a shade brighter" is expressible in the bass). Missing:
**inharmonicity and roughness** (no partial-tracking, so bell-like vs
harmonic is invisible; sensory roughness — beating in the 20–40 Hz difference
band — is the axis "harsh" actually lives on and no coordinate carries it);
**odd/even harmonic balance** (the hollow-square vs brassy-saw axis, cheap
from a harmonic comb once f₀ is tracked); **vowelness** (a Formant source
exists in the palette; no formant-position coordinate exists in φ, so the
model cannot prefer "ah" over "ee"). The move: an f₀ tracker plus three or
four φ_audio columns; all downstream machinery is indifferent.

**2. Dynamics and touch.** Nothing — velocity has no port (§2), the phrase has
one velocity, and compression exists as modules but "how it responds when I
dig in" has no axis. The move is §2 whole: `Velocity` leaf, velocity-pair
stimulus, $\varphi^{\text{touch}}$ difference coordinates.

**3. Articulation and phrasing.** The phrase is strictly sequential gate
on/off; nothing tests legato, retrigger clicks, staccato consistency, or the
envelope-carry behaviour the live engine painstakingly implements. Glide
exists only as a *live* setting — it is not a genome site, so a patch cannot
*be* a portamento patch, and the search cannot discover that you love 90 ms
glides on basses. The move: the staccato stimulus (§2.2); `glide` as an
appended amp-level genome site the live dock defaults from; a retrigger-click
coordinate.

**4. Pitch, tuning and temperament.** Locked to 12-TET: `octave ± 2`, `detune
± 50 ¢`, a CV quantizer with seven scales and twelve roots. **No microtuning,
no Scala/MTS-ESP, no stretched or just intonation — zero mentions anywhere in
the repo; confirmed open ground.** For a synthesizer whose search explores
inharmonic territory (ring-mod, folds, shifts), meeting it with a tunable
keyboard is a natural pairing no competitor of this kind offers. The move is
almost entirely in the shell, not the model: a tuning table between MIDI note
and V/Oct (the voice already speaks continuous V/Oct — this is the *easy*
kind of microtuning), `.scl` import, and later MTS-ESP in the plugin. One
genome-side sibling: the quantizer's scale list is an append-only categorical,
so exotic scales are a wire-format-safe extension.

**5. Harmony and voicing.** One dyad (C4+E4) and one scalar
(`chord_flatness_delta`) carry all knowledge of how a patch stacks. Missing:
low-interval behaviour (a minor second in the bass is where "muddy" lives),
wide-voicing response, unison *as a patch property* (the live dock's unison
never enters the genome or φ, so "this patch wants to be a seven-voice
supersaw" is unlearnable). The move: one chord stimulus at the bottom of the
range in the battery; unison count/detune/spread as amp-level genome sites
defaulted by the dock.

**6. Time and rhythm.** §3 whole: the tempo lattice, shared clock, phase
sites, swing on Euclid. Beyond it, the *horizon* item: the arpeggiator's
pattern is four enum values today, and a typed PCFG over pattern combinators
(note-sets, Euclid masks, rotations, concatenation) with taste fitted on
φ_rhythm is *literally the same mathematics* evolving riffs instead of
timbres. Flagged as horizon, not backlog: it doubles the product's surface
area, and timbre should win first. But it is the clearest evidence that
Auracle is not a synth architecture — it is a **taste-directed search
architecture over typed term algebras**, and timbre is its first instrument.

**7. Space and depth.** The measurement path is mono (L/R averaged before
features), so stereo width is invisible; the docs admit on the chorus spec
card that the model can never learn it. There is no pan or M/S in the
grammar, no width knob, and reverb depth is measured only as `tail_ratio`.
The move, in order of cost: measure width (side/mid energy ratio and
inter-channel correlation — two columns, and the correlation column doubles
as *mono-compatibility*, a production concern no learning synth has ever
represented); then let the grammar say width (a stereo-spread site on Mix and
the widening processors).

**8. Texture and density.** Polyphony is a hardcoded 4; voice behaviour under
stacking is one dyad's worth of evidence; layering — one source through two
processing chains — is the fan-out ceiling, correctly deferred as a genome
migration. What is *not* deferred: `n_*` counts give the model a density
vocabulary already, and a thickness/mass audio coordinate (low-mid energy
concentration) would name the axis "wall of sound vs. glassy" that count
features only gesture at.

**9. Form and development.** The model's world is 5.05 seconds. A pad that
blooms over 30 seconds, a generative patch that never repeats, slow S&H
drift — all invisible (`held_centroid_std` sees 1.8 s of the one held note).
The move is cheap because it does not need more *audition*: render one
additional long tail (say 20 s, C3 held) at pool-entry only, decimate to an
envelope, and extract three slow-timescale coordinates (spectral drift rate,
amplitude undulation depth, novelty half-life — does the sound at 15 s still
resemble the sound at 3 s). This is the dimension where "evolving soundscape"
taste lives, and it is currently a blind spot the *grammar can already
express* — slow LFOs and S&H chains exist; the measurement can't see them.

**10. Expression and gesture.** MPE, aftertouch, mod wheel, macros: Part VI.
The grammar-side half is §2.1's `Wheel`/`Pressure` leaves — the instrument
learning *how you want to be able to lean*, not just how it sounds when a
robot plays it. The model-side half is macros *derived from taste geometry*:
per-lens, the utility gradient in parameter space (finite differences through
the surrogate — one refinement walk's worth of renders) ranks which knobs
matter to *this* style; distill the top three into named macro knobs
("darker–brighter," "tighter–washier") on every patch. That is the taste
model earning its keep live, and the beginning of the answer to the
controller problem.

**11. Ensemble and context.** Every judgement is solo. `numberOfInputs: 0` on
the worklet: comp, duck, gate and vocoder — four of the six binary
productions — can only sidechain against *internal* control, so "duck my pad
under this kick" is unreachable. In a plugin shell the host's sidechain makes
those six productions a second product (an evolving mix processor). Short of
the shell: a bundled test-context bus (a kick loop, a vocal phrase) the user
can audition *against*, and a masking coordinate (spectral overlap between
patch and context) — the first "does it cut through the mix" axis any
learning synth would have.

**12. Chance and liveness.** Every stochastic modulator is judged on exactly
one RNG draw (seed `0xE05_F00D`), so luck in that draw is attributed to
structure — and, deeper, *how random* a patch feels has no coordinate.
Render pool entrants under a second seed and take
$\|\varphi^{(s_1)} - \varphi^{(s_2)}\|$ on a stable subset as a **dispersion
coordinate**: literally "how differently does this patch come out each time,"
which is the liveness axis (analog-style drift vs. locked digital) as a
learnable preference. Same trick, same budget rules as the battery: entrants
only.

**13. Silence and negative space.** The one dimension where this project is
already ahead of the field: `Silence` is a production with deliberate prior
mass, an empty socket is a hole the UI names, and `n_silence` is a φ column.
Keep it; the gap-sweep work (#50, #56) shows the discipline. The only note is
Part VII's: two code paths (`sample_with_rng`, `NodeKind`) never got the memo.

The pattern across all thirteen: **the grammar is usually ahead of the
measurement, and the measurement is usually ahead of the stimulus.** Modules
exist whose character no coordinate can see (formant, chorus width, slow
S&H); coordinates exist that one phrase cannot excite (register, touch,
form). The atlas's summary instruction is: *grow the stimulus first, the
features second, the grammar third* — the reverse of the order a synth
company would take, and the right one for an instrument whose product is a
model.

---

## Part IV — The UX: where the design meets the loop

The app's UX language is unusually good where it explains the model: the
belief row squashes its number onto the bank's scale so two surfaces cannot
disagree; the next-step chip "always answers 'what should I do now'" and *is*
the button that does it; spec cards distinguish four kinds of silence;
undo-windows replace confirm dialogs on principle ("a confirm dialog trains
people to click through it"); errors split into transient notes and persistent
alarms because "'cable plugged in' and 'live audio engine crashed'" must not
be typographically identical. The tone — lowercase, declarative, naming limits
as facts ("that is the search working, not failing") — is the right voice for
an instrument that reports on its own beliefs. This part is about where the
*economics* and *legibility* fall short of that standard.

### 4.1 The teaching economy is upside down

Measured in observations per user-second, the app's signals rank:

| Signal | Cost | Yield | obs/sec |
|---|---|---|---|
| Warm start (3-of-9) | 4 clicks, 0–45 s listening | **18** | ~0.4–0.6 |
| Cut (bank ✕) | 1 click | 1 | ~1.0 (but see §4.4) |
| Star | 1 click + ~5 s | 1 (ordinal) | ~0.17 |
| A/B duel | 2 × 5 s serial + vote | 1 (the primary signal) | **~0.08** |

The most efficient rich signal runs **once**, at first boot, and never again.
The dominant workflow is the least efficient thing in the table, and nothing
attacks its bottleneck, which is not the vote — it is the **ten seconds of
serial listening**. Concretely:

- **No instant A/B.** Both duel buffers are pre-rendered; an instant-switch
  toggle (one key, crossfaded at the playhead — position-preserving, the way
  every mastering engineer A/Bs) would let a listener compare *within* one
  phrase length. This is the single highest-leverage UX change in the
  product: it roughly halves the cost of the primary signal and makes many
  duels answerable in three seconds.
- **`skip` has no key binding** — the copy pushes it hard ("a coin flip
  recorded as a preference is worse than no data") and then prices it at a
  mouse trip. `1/2/←/→` exist; `s` or `↓` does not.
- **No batching.** The warm start proves the format works (stratified sample,
  pick the favourites, mint pairwise observations); it never recurs. A
  periodic "nine fresh candidates — pick three" round would mint 18
  observations per ~40 s *mid-session*, exactly when the pool has new
  material worth triaging. The mechanism is built; it is invoked once.
- **Matched-pair duels are a UX fix as much as a statistical one.** Part II's
  companion (see §4.3 below): "same patch, brighter?" is an *easier
  question* — lower cognitive load, faster answer, less fatigue — and its
  information is concentrated on one coordinate instead of smeared over 41.

And one economy bug: **the warm start evicts.** `warm-go` pushes nine presets
into a full 40-slot pool before the user has voted once, and previewing a
card costs a pool slot. The first thirty seconds of the product silently
destroy up to nine evolution candidates; the warm-start pool deserves
reserved slots.

### 4.2 The expectation gaps

Three numbers govern the loop and none of them is surfaced where it acts:

- **The meter promises six; the docs promise ten to fifteen.** `FIT_EVERY = 6`
  pips vs. first-session.md's "Answer ten or fifteen." Pick one story.
- **The second lens unlocks at 20 observations** (`k = 1 + n/20`) — which
  means *two duels after the warm start*, a genuinely lovely payoff that no
  surface anywhere mentions. The app has milestones it never celebrates: K
  growth, first style split, calibration turning positive. Each is a natural
  "it just learned" moment stronger than the current 3.2-s meter flash.
- **The trustworthy number is ~200 duels away and the app never says so.**
  Check-duel skill needs `check_n ≥ 20` at one check per ten duels; docs say
  "the number to watch" and imply "20–60 picks." Nothing chunks, paces or
  acknowledges a multi-session journey: no session summary ("today it
  learned: you lean brighter; a second style emerged"), no "enough for
  today" (marginal information per duel is computable from posterior
  contraction — when it flattens, say so), no arc between sessions
  ("since last time, its forecasts got 11% sharper"). The docs assume
  "fifteen minutes to a model that proposes"; the honest trust horizon is a
  relationship over weeks, and the UX should be designed for the
  relationship, not the demo.

### 4.3 Legibility: three questions the user cannot ask

The app explains *state* superbly and *causation* not at all.

- **"Why did evolution propose this?"** The lineage strip reports what
  changed (`cutoff 0.31→0.78, +chorus · Δtaste +0.42`), never why that
  direction. The tilt is a per-kind exponential on named coefficients — the
  explanation *exists in the engine as arithmetic* (`biased_prior`'s blend)
  and could ride the lineage row: "+chorus — proposed 2.1× more often
  because you lean toward chorus & sweeps." That one clause closes the loop
  the whole product is about: *my votes changed what it tries*.
- **"Why did my patch disappear?"** Eviction below 4 stars is a count
  (`3 lowest-predicted made room.`) with no names and no undo. The engine
  knows exactly what it evicted and why (`(has_phi_std, utility)` minimum);
  a receipts drawer — last N evictions, name, predicted utility, one-click
  resurrect (the genome is a few hundred bytes; keeping a tombstone list is
  free) — turns the pool's one destructive act from a leak into a ledger.
- **"What would make it more confident?"** Nothing maps "answer duels about
  X" to "narrow interval Y." Even keeping uniform pairing (measured, stands),
  the *posterior* knows where its variance lives; a single line on the TASTE
  DIRECTIONS tab — "least settled: drive & fold — picks between gritty and
  clean patches would teach it most" — is acquisition-as-explanation, no
  acquisition change required.

And one principle worth adopting outright: **every claim about sound should be
audible, not only plotted.** The infrastructure half-exists — style chips play
exemplars, map dots audition on click. Extend it to beliefs: a coefficient row
without an ear is a bar chart, but the engine can *render the axis* — pick the
pool patch nearest the lens mean and the one a σ brighter along the
coordinate, and let ▶ play the contrast. For a musician, that pair *is* the
credible interval.

### 4.4 The bank is not yet a library, and `cut` is four stories

- The bank has three fixed tabs, rank order, no search, no sort, no tags, no
  collections, no notes — while the *node bank* has `/` search with
  sound-synonym tags. The asymmetry is stark, and the auto-namer (which
  already fits adjectives to the pool's spread) is a free index: search by
  the vocabulary the app itself generates. At 40 pool members plus unbounded
  saves, ↑/↓ and `[`/`]` is not navigation.
- `cut` is the cheapest signal in the app and the most confused: the button
  says **cut**, the tour says **✕**, `bank.md` omits it, and `teaching.md`
  says twice that no keep/kill surface exists — while `cutRow` ships
  `record_keep(kept:false)` on every bank row. Meanwhile nothing ever emits
  `kept:true`, so the fitted τ learns from one-sided data (Part VII). Decide
  what keep/kill *is* (the grid/radio surface it was designed for), wire
  keeps (bank promotion is as explicit as a keep gets), and tell one story
  in four places.

### 4.5 Smaller frictions, listed

Playing the keyboard *during* a duel works and is the best hidden feature in
the app (card click → live, `← bench` to return) — the docs undersell it.
Modal edit-duels seize the keyboard on every structural commit unless a
checkbox is pre-ticked; consider inline. No naming prompt at save; no
keyboard route to rename. Handheld under 620 px is a gate, not a layout
(self-declared). `prefers-reduced-motion` honoured by the site, not the
instrument (self-declared). Silent Web-MIDI failure contradicts the app's own
"a control that can't act says so" law. Help overlay calls `snap` "apply
grid." The K-schedule, the check-duel horizon and `cut`'s behaviour live
*only* in `main.js` comments — the docs' candour standard should reach them.

---

## Part V — Applications: who else this serves

The positioning is deliberately narrow — a single-user, browser-native,
desktop instrument whose distinguishing claim is persistent, inspectable,
calibrated preference inference. From that base, seven audiences are
reachable, ordered here by distance. The first three have written homes in
this repo already; the last four are confirmed open ground (zero mentions
anywhere in the tree).

**1. Producers in a DAW** *(intended; unstarted).* The `nih-plug` VST3/CLAP
shell is one paragraph in lineage.md. Two sequencing notes from this review:
the stimulus battery (§2.2) should land before or with the shell — DAW users
judge patches in a mix, and a model that has only heard solo C-major phrases
will embarrass itself there — and `numberOfInputs: 0` must not survive the
shell: comp/duck/gate/vocoder with the host's sidechain is an evolving mix
processor, a second product hiding in six existing productions.

**2. Sound designers for media and games** *(adjacent to the sound-matching
corollary).* Three workflows fall out of machinery this review already
specifies: **brief matching** (a reference WAV → ideal-point target → the
search runs toward it, §1); **corpus taste** (a *folder* of references — "the
palette of this film," "our studio's sound" — fitted as a mixture of targets
or a synthetic observation log; the profile format, raw φ by name plus
standardizer, is already the right container); **batch export** (the bank has
no bulk export and patches have no rendered-audio export — the audition
buffer exists in memory and is never downloadable; for a designer filling a
sample library, "render the bank to a folder of WAVs" is table stakes and an
afternoon of work).

**3. Collaborators and communities** *(written home: the profiles-as-social-
objects sketch).* Blending (concatenate logs; τ_s absorbs per-rater
thresholds), taste-swap ("evolve my bank against your profile" — a duet mode
one profile-load away), and at the horizon a population prior: partial
pooling of θ across consenting users, which is also the principled cold-start
answer beyond the warm start. The privacy story stays clean because the unit
of sharing is a file the user holds. One nearer social feature is already
shipped and undersold: **an exported PNG contains the patch**. A rack
screenshot posted in a chat *is* the patch. That is a viral loop no one has
pointed at: make the share-image beautiful by default and put the import
affordance on the empty bank.

**4. Learners of synthesis** *(open ground).* Half a synthesis course is
already built and nobody enrolled it: spec cards explain what every module
does to a signal and where it can legally go; the "heard as" line teaches the
difference between what changes sound and what changes measurement; the
belief row decomposes a judgement into named causes; the rack is a typed
patching tutor that makes illegal cables unpluggable and *narrates why* ("the
patch is a tree"). What is missing is only the frame: a guided mode that
poses targets ("make this brighter without touching the filter"), and the
duel deck as ear training (matched pairs *are* "hear the difference between
resonance and drive" exercises). The taste model adds the twist no course
has: it shows students what they *actually* prefer versus what they think
they prefer, with calibration receipts.

**5. Musicians with motor impairments** *(open ground, and the strongest
philosophical fit).* The accessibility chapter is serious about UI access
(one tab stop per region, a fully keyboard-reachable wiring path) but never
notices what the *architecture* offers: taste-directed search replaces
precisely the dense fine-motor interaction — forty knobs, drag-cables — that
excludes people from sound design. Every teaching signal is already a binary
or small-ordinal choice: **duels are switch-accessible by construction.** A
deliberate switch-access mode (scan-and-select over PICK A / PICK B / SKIP,
plus auto-audition) would make Auracle the first synthesizer where a
one-switch user can *design their own sound* rather than choose a preset —
not by adding an accessibility layer, but by noticing the instrument already
is one. The radio mode on the roadmap (lean-back keep/kill) is the same
surface; build them as one thing.

**6. Researchers** *(open ground).* Two publishable artifacts are lying in
the tree: the **synthetic-user harness** (closed-loop, CRN-paired seeds,
proper scoring, the BALD/Thompson/uniform measurement) is a reusable
benchmark for preference-learning-with-expensive-oracles, a literature that
is starved for realistic testbeds; and the instrument itself is a
**psychoacoustics platform** — calibrated, forecast-before-vote preference
data over a controlled, parameterized timbre space is exactly what
timbre-perception studies pay participant fees to gather. An opt-in
anonymized observation-log donation (raw φ by name — no audio, no identity)
would build the population prior of application 3 *and* a dataset worth a
paper. The bibliography's own frame (Takagi's fatigue bottleneck) names the
research conversation this belongs to.

**7. Installations and public spaces** *(open ground).* A browser build with
no account, no server, autosave, and a lean-back mode is one kiosk shell away
from a public instrument: a gallery piece whose sound is the *aggregate
taste of everyone who walked past* — duels on a big touchscreen, the taste
map projected, the room listening to its own posterior. The observation log
is the guest book. (This is also the highest-variance marketing artifact the
project could ship for the cost of a fullscreen flag and a reset timer.)

---

## Part VI — The performance-surface audit

The instrument core is genuinely good, and the controller surface stops at
the edge of the audition workflow. The complete live-input inventory today:
note on/off, velocity (→ gain only), pitch bend (hardwired ±2), CC 64
(mis-implemented, below), CC 123. No mod wheel, no aftertouch, no CC
mapping or MIDI learn, no MPE (worse: `stat & 0xf0` merges all channels, so
an MPE controller's per-note bends bend the whole keyboard), no clock in, no
polyphony control (hardcoded 4), no per-patch performance state (arp, glide,
unison and octave are global), and unison's detune/spread are hardcoded
`0.4, 0.8` while `LivePoly::set_unison` accepts both as parameters.

In priority order, if the criterion is "a real instrument":

1. **Fix the sustain pedal.** Pedal-up calls `panic()`, killing notes still
   physically held. Pedal technique is currently unusable; the fix is to
   release only pedal-held notes.
2. **Route the channel nibble.** Per-channel note tracking at minimum; MPE
   detection (per-note bend) as the goal. Today's behaviour is wrong for
   both kinds of controller.
3. **Mod wheel and aftertouch as `ModNode` leaves** — §2.1's production,
   same payoff: the grammar learns how you want to lean.
4. **MIDI learn on any rack knob**, then taste-derived macros (Part III,
   dim. 10) on top.
5. **Un-hardcode**: bend range (read RPN 0), unison detune/spread, voice
   count.
6. **Surface the arp the engine already has**: the Rust side supports
   divisions the UI never offers; "order played" and 1/32 are documented but
   absent in both.
7. **Per-patch performance state**: store arp/glide/unison with the patch
   (the genome carries an amp envelope already; performance defaults are the
   same kind of thing).

---

## Part VII — Defects and documentation drift

Found on the way; worth fixing regardless of direction.

**Real bugs:**

- **`sample_with_rng` cannot produce `Silence`** (`prior.rs`): the match over
  seven weights has arms `0..=4, _ => Formant`; index 6 lands on `Formant`.
  The classic-layer sampler disagrees with `model()` about which trees exist
  — the exact property the adjacent comment demands.
- **`Silence` is unreachable through the edit vocabulary**: `NodeKind` has 26
  variants and no `Silence`, so `Replace` cannot create the unplugged socket
  the prior was argued into representing.
- **Sustain pedal panic** (Part VI).
- **`record_keep` is only ever emitted with `kept:false`** — one-sided
  likelihood feeding, while `teaching.md` twice claims the channel is
  dormant and the bank tour calls the button by a different name than its
  label.
- **Silent MIDI failure**: denied permission and missing API both leave the
  chip at `midi —` with no message.
- **Refinement enforces no size ceiling**: `check_ceilings` runs on the
  hand-edit path only; `refine_one` clamps domains but nothing bounds
  refined size (depth is bounded only by the prior's zero mass past
  `max_depth`).
- **The warm start evicts up to nine pool members** before the first vote
  (Part IV, §4.1).

**Documentation drift** (the docs' candour is load-bearing; these are where
it has gone stale):

- φ is **41**-dimensional in code (15 + 26); notation.md, introduction.md
  and structural.md say 40 (25 structural; `n_silence` missing from the
  list), and the K-cap site arithmetic downstream inherits the error.
- likelihoods.md: implicit signals "not recorded" — contradicted by
  `ImplicitEvent` (promotes, plays, dwell-ms, edits, reverts, with φ).
- edits.md: "there is no separate mutation vocabulary" — MH uses fugue's
  subtree regeneration, not `StructOp`; what is shared is the state space
  and address scheme, and the reachability claim survives for a different
  reason than the one given.
- grammar.md/compilation.md: "two warning-class pairings" vs. fourteen
  entries in the `Warn` allowlist; "6 kinds" vs. 7 sources; "three
  categorical orders are wire format" vs. eleven.
- edits.md: "depth 4 is up to sixteen leaves" — `ModNode::depth` is 1-based,
  so eight; and the prior's `max_mod_depth = 2` and the ceiling's
  `MAX_MOD_DEPTH = 4` are in different units on the pages that compare them.
- playing.md documents arp patterns and divisions that do not exist; the
  node-bank doc says eight groups where `NB_GROUPS` has ten; stale `lib.rs`
  module docs still describe K = 1 and the rejected per-session latent
  design; first-session.md's "ten or fifteen" vs. the six-pip meter.
- Subtle, worth a line in posterior.md: between fits, SIS reweights the
  newest observation at full weight against draws whose baked-in weights
  carry the last fit's recency profile — the SIS target and the MCMC target
  are not the same discounted likelihood. Benign at current scale; document
  it before it isn't. Related: the recency half-life counts log positions,
  not time — a six-month gap and a coffee break decay identically.

---

## Part VIII — A phased roadmap

Sequenced so that each phase's measurement gates the next, in the house
style: nothing closes on "the code is written."

**Phase A — the model tells the truth about taste.**
Ideal-point curvature (§1) decided jointly with the K-cap; the synthetic
ideal-point user promoted from adversary to spec; fix the `Silence` sampler,
the keep/kill asymmetry, and the size-ceiling gap while in the
neighbourhood. *Gates:* θ-recovery, the 48-seed climb, calibration on real
sessions, and the falsifiable prediction that pool-widening reduces under a
concave fitted utility.

**Phase B — the model meets the instrument.**
Velocity and key-position as modulation sources (§2.1); the stimulus battery
with touch/register difference coordinates (§2.2); the tempo lattice and mod
envelope sustain (§3); mod-rate and f₀-tracking coordinates (atlas 1, 2, 6).
*Gates:* a synthetic user who prefers velocity-sensitive patches is
learnable; battery cost stays within the two-tier budget; evolved delays
land on-grid at the expected mixture rate.

**Phase C — the teaching economy and its legibility.**
Instant A/B toggle; skip keybinding; recurring 3-of-9 rounds; matched-pair
duels dealt from refinement neighbours; eviction receipts with resurrection;
"why this proposal" clauses on lineage rows; milestone moments (K unlock,
first positive skill); session summaries and the 200-duel honesty about the
trust horizon; bank search over the auto-namer's vocabulary; the `cut` story
unified; role chips (§2.3). *Gates:* observations per session-minute (the
economy's own metric) measured before and after; check-duel skill trajectory
on real sessions.

**Phase D — the applications.**
Sound matching (constructor call after Phase A); audio export of bank and
patches; the plugin shell with host clock and sidechain (after Phase B so it
arrives able to hear a mix); switch-access mode built as one thing with
radio mode; profile blending; then the open ground of Part V as demand
reveals itself.

The thing this project has that nothing adjacent has is the discipline to
measure its way out of its own opinions — the same harness that killed BALD
and the fused prior can kill or confirm everything proposed here, and every
phase above is written to be tried against it. That harness, not any single
feature, is why I would bet on this instrument.
