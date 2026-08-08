# Consolidated plan — PRs #57 and #58

*Compiled 2026-08-08 from the two open review PRs, both written against `bb0c7f5`:*

- **#57** — `docs(reference)`: two new design registers — *Unraised directions*
  (16 entries) and *What the audition cannot hear* (8 entries) — plus the
  φ ℝ⁴¹ doc-drift fix and a graduation rule (an entry moves to open-questions
  once its settling measurement can be stated).
- **#58** — `notes/musical-instrument-review.md`: three structural gaps fully
  specified, a 13-dimension musicality atlas, the UX loop as an economy, nine
  audience journeys each with a "first inch," a performance-surface audit, a
  defect/drift list, and a four-phase roadmap (A–D).

The two reviews were written independently and converge hard. This document
merges them into one picture: seven themes, a defect list, the doc-drift
ledger, and the decision points that determine the next sprint.

---

## Where the two reviews agree (the seven themes)

### Theme 1 — The measurement is narrower than the instrument

The single largest shared finding. Both PRs, independently, in nearly the same
words: taste is elicited on one 5.05 s, four-note, single-velocity, mono,
single-RNG-draw phrase, and the model is presented as a model of preference
over *instruments* when it is a model of preference over *point samples*.

| Gap | #57 (audition-limits) | #58 (review) |
|---|---|---|
| Velocity / touch | §1 — `NoteSpan` has no velocity field; the one entry unfixable inside φ | §2 — velocity has no *port* in the compiled voice; `Velocity`/`KeyPos` as `ModNode` leaves + stimulus battery with Δ-coordinates |
| Modulation rate | §2 — rate and shape appear nowhere in φ; autocorrelation over the held note yields two coordinates | atlas dims 1–2, §2.3 — mod-rate log-Hz column; f₀ tracking |
| Raw loudness | §3 — `VetReport` computes pre-normalization peak/rms and discards both; `log(raw rms)` is free | Part VII adjacent; same data |
| Tempo | §5 — presets hand-compute BPM in comments | §3 — the grammar has no clock; tempo-lattice mixture prior; phase sites; mod-env sustain |
| Context / mix | §4 — judged in a silent room | atlas dim 11 — sidechain productions can't hear the host; masking coordinate |
| Form / long timescale | (implicit) | atlas dim 9 — one 20 s tail render at pool entry; drift/undulation/novelty coordinates |
| Chance / liveness | (implicit in §2) | atlas dim 12 — second-seed dispersion coordinate |

#58's ordering instruction: *grow the stimulus first, the features second, the
grammar third.* #57's cheap-first ordering: mod-rate + periodicity (cheapest,
highest value), `log(raw rms)` (already computed), velocity battery (the
expensive one that changes what is modelled), tempo.

**Point of tension:** #58 wants the full stimulus battery (≈3× render cost,
two-tier featurization); #57's list reaches the two cheapest wins with zero
new audition. These are sequenceable, not conflicting — but the sprint has to
pick an entry point.

### Theme 2 — The utility model cannot represent a sweet spot

**Only in #58**, and it is that review's deepest claim: `u = max_k θ_k·z` is
convex, so "bright but not harsh" is unrepresentable at any K; pool-widening
is the predicted symptom and is already on record in open-questions. The fix
is fully specified: per-lens concave quadratic with sign-constrained
curvature, λ=0 is exactly today's model, half-normal prior on curvature,
sweet spot becomes a *derived* dot on the TASTE map, and a falsifiable
prediction (pool-widening reduces under a fitted concave utility).

It interacts directly with two #57 entries:

- **§15 (fit budget in steps, not sweeps):** curvature doubles per-lens sites
  (~410 at K=5). #58 says decide jointly with the K-cap; #57 adds the second
  remedy nobody wrote down — hold *sweeps per site* constant and let wall
  time pay. `fit_bench` already measures the axis.
- **§2 (target-directed search):** #58 derives sound-matching as a corollary
  — an ideal-point lens with *known* μ is "make it sound like this" as a
  constructor call. #57 reaches the same feature via a black-box `u_ref`
  substitution that needs **no curvature work at all**, with the honest
  caveat about partial φ (segment-local coordinates undefined on foreign
  audio). Two routes to the same headline feature, one gated on the model
  change and one not.

### Theme 3 — Intent: the loop is selection, sound design is pursuit

Convergent from three directions: #57 directions §3 (declared context
dissolves the per-style-phrase circularity; `presets::CATEGORIES` is the
half-built vocabulary), #57 audition-limits §6 (a fitted preference converges
on the *average* of a taste; the player needs tonight's corner), #58 §2.3 +
V.0 (role chips above the deck, `bass · lead · … · weird`, entering the
likelihood as an observed covariate — per-role intercept or role prior over
lens membership).

Model shape is an open decision: #57 argues appending a context block to φ
(keeps the model linear, one coefficient = "brightness matters more in a
lead"); #58 floats both that and a role prior over lens membership. Both note
the historical cost: every existing vote has no context and imputes to the
mean.

### Theme 4 — The teaching economy is upside down

#58 Part IV, quantified: warm start ~0.5 obs/sec runs once; duels ~0.08
obs/sec dominate; the bottleneck is ten seconds of *serial listening*, not
the vote. #57 directions §4 supplies the structural half: radio is not the
third mode, it is what makes recency/K-growth/calibration observable at all —
and it carries a hidden modelling decision (recency is denominated in log
positions; a flood of cheap keep/kill observations silently changes its
meaning; per-signal-kind or time-denominated recency must be decided *before*
radio ships).

Shared shortlist, cheapest first:

1. **Instant A/B toggle** (crossfaded at playhead) — both buffers already
   pre-rendered; #58 calls it the single highest-leverage UX change.
2. **`skip` keybinding** — copy pushes skip hard, then prices it at a mouse trip.
3. **Recurring 3-of-9 rounds** — the warm-start mechanism, invoked more than once.
4. **Matched-pair duels** — easier question, information concentrated on one
   coordinate; doubles as V.5's ear-training reveal.
5. **Radio mode** — gated on calibration; same build as switch-access (V.6)
   and the kiosk (V.8); blocked on the recency-denomination decision and on
   deciding what keep/kill *is* (the `cut` story is told four different ways).

### Theme 5 — Legibility: the app explains state, not causation

#57 directions §7 (counterfactual explanation over trace addresses: "largest
predicted gain is `node/0#cut` +0.3", with intervals, top-few not one
imperative) is the engine-side half of #58 §4.3's three unanswerable
questions (*why this proposal* — the tilt arithmetic already exists in
`biased_prior`; *why did my patch disappear* — eviction receipts + tombstone
resurrection; *what would make it confident* — posterior variance as
acquisition-as-explanation). Plus #58's principle worth adopting outright:
every claim about sound should be **audible** — render the axis, don't just
plot the coefficient. And #57 audition-limits §8 = #58 atlas dim 10: taste
macros — the fitted lens directions as the personal macro axes, the
continuous form of the counterfactual explainer.

### Theme 6 — Exits and audiences

#57 directions §5 (multisample + SFZ export; quiver-source export) and #58
V.2 (WAV export of patch/bank — "the audition buffer exists in memory and is
never downloadable") are the same exit at two price points. #58's nine
journeys generalize this into first inches: foreign-audio-on-the-MAP (V.3),
guest lens (V.4), matched-pair reveal (V.5), scan-select (V.6), anonymized
log export (V.7), kiosk flag (V.8), per-patch performance state + MIDI learn
(V.1). Four journeys are confirmed open ground (education, switch access,
research, installations — zero mentions in the tree). #57 directions §1
(profile donation → population prior) is #58's V.7 donation flow — same
feature, and the only evidence path for the K-cap question.

### Theme 7 — The engine ignores its own instruments

#57's rounds-two pattern (§11–16): *Auracle pays to generate labelled data
about itself and reads it once.* Render cache → the unfitted
production→brightness map (§11); quarantine labels → the cited-but-unbuilt
screening cascade, or downgrade the claim in three places (§12); independent
refinement seeds run serially beside an idle farm (§13); per-session offset
for star cutpoints by the τ_s argument (§14); provenance scored three ways
then weighted identically — a *fitted* temperature (§16). #58 does not
contradict any of these; its roadmap simply doesn't reach them before
Phase C. These are the "engine dividend" backlog: each is a measurement or a
small model change with an existing harness.

---

## Concrete defects (fix regardless of direction)

From #58 Part VII + VI, none disputed by #57:

1. **`sample_with_rng` cannot produce `Silence`** — index 6 falls into the
   `Formant` arm (`prior.rs`); classic sampler disagrees with `model()`.
2. **`Silence` absent from `NodeKind`** — `Replace` cannot create the
   unplugged socket the prior argues for.
3. **Sustain pedal-up calls `panic()`** — kills notes still physically held.
4. **`record_keep` only ever emitted with `kept:false`** — one-sided
   likelihood feeding; docs claim the channel is dormant.
5. **Refinement enforces no size ceiling** — `check_ceilings` runs on the
   hand-edit path only.
6. **Warm start evicts up to nine pool members** before the first vote.
7. **Silent Web-MIDI failure** — contradicts the app's own "a control that
   can't act says so" law.
8. **Channel nibble merged** (`stat & 0xf0`) — wrong for both ordinary
   multi-channel and MPE controllers.

## Documentation drift ledger

- **φ = ℝ⁴¹** — *already fixed by #57* (introduction, notation, decisions,
  structural.md page + doc comment, guide, and the 46+S / 210+S site
  arithmetic). #58 independently lists the same drift; merging #57 first
  shrinks #58's Part VII list.
- Still open after #57 merges: `ImplicitEvent` vs "not recorded";
  edits.md's mutation-vocabulary claim; `Warn` allowlist 14 vs 2; mod-depth
  units; playing.md's phantom arp features; `NB_GROUPS` 8 vs 10; stale
  `lib.rs` module docs; six-pip meter vs "ten or fifteen"; the SIS/recency
  footnote for posterior.md.
- **Unresolved number:** 42 productions vs 41 modules (#57 flags it for the
  author's eye — defensible iff Silence is a production but not a module).
- **#57 §12 is half a correction:** `structural.rs` + two pages say a screen
  *prunes* in the present tense; nothing prunes. Build it or reword three
  places.

## Review feedback on the PRs themselves

- Copilot on #58: "previously lived at this path" is misleading (the file is
  new in the PR) — lines 8 and 594; and "nothing ever emits `kept:true`"
  should be scoped to the web frontend.
- Copilot on #57: no findings.
- No human review comments on either PR yet.

---

## Decision points for sprint planning

1. **PR disposition.** Merge both as-is? #57 is reference-canon with
   graduation rules; #58 is a `notes/` report whose registers overlap #57's.
   Do #58's findings get folded into #57's registers (one canon) or stay a
   standalone report?
2. **Sprint theme.** #58's phases: A (model truth: curvature + defects),
   B (instrument: velocity/tempo/battery), C (teaching economy), D (first
   inches). #57's cheap-first ordering cuts across them (mod-rate + raw-rms
   coordinates are Phase-B items at Phase-C prices).
3. **The curvature question.** Commit to ideal-point utilities now (jointly
   with the K-cap decision), or run the harness measurement first?
4. **Sound matching route.** Via curvature corollary (after §1) or via the
   black-box `u_ref` substitution (no model change)?
5. **Declared context shape.** Context block in φ vs role
   intercept/lens-prior; and does it ship with the role-chip UI this sprint?
6. **Radio prerequisites.** Recency re-denomination (per-signal-kind vs
   time-based) and the keep/kill story must be decided before radio.
7. **Defect batch.** Fix the eight defects immediately as one PR?
8. **Engine dividend.** Which of §11–16 get a harness run this sprint
   (each is cheap; none is urgent)?
9. **Evidence path.** Ship the donation flow / anonymized export (V.7 =
   directions §1) early, since every population-level question is gated
   on data that only starts accumulating once it exists?
10. **Contributor bar.** #57's closing risk: one paragraph in CONTRIBUTING
    stating which parts of the unwritten bar are negotiable.
