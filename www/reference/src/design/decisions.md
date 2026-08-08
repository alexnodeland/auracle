# Decisions log

<p class="lede">What was chosen, and what it was chosen over. A decision that
only records the choice is not a record of anything.</p>

Each row links, where there is one, to the page that works the choice out in
full. Rejected alternatives are named in the rationale rather than kept in a
separate list, because the reason a design was rejected is only legible next to
the one that replaced it.

| Decision | Choice | Rationale |
|---|---|---|
| [Genome representation](../genome/grammar.md) | Typed combinator-term PCFG (not raw graph, not NEAT) | Types make every sample valid; reuses fugue-evo grammar machinery; all 3 evolution levels in one rep |
| [Feedback signals](../taste/likelihoods.md) | Pairwise duels + stars (ordinal) + keep/kill; **no** implicit signals | One latent utility, three likelihoods; duels primary |
| [Taste features](../features/audio.md) | φ_audio (15) + φ_struct (26) = φ ∈ ℝ⁴¹ | Transfer across topologies + free structural screening |
| [Feature axes](../features/standardization.md) | Log-frequency, logged heavy tails, families not per-module columns | The model is linear in φ, so the axis decides what is *expressible*; sparse columns are coefficients fitted on a handful of rows |
| [Utility form](../taste/utility.md) | **Max of linear experts** `u = max_k θ_k·z`, K = 5 | Multi-modal taste; handles cross-island duels (per-observation and per-session latent-z designs both fail there); no discrete sites; K=1 ≡ BLR |
| [Preference sets](../taste/utility.md) | Discovered style lenses, aligned post-hoc; nameable and persisted | A lens claiming ≈0% of the pool is idle — K is an upper bound |
| [Locks / partial evolution](../search/locks.md) | Freeze any set of trace addresses; MH proposals touching them are rejected outside the kernel, in **both** directions | Exactly Metropolis-within-Gibbs on the conditional posterior, so locking is exact rather than heuristic |
| [Hand edits](../genome/edits.md) | Knob turn = write at a trace address; commit inserts as new candidate; optional "edit beats original" duel, provenance-tagged | Panel and genome share one encoding, so edits, locks, and evolution cannot drift |
| [Profile portability](../persistence.md) | Export = observation log **+ standardizer**; log stores **raw** φ by name | θ is only meaningful relative to its standardizer; by-name raw storage is what lets the feature set change without re-interpreting history |
| [Palette](../genome/grammar.md) | 42 productions: 7 sources, 20 processors, 15 modulators; categorical orders are append-only wire format | Enough texture axes to learn on; the codec writes indices into the trace |
| [Feedback loops in grammar](../genome/compilation.md) | Not yet (**tree** terms only — see [open questions](./open-questions.md)) | Stability; internal-feedback modules still allowed. Note the ceiling is tighter than "acyclic": a tree also forbids *sharing*, so one output cannot feed two places |
| [Audition](../audition/phrase.md) | Standard 5.05 s phrase + free-play; per-style phrases later | Feature comparability requires fixed stimulus |
| [Loudness](../audition/loudness.md) | LUFS-normalize all renders to −18 | Loudness bias would poison the preference data |
| [Acquisition](../search/acquisition.md) | **Uniform random pairing** by default; BALD selectable, Thompson kept for contrast | Measured tie with BALD over 20 paired seeds in two pool regimes; uniform has no tuning constants and makes every duel an unbiased calibration sample |
| [Calibration metric](../taste/calibration.md) | Brier skill against the 0.5 baseline, plus random check duels | Accuracy is not proper and is pinned near chance by an information-seeking pairing rule |
| [Recency](../taste/likelihoods.md) | Discounted likelihood, half-life 150 observations | Taste is allowed to change; stationarity is the wrong assumption about a person |
| [First frontend](../runtime.md) | Web / WASM | Both deps ship WASM; fastest UX iteration; shareable |
| [Session UX](./milestones.md) | All three modes, built duels → grid → radio | Same observation stream; sequenced by signal quality |
| [Safety](../safety.md) | Vetting gate: audition = pre-rendered vetted buffers, never live unvetted patches | One render serves health-check, features, and playback; quarantine + fitness shaping teach evolution to avoid pathology |

## What is not in this table

Two kinds of thing deliberately stay out of it, and three live on their own
pages: [open questions](./open-questions.md), which are decisions that have not
been made rather than decisions that have; [unraised
directions](./directions.md), which are possibilities nobody has yet argued
about either way — the distinction matters, because a reader cannot otherwise
tell *rejected* from *never considered*; and [what the audition cannot
hear](./audition-limits.md), which is the one **premise** underneath several
rows of this table rather than a row of it.

**Reversible details.** Buffer sizes, the exact number of MCMC steps, which
easing curve a knob uses. These live in the code and in the pages that quote
them by name; a decisions log that tracks them stops being readable.

**The pass-by-pass history.** What changed when is
[`CHANGELOG.md`](https://github.com/alexnodeland/auracle/blob/main/CHANGELOG.md).
This table is evergreen: it says what is true now and why, not what was true in
March.
