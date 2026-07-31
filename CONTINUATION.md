# Continuation notes — updated 2026-07-31 (pass 8: audition phrase v2)

## Pass 8: the audition phrase can finally hear what the grammar can say

Pass 7 named the fixed 3-note audition phrase the weakest link in the loop:
it could not discriminate slow pads (a 2 s attack was silent for most of the
stimulus), anything modulated below ~1 Hz, anything above Eb4, or how a patch
stacks polyphonically — and the deficit **compounded** with every correctness
fix. This pass replaced the stimulus and made the migration honest.

### The v2 phrase (`phrase.rs`, ~5.0 s wall)

1. **C4 held 1.8 s** — attack window 2.0 s (was 0.75 s); a register-constant
   sustain long enough for sub-Hz modulation to be a measurable fact.
2. **C5 stab** — one octave above the old ceiling.
3. **C4+E4 dyad** — a second compiled voice, gate-synced (`Note::chord`).
   Chord voices start cold at onset (like live allocation) and after release
   tick until silent-parked, so long tails never truncate into a click. A
   dyad, not a triad: render cost is per-voice-second and pairwise
   intermodulation is the first-order phenomenon.
4. **C3 held + 1.1 s release window, kept last** so the tail features still
   measure release/reverb, not a chord cut.

### Three new segment-local features (φ_audio 12 → 15)

`held_centroid_std` (timbral motion on the held note — whole-phrase
`centroid_std` conflates register jumps with modulation), `high_ratio`
(ln RMS of the high note vs the held note — does it speak up high),
`chord_flatness_delta` (flatness of the stacked span minus the held span —
intermodulation mud). Roles are found by *property* (first note / highest
note ≥ +0.5 oct / first chord note), never by position, so custom test
phrases degrade to honest 0.0 ("no evidence").

### Measured discrimination (the gates in `features/src/lib.rs` pin these)

- Attack: v1 saturated from knob ~0.7 up (0.03 ln-units of spread over
  0.7→0.9); v2 spreads the same range over 0.78 ln-units, monotone.
- A ~0.1 Hz LFO reads 0.026 on `held_centroid_std` vs 0.0002 unmodulated
  (>100×); ~0.4 Hz reads 0.087.
- Dark ladder −0.74 vs open saw +0.03 on `high_ratio`.
- Dyad span: bit-identical render before chord onset, 2.00× energy inside it.

### Migration: the stimulus tag IS the mechanism

Audio feature names now carry `:p2` (`centroid_mean:p2`). Same name ⇒ same
coordinate is the observation-log contract, and a stimulus change changes
what every audio value *means* — so the rename makes `FitSet::build` carry
old votes' (stimulus-independent) **structural** coordinates forward and
impute their old-stimulus audio coordinates at exactly "no evidence", instead
of silently mixing incommensurable values into one standardizer.
`migrate.rs::v1_names()` freezes the v1 name list so schema-1 logs land on
the stimulus they were recorded under, never the current one — the
`legacy_profile_migrates_into_the_new_feature_set` test asserts both
directions, including `raw_rows(current) == 0`. `render_key` folds the spec
into the content address, so every memo self-invalidates. Old saved sessions
restore fine: trees are re-featurized (farmed) under the new phrase on
import. JS: `niceName()` strips the tag for display; new labels "held-note
motion", "speaks up high", "stack mud".

Vet: the peak ceiling now scales with `PhraseSpec::max_voices()`
(`VetConfig::for_spec`) — N gate-synced voices legitimately sum toward N×,
and that summing is the information; no artificial chord attenuation, LUFS
normalizes the whole phrase downstream.

### Cost, measured honestly (2026-07-31, same machine, back-to-back)

- Native `pipeline_stats -- 200`: **18.7 s → 41.8 s (2.23×)** — slightly
  above the ~2× design budget; the released dyad voice ticking through its
  tail is the honest price of click-free chord releases. (Baseline re-measured
  same-day, not taken from pass 7's 14.1 s — day-to-day machine variance.)
- In-browser cold boot (fresh IndexedDB, nav → 40-patch fill, DevTools-attached
  probe, loaded machine): v2 {5.7, 7.9, 8.0} s vs same-probe v1 baseline
  {6.5, 9.2} s — **unchanged within noise**; boot is dominated by fixed costs
  (wasm fetch/compile ×7, worker spin-up, fit) and the 6-worker farm absorbs
  the render delta. These numbers are NOT comparable to pass 7's 0.85 s,
  which was a different instrument on an idle machine.
- Browser smoke (fresh cold boot on the new bundle): 40 patches named and
  ranked, quick-duel dealt, warm start offered, vote roundtrip picks 0 → 1,
  **zero console errors**. The first bank patch had a 2.45 s attack — exactly
  the class v1 could never audition.

All 89 workspace tests green; clippy clean. Synthetic users in
session tests/examples now match θ axes by base name (tag-agnostic).

### Still open after this pass

- npm publish for @quiver-dsp/{types,wasm,react} still blocked on EOTP (needs
  an npm Automation token in NPM_TOKEN or a local `npm publish --otp`).
- Starter-packs product decision (one shared cold-boot bank vs 3–5 packs by
  seed) — unchanged from pass 7.
- IndexedDB persistent render cache (`RENDER_EPOCH` namespace reserved in
  cache.rs, deliberately not built yet).
- Per-style audition phrases (bass → bassline, pad → chord swell) remain the
  eventual answer for what a single fixed phrase still can't do (e.g. the
  bank's 5.7 s-attack pad is *better* seen now but still not fully).
- A stale worktree `/private/tmp/ric-base` (pre-pass-7 baseline) still exists.

---

# (pass 7 and earlier)


## Pass 7: second four-persona panel → correctness, craft, legibility

A second panel (music technologist / creative designer / ML researcher / UX)
critiqued the running app. Unlike pass 6 this one **measured**: peak levels off
the worklet, contrast ratios and font resolution in-browser, `getBoundingClientRect`
on the rack, DOM sampling across eight duel votes. Several headline findings were
bugs, not opinions. Scope rule for the round: **no changes to the shape of the
genome** — anything adding or removing a `PatchTree` field was deferred rather than
migrated through term/prior/mutate/genome/describe/presets/features at the same
time as everything below.

### The bug that mattered most
`live.rs::render_into` never applied the `/5.0` volt normalization that
`features::render` does. quiver audio is nominal ±5 V; the float domain is ±1.0;
and the LUFS makeup gain riding every patch was fitted in the ±1.0 domain. So the
live path ran ~14 dB hot and the `clamp(±1.5)` had become the **operating point**,
not a safety net — measured 1.364 peak for one note and exactly 1.500 (the rail)
for a four-note chord. It also quietly sabotaged the science: two duel candidates
both slamming the same clipper come out at the same level, "loudness-matched" by
destruction. Fixed with `VOLT_SCALE`, plus a real `MasterLimiter` across the
summed polyphony (instant attack, ~80 ms release, 0.98 ceiling) — there was no
master limiter at all, and N voices sum to N× one voice.

### DSP (`compile.rs`, `live.rs`)
Envelopes were **linear** everywhere: quiver's `Adsr.shape` and `Vca.response`
default to 0 and were never wired. Mod depth wasted ~97% of its travel (LFO ±5 V
and mod-env 0–10 V both landing on a normalized 0..1 cutoff CV). The filter never
tracked the keyboard, so patches died in the upper register. The wavefolder's
`#thresh` knob was silently dead whenever the fold was modulated, because
`get_or` returns the *connected* value instead of the constructor default. The
per-voice limiter sat permanently in its soft knee (threshold 0.8 = 4 V against
±5 V audio) — a tone stage, not a safety net. Reverb/chorus discarded their
stereo tanks. Voice stealing kept the gate high, so the fifth note of a chord
inherited the stolen note's envelope position and spoke with no attack. Glide
chained through a chord because `last_pitch` was global. All fixed; see the
module docs for the reasoning on each.

### Taste model (`taste/*`, `session/*`, `features/*`)
`size` was **exactly** the sum of the nine per-kind node counts — a rank-deficient
design matrix with an unidentified ridge the chain random-walks along forever, and
it poisoned `biased_prior()`, which reads those nine coefficients. Spectral
features were linear in Hz, so a *linear* model could not express "brighter
basses". Observations stored standardized φ against a standardizer fitted once and
never refitted, which made the log not the source of truth and made changing the
feature set silently invalidate every saved profile — now raw φ + `feature_names`
+ `schema_version`, standardized at fit time, with `migrate.rs` inverting the
persisted standardizer for schema-1 logs.

**On the acquisition function: the default is `Random`, now settled by
measurement in both regimes — see the dedicated section below.** The short
history, because the sequence matters more than the endpoint:

1. Dueling Thompson sampling was the shipped rule. It is best-arm
   identification, which is the wrong objective — and in the live app it served
   the identical pair four times running.
2. BALD replaced it, measured over 3 seeds, which appeared to show random
   pairing *ahead* of BALD. That ordering was inside noise and was retracted.
3. At 10 and then 20 paired seeds: BALD **beats dueling Thompson** decisively on
   pool ranking and predictive error, and **ties uniformly-random pairing**
   within noise on all three metrics.
4. `Random` shipped as the default on the reasoning that a rule with four tuning
   constants which ties one with none should not be the default.

Two bugs surfaced only because the measurement was built. BALD's enjoyment term
was scored on *unnormalized* utility, so as the posterior sharpened it swamped
the information term and the rule silently reverted to the best-arm behaviour it
was meant to replace; and the softmax used an absolute 0.05-nat temperature, so
`exp(ΔJ/T)` ran to e¹⁰ — an argmax wearing a softmax's clothes. **That single
defect was also the cause of the repeated duels the UX panel measured**: the two
findings were one bug seen from two directions.

### Surface (`apps/web/*`)
The hero rack was **5% ink coverage** at 1920×1080 — the SVG stretched to the
container while content laid out at a fixed pitch from `x = 15`, and horizontal
centring was never applied. It now centres and **scales 1×–2.2×** to fill its
frame, which also fixes the 6.5–7.5px parameter labels. The app had **zero
`requestAnimationFrame` loops and no `AnalyserNode`**: you played a synthesizer
and it never appeared powered on. There is now a live scope, audio cables that
travel only while audio does (previously only *mod* wires animated — backwards
from what you hear), and a note-on flash on the amp plate.

Knobs read musical units (`840 Hz`, `24 ms`, `−6.0 dB`, `+12 ¢`) from quiver's
real mappings, and wear value arcs and tick rings. Plates got bevels, cast
shadows and screws; jacks got nuts and bores. The cable bezier's control points
**crossed** whenever the span was under 48px — which it is between adjacent
columns — so short runs kinked instead of hanging.

Type is six roles on a scale with a 10px floor, and the three faces are
self-hosted: the old stack resolved to Trebuchet MS on stock Windows and Menlo
for "IBM Plex Mono" essentially everywhere, and 284 elements rendered in Arial
because form controls don't inherit `font-family`. Every phosphor split into a
text tier (AA-passing) and a stroke tier; nine off-system slate-blues and pinks
removed. Measured contrast failures: ~9 → 1.

The learning loop was invisible where it mattered: the first six votes produced
no pixel change anywhere, and the only "it learned" signal was an 8px LED that
flashed too fast to catch in 8 of 8 samples. Replaced by a teaching meter that
never goes blank, a takeover beat at the refit, surprise-first forecast copy, and
the wordmark's final **R** as the seeking light (*ricercar*: to seek out).
`⌖ promote to play` rendered at **0px width**, severing the duel→bench path.
`cut` deleted silently and irreversibly; it now holds the observation for the
length of the undo window rather than logging a kill and compensating with a
keep — a log containing both is a log of the user's mouse, not their taste.
`my edit is better` defaulted to **checked**, pre-arming a fabricated training
signal.

First run now offers a **warm start**: pick 3 of 9 presets → 18 pairwise
observations, built entirely from existing `load_preset` / `record_duel` calls.
TRUST is a reliability diagram over engine-side calibration, separating the
unbiased check-duel skill from the acquisition-biased number, because a running
hit-rate is not a proper scoring rule and is pinned near 50% by an acquisition
rule that serves near-ties on purpose.

Accessibility: the rack was entirely keyboard-unreachable and the bank cost ~287
tab stops. Both are now single roving tab stops; letter keys only play notes when
focus is outside the interface (previously every keystroke while tabbing fired
audio, and Space on a focused button played a note).

### Performance — native regression RESOLVED; wasm boot needs one re-measurement

**The native render regression is gone.** Measured with
`cargo run --release --example pipeline_stats -- 200`, CPU time (`user`):

| | 200 candidates | per render+vet+featurize |
|---|---|---|
| pre-pass baseline (`9f1d4ed`) | 82.35 s | 0.41 s |
| mid-pass (blocker on every patch) | 130.77 s | 0.65 s |
| final, blocker gated on `has_ladder` | **72.17 s** | **0.36 s** |

The hypothesis was confirmed and the fix was already in the tree when this
document still called it open: the DC blocker is an `Svf` whose `tick`
evaluates three f64 transcendentals per sample (`pow` for the cutoff map,
`pow` for keytrack, `tan` for the TPT prewarp), measured at ~0.057 s of render
per patch. `compile.rs` now inserts it **only when the tree contains a diode
ladder** — the one module whose `diode_sat` is asymmetric and actually emits
DC — which is ~9% of prior draws. `RIC_DCB_ALWAYS=1` forces it everywhere if a
new DC source is ever added to the palette. The 72.17 s final number was taken
on an otherwise idle machine, `user ≈ real` (72.17 vs 72.56), and lands
*below* the pre-pass baseline, so the remaining additions (per-channel stereo
voice tail, mod-depth `Attenuverter`s, deduped gate constants) are in the
noise.

**Do not "fix" any future DC issue by reverting to the textbook one-pole.**
(`x[n] − x[n−1] + R·y[n−1]`) — it was tried first and is *worse than the
problem*: its state is not sanitized, so after a note ends it rings on as a
sub-audio decay that never reaches zero — inaudible, and ruinous to
`flatness_mean`, which is a geometric mean. It dragged noise-patch flatness
from 0.567 to **0.0028** and broke `features_track_physics`. That would
silently corrupt every preference observation, which is far worse than a slow
boot.

**The in-browser measurement is done, and a deliberate perf pass is under
way** (2026-07-30, design by a 7-agent judged workflow — investigation and
design docs in the session scratchpad `perf-design/`, synthesis in
`judgment.json`). The stale 78.1 s wasm figure was exactly that — stale;
a fresh 40-patch cold boot on the pre-pass bundle measured **19.96 s**.
Steps landed since, each verified byte-identical on the 200-candidate
`pipeline_stats` feature table before the next was measured:

| | native 200 renders | time-to-playable | cold boot (filled, 40) | wasm bundle |
|---|---|---|---|---|
| baseline (gated DC blocker) | 72.2 s | = filled | 19.96 s | 1.90 MB |
| + quiver `perf/coefficient-memoization` (e67a279) | 62.2 s | = filled | 18.9 s | — |
| + `wasm-opt -O3` + `lto="fat"`/`codegen-units=1`/`panic="abort"` | 45.2 s | = filled | 14.6 s | 1.25 MB |
| + quiver `perf/interpreter-r-series` (7ff567e, ships as 0.2.0) + progressive boot + featurize memo/lazy f32 | 15.0 s | **0.77 s** | **4.46 s** | 1.27 MB |
| + R4 (`constant()` bakes port defaults via `set_param_by_id`) | **14.1 s** | — | — | — |
| + step 5: stateless render farm (6 workers, indexed draw stream) | — | **0.37 s** | **0.85 s** | — |

**Step 7 (the fit stall) also landed.** Measured split confirmed (80% of a
mature fit is model *reconstruction*, not likelihood): `SiteAddrs` hoists the
per-site-per-step `addr!(format!(...))` allocation (bit-identical draws,
1.6–1.9×), and the MCMC budget dropped 30k/10k → 10k/3k after a 13-seed
replication showed the upper budgets are statistically indistinguishable
(mean r 0.715–0.747, inside one SE; only 5k separates downward — and note
even 30k fails the old single-seed gate on ~1/13 seeds). The closed-loop M4
gate now averages 5 seeds with loose per-seed floors, and runs at the
*shipped* budget, which it never did before. Browser MCMC override removed
(it would have out-weighed the new default). Native mature fit 1.86 s →
~0.6 s; first fit 0.34 s → ~0.09 s. `fit_bench` + `closed_loop_sweep`
examples are the reproduction commands.

**quiver-dsp 0.2.0 is RELEASED**: PR alexnodeland/quiver#38 merged, tag
v0.2.0, crates.io publish + GitHub release succeeded; ricercar consumes the
registry crate (byte-identical features re-verified against the registry
tarball). One loose end: **npm publish failed with EOTP** — the npm account
requires a 2FA one-time password CI cannot supply; fix is an npm Automation
token in the repo's NPM_TOKEN secret (then re-run the workflow) or a local
`npm publish --otp` for @quiver-dsp/{types,wasm,react}.

Farm result (2026-07-30, adversarially reviewed, four blockers fixed
including a feature-provenance hash gate — a mis-routed worker reply can no
longer attach one tree's raw φ to another): pool proven IDENTICAL at farm
widths {0,1,2,3,5,8} on `(id, tree, raw φ)` natively AND byte-for-byte on
`export_session()` in Chrome, including under build skew, dead workers, and
mid-boot kills. Warm restore drops the veil at 0.28 s (was a frozen bar for
~40 serial re-featurizes). Cold boot end-to-end: **19.96 s → 0.85 s (23×)**;
native render: **72.2 s → 14.1 s (5.1×)**.

Net: **4.8× on the native render, 4.5× on cold boot, 26× on time-to-playable**
(the veil now drops at 8 candidates while the rest stream in with an
"· N arriving" hint). Post-boot smoke-tested in the browser: duel dealt, one
vote roundtrip through the new `needs_refit` gating, zero console errors.
The R-series over-delivered its ~1.8–2× static estimate (3× measured on top
of step 1) — execution-ordered module iteration under fat LTO compounds
beyond the per-op model. Every step was gated on a byte-identical
`pipeline_stats` feature table over the same 200 draws.

The steps 3–4 app work (progressive boot with staged progress, `needs_refit`
finally read by main.js, duel-buffer prefetch before fits, `RenderMemo` +
`featurize_memo` killing refine's duplicate renders, `RenderPolicy` with f32
`Audition` buffers, worker `busy`/`idle` so render timeouts measure
serviceable time) each passed an adversarial Opus review; all four blockers
raised (restore double-deal, frozen restore veil, false render timeout
during long fits, unconditional audio clone in the memo) were fixed.

Two acquisition tests were reshaped in the process (they were mine, and
seed-brittle): `duels_spread_over_candidates_not_just_pairs` no longer
demands zero pair-collisions from *uniform* sampling (birthday math says
~21% of seeds collide once; `Bald` still must deliver all-distinct pairs —
its exposure penalty is the machinery under test), and
`acquisition_asks_different_questions` no longer runs a one-seed
BALD-vs-Thompson horse race (that is `learn_synthetic --compare`'s job);
it asserts the product property — no pair lock-on.

The quiver branch memoizes every parameter-derived transcendental in module
`tick()`s (recompute-only-on-input-change, bit-pattern keys, forced-recompute
twin tests prove hit ≡ miss ≡ original). It is NOT yet published: the
workspace carries a TEMPORARY `[patch.crates-io]` at the end of `Cargo.toml`
pointing quiver-dsp at the sibling checkout. Before committing ricercar,
either publish quiver-dsp 0.1.2 from that branch and bump the dependency, or
keep the patch deliberately.

Remaining sequenced steps (judge's plan, `perf-design/judgment.json`): the
quiver interpreter R-series (dense PortValues is the single biggest lever),
progressive boot + `needs_refit` (status() ships it; main.js never reads it),
featurize memo + lazy f32 audition renders, the stateless render-farm workers
with the indexed draw stream, IndexedDB render cache, refine/fit costs, and —
**needing a product decision** — shipped starter packs (one shared bank for
all cold-boot users vs 3–5 packs selected by seed).

Caution on older figures in this document: the earlier wall-clock numbers
(EVOLVE POOL "68 s"/"80 s", the UX panel's "81 s", the pass-6 era "~12 s") were
taken under contention, against different builds, or on a *restored* session
rather than a fresh fill, and are **not** mutually comparable. When
re-measuring, state the build, the machine load, and whether the pool is
restored or freshly filled.

### Unverified at the point this pass was halted

Stated so nobody inherits these as "done":

- ~~The EVOLVE forecast-line fix~~ — **now verified.** Reordering the deal ahead
  of the refit had made the `duel` reply land *after* the `status` reply carrying
  the forecast, so `renderCheckBadge` wiped the surprise-first copy every time;
  and with `Acquisition::Random` every duel is tagged `random_check`, so the
  badge fired on 100% of duels while the copy claimed "roughly one in ten".
  Fixed with a hold window on the forecast plus badge suppression when checks
  are universal. Verified on a profile with a fitted posterior: nine consecutive
  votes produced `Expected — it's getting you. 73%`, `Toss-up — that one taught
  it the most. 61%`, `⚡ Surprise — it had this backwards. 38%` …
- **Clean wall-clock timings** for boot and EVOLVE POOL (see the performance
  section above).
- **The designer's round 3.** Round 2 was NOT SATISFIED on two counts, both
  since addressed — type roles had *regressed* 24 → 33 (now 0 raw `font-size`
  declarations; the rack has its own tokens because it draws into a zoomed
  viewBox and its floor must hold at zoom 1), and `flashAmp()` was dead code
  matching `"ENV"` against a title whose textContent is lowercase. Neither
  re-verified by the panel.

### Round-3 panel blockers — all four verified fixed

Both round-3 reports returned NOT SATISFIED. Every blocker they named was fixed
*after* those reports, and each has now been measured in the running app:

| blocker | was | now |
|---|---|---|
| fabricated `Q` on a module whose own plate reads "ladder" (`DiodeLadderFilter` uses `k = res·4`, a feedback amount toward self-oscillation — not a Q and it has none) | `Q 0.9` | `23% res` |
| a running 20-second LFO reported as stopped (`fmtHz` collapsed everything under 1 Hz) | `0.0 Hz` | `0.16 Hz` |
| `bal` claimed a level it never had (equal-power law, so the meaningful figure is the dB difference) | `a 3%` at near-centre | `a +0.3 dB` |
| computer-key velocity pinned at 1.0, making `vel_gain` a constant for anyone without MIDI | `1.0` | `0.78`, Shift → `1.0` |
| next-step chip blank at first paint | `""` | `Teach it your taste — 6 quick A/B picks ▸` |
| EVOLVE forecast line wiped by the check badge | check text on 100% of duels | surprise-first copy on every vote |

**All three of these panelists have now independently re-verified.** Final
state of the panel at the end of this pass:

| panelist | verdict | evidence |
|---|---|---|
| music technologist | **SATISFIED** | ladder `47% res` vs SVF `Q 0.9` on one module at res 0.550; 51-point LFO sweep 0.01→30.0 Hz with no `0.0 Hz`; computer-key vel 0.780 / Shift 1.0 / glissando 0.369 on the same strike law; `bal` symmetric in dB across 51 points; **third** pass over all 23 `KNOB_UNITS` entries against their quiver ports found no remaining wrong unit |
| UX specialist | **SATISFIED** | 10/10 votes show a forecast (was 100% "check duel"); chip actionable at t=135 ms and through votes 1–5; **0 silently-lost votes** at 700/250/80 ms (was 25%); 20 distinct candidates / 28 slots; undo inert exactly at the 7000 ms boundary (the ~350 ms lie is 0 ms) |
| creative designer | **SATISFIED** | 0.00 px label overlap across 50 patch-loads at zoom 1.000 / 1.369 / 2.200; cable control points uncrossed at every span (+5.60 px at span 35, was −25); type roles 33 → 22, sizes 15 → 7; plate-union coverage not regressed |
| ML researcher | **SATISFIED** | all five round-2 blockers closed; it explicitly declined to condition its sign-off on the unrun evolving-pool number, on the grounds that *"shipping `Random` is correct on grounds that hold in either regime, and the measurement decides what the doc may claim, not what the product should do"* |

**The ML reviewer retracted its own round-2 headline.** Its "BALD is ~8% worse
than random" was a measurement of a broken implementation — the unnormalized
enjoyment term and the absolute 0.05-nat softmax temperature — and its
explanation for that number (that the Houlsby regime does not transfer to a
48-candidate pool) it now calls "over-reach dressed as inference". It also
checked the repair story quantitatively rather than accepting the narrative: a
rule partially collapsing toward argmax-utility should land *between* Random and
Thompson, and its own replication put old-BALD at Random +0.017 against
Thompson's +0.046 — which is where the story predicts.

**A better reason for the `Random` default than the one in the doc**, from the
same review, and worth adopting: parsimony ("four tuning constants vs none") is
*contingent on the tie*, so it is exactly as provisional as the measurement.
The regime-independent reason is that under `Random` **every duel is an unbiased
calibration sample**, which is what lets TRUST plot a reliability diagram with no
selection-bias asterisk — and that holds whichever rule learns θ faster. Flipping
the default back is one line; flipping it silently re-breaks the trust surface.
Say that in the doc, because as written it tells the next reader a BALD win flips
the default and nothing warns them what else flips with it.

**Fixed immediately on that review** (the fourth would have wasted the next
person's time): the `Evolving` arm had the synthetic user answering through each
*arm's own* standardizer, so the arms faced different ground-truth users — and
directionally, since an arm that concentrates its pool gets a smaller sigma,
inflating z-scores, inflating |Δu*|, making its own training labels less noisy.
The fixed-exam grading removed that from the scoring but not from the training
signal. The user now answers through the reference basis. **The decisive run
would not have been decisive.** Also: README no longer advertises BALD as the
shipped acquisition, `learn_synthetic`'s module doc no longer claims a stale
table "reproduces exactly", and the reliability diagram's axes now say
"it said A would win this often" / "A actually won this often" rather than
"how confident" / "how often it was right" — a bin at p_a = 0.1 where A wins 10%
of the time is *perfectly calibrated* and the old labels made that read as
failure.

Two process notes worth carrying forward, because both were caught by
measurement disagreeing with expectation rather than by review:

- A label-overlap "defect" of 44.7 px was **an artifact of my own measurement** —
  comparing `getBBox()` values across different `<g>` transforms, i.e. different
  local coordinate spaces. Screen coordinates (`getBoundingClientRect`) showed
  zero. When a number contradicts the geometry, suspect the instrument.
- The `textLength` condensing net added for long labels **never fires**: the
  tightest label (`release`, 45.7 units) has 4.3 units of headroom against its
  50-unit allowance. The designer checked *why* the count was zero rather than
  accepting it, and concluded a guard that never triggers is the right structure
  here — the abbreviations do the work. Keep the net; it is what stops the next
  long label from regressing this.

Also fixed while verifying: the note-key target guard threw when `e.target` was
the document rather than an element (`e.target.closest is not a function`),
which would kill the whole keyboard handler. Optional-chained.

### Uncommitted

Nothing in this pass is committed. `crates/ricercar-session/src/{naming,calib,migrate}.rs`
and `apps/web/fonts/` are **untracked** — a stray `git checkout` during the pass
already reverted `compile.rs`, `audio.rs` and `structural.rs` once (recovered).
A tree snapshot sits in the session scratchpad.

### Deferred, with reasons
Palette expansion (FM, sync, PWM, sub-osc, LFO→pitch) and a keytrack *knob* —
all grammar-shape changes; keytracking ships as a fixed 0.5 constant instead,
which is the audible fix without the migration. Velocity→filter (no per-voice CV
path exists in the compiled patch). Hoisting reverb/delay/chorus to a shared send
bus, and the voice count past 4 — the second is gated on the first, since
per-voice Freeverb is the cost driver. Live A/B of two `LivePoly` instances on
the keyboard, which is the right answer for auditioning but is a second engine
instance and a crossfade, not a tweak. Harmonicity/beat-rate features, the
brightness-cluster group prior, β normalization, K gated on prequential log-loss,
and timestamps for recency.

The single fixed 3-note audition phrase remains the weakest link in the loop and
is the first thing to look at next: it cannot discriminate slow pads (a 3 s attack
is silent for the whole stimulus), anything modulated below ~1 Hz, anything above
Eb4, or how a patch stacks polyphonically — so the grammar can express patches the
audition can never reveal. Note the deficit **compounds**: this pass's
exponential-envelope fix pushed a slow patch's t90 from ~630 ms to 1705 ms
against a 3.2 s phrase whose first note is 600 ms, and the shipped bank already
holds an `amp#attack` of 0.831 (labels 2.10 s, t90 ≈ 5.7 s) that the audition
literally cannot show. Every future correctness win widens the gap.


### ✓ Closed: the acquisition default is now measured in both regimes

`Acquisition::default()` is `Random`, and it is no longer provisional. The
evolving-pool run (`learn_synthetic --compare 20`, with the reference-basis
fix so the synthetic user answers through one common ground truth in both
regimes) completed on 2026-07-30: **bald − random is inside noise on all
three metrics in both the static and the evolving regime**, while Thompson
loses clearly in both. Full tables live in the `Acquisition` type doc in
`engine.rs`, which now carries both regimes from the same harness run.

The manipulation check turned out to be the interesting number: final pool
spread was **7.7–7.9 evolving vs 7.2 static** — six generations over a
72-duel session did not concentrate the pool; frontier-biased injection plus
worst-eviction *widened* it slightly. So the hypothesized concentrated regime
where BALD should win never arises at session horizon, and the original
"pool concentrates under evolution" objection is answered by measurement
rather than dismissed: the concern was legitimate, the regime was run, and
the concentration does not materialize.

Re-run with `cargo run --release --example learn_synthetic -- --compare 20`
(**fans out one thread per run — it held ~14 of 16 cores for ~27 min; do not
run it alongside anything you care about timing**).

### Two related lessons from the same error

1. **The synthetic user was linear in our own φ**, so the model was
   well-specified by construction and the harness could not fail. Now also
   `IdealPointUser` (`u* = −Σ wᵢ(φᵢ−cᵢ)²`), which is *provably* outside the
   model class: `max_k θ_k·φ` is a maximum of affine functions and therefore
   convex, an ideal-point utility is strictly concave, so no K closes the gap.
   Measured 0.675 accuracy vs 0.932 well-specified. The gate fails if inference
   breaks **or** if the harness is too blunt to notice misspecification.
2. **Quantile naming spreads names by construction**, so "top-name share 33% →
   8%" was partly forced rather than earned — a genuinely homogeneous pool would
   still have been given 30 distinct names. Now terciles (robust to pool drift)
   **plus a per-axis just-noticeable-difference floor**: if the pool's whole
   span on an axis is below audibility, that axis stops contributing a word.
   Absolute constants are legitimate *there* because a JND encodes perception,
   which does not move when the pool does — unlike the original thresholds,
   which were absolute claims about pool *structure* and broke when it drifted.
   Guarded by `names_collapse_when_the_patches_are_alike`: twelve imperceptible
   variants of one preset must yield ≤2 distinct names.


## Pass 6: panel critique → all four tiers shipped (commits 4e94345, d12a23b, + tier-4)

A four-persona panel critique (music technologist / creative designer / ML
researcher / UX) produced a 4-tier plan; the user chose ALL tiers.

**Tier 1 — trust.** IndexedDB autosave/restore of the full session
(`Engine::export_state/import_state`, `SessionState` = profile + bank +
lineage + style_names + events; trees re-featurized on import, ids
preserved, next_id bumped past max). Worker `init` takes `saved`,
restores, tops up the pool, auto-refits. Main: `idbGet/idbPut("state")`,
`scheduleSave()` debounce 2.5 s hooked into every mutating reply. Undo/redo:
snapshot wb.tree on knob-gesture start / enum click / sendStruct;
`edit_set_tree` wasm restores; ⌘Z/⇧⌘Z. Web MIDI (velocity, bend ±2 st,
sustain=hold, CC123 panic). LUFS makeup: `Features.gain_db` →
`makeup_linear` (±12 dB clamp) rides every patch load
(`live.setPatch(tree, makeup)`; applied at swap completion via
`pending_makeup`). Worklet recorder (`rec` message, copies interleaved
blocks only while rolling) → PCM16 WAV encode + download in main.
`.evopatch.json` export/import (`import_patch` wasm → commit_edit path).
**Master volume is JS-owned state** (`let volume`), the slider is just a
view — a phantom DOM zeroing (never reproduced under instrumentation;
audio was never affected because no input event fired) once poisoned the
save; never scrape the DOM for persisted state.

**Tier 2 — musicality.** LivePoly grew: velocity (`note_on(note, vel)`,
gain 0.15+0.85·v^1.4, floor so soft notes speak), pitch bend (one-pole
smoothed, `advance_pitch` writes pitch_cur+bend to atomics), glide
(per-voice one-pole toward pitch_tgt; τ = glide·0.5 s), unison
(all-voice press with ±detune·30c offsets + equal-power pan; render path
now applies vel·pan·√2 per voice), sample-accurate arp on the audio
thread (up/down/updown/random via xorshift — NO wall clock; half-step
gate; held list owns the chord, scheduler owns the gates; arp-off
re-presses the chord; swap completion skips re-press when arp on).
Keybar: arp/mode/div/BPM, uni, gld, ●rec, midi indicator; perf state
persisted. Palette: **Reverb** (quiver Freeverb; mono = take "left";
rsize/rdamp/rmix live knobs) and **S&H Rand mod** (Noise→SampleAndHold
clocked by square LFO at `rate`) threaded through term/prior (N_OPS=6,
N_MODS=4)/trace codec/compile/mutate/describe/features (φ d=30:
n_reverb, n_rand)/presets ("Cathedral")/JS palette. New warning classes
allowlisted: Audio/CV, Audio→Trigger, CvBipolar→Trigger.

**Tier 3 — taste loop.** `refine_one` now proposes from a
**taste-tilted prior**: share-weighted mean structural θ multiplies
source/op/mod kind weights by exp(η·θ) (η = cfg.proposal_tilt = 0.6,
multiplier clamped [¼,4]; pure `tilt_weights` fn, unit-tested). Recency:
obs likelihood weighted 0.5^(age/half_life), cfg 150 obs
(TasteConfig.recency_half_life, serde-default). Implicit events
(`ImplicitEvent` kind/id/value/session): play counts flushed with every
autosave, promote clicks; logged only, not modeled. Style identity:
engine.style_names (persisted), chips on TASTE (color + editable name +
share + exemplar ▶), auto-label = top-2 positive θ pulls; best-style
badges on duel cards (`best_style_of`). Honest forecast: `duel_pred`
computed BEFORE each vote, shown with running right/wrong calibration.

**Tier 4 — surface.** Mod wires + target jacks pulse at ~the modulator's
rate (animationDuration from rate/att+dec knobs; prefers-reduced-motion
respected). Duel cards "deal" in. **Quick-duel strip on PLAY** (pd-a/b
load live, pick a/b vote, ↻ skip — zero tab switches). Help overlay
(?, first-run auto-show via localStorage flag) with keymap/gestures.
Coarse-pointer touch targets.

**Deliberately deferred** (design-heavy): genome-level tempo-synced
LFO/delay semantics; learned audio embeddings under the linear experts;
duel loudness is now fair live (makeup) so the remaining confound is
phrase-vs-noodling mismatch.


## Pass 5: audio-thread bulletproofing ("no break/skip/crackle")

`LivePoly` became a proper audio-thread state machine:
- **Zero-alloc render**: `process_ptr(frames)` fills a persistent internal
  buffer, worklet views wasm memory directly (cached Float32Array view,
  invalidated on memory growth / ptr change). The Vec-returning `process`
  is native-tests-only.
- **Param smoothing**: `set_param` sets a *target*; a one-pole ramp
  (0.3/quantum, ~25 ms settle) advances the atomics each quantum — no
  zipper. Smoothers cleared on patch swap.
- **Click-free patch swaps**: Stage machine Run → FadeOut (1/256 per frame
  ≈6 ms) → Rebuild (ONE voice compiled per quantum while output is silent —
  compile overruns drop silent quanta, inaudible) → FadeIn. `held: Vec<u8>`
  tracked at LivePoly level; held notes are **re-pressed on the new patch**
  after a swap, so a held chord survives rewiring. Rapid swaps coalesce
  (Rebuild restarts with the newest pending tree). Compile failure → keeps
  old voices, EVENT_PATCH_ERROR. Worklet polls `poll_event()` once per
  quantum and relays patched/patch_error.
- Tests: gapless-swap (silent gap bordered by ~0 boundary samples, held
  note survives), smoothing convergence, 600-iteration chaos (random
  notes/params/junk addrs/patch swaps → always finite, |s| ≤ 1.5).
- Browser gauntlet: 12 s × 120 rounds of note hammering + knob storms +
  structural menu ops + bank switches: 0 NaN samples, 0 worklet errors,
  ctx running. Wire-drag re-entrancy guarded (`if (wire) return`).
- Test-metric lesson: "no adjacent-sample jump" is a WRONG click test
  (square waves jump legitimately); assert near-zero *boundary* samples
  around the silent gap instead.

# (pass 4) — the live surface

## Pass 4 (playtest-4 response): everything real-time + the wiring surface

- **Zero-recompile knobs**: `compile()` now emits every continuous param as
  an `ExternalInput::cv/cv_bipolar` with an `Arc<AtomicF64>` handle,
  registered in `CompiledVoice.params` keyed by trace address
  (`node/0#cut`). `ParamMap` {Unit, Resonance, Feedback, XfadePos} applies
  the bounded musical mapping at write time. `LivePoly::set_param(addr, x)`
  writes all voices' atomics — **audible next sample, no recompile, filter/
  delay state survives** (test: mid-note cutoff sweep diverges from a clone
  without killing the voice). Knob drags route: sound-first to the worklet
  (`live.param`) + genome-second to the worker (debounced). Bench replies
  only re-patch on subject load / structural edit / non-live addr
  (`param_miss` from the worklet populates `nonLiveAddrs`). Non-live: vco
  detune/octave, fold threshold, mod_depth (cable attenuation), all enums.
- **Wiring surface**: labeled jacks on every module (green audio in/out;
  amber mod; mix has a/b in-jacks; amp in-jack accepts the root), wires
  land on jacks (mod cables land on the bottom mod jack). **Node bank**
  (collapsible right panel) stages modules into the **tray** (client-side
  fragments, serde-shaped JSON mirroring mutate.rs defaults). Drag a tray
  out-jack → legal jacks pulse → drop: processor/mix = `insert_tree`
  (grafts old subtree as its input; Mix keeps its own b), source =
  `replace_tree` (old chain parks in the tray). LFO/env → mod jack =
  `set_mod_tree`. Dragging an occupied in-jack off = unplug: subtree parks
  in tray, a default vco holds the socket; mod jack unplug = set_mod none.
  Rewiring between existing modules = unplug + replug (two gestures, fully
  general). Wire-drag rubber band lives in a fixed `#wire-overlay` svg.
- New tree-carrying StructOps: ReplaceTree / InsertTree / SetModTree (+
  `graft`). Gate test still applies every op everywhere.
- Verified live: analyser peak changed 0.77→1.5 on a held note with zero
  worklet re-patch messages; bank→tray→wire→module-count flows; LFO→mod;
  unplug→tray. Zero console errors.
- JS/Rust must agree on serde shapes: fragments are externally tagged
  (`{"Vco":{...}}`, `"None"`), StructOp is `{"op":"insert_tree",...}`.

# (pass 3) — feature-complete

## Pass 3 (playtest-3 response): toward feature-complete

- **Structural editing** (`grammar/mutate.rs`): StructOp {Replace, Insert,
  Delete, SetMod, SwapMix} by node key — type-safe by construction on the
  typed tree ("reconnect nodes" = tree restructuring, not free cables);
  defaults per NodeKind; MAX_SIZE 24 / MAX_DEPTH 9 caps. Gate test applies
  every op at every key of 30 random trees: always compilable +
  trace-roundtrippable, invalid ops reject cleanly. UI: per-module ⋯ menu
  (replace with / insert after / modulation / swap inputs / delete; amp
  module = add-at-output); structural edits go through the bench flow (wasm
  `edit_structure`), re-render, re-patch the live synth, and **clear locks**
  (addresses shift).
- **Presets** (`grammar/presets.rs`): 8 hand-designed named patches, all
  vet-gated by test; bank-header PRESETS popup → `load_preset` inserts with
  `Origin::Preset` (glyph ▤) and opens it. Seeds taste fast.
- **Names**: `Candidate.name` + `set_name`; unnamed patches display
  `PatchTree::signature()` (spine tags like `saw·ladr·dly`) instead of bare
  numbers; double-click bank name → inline rename (keydown/keyup
  stopPropagation so typing doesn't play notes!).
- **Dynamic styles**: fit K = 1 + observations/20, capped at
  `cfg.k_styles` (now 5). Idle lenses collapse on their own. NOTE: this
  diluted the closed-loop test's per-lens cosine → that check is now a 0.3
  sanity floor (predictive asserts are the real gate).
- **Map click** now selects in place (no tab jump): opens on bench + live +
  highlights/scrolls the bank item; stays on TASTE.
- **Duel card flip**: ⇄ circuit flips waveform → read-only mini rack
  (shared `buildRack(svg, rack, {interactive, fit})` renderer) + "⌖ promote
  to play". Flips reset on each new duel.
- 30 tests green; all flows playwright-verified, zero console errors.

# (pass 2) — the instrument

## Pass 2 (playtest-2 response): Ricercar is now a playable instrument

User feedback: "this is a modular synthesizer — people will want to PLAY it";
virtual keyboard + computer keys; patch is the main screen; no scrolling;
sidebars/menus/tabs; Animoog Z inspiration. Decisions (AskUserQuestion):
**4-voice poly**, **3-tab frame** (PLAY / EVOLVE / TASTE + bank sidebar +
docked keyboard), **everything live** (duel cards load into the live synth;
phrase button kept for fair A/B stimulus).

What shipped:
- `ricercar-wasm/src/live.rs` — `LivePoly`: N compiled copies of one patch
  (same `compile()` path as evolution, limiter included), MIDI note_on/off
  with oldest-note stealing, legato steal past N held notes, **silent-tail
  voice parking** (|L|+|R| < 1e-6 for 4096 frames → stop ticking). Native
  test `live_poly_plays_and_parks`. Perf: ~11 s of 4-voice audio in 0.14 s
  native — huge real-time headroom.
- `apps/web/live-audio.js` — AudioWorklet assembly. **Hard-won gotchas:**
  worklets have no fetch and no TextDecoder/TextEncoder (polyfill required);
  static imports inside a worklet would hit the un-versioned browser cache;
  and a transferred `WebAssembly.Module` silently dies as a `messageerror`.
  Solution: fetch versioned glue text, strip `export` statements, inline it
  into a **blob module** (polyfill + glue + processor), transfer **raw wasm
  bytes**, `initSync` inside the worklet (sync compile is allowed
  off-main-thread). Debug hooks: `window.__evo`, `window.__evoLog` (worklet
  posts boot/ready/patched/patch_error/worklet_error).
- App frame (index.html/style.css/main.js rewritten): menubar (wordmark,
  PLAY/EVOLVE/TASTE viewtabs, counters, LEDs, profile), 252px patch-bank
  sidebar (ranked pool: origin glyph ◇⚡✎, utility bar, stars, cut; click →
  workbench + live), stage views (PLAY = rack full-screen + toolbar;
  EVOLVE = duel cards + evolve pool + lineage strip; TASTE = full-screen
  map/styles/directions), docked piano C3–C6 (pointer glissando, key hints,
  z/x octave, HOLD latch, ◼ panic, volume). 100vh, `overflow: hidden`
  everywhere. Old bench panel is gone — the bank replaced it.
- Live-patch routing rule: every worker `bench` message carries `treeJson`;
  whenever one arrives (open, knob edit, evolved child) the worklet
  re-patches — **edits are audible on the keyboard in real time**. Duel-card
  click sends `tree_json` for that id.
- Verified via playwright incl. **audio RMS through an AnalyserNode** (peak
  0.41 on a latched C4), edit→"patched" roundtrip, duel-card live load,
  6 duels → fit, all tabs, zero console errors.

Prior notes (pass 1) follow — still accurate for the engine layer.

# (pass 1) Continuation notes — 2026-07-29

Working doc for resuming after context compaction. Durable design lives in
`DESIGN.md` (canonical); lineage/decisions pointer in Claude memory
(`ricercar-lineage`). This file: exact state, gotchas, next moves. Delete
when stale.

## Where things stand

M0–M5 plus the **playtest-1 response pass** are complete on `main` (local
repo, no GitHub remote). 27 tests green (`cargo test --workspace --release`,
~90s — locked-refinement test renders a lot), clippy/fmt clean. The web app
was verified live via playwright: boot → duels → fit → workbench edit →
lock → commit(+improvement duel) → ⚡ evolve-from (both the locked-refusal
and accepted paths) → lineage/diff display → map click-to-open. Zero console
errors.

**User's playtest-1 notes and what was built in response:**
1. *"No obvious directionality"* → lineage system: every refine/edit is a
   `LineageEvent` (generation, parent→child ids, trace-address diff,
   Δutility), shown as the EVOLUTION strip (utility sparkline + humanized
   moves: "gen 2 ⚡ on #41 → #42 · release 0.42→0.44 · Δtaste +0.14").
2. *"See the full patch, knobs in position, fully interactive"* → the
   WORKBENCH: `describe()` (grammar crate) renders any `PatchTree` as
   modules/knobs/wires; every knob carries its live trace address; dragging
   writes via `set_param` (trace roundtrip), re-renders + re-vets in the
   worker. COMMIT inserts as a new candidate; "my edit is better" logs an
   edited-beats-original duel (user chose "Both, user-flagged").
3. *"Lock knobs and evolve the rest / evolve structure"* → per-knob and
   per-module locks; `Engine::refine_from(seed, locked)` rejects MH steps
   touching locked addresses **outside the kernel** (valid
   Metropolis-within-Gibbs on the conditional; step count scaled for wasted
   proposals). LOCK KNOBS / LOCK WIRING give settings-only / structure-only
   evolution.
4. *"Box-whisker reads as one patch, not my taste"* → (a) model change:
   utility is now **max of K=3 linear experts** `u = max_k θ_k·φ` (see
   below); (b) three taste views: MAP (2D PCA of pool + history ghosts,
   glow = posterior utility, hue = style island, click-to-open), STYLES
   (per-lens pool share + top features + exemplars), DIRECTIONS (per-lens
   feature bars with capped whiskers).

## The mixture story (important modeling lesson)

First attempt was a per-observation *marginalized latent lens*:
`log p(o) = lse_k(ln w_k + ll(o|θ_k))`. The synthetic bimodal gate
**failed**: that model applies one lens to both duel items, so a duel
*across* islands (great drone vs mediocre pluck) is unrepresentable — it
scored no better than K=1. Fix: put the nonlinearity in the utility itself,
`u(x) = max_k θ_k·φ(x)`, shared by all three likelihoods. No discrete sites;
K=1 ≡ old model; label switching handled by `TastePosterior::aligned()`
(exhaustive permutation match, K ≤ 5). Gate
`mixture_captures_bimodal_taste` (taste crate) pins all of this: mirrored-θ
bimodal user, K=2 must beat K=1 on held-out duels AND recover both
directions. `responsibilities(φ)` = posterior P(lens k is φ's argmax);
`style_share(pool)` ≈ island sizes; a lens with ~0 share is idle.

## What lives where (deltas from M5)

- `ricercar-grammar`: + `describe.rs` (RackDescription: modules/knobs/wires,
  every knob addr is a live trace site — pinned by
  `rack_description_addresses_are_live`), + `edit.rs` (`set_param` via trace
  roundtrip; structural sites rejected), + `diff.rs` (`tree_diff` in
  trace-address terms, display-formatted values).
- `ricercar-taste`: max-of-experts model (above); `TasteSample` lost
  `styles`/`weights` fields; `utility_mix`, `prob_prefers(a,b)` (no style
  arg), `aligned()`, `responsibilities`, `style_share`;
  `MixtureSyntheticUser` (max-utility ground truth).
- `ricercar-session`: `Candidate.id` (stable, u64) + `find(id)`; `Origin`
  {Prior,Refined,Edited} replaced `refined: bool`; `LineageEvent` +
  `Engine.lineage`/`generation`; `refine_from(seed_id, locked)`;
  `commit_edit(original, tree, as_improvement)` (edited patches always land,
  protected original, optional duel obs); `Profile` = log **+ standardizer**
  (fixes the θ-vs-standardizer portability gap; `import_profile`
  re-standardizes the pool); `map.rs` = `taste_map()` (top-2 PCA by power
  iteration, deterministic start, pool + ≤400 history ghosts). K=3 default
  (`SessionConfig.k_styles`).
- `ricercar-wasm`: id-based API (ids as **u32** over the boundary —
  wasm-bindgen maps u64→BigInt, avoid); workbench (`edit_begin/param/
  render/describe/commit/cancel`, vet-withholds audio on failure);
  `refine_from(id, locks_json)`; `taste_map/styles/lineage`;
  `export_profile/import_profile`.
- `apps/web`: WORKBENCH panel (SVG rack: gradient faceplates, rotary knobs
  −135°..+135°, enum selectors, green/amber cables with sag, per-knob lock
  dots + module locks, drag-to-edit with in-flight coalescing +
  audition-on-release), taste tabs, EVOLUTION strip, bench ⌖ open buttons,
  map click-to-open. Worker protocol is id-based; `edit_rejected` reply
  prevents an in-flight deadlock.

## Sharp edges (new ones)

- **wasm-bindgen u64 → BigInt**: keep boundary ids u32.
- Knob drags must NOT re-render the SVG mid-drag (pointer capture dies) —
  `knobDragging` flag suppresses `renderRack()` until pointerup.
- Worker must reply to every `edit_param` (ok or `edit_rejected`), else the
  main-thread edit queue deadlocks.
- Evolving with *everything* locked usually finds no acceptable move
  (structural proposals shift locked addresses → rejected). The UI says so
  ("loosen some locks"). Expected, not a bug.
- `closed_loop` test: with K=3 and a unimodal synthetic user, check the
  **best** lens's cosine, not lens 0's.
- Old sharp edges from M5 all still apply (Model not Clone, release-only
  audio tests, `PATH="$HOME/.cargo/bin:$PATH"` for wasm builds, quiver Q200
  still uncommitted in ../quiver).

## Run/verify

```bash
cargo test --workspace --release
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/ricercar-wasm --target web --release --out-dir ../../apps/web/pkg
cd apps/web && python3 serve.py   # no-store server — plain http.server lets the browser cache worker.js/pkg across rebuilds
```

## Next moves (playtest 2 will decide)

- Grid mode & radio mode (M6 remainder); naming/pinning styles.
- Structure *editing* on the workbench (add/remove modules by hand) — edits
  currently cover knobs/selectors only; structure changes go through ⚡.
- Stable-id cleanup is done; remaining backlog: per-style audition phrases,
  feedback-loop grammar productions, θ_struct → grammar weights, SMC pool
  generation, nih-plug/AUv3, GitHub remote, quiver Q200 PR.
- Watch: does K=3 discover real islands in the user's actual taste? Are
  duels still the right primary surface once the workbench exists?
