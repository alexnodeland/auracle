# Changelog

All notable changes to Auracle are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0. Entries below 0.1.0 were written when the project was
called Ricercar (and, earlier, EvoSynth) and name it as it was then — a
changelog that edits its own past is not a record.

## [Unreleased]

### Documentation site

The published site stops being "the instrument at a URL" and becomes a site with
the instrument in it. Four sections under one origin, all built by `make site`:

- **`/` — a landing page.** Hand-authored, in the instrument's own two-phosphor
  design system rather than a new one. Its hero is a **working duel**: two
  synthesized patches with real waveform traces rendered offline from the same
  graph builder that plays them, an online Bradley–Terry update, and a posterior
  whose credible intervals narrow as you pick. It is a four-coordinate miniature
  of a forty-coordinate model and the page says so under the panel.
- **`/play/` — the instrument.** Unchanged, and moved off the root. Every asset
  path in `apps/web` was already relative, so this cost nothing.
- **`/docs/` — a user guide.** Fifteen chapters on playing it: the three views,
  the bank, the rack, wiring, performance, what the model learns from and what it
  provably cannot, how to read its uncertainty, your data, the full key map,
  accessibility (including its four known gaps), troubleshooting, glossary.
- **`/reference/` — a technical reference.** Twenty-five chapters with the math
  set in KaTeX: the typed PCFG, trace addresses, compilation, the audition phrase,
  BS.1770 loudness, the vetting gate, both halves of φ, standardization, the
  max-of-experts utility, the three likelihoods, the posterior and its
  degeneracy diagnostics, calibration, the Boltzmann target, the taste tilt, locks
  as conditional refinement, acquisition, safety, persistence, the web runtime.
  Every constant is quoted from the code by name, every measured claim names the
  harness that produced it, and where the design and the implementation differ —
  refinement is local hill-climbing, not the designed tempered SMC — the page
  says so in its first paragraph.
- **`/reference/api/`** — rustdoc for all five crates.

Both books share one mdBook theme carrying the app's phosphor palette and its
three colour laws, with two themes (rack and paper) rather than mdBook's six.
KaTeX renders at **build time** and its stylesheet and faces are vendored, so the
whole site makes no external requests — a property `make site-check` now enforces,
along with every link, asset, cross-section anchor and the absence of any
root-absolute path (which would work locally and 404 under the project subpath).

CI builds and checks the site on every PR, because none of its failure modes are
visible to `make check`: an undefined KaTeX macro is a build *warning*, and a
cross-section link does not exist until four sections are assembled.

The screenshots throughout are the real app in a taught session, published at
their captured size — `www/SCREENSHOTS.md` records how to remake them and why
scaling a frame of this app is not an option.

### Changed — a plainer voice across the docs and the site

An editing pass over every prose document: the landing page, both books, the
README, `DESIGN.md` and the contributor docs. Nothing about the product changed,
only how it is described.

- **Headings name the thing rather than its presentation.** "Catalogued in
  signal-flow order, not alphabetically" is now "Forty-one modules, from source
  to output". The same went for "What to expect, honestly", "The memo is not an
  optimization detail", "Why this page matters more than it looks" and a dozen
  others. Two anchors moved with their headings, and every inbound link moved
  with them.
- **Implementation boasts came out.** A progress bar that is "honest rather than
  decorative", a guarantee that "provably" holds, a patch that is "byte-for-byte"
  the one that was evolved, a comment that is "the longest and most useful in the
  workspace", a build whose foundations arrive in "one clone". Where the fact
  underneath was load-bearing it stayed; where it was there to impress, it went.
- **Retrospectives left the user-facing pages.** The guide no longer explains
  which bugs the app used to have, how small a jack's hit area once was, or which
  trap it "has already fallen into once". The reference keeps the ones that are
  reference material: the sentinel incident, the two upstream quiver bugs, the
  acquisition retraction.
- **Fewer em dashes, and fewer "not X, but Y" constructions.** 731 em dashes down
  to 172, with the parenthetical ones turned into parentheses and the rhetorical
  ones into full stops.
- **`DESIGN.md` kept its decisions and lost its swagger.** The rejected designs,
  the layered-safety argument and the design-versus-implementation note all stay;
  "this version does it properly", "a confident model mostly serves bangers" and
  "non-negotiable" do not. The locks decision row was reworded, and the reference
  page that quotes it verbatim was updated in the same commit so the quotation
  stays true.

### Fixed

- The README's architecture diagram named Thompson sampling as the duel
  acquisition rule. It is selectable, it is not the default, and it measurably
  loses; the default is uniform pairing. The diagram now says so.

## [0.2.0] — 2026-08-04

The first release under the name **Auracle**, and the first one that is a
*patcher* rather than a patchbay with a splice tool behind it. Since 0.1.0 the
instrument gained wiring as a gesture, node identity that survives evolution,
a navigable canvas, destructive verbs you can see and undo, a model that says
what it believes and how sure it is, and an exported picture that is itself a
patch. The prebuilt web bundle is attached below — unzip, `python3 serve.py`,
play.

### Renamed — Ricercar → Auracle

The project is now **Auracle** (aural + oracle): it listens, it learns, and it
tells you what you are going to like. "Ricercar" was a musician's in-joke that
most people could neither pronounce nor spell.

- Crates `ricercar-*` → `auracle-*`, wasm artifacts `auracle_wasm*`, worklet
  processor `auracle-voice`, the workspace and every intra-workspace path dep.
- The wordmark is `AURACLE` with the final **E** as the "model is listening"
  light — the same one mark, two jobs the final R used to do.
- **Nothing a player saved is lost, and nothing of theirs is deleted.** The
  IndexedDB autosave is now `auracle`, with an adopt-on-boot chain that reads
  `ricercar` then `evosynth`; every `ricercar-*` / `evosynth-*` localStorage
  preference is copied to `auracle-*` at import time, before any of it is read,
  and never overwrites an answer this build already has.
- Exported patches are `.auracle.json`, PNG `tEXt` keyword `auracle`, SVG
  `metadata#auracle-patch`. **Files exported by any older build still open**:
  the JSON path never read the marker (a patch is recognized by its shape), and
  the PNG and SVG readers try the old names after the new one.

### Fixed — a hole that stays a hole, a view that cannot be stranded, and a patcher that fits on a laptop

The rest of the closing gate: the dissenting panelist's two named blockers (M2,
M3), the one-line durability bug the chair pulled in on impact (m1), the two
polish items ruled to ship alongside M2 (p4, p5), and the demo gate (M4).

- **An empty socket is named by the node standing in it, not by where that node
  sits.** `placeholderKeys` was a set of trace addresses, so it survived exactly
  as long as the addresses did: the client-side rewrite path carried holes
  across by object identity and **every** `StructOp` — insert, delete, replace,
  set_mod, swap_mix, at any key in the patch — forgot them. Unplug, then insert
  anything anywhere, and the dashed EMPTY plate silently became a full vco with
  knobs on it. A hole is now keyed by `uid`, the same identity locks are keyed
  by and for the same reason, so it rides through any edit inside the node that
  moved. Verified in the browser: an insert that does not touch the hole and an
  insert that moves it from `node/0/1` to `node/0/0/1` both leave it a hole,
  and dropping a source *into* it clears the mark on the frame the module lands.
- **A hole survives a reload,** in `holeStore`/`ui.holes`, the same shape and
  the same argument as `lockStore`/`ui.locks` — persisting it is only honest
  because it names a node. It also survives ⌘Z/⇧⌘Z, because `benchStep` carries
  it: pruning gets undo right for free and could never have got redo right.
- **`case "committed"` files the child's locks — and its holes — under the
  child.** One line and its twin (m1). The commit reply carries no `m.subject`
  so it never reaches `case "bench"`, and IDB ended with an entry for the parent
  and none for the patch the player had actually authored: pins evaporating on
  reload for the one patch that mattered most, with the next ⚡ then breeding
  away the routing they meant to hold. Verified end to end through a commit, a
  full page reload, and re-benching the child.
- **Canvas, bank and accessibility tree agree about absence** (p4). The IN THIS
  PATCH list printed "vco" and the plate's `aria-label` said "vco module" about
  a socket the canvas was drawing as empty. All three route through one
  predicate now; the chip is dashed, reads "empty", and carries no θ, because a
  belief about vcos is not a belief about a hole.
- **The EMPTY plate stops shouting** (p5). It was inheriting the plate of
  whatever it replaced — up to 240×164 with a recessed control well — giving the
  most visual weight on the panel to the thing that is not there. It renders at
  the narrow 96-unit width, one row tall, title and hint only, no well.
- **Freeform can no longer strand the view, and now says so if it has.**
  `contentBox()` returns the modules' bounding box instead of the layout
  canvas's extent, so a fit is a fit of what is drawn — a persisted layout that
  put every plate at y ≈ 3400 had Home dutifully framing 3744 units of which
  3400 were empty. The minimap reads the same box. `applyGrid` re-seeds from the
  **chain** when what is drawn is degenerate, instead of pinning the stranding —
  the one command that looked like a rescue was the one that made the damage
  permanent. A stored layout that places under two thirds of the rack's nodes is
  dropped wholesale rather than applied, and the inheritance test rose from
  "*some* uid in common" (1 in 18) to the same floor. A **reset** verb sits in
  the freeform controls, and below 0.30× with a measurably worse-than-chain
  arrangement the frame itself offers it. Measured on a reproduced stranding:
  0.049× → 0.249× at 1280×900, 0.080× → 0.403× at 1700×1000.
- **The patcher fits on a laptop** (M4). The docked spec card collapses to a
  single line when it has nothing to describe (and stays one line while armed,
  so a placement in progress never resizes the canvas underneath itself); the
  short-laptop media query's breakpoint moves from 860px to 940px, which is
  where it was always meant to apply — 1280×900 is the plan's own second test
  size; a **draggable divider** above the strip gives the player the final say,
  the node bank's rail pattern on the other axis, persisted and keyboard-
  operable; and the auto-LOD threshold scales with the frame's height, because
  what makes a knob small in a 364px band is the band, not the patch. Result at
  1280×900: rack frame **295 → 364px**, and **5 of 5** stock presets open in
  full detail with knobs (First Bass 0.67, Sub & Sparkle 0.61, Acid Line 0.67,
  Reese 0.44, Anvil 0.67 against a 0.40 threshold) where 5 of 5 opened as
  knob-less block diagrams. At 1700×1000 the frame is 489px, the threshold 0.54,
  and all five are in full detail.
- **The freeform verbs hold their slots** (m6, taken because M3 would otherwise
  have made it worse). `apply grid` used to be `display: none` outside freeform,
  so entering the mode slid the layout toggle ~100px under the pointer that had
  just pressed it and a second press fired *apply grid* — a command that
  rewrites every position. Both verbs are now reserved and disabled, and both
  are one word (`snap`, `reset`), because two long labels wrapped the group onto
  a second row at 1280 and cost 35px of the very budget M4 is fighting for.

### Fixed — the sentinel: a knob outside its range, and everything downstream that believed it

The closing panel's one non-negotiable item, found independently by three
reviewers from three unrelated surfaces: a faceplate reading "SUSTAIN 1200.0
dB", a HELD fragment printing `1e+30` for every parameter, and six cells of
exactly `1e30` inside the raw φ of the persisted observation log.

- **Every continuous site in the grammar has a declared range, and it is now
  written down** — `PARAM_DOMAIN`, one constant, next to the `u01()` the prior
  actually samples from. `PatchTree::domain_violations` reports the sites that
  leave it and `PatchTree::clamp_domains` pulls them back, both by walking the
  **trace** rather than matching 26 productions: the trace enumerates exactly
  the continuous sites, by construction, so there is no second table of "which
  fields are knobs" for the next module to be left out of.
- **`validate_tree` — the WS-1 rider — now speaks about values.** It has always
  gated size, depth and modulation depth; it had nothing to say about a knob,
  which is why a value could walk through it into `edit_set_tree`, into
  `finish()`, into φ, into the exported PNG's `tEXt` chunk and into the log.
- **Domains are repaired, ceilings are refused,** and the asymmetry is the
  point: a 40-node patch cannot be clamped without deciding what to delete, and
  a knob can be fixed exactly. Refusing would have meant a saved session that
  already contains one becomes an app the player cannot edit their way out of.
  `finish()` (so every `ReplaceTree`/`InsertTree`/`SetModTree` fragment the
  panel hands in), `edit_set_tree_apply`, `import_patch` and the refinement
  boundary all repair; identities survive, so locks and hand-placed positions
  ride through the repair.
- **The featurizer's quarantine caught only audio pathology.** `sustain = 1e30`
  *renders fine* — the limiter bounds the voice — so it passed the vet and its φ
  became evidence. `featurize` now refuses an out-of-domain term before the
  render, and refuses a non-finite coordinate after it.
- **`Standardizer::fit` gained a runaway-column detector — and it is a detector,
  not a trim, because the trim was measured and thrown out.** One escaped row
  gave `amp_sustain` a mean of ~1.2e29 and a σ of ~5.5e29, which standardizes
  every real patch to the same place: a dead coordinate the model can never
  learn from while the belief line still prints a contribution for it. The first
  fix was routine winsorization at 2% per tail; the 16-seed paired run took it
  straight back out (`+1.877 ± 0.362` → `+0.204 ± 1.347` mean gain, 15/16 → 11/16
  seeds climbing, one seed at −18.2). Trimming a real tail is not free. So the
  shipped rule uses the plain moments **unless** a column's plain σ exceeds its
  winsorized σ by more than `RUNAWAY_RATIO`, which makes it a bit-identical no-op
  on clean data by construction rather than by luck. The threshold was measured
  too — a new `winsor_ratio` example fits 150 clean 48-patch pools and reports
  the largest ratio any column reaches (14.6, `rms_std`), against ~2×10²⁹ for a
  single `1e30`; `1e6` sits five orders above the first and twenty-three below
  the second. Non-finite cells are dropped from their column instead of turning
  it into NaN.
- **Saved state is migrated, not deleted.** On load, every bank term is
  clamped, the observation log's unit coordinates are clamped **by name**
  (never positionally), the implicit-event stream's stored φ pairs are clamped
  positionally *only* at the live φ width, votes carrying a non-finite cell are
  dropped, and — if anything at all was repaired — the persisted standardizer is
  discarded and refit, because a scale fitted over a poisoned column is itself
  poisoned. The frontend says what was mended and how much of it, with counts.
  HELD fragments are UI state and are repaired on their own path in the client.
- **The panel's formatters now fail loudly.** Every knob unit was a *map*, not a
  check: handed `1e30` they answered "1200.0 dB", "Infinity kHz" and
  "1e+32%" — three plausible-looking readings of the same corruption. One guard
  in `knobUnit` renders anything outside 0–1 as `⚠ out of range`.
- **Where it came from.** `1e30` appears as a literal in no workspace source and
  in none of the vendored dependencies (`fugue-evo` 0.3.1, `fugue-ppl` 0.1.0 /
  0.2.0 / 0.2.1, `quiver-dsp` 0.1.x / 0.2.0), and the MH kernel *cannot* seat
  one: every continuous site is `Uniform(0,1)`, whose `log_prob` is −∞ outside
  the unit interval, so an escaped proposal scores `log α = −∞` and is
  rejected. That is measured, not argued — a new `mh_escape` example runs 8
  chains × 20 000 single-site transitions through the shipped kernel and
  observes zero escapes, and a full closed-loop seed (40-patch pool, 60 duels,
  6 refine generations) produces none either. In the shipped session the fault
  is traceable to one event: bank entry #23 (`origin: prior`) is clean, its
  hand-edited child #41 has the same amp envelope with `sustain`, `cut`, `res`
  and `mdepth` all at exactly `1e30` and a freshly-minted `uid` on the root
  filter, and #43/#55/#56 inherit from it. So it entered at the **hand-edit /
  whole-tree-replace boundary** — the one route into a term that went through
  neither `set_param`'s clamp nor the kernel's support check — in a session
  carried across builds, and that boundary is exactly what now has a gate.
- **The φ revalidation, since this touches φ.** 16 seeds, paired, same list both
  arms: pool climb `+1.877 ± 0.362`, climbing on 15/16 — **bit-identical on
  every seed**, which is the intended result and is a property of the design
  rather than a lucky null: the domain gate cannot fire on a synthetic loop that
  never had a bad value, and the standardizer is the plain moments unless a
  column is runaway. VIF over 300 draws is likewise identical to the digit (no φ
  column moved; `amp_sustain` 1.4, `rolloff_mean:p2` 19.6). What *did* move is
  the coordinate the fault was killing: in the shipped profile `amp_sustain`
  comes back with mean 0.647 and σ 0.284, so two patches at opposite ends of the
  knob are 3.5 σ apart — against ~4×10⁻³⁰ σ before the repair. It is a live
  coordinate again, and that is the only number in this section that is supposed
  to be different.
- New regression tests: the prior's own claim (400 draws, every site in
  domain), the sentinel repaired with identities intact, NaN landing mid-range
  rather than pinned to an end, an explicit fragment that cannot seat a bad
  value, the quarantine refusing the exact `1e30` term, clean columns fitting
  bit-identically over four differently-shaped distributions, one escaped row
  that can no longer kill a column, and the log repair being idempotent.

### Added — φ_struct sees how a patch is *arranged*

- **Two arrangement coordinates in φ_struct**, so the taste model can hold an
  opinion about routing and not only about contents: `chain_balance` (mean
  source-to-root path over the longest one — an asymmetric branch, whichever
  side the chain is on) and `frac_sidechained` (binary nodes whose `/1` — a
  ducker's key, a vocoder's modulator — is a chain rather than a bare
  oscillator). `filter(mix(a, b))` and `mix(filter(a), b)` were *the same
  point* in φ before this: same counts, different instrument.
- Both are ratios of shape sums, never linear in any count, which is what keeps
  them clear of the two exact identities that put `size`, `depth` and `n_mix`
  out of φ in the first place. VIF over 300 draws: 2.7 and 2.4, against
  `mod_density` 5.6 and the standing `rolloff_mean` 19.6.
- **Four columns were written and two were cut, both by measurement**, and that
  is the more useful half of the change:
  - `branch_width_max` came back at VIF 10.4 and took `n_vco` from 3.1 to 9.1.
    WS-8 §4 asked for a parallelism coordinate on the reading that serial and
    parallel patches "differ only in `n_mix`". They do not: the leaf count is
    `1 + Σ binaries` exactly, so a patch cannot gain a mixer without gaining a
    source, and the source counts have been in φ since v1. A synthetic listener
    who "likes wide patches" was already learned to Spearman 0.709 by the *old*
    feature set, which says the same thing independently.
  - `mod_at_source` measured *well* — VIF 3.0, full spread — and is out on a
    tie the harness could not break. An 8-seed search-health run made three
    columns look like an unambiguous regression (climb +1.714 → +1.320, best
    patch 8.154 → 6.503, 7/8 seeds climbing → 5/8). At 16 seeds the harness's
    standard error on that quantity turned out to be ±0.64, and the paired
    differences are +0.35 ± 0.73 for two columns and −0.33 ± 0.74 for three:
    neither a regression nor an improvement anything here can see. So the tie
    goes to cost — every column is a dimension of posterior variance the cold
    start pays down — and to scope: two columns answer the question this wave
    was asked, and the third answers a different one. It stays as a display
    field, for a wave with evidence to spend and its own measurement.
- **The routing-lock copy now claims learning.** WS-8 §4 sequenced that
  deliberately: until these columns landed, "lock wiring" could only promise
  that evolution would leave the routing alone.
- **The pre/post evolution measurement, in one line each** (before → after,
  same seeds): pool climb +1.714 → +1.723 · MH acceptance 46.5% → 49.6% ·
  locked refine beat its parent 66% → 69% · fitted-vs-true ranking 0.318 →
  0.389 · true best survived the generation 98% → 100% · closed-loop
  calibration r 0.693 → 0.688 (se ±0.018). And for a synthetic listener whose
  taste *is* a routing preference: fit-vs-truth 0.662 → 0.705, true utility
  gain +2.016 → +2.669, and a pool that ends up 82% sidechained rather than
  71.6%. The full table is on `search_health`'s module doc.
- `search_health` gained three modes. `--routing` is a synthetic listener whose
  taste *is* a routing preference; it walks the term rather than reading
  `StructFeatures`, so the same measurement compiles and runs on both sides of
  a feature-set change. `--climb` runs the pool-climb gate alone at any seed
  count and prints the per-seed numbers, because ±0.4 in the mean gain is
  inside the seed-to-seed spread and the aggregate cannot tell a regression
  from a lottery. `--tail` runs the expensive back half alone, so an
  interrupted comparison run does not have to start over.

### Changed

- Two open questions about the search loop are now **answered in the code**
  rather than in a commit message, because both would otherwise be re-asked
  from scratch:
  - The refinement budget split (`2·N_OPS` steps from `N_OPS/2` seeds) is a
    measured optimum, not an argument — moving off it in *either* direction
    scores worse, and depth from few seeds is actively harmful. The table is
    on `SessionConfig::refine_steps`.
  - The pool-decline scare from the palette expansion: the fitted ranking
    genuinely does churn between refits (Spearman 0.556), and it genuinely
    does not matter, because the true best survives 98% of generations and
    eviction only reads the bottom of the order. Recorded on
    `search_health`'s `retention`, along with why the upper-confidence-bound
    eviction rule it motivated was designed and not shipped.

### Added — wave 2C: modulation becomes a sort

- `ModNode` was a flat enum of leaves: one modulator, one destination, and
  nowhere to put anything in between. It is now **recursive with a depth
  bound**, so `s&h rand → quantize to a minor scale → slew` is a term the
  grammar can write, the taste model can learn and the rack can draw.
- Eleven new modulators: `euclid` (a clocked pattern — the rhythm behind most
  drum machines), the CV shapers `quantize`, `slew`, `rectify` and `hold`, and
  the combiners `min`, `max`, `and`, `or`, `xor` and `switch`.
- **Shapers wrap rather than replace.** Dropping a quantizer on a cable that
  already carries an LFO takes the LFO as its input — chaining is the whole
  point of the recursive sort, and it should not first cost you the modulator
  that made the cable worth quantizing. The socket says which of the three
  things will happen before you click.
- Palette: **30 → 41 modules**, and 43 of quiver's 65 are now reachable.

### Added — wave 2B: the binary-node family

- **Five more modules.** `pitch shift` (a harmoniser — one note becomes an
  interval), and four **binary** nodes whose second child is a *control* rather
  than something you hear: `compressor`, `ducker`, `gate` and `vocoder`.
- Wave one cut all five on the grounds that they "need a second free audio input
  the typed tree cannot name". `ring mod` shipped in that same wave *as a
  two-child node*, so the premise was already false — and the pitch shifter
  turned out to be unary all along; the port map that condemned it belonged to
  the vocoder.
- A `dynamics` group joins the catalogue, and binary sockets now carry real
  names — `in`/`key`, `carrier`/`voice` — instead of `a`/`b`.
- Palette: **25 → 30 modules**.

### Added — wave 2A: motion, voice, and pitch that can bend

- **Six more modules**, none of which needed an architectural change — they were
  cut in wave one on product grounds that did not survive re-reading:
  `formant` (a glottal pulse through five resonators, with a *continuous* vowel
  slide rather than a five-way switch), `flanger`, `tremolo`, `vibrato`,
  `eq` (three bands, ±12 dB, arriving flat) and `granular`.
- **Pitch modulation.** `vco` and `supersaw` gained a modulation slot landing on
  the pitch offset. Until this existed nothing in the instrument could bend a
  pitch — no vibrato, no pitch envelope, no siren — which made "vibrato is just
  an LFO on pitch, pre-baked" an argument for a capability that was not there.
- Palette: **19 → 25 modules**, and modulation slots **10 → 18**.
- A `motion` group joins the catalogue, between `space` and `combine`.

### Added — the palette, and the catalogue that holds it

- **Six new modules, appended to the grammar**: `wavetable` (eight bandlimited
  shapes with a modulatable morph — the first source whose timbre moves),
  `pluck` (Karplus–Strong, gate-triggered), `distortion` (soft / hard / tube),
  `bitcrush`, `phaser`, and `ringmod` — the grammar's **second binary node**,
  which is what makes COMBINE a real sort rather than a sidebar heading.
  Plus `follower`, an envelope follower that taps the module's own input so a
  patch responds to itself, and a `glide` knob on `s&h rand`. Nineteen modules,
  from twelve.
- **Modulation almost everywhere.** Delay, chorus, reverb, wavetable, pluck,
  distortion, bitcrush and phaser gained a modulation slot, each with a fixed,
  **named destination** the rack prints on the jack (`→ time`, `→ size`,
  `→ drive`). It was filter and wavefolder only, in an instrument whose DSP had
  supported the rest all along.
- **The node bank became a catalogue.** Six signal-flow groups, a transfer-
  function glyph per module, a port signature in both phosphors at rest, search
  by sound as well as by name (`grit`, `metal`, `wander`), a spec card with one
  sentence of plain English per module, and — where the evidence supports it —
  the model's own θ with a ±σ whisker.
- **Arm-and-place**, with a full keyboard equivalent. Click a module and every
  legal socket lights up and says what will happen to it: green **inserts**,
  amber **replaces**. Wiring previously had no keyboard path at all.
- **IN THIS PATCH** in the rail, a resizable and persisted width, a collapsed
  rail that keeps its name and its held count, and six new presets that
  exercise the new modules.

### Changed

- `φ_struct` carries **families**, not one column per module: `n_drive` covers
  fold + distortion + bitcrush, `n_mod_fx` covers chorus + phaser. Ten sparse
  per-kind columns would have arrived as near-indicator variables and cost the
  cold start ten dimensions of posterior variance before the model said
  anything.
- The taste→grammar proposal tilt is **shrunk by θ's own uncertainty** rather
  than reading `theta_mean` raw, and the refinement budget scales with the op
  alphabet.
- The rack's ⋯ menu stopped reprinting the module list — **replace with…** and
  **insert after…** hand off to the rail with the socket pre-chosen. One
  inventory, one place.
- The tray is now **held**, and states its terms where it stands.

### Fixed

- The belief the sidebar shows is gated on **evidence, not prevalence**: a
  coefficient whose |mean| sits inside its own σ draws a dot on zero and says
  "the model has looked and has no lean either way", rather than a short bar
  and a direction the posterior does not have.
- Tube-mode distortion is now included in the voice's DC-blocker test — its
  asymmetric shaping emits real DC, which the amp envelope would otherwise
  multiply into a per-note thump and carry into every feature vector.

## [0.1.0] — 2026-07-30

The first tagged release: a playable, taste-learning instrument. The
attached `ricercar-v0.1.0-web.zip` is the prebuilt web app — unzip,
`python3 serve.py`, play.

### Changed
- Dependencies come from crates.io (`quiver-dsp 0.1.1`, `fugue-ppl 0.2.1`,
  `fugue-evo 0.3.1`) — a single clone builds. The quiver wasm32
  `SystemTime` panic was fixed upstream and released as `quiver-dsp 0.1.1`.
- Repository adopted the fugue-ecosystem / quiver OSS standards: MIT
  license, Makefile (`make check` = the CI gate), DEVELOPMENT.md,
  contributing + issue/PR templates, CI with separate
  fmt/clippy/test/wasm jobs under `-D warnings`, and this changelog.

### Renamed
- **EvoSynth → Ricercar** (`efceab6`): crates `ricercar-*`, wasm artifacts,
  worklet processor, storage keys (with one-time migration of old saves),
  export filenames, UI wordmark. Old `.evopatch` files still import.

### Added — pass 6, "four tiers" (`4e94345`, `d12a23b`, `ca82994`)
- **Trust**: IndexedDB session autosave/restore; undo/redo over knob and
  structural edits; Web MIDI in (velocity, pitch bend, sustain); per-patch
  LUFS makeup gain for loudness-fair live audition; in-worklet WAV recording;
  shareable single-patch files.
- **Musicality**: sample-accurate arpeggiator (up/down/up-down/random, BPM ×
  division), glide, unison with detune + stereo spread, velocity→level
  curve; palette grew **reverb** (Freeverb) and a **sample-and-hold random**
  modulation source, end to end (grammar → features → UI).
- **Taste loop**: refinement proposals tilted by the structural taste
  posterior (`exp(η·θ)` on grammar kind weights); recency-weighted
  likelihood (half-life 150 observations); implicit signals logged (play
  counts, promotes); nameable, color-coded styles with auto-labels and
  exemplar audition; pre-vote duel forecasts with running calibration.
- **Surface**: modulation wires pulse at the modulator's rate; duel-deal
  staging; quick-duel strip on PLAY; `?` help overlay with first-run onboarding;
  coarse-pointer touch targets.

### Added — pass 5, bulletproofing (`a0e5628`)
- Zero-allocation render path, one-pole parameter smoothing, click-free
  patch swaps (fade → silent amortized rebuild → re-press held notes →
  fade-in), swap coalescing, compile-failure fallback, chaos gate tests.

### Added — passes 1–4 (`ad00e32`, `05bfbe4`, `76962fc`, `5819ef9`)
- Interactive workbench (every knob a live trace address), locks with exact
  conditional refinement, max-of-experts taste model, taste map / styles /
  directions views, lineage strip.
- The instrument: AudioWorklet 4-voice polyphony, app frame
  (PLAY/EVOLVE/TASTE), patch bank, docked keyboard.
- Feature-complete push: typed structural editing, presets, patch naming,
  dynamic style count, duel-card circuit flip.
- The live surface: zero-recompile knobs (`ExternalInput` atomics), typed
  jack-drag rewiring with a parts tray, labeled jacks, colored wires.

### Added — milestones M0–M5
- Workspace scaffold; grammar + trace codec + compiler; feature pipeline
  (vet gate, LUFS, φ); taste model with three likelihoods; two-loop session
  engine with dueling-Thompson acquisition (closed-loop gate: r > 0.6 in 60
  duels against a synthetic user); wasm bindings and the first web frontend.
